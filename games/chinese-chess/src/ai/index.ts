/**
 * 中国象棋 AI —— Minimax + Alpha-Beta 剪枝
 */

import { GameState, Position } from '@lan-boardgame/shared';
import { CCColor, CCColors, CCPiece, CCPieceType, PIECE_VALUES, pieceColor, pieceType, CC_PIECES } from '../types/index';
import { Board, getAllPieces, findKing } from '../rules/board';
import { getRawMoves } from '../rules/moves';
import { isInCheck, isCheckmate, wouldBeInCheck } from '../rules/check';

const DEFAULT_DEPTH = 3;

/** 棋子位置价值表（简化版） */
const POSITION_BONUS: Record<CCPieceType, number[][]> = {
  // 帅：中心更好
  king: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  // 车：开放线更好
  rook: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  // 马：中心位置更好
  knight: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,1,2,2,2,1,0,0],
    [0,0,1,2,3,2,1,0,0],
    [0,0,1,2,3,2,1,0,0],
    [0,0,1,2,2,2,1,0,0],
    [0,0,0,1,1,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  // 炮：开局位置
  cannon: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  // 兵：过河后价值大增
  pawn: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,1,2,3,2,1,0,0],
    [0,0,1,2,3,2,1,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  advisor: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,0,2,3,2,0,0,0],
    [0,0,0,2,3,2,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ],
  bishop: [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,1,0,0,0,1,0,0],
    [0,0,0,2,0,2,0,0,0],
    [0,1,0,0,3,0,0,1,0],
    [0,0,0,0,0,0,0,0,0],
  ],
};

/** 评估函数：当前局面对 AI 方的评分 */
function evaluate(board: Board, aiColor: CCColor): number {
  let score = 0;
  const opponent = aiColor === 'red' ? 'black' : 'red';

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const color = pieceColor(piece);
      const type = pieceType(piece);
      const value = PIECE_VALUES[type];
      const posBonus = POSITION_BONUS[type]?.[r]?.[c] ?? 0;

      if (color === aiColor) {
        score += value + posBonus * 10;
      } else {
        score -= value + posBonus * 10;
      }
    }
  }

  // 被将军扣分
  if (isInCheck(board, aiColor)) score -= 500;
  if (isInCheck(board, opponent)) score += 500;

  return score;
}

/** 获取所有合法走法 */
function getAllLegalMoves(board: Board, color: CCColor): { from: Position; to: Position }[] {
  const moves: { from: Position; to: Position }[] = [];
  const pieces = getAllPieces(board, color);

  for (const { pos } of pieces) {
    const rawMoves = getRawMoves(board, pos);
    for (const move of rawMoves) {
      if (!wouldBeInCheck(board, pos, move, color)) {
        moves.push({ from: pos, to: move });
      }
    }
  }

  return moves;
}

/** 执行走法（返回新棋盘） */
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
  aiColor: CCColor,
  maxDepth: number,
): number {
  if (depth === 0) return evaluate(board, aiColor);

  const currentColor = isMaximizing ? aiColor : (aiColor === 'red' ? 'black' as CCColor : 'red' as CCColor);
  const moves = getAllLegalMoves(board, currentColor);

  if (moves.length === 0) {
    if (isInCheck(board, currentColor)) {
      return isMaximizing ? -100000 + (maxDepth - depth) : 100000 - (maxDepth - depth);
    }
    return isMaximizing ? -50000 : 50000;
  }

  // 简单排序：吃子走法优先
  moves.sort((a, b) => {
    const captA = board[a.to.row][a.to.col] ? PIECE_VALUES[pieceType(board[a.to.row][a.to.col]!)] : 0;
    const captB = board[b.to.row][b.to.col] ? PIECE_VALUES[pieceType(board[b.to.row][b.to.col]!)] : 0;
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
 * @returns { from, to } 或 null（无合法走法）
 */
export function selectAIMove(state: GameState, color: string, depth: number = DEFAULT_DEPTH): { from: Position; to: Position } | null {
  const board = state.board as unknown as Board;
  const aiColor = color as CCColor;
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
