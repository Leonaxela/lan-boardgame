/**
 * 五子棋 AI。
 * 难度 1-3：贪心评分 + 开放/封闭模式识别
 * 难度 4：Minimax 2 层前瞻
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

/**
 * 活型评分（两端都开放）→ 对手必须立刻应对
 * 死型评分（一端或两端被堵）→ 威胁有限
 */
const SCORE_OPEN: Record<number, number> = {
  5: 100000,  // 连五
  4: 50000,   // 活四 → 下一步必胜
  3: 3000,    // 活三 → 下一步活四
  2: 80,      // 活二
  1: 5,
};

const SCORE_CLOSED: Record<number, number> = {
  5: 100000,
  4: 2000,    // 冲四 → 必须堵
  3: 200,     // 眠三
  2: 10,
  1: 1,
};

/** 困难档 minimax 候选数 */
const MINIMAX_CANDIDATES = 12;

export function selectAIMove(state: GameState, color: string, difficulty: number = 2): Position | null {
  const board = state.board;
  const opponent = opponentColor(color as GomokuColor);
  const size = board.length;

  // 第一手走天元
  const stoneCount = board.flat().filter(v => v !== null).length;
  if (stoneCount === 0) return { row: 7, col: 7 };

  // 难度 4：Minimax 前瞻
  if (difficulty >= 4) {
    return selectMinimaxMove(board, size, color, opponent);
  }

  return selectGreedyMove(board, size, color, opponent, difficulty);
}

// ── 贪心模式（难度 1-3）──

function selectGreedyMove(
  board: (string | null)[][], size: number, color: string, opponent: string, difficulty: number,
): Position | null {
  const neighborDist = difficulty >= 3 ? 3 : difficulty >= 2 ? 2 : 1;

  let bestScore = -Infinity;
  let bestMove: Position | null = null;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== null) continue;
      if (!hasNeighbor(board, r, c, neighborDist)) continue;

      const attackScore = evaluatePosition(board, r, c, color);
      const defenseScore = evaluatePosition(board, r, c, opponent);
      const doubleThreatBonus = (threatCount(board, r, c, color) >= 2) ? 20000 : 0;
      const centerBonus = (size / 2 - Math.abs(r - size / 2)) + (size / 2 - Math.abs(c - size / 2));
      const centerScore = centerBonus * 0.5;

      let total: number;
      if (difficulty <= 1) {
        total = attackScore;
      } else if (difficulty === 2) {
        total = attackScore + defenseScore * 1.1 + centerScore + doubleThreatBonus;
      } else {
        const farBonus = (r >= 5 && r <= 9 && c >= 5 && c <= 9) ? 5 : 0;
        total = attackScore * 1.2 + defenseScore * 1.5 + centerScore * 2.0 + farBonus + doubleThreatBonus;
      }

      if (total > bestScore) {
        bestScore = total;
        bestMove = { row: r, col: c };
      }
    }
  }

  return bestScore > -100 ? bestMove : { row: Math.floor(size / 2), col: Math.floor(size / 2) };
}

// ── Minimax 模式（难度 4）──

function selectMinimaxMove(
  board: (string | null)[][], size: number, color: string, opponent: string,
): Position | null {
  const neighborDist = 3;

  // 第一遍：贪心评分，选出 top-12 候选人
  interface Candidate { row: number; col: number; score: number }
  const candidates: Candidate[] = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== null) continue;
      if (!hasNeighbor(board, r, c, neighborDist)) continue;

      const attackScore = evaluatePosition(board, r, c, color);
      const defenseScore = evaluatePosition(board, r, c, opponent);
      const doubleThreatBonus = (threatCount(board, r, c, color) >= 2) ? 20000 : 0;
      const centerBonus = (size / 2 - Math.abs(r - size / 2)) + (size / 2 - Math.abs(c - size / 2));
      const centerScore = centerBonus * 0.5;
      const total = attackScore * 1.2 + defenseScore * 1.5 + centerScore * 2.0 + doubleThreatBonus;

      candidates.push({ row: r, col: c, score: total });
    }
  }

  // 取 top-12
  candidates.sort((a, b) => b.score - a.score);
  const topN = candidates.slice(0, MINIMAX_CANDIDATES);

  // 第二遍：对每个候选，模拟对手最佳回应，选净得分最大者
  let bestNet = -Infinity;
  let bestMove: Position | null = topN[0] ? { row: topN[0].row, col: topN[0].col } : null;

  for (const cand of topN) {
    // 模拟 AI 落子
    const newBoard = cloneBoard(board);
    newBoard[cand.row][cand.col] = color;

    // 检查是否直接获胜
    if (checkImmediateWin(newBoard, cand.row, cand.col, color)) {
      return { row: cand.row, col: cand.col };
    }

    // 找对手最佳回应（贪心，只看一步）
    let opponentBestScore = -Infinity;
    for (let rr = 0; rr < size; rr++) {
      for (let cc = 0; cc < size; cc++) {
        if (newBoard[rr][cc] !== null) continue;
        if (!hasNeighbor(newBoard, rr, cc, 2)) continue;
        const score = evaluatePosition(newBoard, rr, cc, opponent) * 1.2 +
                      evaluatePosition(newBoard, rr, cc, color) * 1.5;
        if (score > opponentBestScore) opponentBestScore = score;
      }
    }

    const netScore = cand.score - opponentBestScore * 0.85;
    if (netScore > bestNet) {
      bestNet = netScore;
      bestMove = { row: cand.row, col: cand.col };
    }
  }

  return bestMove || { row: Math.floor(size / 2), col: Math.floor(size / 2) };
}

// ── 辅助函数 ──

function cloneBoard(board: (string | null)[][]): (string | null)[][] {
  return board.map(row => [...row]);
}

/** AI 落子后是否直接连五获胜 */
function checkImmediateWin(board: (string | null)[][], row: number, col: number, color: string): boolean {
  for (const dir of DIRS) {
    const result = countDirection(board, row, col, color, dir.dr, dir.dc);
    if (result.count >= 5) return true;
  }
  return false;
}

function evaluatePosition(board: (string | null)[][], row: number, col: number, color: string): number {
  let total = 0;
  for (const dir of DIRS) {
    const result = countDirection(board, row, col, color, dir.dr, dir.dc);
    total += result.open ? (SCORE_OPEN[result.count] || 0) : (SCORE_CLOSED[result.count] || 0);
  }
  return total;
}

interface CountResult { count: number; open: boolean }

function countDirection(
  board: (string | null)[][], row: number, col: number,
  color: string, dr: number, dc: number,
): CountResult {
  let count = 1;
  const size = board.length;
  let openEnds = 0;

  for (let i = 1; i <= 5; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || r >= size || c < 0 || c >= size) break;
    if (board[r][c] !== color) {
      if (board[r][c] === null) openEnds++;
      break;
    }
    count++;
  }

  for (let i = 1; i <= 5; i++) {
    const r = row - dr * i;
    const c = col - dc * i;
    if (r < 0 || r >= size || c < 0 || c >= size) break;
    if (board[r][c] !== color) {
      if (board[r][c] === null) openEnds++;
      break;
    }
    count++;
  }

  return { count, open: openEnds === 2 };
}

function threatCount(board: (string | null)[][], row: number, col: number, color: string): number {
  let threats = 0;
  for (const dir of DIRS) {
    const result = countDirection(board, row, col, color, dir.dr, dir.dc);
    if ((result.open && result.count >= 4) || (result.open && result.count === 3)) {
      threats++;
    }
  }
  return threats;
}

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
