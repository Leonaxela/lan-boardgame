/**
 * 国际跳棋 AI —— Minimax + Alpha-Beta 剪枝
 */

import { GameState, Position } from '@lan-boardgame/shared';
import {
  DraughtsColor, DRAUGHTS_COLORS, DraughtsPieceType, DRAUGHTS_PIECES,
  draughtsPieceColor, draughtsPieceType,
} from '../types/index';
import { Board, getAllPieces, isDarkSquare } from '../rules/board';
import { getAllLegalMoves, hasCaptures } from '../rules/moves';

const DEFAULT_DEPTH = 3;

/** 棋子价值 */
const PIECE_VALUES: Record<DraughtsPieceType, number> = {
  man: 100,
  king: 500,
};

/** 位置价值表（10x10，白方视角） */
const POSITION_TABLE = [
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  5,  0,  5,  0,  5,  0,  5,  0,  0],
  [ 0,  0, 10,  0, 10,  0, 10,  0,  5,  0],
  [ 0,  5,  0, 15,  0, 15,  0, 10,  0,  0],
  [ 0,  0, 10,  0, 20,  0, 15,  0,  5,  0],
  [ 0,  5,  0, 15,  0, 20,  0, 10,  0,  0],
  [ 0,  0, 10,  0, 15,  0, 15,  0,  5,  0],
  [ 0,  5,  0, 10,  0, 10,  0, 10,  0,  0],
  [ 0,  0,  5,  0,  5,  0,  5,  0,  5,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
];

/** 评估函数 */
function evaluate(board: Board, aiColor: DraughtsColor): number {
  let score = 0;

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const color = draughtsPieceColor(piece);
      const type = draughtsPieceType(piece);
      const value = PIECE_VALUES[type];

      // 白方用原始行，黑方翻转
      const tableRow = color === 'white' ? r : 9 - r;
      const posBonus = POSITION_TABLE[tableRow]?.[c] ?? 0;

      if (color === aiColor) {
        score += value + posBonus;
      } else {
        score -= value + posBonus;
      }
    }
  }

  return score;
}

/** 执行走法 */
function makeMove(board: Board, from: Position, to: Position, capture?: Position): Board {
  const newBoard = board.map(row => [...row]);
  newBoard[to.row][to.col] = newBoard[from.row][from.col];
  newBoard[from.row][from.col] = null;
  if (capture) {
    newBoard[capture.row][capture.col] = null;
  }
  return newBoard;
}

/** Minimax + Alpha-Beta */
function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  aiColor: DraughtsColor,
  maxDepth: number,
): number {
  if (depth === 0) return evaluate(board, aiColor);

  const currentColor = isMaximizing ? aiColor : (aiColor === 'white' ? 'black' as DraughtsColor : 'white' as DraughtsColor);
  const moves = getAllLegalMoves(board, currentColor);

  if (moves.length === 0) {
    return isMaximizing ? -100000 + (maxDepth - depth) : 100000 - (maxDepth - depth);
  }

  // 吃子优先排序
  moves.sort((a, b) => (b.capture ? 1 : 0) - (a.capture ? 1 : 0));

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const newBoard = makeMove(board, move.from, move.to, move.capture);
      const eval_ = minimax(newBoard, depth - 1, alpha, beta, false, aiColor, maxDepth);
      maxEval = Math.max(maxEval, eval_);
      alpha = Math.max(alpha, eval_);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const newBoard = makeMove(board, move.from, move.to, move.capture);
      const eval_ = minimax(newBoard, depth - 1, alpha, beta, true, aiColor, maxDepth);
      minEval = Math.min(minEval, eval_);
      beta = Math.min(beta, eval_);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

/**
 * AI 选择走法
 */
export function selectAIMove(state: GameState, color: string, difficulty: number = 2): { from: Position; to: Position } | null {
  const board = state.board as unknown as Board;
  const aiColor = color as DraughtsColor;
  const moves = getAllLegalMoves(board, aiColor);

  if (moves.length === 0) return null;

  // 难度 1-4 对应搜索深度 2-5，去掉 depth 1（随机走棋）
  const depth = Math.max(2, Math.min(difficulty + 1, 5));

  let bestScore = -Infinity;
  let bestMove = moves[0];

  for (const move of moves) {
    const newBoard = makeMove(board, move.from, move.to, move.capture);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, aiColor, depth);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
