/**
 * WebSocket 客户端单例。
 * 管理连接生命周期、自动重连、消息收发。
 */

const WS_URL = `ws://${window.location.hostname}:8080`;
const RECONNECT_DELAY = 3000;

type MessageHandler = (payload: any) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  /** 缓存最后一条消息（解决页面跳转后新组件收不到的问题） */
  private lastMessage = new Map<string, any>();

  /** 连接 */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.intentionalClose = false;
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] 已连接');
        this.connected = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.dispatch(msg.type, msg.payload);
        } catch (e) {
          console.error('[WS] 消息解析失败', e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log('[WS] 连接断开');
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WS] 错误', err);
        reject(err);
      };
    });
  }

  /** 断开连接 */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  /** 发送消息 */
  send(type: string, payload: Record<string, unknown> = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WS] 未连接，无法发送', type);
    }
  }

  /** 订阅消息类型 */
  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // 如果有缓存，立即调用新 handler
    const cached = this.lastMessage.get(type);
    if (cached !== undefined) {
      try { handler(cached); } catch (e) { console.error('[WS] 缓存 handler 错误:', e); }
    }

    // 返回取消订阅函数
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this.connected;
  }

  private dispatch(type: string, payload: any): void {
    // 缓存关键消息
    const cacheTypes = ['room_created', 'room_joined', 'game_started', 'game_state', 'room_updated'];
    if (cacheTypes.includes(type)) {
      this.lastMessage.set(type, payload);
    }
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (e) {
          console.error(`[WS] handler 错误 (${type}):`, e);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`[WS] ${RECONNECT_DELAY}ms 后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, RECONNECT_DELAY);
  }
}

// 单例导出
export const wsClient = new WSClient();
