/**
 * 国际跳棋走法生成
 *
 * 规则：
 * - 普通棋子只能斜向前走一格
 * - 王可以斜向前或向后走一格
 * - 吃子必须跳过对方棋子到空位
 * - 多重吃子必须连续跳
 * - 吃子是强制的（有能吃的棋子就必须吃）
 */

import { Position } from '@lan-boardgame/shared';
import {
  DraughtsPiece, DraughtsColor, DRAUGHTS_PIECES,
  draughtsPieceColor, draughtsPieceType,
} from '../types/index';
import { Board, inBounds, isDarkSquare } from './board';

export interface RawMove {
  to: Position;
  capture?: Position;
  continuation?: Position;
}

/** 获取前进方向 */
function forwardDirs(color: DraughtsColor): number[] {
  return color === 'white' ? [-1] : [1];
}

/** 获取所有方向（王用） */
function allDirs(): number[] {
  return [-1, 1];
}

/** 获取普通走法（不吃子） */
function getSimpleMoves(board: Board, pos: Position, color: DraughtsColor): RawMove[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const type = draughtsPieceType(piece);
  const dirs = type === DRAUGHTS_PIECES.KING ? allDirs() : forwardDirs(color);
  const moves: RawMove[] = [];

  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const r = pos.row + dr;
      const c = pos.col + dc;
      if (inBounds(r, c) && isDarkSquare(r, c) && !board[r][c]) {
        moves.push({ to: { row: r, col: c } });
      }
    }
  }

  return moves;
}

/** 获取吃子走法 */
function getCaptureMoves(board: Board, pos: Position, color: DraughtsColor): RawMove[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const type = draughtsPieceType(piece);
  const dirs = type === DRAUGHTS_PIECES.KING ? allDirs() : forwardDirs(color);
  const moves: RawMove[] = [];
  const opponent = color === 'white' ? 'black' : 'white';

  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const midR = pos.row + dr;
      const midC = pos.col + dc;
      const toR = pos.row + dr * 2;
      const toC = pos.col + dc * 2;

      if (!inBounds(toR, toC) || !isDarkSquare(toR, toC)) continue;
      if (!inBounds(midR, midC)) continue;

      const midPiece = board[midR][midC];
      const targetPiece = board[toR][toC];

      if (midPiece && draughtsPieceColor(midPiece) === opponent && !targetPiece) {
        moves.push({ to: { row: toR, col: toC }, capture: { row: midR, col: midC } });
      }
    }
  }

  return moves;
}

/** 获取某个位置的所有原始走法 */
export function getRawMoves(board: Board, pos: Position): RawMove[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];
  const color = draughtsPieceColor(piece);
  return getSimpleMoves(board, pos, color);
}

/** 获取某个位置的所有吃子走法 */
export function getRawCaptures(board: Board, pos: Position): RawMove[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];
  const color = draughtsPieceColor(piece);
  return getCaptureMoves(board, pos, color);
}

/**
 * 检查某方是否有吃子走法
 */
export function hasCaptures(board: Board, color: DraughtsColor): boolean {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      const piece = board[r][c];
      if (piece && draughtsPieceColor(piece) === color) {
        const captures = getCaptureMoves(board, { row: r, col: c }, color);
        if (captures.length > 0) return true;
      }
    }
  }
  return false;
}

/**
 * 获取多重吃子的完整路径
 * 从一个起始位置开始，递归寻找所有可能的连续吃子
 */
export function getMultiCaptures(
  board: Board,
  pos: Position,
  color: DraughtsColor,
  visited: Set<string> = new Set(),
): RawMove[] {
  const captures = getCaptureMoves(board, pos, color);
  const results: RawMove[] = [];

  if (captures.length === 0) {
    return [];
  }

  for (const cap of captures) {
    const key = `${cap.capture!.row},${cap.capture!.col}`;
    if (visited.has(key)) continue;

    // 模拟吃子后的棋盘
    const newBoard = board.map(row => [...row]);
    newBoard[pos.row][pos.col] = null;
    newBoard[cap.capture!.row][cap.capture!.col] = null;
    newBoard[cap.to.row][cap.to.col] = board[pos.row][pos.col];

    // 检查是否升变（升变后不能继续吃）
    const piece = board[pos.row][pos.col]!;
    const type = draughtsPieceType(piece);
    if (type === DRAUGHTS_PIECES.MAN) {
      const promoRow = color === 'white' ? 0 : 9;
      if (cap.to.row === promoRow) {
        results.push(cap);
        continue;
      }
    }

    // 递归查找后续吃子
    const newVisited = new Set(visited);
    newVisited.add(key);
    const furtherMoves = getMultiCaptures(newBoard, cap.to, color, newVisited);

    if (furtherMoves.length === 0) {
      results.push(cap);
    } else {
      for (const fm of furtherMoves) {
        results.push({
          to: fm.to,
          capture: cap.capture,
          continuation: fm.capture,
        });
      }
    }
  }

  return results;
}

/**
 * 获取所有合法走法（考虑强制吃子）
 */
export function getAllLegalMoves(board: Board, color: DraughtsColor): { from: Position; to: Position; capture?: Position }[] {
  const moves: { from: Position; to: Position; capture?: Position }[] = [];
  const mustCapture = hasCaptures(board, color);

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      const piece = board[r][c];
      if (!piece || draughtsPieceColor(piece) !== color) continue;

      const pos = { row: r, col: c };

      if (mustCapture) {
        const captures = getMultiCaptures(board, pos, color);
        for (const cap of captures) {
          moves.push({ from: pos, to: cap.to, capture: cap.capture });
        }
      } else {
        const simpleMoves = getSimpleMoves(board, pos, color);
        for (const m of simpleMoves) {
          moves.push({ from: pos, to: m.to });
        }
      }
    }
  }

  return moves;
}
