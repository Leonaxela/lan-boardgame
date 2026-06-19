/**
 * 五子棋中级 AI。
 * 基于连线评分：落子后形成的连子数越高分。
 * 同时考虑进攻（自己连子）和防守（阻挡对方连子）。
 */

import { GameState, Position } from '@lan-boardgame/shared';
import { GOMOKU_COLORS, GomokuColor, opponentColor } from '../types/index';

/** 四方向 */
const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

/** 连子长度对应的分数 */
const SCORE_TABLE: Record<number, number> = {
  5: 100000,
  4: 5000,
  3: 500,
  2: 50,
  1: 5,
};

export function selectAIMove(state: GameState, color: string, difficulty: number = 2): Position | null {
  const board = state.board;
  const opponent = opponentColor(color as GomokuColor);
  const size = board.length;

  let bestScore = -1;
  let bestMove: Position | null = null;

  // 简单模式只看附近1格，普通看2格，困难看3格
  const neighborDist = difficulty >= 3 ? 3 : difficulty >= 2 ? 2 : 1;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== null) continue;

      if (!hasNeighbor(board, r, c, neighborDist)) {
        if (board.flat().filter(v => v !== null).length === 0 && r === 7 && c === 7) {
          // 第一步走天元
        } else {
          continue;
        }
      }

      const attackScore = evaluatePosition(board, r, c, color);
      const defenseScore = evaluatePosition(board, r, c, opponent);
      const centerBonus = (size / 2 - Math.abs(r - size / 2)) + (size / 2 - Math.abs(c - size / 2));
      const centerScore = centerBonus * 0.5;

      let total: number;
      if (difficulty <= 1) {
        // 简单：仅进攻，不考虑防守和位置
        total = attackScore;
      } else if (difficulty === 2) {
        // 普通：当前 AI
        total = attackScore + defenseScore * 1.1 + centerScore;
      } else {
        // 困难：更强防守 + 位置加成
        total = attackScore + defenseScore * 1.3 + centerScore * 1.5;
      }

      if (total > bestScore) {
        bestScore = total;
        bestMove = { row: r, col: c };
      }
    }
  }

  return bestScore > 0 ? bestMove : { row: Math.floor(size / 2), col: Math.floor(size / 2) };
}

/**
 * 评估在 (r, c) 落子后的连子得分。
 */
function evaluatePosition(board: (string | null)[][], row: number, col: number, color: string): number {
  let total = 0;

  for (const dir of DIRS) {
    const count = countDirection(board, row, col, color, dir.dr, dir.dc);
    total += SCORE_TABLE[count] || 0;
  }

  return total;
}

/**
 * 在某个方向上的连子数（含假设落子）。
 */
function countDirection(
  board: (string | null)[][], row: number, col: number,
  color: string, dr: number, dc: number,
): number {
  let count = 1;
  const size = board.length;

  // 正方向
  for (let i = 1; i < 5; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || r >= size || c < 0 || c >= size) break;
    if (board[r][c] !== color) break;
    count++;
  }

  // 反方向
  for (let i = 1; i < 5; i++) {
    const r = row - dr * i;
    const c = col - dc * i;
    if (r < 0 || r >= size || c < 0 || c >= size) break;
    if (board[r][c] !== color) break;
    count++;
  }

  return count;
}

/**
 * 检查指定位置附近是否有棋子。
 */
function hasNeighbor(board: (string | null)[][], row: number, col: number, dist: number): boolean {
  const size = board.length;
  for (let dr = -dist; dr <= dist; dr++) {
    for (let dc = -dist; dc <= dist; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < size && c >= 0 && c < size && board[r][c] !== null) {
        return true;
      }
    }
  }
  return false;
}
