import { Router } from 'express';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import config from '../core/config.js';
import { loadMessages, saveMessages, loadTags, saveTags, removePathFromTags } from '../store/messages.js';
import { requireAdmin } from '../services/auth.js';

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'storage', 'downloads');
const RECYCLE_DIR = join(__dirname, '..', '..', 'storage', 'recycle');

const router = Router();

router.delete('/*path', requireAdmin, (req, res) => {
  const localPath = Array.isArray(req.params.path)
    ? req.params.path.join('/')
    : req.params.path;
  const srcPath = join(DOWNLOADS_DIR, localPath);

  if (!existsSync(srcPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Move to recycle bin
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

  // Remove from messages.json
  const messages = loadMessages();
  for (const msg of messages) {
    msg.segments = msg.segments.filter((s) => s.data?.localPath !== localPath);
  }
  const cleaned = messages.filter((m) => m.segments.length > 0);
  saveMessages(cleaned);

  // Remove from tags.json
  const tagArr = loadTags();
  removePathFromTags(tagArr, localPath);
  saveTags(tagArr);

  if (!config.prod) console.log(`[DEL] ${localPath} → recycle`);
  res.json({ ok: true });
});

export default router;
