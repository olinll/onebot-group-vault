import WebSocket from 'ws';
import type { Config, MessageSource, MessageSender, GroupMessageEvent, Segment } from '../types.js';

export class NapCatAdapter implements MessageSource, MessageSender {
  readonly name = 'napcat-ws';

  private ws: WebSocket | null = null;
  private wsReady = false;
  private apiCallId = 0;
  private pendingApiCalls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private messageHandler: ((event: GroupMessageEvent) => Promise<void>) | null = null;

  constructor(private config: Config) {}

  connect(): void {
    if (!this.config.wsUrl) return;

    const wsUrl = `${this.config.wsUrl}?access_token=${encodeURIComponent(this.config.token)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.wsReady = true;
      console.log(`[WS] Connected to ${this.config.wsUrl}`);
    });

    this.ws.on('message', (raw) => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }

      if (data.echo !== undefined && this.pendingApiCalls.has(data.echo)) {
        const { resolve } = this.pendingApiCalls.get(data.echo)!;
        this.pendingApiCalls.delete(data.echo);
        return resolve(data);
      }

      if (data.post_type === 'message' && data.message_type === 'group') {
        if (this.messageHandler) this.messageHandler(data);
      }
    });

    this.ws.on('close', () => {
      this.wsReady = false;
      console.log('[WS] Disconnected, reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (err: Error) => {
      if (!this.config.prod) console.error('[WS] Error:', err.message);
    });
  }

  onMessage(handler: (event: GroupMessageEvent) => Promise<void>): void {
    this.messageHandler = handler;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
      this.wsReady = false;
    }
  }

  private wsSendApi(action: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.wsReady) return reject(new Error('WS not connected'));
      const echo = ++this.apiCallId;
      this.pendingApiCalls.set(echo, { resolve, reject });
      this.ws!.send(JSON.stringify({ action, params, echo }));
      setTimeout(() => {
        if (this.pendingApiCalls.has(echo)) {
          this.pendingApiCalls.delete(echo);
          reject(new Error('API call timeout'));
        }
      }, 10_000);
    });
  }

  async sendGroupMsg(groupId: number, message: Segment[]): Promise<any> {
    try {
      const res = await this.wsSendApi('send_group_msg', { group_id: groupId, message });
      if (!this.config.prod) console.log('[WS] send_group_msg result:', JSON.stringify(res));
      return res;
    } catch (err: any) {
      console.error('[WS] send_group_msg failed:', err.message);
    }
  }
}
