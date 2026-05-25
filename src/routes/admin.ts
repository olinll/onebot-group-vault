import { Router } from 'express';
import { existsSync, mkdirSync, renameSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { join, dirname, extname, basename, relative } from 'path';
import config from '../core/config.js';
import { loadMessages, saveMessages, loadTags, saveTags, removePathFromTags, getTagsForPath, setTagsForPath } from '../store/messages.js';
import { requireAdmin } from '../services/auth.js';
import { findDuplicates } from '../services/dedup.js';

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'storage', 'downloads');
const RECYCLE_DIR = join(__dirname, '..', '..', 'storage', 'recycle');
const DATA_DIR = join(__dirname, '..', '..', 'storage', 'data');
const STORAGE_DIR = join(__dirname, '..', '..', 'storage');

const router = Router();

// ── Helpers ──────────────────────────────────────────────

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      total += statSync(full).size;
    }
  }
  return total;
}

function walkFiles(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, base));
    } else {
      results.push(relative(base, full));
    }
  }
  return results;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function moveRecycleToDownloads(localPath: string): boolean {
  const srcPath = join(RECYCLE_DIR, localPath);
  if (!existsSync(srcPath)) return false;
  const destPath = join(DOWNLOADS_DIR, localPath);
  mkdirSync(dirname(destPath), { recursive: true });
  let finalPath = destPath;
  let counter = 1;
  while (existsSync(finalPath)) {
    const ext = extname(destPath);
    const base = basename(destPath, ext);
    const dir = dirname(destPath);
    finalPath = join(dir, `${base}_${counter}${ext}`);
    counter++;
  }
  renameSync(srcPath, finalPath);
  return true;
}

function moveDownloadsToRecycle(localPath: string): boolean {
  const srcPath = join(DOWNLOADS_DIR, localPath);
  if (!existsSync(srcPath)) return false;
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
  return true;
}

// ── Stats ────────────────────────────────────────────────

router.get('/stats', requireAdmin, (_req, res) => {
  const messages = loadMessages();
  let images = 0, videos = 0, files = 0;
  const now = new Date();
  const today = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  let todayMessages = 0;

  for (const msg of messages) {
    if (msg.datePath === today) todayMessages++;
    for (const seg of msg.segments) {
      if (seg.type === 'image') images++;
      else if (seg.type === 'video') videos++;
      else if (seg.type === 'file') files++;
    }
  }

  const downloadsBytes = dirSize(DOWNLOADS_DIR);
  const recycleBytes = dirSize(RECYCLE_DIR);
  const dataBytes = dirSize(DATA_DIR);

  const wsStatus = !config.wsUrl ? 'not_configured' : 'configured';

  res.json({
    messages: messages.length,
    images,
    videos,
    files,
    todayMessages,
    storage: {
      downloads: formatBytes(downloadsBytes),
      recycle: formatBytes(recycleBytes),
      data: formatBytes(dataBytes),
      total: formatBytes(downloadsBytes + recycleBytes + dataBytes),
    },
    wsStatus,
    wsUrl: config.wsUrl || null,
    groupId: config.groupId,
  });
});

// ── Config ───────────────────────────────────────────────

router.get('/config', requireAdmin, (_req, res) => {
  res.json({
    port: config.port,
    host: config.host,
    publicHost: config.publicHost,
    token: config.token,
    wsUrl: config.wsUrl,
    groupId: config.groupId,
    prod: config.prod,
    silent: config.silent,
  });
});

// ── Dates Detail ─────────────────────────────────────────

router.get('/dates-detail', requireAdmin, (_req, res) => {
  const messages = loadMessages();
  const dateMap: Record<string, { messages: number; images: number; videos: number; files: number }> = {};

  for (const msg of messages) {
    if (!dateMap[msg.datePath]) {
      dateMap[msg.datePath] = { messages: 0, images: 0, videos: 0, files: 0 };
    }
    dateMap[msg.datePath].messages++;
    for (const seg of msg.segments) {
      if (seg.type === 'image') dateMap[msg.datePath].images++;
      else if (seg.type === 'video') dateMap[msg.datePath].videos++;
      else if (seg.type === 'file') dateMap[msg.datePath].files++;
    }
  }

  const result = Object.entries(dateMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, stats]) => {
      const dateDir = join(DOWNLOADS_DIR, date);
      const size = dirSize(dateDir);
      return { date, ...stats, size: formatBytes(size), sizeBytes: size };
    });

  res.json(result);
});

// ── Recycle Bin ──────────────────────────────────────────

router.get('/recycle', requireAdmin, (_req, res) => {
  const files = walkFiles(RECYCLE_DIR);
  const result = files.map(f => {
    const absPath = join(RECYCLE_DIR, f);
    const stat = statSync(absPath);
    return { path: f, size: stat.size, sizeFormatted: formatBytes(stat.size) };
  });
  res.json(result);
});

router.post('/recycle/restore', requireAdmin, (req, res) => {
  const paths = req.body.paths as string[];
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'No paths provided' });
  }

  let restored = 0;
  for (const p of paths) {
    if (moveRecycleToDownloads(p)) restored++;
  }

  res.json({ ok: true, restored });
});

