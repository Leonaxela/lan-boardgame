import WebSocket from 'ws';
import { GameType } from '@lan-boardgame/shared';
import { Room, RoomPlayer } from '../room/Room.js';
import { RoomManager } from '../room/RoomManager.js';
import { ChatHandler } from '../chat/ChatHandler.js';
import { kataGoManager } from '../katago/KataGoManager.js';
import type { ClientMessage, HandlerFn, DispatcherContext } from './types.js';
import { sendError } from './utils.js';
import { registerRoomHandlers } from './handlers/RoomHandler.js';
import { registerGameHandlers } from './handlers/GameHandler.js';
import { registerAIHandlers, createScheduleAIMove } from './handlers/AIHandler.js';
import { registerKataGoHandlers } from './handlers/KataGoHandler.js';
import { registerChallengeHandlers } from './handlers/ChallengeHandler.js';

export class Dispatcher {
  private handlers = new Map<string, HandlerFn>();

  constructor(
    private roomManager: RoomManager,
    private chatHandler: ChatHandler,
    private wsServer?: any,
  ) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const ctx: DispatcherContext = { roomManager: this.roomManager, chatHandler: this.chatHandler, wsServer: this.wsServer };
    const scheduleAIMove = createScheduleAIMove(ctx);

    registerRoomHandlers(ctx, this.handlers);
    registerGameHandlers(ctx, this.handlers, scheduleAIMove);
    registerAIHandlers(ctx, this.handlers);
    registerKataGoHandlers(ctx, this.handlers);
    registerChallengeHandlers(ctx, this.handlers);

    this.handlers.set('ping', (_ws: WebSocket, _msg: ClientMessage) => { /* handled by WSServer */ });
  }

  dispatch(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(ws, 'INVALID_JSON', '消息格式错误');
      return;
    }

    const handler = this.handlers.get(msg.type);
    if (!handler) {
      sendError(ws, 'UNKNOWN_TYPE', `未知消息类型: ${msg.type}`);
      return;
    }

    const room = this.roomManager.findRoomByWs(ws);
    const player = room?.getPlayerByWs(ws);

    if (['create_room', 'join_room', 'get_rooms', 'ping', 'start_ai_game', 'start_katago_game', 'rejoin_room'].includes(msg.type)) {
      handler(ws, msg, player as RoomPlayer, room as Room);
    } else if (player && room) {
      handler(ws, msg, player, room);
    } else {
      sendError(ws, 'NOT_IN_ROOM', '请先加入房间');
    }
  }
}
