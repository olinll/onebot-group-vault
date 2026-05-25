import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import crypto from 'crypto';
import type { Config } from './types.js';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const config: Config = {
  port: parseInt(process.env.PORT || '6100'),
  host: process.env.HOST || '0.0.0.0',
  publicHost: process.env.PUBLIC_HOST || 'localhost',
  token: process.env.TOKEN || '',
  wsUrl: process.env.WS_URL || '',
  groupId: parseInt(process.env.GROUP_ID || '0'),
  prod: process.env.PROD === 'true',
  silent: process.env.SILENT === 'true',
  jwtSecret,
};

export default config;
