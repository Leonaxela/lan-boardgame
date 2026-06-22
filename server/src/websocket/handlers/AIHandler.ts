import WebSocket from 'ws';
import { GameType, GameConfig, GamePhase } from '@lan-boardgame/shared';
import { Room, RoomPlayer, RoomActivity } from '../../room/Room.js';
import { GO_COLORS } from '@lan-boardgame/go';
import { GOMOKU_COLORS } from '@lan-boardgame/gomoku';
import { selectAIMove } from '@lan-boardgame/go/ai';
import { selectAIMove as selectGomokuAIMove } from '@lan-boardgame/gomoku/ai';
import { selectAIMove as selectChineseChessAIMove } from '@lan-boardgame/chinese-chess/ai';
import { selectAIMove as selectChessAIMove } from '@lan-boardgame/chess/ai';
import { selectAIMove as selectDraughtsAIMove } from '@lan-boardgame/draughts/ai';
import { kataGoManager } from '../../katago/KataGoManager.js';
import { saveActiveRoom } from '../../room/RoomPersistence.js';
import { getEngine, updateClock, enrichGameResult, sendError } from '../utils.js';
import type { ClientMessage, DispatcherContext } from '../types.js';
import { sendKatagoAnalysisReport } from './KataGoHandler.js';
import { saveGameRecord } from '../records/GameRecordSaver.js';
import { logRoomActivity } from '../records/GameRecordSaver.js';

export function createScheduleAIMove(ctx: DispatcherContext): (room: Room) => void {
  return (room: Room) => {
    setTimeout(() => {
      if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;

      let aiColor: string;
      if (room.gameType === GameType.Gomoku) aiColor = GOMOKU_COLORS.WHITE;
      else if (room.gameType === GameType.ChineseChess) aiColor = 'black';
      else if (room.gameType === GameType.Chess) aiColor = 'black';
      else if (room.gameType === GameType.Draughts) aiColor = 'black';
      else aiColor = GO_COLORS.WHITE;
      if (room.gameState.currentTurn !== aiColor) return;

      const engine = getEngine(room.gameType, room.config);

      if (room.gameType === GameType.ChineseChess || room.gameType === GameType.Chess || room.gameType === GameType.Draughts) {
        const difficulty = room.aiDifficulty || 3;
        const moveResult = room.gameType === GameType.ChineseChess
          ? selectChineseChessAIMove(room.gameState, aiColor, difficulty)
          : room.gameType === GameType.Chess
            ? selectChessAIMove(room.gameState, aiColor, difficulty)
            : selectDraughtsAIMove(room.gameState, aiColor, difficulty);
        if (!moveResult) return;

        room.gameState = {
          ...room.gameState,
          extra: { ...room.gameState.extra, from: moveResult.from },
        } as any;

        const validation = engine.validateMove(room.gameState!, moveResult.to, aiColor);
        if (validation.valid) {
          room.moveHistory.push({ color: aiColor, row: moveResult.to.row, col: moveResult.to.col, fromRow: moveResult.from.row, fromCol: moveResult.from.col, at: Date.now() });
          room.gameState = engine.applyMove(room.gameState!, moveResult.to, aiColor);
          updateClock(room, aiColor);
        }
      } else {
        const difficulty = room.aiDifficulty || 2;
        const move = room.gameType === GameType.Gomoku
          ? selectGomokuAIMove(room.gameState, aiColor, difficulty)
          : selectAIMove(room.gameState, aiColor, difficulty);

        if (move === null) {
          room.gameState = engine.handlePass(room.gameState, aiColor);
          room.aiConsecutivePasses = (room.aiConsecutivePasses || 0) + 1;
        } else {
          const validation = engine.validateMove(room.gameState, move, aiColor);
          if (!validation.valid) {
            room.gameState = engine.handlePass(room.gameState, aiColor);
            room.aiConsecutivePasses = (room.aiConsecutivePasses || 0) + 1;
          } else {
            room.moveHistory.push({ color: aiColor, row: move.row, col: move.col, at: Date.now() });
            room.gameState = engine.applyMove(room.gameState, move, aiColor);
            updateClock(room, aiColor);
            room.aiConsecutivePasses = 0;
          }
        }
      }

      if (room.aiConsecutivePasses >= 2) {
        room.aiConsecutivePasses = 0;
        room.broadcast({
          type: 'game_state',
          payload: { gameState: room.gameState, message: '🤖 电脑已放弃，对局结束' },
        });
        setTimeout(() => {
          if (!room.gameState || room.gameState.phase !== GamePhase.Playing) return;
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
            const opponentColor = aiColor === 'black' ? 'white' : 'black';
            const manualResult = {
              winner: { id: '', name: '', color: opponentColor },
              reason: 'score',
              scores: {},
            };
            enrichGameResult(room, manualResult);
            room.gameState.phase = GamePhase.Finished;
            saveGameRecord(room, manualResult);
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
      }
    }, 1500);
  };
}

export function registerAIHandlers(ctx: DispatcherContext, handlers: Map<string, Function>): void {
  handlers.set('start_ai_game', (ws: WebSocket, msg: ClientMessage, _player: RoomPlayer, room: Room) => {
    if (!room || room.owner?.ws !== ws) {
      sendError(ws, 'NOT_OWNER', '只有房主能开始 AI 对弈');
      return;
    }

    const difficulty = (msg.payload.difficulty as number) || 2;
    const engine = getEngine(room.gameType, room.config);
    room.gameState = engine.createInitialState(room.config, []);
    room.moveHistory = [];
    room.activity = RoomActivity.Playing;
    logRoomActivity(room, 2);
    saveActiveRoom(room.roomId, room.owner?.id || '', room.owner?.username || '',
      room.gameType, room.config, 'playing', room.players.map(p => p.id));

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

    if (room.owner) room.owner.color = playerColor;

    const aiPlayer: RoomPlayer = {
      id: 'ai-' + crypto.randomUUID().slice(0, 8),
      username: '🤖 电脑',
      color: aiColor,
      ws: null!,
      isOwner: false,
      joinedAt: Date.now(),
    };
    room.players.push(aiPlayer);

    room.aiDifficulty = difficulty;
    room.aiConsecutivePasses = 0;

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
  });
}
