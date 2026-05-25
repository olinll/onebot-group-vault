import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { MessageRecord, TagEntry } from '../core/types.js';

const DATA_DIR = join(__dirname, '..', '..', 'storage', 'data');
const MESSAGES_FILE = join(DATA_DIR, 'messages.json');
const TAGS_FILE = join(DATA_DIR, 'tags.json');

mkdirSync(DATA_DIR, { recursive: true });

// ── Generic JSON ──────────────────────────────────────────

function loadJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJSON(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Messages ──────────────────────────────────────────────

export function loadMessages(): MessageRecord[] {
  return loadJSON(MESSAGES_FILE, []);
}

export function saveMessages(msgs: MessageRecord[]): void {
  saveJSON(MESSAGES_FILE, msgs);
}

// ── Tags (array format [{path, tags[]}]) ──────────────────

export function loadTags(): TagEntry[] {
  const raw = loadJSON<any>(TAGS_FILE, []);
  if (!Array.isArray(raw)) {
    const arr: TagEntry[] = Object.entries(raw).map(([path, tags]) => ({
      path,
      tags: tags as string[],
    }));
    if (arr.length) saveJSON(TAGS_FILE, arr);
    return arr;
  }
  return raw;
}

export function saveTags(tags: TagEntry[]): void {
  saveJSON(TAGS_FILE, tags);
}

export function getTagsForPath(tagArr: TagEntry[], localPath: string): string[] {
  const entry = tagArr.find((t) => t.path === localPath);
  return entry ? entry.tags : [];
}

export function setTagsForPath(
  tagArr: TagEntry[],
  localPath: string,
  tags: string[],
): void {
  const idx = tagArr.findIndex((t) => t.path === localPath);
  if (idx >= 0) {
    tagArr[idx].tags = tags;
  } else {
    tagArr.push({ path: localPath, tags });
  }
}

export function removePathFromTags(tagArr: TagEntry[], localPath: string): void {
  const idx = tagArr.findIndex((t) => t.path === localPath);
  if (idx >= 0) tagArr.splice(idx, 1);
}
