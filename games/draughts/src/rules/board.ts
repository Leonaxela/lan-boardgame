/**
 * 国际跳棋棋盘工具函数
 *
 * 10x10 棋盘，只使用深色格子（row+col 为奇数的格子）
 * 白方在下方（row 7-9），黑方在上方（row 0-2）
 */

import { Position } from '@lan-boardgame/shared';
import {
  DRAUGHTS_ROWS, DRAUGHTS_COLS,
  DraughtsPiece, DraughtsColor, DRAUGHTS_COLORS,
  draughtsPieceColor, draughtsPieceType, DRAUGHTS_PIECES,
  WHITE_PROMO_ROW, BLACK_PROMO_ROW,
} from '../types/index';

export type Board = (DraughtsPiece | null)[][];

/** 判断是否是深色格子（可用格子） */
export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

/** 创建初始棋盘 */
export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: DRAUGHTS_ROWS }, () => Array(DRAUGHTS_COLS).fill(null));

  // 黑方 (row 0-2)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < DRAUGHTS_COLS; c++) {
      if (isDarkSquare(r, c)) {
        board[r][c] = 'black_man';
      }
    }
  }

  // 白方 (row 7-9)
  for (let r = 7; r < 10; r++) {
    for (let c = 0; c < DRAUGHTS_COLS; c++) {
      if (isDarkSquare(r, c)) {
        board[r][c] = 'white_man';
      }
    }
  }

  return board;
}

/** 深拷贝棋盘 */
export function cloneBoard(board: Board): Board {
  return board.map(row => [...row]);
}

/** 棋盘内判断 */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < DRAUGHTS_ROWS && col >= 0 && col < DRAUGHTS_COLS;
}

/** 查找某方所有棋子位置 */
export function getAllPieces(board: Board, color: DraughtsColor): { piece: DraughtsPiece; pos: Position }[] {
  const pieces: { piece: DraughtsPiece; pos: Position }[] = [];
  for (let r = 0; r < DRAUGHTS_ROWS; r++) {
    for (let c = 0; c < DRAUGHTS_COLS; c++) {
      const p = board[r][c];
      if (p && draughtsPieceColor(p) === color) {
        pieces.push({ piece: p, pos: { row: r, col: c } });
      }
    }
  }
  return pieces;
}

/** 检查是否升变 */
export function shouldPromote(color: DraughtsColor, row: number): boolean {
  return (color === 'white' && row === WHITE_PROMO_ROW) ||
         (color === 'black' && row === BLACK_PROMO_ROW);
}
