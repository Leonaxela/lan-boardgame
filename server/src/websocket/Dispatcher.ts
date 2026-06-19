import WebSocket from 'ws';
import { RoomManager } from '../room/RoomManager.js';
import { Room, RoomPlayer, RoomActivity } from '../room/Room.js';
import { ChatHandler } from '../chat/ChatHandler.js';
import { ChineseGoEngine } from '@lan-boardgame/go/chinese';
import { JapaneseGoEngine } from '@lan-boardgame/go/japanese';
import { selectAIMove } from '@lan-boardgame/go/ai';
import { GomokuEngine } from '@lan-boardgame/gomoku/engine';
import { selectAIMove as selectGomokuAIMove } from '@lan-boardgame/gomoku/ai';
import { ChineseChessEngine } from '@lan-boardgame/chinese-chess/engine';
import { selectAIMove as selectChineseChessAIMove } from '@lan-boardgame/chinese-chess/ai';
import { ChessEngine } from '@lan-boardgame/chess/engine';
import { selectAIMove as selectChessAIMove } from '@lan-boardgame/chess/ai';
import { DraughtsEngine } from '@lan-boardgame/draughts/engine';
import { selectAIMove as selectDraughtsAIMove } from '@lan-boardgame/draughts/ai';
import { GameType, GameConfig, GameState, GamePhase } from '@lan-boardgame/shared';
import { GoRuleSet, GO_COLORS } from '@lan-boardgame/go';
import { GOMOKU_COLORS } from '@lan-boardgame/gomoku';
import { execute, queryOne, uuid } from '../db/connection.js';
import { upsertUserSession, removeUserSession, saveActiveRoom, removeActiveRoom, getOnlineCount, logRoomDestroyed } from '../room/RoomPersistence.js';
import { kataGoManager } from '../katago/KataGoManager.js';

interface ClientMessage {
  type: string;
  payload: Record<string, unknown>;
}

