import express from 'express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import config from './config.js';
import { createAdapter } from './adapters/index.js';
import { createMessageHandler } from './handler.js';
import tagsRouter from './routes/tags.js';
import messagesRouter from './routes/messages.js';
import filesRouter from './routes/files.js';
import uploadRouter from './routes/upload.js';
import dedupRouter from './routes/dedup.js';

const DOWNLOADS_DIR = join(__dirname, '..', 'storage', 'downloads');
const RECYCLE_DIR = join(__dirname, '..', 'storage', 'recycle');

mkdirSync(DOWNLOADS_DIR, { recursive: true });
mkdirSync(RECYCLE_DIR, { recursive: true });

const app = express();
app.use(express.json());

// API routes
app.use('/api/tags', tagsRouter);
app.use('/api', messagesRouter);
app.use('/api/files', filesRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/dedup', dedupRouter);

// Static files
app.use('/downloads', express.static(DOWNLOADS_DIR));
app.use(express.static(join(__dirname, '..', 'webui')));

// Page routes
app.get('/upload', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'webui', 'upload.html'));
});

app.get('/dedup', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'webui', 'dedup.html'));
});

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
