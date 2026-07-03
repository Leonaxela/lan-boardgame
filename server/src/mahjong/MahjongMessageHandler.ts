import { WebSocket } from 'ws';
import {
  createInitialState, drawTile, discardTile, checkActions, checkSelfDrawActions,
  applyAction, advanceTurn, checkStalemate, renderForPlayer, selectAIMove,
} from '@lan-boardgame/mahjong';
import type { AvailableAction, MahjongState } from '@lan-boardgame/mahjong';
import { mahjongRoomManager } from './MahjongRoomManager.js';

const ACTION_TIMEOUT_MS = 15000;  // 15秒操作超时

function send(ws: WebSocket | null, type: string, payload?: any) {
  if (!ws) return;
  try { ws.send(JSON.stringify({ type, payload })); } catch {}
}

function broadcastAll(roomId: string, type: string, payload?: any) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room) return;
  for (const p of [...room.players, ...room.spectators]) {
    if (p.ws) send(p.ws, type, payload);
  }
}

function broadcastGameState(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state) return;
  for (const p of room.players) {
    if (p.ws) send(p.ws, 'mahjong_game_state', renderForPlayer(room.state, p.seat!));
  }
  for (const s of room.spectators) {
    if (s.ws) send(s.ws, 'mahjong_game_state', renderForPlayer(room.state, 0));
  }
}

function fillAIRoom(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room) return;
  const aiNames = ['电脑(东)', '电脑(南)', '电脑(西)', '电脑(北)'];
  for (let seat = 0; seat < 4; seat++) {
    if (!room.players.some(p => p.seat === seat)) {
      room.players.push({ ws: null!, username: aiNames[seat], seat, isAI: true });
    }
  }
}

/** 清除操作等待状态 */
function clearPending(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room) return;
  room.pendingActions.clear();
  room.passedSeats.clear();
  if (room.actionTimeout) {
    clearTimeout(room.actionTimeout);
    room.actionTimeout = null;
  }
}

/** 检查是否所有待操作玩家都已"过" */
function allPassed(roomId: string): boolean {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room) return true;
  for (const seat of room.pendingActions.keys()) {
    if (!room.passedSeats.has(seat)) return false;
  }
  return true;
}

/**
 * 处理出牌后的操作检测（核心游戏循环）
 * 1. checkActions 检测其他玩家的吃碰杠胡
 * 2. AI 操作直接执行
 * 3. 人类操作发送 mahjong_actions，等待响应
 * 4. 无人操作 → advanceTurn → 下家摸牌
 */
function processAfterDiscard(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state || room.state.phase !== 'playing') return;

  const actions = checkActions(room.state);
  if (!actions || actions.length === 0) {
    // 无人操作 → 下家摸牌
    proceedToNextTurn(roomId);
    return;
  }

  // 按优先级处理：先检查是否有 AI 想胡
  // 分离 AI 和人类操作
  const aiActions: { seat: number; action: AvailableAction }[] = [];
  const humanActions: { seat: number; actions: AvailableAction[] }[] = [];

  for (const action of actions) {
    const player = room.players.find(p => p.seat === action.seat);
    if (!player) continue;
    if (player.isAI) {
      aiActions.push({ seat: action.seat, action });
    } else {
      // 收集该座位的所有操作
      let existing = humanActions.find(h => h.seat === action.seat);
      if (!existing) {
        existing = { seat: action.seat, actions: [] };
        humanActions.push(existing);
      }
      existing.actions.push(action);
    }
  }

  // AI 按优先级执行（胡 > 杠 > 碰 > 吃）
  for (const { seat, action } of aiActions) {
    const move = selectAIMove(room.state, seat, [action]);
    if (move.action) {
      // AI 执行操作
      clearPending(roomId);
      executeAction(roomId, seat, move.action);
      return;
    }
  }

  // 人类操作：发送 mahjong_actions
  if (humanActions.length > 0) {
    room.pendingActions.clear();
    room.passedSeats.clear();
    for (const { seat, actions: seatActions } of humanActions) {
      room.pendingActions.set(seat, seatActions);
      const player = room.players.find(p => p.seat === seat);
      if (player?.ws) {
        send(player.ws, 'mahjong_actions', {
          actions: seatActions,
          state: renderForPlayer(room.state, seat),
        });
      }
    }
    // 设置超时
    if (room.actionTimeout) clearTimeout(room.actionTimeout);
    room.actionTimeout = setTimeout(() => {
      const r = mahjongRoomManager.getRoom(roomId);
      if (!r || !r.state) return;
      // 超时 → 所有未响应的座位自动"过"
      for (const seat of r.pendingActions.keys()) {
        r.passedSeats.add(seat);
      }
      if (allPassed(roomId)) {
        clearPending(roomId);
        proceedToNextTurn(roomId);
      }
    }, ACTION_TIMEOUT_MS);
    return;
  }

  // 所有 AI 都选择不操作 → 下家摸牌
  proceedToNextTurn(roomId);
}

