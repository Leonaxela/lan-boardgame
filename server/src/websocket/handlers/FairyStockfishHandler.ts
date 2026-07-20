import WebSocket from 'ws';
import { GameType, GamePhase } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { fairyStockfishManager } from '../../fairy-stockfish/FairyStockfishManager.js';
import { saveActiveRoom } from '../../room/RoomPersistence.js';
import { getEngine, updateClock, enrichGameResult, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';
import { saveGameRecord, logRoomActivity } from '../records/GameRecordSaver.js';

/** 调度 Fairy-Stockfish 走棋 */
export function scheduleFairyStockfishMove(room: Room): void {
  setTimeout(async () => {
    if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

    const aiPlayer = room.players.find(p => p.id.startsWith('ai-fairy'));
    if (!aiPlayer) return;
    if (room.gameState.currentTurn !== aiPlayer.color) return;

    const engine = getEngine(room.gameType, room.config);
    const variant = room.gameType === GameType.ChineseChess ? 'xiangqi' : 'chess';

    try {
      const move = await fairyStockfishManager.getBestMove(room.roomId);

      if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;
      if (!move) {
        room.gameState = engine.handlePass(room.gameState!, aiPlayer.color);
        room.broadcast({ type: 'game_state', payload: { gameState: room.gameState, message: 'Fairy-Stockfish pass' } });
        return;
      }

      // 设置 from 位置（from→to 走法需要）
      room.gameState = {
        ...room.gameState,
        extra: { ...room.gameState.extra, from: move.from },
      } as any;

      const validation = engine.validateMove(room.gameState!, move.to, aiPlayer.color);
      if (validation.valid) {
        const moveRecord: any = { color: aiPlayer.color, row: move.to.row, col: move.to.col, at: Date.now() };
        if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess) {
          moveRecord.fromRow = move.from.row;
          moveRecord.fromCol = move.from.col;
          // 同步到引擎
          fairyStockfishManager.playMove(room.roomId, move.from, move.to).catch(() => {});
        }
        room.moveHistory.push(moveRecord);
        room.gameState = engine.applyMove(room.gameState!, move.to, aiPlayer.color);
        updateClock(room, aiPlayer.color);
      } else {
        room.gameState = engine.handlePass(room.gameState!, aiPlayer.color);
      }

      const result = engine.checkGameEnd(room.gameState);
      if (result) {
        enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        fairyStockfishManager.destroySession(room.roomId);
        saveGameRecord(room, result);
        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState, isAiGame: true },
        });
      } else {
        // AI 落子后，用新局面做一次快速评估（50ms），获取真正的"下一步预测"
        const doEval = async () => {
          try {
            await fairyStockfishManager.quickEval(room.roomId);
            const rawScore = fairyStockfishManager.getLastScore(room.roomId);
            const score = rawScore !== null ? (aiPlayer.color === 'white' ? -rawScore : rawScore) : null;
            const depth = fairyStockfishManager.getLastDepth(room.roomId);
            const pv = fairyStockfishManager.getLastPv(room.roomId);
            // 只要有 PV 或 score 就发送
            if (score !== null || pv !== null) {
              for (const p of room.players) {
                if (p.ws && p.ws.readyState === WebSocket.OPEN && !p.id.startsWith('ai-')) {
                  p.ws.send(JSON.stringify({ type: 'fairy_eval', payload: { score, depth, pv } }));
                }
              }
            }
          } catch {}
        };
        doEval();
        room.broadcast({
          type: 'game_state',
          payload: { gameState: room.gameState, movedBy: 'ai' },
        });
      }
    } catch (err) {
      console.error('[Fairy-Stockfish] 走棋错误:', err);
      room.gameState = engine.handlePass(room.gameState!, aiPlayer.color);
      room.broadcast({
        type: 'game_state',
        payload: { gameState: room.gameState, message: 'Fairy-Stockfish 出错，自动 pass', movedBy: 'ai' },
      });
    }
  }, 500);
}

export function registerFairyStockfishHandlers(ctx: DispatcherContext, handlers: Map<string, Function>): void {
  handlers.set('start_fairy_stockfish_game', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (!room || !player || room.owner?.id !== player.id) {
      sendError(ws, 'NOT_OWNER', '只有房主能开始 Fairy-Stockfish 对弈');
      return;
    }

    if (room.gameType !== GameType.ChineseChess && room.gameType !== GameType.Chess) {
      sendError(ws, 'NOT_SUPPORTED', 'Fairy-Stockfish 仅支持中国象棋和国际象棋');
      return;
    }

    const variant = room.gameType === GameType.ChineseChess ? 'xiangqi' : 'chess';
    const skillLevel = (msg.payload.skillLevel as number) || 10;
    const playerColor = (msg.payload.playerColor as string) || (room.gameType === GameType.ChineseChess ? 'red' : 'white');
    // 难度→思考时间（毫秒），确保 1 分钟内返回
    const timeMap: Record<number, number> = { 1: 3000, 2: 8000, 3: 15000, 4: 30000, 5: 55000 };
    const moveTime = timeMap[skillLevel] || 8000;

    console.log(`[Fairy-Stockfish] 开始对弈 variant=${variant} skill=${skillLevel} moveTime=${moveTime}ms`);

    fairyStockfishManager.startSession(room.roomId, { variant, skillLevel, moveTime })
      .then(async () => {
        await fairyStockfishManager.newGame(room.roomId);

        // 移除旧 AI 玩家
        room.players = room.players.filter(p => !p.id.startsWith('ai-'));

        room.gameStartedAt = Date.now();

        const engine = getEngine(room.gameType, room.config);
        room.gameState = engine.createInitialState(room.config, []);
        room.moveHistory = [];
        room.activity = RoomActivity.Playing;
        logRoomActivity(room, 2);
        saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
          room.gameType, room.config, 'playing', room.players.map(p => p.id));

        room.gameState = {
          ...room.gameState,
          clock: {
            black: { moveTime: 0, totalTime: 0 },
            white: { moveTime: 0, totalTime: 0 },
            lastMoveAt: room.gameStartedAt,
            blackTurnAt: room.gameStartedAt,
            whiteTurnAt: room.gameStartedAt,
          },
        } as any;

        const aiColor = room.gameType === GameType.ChineseChess
          ? (playerColor === 'red' ? 'black' : 'red')
          : (playerColor === 'white' ? 'black' : 'white');
        if (room.owner) room.owner.color = playerColor;

        const aiPlayer: RoomPlayer = {
          id: 'ai-fairy-' + crypto.randomUUID().slice(0, 8),
          username: '🤖 Fairy-Stockfish',
          color: aiColor,
          ws: null!,
          isOwner: false,
          joinedAt: Date.now(),
        };
        room.players.push(aiPlayer);

        room.fairyStockfishGame = true;

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

        // 如果 AI 先手（玩家执后手），立即调度 AI 走棋
        const firstColor = room.gameType === GameType.ChineseChess ? 'red' : 'white';
        if (playerColor !== firstColor) {
          scheduleFairyStockfishMove(room);
        }
      })
      .catch(err => {
        console.error('[Fairy-Stockfish] 启动失败:', err);
        sendError(ws, 'FAIRY_ERROR', `Fairy-Stockfish 启动失败: ${(err as Error).message}`);
      });
  });
}
