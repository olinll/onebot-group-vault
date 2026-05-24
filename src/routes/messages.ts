import { Router } from 'express';
import { loadMessages, loadTags, getTagsForPath } from '../store.js';

const router = Router();

router.get('/messages', (req, res) => {
  const messages = loadMessages();
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const date = req.query.date as string;
  const type = req.query.type as string;
  const tag = req.query.tag as string;

  let filtered = messages;
  if (date) filtered = filtered.filter((m) => m.datePath === date);
  if (type) filtered = filtered.filter((m) => m.segments.some((s) => s.type === type));

  const tagArr = loadTags();
  if (tag) {
    const taggedPaths = new Set(
      tagArr.filter((e) => e.tags.includes(tag)).map((e) => e.path),
    );
    filtered = filtered.filter((m) =>
      m.segments.some((s) => s.type === 'image' && taggedPaths.has(s.data.localPath)),
    );
  }

  filtered.sort((a, b) => b.time - a.time);
  const total = filtered.length;
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);

  for (const msg of items) {
    for (const seg of msg.segments) {
      if (seg.type === 'image' && seg.data.localPath) {
        seg.data.tags = getTagsForPath(tagArr, seg.data.localPath);
      }
    }
  }

  res.json({ total, page, limit, items });
});

router.get('/images', (req, res) => {
  const messages = loadMessages();
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const date = req.query.date as string;
  const tag = req.query.tag as string;
  const tagArr = loadTags();

  const images: any[] = [];
  for (const msg of messages) {
    if (date && msg.datePath !== date) continue;
    for (const seg of msg.segments) {
      if (seg.type === 'image' && seg.data.localPath) {
        const tags = getTagsForPath(tagArr, seg.data.localPath);
        if (tag && !tags.includes(tag)) continue;
        images.push({
          message_id: msg.message_id,
          user_id: msg.user_id,
          nickname: msg.nickname,
          time: msg.time,
          date: msg.date,
          datePath: msg.datePath,
          file: seg.data.file,
          localPath: seg.data.localPath,
          url: `/downloads/${seg.data.localPath}`,
          tags,
          owner: seg.data.owner || msg.user_id,
        });
      }
    }
  }

  images.sort((a, b) => b.time - a.time);
  const total = images.length;
  const start = (page - 1) * limit;
  const items = images.slice(start, start + limit);

  res.json({ total, page, limit, items });
});

router.get('/dates', (_req, res) => {
  const messages = loadMessages();
  const counts: Record<string, number> = {};
  for (const msg of messages) counts[msg.datePath] = (counts[msg.datePath] || 0) + 1;
  const dates = Object.entries(counts)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, count]) => ({ date, count }));
  res.json(dates);
});

export default router;
