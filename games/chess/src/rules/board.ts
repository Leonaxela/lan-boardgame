/**
 * 国际象棋棋盘工具函数
 */

import { Position } from '@lan-boardgame/shared';
import { INTL_ROWS, INTL_COLS, IntlPiece, IntlColor, INTL_COLORS, intlPieceColor } from '../types/index';

export type Board = (IntlPiece | null)[][];

/** 创建初始棋盘 */
export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: INTL_ROWS }, () => Array(INTL_COLS).fill(null));

  // 黑方 (row 0-1)
  board[0][0] = 'black_rook';   board[0][1] = 'black_knight'; board[0][2] = 'black_bishop';
  board[0][3] = 'black_queen';  board[0][4] = 'black_king';   board[0][5] = 'black_bishop';
  board[0][6] = 'black_knight'; board[0][7] = 'black_rook';
  for (let c = 0; c < 8; c++) board[1][c] = 'black_pawn';

  // 白方 (row 6-7)
  board[7][0] = 'white_rook';   board[7][1] = 'white_knight'; board[7][2] = 'white_bishop';
  board[7][3] = 'white_queen';  board[7][4] = 'white_king';   board[7][5] = 'white_bishop';
  board[7][6] = 'white_knight'; board[7][7] = 'white_rook';
  for (let c = 0; c < 8; c++) board[6][c] = 'white_pawn';

  return board;
}

/** 深拷贝棋盘 */
export function cloneBoard(board: Board): Board {
  return board.map(row => [...row]);
}

/** 棋盘内判断 */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < INTL_ROWS && col >= 0 && col < INTL_COLS;
}

/** 查找某方的王位置 */
export function findKing(board: Board, color: IntlColor): Position | null {
  const kingPiece = `${color}_king`;
  for (let r = 0; r < INTL_ROWS; r++) {
    for (let c = 0; c < INTL_COLS; c++) {
      if (board[r][c] === kingPiece) return { row: r, col: c };
    }
  }
  return null;
}

/** 获取某方所有棋子位置 */
export function getAllPieces(board: Board, color: IntlColor): { piece: IntlPiece; pos: Position }[] {
  const pieces: { piece: IntlPiece; pos: Position }[] = [];
  for (let r = 0; r < INTL_ROWS; r++) {
    for (let c = 0; c < INTL_COLS; c++) {
      const p = board[r][c];
      if (p && intlPieceColor(p) === color) {
        pieces.push({ piece: p, pos: { row: r, col: c } });
      }
    }
  }
  return pieces;
}
