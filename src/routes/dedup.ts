import { Router } from 'express';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { loadMessages, loadTags, saveMessages, saveTags, removePathFromTags } from '../store/messages.js';
import { findDuplicates } from '../services/dedup.js';
import { requireAdmin } from '../services/auth.js';

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'storage', 'downloads');
const RECYCLE_DIR = join(__dirname, '..', '..', 'storage', 'recycle');

const router = Router();

router.get('/scan', requireAdmin, async (_req, res) => {
  const messages = loadMessages();
  const imagePaths: string[] = [];

  for (const msg of messages) {
    for (const seg of msg.segments) {
      if (seg.type === 'image' && seg.data.localPath) {
        const absPath = join(DOWNLOADS_DIR, seg.data.localPath);
        if (existsSync(absPath) && !imagePaths.includes(seg.data.localPath)) {
          imagePaths.push(seg.data.localPath);
        }
      }
    }
  }

  const groups = await findDuplicates(imagePaths);
  res.json({ total: imagePaths.length, groups });
});

router.post('/delete', requireAdmin, (req, res) => {
  const paths = req.body.paths as string[];
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'No paths provided' });
  }

  const messages = loadMessages();
  const tagArr = loadTags();
  let deleted = 0;

  for (const localPath of paths) {
    const srcPath = join(DOWNLOADS_DIR, localPath);
    if (!existsSync(srcPath)) continue;

    // Move to recycle
    const recyclePath = join(RECYCLE_DIR, localPath);
    mkdirSync(dirname(recyclePath), { recursive: true });
    let finalPath = recyclePath;
    let counter = 1;
    while (existsSync(finalPath)) {
      const ext = extname(recyclePath);
      const base = basename(recyclePath, ext);
      const dir = dirname(recyclePath);
      finalPath = join(dir, `${base}_${counter}${ext}`);
      counter++;
    }
    renameSync(srcPath, finalPath);

    // Remove from messages
    for (const msg of messages) {
      msg.segments = msg.segments.filter((s) => s.data?.localPath !== localPath);
    }

    // Remove tags
    removePathFromTags(tagArr, localPath);
    deleted++;
  }

  const cleaned = messages.filter((m) => m.segments.length > 0);
  saveMessages(cleaned);
  saveTags(tagArr);

  res.json({ ok: true, deleted });
});

export default router;
