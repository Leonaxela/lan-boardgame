import WebSocket from 'ws';
import { GameType, GameConfig, GamePhase } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { kataGoManager } from '../../katago/KataGoManager.js';
import { upsertUserSession, removeUserSession, saveActiveRoom, removeActiveRoom, logRoomDestroyed } from '../../room/RoomPersistence.js';
import { getEngine, enrichGameResult, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';

export function registerRoomHandlers(ctx: DispatcherContext, handlers: Map<string, Function>): void {
  const { roomManager, wsServer } = ctx;

  handlers.set('create_room', (ws: WebSocket, msg: ClientMessage) => {
    const gameType = msg.payload.gameType as GameType || GameType.Go;
    const config = (msg.payload.config as GameConfig) || {} as GameConfig;
    if (!config.extra) config.extra = {};
    console.log('[createRoom] config:', JSON.stringify(config));
    const username = (msg.payload.username as string) || '玩家';

    const player: RoomPlayer = {
      id: crypto.randomUUID(),
      username,
      color: 'black',
      ws,
      isOwner: true,
      joinedAt: Date.now(),
    };

    const room = roomManager.createRoom(gameType, config, player);

    upsertUserSession(player.id, player.username, room.roomId);
    saveActiveRoom(room.roomId, player.id, player.username, gameType, config, 'idle_0', [player.id]);

    ws.send(JSON.stringify({
      type: 'room_created',
      payload: {
        roomId: room.roomId,
        player: { id: player.id, username: player.username, color: player.color },
        room: room.toSnapshot(),
      },
      timestamp: Date.now(),
    }));
  });

  handlers.set('join_room', (ws: WebSocket, msg: ClientMessage) => {
    const roomId = msg.payload.roomId as string;
    const username = (msg.payload.username as string) || '观战者';

    const room = roomManager.getRoom(roomId);
    if (!room) {
      sendError(ws, 'ROOM_NOT_FOUND', '房间不存在');
      return;
    }

    const player: RoomPlayer = {
      id: crypto.randomUUID(),
      username,
      color: '',
      ws,
      isOwner: false,
      joinedAt: Date.now(),
    };

    room.spectators.push(player);

    upsertUserSession(player.id, player.username, room.roomId);
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, room.activity, room.players.map((p: any) => p.id));

    ws.send(JSON.stringify({
      type: 'room_joined',
      payload: {
        roomId: room.roomId,
        player: { id: player.id, username: player.username, color: player.color, isOwner: false },
        room: room.toSnapshot(),
      },
      timestamp: Date.now(),
    }));

    room.broadcastExcept({
      type: 'player_joined',
      payload: { player: { id: player.id, username: player.username, color: player.color } },
    }, player.id);

    room.broadcastExcept({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    }, '');
  });

  handlers.set('leave_room', (_ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    removeUserSession(player.id);
    if (player.isOwner) {
      if (room.katagoGame) kataGoManager.destroySession(room.roomId);
      removeActiveRoom(room.roomId);
      logRoomDestroyed(room.roomId);
      room.broadcast({
        type: 'room_destroyed',
        payload: { message: `👑 ${player.username} 离开房间，房间即将销毁` },
      });
      roomManager.destroyRoom(room.roomId);
    } else {
      const wasPlayer = room.players.some(p => p.id === player.id);
      room.removePlayer(player.id);

      if (wasPlayer && room.gameState?.phase === GamePhase.Playing) {
        const engine = getEngine(room.gameType, room.config);
        const result = engine.handleResign(room.gameState, player.color);
        enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;

        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState, message: `${player.username} 离开房间，判负` },
        });
      } else {
        room.broadcast({
          type: 'player_left',
          payload: { playerId: player.id, username: player.username },
        });
      }
      room.broadcastExcept({
        type: 'room_updated',
        payload: { room: room.toSnapshot() },
      }, '');
    }
  });

  handlers.set('get_rooms', (ws: WebSocket) => {
    let rooms = roomManager.getRoomList();

    const pendingIds = wsServer?.pendingDestruction ?
      Array.from(wsServer?.pendingDestruction?.keys() || []) : [];
    rooms = rooms.filter((r: any) => !pendingIds.includes(r.roomId));

    const gameStats: Record<string, { rooms: number; players: number }> = {};
    for (const r of rooms) {
      if (!gameStats[r.gameType]) gameStats[r.gameType] = { rooms: 0, players: 0 };
      gameStats[r.gameType].rooms++;
      gameStats[r.gameType].players += r.totalPeople;
    }

    ws.send(JSON.stringify({
      type: 'room_list',
      payload: { rooms, gameStats },
    }));
  });

  handlers.set('set_activity', (_ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (!player.isOwner) {
      sendError(_ws, 'NOT_OWNER', '只有房主能修改房间状态');
      return;
    }

    const activity = msg.payload.activity as string;
    const validActivities = ['idle_0', 'idle_1', 'idle_2'];
    if (!validActivities.includes(activity)) {
      sendError(_ws, 'INVALID_ACTIVITY', '无效的房间状态');
      return;
    }

    room.activity = activity as RoomActivity;

    const idleMap: Record<string, number> = { idle_0: 0, idle_1: 1, idle_2: 2 };

    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, activity, room.players.map((p: any) => p.id));

    room.broadcast({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    });
  });

  handlers.set('rejoin_room', (ws: WebSocket, msg: ClientMessage) => {
    const roomId = msg.payload.roomId as string;
    const playerId = msg.payload.playerId as string;

    if (!roomId || !playerId) {
      sendError(ws, 'INVALID_REJOIN', '缺少房间ID或玩家ID');
      return;
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      sendError(ws, 'ROOM_GONE', '房间已销毁，无法重连');
      return;
    }

    const allPlayers = room.getAllPlayers();
    const player = allPlayers.find((p: any) => p.id === playerId);
    if (!player) {
      sendError(ws, 'NOT_IN_ROOM', '您不在该房间中');
      return;
    }

    player.ws = ws;

    if (wsServer?.cancelPendingDestruction) {
      wsServer.cancelPendingDestruction(roomId);
    }

    upsertUserSession(player.id, player.username, roomId);

    ws.send(JSON.stringify({
      type: 'room_joined',
      payload: {
        roomId: room.roomId,
        player: { id: player.id, username: player.username, color: player.color, isOwner: player.isOwner },
        room: room.toSnapshot(),
      },
      timestamp: Date.now(),
    }));

    for (const msg of room.chatMessages) {
      ws.send(JSON.stringify({ type: 'chat', payload: msg }));
    }

    if (room.gameState) {
      ws.send(JSON.stringify({
        type: 'game_started',
        payload: {
          gameState: room.gameState,
          players: room.players.map((p: any) => ({
            id: p.id, username: p.username, color: p.color, isAi: p.id.startsWith('ai-'),
          })),
        },
      }));
    }

    room.broadcastExcept({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    }, player.id);
    room.broadcastExcept({
      type: 'player_rejoined',
      payload: { playerId: player.id, username: player.username },
    }, player.id);
  });
}
