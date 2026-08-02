import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { GameType } from '@lan-boardgame/shared';
import { GO_COLORS } from '@lan-boardgame/go';
import { GOMOKU_COLORS } from '@lan-boardgame/gomoku';
import { Dispatcher } from './Dispatcher.js';
import { RoomManager } from '../room/RoomManager.js';
import { Room, RoomPlayer, RoomActivity } from '../room/Room.js';
import { ChatHandler } from '../chat/ChatHandler.js';
import { upsertUserSession, removeUserSession, ensureUserSession, saveActiveRoom, removeActiveRoom, logRoomDestroyed } from '../room/RoomPersistence.js';
import { execute } from '../db/connection.js';
import { handleEmojiMessage, handleEmojiDisconnect } from '../emoji/EmojiGameManager.js';
import { handleMahjongMessage } from '../mahjong/MahjongMessageHandler.js';
import { mahjongRoomManager } from '../mahjong/MahjongRoomManager.js';

const HEARTBEAT_INTERVAL = 30000;

export class GameWSServer {
  private wss: WSServer;
  private dispatcher: Dispatcher;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private onlineTimer: NodeJS.Timeout | null = null;
  /** 待销毁的房间（房主断线30秒倒计时） */
  private pendingDestruction = new Map<string, NodeJS.Timeout>();
  /** 待移除的断线玩家（非房主断线30秒保护期，期间可 rejoin 恢复） */
  private pendingPlayerRemoval = new Map<string, NodeJS.Timeout>();

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
            // 缓存自动进入大厅的用户不会重新走 /login：识别到用户名即补建 session（已有则不重复），
            // 保证"登录成功就算在线"对刷新/重连场景同样生效
            try {
              ensureUserSession(msg.payload.username);
            } catch (e) {
              console.error('[WS] ensureUserSession 失败:', e);
            }
          }
          if (msg.type?.startsWith('emoji_')) {
            handleEmojiMessage(ws, msg);
            return;
          }
          if (msg.type?.startsWith('mahjong_')) {
            handleMahjongMessage(ws, text);
            return;
          }
        } catch (e: any) {
          if (!(e instanceof SyntaxError)) console.error('[WS] 消息处理异常:', e?.message || e);
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
          // 在线 = 登录成功且心跳活跃（last_ping 120 秒内），登录即算在线，无需进房间
          execute('UPDATE user_sessions SET last_ping = datetime("now", "localtime") WHERE username = ?', [w._username]);
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

  /** 取消断线玩家移除倒计时（重连时调用） */
  cancelPendingPlayerRemoval(playerId: string): void {
    const timer = this.pendingPlayerRemoval.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.pendingPlayerRemoval.delete(playerId);
      console.log('[WS] 已取消玩家移除: ' + playerId);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    // 麻将对局断开处理
    const mjRoom = mahjongRoomManager.findRoomByWs(ws);
    if (mjRoom) {
      const player = mjRoom.players.find(p => p.ws === ws);
      if (player?.seat === 0) {
        // 房主断线 → 通知其他玩家 + 销毁房间
        mjRoom.players.forEach(p => { if (p.ws && p.ws !== ws) {
          try { p.ws.send(JSON.stringify({ type: 'room_destroyed', payload: { message: `👑 ${player.username} 断线，房间已销毁` } })); } catch {}
        }});
        mahjongRoomManager.removeRoom(mjRoom.roomId);
      } else if (player && mjRoom.state && player.seat !== null) {
        // 对局中其他人断线 → AI 接管
        player.isAI = true; player.ws = null!;
        // 广播系统消息 + 刷新玩家列表
        const msgTxt = `${player.username} 断线，AI 已接管`;
        const allClients = [...mjRoom.players, ...mjRoom.spectators];
        for (const c of allClients) {
          if (!c.ws) continue;
          try {
            c.ws.send(JSON.stringify({ type: 'mahjong_chat', payload: { username: '系统', text: msgTxt, isSystem: true, timestamp: Date.now() } }));
            c.ws.send(JSON.stringify({ type: 'mahjong_seat_changed', payload: {
              players: mjRoom.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
              spectators: mjRoom.spectators.map(p => ({ username: p.username })),
            }}));
          } catch {}
        }
      } else {
        mahjongRoomManager.leaveRoom(mjRoom.roomId, ws);
      }
      console.log('[Mahjong] 玩家断开: ' + (player?.username || '未知'));
    }

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
    // 清理 session（登录即算在线：任何已登录连接断开都删除 session，包含仅在大厅的用户）
    const w2 = ws as any;
    if (w2._username) {
      try {
        execute('DELETE FROM user_sessions WHERE username = ?', [w2._username]);
      } catch (e) {
        console.error('[WS] 清理登录 session 失败:', e);
      }
    }
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

      // 非房主断线：30秒保护期，期间可 rejoin 恢复（与房主保护一致，避免刷新页面丢房间）
      const removalTimer = setTimeout(() => {
        this.pendingPlayerRemoval.delete(player.id);
        // 房间可能已被销毁，或玩家已通过 rejoin 换新 ws 恢复
        const currentRoom = this.roomManager.getRoom(room.roomId);
        if (!currentRoom) return;
        const currentPlayer = currentRoom.getAllPlayers().find(p => p.id === player.id);
        if (!currentPlayer || (currentPlayer.ws && currentPlayer.ws.readyState === WebSocket.OPEN)) return;

        const wasInGameNow = currentRoom.gameState?.phase === 'playing' && currentRoom.players.some(p => p.id === player.id);
        currentRoom.removePlayer(player.id);
        saveActiveRoom(
          currentRoom.roomId, currentRoom.owner?.id || '', currentRoom.owner?.username || '',
          currentRoom.gameType, currentRoom.config, currentRoom.activity,
          currentRoom.players.map(p => p.id)
        );

        if (wasInGameNow) {
          // 对局中玩家断线 → AI 接管
          const aiColor = currentRoom.gameType === GameType.Gomoku ? GOMOKU_COLORS.WHITE : GO_COLORS.WHITE;
          const aiPlayer: RoomPlayer = {
            id: 'ai-' + crypto.randomUUID().slice(0, 8),
            username: '🤖 电脑',
            color: player.color,
            ws: null as any,
            isOwner: false,
            joinedAt: Date.now(),
          };
          currentRoom.players.push(aiPlayer);

          currentRoom.broadcast({
            type: 'player_left',
            payload: { playerId: player.id, username: player.username, message: `${player.username} 断线，电脑接管` },
          });
          currentRoom.broadcast({
            type: 'room_updated',
            payload: { room: currentRoom.toSnapshot() },
          });
        } else {
          currentRoom.broadcast({
            type: 'player_left',
            payload: { playerId: player.id, username: player.username, disconnected: true },
          });
          currentRoom.broadcastExcept({
            type: 'room_updated',
            payload: { room: currentRoom.toSnapshot() },
          }, '');
        }
      }, 30000);
      this.pendingPlayerRemoval.set(player.id, removalTimer);
    }
  }
}
