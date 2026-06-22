import WebSocket from 'ws';
import { GameType, GamePhase } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { kataGoManager } from '../../katago/KataGoManager.js';
import { saveActiveRoom, logRoomDestroyed } from '../../room/RoomPersistence.js';
import { getEngine, updateClock, enrichGameResult, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';
import { saveGameRecord, logRoomActivity } from '../records/GameRecordSaver.js';

export function sendKatagoAnalysisReport(room: Room): void {
  if (!room.katagoGame) return;
  const analysisData: Record<string, any> = {};
  for (const [step, point] of room.katagoAnalysis) {
    analysisData[String(step)] = point;
  }
  if (Object.keys(analysisData).length === 0) return;

  const report = {
    type: 'katago_analysis_report',
    payload: {
      analysisData,
      moveHistory: room.moveHistory,
      boardSize: room.katagoBoardSize || 19,
      result: room.gameState ? {
        winner: room.gameState.currentTurn === 'black' ? 'white' : 'black',
      } : null,
    },
  };

  for (const p of room.players) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN && !p.id.startsWith('ai-')) {
      p.ws.send(JSON.stringify(report));
    }
  }
}

export function scheduleKataGoMove(room: Room): void {
  setTimeout(async () => {
    if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;
    if (!room.katagoGame) return;

    const aiPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
    if (!aiPlayer) return;
    if (room.gameState.currentTurn !== aiPlayer.color) return;

    const engine = getEngine(room.gameType, room.config);

    try {
      const move = await kataGoManager.genMove(room.roomId, aiPlayer.color as 'black' | 'white');

      if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

      if (move === 'pass') {
        room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
      } else if (move === 'resign') {
        const result = engine.handleResign(room.gameState, aiPlayer.color);
        enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        kataGoManager.destroySession(room.roomId);
        saveGameRecord(room, result);
        sendKatagoAnalysisReport(room);
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
          updateClock(room, aiPlayer.color);
          const stepIdx = room.moveHistory.length - 1;
          const nextColor = room.gameState.currentTurn;
          try {
            const analysis = await kataGoManager.analyzePosition(room.roomId, nextColor as 'black' | 'white');
            if (analysis) room.katagoAnalysis.set(stepIdx, analysis);
          } catch (e) {
            console.error('[KataGo] 分析失败:', e);
          }
        } else {
          room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
          try {
            const analysis = await kataGoManager.analyzePosition(room.roomId, room.gameState.currentTurn as 'black' | 'white');
            if (analysis) room.katagoAnalysis.set(room.moveHistory.length, analysis);
          } catch (e) {
            console.error('[KataGo] 分析失败:', e);
          }
        }
      } else {
        room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
        try {
          const analysis = await kataGoManager.analyzePosition(room.roomId, room.gameState.currentTurn as 'black' | 'white');
          if (analysis) room.katagoAnalysis.set(room.moveHistory.length, analysis);
        } catch (e) {
          console.error('[KataGo] 分析失败:', e);
        }
      }

      const result = engine.checkGameEnd(room.gameState);
      if (result) {
        enrichGameResult(room, result);
        room.gameState.phase = GamePhase.Finished;
        kataGoManager.destroySession(room.roomId);
        saveGameRecord(room, result);
        sendKatagoAnalysisReport(room);
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
      room.gameState = engine.handlePass(room.gameState, aiPlayer.color);
      room.broadcast({
        type: 'game_state',
        payload: { gameState: room.gameState, message: 'KataGo 出错，自动 pass' },
      });
    }
  }, 500);
}

export function registerKataGoHandlers(ctx: DispatcherContext, handlers: Map<string, Function>): void {
  handlers.set('start_katago_game', (ws: WebSocket, msg: ClientMessage, _player: RoomPlayer, room: Room) => {
    if (!room || room.owner?.ws !== ws) {
      sendError(ws, 'NOT_OWNER', '只有房主能开始 KataGo 对弈');
      return;
    }

    if (room.gameType !== GameType.Go) {
      sendError(ws, 'NOT_SUPPORTED', 'KataGo 仅支持围棋');
      return;
    }

    const boardSize = (msg.payload.boardSize as number) || 19;
    const rules = (msg.payload.rules as 'chinese' | 'japanese') || 'chinese';
    const maxVisits = (msg.payload.maxVisits as number) || 1000;
    const playerColor = (msg.payload.playerColor as 'black' | 'white') || 'black';
    const komi = rules === 'japanese' ? 6.5 : 7.5;

    console.log(`[KataGo] 开始对弈 boardSize=${boardSize} rules=${rules} visits=${maxVisits} player=${playerColor}`);

    kataGoManager.startSession(room.roomId, { boardSize, rules, komi, maxVisits })
      .then(() => kataGoManager.initializeBoard(room.roomId))
      .then(() => {
        const config = { ...room.config };
        config.rows = boardSize;
        config.cols = boardSize;
        config.extra = { ...config.extra, boardSize, ruleSet: rules, komi, handicap: 0 };

        const engine = getEngine(room.gameType, config);
        room.gameState = engine.createInitialState(config, []);
        room.moveHistory = [];
        room.katagoAnalysis = new Map();
        room.activity = RoomActivity.Playing;
        logRoomActivity(room, 2);
        saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
          room.gameType, room.config, 'playing', room.players.map(p => p.id));

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

        if (room.owner) room.owner.color = playerColor;

        const aiColor = playerColor === 'black' ? 'white' : 'black';
        const aiPlayer: RoomPlayer = {
          id: 'ai-katago-' + crypto.randomUUID().slice(0, 8),
          username: '🤖 KataGo',
          color: aiColor,
          ws: null!,
          isOwner: false,
          joinedAt: Date.now(),
        };
        room.players.push(aiPlayer);

        room.katagoGame = true;
        room.katagoBoardSize = boardSize;

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

        if (playerColor === 'white') {
          scheduleKataGoMove(room);
        }
      })
      .catch(err => {
        console.error('[KataGo] 启动失败:', err);
        sendError(ws, 'KATAGO_ERROR', `KataGo 启动失败: ${(err as Error).message}`);
      });
  });
}
