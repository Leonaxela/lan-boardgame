import { WebSocket } from 'ws';
import { Room, RoomPlayer } from '../room/Room.js';

export interface ClientMessage {
  type: string;
  payload: Record<string, unknown>;
}

export type HandlerFn = (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => void;

/** Dispatcher 的依赖上下文 */
export interface DispatcherContext {
  roomManager: any;
  chatHandler: any;
  wsServer?: any;
}
