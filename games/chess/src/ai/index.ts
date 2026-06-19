/**
 * 国际象棋 AI —— Minimax + Alpha-Beta 剪枝
 */

import { GameState, Position } from '@lan-boardgame/shared';
import {
  IntlColor, INTL_COLORS, IntlPieceType,
  INTL_PIECE_VALUES, intlPieceColor, intlPieceType,
} from '../types/index';
import { Board, getAllPieces, findKing } from '../rules/board';
import { getRawMoves, RawMove } from '../rules/moves';
import { isInCheck, wouldBeInCheck } from '../rules/check';

const DEFAULT_DEPTH = 3;

/** 棋子位置价值表（8×8，白方视角，从上到下 row 0-7） */
const PAWN_TABLE = [
  [ 0,  0,  0,  0,  0,  0,  0,  0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [ 5,  5, 10, 25, 25, 10,  5,  5],
  [ 0,  0,  0, 20, 20,  0,  0,  0],
  [ 5, -5,-10,  0,  0,-10, -5,  5],
  [ 5, 10, 10,-20,-20, 10, 10,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0],
];

const KNIGHT_TABLE = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,  0,  0,  0,  0,-20,-40],
  [-30,  0, 10, 15, 15, 10,  0,-30],
  [-30,  5, 15, 20, 20, 15,  5,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,  5, 10, 15, 15, 10,  5,-30],
  [-40,-20,  0,  5,  5,  0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50],
];

const BISHOP_TABLE = [
  [-20,-10,-10,-10,-10,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0, 10, 10, 10, 10,  0,-10],
  [-10,  5,  5, 10, 10,  5,  5,-10],
  [-10,  0, 10, 10, 10, 10,  0,-10],
  [-10, 10, 10, 10, 10, 10, 10,-10],
  [-10,  5,  0,  0,  0,  0,  5,-10],
  [-20,-10,-10,-10,-10,-10,-10,-20],
];

const ROOK_TABLE = [
  [ 0,  0,  0,  0,  0,  0,  0,  0],
  [ 5, 10, 10, 10, 10, 10, 10,  5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [ 0,  0,  0,  5,  5,  0,  0,  0],
];

const QUEEN_TABLE = [
  [-20,-10,-10, -5, -5,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  5,  5,  5,  5,  0,-10],
  [ -5,  0,  5,  5,  5,  5,  0, -5],
  [  0,  0,  5,  5,  5,  5,  0, -5],
  [-10,  5,  5,  5,  5,  5,  0,-10],
  [-10,  0,  5,  0,  0,  0,  0,-10],
  [-20,-10,-10, -5, -5,-10,-10,-20],
];

const KING_MID_TABLE = [
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [ 20, 20,  0,  0,  0,  0, 20, 20],
  [ 20, 30, 10,  0,  0, 10, 30, 20],
];

const POSITION_TABLES: Record<string, number[][]> = {
  pawn: PAWN_TABLE,
  knight: KNIGHT_TABLE,
  bishop: BISHOP_TABLE,
  rook: ROOK_TABLE,
  queen: QUEEN_TABLE,
  king: KING_MID_TABLE,
};

/** 评估函数 */
function evaluate(board: Board, aiColor: IntlColor): number {
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const color = intlPieceColor(piece);
      const type = intlPieceType(piece);
      const value = INTL_PIECE_VALUES[type];

      // 白方用原始行，黑方翻转
      const tableRow = color === 'white' ? r : 7 - r;
      const posBonus = POSITION_TABLES[type]?.[tableRow]?.[c] ?? 0;

      if (color === aiColor) {
        score += value + posBonus;
      } else {
        score -= value + posBonus;
      }
    }
  }

  if (isInCheck(board, aiColor)) score -= 50;
  const opponent = aiColor === 'white' ? 'black' : 'white';
  if (isInCheck(board, opponent as IntlColor)) score += 50;

  return score;
}

/** 获取所有合法走法 */
function getAllLegalMoves(board: Board, color: IntlColor): { from: Position; to: Position }[] {
  const moves: { from: Position; to: Position }[] = [];
  const pieces = getAllPieces(board, color);

  for (const { pos } of pieces) {
    const rawMoves = getRawMoves(board, pos);
    for (const move of rawMoves) {
      if (!wouldBeInCheck(board, pos, move.to, color)) {
        moves.push({ from: pos, to: move.to });
      }
    }
  }

  return moves;
}

/** 执行走法 */
function makeMove(board: Board, from: Position, to: Position): Board {
  const newBoard = board.map(row => [...row]);
  newBoard[to.row][to.col] = newBoard[from.row][from.col];
  newBoard[from.row][from.col] = null;
  return newBoard;
}

/** Minimax + Alpha-Beta */
function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  aiColor: IntlColor,
  maxDepth: number,
): number {
  if (depth === 0) return evaluate(board, aiColor);

  const currentColor = isMaximizing ? aiColor : (aiColor === 'white' ? 'black' as IntlColor : 'white' as IntlColor);
  const moves = getAllLegalMoves(board, currentColor);

  if (moves.length === 0) {
    if (isInCheck(board, currentColor)) {
      return isMaximizing ? -100000 + (maxDepth - depth) : 100000 - (maxDepth - depth);
    }
    return 0; // 逼和
  }

  // 吃子优先排序
  moves.sort((a, b) => {
    const captA = board[a.to.row][a.to.col] ? INTL_PIECE_VALUES[intlPieceType(board[a.to.row][a.to.col]!)] : 0;
    const captB = board[b.to.row][b.to.col] ? INTL_PIECE_VALUES[intlPieceType(board[b.to.row][b.to.col]!)] : 0;
    return captB - captA;
  });

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const newBoard = makeMove(board, move.from, move.to);
      const eval_ = minimax(newBoard, depth - 1, alpha, beta, false, aiColor, maxDepth);
      maxEval = Math.max(maxEval, eval_);
      alpha = Math.max(alpha, eval_);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const newBoard = makeMove(board, move.from, move.to);
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
export function selectAIMove(state: GameState, color: string, depth: number = DEFAULT_DEPTH): { from: Position; to: Position } | null {
  const board = state.board as unknown as Board;
  const aiColor = color as IntlColor;
  const moves = getAllLegalMoves(board, aiColor);

  if (moves.length === 0) return null;

  let bestScore = -Infinity;
  let bestMove = moves[0];

  for (const move of moves) {
    const newBoard = makeMove(board, move.from, move.to);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, aiColor, depth);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