/**
 * 下家摸牌并检测自摸胡/暗杠
 */
function proceedToNextTurn(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state) return;
  if (room.state.phase !== 'playing') return;

  // 检查流局
  if (room.state.wall.length === 0) {
    room.state = checkStalemate(room.state);
    broadcastGameState(roomId);
    if (room.state.phase === 'finished') {
      broadcastAll(roomId, 'mahjong_game_over', { result: room.state.result, state: renderForPlayer(room.state, 0) });
      room.destroyTimeout = setTimeout(() => mahjongRoomManager.removeRoom(roomId), 30000);
    }
    return;
  }

  // 下家摸牌
  const result = advanceTurn(room.state);
  room.state = result.state;
  broadcastGameState(roomId);

  if (room.state.phase === 'finished') {
    broadcastAll(roomId, 'mahjong_game_over', { result: room.state.result, state: renderForPlayer(room.state, 0) });
    room.destroyTimeout = setTimeout(() => mahjongRoomManager.removeRoom(roomId), 30000);
    return;
  }

  // 检测自摸胡/暗杠/加杠
  const selfActions = checkSelfDrawActions(room.state);
  if (selfActions && selfActions.length > 0) {
    const seat = room.state.currentPlayer;
    const player = room.players.find(p => p.seat === seat);
    if (player?.isAI) {
      // AI 处理
      const move = selectAIMove(room.state, seat, selfActions);
      if (move.action) {
        executeAction(roomId, seat, move.action);
        return;
      }
      // AI 不操作 → 等待出牌
      scheduleAIMove(roomId);
    } else if (player?.ws) {
      // 人类：发送自摸操作选项
      room.pendingActions.clear();
      room.passedSeats.clear();
      room.pendingActions.set(seat, selfActions);
      send(player.ws, 'mahjong_actions', {
        actions: selfActions,
        state: renderForPlayer(room.state, seat),
      });
      if (room.actionTimeout) clearTimeout(room.actionTimeout);
      room.actionTimeout = setTimeout(() => {
        const r = mahjongRoomManager.getRoom(roomId);
        if (!r || !r.state) return;
        for (const s of r.pendingActions.keys()) {
          r.passedSeats.add(s);
        }
        if (allPassed(roomId)) {
          clearPending(roomId);
          // 自摸过 → 等待出牌
          scheduleAIMove(roomId);
        }
      }, ACTION_TIMEOUT_MS);
    }
  } else {
    // 无自摸操作 → 等待出牌
    scheduleAIMove(roomId);
  }
}

/**
 * 执行操作（吃碰杠胡）并继续游戏流程
 */
