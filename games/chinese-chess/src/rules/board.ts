/**
 * 中国象棋棋盘工具函数
 */

import { Position } from '@lan-boardgame/shared';
import {
  CC_ROWS, CC_COLS, CCPiece, CCColor, CC_COLORS,
  RED_PALACE, BLACK_PALACE, RED_RIVER_ROWS, BLACK_RIVER_ROWS,
  pieceColor, pieceType, CC_PIECES,
} from '../types/index';

export type Board = (CCPiece | null)[][];

/** 创建初始棋盘 */
export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: CC_ROWS }, () => Array(CC_COLS).fill(null));

  // 黑方 (row 0-4)
  board[0][0] = 'black_rook';   board[0][1] = 'black_knight'; board[0][2] = 'black_bishop';
  board[0][3] = 'black_advisor'; board[0][4] = 'black_king';  board[0][5] = 'black_advisor';
  board[0][6] = 'black_bishop'; board[0][7] = 'black_knight'; board[0][8] = 'black_rook';
  board[2][1] = 'black_cannon'; board[2][7] = 'black_cannon';
  board[3][0] = 'black_pawn'; board[3][2] = 'black_pawn'; board[3][4] = 'black_pawn';
  board[3][6] = 'black_pawn'; board[3][8] = 'black_pawn';

  // 红方 (row 5-9)
  board[9][0] = 'red_rook';   board[9][1] = 'red_knight'; board[9][2] = 'red_bishop';
  board[9][3] = 'red_advisor'; board[9][4] = 'red_king';  board[9][5] = 'red_advisor';
  board[9][6] = 'red_bishop'; board[9][7] = 'red_knight'; board[9][8] = 'red_rook';
  board[7][1] = 'red_cannon'; board[7][7] = 'red_cannon';
  board[6][0] = 'red_pawn'; board[6][2] = 'red_pawn'; board[6][4] = 'red_pawn';
  board[6][6] = 'red_pawn'; board[6][8] = 'red_pawn';

  return board;
}

/** 深拷贝棋盘 */
export function cloneBoard(board: Board): Board {
  return board.map(row => [...row]);
}

/** 棋盘内判断 */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < CC_ROWS && col >= 0 && col < CC_COLS;
}

/** 是否在九宫内 */
export function inPalace(row: number, col: number, color: CCColor): boolean {
  const p = color === 'red' ? RED_PALACE : BLACK_PALACE;
  return row >= p.rowMin && row <= p.rowMax && col >= p.colMin && col <= p.colMax;
}

/** 是否已过河 */
export function hasCrossedRiver(row: number, color: CCColor): boolean {
  return color === 'red' ? RED_RIVER_ROWS.includes(row) : BLACK_RIVER_ROWS.includes(row);
}

/** 查找某方的将/帅位置 */
export function findKing(board: Board, color: CCColor): Position | null {
  const kingPiece = `${color}_king`;
  for (let r = 0; r < CC_ROWS; r++) {
    for (let c = 0; c < CC_COLS; c++) {
      if (board[r][c] === kingPiece) return { row: r, col: c };
    }
  }
  return null;
}

/** 获取某方所有棋子位置 */
export function getAllPieces(board: Board, color: CCColor): { piece: CCPiece; pos: Position }[] {
  const pieces: { piece: CCPiece; pos: Position }[] = [];
  for (let r = 0; r < CC_ROWS; r++) {
    for (let c = 0; c < CC_COLS; c++) {
      const p = board[r][c];
      if (p && pieceColor(p) === color) {
        pieces.push({ piece: p, pos: { row: r, col: c } });
      }
    }
  }
  return pieces;
}
