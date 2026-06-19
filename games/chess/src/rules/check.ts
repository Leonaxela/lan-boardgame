/**
 * 将军/将死/逼和检测
 */

import { Position } from '@lan-boardgame/shared';
import { IntlColor, intlPieceColor, intlPieceType, INTL_PIECES } from '../types/index';
import { Board, findKing, getAllPieces } from './board';
import { getRawMoves } from './moves';

/** 检查某方是否被将军 */
export function isInCheck(board: Board, color: IntlColor): boolean {
  const kingPos = findKing(board, color);
  if (!kingPos) return true;

  const opponent = color === 'white' ? 'black' : 'white';
  const opponentPieces = getAllPieces(board, opponent);

  for (const { pos } of opponentPieces) {
    const moves = getRawMoves(board, pos);
    if (moves.some(m => m.to.row === kingPos.row && m.to.col === kingPos.col)) {
      return true;
    }
  }
  return false;
}

/**
 * 模拟走棋后检查自己是否被将军
 */
export function wouldBeInCheck(board: Board, from: Position, to: Position, color: IntlColor): boolean {
  const newBoard = board.map(row => [...row]);
  newBoard[to.row][to.col] = newBoard[from.row][from.col];
  newBoard[from.row][from.col] = null;
  return isInCheck(newBoard, color);
}

/**
 * 检查将死（被将军且无合法走法）
 */
export function isCheckmate(board: Board, color: IntlColor): boolean {
  if (!isInCheck(board, color)) return false;
  return !hasLegalMoves(board, color);
}

/**
 * 检查逼和（未被将军但无合法走法）
 */
export function isStalemate(board: Board, color: IntlColor): boolean {
  if (isInCheck(board, color)) return false;
  return !hasLegalMoves(board, color);
}

/**
 * 检查某方是否有合法走法
 */
export function hasLegalMoves(board: Board, color: IntlColor): boolean {
  const pieces = getAllPieces(board, color);
  for (const { pos } of pieces) {
    const rawMoves = getRawMoves(board, pos);
    for (const move of rawMoves) {
      if (!wouldBeInCheck(board, pos, move.to, color)) {
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
  const color = intlPieceColor(piece);
  const rawMoves = getRawMoves(board, pos);
  return rawMoves.filter(move => !wouldBeInCheck(board, pos, move.to, color)).map(m => m.to);
}
