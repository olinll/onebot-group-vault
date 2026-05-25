import express from 'express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import config from './core/config.js';
import { createAdapter } from './adapters/index.js';
import { createMessageHandler } from './services/handler.js';
import { authMiddleware } from './services/auth.js';
import { ensureDefaultAdmin } from './store/users.js';
import authRouter from './routes/auth.js';
import tagsRouter from './routes/tags.js';
import messagesRouter from './routes/messages.js';
import filesRouter from './routes/files.js';
import uploadRouter from './routes/upload.js';
import dedupRouter from './routes/dedup.js';

const DOWNLOADS_DIR = join(__dirname, '..', 'storage', 'downloads');
const RECYCLE_DIR = join(__dirname, '..', 'storage', 'recycle');

mkdirSync(DOWNLOADS_DIR, { recursive: true });
mkdirSync(RECYCLE_DIR, { recursive: true });

ensureDefaultAdmin();

const app = express();
app.use(express.json());

// Public auth routes (no auth required)
app.use('/api/auth', authRouter);

// Protected API routes (auth required)
app.use('/api/tags', authMiddleware, tagsRouter);
app.use('/api', authMiddleware, messagesRouter);
app.use('/api/files', authMiddleware, filesRouter);
app.use('/api/upload', authMiddleware, uploadRouter);
app.use('/api/dedup', authMiddleware, dedupRouter);

// Page routes (before static to avoid express.static intercepting)
app.get('/upload', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'upload.html'));
});

app.get('/dedup', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'dedup.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// Static files
app.use('/downloads', express.static(DOWNLOADS_DIR));
app.use(express.static(join(__dirname, 'public')));

// Start
app.listen(config.port, config.host, () => {
  console.log(`Server listening on ${config.host}:${config.port}`);
  console.log(`WebUI: http://${config.host}:${config.port}`);
  console.log(`Target group: ${config.groupId}`);

  if (config.wsUrl) {
    const adapter = createAdapter(config);
    const handler = createMessageHandler(adapter);
    adapter.onMessage(handler);
    adapter.connect();
    console.log(`Adapter: ${adapter.name} → ${config.wsUrl}`);
  }
});
