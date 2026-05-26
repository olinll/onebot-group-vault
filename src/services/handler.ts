import { existsSync, mkdirSync } from 'fs';
import { join, resolve, extname } from 'path';
import crypto from 'crypto';
import config from '../core/config.js';
import {
  loadMessages, saveMessages, loadTags, saveTags,
  getTagsForPath, setTagsForPath,
} from '../store/messages.js';
import { getDatePath, downloadFile, getImageDimensions, getUniqueFilename } from '../core/helpers.js';
import type { PendingTagSession, MessageSender, GroupMessageEvent } from '../core/types.js';

const DOWNLOADS_DIR = join(__dirname, '..', '..', 'storage', 'downloads');
const pendingTags = new Map<number, PendingTagSession>();

// ── Message Handler (pure business logic) ─────────────────

export function createMessageHandler(sender: MessageSender) {
  return async (event: GroupMessageEvent): Promise<void> => {
    const textSeg = (event.message || []).find((s) => s.type === 'text');
    const text: string = textSeg?.data?.text?.trim() || '';
    const isTargetGroup = event.group_id === config.groupId;

    if (!config.prod) console.log(`[MSG] group=${event.group_id} user=${event.user_id} text="${text}"`);

    // ── Silent mode: collect from all groups ──
    if (config.silent) {
      const groupName = await sender.getGroupName(event.group_id);
      await processMessage(event, groupName, sender);
    }

    // ── #tag command: works in ALL groups ──────────────────
    if (text.startsWith('#') && text.length > 1) {
      if (text === '#tags' || text === '#标签') {
        const tagArr = loadTags();
        const tagCounts: Record<string, number> = {};
        for (const entry of tagArr) {
          for (const t of entry.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
        const list = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => `${tag}(${count})`)
          .join('\n');
        await sender.sendGroupMsg(event.group_id, [
          { type: 'text', data: { text: list ? `标签列表:\n${list}` : '暂无标签' } },
        ]);
        return;
      }

      const match = text.slice(1).trim().match(/^(.+?)(?:\s+(\d+))?$/);
      if (match) {
        const tagName = match[1].trim();
        const index = match[2] ? parseInt(match[2]) : null;

        const tagArr = loadTags();
        const matchedPaths = tagArr.filter((e) => e.tags.includes(tagName)).map((e) => e.path);

        if (matchedPaths.length === 0) {
          await sender.sendGroupMsg(event.group_id, [
            { type: 'text', data: { text: `未找到标签「${tagName}」的图片` } },
          ]);
          return;
        }

        const shuffled = [...matchedPaths];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const toSend = index !== null ? shuffled.slice(0, Math.max(1, index)) : shuffled.slice(0, 5);

        for (const localPath of toSend) {
          const absPath = resolve(DOWNLOADS_DIR, localPath);
          if (existsSync(absPath)) {
            await sender.sendGroupMsg(event.group_id, [
              { type: 'image', data: { file: `http://${config.publicHost}:${config.port}/downloads/${localPath}` } },
            ]);
          }
        }
        if (!config.prod) console.log(`[TAG] Sent ${toSend.length} image(s) for #${tagName}${index ? ` (${index})` : ''}`);
      }
      return;
    }

    // ── Collect: non-silent mode, target group only ──
    if (!config.silent && isTargetGroup) {
      const groupName = await sender.getGroupName(event.group_id);
      await processMessage(event, groupName, sender);
    }

    // ── Interactive tag session: only in target group ───────
    if (!isTargetGroup) return;

    const pending = pendingTags.get(event.user_id);
    if (pending) {
      if (text === '取消') {
        clearTimeout(pending.timer);
        pendingTags.delete(event.user_id);
        await sender.sendGroupMsg(event.group_id, [{ type: 'text', data: { text: '已取消标签操作' } }]);
        return;
      }
      if (text && !text.startsWith('#')) {
        const newTags = text.split(/\s+/).filter((t) => t);
        const tagArr = loadTags();
        const existing = getTagsForPath(tagArr, pending.localPath);
        for (const t of newTags) {
          if (!existing.includes(t)) existing.push(t);
        }
        setTagsForPath(tagArr, pending.localPath, existing);
        saveTags(tagArr);
        clearTimeout(pending.timer);
        pendingTags.delete(event.user_id);
        await sender.sendGroupMsg(event.group_id, [
          { type: 'text', data: { text: `已添加标签: ${newTags.join(', ')}` } },
        ]);
        if (!config.prod) console.log(`[TAG] Added tags ${newTags} to ${pending.localPath}`);
        return;
      }
      return;
    }

    // Image message: prompt for tagging
    const imgSeg = (event.message || []).find((s) => s.type === 'image');
    if (imgSeg) {
      setTimeout(async () => {
        const messages = loadMessages();
        const msg = messages.find((m) => m.message_id === event.message_id);
        if (!msg) return;
        const savedImg = msg.segments.find((s) => s.type === 'image' && s.data.localPath);
        if (!savedImg) return;

        const existing = pendingTags.get(event.user_id);
        if (existing) clearTimeout(existing.timer);

        const timer = setTimeout(() => {
          pendingTags.delete(event.user_id);
          if (!config.prod) console.log(`[TAG] Timeout for user ${event.user_id}`);
        }, 5 * 60 * 1000);

        pendingTags.set(event.user_id, {
          localPath: savedImg.data.localPath,
          timer,
          message_id: event.message_id,
        });

        const tagArr = loadTags();
        const existingTags = getTagsForPath(tagArr, savedImg.data.localPath);
        const prompt = existingTags.length
          ? `该图片已自动添加标签 ${existingTags.join('、')}，可发送新标签追加（5分钟内有效，发送「取消」放弃）`
          : '检测到图片，请发送标签名称（5分钟内有效，发送「取消」放弃）';
        await sender.sendGroupMsg(event.group_id, [{ type: 'text', data: { text: prompt } }]);
      }, 1000);
    }
  };
}

// ── Forward Message Extraction (recursive) ────────────────

async function extractForward(
  segData: Record<string, any>,
  sender: MessageSender | undefined,
  userId: number,
  saveDir: string,
  datePath: string,
  depth: number,
): Promise<{ segments: { type: string; data: Record<string, any> }[]; imgCount: number; maxDepth: number }> {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    if (!config.prod) console.log(`[FWD] Max depth ${MAX_DEPTH} reached, stopping recursion`);
    return { segments: [], imgCount: 0, maxDepth: depth };
  }

  let nested: any[] | undefined = segData?.content || segData?.messages;
  const forwardId = segData?.id || segData?.message_id;

  if ((!nested || nested.length === 0) && forwardId && sender?.getForwardMsg) {
    if (!config.prod) console.log(`[FWD] depth=${depth} Fetching forward id=${forwardId}`);
    const result = await sender.getForwardMsg(forwardId);
    nested = result?.messages;
  }

  if (!nested || nested.length === 0) {
    if (!config.prod) console.log(`[FWD] depth=${depth} No nested messages, keys: ${Object.keys(segData || {}).join(',')}`);
    return { segments: [], imgCount: 0, maxDepth: depth };
  }

  const flat: { type: string; data: Record<string, any> }[] = [];
  let imgCount = 0;
  let maxDepth = depth;

  for (const child of nested) {
    const parts: any[] = child.message || [];
    const nickname = child.sender?.nickname || '';

    for (const part of parts) {
      if (part.type === 'forward') {
        // Recurse into nested forward
        const sub = await extractForward(part.data, sender, userId, saveDir, datePath, depth + 1);
        flat.push(...sub.segments);
        imgCount += sub.imgCount;
        maxDepth = Math.max(maxDepth, sub.maxDepth);
      } else if (part.type === 'image' && part.data?.url) {
        try {
          const ext = extname(part.data.file || '.png') || '.png';
          const rand = crypto.randomBytes(4).toString('hex');
          const filename = getUniqueFilename(saveDir, `fwd_${userId}_${rand}${ext}`);
          const dest = join(saveDir, filename);
          await downloadFile(part.data.url, dest);
          flat.push({
            type: 'image',
            data: { file: part.data.file, localPath: `${datePath}/${filename}`, owner: userId, fromForward: true },
          });
          imgCount++;
          if (!config.prod) console.log(`[FWD] depth=${depth} Saved image: ${datePath}/${filename}`);
        } catch (err: any) {
          console.error(`[FWD] depth=${depth} Image download failed: ${err.message}`);
        }
      } else if (part.type === 'text' && part.data?.text) {
        flat.push({
          type: 'text',
          data: { text: (nickname ? nickname + ': ' : '') + part.data.text, fromForward: true },
        });
      } else if (part.type === 'video' && part.data?.url) {
        try {
          const ext = extname(part.data.file || '.mp4') || '.mp4';
          const rand = crypto.randomBytes(4).toString('hex');
          const filename = getUniqueFilename(saveDir, `fwd_${userId}_${rand}${ext}`);
          const dest = join(saveDir, filename);
          await downloadFile(part.data.url, dest);
          flat.push({
            type: 'video',
            data: { localPath: `${datePath}/${filename}`, fromForward: true },
          });
          if (!config.prod) console.log(`[FWD] depth=${depth} Saved video: ${datePath}/${filename}`);
        } catch (err: any) {
          console.error(`[FWD] depth=${depth} Video download failed: ${err.message}`);
        }
      }
    }
  }

  return { segments: flat, imgCount, maxDepth };
}

