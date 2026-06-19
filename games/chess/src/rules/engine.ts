/**
 * 国际象棋规则引擎 —— 实现 IGameEngine 接口
 */

import {
  IGameEngine, GameState, GameConfig, ValidationResult,
  Position, Player, GameResult, GamePhase, GameType, WinReason,
} from '@lan-boardgame/shared';
import {
  IntlColor, INTL_COLORS, INTL_PIECES,
  intlPieceColor, intlPieceType, getIntlExtra, CastlingRights,
} from '../types/index';
import { Board, createInitialBoard, cloneBoard, findKing, getAllPieces } from './board';
import { getRawMoves, getKingMovesWithCastling, RawMove } from './moves';
import { isInCheck, isCheckmate, isStalemate, wouldBeInCheck } from './check';

export class ChessEngine implements IGameEngine {
  readonly gameType = GameType.Chess;

  createInitialState(_config: GameConfig, _players: Player[]): GameState {
    const board = createInitialBoard();
    return {
      phase: GamePhase.Playing,
      currentTurn: INTL_COLORS.WHITE,
      board: board as (string | null)[][],
      moveCount: 0,
      lastMove: null,
      extra: {
        castling: {
          whiteKingSide: true, whiteQueenSide: true,
          blackKingSide: true, blackQueenSide: true,
        },
        enPassantTarget: null,
        inCheck: false,
        halfMoveClock: 0,
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

    const extra = getIntlExtra(state.extra);
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

    if (move.row < 0 || move.row >= 8 || move.col < 0 || move.col >= 8) {
      return { valid: false, reason: '目标位置超出棋盘' };
    }

    const target = board[move.row][move.col];
    if (target && target.startsWith(playerColor)) {
      return { valid: false, reason: '不能吃自己的棋子' };
    }

    // 获取合法走法
    const color = playerColor as IntlColor;
    const inCheck = isInCheck(board, color);
    let rawMoves: RawMove[];

    const type = intlPieceType(piece);
    if (type === INTL_PIECES.KING) {
      rawMoves = getKingMovesWithCastling(board, fromPos, color, extra.castling, inCheck,
        (from: Position, to: Position) => wouldBeInCheck(board, from, to, color));
    } else {
      rawMoves = getRawMoves(board, fromPos);
    }

    // 检查目标位置是否在合法走法中（忽略升变类型，只看位置）
    const isValid = rawMoves.some(m => m.to.row === move.row && m.to.col === move.col);
    if (!isValid) {
      return { valid: false, reason: '该棋子不能走到目标位置' };
    }

    // 模拟走棋检查是否被将军
    const newBoard = cloneBoard(board);
    newBoard[move.row][move.col] = newBoard[fromPos.row][fromPos.col];
    newBoard[fromPos.row][fromPos.col] = null;

    if (isInCheck(newBoard, color)) {
      return { valid: false, reason: '走棋后会被将军' };
    }

    return { valid: true };
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    const board = cloneBoard(state.board as unknown as Board);
    const fromPos = (state.extra as any).from as Position;
    const piece = board[fromPos.row][fromPos.col]!;
    const captured = board[move.row][move.col];
    const extra = getIntlExtra(state.extra);
    const color = playerColor as IntlColor;
    const type = intlPieceType(piece);

    // ── 王车易位 ──
    if (type === INTL_PIECES.KING) {
      const colDiff = move.col - fromPos.col;
      if (Math.abs(colDiff) === 2) {
        const row = fromPos.row;
        if (colDiff === 2) {
          // 王翼易位
          board[row][5] = board[row][7];
          board[row][7] = null;
        } else {
          // 后翼易位
          board[row][3] = board[row][0];
          board[row][0] = null;
        }
      }
    }

    // ── 吃过路兵 ──
    if (type === INTL_PIECES.PAWN && extra.enPassantTarget &&
        move.row === extra.enPassantTarget.row && move.col === extra.enPassantTarget.col) {
      const capturedRow = color === 'white' ? move.row + 1 : move.row - 1;
      board[capturedRow][move.col] = null;
    }

    // ── 执行走棋 ──
    board[move.row][move.col] = piece;
    board[fromPos.row][fromPos.col] = null;

    // ── 兵升变 ──
    const promoRow = color === 'white' ? 0 : 7;
    if (type === INTL_PIECES.PAWN && move.row === promoRow) {
      const promoType = (state.extra as any).promotion || 'queen';
      board[move.row][move.col] = `${color}_${promoType}`;
    }

    // ── 更新易位权限 ──
    const newCastling = { ...extra.castling };
    if (type === INTL_PIECES.KING) {
      if (color === 'white') { newCastling.whiteKingSide = false; newCastling.whiteQueenSide = false; }
      else { newCastling.blackKingSide = false; newCastling.blackQueenSide = false; }
    }
    if (type === INTL_PIECES.ROOK) {
      if (fromPos.row === 7 && fromPos.col === 0) newCastling.whiteQueenSide = false;
      if (fromPos.row === 7 && fromPos.col === 7) newCastling.whiteKingSide = false;
      if (fromPos.row === 0 && fromPos.col === 0) newCastling.blackQueenSide = false;
      if (fromPos.row === 0 && fromPos.col === 7) newCastling.blackKingSide = false;
    }
    // 吃掉对方车也取消对应易位
    if (move.row === 0 && move.col === 0) newCastling.blackQueenSide = false;
    if (move.row === 0 && move.col === 7) newCastling.blackKingSide = false;
    if (move.row === 7 && move.col === 0) newCastling.whiteQueenSide = false;
    if (move.row === 7 && move.col === 7) newCastling.whiteKingSide = false;

    // ── 过路兵目标 ──
    let enPassantTarget = null;
    if (type === INTL_PIECES.PAWN && Math.abs(move.row - fromPos.row) === 2) {
      enPassantTarget = { row: (fromPos.row + move.row) / 2, col: fromPos.col };
    }

    const nextColor = color === 'white' ? 'black' : 'white';
    const inCheck = isInCheck(board, nextColor as IntlColor);

    // ── 半步时钟（用于 50 步和棋） ──
    let halfMoveClock = extra.halfMoveClock + 1;
    if (type === INTL_PIECES.PAWN || captured) halfMoveClock = 0;

    return {
      phase: GamePhase.Playing,
      currentTurn: nextColor,
      board: board as (string | null)[][],
      moveCount: state.moveCount + 1,
      lastMove: move,
      extra: {
        castling: newCastling,
        enPassantTarget,
        inCheck,
        halfMoveClock,
        from: null,
        lastMoveFrom: fromPos,
      } as unknown as Record<string, unknown>,
    };
  }

  checkGameEnd(state: GameState): GameResult | null {
    const board = state.board as unknown as Board;
    const currentColor = state.currentTurn as IntlColor;
    const extra = getIntlExtra(state.extra);

    // 将死
    if (isCheckmate(board, currentColor)) {
      const winner = currentColor === 'white' ? 'black' : 'white';
      return {
        winner: { id: '', name: '', color: winner },
        reason: WinReason.Score,
        scores: {},
      };
    }

    // 逼和
    if (isStalemate(board, currentColor)) {
      return {
        winner: null,
        reason: WinReason.Draw,
        scores: {},
      };
    }

    // 50 步和棋
    if (extra.halfMoveClock >= 100) {
      return {
        winner: null,
        reason: WinReason.Draw,
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
      gameType: GameType.Chess,
      rows: 8,
      cols: 8,
      extra: {},
    };
  }
}
