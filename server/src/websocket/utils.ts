import { GameType, GameConfig, GamePhase, GameState } from '@lan-boardgame/shared';
import { ChineseGoEngine } from '@lan-boardgame/go/chinese';
import { JapaneseGoEngine } from '@lan-boardgame/go/japanese';
import { GoRuleSet } from '@lan-boardgame/go';
import { GomokuEngine } from '@lan-boardgame/gomoku/engine';
import { ChineseChessEngine } from '@lan-boardgame/chinese-chess/engine';
import { ChessEngine } from '@lan-boardgame/chess/engine';
import { DraughtsEngine } from '@lan-boardgame/draughts/engine';
import { WebSocket } from 'ws';
import { Room } from '../room/Room.js';

/** 根据游戏类型创建引擎 */
export function getEngine(gameType: GameType, config: GameConfig) {
  if (gameType === GameType.Gomoku) return new GomokuEngine();
  if (gameType === GameType.ChineseChess) return new ChineseChessEngine();
  if (gameType === GameType.Chess) return new ChessEngine();
  if (gameType === GameType.Draughts) return new DraughtsEngine();
  const ruleSet = (config.extra?.ruleSet as GoRuleSet) || GoRuleSet.Chinese;
  if (ruleSet === GoRuleSet.Japanese) return new JapaneseGoEngine();
  return new ChineseGoEngine();
}

/** 更新棋钟（仅围棋） */
export function updateClock(room: Room, playerColor: string): void {
  if (room.gameType !== GameType.Go || !room.gameState) return;

  const now = Date.now();
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

  const elapsed = now - (room.gameState.clock?.lastMoveAt || now);
  const prevClock = room.gameState.clock;
  room.gameState = {
    ...room.gameState,
    clock: {
      black: { moveTime: playerColor === 'black' ? elapsed : (prevClock?.black.moveTime || 0), totalTime: blackTotal },
      white: { moveTime: playerColor === 'white' ? elapsed : (prevClock?.white.moveTime || 0), totalTime: whiteTotal },
      lastMoveAt: now,
      blackTurnAt: playerColor === 'black' ? (prevClock?.blackTurnAt || now) : now,
      whiteTurnAt: playerColor === 'white' ? (prevClock?.whiteTurnAt || now) : now,
    },
  };
}

/** 发送错误消息 */
export function sendError(ws: WebSocket, code: string, message: string): void {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { code, message },
  }));
}

/** 补充游戏结果中赢家和输家的 id 和 name */
export function enrichGameResult(room: Room, result: any): void {
  if (result?.winner) {
    const winnerPlayer = room.players.find(p => p.color === result.winner!.color);
    if (winnerPlayer) {
      result.winner.id = winnerPlayer.id;
      result.winner.name = winnerPlayer.username;
    }
    const loserPlayer = room.players.find(p => p.color !== result.winner!.color);
    if (loserPlayer) {
      result.loser = { id: loserPlayer.id, name: loserPlayer.username, color: loserPlayer.color };
    }
  }
}
