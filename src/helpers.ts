import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, unlinkSync } from 'fs';
import { dirname, extname, basename, join } from 'path';
import http from 'http';
import https from 'https';

export function getDatePath(timestamp?: number): string {
  const d = timestamp ? new Date(timestamp * 1000) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

export function downloadFile(url: string, destPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('No URL'));
    mkdirSync(dirname(destPath), { recursive: true });
    const client = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);
    client
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          try { unlinkSync(destPath); } catch {}
          return downloadFile(res.headers.location!, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          try { unlinkSync(destPath); } catch {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(destPath);
        });
      })
      .on('error', (err) => {
        file.close();
        if (existsSync(destPath)) try { unlinkSync(destPath); } catch {}
        reject(err);
      });
  });
}

export function getImageDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.alloc(24);
    const fd = openSync(filePath, 'r');
    readSync(fd, buf, 0, 24, 0);
    closeSync(fd);

    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const fullBuf = readFileSync(filePath);
      let offset = 2;
      while (offset < fullBuf.length - 1) {
        if (fullBuf[offset] !== 0xff) break;
        const marker = fullBuf[offset + 1];
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          return {
            width: fullBuf.readUInt16BE(offset + 7),
            height: fullBuf.readUInt16BE(offset + 5),
          };
        }
        const len = fullBuf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  } catch {}
  return null;
}

export function getUniqueFilename(dir: string, filename: string): string {
  let finalName = filename;
  let counter = 1;
  while (existsSync(join(dir, finalName))) {
    const ext = extname(filename);
    const base = basename(filename, ext);
    finalName = `${base}_${counter}${ext}`;
    counter++;
  }
  return finalName;
}
