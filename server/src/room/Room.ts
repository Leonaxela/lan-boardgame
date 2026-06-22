import { WebSocket } from 'ws';
import { GameType, GameConfig, GameState, Position } from '@lan-boardgame/shared';
import type { AnalysisPoint } from '../katago/KataGoManager.js';

// ── 玩家在房间中的连接 ──
export interface RoomPlayer {
  id: string;
  username: string;
  color: string;
  ws: WebSocket;
  isOwner: boolean;
  joinedAt: number;
}

// ── 房间活动状态 ──
export enum RoomActivity {
  Idle0 = 'idle_0',       // 完全空闲（等人）
  Idle1 = 'idle_1',       // 打谱中
  Idle2 = 'idle_2',       // AI 对弈中
  Playing = 'playing',    // PvP 对局中
}

// ── 聊天消息 ──
export interface ChatMessage {
  playerId: string;
  username: string;
  text: string;
  timestamp: number;
}

// ── 挑战状态 ──
export interface ChallengeState {
  challengerId: string;
  createdAt: number;
}

// ── 猜先状态 ──
export interface GuessFirstState {
  challengerId: string;
  number: number | string | null;
  choice: string | null;
  phase: 'waiting_number' | 'waiting_choice' | 'done';
}

// ── 房间数据 ──
export class Room {
  readonly roomId: string;
  readonly gameType: GameType;
  readonly config: GameConfig;
  owner: RoomPlayer | null = null;
  players: RoomPlayer[] = [];
  spectators: RoomPlayer[] = [];
  activity: RoomActivity = RoomActivity.Idle0;
  gameState: GameState | null = null;
  chatMessages: ChatMessage[] = [];
  challenge: ChallengeState | null = null;
  /** 对局走棋记录 */
  moveHistory: { color: string; row: number; col: number; at: number; fromRow?: number; fromCol?: number }[] = [];
  /** KataGo 分析数据（临时，仅围棋 KataGo 对弈使用）key=步数 index, value=分析 */
  katagoAnalysis: Map<number, AnalysisPoint> = new Map();
  createdAt: number;
  /** 游戏开始时间戳（仅围棋使用） */
  gameStartedAt: number | null = null;

  // ── 游戏状态属性（原 (room as any) 动态字段）──
  /** 是否是 KataGo 对弈 */
  katagoGame: boolean = false;
  /** KataGo 棋盘大小 */
  katagoBoardSize: number = 19;
  /** AI 难度等级 */
  aiDifficulty: number = 2;
  /** KataGo 难度（用于保存到对局记录） */
  katagoDifficulty: number = 0;
  /** AI 连续 pass 次数 */
  aiConsecutivePasses: number = 0;
  /** 申请再战的玩家 ID 列表 */
  rematchPlayers: string[] = [];
  /** 挑战超时定时器 */
  challengeTimer: NodeJS.Timeout | null = null;
  /** 猜先状态 */
  guessFirst: GuessFirstState | null = null;

  constructor(roomId: string, gameType: GameType, config: GameConfig) {
    this.roomId = roomId;
    this.gameType = gameType;
    this.config = config;
    this.createdAt = Date.now();
  }

  /** 获取房间中所有人（玩家 + 观战） */
  getAllPlayers(): RoomPlayer[] {
    return [...this.players, ...this.spectators];
  }

  /** 通过 ws 查找玩家 */
  getPlayerByWs(ws: WebSocket): RoomPlayer | undefined {
    return this.getAllPlayers().find(p => p.ws === ws);
  }

  /** 移除玩家 */
  removePlayer(playerId: string): { wasOwner: boolean } {
    this.players = this.players.filter(p => p.id !== playerId);
    this.spectators = this.spectators.filter(p => p.id !== playerId);
    return { wasOwner: this.owner?.id === playerId };
  }

  /** 是否满员（2 玩家） */
  get isFull(): boolean {
    return this.players.length >= 2;
  }

  /** 发送消息给房间内所有人 */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const p of this.getAllPlayers()) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    }
  }

  /** 发送消息给除指定玩家外的所有人 */
  broadcastExcept(message: object, excludeId: string): void {
    const data = JSON.stringify(message);
    for (const p of this.getAllPlayers()) {
      if (p.id !== excludeId && p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    }
  }

  /** 发送消息给指定玩家 */
  sendTo(playerId: string, message: object): void {
    const p = this.getAllPlayers().find(pl => pl.id === playerId);
    if (p && p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify(message));
    }
  }

  /** 发送消息给所有玩家（不含观战） */
  broadcastToPlayers(message: object): void {
    const data = JSON.stringify(message);
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    }
  }

  /** 获取房间快照（不含 ws / 敏感字段） */
  toSnapshot(): object {
    return {
      roomId: this.roomId,
      gameType: this.gameType,
      config: this.config,
      activity: this.activity,
      owner: this.owner ? { id: this.owner.id, username: this.owner.username, color: this.owner.color } : null,
      players: this.players.map(p => ({ id: p.id, username: p.username, color: p.color, isOwner: p.isOwner })),
      spectators: this.spectators.map(p => ({ id: p.id, username: p.username })),
      playerCount: this.players.filter(p => !p.id.startsWith('ai-')).length,
      spectatorCount: this.spectators.length,
      gameState: this.gameState,
      moveCount: this.moveHistory.length,
    };
  }
}
