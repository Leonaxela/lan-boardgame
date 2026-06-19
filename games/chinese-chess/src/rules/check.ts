/**
 * 将军/将死检测
 */

import { Position } from '@lan-boardgame/shared';
import { CCColor, CC_PIECES, pieceColor, pieceType } from '../types/index';
import { Board, findKing, getAllPieces, inBounds } from './board';
import { getRawMoves } from './moves';

/** 检查某方是否被将军 */
export function isInCheck(board: Board, color: CCColor): boolean {
  const kingPos = findKing(board, color);
  if (!kingPos) return true; // 将/帅不在棋盘 = 已被吃

  const opponent = color === 'red' ? 'black' : 'red';
  const opponentPieces = getAllPieces(board, opponent);

  for (const { pos } of opponentPieces) {
    const moves = getRawMoves(board, pos);
    if (moves.some(m => m.row === kingPos.row && m.col === kingPos.col)) {
      return true;
    }
  }
  return false;
}

/** 检查将帅对面（同一列中间无子） */
export function kingsAreFacing(board: Board): boolean {
  const redKing = findKing(board, 'red');
  const blackKing = findKing(board, 'black');
  if (!redKing || !blackKing) return false;
  if (redKing.col !== blackKing.col) return false;

  // 检查中间是否有棋子
  const minRow = Math.min(redKing.row, blackKing.row);
  const maxRow = Math.max(redKing.row, blackKing.row);
  for (let r = minRow + 1; r < maxRow; r++) {
    if (board[r][redKing.col]) return false;
  }
  return true;
}

/**
 * 模拟走棋后检查自己是否被将军（用于过滤非法走法）
 */
export function wouldBeInCheck(board: Board, from: Position, to: Position, color: CCColor): boolean {
  const newBoard = board.map(row => [...row]);
  newBoard[to.row][to.col] = newBoard[from.row][from.col];
  newBoard[from.row][from.col] = null;

  return isInCheck(newBoard, color);
}

/**
 * 检查某方是否被将死（无合法走法可解将）
 */
export function isCheckmate(board: Board, color: CCColor): boolean {
  if (!isInCheck(board, color)) return false;
  return !hasLegalMoves(board, color);
}

/**
 * 检查某方是否被困毙（无合法走法但未被将军）
 */
export function isStalemate(board: Board, color: CCColor): boolean {
  if (isInCheck(board, color)) return false;
  return !hasLegalMoves(board, color);
}

/**
 * 检查某方是否有合法走法
 */
export function hasLegalMoves(board: Board, color: CCColor): boolean {
  const pieces = getAllPieces(board, color);
  for (const { pos } of pieces) {
    const rawMoves = getRawMoves(board, pos);
    for (const move of rawMoves) {
      if (!wouldBeInCheck(board, pos, move, color)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 获取某方所有合法走法（考虑将军）
 */
export function getLegalMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];
  const color = pieceColor(piece);
  const rawMoves = getRawMoves(board, pos);
  return rawMoves.filter(move => !wouldBeInCheck(board, pos, move, color));
}
