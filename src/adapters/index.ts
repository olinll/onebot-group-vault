import type { Config, MessageSource, MessageSender } from '../types.js';
import { NapCatAdapter } from './napcat.js';

export type MessageAdapter = MessageSource & MessageSender;

export function createAdapter(config: Config): MessageAdapter {
  return new NapCatAdapter(config);
}
