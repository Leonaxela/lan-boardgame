import { GameType, GameConfig, Player } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from './Room.js';
import { WebSocket } from 'ws';

const ROOM_ID_LENGTH = 4;

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  /** 生成唯一房间号 */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 避免混淆 0/O/1/I
    for (let attempt = 0; attempt < 100; attempt++) {
      let id = '';
      for (let i = 0; i < ROOM_ID_LENGTH; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.rooms.has(id)) return id;
    }
    return Date.now().toString(36).toUpperCase();
  }

  /** 创建房间 */
  createRoom(gameType: GameType, config: GameConfig, player: RoomPlayer): Room {
    const roomId = this.generateRoomId();
    const room = new Room(roomId, gameType, config);
    room.owner = player;
    room.players.push(player);
    this.rooms.set(roomId, room);
    return room;
  }

  /** 获取房间 */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** 销毁房间 */
  destroyRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** 获取所有房间列表（公开摘要） */
  getRoomList(): { roomId: string; gameType: GameType; owner: string; playerCount: number; maxPlayers: number; totalPeople: number }[] {
    const list: { roomId: string; gameType: GameType; owner: string; playerCount: number; maxPlayers: number; totalPeople: number }[] = [];
    for (const room of this.rooms.values()) {
      const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-')).length;
      const totalPeople = humanPlayers + room.spectators.length;
      list.push({
        roomId: room.roomId,
        gameType: room.gameType,
        owner: room.owner?.username || '',
        playerCount: humanPlayers,
        maxPlayers: 2,
        totalPeople,
      });
    }
    return list;
  }

  /** 通过 WebSocket 查找玩家所在的房间 */
  findRoomByWs(ws: WebSocket): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.getAllPlayers().some(p => p.ws === ws)) {
        return room;
      }
    }
    return undefined;
  }

  /** 在房间中查找玩家 */
  findPlayerInRoom(roomId: string, ws: WebSocket): RoomPlayer | undefined {
    const room = this.rooms.get(roomId);
    return room?.getAllPlayers().find(p => p.ws === ws);
  }
}
