/**
 * 中国象棋各棋子走法验证
 */

import { Position } from '@lan-boardgame/shared';
import {
  CCPiece, CCColor, CC_PIECES,
  RED_PALACE, BLACK_PALACE,
  pieceColor, pieceType,
} from '../types/index';
import { Board, inBounds, inPalace, hasCrossedRiver } from './board';

/** 获取某个棋子的所有合法目标位置（不考虑将军） */
export function getRawMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const color = pieceColor(piece);
  const type = pieceType(piece);

  switch (type) {
    case CC_PIECES.KING: return getKingMoves(board, pos, color);
    case CC_PIECES.ADVISOR: return getAdvisorMoves(board, pos, color);
    case CC_PIECES.BISHOP: return getBishopMoves(board, pos, color);
    case CC_PIECES.KNIGHT: return getKnightMoves(board, pos, color);
    case CC_PIECES.ROOK: return getRookMoves(board, pos, color);
    case CC_PIECES.CANNON: return getCannonMoves(board, pos, color);
    case CC_PIECES.PAWN: return getPawnMoves(board, pos, color);
    default: return [];
  }
}

function canMoveTo(board: Board, pos: Position, color: CCColor): boolean {
  if (!inBounds(pos.row, pos.col)) return false;
  const target = board[pos.row][pos.col];
  return !target || pieceColor(target) !== color;
}

// ── 帅/将 ──

function getKingMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    const r = pos.row + dr, c = pos.col + dc;
    if (inPalace(r, c, color) && canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ row: r, col: c });
    }
  }
  return moves;
}

// ── 仕/士 ──

function getAdvisorMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dr, dc] of dirs) {
    const r = pos.row + dr, c = pos.col + dc;
    if (inPalace(r, c, color) && canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ row: r, col: c });
    }
  }
  return moves;
}

// ── 相/象 ──

function getBishopMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
  for (const [dr, dc] of dirs) {
    const r = pos.row + dr, c = pos.col + dc;
    if (!inBounds(r, c)) continue;
    // 不能过河
    if (color === 'red' && r < 5) continue;
    if (color === 'black' && r > 4) continue;
    // 象眼不能被塞
    const eyeR = pos.row + dr / 2, eyeC = pos.col + dc / 2;
    if (board[eyeR][eyeC]) continue;
    if (canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ row: r, col: c });
    }
  }
  return moves;
}

// ── 馬/马 ──

function getKnightMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  // 马的8个目标位置和对应的蹩马腿位置
  const knightMoves: [number, number, number, number][] = [
    [-2, -1, -1, 0], [-2, 1, -1, 0],
    [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [-1, 2, 0, 1],
    [1, -2, 0, -1], [1, 2, 0, 1],
  ];
  for (const [dr, dc, lr, lc] of knightMoves) {
    const r = pos.row + dr, c = pos.col + dc;
    // 蹩马腿
    const legR = pos.row + lr, legC = pos.col + lc;
    if (board[legR]?.[legC]) continue;
    if (inBounds(r, c) && canMoveTo(board, { row: r, col: c }, color)) {
      moves.push({ row: r, col: c });
    }
  }
  return moves;
}

// ── 車/车 ──

function getRookMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    let r = pos.row + dr, c = pos.col + dc;
    while (inBounds(r, c)) {
      const target = board[r][c];
      if (!target) {
        moves.push({ row: r, col: c });
      } else {
        if (pieceColor(target) !== color) moves.push({ row: r, col: c });
        break;
      }
      r += dr; c += dc;
    }
  }
  return moves;
}

// ── 砲/炮 ──

function getCannonMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
    let r = pos.row + dr, c = pos.col + dc;
    let jumped = false;
    while (inBounds(r, c)) {
      const target = board[r][c];
      if (!jumped) {
        if (!target) {
          moves.push({ row: r, col: c });
        } else {
          jumped = true; // 找到炮架
        }
      } else {
        if (target) {
          if (pieceColor(target) !== color) moves.push({ row: r, col: c });
          break;
        }
      }
      r += dr; c += dc;
    }
  }
  return moves;
}

// ── 兵/卒 ──

function getPawnMoves(board: Board, pos: Position, color: CCColor): Position[] {
  const moves: Position[] = [];
  const forward = color === 'red' ? -1 : 1;
  const crossed = hasCrossedRiver(pos.row, color);

  // 向前
  const fr = pos.row + forward;
  if (inBounds(fr, pos.col) && canMoveTo(board, { row: fr, col: pos.col }, color)) {
    moves.push({ row: fr, col: pos.col });
  }

  // 过河后可左右
  if (crossed) {
    for (const dc of [-1, 1]) {
      const c = pos.col + dc;
      if (inBounds(pos.row, c) && canMoveTo(board, { row: pos.row, col: c }, color)) {
        moves.push({ row: pos.row, col: c });
      }
    }
  }

  return moves;
}
