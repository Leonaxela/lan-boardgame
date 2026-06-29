import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { GameType } from '@lan-boardgame/shared';
import { GO_COLORS } from '@lan-boardgame/go';
import { GOMOKU_COLORS } from '@lan-boardgame/gomoku';
import { Dispatcher } from './Dispatcher.js';
import { RoomManager } from '../room/RoomManager.js';
import { Room, RoomPlayer, RoomActivity } from '../room/Room.js';
import { ChatHandler } from '../chat/ChatHandler.js';
import { upsertUserSession, removeUserSession, saveActiveRoom, removeActiveRoom, logRoomDestroyed } from '../room/RoomPersistence.js';
import { execute } from '../db/connection.js';
import { handleEmojiMessage, handleEmojiDisconnect } from '../emoji/EmojiGameManager.js';

const HEARTBEAT_INTERVAL = 30000;

export class GameWSServer {
  private wss: WSServer;
  private dispatcher: Dispatcher;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private onlineTimer: NodeJS.Timeout | null = null;
  /** 待销毁的房间（房主断线30秒倒计时） */
  private pendingDestruction = new Map<string, NodeJS.Timeout>();

  constructor(
    private httpServer: HttpServer,
    private roomManager: RoomManager,
    chatHandler: ChatHandler,
  ) {
    this.dispatcher = new Dispatcher(roomManager, chatHandler, this);

    this.wss = new WSServer({ server: httpServer });
    this.setup();
  }

  private setup(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] 新连接');

      // 记录连接开始时间，用于统计在线时长
      (ws as any)._connectAt = Date.now();
      (ws as any)._username = null;

      // 标记为存活
      (ws as any).isAlive = true;

      ws.on('message', (raw: Buffer) => {
        const text = raw.toString();
        try {
          const msg = JSON.parse(text);
          // 从创建/加入房间消息中提取用户名，用于在线时长统计
          if (msg.payload?.username) {
            (ws as any)._username = msg.payload.username;
          }
          if (msg.type?.startsWith('emoji_')) {
            handleEmojiMessage(ws, msg);
            return;
          }
        } catch (e) {
          // 非 JSON 消息
        }
        try {
          this.dispatcher.dispatch(ws, text);
        } catch (e) {
          console.error('[WS] 消息处理异常:', e);
        }
      });

      ws.on('close', () => {
        console.log('[WS] 连接断开');
        try {
          this.handleDisconnect(ws);
        } catch (e) {
          console.error('[WS] 断开处理异常:', e);
        }
      });

