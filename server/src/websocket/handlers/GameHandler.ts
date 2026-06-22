import WebSocket from 'ws';
import { GameType, GameConfig, GamePhase, GameState } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { GO_COLORS } from '@lan-boardgame/go';
import { GOMOKU_COLORS } from '@lan-boardgame/gomoku';
import { kataGoManager } from '../../katago/KataGoManager.js';
import { getEngine, updateClock, enrichGameResult, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';
import { scheduleKataGoMove, sendKatagoAnalysisReport } from './KataGoHandler.js';
import { saveGameRecord } from '../records/GameRecordSaver.js';

export function registerGameHandlers(ctx: DispatcherContext, handlers: Map<string, Function>, scheduleAIMove: (room: Room) => void): void {

  handlers.set('place', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = getEngine(room.gameType, room.config);
    const pos = msg.payload.position as { row: number; col: number };
    console.log('[place] pos:', pos, 'board size:', room.gameState?.board?.length);

    if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
      const from = msg.payload.from as { row: number; col: number } | undefined;
      if (from) {
        room.gameState = {
          ...room.gameState,
          extra: { ...room.gameState.extra, from },
        } as GameState;
      }
    }

    const validation = engine.validateMove(room.gameState, pos, player.color);
    if (!validation.valid) {
      sendError(ws, 'INVALID_MOVE', validation.reason || '非法走棋');
      return;
    }

    const moveRecord: any = { color: player.color, row: pos.row, col: pos.col, at: Date.now() };
    if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
      const fromPos = (room.gameState.extra as Record<string, unknown>)?.from as { row: number; col: number } | undefined;
      if (fromPos) {
        moveRecord.fromRow = fromPos.row;
        moveRecord.fromCol = fromPos.col;
      }
    }
    room.moveHistory.push(moveRecord);

    room.gameState = engine.applyMove(room.gameState, pos, player.color);
    updateClock(room, player.color);

    const result = engine.checkGameEnd(room.gameState);

    if (result) {
      enrichGameResult(room, result);
      room.gameState.phase = GamePhase.Finished;
      saveGameRecord(room, result);
      room.broadcast({
        type: 'game_over',
        payload: { result, gameState: room.gameState },
      });
    } else {
      room.broadcast({
        type: 'game_state',
        payload: { gameState: room.gameState },
      });

      const hasAI = room.players.some(p => p.id.startsWith('ai-'));
      if (hasAI) {
        if (room.katagoGame) {
          const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
          if (katagoPlayer && room.gameState.currentTurn === katagoPlayer.color) {
            const doKataGo = async () => {
              try {
                await kataGoManager.playMove(room.roomId, player.color as 'black' | 'white', pos);
                const stepIdx = room.moveHistory.length - 1;
                try {
                  const analysis = await kataGoManager.analyzePosition(room.roomId, katagoPlayer.color as 'black' | 'white');
                  if (analysis) room.katagoAnalysis.set(stepIdx, analysis);
                } catch (e) {
                  console.error('[KataGo] 分析失败:', e);
                }
                scheduleKataGoMove(room);
              } catch (err) {
                console.error('[KataGo] 同步落子失败:', err);
                scheduleKataGoMove(room);
              }
            };
            doKataGo();
          }
        } else {
          let aiColor: string;
          if (room.gameType === GameType.Gomoku) aiColor = GOMOKU_COLORS.WHITE;
          else if (room.gameType === GameType.ChineseChess) aiColor = 'black';
          else if (room.gameType === GameType.Chess) aiColor = 'black';
          else if (room.gameType === GameType.Draughts) aiColor = 'black';
          else aiColor = GO_COLORS.WHITE;
          if (room.gameState.currentTurn === aiColor) {
            scheduleAIMove(room);
          }
        }
      }
    }
  });

  handlers.set('pass', (ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = getEngine(room.gameType, room.config);
    room.gameState = engine.handlePass(room.gameState, player.color);

    if (room.katagoGame) {
      const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
      if (katagoPlayer && room.gameState.currentTurn === katagoPlayer.color) {
        const doPass = async () => {
          try {
            await kataGoManager.passMove(room.roomId, player.color as 'black' | 'white');
            try {
              const stepIdx = room.moveHistory.length;
              const analysis = await kataGoManager.analyzePosition(room.roomId, katagoPlayer.color as 'black' | 'white');
              if (analysis) room.katagoAnalysis.set(stepIdx, analysis);
            } catch (e) {
              console.error('[KataGo] 分析失败:', e);
            }
            scheduleKataGoMove(room);
          } catch (err) {
            console.error('[KataGo] 同步 pass 失败:', err);
            scheduleKataGoMove(room);
          }
        };
        doPass();
      }
    }

    const result = engine.checkGameEnd(room.gameState);
    if (result && room.gameState) {
      enrichGameResult(room, result);
      room.gameState.phase = GamePhase.Finished;
      if (room.katagoGame) {
        kataGoManager.destroySession(room.roomId);
        sendKatagoAnalysisReport(room);
      }
      saveGameRecord(room, result);
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
  });

  handlers.set('resign', (_ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      sendError(_ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }

    const engine = getEngine(room.gameType, room.config);
    const result = engine.handleResign(room.gameState, player.color);

    enrichGameResult(room, result);
    room.gameState.phase = GamePhase.Finished;
    if (room.katagoGame) {
      sendKatagoAnalysisReport(room);
      kataGoManager.destroySession(room.roomId);
    }
    saveGameRecord(room, result);
    room.broadcast({
      type: 'game_over',
      payload: { result, gameState: room.gameState },
    });
  });

  handlers.set('apply_counting', (ws: WebSocket, _msg: ClientMessage, player: RoomPlayer, room: Room) => {
    if (room.activity !== RoomActivity.Playing || !room.gameState) {
      sendError(ws, 'GAME_NOT_STARTED', '游戏尚未开始');
      return;
    }
    if (room.gameType !== GameType.Go) {
      sendError(ws, 'NOT_SUPPORTED', '当前游戏不支持申请终局数子');
      return;
    }
    const moveCount = room.gameState.moveCount || 0;
    if (moveCount < 50) {
      sendError(ws, 'TOO_EARLY', `至少下 50 手后才能申请终局数子（当前 ${moveCount} 手）`);
      return;
    }

    const hasAI = room.players.some(p => p.id.startsWith('ai-'));

    if (room.katagoGame) {
      const katagoPlayer = room.players.find(p => p.id.startsWith('ai-katago'));
      if (!katagoPlayer) return;
      // KataGo counting flow - delegated to KataGoHandler
      return;
    }

    if (!hasAI) {
      const requester = room.players.find(p => p.id !== player.id && !p.id.startsWith('ai-'));
      if (requester) {
        ws.send(JSON.stringify({
          type: 'counting_sent',
          payload: { message: '已向对手申请终局数子' },
        }));
        room.sendTo(requester.id, {
          type: 'counting_request',
          payload: { playerId: player.id, username: player.username },
        });
      }
    }
  });

  handlers.set('counting_response', (ws: WebSocket, msg: ClientMessage, player: RoomPlayer, room: Room) => {
    const accepted = msg.payload.accepted as boolean;
    const engine = getEngine(room.gameType, room.config);

    if (accepted) {
      const requester = room.players.find(p => p.id !== player.id && !p.id.startsWith('ai-'));
      if (requester && room.gameState) {
        room.gameState = engine.handlePass(room.gameState, requester.color);
        room.gameState = engine.handlePass(room.gameState, player.color);
      }

      const result = engine.checkGameEnd(room.gameState!);
      if (result) {
        enrichGameResult(room, result);
        if (room.gameState) room.gameState.phase = GamePhase.Finished;
        saveGameRecord(room, result);
        room.broadcast({
          type: 'game_over',
          payload: { result, gameState: room.gameState, message: '双方同意终局数子' },
        });
      } else {
        const manualResult = {
          winner: { id: '', name: '', color: 'black' },
          reason: 'score',
          scores: {},
        };
        enrichGameResult(room, manualResult);
        if (room.gameState) room.gameState.phase = GamePhase.Finished;
        saveGameRecord(room, manualResult);
        room.broadcast({
          type: 'game_over',
          payload: { result: manualResult, gameState: room.gameState, message: '双方同意终局数子' },
        });
      }
    } else {
      const requester = room.players.find(p => p.id !== player.id && !p.id.startsWith('ai-'));
      if (requester) {
        room.sendTo(requester.id, {
          type: 'counting_rejected',
          payload: { message: '对手拒绝终局数子' },
        });
      }
    }
  });
}
