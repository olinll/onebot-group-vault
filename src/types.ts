// ── Config ────────────────────────────────────────────────

export interface Config {
  port: number;
  host: string;
  publicHost: string;
  token: string;
  wsUrl: string;
  groupId: number;
  prod: boolean;
  silent?: boolean;
}

// ── Messages ──────────────────────────────────────────────

export interface MessageSegment {
  type: string;
  data: Record<string, any>;
}

export interface MessageRecord {
  message_id: number;
  group_id: number;
  groupName?: string;
  user_id: number;
  nickname: string;
  time: number;
  date: string;
  datePath: string;
  segments: MessageSegment[];
}

export interface TagEntry {
  path: string;
  tags: string[];
}

// ── Adapter (message source / sender) ─────────────────────

export interface Segment {
  type: string;
  data: Record<string, any>;
}

export interface GroupMessageEvent {
  message_id: number;
  group_id: number;
  user_id: number;
  nickname: string;
  time: number;
  message: Segment[];
  sender?: { nickname?: string };
  post_type?: string;
  message_type?: string;
}

export interface MessageSender {
  name: string;
  sendGroupMsg(groupId: number, message: Segment[]): Promise<any>;
  getGroupName(groupId: number): Promise<string>;
}

export interface MessageSource {
  name: string;
  connect(): void;
  onMessage(handler: (event: GroupMessageEvent) => Promise<void>): void;
  disconnect(): void;
}

// ── Internal ──────────────────────────────────────────────

export interface PendingTagSession {
  localPath: string;
  timer: ReturnType<typeof setTimeout>;
  message_id: number;
}