router.delete('/recycle', requireAdmin, (req, res) => {
  const paths = req.body.paths as string[];
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'No paths provided' });
  }

  let deleted = 0;
  for (const p of paths) {
    const absPath = join(RECYCLE_DIR, p);
    if (existsSync(absPath)) {
      unlinkSync(absPath);
      deleted++;
    }
  }

  // Clean empty directories
  cleanEmptyDirs(RECYCLE_DIR);

  res.json({ ok: true, deleted });
});

router.delete('/recycle/all', requireAdmin, (_req, res) => {
  if (!existsSync(RECYCLE_DIR)) return res.json({ ok: true, deleted: 0 });
  const files = walkFiles(RECYCLE_DIR);
  let deleted = 0;
  for (const f of files) {
    const absPath = join(RECYCLE_DIR, f);
    if (existsSync(absPath)) {
      unlinkSync(absPath);
      deleted++;
    }
  }
  cleanEmptyDirs(RECYCLE_DIR);
  res.json({ ok: true, deleted });
});

function cleanEmptyDirs(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const full = join(dir, entry.name);
      cleanEmptyDirs(full);
      try { rmdirSync(full); } catch {}
    }
  }
}

// ── Orphan Files ─────────────────────────────────────────

router.get('/orphans', requireAdmin, (_req, res) => {
  const messages = loadMessages();
  const referenced = new Set<string>();
  for (const msg of messages) {
    for (const seg of msg.segments) {
      if (seg.data?.localPath) referenced.add(seg.data.localPath);
    }
  }

  const allFiles = walkFiles(DOWNLOADS_DIR);
  const orphans = allFiles.filter(f => !referenced.has(f));

  res.json({ total: allFiles.length, orphans });
});

router.post('/orphans/clean', requireAdmin, (req, res) => {
  const paths = req.body.paths as string[];
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'No paths provided' });
  }

  let cleaned = 0;
  for (const p of paths) {
    if (moveDownloadsToRecycle(p)) cleaned++;
  }

  res.json({ ok: true, cleaned });
});

// ── Tag Management ───────────────────────────────────────

router.post('/tags/rename', requireAdmin, (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ error: 'oldName and newName required' });
  }
  if (oldName === newName) {
    return res.status(400).json({ error: 'Names are the same' });
  }

  const tagArr = loadTags();
  let count = 0;
  for (const entry of tagArr) {
    const idx = entry.tags.indexOf(oldName);
    if (idx >= 0) {
      if (!entry.tags.includes(newName)) {
        entry.tags[idx] = newName;
      } else {
        entry.tags.splice(idx, 1);
      }
      count++;
    }
  }

  saveTags(tagArr);
  res.json({ ok: true, count });
});

router.post('/tags/merge', requireAdmin, (req, res) => {
  const { sources, target } = req.body;
  if (!Array.isArray(sources) || sources.length === 0 || !target) {
    return res.status(400).json({ error: 'sources[] and target required' });
  }

  const tagArr = loadTags();
  let count = 0;
  for (const entry of tagArr) {
    let changed = false;
    const toRemove: string[] = [];
    for (const s of sources) {
      if (s === target) continue;
      const idx = entry.tags.indexOf(s);
      if (idx >= 0) {
        toRemove.push(s);
        changed = true;
      }
    }
    if (changed) {
      entry.tags = entry.tags.filter(t => !toRemove.includes(t));
      if (!entry.tags.includes(target)) entry.tags.push(target);
      count++;
    }
  }

  saveTags(tagArr);
  res.json({ ok: true, count });
});

router.delete('/tags/:tag', requireAdmin, (req, res) => {
  const tagName = req.params.tag as string;
  const tagArr = loadTags();
  let count = 0;

  for (const entry of tagArr) {
    const idx = entry.tags.indexOf(tagName);
    if (idx >= 0) {
      entry.tags.splice(idx, 1);
      count++;
    }
  }

  // Remove entries with empty tags
  const cleaned = tagArr.filter(e => e.tags.length > 0);
  saveTags(cleaned);
  res.json({ ok: true, count });
});

// ── Dedup (moved from dedup.ts) ──────────────────────────

router.get('/dedup/scan', requireAdmin, async (_req, res) => {
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

router.post('/dedup/delete', requireAdmin, (req, res) => {
  const paths = req.body.paths as string[];
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'No paths provided' });
  }

  const messages = loadMessages();
  const tagArr = loadTags();
  let deleted = 0;

  for (const localPath of paths) {
    if (moveDownloadsToRecycle(localPath)) {
      for (const msg of messages) {
        msg.segments = msg.segments.filter((s) => s.data?.localPath !== localPath);
      }
      removePathFromTags(tagArr, localPath);
      deleted++;
    }
  }

  const cleaned = messages.filter((m) => m.segments.length > 0);
  saveMessages(cleaned);
  saveTags(tagArr);

  res.json({ ok: true, deleted });
});

export default router;