function executeAction(roomId: string, seat: number, action: AvailableAction) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state) return;

  const result = applyAction(room.state, seat, action);
  room.state = result.state;
  room.state = checkStalemate(room.state);

  broadcastGameState(roomId);

  if (room.state.phase === 'finished' || room.state.result) {
    broadcastAll(roomId, 'mahjong_game_over', { result: room.state.result, state: renderForPlayer(room.state, 0) });
    room.destroyTimeout = setTimeout(() => mahjongRoomManager.removeRoom(roomId), 30000);
    return;
  }

  // 操作后需要出牌（碰/吃/杠）
  if (result.needsDiscard) {
    const player = room.players.find(p => p.seat === room.state!.currentPlayer);
    if (player?.isAI) {
      // 杠后补摸 → 检查自摸
      if (room.state.drawnTile) {
        const selfActions = checkSelfDrawActions(room.state);
        if (selfActions && selfActions.length > 0) {
          const move = selectAIMove(room.state, seat, selfActions);
          if (move.action) {
            executeAction(roomId, seat, move.action);
            return;
          }
        }
      }
      scheduleAIMove(roomId);
    }
    // 人类玩家：等待出牌（状态已广播，客户端显示手牌）
  }
}

function scheduleAIMove(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state || room.state.phase !== 'playing') return;
  const current = room.players.find(p => p.seat === room.state!.currentPlayer);
  if (!current || !current.isAI) return;
  if (room.turnTimeout) clearTimeout(room.turnTimeout);
  room.turnTimeout = setTimeout(() => doAIMove(roomId), 800);
}

function doAIMove(roomId: string) {
  const room = mahjongRoomManager.getRoom(roomId);
  if (!room || !room.state || room.state.phase !== 'playing') return;
  const seat = room.state.currentPlayer;
  const aiPlayer = room.players.find(p => p.seat === seat);
  if (!aiPlayer || !aiPlayer.isAI) return;

  // 如果有 drawnTile，先检查自摸操作
  if (room.state.drawnTile) {
    const selfActions = checkSelfDrawActions(room.state);
    if (selfActions && selfActions.length > 0) {
      const move = selectAIMove(room.state, seat, selfActions);
      if (move.action) {
        executeAction(roomId, seat, move.action);
        return;
      }
    }
  }

  // 出牌
  const move = selectAIMove(room.state, seat, null);
  if (move.type === 'discard' && move.tileIndex !== undefined) {
    const discardResult = discardTile(room.state, seat, move.tileIndex);
    if (discardResult) {
      room.state = discardResult.state;
      broadcastAll(roomId, 'mahjong_discarded', {
        seat, tile: discardResult.tile,
        state: renderForPlayer(room.state, 0),
      });
      processAfterDiscard(roomId);
    }
  }
}

