/**
 * 国际跳棋规则引擎 —— 实现 IGameEngine 接口
 *
 * 10x10 国际跳棋规则：
 * - 白方先行
 * - 普通棋子斜向前走一格
 * - 王可斜向前/后走一格
 * - 吃子必须跳过对方棋子
 * - 吃子是强制的
 * - 多重吃子必须连续跳完
 * - 到达对方底线升变为王
 */

import {
  IGameEngine, GameState, GameConfig, ValidationResult,
  Position, Player, GameResult, GamePhase, GameType, WinReason,
} from '@lan-boardgame/shared';
import {
  DraughtsColor, DRAUGHTS_COLORS, DRAUGHTS_PIECES,
  draughtsPieceColor, draughtsPieceType,
  getDraughtsExtra, DraughtsExtraState,
} from '../types/index';
import {
  Board, createInitialBoard, cloneBoard,
  getAllPieces, shouldPromote, isDarkSquare,
} from './board';
import {
  getRawMoves, getRawCaptures, hasCaptures,
  getMultiCaptures, getAllLegalMoves,
} from './moves';

export class DraughtsEngine implements IGameEngine {
  readonly gameType = GameType.Draughts;

  createInitialState(_config: GameConfig, _players: Player[]): GameState {
    const board = createInitialBoard();
    return {
      phase: GamePhase.Playing,
      currentTurn: DRAUGHTS_COLORS.WHITE,
      board: board as (string | null)[][],
      moveCount: 0,
      lastMove: null,
      extra: {
        mustCapture: false,
        inCheck: false,
      } as unknown as Record<string, unknown>,
    };
  }

  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult {
    if (state.phase !== GamePhase.Playing) {
      return { valid: false, reason: '游戏已结束' };
    }
    if (playerColor !== state.currentTurn) {
      return { valid: false, reason: '不是您的回合' };
    }

    const extra = getDraughtsExtra(state.extra);
    const fromPos = (state.extra as any).from as Position | undefined;

    if (!fromPos) {
      return { valid: false, reason: '请先选择要移动的棋子' };
    }

    const board = state.board as unknown as Board;
    const piece = board[fromPos.row]?.[fromPos.col];

    if (!piece) {
      return { valid: false, reason: '起始位置没有棋子' };
    }

    if (!piece.startsWith(playerColor)) {
      return { valid: false, reason: '不能移动对方的棋子' };
    }

    if (move.row < 0 || move.row >= 10 || move.col < 0 || move.col >= 10) {
      return { valid: false, reason: '目标位置超出棋盘' };
    }

    if (!isDarkSquare(move.row, move.col)) {
      return { valid: false, reason: '只能在深色格子上移动' };
    }

    const target = board[move.row][move.col];
    if (target) {
      return { valid: false, reason: '目标位置已有棋子' };
    }

    // 检查强制吃子
    const color = playerColor as DraughtsColor;
    const mustCapture = hasCaptures(board, color);

    if (mustCapture) {
      // 检查这步是否是吃子走法
      const captures = getMultiCaptures(board, fromPos, color);
      const isValidCapture = captures.some(c =>
        c.to.row === move.row && c.to.col === move.col
      );
      if (!isValidCapture) {
        return { valid: false, reason: '有强制吃子，必须吃子' };
      }
    } else {
      // 检查是否是合法的普通走法
      const rawMoves = getRawMoves(board, fromPos);
      const isValid = rawMoves.some(m => m.to.row === move.row && m.to.col === move.col);
      if (!isValid) {
        return { valid: false, reason: '该棋子不能走到目标位置' };
      }
    }

    return { valid: true };
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    const board = cloneBoard(state.board as unknown as Board);
    const fromPos = (state.extra as any).from as Position;
    const piece = board[fromPos.row][fromPos.col]!;
    const color = playerColor as DraughtsColor;

    // 执行走棋
    board[move.row][move.col] = piece;
    board[fromPos.row][fromPos.col] = null;

    // 检查是否是吃子
    const mustCapture = hasCaptures(state.board as unknown as Board, color);
    if (mustCapture) {
      // 找到被吃的棋子
      const dr = Math.sign(move.row - fromPos.row);
      const dc = Math.sign(move.col - fromPos.col);
      const midR = fromPos.row + dr;
      const midC = fromPos.col + dc;
      if (board[midR] && board[midR][midC]) {
        board[midR][midC] = null;
      }
    }

    // 检查升变
    if (draughtsPieceType(piece) === DRAUGHTS_PIECES.MAN && shouldPromote(color, move.row)) {
      board[move.row][move.col] = `${color}_king`;
    }

    const nextColor = color === 'white' ? 'black' : 'white';

    return {
      phase: GamePhase.Playing,
      currentTurn: nextColor,
      board: board as (string | null)[][],
      moveCount: state.moveCount + 1,
      lastMove: move,
      extra: {
        mustCapture: hasCaptures(board, nextColor),
        inCheck: false,
        from: null,
        lastMoveFrom: fromPos,
      } as unknown as Record<string, unknown>,
    };
  }

  checkGameEnd(state: GameState): GameResult | null {
    const board = state.board as unknown as Board;
    const currentColor = state.currentTurn as DraughtsColor;

    // 检查当前方是否还有棋子
    const pieces = getAllPieces(board, currentColor);
    if (pieces.length === 0) {
      const winner = currentColor === 'white' ? 'black' : 'white';
      return {
        winner: { id: '', name: '', color: winner },
        reason: WinReason.Score,
        scores: {},
      };
    }

    // 检查当前方是否还有合法走法
    const legalMoves = getAllLegalMoves(board, currentColor);
    if (legalMoves.length === 0) {
      const winner = currentColor === 'white' ? 'black' : 'white';
      return {
        winner: { id: '', name: '', color: winner },
        reason: WinReason.Score,
        scores: {},
      };
    }

    return null;
  }

  handlePass(state: GameState, _playerColor: string): GameState {
    return state;
  }

  handleResign(_state: GameState, playerColor: string): GameResult {
    const winner = playerColor === 'white' ? 'black' : 'white';
    return {
      winner: { id: '', name: '', color: winner },
      reason: WinReason.Resign,
      scores: {},
    };
  }

  getDefaultConfig(): GameConfig {
    return {
      gameType: GameType.Draughts,
      rows: 10,
      cols: 10,
      extra: {},
    };
  }
}
