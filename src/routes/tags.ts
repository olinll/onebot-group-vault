import { Router } from 'express';
import {
  loadTags, saveTags, getTagsForPath, setTagsForPath, removePathFromTags,
} from '../store/messages.js';

const router = Router();

// Set tags for a single image
router.post('/', (req, res) => {
  const { localPath, tags } = req.body;
  if (!localPath || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'localPath and tags[] required' });
  }
  const tagArr = loadTags();
  const cleaned = tags.filter((t: string) => t && t.trim()).map((t: string) => t.trim());
  if (cleaned.length === 0) {
    removePathFromTags(tagArr, localPath);
  } else {
    setTagsForPath(tagArr, localPath, cleaned);
  }
  saveTags(tagArr);
  res.json({ ok: true, tags: cleaned });
});

// Batch set tags for multiple images
router.post('/batch', (req, res) => {
  const { localPaths, tags, mode } = req.body;
  if (!Array.isArray(localPaths) || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'localPaths[] and tags[] required' });
  }
  const cleanTags = tags.filter((t: string) => t && t.trim()).map((t: string) => t.trim());
  if (cleanTags.length === 0) {
    return res.status(400).json({ error: 'tags must not be empty' });
  }

  const tagArr = loadTags();
  const batchMode: 'add' | 'set' | 'remove' = mode === 'remove' ? 'remove' : mode === 'set' ? 'set' : 'add';

  for (const localPath of localPaths) {
    if (batchMode === 'set') {
      setTagsForPath(tagArr, localPath, [...cleanTags]);
    } else if (batchMode === 'remove') {
      const existing = getTagsForPath(tagArr, localPath);
      const filtered = existing.filter((t) => !cleanTags.includes(t));
      if (filtered.length === 0) {
        removePathFromTags(tagArr, localPath);
      } else {
        setTagsForPath(tagArr, localPath, filtered);
      }
    } else {
      // add
      const existing = getTagsForPath(tagArr, localPath);
      for (const t of cleanTags) {
        if (!existing.includes(t)) existing.push(t);
      }
      setTagsForPath(tagArr, localPath, existing);
    }
  }

  saveTags(tagArr);
  res.json({ ok: true, count: localPaths.length, mode: batchMode, tags: cleanTags });
});

// Get all tags with counts
router.get('/', (_req, res) => {
  const tagArr = loadTags();
  const tagCounts: Record<string, number> = {};
  for (const entry of tagArr) {
    for (const t of entry.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const result = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
  res.json(result);
});

// Get images for a specific tag
router.get('/:tag', (req, res) => {
  const tagArr = loadTags();
  const tagName = req.params.tag;
  const matched = tagArr.filter((e) => e.tags.includes(tagName)).map((e) => e.path);
  res.json({ tag: tagName, images: matched });
});

export default router;
