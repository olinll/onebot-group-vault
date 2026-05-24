import { Router } from 'express';
import multer from 'multer';
import { join, extname } from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { loadMessages, saveMessages, loadTags, saveTags, setTagsForPath, getTagsForPath } from '../store.js';
import { getDatePath, getUniqueFilename, getImageDimensions } from '../helpers.js';

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'storage', 'downloads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const datePath = getDatePath();
    const dir = join(DOWNLOADS_DIR, datePath);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const datePath = getDatePath();
    const dir = join(DOWNLOADS_DIR, datePath);
    const rand = crypto.randomBytes(4).toString('hex');
    const ext = extname(file.originalname) || '.bin';
    const finalName = getUniqueFilename(dir, `upload_${rand}${ext}`);
    cb(null, finalName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const router = Router();

router.post('/', upload.array('files', 20), (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  // Parse tags: global tags apply to all, per-file tags override
  const globalTags = ((req.body.tags as string) || '').split(/\s+/).filter((t: string) => t.trim());
  const perFileTags: Record<string, string[]> = {};
  try {
    if (req.body.fileTags) {
      Object.assign(perFileTags, JSON.parse(req.body.fileTags));
    }
  } catch {}

  const datePath = getDatePath();
  const messages = loadMessages();
  const tagArr = loadTags();
  const results: { filename: string; localPath: string; tags: string[] }[] = [];

  for (const file of files) {
    const localPath = `${datePath}/${file.filename}`;
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.originalname);

    // Auto-tag for images
    const autoTags: string[] = [];
    if (isImage) {
      const ext = extname(file.originalname).toLowerCase();
      if (ext === '.gif') autoTags.push('表情包');
      const dims = getImageDimensions(file.path);
      if (dims) {
        if (dims.width <= 300 && dims.height <= 300) autoTags.push('表情包');
        const ratio = Math.min(dims.width, dims.height) / Math.max(dims.width, dims.height);
        if (ratio >= 0.85) autoTags.push('表情包');
      }
    }

    // Merge tags: global + per-file + auto
    const fileTags = perFileTags[file.originalname] || [];
    const allTags = [...new Set([...globalTags, ...fileTags, ...autoTags])];

    // Save tags
    if (allTags.length > 0) {
      const existing = getTagsForPath(tagArr, localPath);
      for (const t of allTags) {
        if (!existing.includes(t)) existing.push(t);
      }
      setTagsForPath(tagArr, localPath, existing);
    }

    // Add message record
    messages.push({
      message_id: Date.now() + Math.floor(Math.random() * 1000),
      group_id: 0,
      user_id: 0,
      nickname: 'WebUI Upload',
      time: Math.floor(Date.now() / 1000),
      date: new Date().toISOString(),
      datePath,
      segments: [{
        type: isImage ? 'image' : 'file',
        data: {
          file: file.originalname,
          localPath,
          owner: 0,
        },
      }],
    });

    results.push({ filename: file.originalname, localPath, tags: allTags });
  }

  saveMessages(messages);
  saveTags(tagArr);

  res.json({ ok: true, count: results.length, files: results });
});

export default router;
