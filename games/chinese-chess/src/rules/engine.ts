/**
 * 中国象棋规则引擎 —— 实现 IGameEngine 接口
 */

import {
  IGameEngine, GameState, GameConfig, ValidationResult,
  Position, Player, GameResult, GamePhase, GameType, WinReason,
} from '@lan-boardgame/shared';
import { CCColor, CCColors, CC_PIECES, CCPiece, CCExtraState, getCCExtra } from '../types/index';
import { Board, createInitialBoard, cloneBoard, findKing, getAllPieces } from './board';
import { getRawMoves } from './moves';
import { isInCheck, isCheckmate, isStalemate, getLegalMoves } from './check';

export class ChineseChessEngine implements IGameEngine {
  readonly gameType = GameType.ChineseChess;

  createInitialState(_config: GameConfig, _players: Player[]): GameState {
    const board = createInitialBoard();
    return {
      phase: GamePhase.Playing,
      currentTurn: CCColors.RED,
      board: board as (string | null)[][],
      moveCount: 0,
      lastMove: null,
      extra: {
        captured: [],
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

    const from = state.lastMove; // lastMove 保存的是上一步的位置（用于 from-to 走法）
    // 中国象棋需要 from 和 to 两个位置
    // 但 IGameEngine 接口只有 move (to)
    // 我们用 extra.from 来传递起始位置

    const extra = getCCExtra(state.extra);
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

    // 检查目标位置
    if (move.row < 0 || move.row >= 10 || move.col < 0 || move.col >= 9) {
      return { valid: false, reason: '目标位置超出棋盘' };
    }

    const target = board[move.row][move.col];
    if (target && target.startsWith(playerColor)) {
      return { valid: false, reason: '不能吃自己的棋子' };
    }

    // 检查走法是否合法
    const rawMoves = getRawMoves(board, fromPos);
    const isRawValid = rawMoves.some(m => m.row === move.row && m.col === move.col);
    if (!isRawValid) {
      return { valid: false, reason: '该棋子不能走到目标位置' };
    }

    // 检查走后是否被将军
    const newBoard = cloneBoard(board);
    newBoard[move.row][move.col] = newBoard[fromPos.row][fromPos.col];
    newBoard[fromPos.row][fromPos.col] = null;

    if (isInCheck(newBoard, playerColor as CCColor)) {
      return { valid: false, reason: '走棋后会被将军' };
    }

    return { valid: true };
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    const board = cloneBoard(state.board as unknown as Board);
    const fromPos = (state.extra as any).from as Position;
    const piece = board[fromPos.row][fromPos.col]!;
    const captured = board[move.row][move.col];

    // 执行走棋
    board[move.row][move.col] = piece;
    board[fromPos.row][fromPos.col] = null;

    const extra = getCCExtra(state.extra);
    const newCaptured = [...extra.captured];
    if (captured) newCaptured.push(captured);

    const nextColor = playerColor === 'red' ? 'black' : 'red';

    // 检查对方是否被将军
    const inCheck = isInCheck(board, nextColor as CCColor);

    return {
      phase: GamePhase.Playing,
      currentTurn: nextColor,
      board: board as (string | null)[][],
      moveCount: state.moveCount + 1,
      lastMove: move,
      extra: {
        captured: newCaptured,
        inCheck,
        from: null,
        lastMoveFrom: fromPos,
      } as unknown as Record<string, unknown>,
    };
  }

  checkGameEnd(state: GameState): GameResult | null {
    const board = state.board as unknown as Board;
    const currentColor = state.currentTurn as CCColor;

    // 检查将死
    if (isCheckmate(board, currentColor)) {
      const winner = currentColor === 'red' ? 'black' : 'red';
      return {
        winner: { id: '', name: '', color: winner },
        reason: WinReason.Score,
        scores: {},
      };
    }

    // 检查困毙
    if (isStalemate(board, currentColor)) {
      const winner = currentColor === 'red' ? 'black' : 'red';
      return {
        winner: { id: '', name: '', color: winner },
        reason: WinReason.Score,
        scores: {},
      };
    }

    return null;
  }

  handlePass(state: GameState, _playerColor: string): GameState {
    // 中国象棋不支持 Pass
    return state;
  }

  handleResign(_state: GameState, playerColor: string): GameResult {
    const winner = playerColor === 'red' ? 'black' : 'red';
    return {
      winner: { id: '', name: '', color: winner },
      reason: WinReason.Resign,
      scores: {},
    };
  }

  getDefaultConfig(): GameConfig {
    return {
      gameType: GameType.ChineseChess,
      rows: 10,
      cols: 9,
      extra: {},
    };
  }
}
