/**
 * 国际象棋各棋子走法生成
 */

import { Position } from '@lan-boardgame/shared';
import {
  IntlPiece, IntlColor, INTL_PIECES,
  intlPieceColor, intlPieceType, CastlingRights,
} from '../types/index';
import { Board, inBounds } from './board';

export interface RawMove {
  to: Position;
  promotion?: string;
}

function canMoveTo(board: Board, pos: Position, color: IntlColor): boolean {
  if (!inBounds(pos.row, pos.col)) return false;
  const target = board[pos.row][pos.col];
  return !target || intlPieceColor(target) !== color;
}

/** 获取某个棋子的所有合法目标位置（不考虑将军） */
export function getRawMoves(board: Board, pos: Position): RawMove[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const color = intlPieceColor(piece);
  const type = intlPieceType(piece);

  switch (type) {
    case INTL_PIECES.PAWN:   return getPawnMoves(board, pos, color);
    case INTL_PIECES.KNIGHT: return getKnightMoves(board, pos, color);
    case INTL_PIECES.BISHOP: return getBishopMoves(board, pos, color);
    case INTL_PIECES.ROOK:   return getRookMoves(board, pos, color);
    case INTL_PIECES.QUEEN:  return getQueenMoves(board, pos, color);
    case INTL_PIECES.KING:   return getKingMoves(board, pos, color);
    default: return [];
  }
}

/** 扫描直线方向（车、后、象用） */
function slideMoves(board: Board, pos: Position, color: IntlColor, dirs: number[][]): RawMove[] {
  const moves: RawMove[] = [];
  for (const [dr, dc] of dirs) {
    let r = pos.row + dr, c = pos.col + dc;
    while (inBounds(r, c)) {
      const target = board[r][c];
      if (!target) {
        moves.push({ to: { row: r, col: c } });
      } else {
        if (intlPieceColor(target) !== color) moves.push({ to: { row: r, col: c } });
        break;
      }
      r += dr; c += dc;
    }
  }
  return moves;
}

// ── 兵 ──

function getPawnMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  const moves: RawMove[] = [];
  const forward = color === 'white' ? -1 : 1;
  const startRow = color === 'white' ? 6 : 1;
  const promoRow = color === 'white' ? 0 : 7;

  // 向前一步
  const fr = pos.row + forward;
  if (inBounds(fr, pos.col) && !board[fr][pos.col]) {
    if (fr === promoRow) {
      moves.push({ to: { row: fr, col: pos.col }, promotion: 'queen' });
      moves.push({ to: { row: fr, col: pos.col }, promotion: 'rook' });
      moves.push({ to: { row: fr, col: pos.col }, promotion: 'bishop' });
      moves.push({ to: { row: fr, col: pos.col }, promotion: 'knight' });
    } else {
      moves.push({ to: { row: fr, col: pos.col } });
    }

    // 起始位置可向前两步
    if (pos.row === startRow) {
      const ffr = pos.row + forward * 2;
      if (!board[ffr][pos.col]) {
        moves.push({ to: { row: ffr, col: pos.col } });
      }
    }
  }

  // 吃子（斜前方）
  for (const dc of [-1, 1]) {
    const cr = pos.row + forward, cc = pos.col + dc;
    if (!inBounds(cr, cc)) continue;
    const target = board[cr][cc];
    if (target && intlPieceColor(target) !== color) {
      if (cr === promoRow) {
        moves.push({ to: { row: cr, col: cc }, promotion: 'queen' });
        moves.push({ to: { row: cr, col: cc }, promotion: 'rook' });
        moves.push({ to: { row: cr, col: cc }, promotion: 'bishop' });
        moves.push({ to: { row: cr, col: cc }, promotion: 'knight' });
      } else {
        moves.push({ to: { row: cr, col: cc } });
      }
    }
  }

  return moves;
}

// ── 马 ──

function getKnightMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  const moves: RawMove[] = [];
  const jumps = [
    [-2, -1], [-2, 1], [2, -1], [2, 1],
    [-1, -2], [-1, 2], [1, -2], [1, 2],
  ];
  for (const [dr, dc] of jumps) {
    const r = pos.row + dr, c = pos.col + dc;
    if (inBounds(r, c) && canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ to: { row: r, col: c } });
    }
  }
  return moves;
}

// ── 象 ──

function getBishopMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  return slideMoves(board, pos, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
}

// ── 车 ──

function getRookMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  return slideMoves(board, pos, color, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
}

// ── 后 ──

function getQueenMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  return slideMoves(board, pos, color, [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ]);
}

// ── 王 ──

function getKingMoves(board: Board, pos: Position, color: IntlColor): RawMove[] {
  const moves: RawMove[] = [];
  const dirs = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (const [dr, dc] of dirs) {
    const r = pos.row + dr, c = pos.col + dc;
    if (inBounds(r, c) && canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ to: { row: r, col: c } });
    }
  }
  return moves;
}

/**
 * 获取王的走法（含王车易位）
 */
export function getKingMovesWithCastling(
  board: Board, pos: Position, color: IntlColor,
  castling: CastlingRights, isInCheck: boolean,
  wouldBeInCheck: (from: Position, to: Position) => boolean,
): RawMove[] {
  const moves = getKingMoves(board, pos, color);

  if (isInCheck) return moves;

  const row = color === 'white' ? 7 : 0;

  // 王翼易位
  const kingSide = color === 'white' ? castling.whiteKingSide : castling.blackKingSide;
  if (kingSide && pos.row === row && pos.col === 4) {
    if (!board[row][5] && !board[row][6] &&
        board[row][7] === `${color}_rook`) {
      if (!wouldBeInCheck(pos, { row, col: 5 }) && !wouldBeInCheck(pos, { row, col: 6 })) {
        moves.push({ to: { row, col: 6 } });
      }
    }
  }

  // 后翼易位
  const queenSide = color === 'white' ? castling.whiteQueenSide : castling.blackQueenSide;
  if (queenSide && pos.row === row && pos.col === 4) {
    if (!board[row][3] && !board[row][2] && !board[row][1] &&
        board[row][0] === `${color}_rook`) {
      if (!wouldBeInCheck(pos, { row, col: 3 }) && !wouldBeInCheck(pos, { row, col: 2 })) {
        moves.push({ to: { row, col: 2 } });
      }
    }
  }

  return moves;
}