      ws.on('error', (err) => {
        console.error('[WS] 错误:', err.message);
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'connected',
        payload: { message: '已连接到游戏服务器' },
        timestamp: Date.now(),
      }));
    });

    // 心跳检测
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if ((ws as any).isAlive === false) {
          ws.terminate();
          return;
        }
        (ws as any).isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL);

    // 在线时长跟踪：每 60 秒更新一次
    this.onlineTimer = setInterval(() => {
      const now = Date.now();
      this.wss.clients.forEach((ws) => {
        const w = ws as any;
        if (!w._connectAt || !w._username) return;
        const elapsed = Math.floor((now - w._connectAt) / 1000);
        if (elapsed <= 0) return;
        try {
          execute('UPDATE users SET total_online_seconds = total_online_seconds + ?, last_online_at = datetime("now", "localtime") WHERE username = ?', [elapsed, w._username]);
        } catch (e) {
          // 静默失败
        }
        w._connectAt = now;
      });
    }, 60000);

    this.wss.on('close', () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.onlineTimer) clearInterval(this.onlineTimer);
    });

    // 处理 pong 响应
    this.wss.on('connection', (ws) => {
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });
    });
  }

  /** 取消房间销毁倒计时（重连时调用） */
  cancelPendingDestruction(roomId: string): void {
    const timer = this.pendingDestruction.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.pendingDestruction.delete(roomId);
      console.log('[WS] 已取消房间销毁: ' + roomId);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    handleEmojiDisconnect(ws);
    const room = this.roomManager.findRoomByWs(ws);
    const player = room?.getPlayerByWs(ws);

    // 清除用户会话 + 更新在线时长
    // 优先使用 WS 级别的统计（覆盖整个连接周期，含在大厅的时间）
    const w = ws as any;
    if (w._connectAt && w._username) {
      const elapsed = Math.floor((Date.now() - w._connectAt) / 1000);
      if (elapsed > 0 && elapsed < 86400) {
        try {
          execute('UPDATE users SET total_online_seconds = total_online_seconds + ?, last_online_at = datetime("now", "localtime") WHERE username = ?', [elapsed, w._username]);
        } catch (e) {
          console.error('[WS] 更新在线时长失败:', e);
        }
      }
    } else if (player?.id) {
      // 兜底：使用 room join 时间（用户未经过大厅直接进入房间）
      const joined = player.joinedAt;
      if (joined) {
        const elapsed = Math.floor((Date.now() - joined) / 1000);
        if (elapsed > 0 && elapsed < 86400 && player.username) {
          try {
            execute('UPDATE users SET total_online_seconds = total_online_seconds + ?, last_online_at = datetime("now", "localtime") WHERE username = ?', [elapsed, player.username]);
          } catch (e) {
            console.error('[WS] 更新在线时长失败:', e);
          }
        }
      }
    }
    // 清理 session
    if (player?.id) {
      removeUserSession(player.id);
      // 同时清理 login 时写入的 session（user_id=users.id, username=player.username）
      try {
        execute('DELETE FROM user_sessions WHERE username = ?', [player.username]);
      } catch (e) {
        console.error('[WS] 清理登录 session 失败:', e);
      }
    }

    if (!room || !player) return;

    if (player.isOwner) {
      // 房主断线：30秒保护期，期间可重连恢复
      const timer = setTimeout(() => {
        removeActiveRoom(room.roomId);
        logRoomDestroyed(room.roomId);
        room.broadcast({
          type: 'room_destroyed',
          payload: { message: `👑 ${player.username} 断线超时，房间已销毁` },
        });
        this.roomManager.destroyRoom(room.roomId);
        this.pendingDestruction.delete(room.roomId);
      }, 30000);
      this.pendingDestruction.set(room.roomId, timer);

      room.broadcast({
        type: 'owner_disconnected',
        payload: { message: `👑 ${player.username} 断线，30秒内可重连恢复` },
      });
    } else {
      const wasInGame = room.gameState?.phase === 'playing' && room.players.some(p => p.id === player.id);
      room.removePlayer(player.id);
      saveActiveRoom(
        room.roomId, room.owner?.id || '', room.owner?.username || '',
        room.gameType, room.config, room.activity,
        room.players.map(p => p.id)
      );

      if (wasInGame) {
        // 对局中玩家断线 → AI 接管
        const aiColor = room.gameType === GameType.Gomoku ? GOMOKU_COLORS.WHITE : GO_COLORS.WHITE;
        const aiPlayer: RoomPlayer = {
          id: 'ai-' + crypto.randomUUID().slice(0, 8),
          username: '🤖 电脑',
          color: player.color,
          ws: null as any,
          isOwner: false,
          joinedAt: Date.now(),
        };
        room.players.push(aiPlayer);

        room.broadcast({
          type: 'player_left',
          payload: { playerId: player.id, username: player.username, message: `${player.username} 断线，电脑接管` },
        });
        room.broadcast({
          type: 'room_updated',
          payload: { room: room.toSnapshot() },
        });
      } else {
        room.broadcast({
          type: 'player_left',
          payload: { playerId: player.id, username: player.username, disconnected: true },
        });
        room.broadcastExcept({
          type: 'room_updated',
          payload: { room: room.toSnapshot() },
        }, '');
      }
    }
  }
}
