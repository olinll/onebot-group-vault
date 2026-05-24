import { existsSync, mkdirSync } from 'fs';
import { join, resolve, extname } from 'path';
import crypto from 'crypto';
import config from './config.js';
import {
  loadMessages, saveMessages, loadTags, saveTags,
  getTagsForPath, setTagsForPath,
} from './store.js';
import { getDatePath, downloadFile, getImageDimensions, getUniqueFilename } from './helpers.js';
import type { PendingTagSession, MessageSender, GroupMessageEvent } from './types.js';

const DOWNLOADS_DIR = join(__dirname, '..', 'storage', 'downloads');
const pendingTags = new Map<number, PendingTagSession>();

// ── Message Handler (pure business logic) ─────────────────

export function createMessageHandler(sender: MessageSender) {
  return async (event: GroupMessageEvent): Promise<void> => {
    const textSeg = (event.message || []).find((s) => s.type === 'text');
    const text: string = textSeg?.data?.text?.trim() || '';
    const isTargetGroup = event.group_id === config.groupId;

    if (!config.prod) console.log(`[MSG] group=${event.group_id} user=${event.user_id} text="${text}"`);

    // ── Silent mode: only collect images, no responses ─────
    if (config.silent) {
      if (isTargetGroup) await processMessage(event);
      return;
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

        let toSend: string[];
        if (index !== null) {
          if (index < 1) {
            await sender.sendGroupMsg(event.group_id, [
              { type: 'text', data: { text: '索引从 1 开始' } },
            ]);
            return;
          }
          toSend = index > matchedPaths.length ? matchedPaths : [matchedPaths[index - 1]];
        } else {
          const shuffled = [...matchedPaths];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          toSend = shuffled.slice(0, 5);
        }

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

    // ── Below: only process in target group ────────────────
    if (!isTargetGroup) return;

    await processMessage(event);

    // Interactive tag session
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

// ── Message Processing ────────────────────────────────────

export async function processMessage(event: GroupMessageEvent): Promise<void> {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;
  if (event.group_id !== config.groupId) return;

  const messages = loadMessages();
  if (messages.some((m) => m.message_id === event.message_id)) return;

  const datePath = getDatePath(event.time);
  const saveDir = join(DOWNLOADS_DIR, datePath);
  mkdirSync(saveDir, { recursive: true });

  const msgRecord = {
    message_id: event.message_id,
    group_id: event.group_id,
    user_id: event.user_id,
    nickname: event.sender?.nickname || event.nickname || '',
    time: event.time,
    date: new Date(event.time * 1000).toISOString(),
    datePath,
    segments: [] as { type: string; data: Record<string, any> }[],
  };

  const segmentPromises = (event.message || []).map(async (seg) => {
    const segment: { type: string; data: Record<string, any> } = { type: seg.type, data: {} };

    switch (seg.type) {
      case 'text':
        segment.data.text = seg.data.text;
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
        break;

      case 'forward': segment.data.id = seg.data.id; break;
      case 'at': segment.data.qq = seg.data.qq; segment.data.name = seg.data.name; break;
      case 'face': segment.data.id = seg.data.id; break;
      case 'reply': segment.data.id = seg.data.id; break;
      default: segment.data = seg.data; break;
    }

    return segment;
  });

  msgRecord.segments = await Promise.all(segmentPromises);

  const hasMedia = msgRecord.segments.some((s) =>
    ['image', 'file', 'forward'].includes(s.type),
  );
  if (hasMedia) {
    messages.push(msgRecord);
    saveMessages(messages);
    if (!config.prod) console.log(`[MSG] ${msgRecord.nickname}(${msgRecord.user_id}): ${msgRecord.segments.length} segments`);
  }
}
