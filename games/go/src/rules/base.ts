/**
 * 围棋核心棋盘逻辑 —— 与具体规则体系无关。
 *
 * 提供：
 *   - 棋盘创建/克隆
 *   - 群组（chain）查找（洪水填充）
 *   - 气数计算
 *   - 提子执行
 *   - 劫点检测
 *   - 落子操作（验证 + 提子 + 劫，不含规则胜负判定）
 */

import { Position } from '@lan-boardgame/shared';
import { GoColor, GO_COLORS, opponentColor } from '../types/index';

// ══════════════════════════════════════════════
//  类型
// ══════════════════════════════════════════════

/** 棋盘：board[row][col] */
export type Board = (string | null)[][];

/** 落子结果 */
export interface PlaceResult {
  /** 落子后的新棋盘 */
  board: Board;
  /** 被提走的对方棋子位置列表 */
  captured: Position[];
  /** 劫点（如果有的话），否则 null */
  koPoint: Position | null;
  /** 落子方自己是否有合法气 */
  alive: boolean;
}

// ══════════════════════════════════════════════
//  棋盘工具
// ══════════════════════════════════════════════

/** 创建空棋盘 */
export function createBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

/** 深拷贝棋盘 */
export function cloneBoard(board: Board): Board {
  return board.map(row => [...row]);
}

/** 将棋盘坐标转为字符串 key */
export function posKey(pos: Position): string {
  return `${pos.row},${pos.col}`;
}

/** 将 key 解析回坐标 */
export function parseKey(key: string): Position {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

/** 获取某个位置的四个正交邻居（在棋盘范围内） */
export function getNeighbors(board: Board, pos: Position): Position[] {
  const { row, col } = pos;
  const rows = board.length;
  const cols = board[0].length;
  const result: Position[] = [];

  if (row > 0) result.push({ row: row - 1, col });
  if (row < rows - 1) result.push({ row: row + 1, col });
  if (col > 0) result.push({ row, col: col - 1 });
  if (col < cols - 1) result.push({ row, col: col + 1 });

  return result;
}

// ══════════════════════════════════════════════
//  群组（Chain）与气
// ══════════════════════════════════════════════

/**
 * 从指定位置开始，找到该颜色所在的整个群组。
 * 使用 BFS 洪水填充。
 */
export function findGroup(board: Board, start: Position): Position[] {
  const color = board[start.row][start.col];
  if (color === null) return [];

  const visited = new Set<string>();
  const group: Position[] = [];
  const queue: Position[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = posKey(current);
    if (visited.has(key)) continue;
    visited.add(key);
    group.push(current);

    for (const neighbor of getNeighbors(board, current)) {
      if (board[neighbor.row][neighbor.col] === color && !visited.has(posKey(neighbor))) {
        queue.push(neighbor);
      }
    }
  }

  return group;
}

/**
 * 计算一个群组的气。
 * 返回所有气的位置（空交叉点），不去重即返回 Set size。
 */
export function getLiberties(board: Board, group: Position[]): Set<string> {
  const liberties = new Set<string>();

  for (const pos of group) {
    for (const neighbor of getNeighbors(board, pos)) {
      if (board[neighbor.row][neighbor.col] === null) {
        liberties.add(posKey(neighbor));
      }
    }
  }

  return liberties;
}

/**
 * 查找某个颜色在棋盘上的所有群组。
 */
export function findAllGroups(board: Board, color: string): Position[][] {
  const visited = new Set<string>();
  const groups: Position[][] = [];

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      if (board[r][c] === color && !visited.has(posKey({ row: r, col: c }))) {
        const group = findGroup(board, { row: r, col: c });
        for (const pos of group) {
          visited.add(posKey(pos));
        }
        groups.push(group);
      }
    }
  }

  return groups;
}

// ══════════════════════════════════════════════
//  提子
// ══════════════════════════════════════════════

/**
 * 移除棋盘上所有无气的对方棋子。
 * 返回被提走的位置列表和更新后的棋盘。
 */
export function captureDeadGroups(board: Board, opponentColor: string): { board: Board; captured: Position[] } {
  let newBoard = cloneBoard(board);
  const allCaptured: Position[] = [];
  const opponentGroups = findAllGroups(newBoard, opponentColor);

  for (const group of opponentGroups) {
    const liberties = getLiberties(newBoard, group);
    if (liberties.size === 0) {
      // 提走整个群组
      for (const pos of group) {
        newBoard[pos.row][pos.col] = null;
        allCaptured.push(pos);
      }
    }
  }

  return { board: newBoard, captured: allCaptured };
}

// ══════════════════════════════════════════════
//  劫点检测
// ══════════════════════════════════════════════

/**
 * 判断是否形成了劫。
 * 条件：刚好提掉对方 1 颗棋子，且提子前该位置是自己的棋子。
 * @param captured 本次提掉的位置列表
 * @param move     本次落子位置
 * @returns 劫点位置，或 null
 */
export function detectKo(
  captured: Position[],
  move: Position,
  board: Board,
): Position | null {
  // 劫的条件：只提了 1 颗子
  if (captured.length !== 1) return null;

  // 己方落子位置周围刚好只有这 1 个空位（被提位置）
  const neighbors = getNeighbors(board, move);
  const capturedKey = posKey(captured[0]);

  // 被提的子是否在落子的邻居中
  const isNeighbor = neighbors.some(n => posKey(n) === capturedKey);
  if (!isNeighbor) return null;

  return captured[0];
}

// ══════════════════════════════════════════════
//  落子操作（核心入口）
// ══════════════════════════════════════════════

/**
 * 在棋盘上落子，执行提子和劫检测。
 * 不验证合法性（自杀检查由上层调用方做）。
 *
 * @param board  当前棋盘（不会被修改）
 * @param move   落子位置
 * @param color  落子颜色
 * @returns PlaceResult
 */
export function placeStone(board: Board, move: Position, color: string): PlaceResult {
  // 1. 临时放置棋子
  const tempBoard = cloneBoard(board);
  tempBoard[move.row][move.col] = color;

  // 2. 提走对方无气群组
  const { board: afterCapture, captured } = captureDeadGroups(tempBoard, opponentColor(color as GoColor));

  // 3. 检查落子方自己的群组是否有气
  const ownGroup = findGroup(afterCapture, move);
  const ownLiberties = getLiberties(afterCapture, ownGroup);
  const alive = ownLiberties.size > 0;

  // 4. 劫点检测
  const koPoint = detectKo(captured, move, afterCapture);

  return {
    board: afterCapture,
    captured,
    koPoint,
    alive,
  };
}

/**
 * 检查落子是否在棋盘范围内且位置为空。
 */
export function isOnBoard(board: Board, pos: Position): boolean {
  return pos.row >= 0 && pos.row < board.length && pos.col >= 0 && pos.col < board[0].length;
}

export function isEmpty(board: Board, pos: Position): boolean {
  return isOnBoard(board, pos) && board[pos.row][pos.col] === null;
}