type HandlerFn = (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => void;

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
    // 房间管理
    this.handlers.set('create_room', this.handleCreateRoom.bind(this));
    this.handlers.set('join_room', this.handleJoinRoom.bind(this));
    this.handlers.set('leave_room', this.handleLeaveRoom.bind(this));
    this.handlers.set('get_rooms', this.handleGetRooms.bind(this));

    // 游戏操作
    this.handlers.set('start_ai_game', this.handleStartAIGame.bind(this));
    this.handlers.set('start_katago_game', this.handleStartKatagoGame.bind(this));
    this.handlers.set('place', this.handlePlace.bind(this));
    this.handlers.set('pass', this.handlePass.bind(this));
    this.handlers.set('apply_counting', this.handleApplyCounting.bind(this));
    this.handlers.set('counting_response', this.handleCountingResponse.bind(this));
    this.handlers.set('resign', this.handleResign.bind(this));
    this.handlers.set('rematch', this.handleRematch.bind(this));
    this.handlers.set('rematch_response', this.handleRematchResponse.bind(this));

    // 挑战
    this.handlers.set('challenge', this.handleChallenge.bind(this));
    this.handlers.set('challenge_response', this.handleChallengeResponse.bind(this));

    // 猜先
    this.handlers.set('guess_first_number', this.handleGuessFirstNumber.bind(this));
    this.handlers.set('guess_first_choice', this.handleGuessFirstChoice.bind(this));

    // 房间状态
    this.handlers.set('set_activity', this.handleSetActivity.bind(this));
    // 聊天
    this.handlers.set('rejoin_room', this.handleRejoinRoom.bind(this));
    this.handlers.set('chat', this.handleChat.bind(this));

    // 心跳
    this.handlers.set('ping', (_ws, _msg) => { /* handled by WSServer */ });
  }

  /** 更新棋钟（仅围棋） */
  private updateClock(room: Room, playerColor: string): void {
    if (room.gameType !== GameType.Go || !room.gameState) return;
    
    const now = Date.now();
    
    // 从 moveHistory 重新计算双方 totalTime
    let blackTotal = 0;
    let whiteTotal = 0;
    let prevAt = room.gameStartedAt || now;
    
    for (const move of room.moveHistory) {
      const moveTime = move.at - prevAt;
      if (move.color === 'black') {
        blackTotal += moveTime;
      } else {
        whiteTotal += moveTime;
      }
      prevAt = move.at;
    }
    
    // 记录落子方的步时（上一步实际用时），保留对手的 moveTime
    const elapsed = now - (room.gameState.clock?.lastMoveAt || now);
    const prevClock = room.gameState.clock;
    room.gameState = {
      ...room.gameState,
      clock: {
        black: { moveTime: playerColor === 'black' ? elapsed : (prevClock?.black.moveTime || 0), totalTime: blackTotal },
        white: { moveTime: playerColor === 'white' ? elapsed : (prevClock?.white.moveTime || 0), totalTime: whiteTotal },
        lastMoveAt: now,
        // 对手的回合开始时间（现在开始计时）
        blackTurnAt: playerColor === 'black' ? (prevClock?.blackTurnAt || now) : now,
        whiteTurnAt: playerColor === 'white' ? (prevClock?.whiteTurnAt || now) : now,
      },
    };
  }

  /** 分发消息 */
  dispatch(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'INVALID_JSON', '消息格式错误');
      return;
    }

    const handler = this.handlers.get(msg.type);
    if (!handler) {
      this.sendError(ws, 'UNKNOWN_TYPE', `未知消息类型: ${msg.type}`);
      return;
    }

    // 需要房间上下文的消息，先找房间
    const room = this.roomManager.findRoomByWs(ws);
    const player = room?.getPlayerByWs(ws);

    // 部分消息不需要房间上下文
    if (['create_room', 'join_room', 'get_rooms', 'ping', 'start_ai_game', 'start_katago_game', 'rejoin_room'].includes(msg.type)) {
      handler(ws, msg, player!, room!);
    } else if (player && room) {
      handler(ws, msg, player, room);
    } else {
      this.sendError(ws, 'NOT_IN_ROOM', '请先加入房间');
    }
  }

  // ── 房间管理 ──

  private handleCreateRoom(ws: WebSocket, msg: ClientMessage): void {
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

    const room = this.roomManager.createRoom(gameType, config, player);

    // 持久化
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
  }

  private handleJoinRoom(ws: WebSocket, msg: ClientMessage): void {
    const roomId = msg.payload.roomId as string;
    const username = (msg.payload.username as string) || '观战者';

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', '房间不存在');
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

    // 持久化
    upsertUserSession(player.id, player.username, room.roomId);
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, room.activity, room.players.map(p => p.id));

    // 告知加入者
    ws.send(JSON.stringify({
      type: 'room_joined',
      payload: {
        roomId: room.roomId,
        player: { id: player.id, username: player.username, color: player.color, isOwner: false },
        room: room.toSnapshot(),
      },
      timestamp: Date.now(),
    }));

    // 广播给其他人
    room.broadcastExcept({
      type: 'player_joined',
      payload: { player: { id: player.id, username: player.username, color: player.color } },
    }, player.id);

    // 广播房间状态更新
    room.broadcastExcept({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    }, '');

    // 如果双方到齐且 idle0，自动开始？
    // 这里先不发 game_start，等待 owner 或申请对局流程
  }

  private handleLeaveRoom(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    removeUserSession(player.id);
    if (player.isOwner) {
      // 房主离开 → 销毁房间
      if ((room as any)._katagoGame) kataGoManager.destroySession(room.roomId);
      removeActiveRoom(room.roomId);
      logRoomDestroyed(room.roomId);
      room.broadcast({
        type: 'room_destroyed',
        payload: { message: `👑 ${player.username} 离开房间，房间即将销毁` },
      });
      this.roomManager.destroyRoom(room.roomId);
    } else {
      const wasPlayer = room.players.some(p => p.id === player.id);
      room.removePlayer(player.id);

      if (wasPlayer && room.gameState?.phase === GamePhase.Playing) {
        // 对局中的玩家离开 → 判负终局
        const engine = this.getEngine(room.gameType, room.config);
        const result = engine.handleResign(room.gameState, player.color);
        this.enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, result);

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
      // 广播房间状态更新（刷新观众列表等）
      room.broadcastExcept({
        type: 'room_updated',
        payload: { room: room.toSnapshot() },
      }, '');
    }
  }

  private handleGetRooms(ws: WebSocket): void {
    let rooms = this.roomManager.getRoomList();
    
    // 过滤掉房主断线待销毁的房间
    const pendingIds = this.wsServer?.pendingDestruction ? 
      Array.from((this.wsServer as any).pendingDestruction.keys()) : [];
    rooms = rooms.filter(r => !pendingIds.includes(r.roomId));

    // 按游戏类型统计房间数和在线人数
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
  }

  // ── 游戏操作 ──

  private getEngine(gameType: GameType, config: GameConfig) {
    if (gameType === GameType.Gomoku) {
      return new GomokuEngine();
    }
    if (gameType === GameType.ChineseChess) {
      return new ChineseChessEngine();
    }
    if (gameType === GameType.Chess) {
      return new ChessEngine();
    }
    if (gameType === GameType.Draughts) {
      return new DraughtsEngine();
    }
    const ruleSet = (config.extra?.ruleSet as GoRuleSet) || GoRuleSet.Chinese;
    if (ruleSet === GoRuleSet.Japanese) {
      return new JapaneseGoEngine();
    }
    return new ChineseGoEngine();
  }

  private handlePlace(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      this.sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = this.getEngine(room.gameType, room.config);
    const pos = msg.payload.position as { row: number; col: number };
    console.log('[place] pos:', pos, 'board size:', room.gameState?.board?.length);

    // 中国象棋/国际象棋/国际跳棋需要 from 位置
    if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
      const from = msg.payload.from as { row: number; col: number } | undefined;
      if (from) {
        room.gameState = {
          ...room.gameState,
          extra: { ...room.gameState.extra, from },
        } as GameState;
      }
    }

    // 验证
    const validation = engine.validateMove(room.gameState, pos, player.color);
    if (!validation.valid) {
      this.sendError(ws, 'INVALID_MOVE', validation.reason || '非法走棋');
      return;
    }

    // 记录走棋
    const moveRecord: any = { color: player.color, row: pos.row, col: pos.col, at: Date.now() };
    if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
      const fromPos = (room.gameState.extra as any)?.from;
      if (fromPos) {
        moveRecord.fromRow = fromPos.row;
        moveRecord.fromCol = fromPos.col;
      }
    }
    room.moveHistory.push(moveRecord);

    // 执行
    room.gameState = engine.applyMove(room.gameState, pos, player.color);

    // 更新棋钟（仅围棋，在 applyMove 之后，避免被覆盖）
    this.updateClock(room, player.color);

    // 检查是否结束
    const result = engine.checkGameEnd(room.gameState);

    if (result) {
      this.enrichGameResult(room, result);
      room.gameState.phase = GamePhase.Finished;
      this.saveGameRecord(room, result);
      room.broadcast({
        type: 'game_over',
        payload: { result, gameState: room.gameState },
      });
    } else {
      room.broadcast({
        type: 'game_state',
        payload: { gameState: room.gameState },
      });

      // 如果轮到 AI，触发 AI 落子
      const hasAI = room.players.some(p => p.id.startsWith('ai-'));
      if (hasAI) {
        // KataGo 对弈：同步落子到 KataGo 进程，然后让 KataGo 回应
        if ((room as any)._katagoGame) {
          const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
          if (katagoPlayer && room.gameState.currentTurn === katagoPlayer.color) {
            // 先同步玩家的落子到 KataGo
            kataGoManager.playMove(room.roomId, player.color as 'black' | 'white', pos).then(() => {
              this.scheduleKataGoMove(room);
            }).catch(err => {
              console.error('[KataGo] 同步落子失败:', err);
              this.scheduleKataGoMove(room);
            });
          }
        } else {
          // 内置 AI 对弈
          let aiColor: string;
          if (room.gameType === GameType.Gomoku) aiColor = GOMOKU_COLORS.WHITE;
          else if (room.gameType === GameType.ChineseChess) aiColor = 'black';
          else if (room.gameType === GameType.Chess) aiColor = 'black';
          else if (room.gameType === GameType.Draughts) aiColor = 'black';
          else aiColor = GO_COLORS.WHITE;
          if (room.gameState.currentTurn === aiColor) {
            this.scheduleAIMove(room, engine);
          }
        }
      }
    }
  }

  private handlePass(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      this.sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = this.getEngine(room.gameType, room.config);
    room.gameState = engine.handlePass(room.gameState, player.color);

    // KataGo 对弈：同步 pass 到 KataGo 进程
    if ((room as any)._katagoGame) {
      const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
      if (katagoPlayer && room.gameState.currentTurn === katagoPlayer.color) {
        kataGoManager.passMove(room.roomId, player.color as 'black' | 'white').then(() => {
          this.scheduleKataGoMove(room);
        }).catch(err => {
          console.error('[KataGo] 同步 pass 失败:', err);
          this.scheduleKataGoMove(room);
        });
      }
    }

      const result = engine.checkGameEnd(room.gameState);
      if (result && room.gameState) {
        this.enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
      if ((room as any)._katagoGame) kataGoManager.destroySession(room.roomId);
      this.saveGameRecord(room, result);
      room.broadcast({
        type: 'game_over',
        payload: { result, gameState: room.gameState },
      });
    } else {
      room.broadcast({
        type: 'game_state',
        payload: { gameState: room.gameState },
      });
    }
  }

  private handleApplyCounting(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      this.sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    // 只有围棋支持申请终局数子
    if (room.gameType !== GameType.Go) {
      this.sendError(ws, 'NOT_SUPPORTED', '当前游戏不支持申请终局数子');
      return;
    }

    // 最少手数限制：至少下 50 手才能申请数子
    const moveCount = room.gameState.moveCount || 0;
    if (moveCount < 50) {
      this.sendError(ws, 'TOO_EARLY', `至少下 50 手后才能申请终局数子（当前 ${moveCount} 手）`);
      return;
    }

    const hasAI = room.players.some(p => p.id.startsWith('ai-'));

    // KataGo 对弈：让 KataGo 自己决定是否同意终局
    if ((room as any)._katagoGame) {
      const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
      if (!katagoPlayer) return;

      // 先同步玩家的 pass 到 KataGo，再让 KataGo 回应
      kataGoManager.passMove(room.roomId, player.color as 'black' | 'white').then(async () => {
        // 让 KataGo 生成一步棋（如果 KataGo 也 pass，则自然终局）
        const move = await kataGoManager.genMove(room.roomId, katagoPlayer.color as 'black' | 'white');

        if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

        const engine = this.getEngine(room.gameType, room.config);

        if (move === 'pass') {
          // KataGo 也 pass → 双方连续 pass，触发终局数子
          room.gameState = engine.handlePass(room.gameState, katagoPlayer.color);
          const result = engine.checkGameEnd(room.gameState);
          if (result) {
            this.enrichGameResult(room, result);
            room.gameState.phase = GamePhase.Finished;
            kataGoManager.destroySession(room.roomId);
            this.saveGameRecord(room, result);
            room.broadcast({
              type: 'game_over',
              payload: { result, gameState: room.gameState, message: '🤖 KataGo 同意终局数子' },
            });
          } else {
            // fallback：手动触发数子
            const manualResult = {
              winner: { id: '', name: '', color: 'black' },
              reason: 'score',
              scores: {},
            };
            this.enrichGameResult(room, manualResult);
            room.gameState.phase = GamePhase.Finished;
            kataGoManager.destroySession(room.roomId);
            this.saveGameRecord(room, manualResult);
            room.broadcast({
              type: 'game_over',
              payload: { result: manualResult, gameState: room.gameState, message: '🤖 KataGo 同意终局数子' },
            });
          }
        } else if (move === 'resign') {
          // KataGo 投子
          const result = engine.handleResign(room.gameState, katagoPlayer.color);
          this.enrichGameResult(room, result);
          room.gameState.phase = GamePhase.Finished;
          kataGoManager.destroySession(room.roomId);
          this.saveGameRecord(room, result);
          room.broadcast({
            type: 'game_over',
            payload: { result, gameState: room.gameState, message: '🤖 KataGo 投子认负' },
          });
        } else if (move && typeof move === 'object' && 'row' in move) {
          // KataGo 还要继续下 → 同意终局，但 KataGo 走了一步
          const validation = engine.validateMove(room.gameState, move, katagoPlayer.color);
          if (validation.valid) {
            room.moveHistory.push({ color: katagoPlayer.color, row: move.row, col: move.col, at: Date.now() });
            room.gameState = engine.applyMove(room.gameState, move, katagoPlayer.color);
            this.updateClock(room, katagoPlayer.color);
          } else {
            room.gameState = engine.handlePass(room.gameState, katagoPlayer.color);
          }

          const result = engine.checkGameEnd(room.gameState);
          if (result) {
            this.enrichGameResult(room, result);
            room.gameState.phase = GamePhase.Finished;
            kataGoManager.destroySession(room.roomId);
            this.saveGameRecord(room, result);
            room.broadcast({
              type: 'game_over',
              payload: { result, gameState: room.gameState },
            });
          } else {
            room.broadcast({
              type: 'game_state',
              payload: { gameState: room.gameState, message: '🤖 KataGo 认为还需要继续下' },
            });
          }
        }
      }).catch(err => {
        console.error('[KataGo] 终局数子错误:', err);
        this.sendError(ws, 'KATAGO_ERROR', 'KataGo 处理终局时出错');
      });
      return;
    }

    if (!hasAI) {
      // PvP：通知对手
      room.broadcastExcept({
        type: 'counting_request',
        payload: { playerId: player.id, username: player.username },
      }, player.id);
      ws.send(JSON.stringify({
        type: 'counting_sent',
        payload: { message: '已向对手申请终局数子' },
      }));
      return;
    }

    // AI 对弈：AI 判断是否同意
    const engine = this.getEngine(room.gameType, room.config);
    const aiPlayer = room.players.find(p => p.id.startsWith('ai-'));
    if (!aiPlayer) return;

    // AI 同意条件：连续 pass 已有 1 次，或 AI 认为自己没有好棋
    const extra = room.gameState.extra as any;
    const consecutivePasses = extra?.consecutivePasses || 0;
    const difficulty = (room as any)._aiDifficulty || 2;
    
    // 简单判断：如果已经 pass 过一次，或难度较低，同意终局
    let agree = false;
    if (consecutivePasses >= 1) {
      agree = true; // 已经 pass 过一次，同意终局
    } else if (difficulty <= 2) {
      agree = true; // 简单/普通难度，直接同意
    } else {
      // 困难：AI 评估形势，检查是否还有空位可下
      // 简化判断：棋盘空位少于 30% 时同意终局
      const totalCells = room.gameState.board.length * room.gameState.board[0].length;
      let emptyCount = 0;
      for (let r = 0; r < room.gameState.board.length; r++) {
        for (let c = 0; c < room.gameState.board[0].length; c++) {
          if (room.gameState.board[r][c] === null) emptyCount++;
        }
      }
      agree = emptyCount < totalCells * 0.3;
    }

    if (agree) {
      // AI 同意：双方都 pass，触发数子终局
      room.gameState = engine.handlePass(room.gameState, player.color);
      room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
      
      const result = engine.checkGameEnd(room.gameState);
      if (result) {
        this.enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, result);
        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState, message: '🤖 电脑同意终局数子' },
        });
      } else {
        // fallback：手动触发数子
        const manualResult = {
          winner: { id: '', name: '', color: 'black' },
          reason: 'score',
          scores: {},
        };
        this.enrichGameResult(room, manualResult);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, manualResult);
        room.broadcast({
          type: 'game_over',
          payload: { result: manualResult, gameState: room.gameState, message: '🤖 电脑同意终局数子' },
        });
      }
    } else {
      // AI 拒绝
      ws.send(JSON.stringify({
        type: 'counting_rejected',
        payload: { message: '🤖 电脑拒绝终局数子，继续对局' },
      }));
    }
  }

  private handleCountingResponse(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      this.sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const accepted = msg.payload.accepted as boolean;

    if (accepted) {
      // 对方同意：双方都 pass，触发数子终局
      const engine = this.getEngine(room.gameType, room.config);
      room.gameState = engine.handlePass(room.gameState, player.color);

      // 找到申请人（非当前玩家）也 pass
      const requester = room.players.find(p => p.id !== player.id && !p.id.startsWith('ai-'));
      if (requester) {
        room.gameState = engine.handlePass(room.gameState, requester.color);
      }

      const result = engine.checkGameEnd(room.gameState);
      if (result) {
        this.enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, result);
        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState, message: '双方同意终局数子' },
        });
      } else {
        // fallback：手动触发数子
        const manualResult = {
          winner: { id: '', name: '', color: 'black' },
          reason: 'score',
          scores: {},
        };
        this.enrichGameResult(room, manualResult);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, manualResult);
        room.broadcast({
          type: 'game_over',
          payload: { result: manualResult, gameState: room.gameState, message: '双方同意终局数子' },
        });
      }
    } else {
      // 对方拒绝：通知申请人
      const requester = room.players.find(p => p.id !== player.id && !p.id.startsWith('ai-'));
      if (requester && requester.ws) {
        requester.ws.send(JSON.stringify({
          type: 'counting_rejected',
          payload: { message: `${player.username} 拒绝终局数子，继续对局` },
        }));
      }
    }
  }

  private handleResign(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    console.log('[resign] called by', player.username, 'color:', player.color, 'turn:', room.gameState?.currentTurn);
    if (!room.gameState) {
      this.sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = this.getEngine(room.gameType, room.config);
    const result = engine.handleResign(room.gameState, player.color);
    console.log('[resign] result:', JSON.stringify(result));

    this.enrichGameResult(room, result);
    room.gameState.phase = GamePhase.Finished;
    if ((room as any)._katagoGame) kataGoManager.destroySession(room.roomId);
    this.saveGameRecord(room, result);

    room.broadcast({
      type: 'game_over',
      payload: { result, gameState: room.gameState },
    });
  }

  // ── 再战一局 ──

  private handleRematch(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    // 标记该玩家申请再战
    (room as any)._rematchPlayers = (room as any)._rematchPlayers || [];
    const rematchPlayers = (room as any)._rematchPlayers as string[];

    if (!rematchPlayers.includes(player.id)) {
      rematchPlayers.push(player.id);
    }

    // 通知自己：已申请
    ws.send(JSON.stringify({
      type: 'rematch_self',
      payload: { bothReady: rematchPlayers.length >= 2 },
    }));
    // 通知对方：对方申请再战（排除自己）
    const data_rematch = JSON.stringify({
      type: 'rematch_notify',
      payload: {
        playerId: player.id,
        username: player.username,
        bothReady: rematchPlayers.length >= 2,
      },
    });
    for (const p of room.players) {
      if (p.id !== player.id && p.ws && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data_rematch);
      }
    }

    // 如果双方都同意 → 立即新开一局
    const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
    if (rematchPlayers.length >= humanPlayers.length) {
      // 如果是 AI 对弈且 AI 被移除了，重新添加
      const hasAI = room.players.some(p => p.id.startsWith('ai-'));
      if (!hasAI && (room as any)._aiDifficulty) {
        let aiColor: string;
        if (room.gameType === GameType.ChineseChess) aiColor = 'black';
        else if (room.gameType === GameType.Chess) aiColor = 'black';
        else if (room.gameType === GameType.Draughts) aiColor = 'black';
        else if (room.gameType === GameType.Gomoku) aiColor = GOMOKU_COLORS.WHITE;
        else aiColor = GO_COLORS.WHITE;
        const aiPlayer: RoomPlayer = {
          id: 'ai-' + crypto.randomUUID().slice(0, 8),
          username: '🤖 电脑',
          color: aiColor,
          ws: null as any,
          isOwner: false,
          joinedAt: Date.now(),
        };
        room.players.push(aiPlayer);
      }

      const engine = this.getEngine(room.gameType, room.config);
      room.gameState = engine.createInitialState(room.config, []);
      room.moveHistory = [];
      room.activity = RoomActivity.Playing;
      (room as any)._rematchPlayers = [];
      this.logRoomActivity(room, 0);
      saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
        room.gameType, room.config, 'playing', room.players.map(p => p.id));

      room.broadcast({
        type: 'game_started',
        payload: {
          gameState: room.gameState,
          rematch: true,
          players: room.players.map(p => ({
            id: p.id, username: p.username, color: p.color, isAi: p.id.startsWith('ai-'),
          })),
        },
      });
    }
  }

  private handleRematchResponse(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    const roomAny = room as any;
    roomAny._rematchPlayers = roomAny._rematchPlayers || [];

    // 退出时移除 AI 玩家，人类非房主退回观战
    room.activity = RoomActivity.Idle0;
    const allPlayers = [...room.players];
    for (const p of allPlayers) {
      if (p.id.startsWith('ai-')) {
        // AI 直接移除
      } else if (!p.isOwner) {
        room.spectators.push(p);
      }
    }
    room.players = room.players.filter(p => p.isOwner && !p.id.startsWith('ai-'));

    room.broadcast({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    });

    room.broadcastToPlayers({
      type: 'rematch_exit',
      payload: { playerId: player.id, username: player.username },
    });
  }

  // ── AI 对弈 ──

  private handleStartAIGame(ws: WebSocket, msg: ClientMessage, _player: RoomPlayer, room: Room): void {
    if (!room || room.owner?.ws !== ws) {
      this.sendError(ws, 'NOT_OWNER', '只有房主能开始 AI 对弈');
      return;
    }

    const difficulty = (msg.payload.difficulty as number) || 2;
    const engine = this.getEngine(room.gameType, room.config);
    room.gameState = engine.createInitialState(room.config, []);
    room.moveHistory = [];
    room.activity = RoomActivity.Playing;
    this.logRoomActivity(room, 2);
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, 'playing', room.players.map(p => p.id));

    // 初始化棋钟（仅围棋）
    if (room.gameType === GameType.Go) {
      room.gameStartedAt = Date.now();
      room.gameState = {
        ...room.gameState,
        clock: {
          black: { moveTime: 0, totalTime: 0 },
          white: { moveTime: 0, totalTime: 0 },
          lastMoveAt: room.gameStartedAt,
          blackTurnAt: room.gameStartedAt,
          whiteTurnAt: room.gameStartedAt,
        },
      };
    }

    // 确定颜色
    let playerColor: string, aiColor: string;
    if (room.gameType === GameType.ChineseChess) {
      playerColor = 'red';
      aiColor = 'black';
    } else if (room.gameType === GameType.Chess) {
      playerColor = 'white';
      aiColor = 'black';
    } else if (room.gameType === GameType.Draughts) {
      playerColor = 'white';
      aiColor = 'black';
    } else if (room.gameType === GameType.Gomoku) {
      playerColor = 'black';
      aiColor = GOMOKU_COLORS.WHITE;
    } else {
      playerColor = 'black';
      aiColor = GO_COLORS.WHITE;
    }

    // 设置房主颜色
    if (room.owner) room.owner.color = playerColor;

    // 设置 AI
    const aiPlayer: RoomPlayer = {
      id: 'ai-' + crypto.randomUUID().slice(0, 8),
      username: '🤖 电脑',
      color: aiColor,
      ws: null as any,
      isOwner: false,
      joinedAt: Date.now(),
    };
    room.players.push(aiPlayer);

    // 存储 AI 难度
    (room as any)._aiDifficulty = difficulty;
    (room as any)._aiConsecutivePasses = 0;

    room.broadcast({
      type: 'game_started',
      payload: {
        gameState: room.gameState,
        players: room.players.map(p => ({
          id: p.id,
          username: p.username,
          color: p.color,
          isAi: p.id.startsWith('ai-'),
        })),
      },
    });
  }

  // ── KataGo 对弈 ──

  private handleStartKatagoGame(ws: WebSocket, msg: ClientMessage, _player: RoomPlayer, room: Room): void {
    if (!room || room.owner?.ws !== ws) {
      this.sendError(ws, 'NOT_OWNER', '只有房主能开始 KataGo 对弈');
      return;
    }

    if (room.gameType !== GameType.Go) {
      this.sendError(ws, 'NOT_SUPPORTED', 'KataGo 仅支持围棋');
      return;
    }

    const boardSize = (msg.payload.boardSize as number) || 19;
    const rules = (msg.payload.rules as 'chinese' | 'japanese') || 'chinese';
    const maxVisits = (msg.payload.maxVisits as number) || 1000;
    const playerColor = (msg.payload.playerColor as 'black' | 'white') || 'black';
    const komi = rules === 'japanese' ? 6.5 : 7.5;

    console.log(`[KataGo] 开始对弈 boardSize=${boardSize} rules=${rules} visits=${maxVisits} player=${playerColor}`);

    // 启动 KataGo 会话（异步，用 .then 链式处理）
    kataGoManager.startSession(room.roomId, { boardSize, rules, komi, maxVisits })
      .then(() => kataGoManager.initializeBoard(room.roomId))
      .then(() => {
        // 创建游戏状态
        const config = { ...room.config };
        config.rows = boardSize;
        config.cols = boardSize;
        config.extra = { ...config.extra, boardSize, ruleSet: rules, komi, handicap: 0 };

        const engine = this.getEngine(room.gameType, config);
        room.gameState = engine.createInitialState(config, []);
        room.moveHistory = [];
        room.activity = RoomActivity.Playing;
        this.logRoomActivity(room, 2);
        saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
          room.gameType, room.config, 'playing', room.players.map(p => p.id));

        // 初始化棋钟
        room.gameStartedAt = Date.now();
        room.gameState = {
          ...room.gameState,
          clock: {
            black: { moveTime: 0, totalTime: 0 },
            white: { moveTime: 0, totalTime: 0 },
            lastMoveAt: room.gameStartedAt,
            blackTurnAt: room.gameStartedAt,
            whiteTurnAt: room.gameStartedAt,
          },
        };

        // 设置房主颜色
        if (room.owner) room.owner.color = playerColor;

        // 添加 KataGo AI 玩家
        const aiColor = playerColor === 'black' ? 'white' : 'black';
        const aiPlayer: RoomPlayer = {
          id: 'ai-katago-' + crypto.randomUUID().slice(0, 8),
          username: '🤖 KataGo',
          color: aiColor,
          ws: null as any,
          isOwner: false,
          joinedAt: Date.now(),
        };
        room.players.push(aiPlayer);

        // 标记为 KataGo 对弈
        (room as any)._katagoGame = true;
        (room as any)._katagoBoardSize = boardSize;

        room.broadcast({
          type: 'game_started',
          payload: {
            gameState: room.gameState,
            players: room.players.map(p => ({
              id: p.id,
              username: p.username,
              color: p.color,
              isAi: p.id.startsWith('ai-'),
            })),
          },
        });

        // 如果 KataGo 先手（玩家执白），立即让 KataGo 走第一步
        if (playerColor === 'white') {
          this.scheduleKataGoMove(room);
        }
      })
      .catch(err => {
        console.error('[KataGo] 启动失败:', err);
        this.sendError(ws, 'KATAGO_ERROR', `KataGo 启动失败: ${(err as Error).message}`);
      });
  }

  /** 安排 KataGo 走棋 */
  private scheduleKataGoMove(room: Room): void {
    setTimeout(async () => {
      if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;
      if (!(room as any)._katagoGame) return;

      const aiPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
      if (!aiPlayer) return;
      if (room.gameState.currentTurn !== aiPlayer.color) return;

      const engine = this.getEngine(room.gameType, room.config);
      const boardSize = (room as any)._katagoBoardSize || 19;

      try {
        const move = await kataGoManager.genMove(room.roomId, aiPlayer.color as 'black' | 'white');

        if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

        if (move === 'pass') {
          room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
        } else if (move === 'resign') {
          const result = engine.handleResign(room.gameState, aiPlayer.color);
          this.enrichGameResult(room, result);
          room.gameState.phase = GamePhase.Finished;
          kataGoManager.destroySession(room.roomId);
          this.saveGameRecord(room, result);
          room.broadcast({
            type: 'game_over',
            payload: { result, gameState: room.gameState, message: '🤖 KataGo 投子认负' },
          });
          return;
        } else if (move && typeof move === 'object' && 'row' in move) {
          const validation = engine.validateMove(room.gameState, move, aiPlayer.color);
          if (validation.valid) {
            room.moveHistory.push({ color: aiPlayer.color, row: move.row, col: move.col, at: Date.now() });
            room.gameState = engine.applyMove(room.gameState, move, aiPlayer.color);
            this.updateClock(room, aiPlayer.color);
          } else {
            // 验证失败，尝试 pass
            room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
          }
        } else {
          // 无效响应，pass
          room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
        }

        // 检查终局
        const result = engine.checkGameEnd(room.gameState);
        if (result) {
          this.enrichGameResult(room, result);
          room.gameState.phase = GamePhase.Finished;
          kataGoManager.destroySession(room.roomId);
          this.saveGameRecord(room, result);
          room.broadcast({
            type: 'game_over',
            payload: { result, gameState: room.gameState },
          });
        } else {
          room.broadcast({
            type: 'game_state',
            payload: { gameState: room.gameState },
          });
        }
      } catch (err) {
        console.error('[KataGo] 走棋错误:', err);
        // 出错时 pass
        room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
        room.broadcast({
          type: 'game_state',
          payload: { gameState: room.gameState, message: 'KataGo 出错，自动 pass' },
        });
      }
    }, 500); // 短暂延迟，让 UI 先更新
  }

  /** 安排 AI 走棋（1.5 秒延迟，模拟思考） */
  private scheduleAIMove(room: Room, engine: any): void {
    setTimeout(() => {
      if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

      let aiColor: string;
      if (room.gameType === GameType.Gomoku) {
        aiColor = GOMOKU_COLORS.WHITE;
      } else if (room.gameType === GameType.ChineseChess) {
        aiColor = 'black';
      } else if (room.gameType === GameType.Chess) {
        aiColor = 'black';
      } else if (room.gameType === GameType.Draughts) {
        aiColor = 'black';
      } else {
        aiColor = GO_COLORS.WHITE;
      }
      if (room.gameState.currentTurn !== aiColor) return;

      if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
        // 中国象棋/国际象棋/国际跳棋 AI 返回 { from, to }
        const difficulty = (room as any)._aiDifficulty || 3;
        const moveResult = room.gameType === GameType.ChineseChess
          ? selectChineseChessAIMove(room.gameState, aiColor, difficulty)
          : room.gameType === GameType.Chess
            ? selectChessAIMove(room.gameState, aiColor, difficulty)
            : selectDraughtsAIMove(room.gameState, aiColor, difficulty);
        if (!moveResult) return;

        // 设置 from 位置
        room.gameState = {
          ...room.gameState,
          extra: { ...room.gameState.extra, from: moveResult.from },
        } as GameState;

        const validation = engine.validateMove(room.gameState, moveResult.to, aiColor);
        if (validation.valid) {
          room.moveHistory.push({ color: aiColor, row: moveResult.to.row, col: moveResult.to.col, fromRow: moveResult.from.row, fromCol: moveResult.from.col, at: Date.now() });
          room.gameState = engine.applyMove(room.gameState, moveResult.to, aiColor);
          this.updateClock(room, aiColor);
        }
      } else {
        const difficulty = (room as any)._aiDifficulty || 2;
        const move = room.gameType === GameType.Gomoku
          ? selectGomokuAIMove(room.gameState, aiColor, difficulty)
          : selectAIMove(room.gameState, aiColor, difficulty);

        if (move === null) {
          room.gameState = engine.handlePass(room.gameState, aiColor);
          // AI 连续 pass 计数
          (room as any)._aiConsecutivePasses = ((room as any)._aiConsecutivePasses || 0) + 1;
        } else {
          const validation = engine.validateMove(room.gameState, move, aiColor);
          if (!validation.valid) {
            room.gameState = engine.handlePass(room.gameState, aiColor);
            (room as any)._aiConsecutivePasses = ((room as any)._aiConsecutivePasses || 0) + 1;
          } else {
            room.moveHistory.push({ color: aiColor, row: move.row, col: move.col, at: Date.now() });
            room.gameState = engine.applyMove(room.gameState, move, aiColor);
            this.updateClock(room, aiColor);
            (room as any)._aiConsecutivePasses = 0;
          }
        }
      }

      // AI 连续 pass 2 次 → 自动终局数子
      if ((room as any)._aiConsecutivePasses >= 2) {
        (room as any)._aiConsecutivePasses = 0;
        room.broadcast({
          type: 'game_state',
          payload: { gameState: room.gameState, message: '🤖 电脑已放弃，对局结束' },
        });
        // 触发数子终局
        setTimeout(() => {
          if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;
          const result = engine.checkGameEnd(room.gameState);
          if (result) {
            this.enrichGameResult(room, result);
            room.gameState.phase = GamePhase.Finished;
            this.saveGameRecord(room, result);
            room.broadcast({
              type: 'game_over',
              payload: { result, gameState: room.gameState },
            });
          } else {
            // 如果 checkGameEnd 没触发（比如 consecutivePasses 还没到 2），手动构造终局
            const opponentColor = aiColor === 'black' ? 'white' : 'black';
            const manualResult = {
              winner: { id: '', name: '', color: opponentColor },
              reason: 'score',
              scores: {},
            };
            this.enrichGameResult(room, manualResult);
            room.gameState.phase = GamePhase.Finished;
            this.saveGameRecord(room, manualResult);
            room.broadcast({
              type: 'game_over',
              payload: { result: manualResult, gameState: room.gameState },
            });
          }
        }, 1000);
        return;
      }

      if (!room.gameState) return;
      
      const result = engine.checkGameEnd(room.gameState);
      if (result) {
        this.enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        this.saveGameRecord(room, result);
        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState },
        });
      } else {
        room.broadcast({
          type: 'game_state',
          payload: { gameState: room.gameState },
        });
      }
    }, 1500);
  }

  // ── 挑战系统 ──

  private handleChallenge(ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room): void {
    // 只有非房主可以挑战
    if (player.isOwner) {
      this.sendError(ws, 'CANNOT_CHALLENGE', '房主不能挑战自己');
      return;
    }

    // 房主必须空闲（非对局、非AI对弈）
    if (room.activity === RoomActivity.Playing || room.activity === RoomActivity.Idle2) {
      this.sendError(ws, 'OWNER_BUSY', '房主对局中，请稍后申请');
      return;
    }

    // 已有挑战进行中
    if (room.challenge) {
      this.sendError(ws, 'CHALLENGE_EXISTS', '已有挑战进行中');
      return;
    }

    // 创建挑战
    room.challenge = { challengerId: player.id, createdAt: Date.now() };

    // 设置 60 秒超时自动拒绝
    const challengeTimer = setTimeout(() => {
      if (room.challenge?.challengerId === player.id) {
        room.sendTo(room.owner!.id, {
          type: 'challenge_timeout',
          payload: { playerId: player.id, message: '申请超时，已自动取消' },
        });
        ws.send(JSON.stringify({
          type: 'challenge_timeout',
          payload: { message: '申请超时，已自动取消' },
        }));
        room.challenge = null;
        (room as any)._challengeTimer = null;
      }
    }, 60000);
    (room as any)._challengeTimer = challengeTimer;

    // 通知房主
    room.sendTo(room.owner!.id, {
      type: 'challenge_request',
      payload: {
        challenger: { id: player.id, username: player.username },
        timeout: 60,
      },
    });

    // 通知申请人
    ws.send(JSON.stringify({
      type: 'challenge_sent',
      payload: { message: `已向 👑${room.owner?.username} 申请对局`, timeout: 60 },
    }));
  }

  private handleChallengeResponse(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (!player.isOwner) {
      this.sendError(ws, 'NOT_OWNER', '只有房主能回应挑战');
      return;
    }

    if (!room.challenge) {
      this.sendError(ws, 'NO_CHALLENGE', '没有待处理的挑战');
      return;
    }

    const accepted = msg.payload.accepted as boolean;
    // 清除超时定时器
    if ((room as any)._challengeTimer) {
      clearTimeout((room as any)._challengeTimer);
      (room as any)._challengeTimer = null;
    }
    const challenger = room.getAllPlayers().find(p => p.id === room.challenge!.challengerId);

    if (!challenger) {
      room.challenge = null;
      return;
    }

    if (accepted) {
      // 接受挑战 → 进入猜先阶段
      if (!room.players.some(p => p.id === challenger.id)) {
        room.players.push(challenger);
        room.spectators = room.spectators.filter(p => p.id !== challenger.id);
      }

      room.challenge = null;
      room.activity = RoomActivity.Playing;

      // 进入猜先阶段
      (room as any)._guessFirst = {
        challengerId: challenger.id,
        number: null,
        choice: null,
        phase: 'waiting_number', // waiting_number → waiting_choice → done
      };

      // 通知双方进入猜先
      room.broadcast({
        type: 'guess_first_start',
        payload: {
          challenger: { id: challenger.id, username: challenger.username },
          owner: { id: room.owner!.id, username: room.owner!.username },
        },
      });

      // 通知申请人填数字（发给申请人，不是房主）
      room.sendTo(challenger.id, {
        type: 'guess_first_prompt_number',
        payload: { message: '请输入一个 1-20 的数字' },
      });

      // 通知房主进入猜先等待状态
      room.sendTo(room.owner!.id, {
        type: 'guess_first_prompt_choice',
        payload: { message: `${challenger.username} 填写数字中...`, waiting: true, challenger: challenger.username },
      });

      // 先回复房主：弹窗关闭
      room.sendTo(room.owner!.id, {
        type: 'challenge_response',
        payload: { accepted: true, message: '已接受' },
      });
      // 广播房间状态更新
      room.broadcast({
        type: 'room_updated',
        payload: { room: room.toSnapshot() },
      });
    } else {
      // 拒绝
      room.challenge = null;
      room.sendTo(challenger.id, {
        type: 'challenge_response',
        payload: { accepted: false, message: `👑${player.username} 拒绝对局` },
      });
      ws.send(JSON.stringify({
        type: 'challenge_response',
        payload: { accepted: false, message: '已拒绝' },
      }));
    }
  }

  // ── 猜先系统 ──

  private handleGuessFirstNumber(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    const gf = (room as any)._guessFirst;
    if (!gf || gf.phase !== 'waiting_number') {
      this.sendError(ws, 'INVALID_PHASE', '当前不是猜先阶段');
      return;
    }
    if (gf.challengerId !== player.id) {
      this.sendError(ws, 'NOT_CHALLENGER', '只有申请人可以出拳');
      return;
    }

    const isCC = room.gameType === GameType.ChineseChess;
    const isIC = room.gameType === GameType.Chess;
    const isD = room.gameType === GameType.Draughts;

    if (isCC || isIC || isD) {
      // 中国象棋/国际象棋：石头剪刀布
      const rps = msg.payload.rps as string;
      if (!['rock', 'scissors', 'paper'].includes(rps)) {
        this.sendError(ws, 'INVALID_RPS', '请选择石头、剪刀或布');
        return;
      }
      gf.number = rps; // 复用 number 字段存 rps 选择
    } else {
      // 围棋/五子棋：猜单双
      const number = msg.payload.number as number;
      if (!Number.isInteger(number) || number < 1 || number > 20) {
        this.sendError(ws, 'INVALID_NUMBER', '请输入 1-20 的整数');
        return;
      }
      gf.number = number;
    }

    gf.phase = 'waiting_choice';

    ws.send(JSON.stringify({
      type: 'guess_first_number_submitted',
      payload: { message: '已提交，等待对方选择' },
    }));

    room.sendTo(room.owner!.id, {
      type: 'guess_first_prompt_choice',
      payload: { message: `${player.username} 已选好，请选择`, challenger: player.username },
    });
  }

  private handleGuessFirstChoice(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    const gf = (room as any)._guessFirst;
    if (!gf || gf.phase !== 'waiting_choice') {
      this.sendError(ws, 'INVALID_PHASE', '当前不是猜先阶段');
      return;
    }
    if (!player.isOwner) {
      this.sendError(ws, 'NOT_OWNER', '只有房主可以回应');
      return;
    }

    const isCC = room.gameType === GameType.ChineseChess;
    const isIC = room.gameType === GameType.Chess;
    const isD = room.gameType === GameType.Draughts;
    let challengerColor: string, ownerColor: string;

    if (isCC || isIC || isD) {
      // 中国象棋/国际象棋：石头剪刀布
      const choice = msg.payload.choice as string;
      if (!['rock', 'scissors', 'paper'].includes(choice)) {
        this.sendError(ws, 'INVALID_RPS', '请选择石头、剪刀或布');
        return;
      }

      const rps = gf.number; // challenger 的选择
      const rpsNames: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };

      // 判断输赢
      const winMap: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
      const challengerWins = winMap[rps] === choice;
      const ownerWins = winMap[choice] === rps;

      const winFirstColor = (isIC || isD) ? 'white' : 'red';
      const winSecondColor = 'black';

      if (challengerWins) {
        challengerColor = winFirstColor;
        ownerColor = winSecondColor;
      } else if (ownerWins) {
        challengerColor = winSecondColor;
        ownerColor = winFirstColor;
      } else {
        // 平局，简单处理：申请人执先手颜色
        challengerColor = winFirstColor;
        ownerColor = winSecondColor;
      }

      // 广播结果
      room.broadcast({
        type: 'guess_first_result',
        payload: {
          number: rpsNames[rps],
          choice: rpsNames[choice],
          challengerChoice: rps,
          ownerChoice: choice,
          isOdd: false,
          guessCorrect: challengerWins,
          challenger: { id: room.players.find(p => p.id === gf.challengerId)?.id, username: room.players.find(p => p.id === gf.challengerId)?.username, color: challengerColor },
          owner: { id: room.owner?.id, username: room.owner?.username, color: ownerColor },
        },
      });
    } else {
      // 围棋/五子棋：猜单双
      const choice = msg.payload.choice as string;
      if (choice !== 'odd' && choice !== 'even') {
        this.sendError(ws, 'INVALID_CHOICE', '请选择单或双');
        return;
      }

      const isOdd = (gf.number as number) % 2 === 1;
      const guessCorrect = (choice === 'odd' && isOdd) || (choice === 'even' && !isOdd);

      // 猜对的人执黑（先手），猜错的人执白（后手）
      challengerColor = guessCorrect ? 'white' : 'black';
      ownerColor = guessCorrect ? 'black' : 'white';

      room.broadcast({
        type: 'guess_first_result',
        payload: {
          number: gf.number,
          choice: choice === 'odd' ? '单' : '双',
          isOdd,
          guessCorrect,
          challenger: { id: room.players.find(p => p.id === gf.challengerId)?.id, username: room.players.find(p => p.id === gf.challengerId)?.username, color: challengerColor },
          owner: { id: room.owner?.id, username: room.owner?.username, color: ownerColor },
        },
      });
    }

    // 分配颜色
    const challenger = room.players.find(p => p.id === gf.challengerId);
    if (challenger) challenger.color = challengerColor;
    if (room.owner) room.owner.color = ownerColor;

    (room as any)._guessFirst = null;

    setTimeout(() => {
      this.startPvpGame(room);
    }, 2500);
  }

  private startPvpGame(room: Room): void {
    const engine = this.getEngine(room.gameType, room.config);
    room.gameState = engine.createInitialState(room.config, []);
    room.moveHistory = [];
    this.logRoomActivity(room, 0);
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, 'playing', room.players.map(p => p.id));

    // 初始化棋钟（仅围棋）
    if (room.gameType === GameType.Go) {
      room.gameStartedAt = Date.now();
      room.gameState = {
        ...room.gameState,
        clock: {
          black: { moveTime: 0, totalTime: 0 },
          white: { moveTime: 0, totalTime: 0 },
          lastMoveAt: room.gameStartedAt,
          blackTurnAt: room.gameStartedAt,
          whiteTurnAt: room.gameStartedAt,
        },
      };
    }

    room.broadcast({
      type: 'game_started',
      payload: {
        gameState: room.gameState,
        players: room.players.map(p => ({
          id: p.id, username: p.username, color: p.color, isAi: p.id.startsWith('ai-'),
        })),
      },
    });
  }

  // ── 房间状态 ──

  private handleSetActivity(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    if (!player.isOwner) {
      this.sendError(ws, 'NOT_OWNER', '只有房主能修改房间状态');
      return;
    }

    const activity = msg.payload.activity as string;
    const validActivities = ['idle_0', 'idle_1', 'idle_2'];
    if (!validActivities.includes(activity)) {
      this.sendError(ws, 'INVALID_ACTIVITY', '无效的房间状态');
      return;
    }

    room.activity = activity as RoomActivity;

    // 记录 idle 类型
    const idleMap: Record<string, number> = { idle_0: 0, idle_1: 1, idle_2: 2 };
    this.logRoomActivity(room, idleMap[activity] ?? 0);

    // 同步到 DB
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, activity, room.players.map(p => p.id));

    // 广播房间状态更新
    room.broadcast({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    });
  }

  // ── 重连 ──

  private handleRejoinRoom(ws: WebSocket, msg: ClientMessage): void {
    const roomId = msg.payload.roomId as string;
    const playerId = msg.payload.playerId as string;

    if (!roomId || !playerId) {
      this.sendError(ws, 'INVALID_REJOIN', '缺少房间ID或玩家ID');
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      this.sendError(ws, 'ROOM_GONE', '房间已销毁，无法重连');
      return;
    }

    // 查找玩家
    const allPlayers = room.getAllPlayers();
    const player = allPlayers.find(p => p.id === playerId);
    if (!player) {
      this.sendError(ws, 'NOT_IN_ROOM', '您不在该房间中');
      return;
    }

    // 更新 WebSocket 连接
    player.ws = ws;

    // 取消房主销毁倒计时（如果有）
    if (this.wsServer?.cancelPendingDestruction) {
      this.wsServer.cancelPendingDestruction(roomId);
    }

    // 重新建立用户会话
    upsertUserSession(player.id, player.username, roomId);

    // 推送完整房间状态
    ws.send(JSON.stringify({
      type: 'room_joined',
      payload: {
        roomId: room.roomId,
        player: { id: player.id, username: player.username, color: player.color, isOwner: player.isOwner },
        room: room.toSnapshot(),
      },
      timestamp: Date.now(),
    }));

    // 推送聊天历史（重连时能看到全部消息）
    for (const msg of room.chatMessages) {
      ws.send(JSON.stringify({ type: 'chat', payload: msg }));
    }

    // 推送游戏状态（如果有）
    if (room.gameState) {
      ws.send(JSON.stringify({
        type: 'game_started',
        payload: {
          gameState: room.gameState,
          players: room.players.map(p => ({
            id: p.id, username: p.username, color: p.color, isAi: p.id.startsWith('ai-'),
          })),
        },
      }));
    }

    // 广播给其他人：该玩家已重连 + 房间更新
    room.broadcastExcept({
      type: 'room_updated',
      payload: { room: room.toSnapshot() },
    }, player.id);
    room.broadcastExcept({
      type: 'player_rejoined',
      payload: { playerId: player.id, username: player.username },
    }, player.id);
  }

  // ── 聊天 ──

  private handleChat(ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room): void {
    const text = msg.payload.text as string;
    if (!text || !text.trim()) return;
    this.chatHandler.addMessage(room, player, text);
  }

  // ── 保存对局记录 ──

  private saveGameRecord(room: Room, result: any): void {
    try {
      const moves = room.moveHistory;
      const players = room.players.map(p => ({ id: p.id, name: p.username, color: p.color }));

      // 生成棋谱
      const isChineseChess = room.gameType === GameType.ChineseChess;
      const isChess = room.gameType === GameType.Chess;
      const isDraughts = room.gameType === GameType.Draughts;
      const needsPgn = isChineseChess || isChess;
      const sgf = (needsPgn || isDraughts) ? null : this.generateSGF(room, result);
      const pgn = isChineseChess ? this.generateChineseChessPGN(room, result)
                : isChess ? this.generateChessPGN(room, result)
                : null;
      const pdn = isDraughts ? this.generateDraughtsPDN(room, result) : null;

      execute(
        `INSERT INTO game_records (id, game_type, rule_set, board_size, players, winner_id, reason, moves, sgf, pgn, pdn, scores, created_at, duration_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)`,
        [
          uuid(),
          room.gameType,
          room.config.extra?.ruleSet || 'chinese',
          room.config.rows || 19,
          JSON.stringify(players),
          result?.winner?.id || '',
          result?.reason || '',
          JSON.stringify(moves),
          sgf,
          pgn,
          pdn,
          JSON.stringify(result?.scores || {}),
          Math.floor((Date.now() - room.createdAt) / 1000),
        ]
      );
      // 更新用户统计数据（通过 username 查找真实用户 ID）
      for (const p of players) {
        if (p.id.startsWith('ai-')) continue;
        const user = queryOne('SELECT id FROM users WHERE username = ?', [p.name]) as any;
        if (user) {
          execute('UPDATE users SET total_games = total_games + 1 WHERE id = ?', [user.id]);
        }
      }
      if (result?.winner?.id && !result.winner.id.startsWith('ai-')) {
        const winnerUser = queryOne('SELECT id FROM users WHERE username = ?', [result.winner.name || '']) as any;
        if (winnerUser) {
          execute('UPDATE users SET win_games = win_games + 1 WHERE id = ?', [winnerUser.id]);
        }
      }
    } catch (e) {
      console.error('[DB] 保存对局记录失败:', e);
    }
  }

  /** 生成 SGF 棋谱 */
  private generateSGF(room: Room, result: any): string {
    const size = room.config.rows || 19;
    const ruleSet = (room.config.extra?.ruleSet as string) || 'chinese';
    const komi = ruleSet === 'japanese' ? '6.5' : '7.5';

    let sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]KM[${komi}]RU[${ruleSet}]`;

    // 添加玩家信息
    const isKatago = !!(room as any)._katagoGame;
    const players = isKatago
      ? room.players  // KataGo 对弈：显示所有玩家（包括 KataGo）
      : room.players.filter(p => !p.id.startsWith('ai-'));  // 普通 AI：只显示人类
    for (const p of players) {
      const letter = p.color === 'black' ? 'B' : 'W';
      sgf += `${letter}N[${p.username}]`;
    }

    // 添加走棋记录
    const letters = 'abcdefghijklmnopqrs';
    for (const move of room.moveHistory) {
      const colLetter = letters[move.col] || 'a';
      const rowLetter = letters[move.row] || 'a';
      const color = move.color === 'black' ? 'B' : 'W';
      sgf += `;${color}[${colLetter}${rowLetter}]`;
    }

    // 添加结果
    if (result) {
      let resultStr = '';
      if (result.reason === 'resign') {
        resultStr = result.winner?.color === 'black' ? 'B+R' : 'W+R';
      } else if (result.reason === 'score') {
        const size = room.config.rows || 19;
        const baseNumber = (size * size) / 2;
        const komi = 3.75;
        const blackMargin = (result.scores?.black || 0) - (baseNumber + komi);
        const whiteMargin = (result.scores?.white || 0) - (baseNumber - komi);
        if (result.winner?.color === 'black') {
          resultStr = `B+${blackMargin.toFixed(1)}`;
        } else if (result.winner?.color === 'white') {
          resultStr = `W+${whiteMargin.toFixed(1)}`;
        } else {
          resultStr = 'Void';
        }
      } else if (result.reason === 'disconnect') {
        resultStr = result.winner?.color === 'black' ? 'B+T' : 'W+T';
      } else {
        resultStr = 'Void';
      }
      sgf += `RE[${resultStr}]`;
    }

    sgf += ')';
    return sgf;
  }

  /** 生成中国象棋 PGN 棋谱 */
  private generateChineseChessPGN(room: Room, result: any): string {
    const PIECE_NAMES: Record<string, Record<string, string>> = {
      king: { red: '帅', black: '将' },
      advisor: { red: '仕', black: '士' },
      bishop: { red: '相', black: '象' },
      knight: { red: '馬', black: '马' },
      rook: { red: '車', black: '车' },
      cannon: { red: '砲', black: '炮' },
      pawn: { red: '兵', black: '卒' },
    };
    const COL_LETTERS = 'abcdefghi';

    let pgn = '';
    const moves = room.moveHistory;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i] as any;
      if (m.fromRow === undefined) continue;

      const piece = (room.gameState as any)?.board?.[m.row]?.[m.col];
      // 从初始棋盘推断棋子类型
      const fromPiece = this.getPieceAtInitialBoard(room, m);
      const pieceType = fromPiece?.replace('red_', '').replace('black_', '') || '';
      const name = PIECE_NAMES[pieceType]?.[m.color] || '棋';

      const fromCol = COL_LETTERS[m.fromCol] || '?';
      const fromRow = 10 - m.fromRow;
      const toCol = COL_LETTERS[m.col] || '?';
      const toRow = 10 - m.row;

      const dir = m.fromRow > m.row ? '进' : m.fromRow < m.row ? '退' : '平';
      const numFrom = ['一','二','三','四','五','六','七','八','九'][m.fromCol] || '?';
      const numTo = ['一','二','三','四','五','六','七','八','九'][m.col] || '?';

      let moveStr: string;
      if (m.fromCol === m.col) {
        // 直线移动
        moveStr = `${name}${numFrom}${dir}${Math.abs(fromRow - toRow)}`;
      } else {
        // 横向移动
        moveStr = `${name}${numFrom}${dir}${numTo}`;
      }

      if (i % 2 === 0) {
        pgn += `${Math.floor(i / 2) + 1}. ${moveStr} `;
      } else {
        pgn += `${moveStr} `;
      }
    }

    // 结果
    if (result?.winner) {
      pgn += result.winner.color === 'red' ? '1-0' : '0-1';
    } else {
      pgn += '1/2-1/2';
    }

    return pgn.trim();
  }

  /** 生成国际象棋 PGN 棋谱 */
  private generateChessPGN(room: Room, result: any): string {
    const COL = 'abcdefgh';
    const PIECE_LETTER: Record<string, string> = {
      king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '',
    };

    // 从初始棋盘推断棋子类型
    const INIT_BOARD: Record<string, string> = {};
    const BACK = ['rook','knight','bishop','queen','king','bishop','knight','rook'];
    for (let c = 0; c < 8; c++) {
      INIT_BOARD[`7,${c}`] = `white_${BACK[c]}`;
      INIT_BOARD[`0,${c}`] = `black_${BACK[c]}`;
      INIT_BOARD[`6,${c}`] = 'white_pawn';
      INIT_BOARD[`1,${c}`] = 'black_pawn';
    }

    // 重建棋盘以推断每步的棋子
    const board = { ...INIT_BOARD };
    let pgn = '';

    for (let i = 0; i < room.moveHistory.length; i++) {
      const m = room.moveHistory[i] as any;
      const fromKey = `${m.fromRow},${m.fromCol}`;
      const piece = board[fromKey] || '';
      const pieceType = piece.replace('white_', '').replace('black_', '');
      const letter = PIECE_LETTER[pieceType] || '';

      const from = `${COL[m.fromCol]}${8 - m.fromRow}`;
      const to = `${COL[m.col]}${8 - m.row}`;

      // 吃子检测
      const captured = board[`${m.row},${m.col}`];
      const captureSymbol = captured ? 'x' : '';

      // 王车易位
      let notation: string;
      if (pieceType === 'king' && Math.abs(m.col - m.fromCol) === 2) {
        notation = m.col > m.fromCol ? 'O-O' : 'O-O-O';
      } else {
        notation = `${letter}${from}${captureSymbol}${to}`;
      }

      if (i % 2 === 0) {
        pgn += `${Math.floor(i / 2) + 1}. ${notation} `;
      } else {
        pgn += `${notation} `;
      }

      // 更新棋盘
      board[`${m.row},${m.col}`] = piece;
      delete board[fromKey];
    }

    // 结果
    if (result?.winner) {
      pgn += result.winner.color === 'white' ? '1-0' : '0-1';
    } else {
      pgn += '1/2-1/2';
    }

    return pgn.trim();
  }

  /** 生成国际跳棋 PDN 棋谱 */
  private generateDraughtsPDN(room: Room, result: any): string {
    // 10x10 棋盘，只用深色格子，编号 1-50
    // 编号规则：从左上角开始，row 0 col 1 = 1, row 0 col 3 = 2, ...
    const squareNumber = (row: number, col: number): number => {
      return Math.floor((row * 10 + col) / 2) + 1;
    };

    let pdn = '';
    const moves = room.moveHistory;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i] as any;
      const from = squareNumber(m.fromRow, m.fromCol);
      const to = squareNumber(m.row, m.col);

      // 检测是否是吃子（目标位置原本有棋子）
      const isCapture = Math.abs(m.fromRow - m.row) > 1 || Math.abs(m.fromCol - m.col) > 1;
      const notation = isCapture ? `${from}x${to}` : `${from}-${to}`;

      if (i % 2 === 0) {
        pdn += `${Math.floor(i / 2) + 1}. ${notation} `;
      } else {
        pdn += `${notation} `;
      }
    }

    // 结果
    if (result?.winner) {
      pdn += result.winner.color === 'white' ? '1-0' : '0-1';
    } else {
      pdn += '1/2-1/2';
    }

    return pdn.trim();
  }

  /** 从初始棋盘获取棋子 */
  private getPieceAtInitialBoard(room: Room, move: any): string | null {
    // 简化：从 moveHistory 重建初始状态
    const INIT_BOARD: Record<string, string> = {};
    const RED_BACK = ['rook','knight','bishop','advisor','king','advisor','bishop','knight','rook'];
    const RED_PAWN = [0,2,4,6,8];
    for (let c = 0; c < 9; c++) { INIT_BOARD[`9,${c}`] = `red_${RED_BACK[c]}`; }
    for (const c of RED_PAWN) { INIT_BOARD[`6,${c}`] = 'red_pawn'; }
    INIT_BOARD['7,1'] = 'red_cannon'; INIT_BOARD['7,7'] = 'red_cannon';
    const BLACK_BACK = ['rook','knight','bishop','advisor','king','advisor','bishop','knight','rook'];
    for (let c = 0; c < 9; c++) { INIT_BOARD[`0,${c}`] = `black_${BLACK_BACK[c]}`; }
    for (const c of RED_PAWN) { INIT_BOARD[`3,${c}`] = 'black_pawn'; }
    INIT_BOARD['2,1'] = 'black_cannon'; INIT_BOARD['2,7'] = 'black_cannon';

    // 从 from 位置获取棋子
    const fromKey = `${move.fromRow},${move.fromCol}`;
    return INIT_BOARD[fromKey] || null;
  }

  /** 记录房间活动状态变化 */
  private logRoomActivity(room: Room, idleType: number): void {
    try {
      execute(
        `INSERT INTO room_logs (id, room_id, owner_id, game_type, player_count, idle_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
        [uuid(), room.roomId, room.owner?.id || '', room.gameType, room.players.length, idleType]
      );
    } catch {}
  }

  /** 补充游戏结果中赢家和输家的 id 和 name */
  private enrichGameResult(room: Room, result: any): void {
    if (result?.winner) {
      const winnerPlayer = room.players.find(p => p.color === result.winner!.color);
      if (winnerPlayer) {
        result.winner.id = winnerPlayer.id;
        result.winner.name = winnerPlayer.username;
      }
      // 补充输家信息（投降/断线/违规的人）
      const loserPlayer = room.players.find(p => p.color !== result.winner!.color);
      if (loserPlayer) {
        result.loser = { id: loserPlayer.id, name: loserPlayer.username, color: loserPlayer.color };
      }
    }
  }

  // ── 工具 ──

  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { code, message },
    }));
  }
}
