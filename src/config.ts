import { readFileSync } from 'fs';
import { join } from 'path';
import type { Config } from './types.js';

const configPath = join(__dirname, '..', 'config.json');
const config: Config = JSON.parse(readFileSync(configPath, 'utf8'));

export default config;
