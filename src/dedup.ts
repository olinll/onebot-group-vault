import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import sharp from 'sharp';

const DOWNLOADS_DIR = join(__dirname, '..', 'storage', 'downloads');

export interface ImageInfo {
  path: string;
  size: number;
  md5: string;
  phash: string;
  width: number;
  height: number;
}

export interface DupGroup {
  images: ImageInfo[];
}

// ── MD5 file hash ─────────────────────────────────────────

export function fileMd5(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('md5').update(buf).digest('hex');
}

// ── Perceptual hash (pHash) ───────────────────────────────
// Resize to 9x8 grayscale, compute horizontal DCT-like difference hash

export async function perceptualHash(filePath: string): Promise<string> {
  const { data, info } = await sharp(filePath)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      if (left > right) {
        hash |= 1n << BigInt(row * 8 + col);
      }
    }
  }

  return hash.toString(16).padStart(16, '0');
}

// ── Hamming distance between two hex hash strings ─────────

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

// ── Get image dimensions via sharp ────────────────────────

async function getImageInfo(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(filePath).metadata();
    if (meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch {}
  return null;
}

// ── Find duplicates ───────────────────────────────────────

export async function findDuplicates(
  imagePaths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<DupGroup[]> {
  const images: ImageInfo[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const relPath = imagePaths[i];
    const absPath = join(DOWNLOADS_DIR, relPath);
    try {
      const stat = statSync(absPath);
      const md5 = fileMd5(absPath);
      const phash = await perceptualHash(absPath);
      const dims = await getImageInfo(absPath);
      images.push({
        path: relPath,
        size: stat.size,
        md5,
        phash,
        width: dims?.width ?? 0,
        height: dims?.height ?? 0,
      });
    } catch {
      // skip unreadable files
    }
    if (onProgress) onProgress(i + 1, imagePaths.length);
  }

  // Group by MD5 first (exact duplicates)
  const md5Groups = new Map<string, ImageInfo[]>();
  for (const img of images) {
    const arr = md5Groups.get(img.md5) || [];
    arr.push(img);
    md5Groups.set(img.md5, arr);
  }

  // Collect groups with >1 member (exact dupes)
  const groups: DupGroup[] = [];
  const used = new Set<string>();

  for (const [, imgs] of md5Groups) {
    if (imgs.length > 1) {
      groups.push({ images: imgs });
      for (const img of imgs) used.add(img.path);
    }
  }

  // Merge similar images by pHash (only among unused images)
  const remaining = images.filter((img) => !used.has(img.path));
  const pHashUsed = new Set<string>();

  for (let i = 0; i < remaining.length; i++) {
    if (pHashUsed.has(remaining[i].path)) continue;
    const group: ImageInfo[] = [remaining[i]];
    pHashUsed.add(remaining[i].path);

    for (let j = i + 1; j < remaining.length; j++) {
      if (pHashUsed.has(remaining[j].path)) continue;
      if (hammingDistance(remaining[i].phash, remaining[j].phash) <= 5) {
        group.push(remaining[j]);
        pHashUsed.add(remaining[j].path);
      }
    }

    if (group.length > 1) {
      groups.push({ images: group });
    }
  }

  return groups;
}
