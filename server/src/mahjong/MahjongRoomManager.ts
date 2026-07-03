import { WebSocket } from 'ws';
import type { RuleVariant, MahjongState, AvailableAction } from '@lan-boardgame/mahjong';

export interface MahjongPlayer {
  ws: WebSocket;
  username: string;
  seat: number | null;  // null = 观战
  isAI: boolean;
}

export interface MahjongRoom {
  roomId: string;
  variant: RuleVariant;
  players: MahjongPlayer[];
  state: MahjongState | null;
  spectators: MahjongPlayer[];
  createdAt: number;
  turnTimeout: NodeJS.Timeout | null;
  /** 等待人类玩家响应的操作（座位→可选操作列表） */
  pendingActions: Map<number, AvailableAction[]>;
  /** 已"过"的座位 */
  passedSeats: Set<number>;
  /** 操作超时计时器 */
  actionTimeout: NodeJS.Timeout | null;
  /** 终局后自动销毁房间的计时器 */
  destroyTimeout: NodeJS.Timeout | null;
  /** 流局/终局后同意再战的座位 */
  rematchVotes: Set<number>;
}

export class MahjongRoomManager {
  private rooms = new Map<string, MahjongRoom>();

  createRoom(variant: RuleVariant, player: { ws: WebSocket; username: string }): MahjongRoom {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let roomId = '';
    for (let i = 0; i < 4; i++) roomId += chars[Math.floor(Math.random() * chars.length)];
    // 确保不重复
    while (this.rooms.has(roomId)) {
      roomId = '';
      for (let i = 0; i < 4; i++) roomId += chars[Math.floor(Math.random() * chars.length)];
    }
    const room: MahjongRoom = {
      roomId,
      variant,
      players: [{
        ws: player.ws,
        username: player.username,
        seat: 0,
        isAI: false,
      }],
      state: null,
      spectators: [],
      createdAt: Date.now(),
      turnTimeout: null,
      pendingActions: new Map(),
      passedSeats: new Set(),
      actionTimeout: null,
      destroyTimeout: null,
      rematchVotes: new Set(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  /** 加入房间 → 观战 */
  joinRoom(roomId: string, player: { ws: WebSocket; username: string }): MahjongRoom | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.players.some(p => p.username === player.username)) return null;
    if (room.spectators.some(p => p.username === player.username)) return null;

    room.spectators.push({ ws: player.ws, username: player.username, seat: null, isAI: false });
    return room;
  }

  /** 入座：观战→玩家；或已坐玩家换座 */
  sit(roomId: string, ws: WebSocket, seat: number): number | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.state && room.state.phase === 'playing') return null; // 游戏中不能入座
    if (room.players.some(p => p.seat === seat)) return null; // 座位已被占

    // 已坐玩家换座
    const existing = room.players.find(p => p.ws === ws);
    if (existing) {
      existing.seat = seat;
      return seat;
    }

    // 观战入座
    const idx = room.spectators.findIndex(p => p.ws === ws);
    if (idx < 0) return null;

    const spectator = room.spectators[idx];
    spectator.seat = seat;
    room.players.push(spectator);
    room.spectators.splice(idx, 1);
    return seat;
  }

  /** 离座：玩家→观战 */
  stand(roomId: string, ws: WebSocket): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (room.state && room.state.phase === 'playing') return false; // 游戏中不能离座

    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx < 0 || room.players[idx].seat === 0) return false; // 房主不能离座

    const player = room.players[idx];
    player.seat = null;
    room.spectators.push(player);
    room.players.splice(idx, 1);
    return true;
  }

  leaveRoom(roomId: string, ws: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players = room.players.filter(p => p.ws !== ws);
    room.spectators = room.spectators.filter(p => p.ws !== ws);
    if (room.players.length === 0 && room.spectators.length === 0) {
      this.removeRoom(roomId);
    }
  }

  getPlayerCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    return room ? room.players.length : 0;
  }

  /** 获取房间给大厅显示 */
  getRoomList(): { roomId: string; gameType: string; owner: string; totalPeople: number; playerCount: number; variant: string }[] {
    const list: any[] = [];
    for (const room of this.rooms.values()) {
      list.push({
        roomId: room.roomId,
        gameType: 'mahjong',
        owner: room.players[0]?.username || '',
        totalPeople: room.players.filter(p => !p.isAI).length + room.spectators.length,
        playerCount: room.players.filter(p => !p.isAI).length,
        variant: room.variant,
      });
    }
    return list;
  }

  getRoom(roomId: string): MahjongRoom | undefined {
    return this.rooms.get(roomId);
  }

  removeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room?.turnTimeout) clearTimeout(room.turnTimeout);
    if (room?.actionTimeout) clearTimeout(room.actionTimeout);
    if (room?.destroyTimeout) clearTimeout(room.destroyTimeout);
    this.rooms.delete(roomId);
  }

  /** 寻找玩家/观战所在的房间 */
  findRoomByWs(ws: WebSocket): MahjongRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.ws === ws) || room.spectators.some(p => p.ws === ws)) return room;
    }
    return undefined;
  }
}

export const mahjongRoomManager = new MahjongRoomManager();