// ── Message Processing ────────────────────────────────────

export async function processMessage(event: GroupMessageEvent, groupName?: string, sender?: MessageSender): Promise<void> {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;

  const messages = loadMessages();
  if (messages.some((m) => m.message_id === event.message_id)) return;

  const datePath = getDatePath(event.time);
  const saveDir = join(DOWNLOADS_DIR, datePath);
  mkdirSync(saveDir, { recursive: true });

  const msgRecord = {
    message_id: event.message_id,
    group_id: event.group_id,
    groupName: groupName || '',
    user_id: event.user_id,
    nickname: event.sender?.nickname || event.nickname || '',
    time: event.time,
    date: new Date(event.time * 1000).toISOString(),
    datePath,
    segments: [] as { type: string; data: Record<string, any> }[],
  };

  // Process segments sequentially to preserve order (forward downloads are async)
  const rawSegments: { type: string; data: Record<string, any> }[][] = [];
  for (const seg of (event.message || [])) {
    const segment: { type: string; data: Record<string, any> } = { type: seg.type, data: {} };

    switch (seg.type) {
      case 'text':
        segment.data.text = seg.data.text;
        rawSegments.push([segment]);
        break;

      case 'image':
        segment.data.file = seg.data.file;
        segment.data.url = seg.data.url;
        segment.data.subType = seg.data.subType;
        if (seg.data.url) {
          try {
            const ext = extname(seg.data.file || '.png') || '.png';
            const rand = crypto.randomBytes(4).toString('hex');
            const filename = getUniqueFilename(saveDir, `img_${event.user_id}_${rand}${ext}`);
            const dest = join(saveDir, filename);
            await downloadFile(seg.data.url, dest);
            segment.data.localPath = `${datePath}/${filename}`;
            segment.data.owner = event.user_id;
            if (!config.prod) console.log(`[IMG] Saved: ${segment.data.localPath}`);

            const autoTags: string[] = [];
            if (ext.toLowerCase() === '.gif') autoTags.push('表情包');
            const dims = getImageDimensions(dest);
            if (dims) {
              if (dims.width <= 300 && dims.height <= 300) autoTags.push('表情包');
              const ratio = Math.min(dims.width, dims.height) / Math.max(dims.width, dims.height);
              if (ratio >= 0.85) autoTags.push('表情包');
            }
            if (autoTags.length) {
              const tagArr = loadTags();
              const existing = getTagsForPath(tagArr, segment.data.localPath);
              for (const t of autoTags) {
                if (!existing.includes(t)) existing.push(t);
              }
              setTagsForPath(tagArr, segment.data.localPath, existing);
              saveTags(tagArr);
              if (!config.prod) console.log(`[AUTO-TAG] ${autoTags.join(',')} → ${segment.data.localPath}`);
            }
          } catch (err: any) {
            console.error(`[IMG] Download failed: ${err.message}`);
          }
        }
        rawSegments.push([segment]);
        break;

      case 'file':
        segment.data.file = seg.data.file;
        segment.data.url = seg.data.url;
        segment.data.file_id = seg.data.file_id;
        if (seg.data.url) {
          try {
            const origName = seg.data.file || `file_${event.message_id}`;
            const filename = getUniqueFilename(saveDir, origName);
            const dest = join(saveDir, filename);
            await downloadFile(seg.data.url, dest);
            segment.data.localPath = `${datePath}/${filename}`;
            if (!config.prod) console.log(`[FILE] Saved: ${segment.data.localPath}`);
          } catch (err: any) {
            console.error(`[FILE] Download failed: ${err.message}`);
          }
        }
        rawSegments.push([segment]);
        break;

      case 'video':
        segment.data.file = seg.data.file;
        segment.data.url = seg.data.url;
        if (seg.data.url) {
          try {
            const ext = extname(seg.data.file || '.mp4') || '.mp4';
            const rand = crypto.randomBytes(4).toString('hex');
            const filename = getUniqueFilename(saveDir, `vid_${event.user_id}_${rand}${ext}`);
            const dest = join(saveDir, filename);
            await downloadFile(seg.data.url, dest);
            segment.data.localPath = `${datePath}/${filename}`;
            if (!config.prod) console.log(`[VIDEO] Saved: ${segment.data.localPath}`);
          } catch (err: any) {
            console.error(`[VIDEO] Download failed: ${err.message}`);
          }
        }
        rawSegments.push([segment]);
        break;

      case 'forward': {
        const forwardId = seg.data?.id || seg.data?.message_id;
        const result = await extractForward(seg.data, sender, event.user_id, saveDir, datePath, 0);
        if (!config.prod) console.log(`[FWD] id=${forwardId} → ${result.segments.length} segments (${result.imgCount} images, depth=${result.maxDepth})`);
        rawSegments.push(result.segments);
        break;
      }
      case 'at': segment.data.qq = seg.data.qq; segment.data.name = seg.data.name; rawSegments.push([segment]); break;
      case 'face': segment.data.id = seg.data.id; rawSegments.push([segment]); break;
      case 'reply': segment.data.id = seg.data.id; rawSegments.push([segment]); break;
      default: segment.data = seg.data; rawSegments.push([segment]); break;
    }
  }

  msgRecord.segments = rawSegments.flat();

  const hasMedia = msgRecord.segments.some((s) =>
    ['image', 'file', 'video', 'forward'].includes(s.type),
  );
  if (hasMedia) {
    messages.push(msgRecord);
    saveMessages(messages);
    if (!config.prod) console.log(`[MSG] ${msgRecord.nickname}(${msgRecord.user_id}): ${msgRecord.segments.length} segments`);
  }
}