/** 主消息分发 */
export function handleMahjongMessage(ws: WebSocket, raw: string) {
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return; }
  const { type, payload = {} } = msg;

  switch (type) {
    case 'mahjong_create_room': {
      const variant = payload.variant || 'sichuan';
      const username = payload.username || '玩家';
      const room = mahjongRoomManager.createRoom(variant, { ws, username });
      send(ws, 'mahjong_room_created', {
        roomId: room.roomId, variant: room.variant,
        players: room.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        spectators: [],
      });
      break;
    }

    case 'mahjong_join_room': {
      const roomId = payload.roomId;
      const username = payload.username || '玩家';
      const room = mahjongRoomManager.joinRoom(roomId, { ws, username });
      if (!room) { send(ws, 'error', { message: '加入失败' }); return; }
      send(ws, 'mahjong_room_joined', {
        roomId, variant: room.variant,
        players: room.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        spectators: room.spectators.map(p => ({ username: p.username, seat: null, isAI: false })),
      });
      broadcastAll(roomId, 'mahjong_spectator_joined', {
        username, spectators: room.spectators.map(p => ({ username: p.username })),
      });
      broadcastAll(roomId, 'mahjong_chat', {
        username: '系统', text: `${username} 加入了房间`, isSystem: true, timestamp: Date.now(),
      });
      break;
    }

    case 'mahjong_sit': {
      const r = mahjongRoomManager.findRoomByWs(ws);
      if (!r) { send(ws, 'error', { message: '不在房间中' }); return; }
      const seat = payload.seat as number;
      const result = mahjongRoomManager.sit(r.roomId, ws, seat);
      if (result === null) { send(ws, 'error', { message: '入座失败' }); return; }
      broadcastAll(r.roomId, 'mahjong_seat_changed', {
        players: r.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        spectators: r.spectators.map(p => ({ username: p.username })),
      });
      break;
    }

    case 'mahjong_stand': {
      const r2 = mahjongRoomManager.findRoomByWs(ws);
      if (!r2) { send(ws, 'error', { message: '不在房间中' }); return; }
      mahjongRoomManager.stand(r2.roomId, ws);
      broadcastAll(r2.roomId, 'mahjong_seat_changed', {
        players: r2.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        spectators: r2.spectators.map(p => ({ username: p.username })),
      });
      break;
    }

    case 'mahjong_chat': {
      const r3 = mahjongRoomManager.findRoomByWs(ws);
      if (!r3) return;
      const player = [...r3.players, ...r3.spectators].find(p => p.ws === ws);
      if (!player) return;
      broadcastAll(r3.roomId, 'mahjong_chat', {
        username: player.username, text: payload.text, timestamp: Date.now(),
      });
      break;
    }

    case 'mahjong_leave_room': {
      const r4 = mahjongRoomManager.findRoomByWs(ws);
      if (r4) {
        const player = [...r4.players, ...r4.spectators].find(p => p.ws === ws);
        if (!player) break;
        if (player.seat === 0) {
          broadcastAll(r4.roomId, 'room_destroyed', { message: `👑 ${player.username} 离开房间，房间即将销毁` });
          mahjongRoomManager.removeRoom(r4.roomId);
          break;
        }
        if (r4.state && r4.state.phase === 'playing' && player.seat !== null) {
          player.isAI = true; player.ws = null!;
          broadcastGameState(r4.roomId);
        }
        mahjongRoomManager.leaveRoom(r4.roomId, ws);
        broadcastAll(r4.roomId, 'mahjong_seat_changed', {
          players: (r4.players || []).map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
          spectators: (r4.spectators || []).map(p => ({ username: p.username })),
        });
        broadcastAll(r4.roomId, 'mahjong_chat', {
          username: '系统', text: `${player.username} 离开了房间`, isSystem: true, timestamp: Date.now(),
        });
      }
      break;
    }

    case 'mahjong_get_rooms': {
      send(ws, 'mahjong_room_list', { rooms: mahjongRoomManager.getRoomList() });
      break;
    }

    case 'mahjong_start_solo': {
      const r5 = mahjongRoomManager.findRoomByWs(ws);
      if (!r5 || r5.state) { send(ws, 'error', { message: '游戏已开始' }); return; }
      if (payload.variant) r5.variant = payload.variant;
      fillAIRoom(r5.roomId);
      const soloState = createInitialState(r5.variant);
      r5.state = soloState;
      broadcastAll(r5.roomId, 'mahjong_game_started', {
        players: r5.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        state: renderForPlayer(soloState, 0),
      });
      broadcastGameState(r5.roomId);
      // 庄家摸了第一张牌 → 检查自摸
      const selfActions = checkSelfDrawActions(soloState);
      if (selfActions && selfActions.length > 0) {
        const player = r5.players.find(p => p.seat === 0);
        if (player?.isAI) {
          const move = selectAIMove(soloState, 0, selfActions);
          if (move.action) {
            executeAction(r5.roomId, 0, move.action);
            break;
          }
        }
      }
      scheduleAIMove(r5.roomId);
      break;
    }

    case 'mahjong_start_game': {
      const r6 = mahjongRoomManager.findRoomByWs(ws);
      if (!r6) { send(ws, 'error', { message: '不在房间中' }); return; }
      const state = createInitialState(r6.variant);
      r6.state = state;
      broadcastAll(r6.roomId, 'mahjong_game_started', {
        players: r6.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        state: renderForPlayer(state, 0),
      });
      broadcastGameState(r6.roomId);
      scheduleAIMove(r6.roomId);
      break;
    }

    case 'mahjong_set_variant': {
      const r7 = mahjongRoomManager.findRoomByWs(ws);
      if (!r7 || r7.state) break;
      const nv = payload.variant;
      if (nv && ['sichuan', 'wuhan', 'guobiao'].includes(nv)) {
        r7.variant = nv;
        broadcastAll(r7.roomId, 'mahjong_variant_updated', { variant: nv });
      }
      break;
    }

    case 'mahjong_end_game': {
      const rEnd = mahjongRoomManager.findRoomByWs(ws);
      if (!rEnd || !rEnd.state) break;
      rEnd.state = null;
      if (rEnd.turnTimeout) clearTimeout(rEnd.turnTimeout);
      if (rEnd.destroyTimeout) { clearTimeout(rEnd.destroyTimeout); rEnd.destroyTimeout = null; }
      clearPending(rEnd.roomId);
      rEnd.players = rEnd.players.filter(p => !p.isAI);
      broadcastAll(rEnd.roomId, 'mahjong_game_ended', {});
      broadcastAll(rEnd.roomId, 'mahjong_seat_changed', {
        players: rEnd.players.map(p => ({ username: p.username, seat: p.seat, isAI: p.isAI })),
        spectators: rEnd.spectators.map(p => ({ username: p.username })),
      });
      break;
    }

    case 'mahjong_discard': {
      const r8 = mahjongRoomManager.findRoomByWs(ws);
      if (!r8 || !r8.state) return;
      const p = r8.players.find(p => p.ws === ws);
      if (!p || p.seat === null || p.isAI) return;
      if (r8.state.currentPlayer !== p.seat) return;

      const idx = payload.tileIndex;
      const result = discardTile(r8.state, p.seat, idx);
      if (!result) { send(ws, 'error', { message: '出牌失败' }); return; }
      r8.state = result.state;
      broadcastAll(r8.roomId, 'mahjong_discarded', {
        seat: p.seat, tile: result.tile,
        state: renderForPlayer(r8.state, 0),
      });
      processAfterDiscard(r8.roomId);
      break;
    }

    case 'mahjong_hu': case 'mahjong_peng': case 'mahjong_chi':
    case 'mahjong_gang': case 'mahjong_angang': case 'mahjong_jiagang':
    case 'mahjong_pass': {
      const r9 = mahjongRoomManager.findRoomByWs(ws);
      if (!r9 || !r9.state) return;
      const p9 = r9.players.find(p => p.ws === ws);
      if (!p9 || p9.seat === null) return;

      if (type === 'mahjong_pass') {
        r9.passedSeats.add(p9.seat);
        if (allPassed(r9.roomId)) {
          clearPending(r9.roomId);
          // 判断是出牌后的"过"还是自摸检测后的"过"
          if (r9.state.lastDiscard) {
            // 出牌后的过 → 下家摸牌
            proceedToNextTurn(r9.roomId);
          } else {
            // 自摸检测后的过 → 等待出牌
            scheduleAIMove(r9.roomId);
          }
        }
        return;
      }

      // 查找匹配的操作
      const atype = type.replace('mahjong_', '');
      const pending = r9.pendingActions.get(p9.seat);
      if (!pending) { send(ws, 'error', { message: '没有待操作' }); return; }
      const match = pending.find(a => a.type === atype);
      if (!match) { send(ws, 'error', { message: '不能执行此操作' }); return; }

      clearPending(r9.roomId);
      executeAction(r9.roomId, p9.seat, match);
      break;
    }

    default: break;
  }
}
