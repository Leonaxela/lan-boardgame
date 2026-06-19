/**
 * 围棋 AI —— 三档难度 + MCTS
 *
 * 简单：基础评分（提子/领地/位置），约 10-15 级
 * 普通：完整启发式评分，约 业余 1-2 段
 * 困难：MCTS 蒙特卡洛树搜索，约 业余 3-5 段
 */

import { GameState, Position } from '@lan-boardgame/shared';
import {
  Board, cloneBoard, findGroup, getLiberties, getNeighbors,
  posKey, placeStone, isEmpty, isOnBoard,
} from '../rules/base';
import { GoColor, opponentColor } from '../types/index';

// ══════════════════════════════════════════════
//  主入口
// ══════════════════════════════════════════════

export function selectAIMove(state: GameState, color: string, difficulty: number = 2): Position | null {
  if (difficulty >= 3) {
    return mctsSearch(state, color);
  }
  return heuristicSearch(state, color, difficulty);
}

// ══════════════════════════════════════════════
//  启发式评分（简单/普通）
// ══════════════════════════════════════════════

const SCORE = {
  CAPTURE: 10000, SAVE_OWN: 9000, ATARI_OPPONENT: 500,
  ATARI_CONNECT: 200, TERRITORY: 15, OPPRESS: 8,
  EDGE_3_4: 5, EDGE_2: 0, EDGE_1: -5,
  EYE_FILL: -300, KO_LOSE: -200,
};

function heuristicSearch(state: GameState, color: string, difficulty: number): Position | null {
  const board = state.board;
  const candidates: { pos: Position; score: number }[] = [];

  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c] !== null) continue;
      const pos = { row: r, col: c };
      const score = evaluateMove(state, pos, color, difficulty);
      if (score > -9999) candidates.push({ pos, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  const topScore = candidates[0].score;
  // 简单：只取最佳；普通：允许小范围随机
  const threshold = difficulty >= 2 ? 3 : 0;
  const topMoves = candidates.filter(c => c.score >= topScore - threshold);
  const pick = topMoves[Math.floor(Math.random() * topMoves.length)];

  if (topScore < -50) return null;
  return pick.pos;
}

function evaluateMove(state: GameState, move: Position, color: string, difficulty: number): number {
  const board = state.board;
  const opponent = opponentColor(color as GoColor);

  // 简单：仅领地+提子+位置
  if (difficulty <= 1) {
    const placeResult = placeStone(board, move, color);
    if (!placeResult.alive && placeResult.captured.length === 0) return -99999;
    let score = 0;
    if (placeResult.captured.length > 0) score += SCORE.CAPTURE + placeResult.captured.length * 200;
    const ownNeighborCount = getNeighbors(board, move).filter(n => board[n.row][n.col] === color).length;
    score += ownNeighborCount * SCORE.TERRITORY;
    const minDist = Math.min(move.row, board.length - 1 - move.row, move.col, board[0].length - 1 - move.col);
    if (minDist >= 2 && minDist <= 3) score += SCORE.EDGE_3_4;
    return score;
  }

  // 普通：完整评分
  let score = 0;
  const placeResult = placeStone(board, move, color);
  if (!placeResult.alive && placeResult.captured.length === 0) return -99999;

  if (placeResult.captured.length > 0) score += SCORE.CAPTURE + placeResult.captured.length * 200;
  const afterBoard = placeResult.board;

  // 逃子
  const ownAtari = findAtariGroups(board, color);
  for (const group of ownAtari) {
    const newGroup = findGroup(afterBoard, group[0]);
    const newLibs = getLiberties(afterBoard, newGroup);
    if (newLibs.size >= 2) score += SCORE.SAVE_OWN + group.length * 50;
  }

  // 打吃对方
  const opponentAtari = findAtariGroups(afterBoard, opponent);
  for (const group of opponentAtari) score += SCORE.ATARI_OPPONENT + group.length * 30;

  // 连接
  const ownGroup = findGroup(afterBoard, move);
  const ownLibs = getLiberties(afterBoard, ownGroup);
  if (ownGroup.length >= 2 && ownLibs.size >= 2) score += SCORE.ATARI_CONNECT;

  // 领地+压制
  let nearbyOwn = 0, nearbyOpp = 0;
  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) {
      const nr = move.row + dr, nc = move.col + dc;
      if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
        if (board[nr][nc] === color) nearbyOwn++;
        else if (board[nr][nc] === opponent) nearbyOpp++;
      }
    }
  }
  score += nearbyOwn * SCORE.TERRITORY + nearbyOpp * SCORE.OPPRESS;

  // 位置
  const minDist = Math.min(move.row, board.length - 1 - move.row, move.col, board[0].length - 1 - move.col);
  if (minDist === 0) score += SCORE.EDGE_1;
  else if (minDist === 1) score += SCORE.EDGE_2;
  else if (minDist >= 2 && minDist <= 3) score += SCORE.EDGE_3_4;

  // 开局
  if (state.moveCount < 10) {
    for (const star of getStarPositions(board.length, board[0].length)) {
      if (move.row === star.row && move.col === star.col) score += 15;
    }
  }

  // 填眼
  const ownNeighborCount = getNeighbors(board, move).filter(n => board[n.row][n.col] === color).length;
  if (ownNeighborCount >= 3 && ownLibs.size <= 1) score += SCORE.EYE_FILL;

  // 劫
  const koPoint = (state.extra as any)?.koPoint as Position | null;
  if (koPoint && move.row === koPoint.row && move.col === koPoint.col) score += SCORE.KO_LOSE;

  return score;
}

function findAtariGroups(board: Board, color: string): Position[][] {
  const visited = new Set<string>();
  const atariGroups: Position[][] = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c] !== color) continue;
      const key = posKey({ row: r, col: c });
      if (visited.has(key)) continue;
      const group = findGroup(board, { row: r, col: c });
      for (const p of group) visited.add(posKey(p));
      if (getLiberties(board, group).size === 1) atariGroups.push(group);
    }
  }
  return atariGroups;
}

function getStarPositions(rows: number, cols: number): Position[] {
  if (rows === 19) {
    const stars: Position[] = [];
    for (const r of [3, 9, 15]) for (const c of [3, 9, 15]) stars.push({ row: r, col: c });
    return stars;
  }
  if (rows === 13) {
    const stars: Position[] = [];
    for (const r of [3, 6, 9]) for (const c of [3, 6, 9]) stars.push({ row: r, col: c });
    return stars;
  }
  return [{ row: 2, col: 2 }, { row: 2, col: 6 }, { row: 4, col: 4 }, { row: 6, col: 2 }, { row: 6, col: 6 }];
}

// ══════════════════════════════════════════════
//  MCTS 蒙特卡洛树搜索（困难）
// ══════════════════════════════════════════════

interface MCTSNode {
  board: Board;
  color: string;       // 当前轮到的颜色
  move: Position | null;
  parent: MCTSNode | null;
  children: MCTSNode[];
  wins: number;
  visits: number;
  untriedMoves: Position[];
  /** 走到这个节点的玩家颜色（即父节点的颜色） */
  movedBy: string | null;
  /** 先验分数（来自启发式评估） */
  priorScore: number;
}

function mctsSearch(state: GameState, color: string): Position | null {
  const board = state.board;
  const root = createMCTSNode(board, color, null, null, null);

  // 排除自杀位置
  root.untriedMoves = root.untriedMoves.filter(pos => {
    const result = placeStone(board, pos, color);
    return result.alive || result.captured.length > 0;
  });

  if (root.untriedMoves.length === 0) return null;

  const maxIterations = 2000;
  const timeoutMs = 15000;
  const opponent = opponentColor(color as GoColor);
  const startTime = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    if (Date.now() - startTime > timeoutMs) break;

    // 1. 选择
    let node = root;
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      node = selectChild(node);
    }

    // 2. 扩展
    if (node.untriedMoves.length > 0) {
      node = expandNode(node);
    }

    // 3. 模拟
    const result = simulate(node.board, node.color, opponent);

    // 4. 回溯
    backpropagate(node, result);
  }

  // 选择访问次数最多的子节点
  if (root.children.length === 0) return null;
  const best = root.children.reduce((a, b) => a.visits > b.visits ? a : b);
  return best.move;
}

function createMCTSNode(board: Board, color: string, move: Position | null, parent: MCTSNode | null, untriedMoves: Position[] | null): MCTSNode {
  const allMoves: Position[] = [];
  if (!untriedMoves) {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] === null) allMoves.push({ row: r, col: c });
      }
    }
  }
  return {
    board, color, move, parent,
    children: [],
    wins: 0, visits: 0,
    untriedMoves: untriedMoves || allMoves,
    movedBy: parent?.color ?? null,
    priorScore: 0,
  };
}

/** PUCT 选择子节点（AlphaGo 风格） */
function selectChild(node: MCTSNode): MCTSNode {
  const C = 1.41; // 探索常数
  const priorWeight = 0.3; // 先验权重
  return node.children.reduce((best, child) => {
    // 基础 UCB1
    const ucb = child.wins / child.visits + C * Math.sqrt(Math.log(node.visits) / child.visits);
    // 加入先验分数
    const priorBonus = priorWeight * child.priorScore / (1 + child.visits);
    const totalUcb = ucb + priorBonus;
    
    const bestUcb = best.wins / best.visits + C * Math.sqrt(Math.log(node.visits) / best.visits);
    const bestPriorBonus = priorWeight * best.priorScore / (1 + best.visits);
    const bestTotalUcb = bestUcb + bestPriorBonus;
    
    return totalUcb > bestTotalUcb ? child : best;
  });
}

/** 扩展一个子节点 */
function expandNode(node: MCTSNode): MCTSNode {
  // 优先扩展评分高的走法
  const scoredMoves = node.untriedMoves.map(pos => {
    const result = placeStone(node.board, pos, node.color);
    const score = result.captured.length * 100 + 
                  (result.alive ? 50 : 0) +
                  rolloutMoveWeight(node.board, pos, node.color, node.board.length);
    return { pos, score };
  });
  scoredMoves.sort((a, b) => b.score - a.score);
  
  // 从前 30% 中随机选择（平衡探索和利用）
  const topN = Math.max(1, Math.ceil(scoredMoves.length * 0.3));
  const idx = Math.floor(Math.random() * topN);
  const move = scoredMoves[idx].pos;
  const priorScore = scoredMoves[idx].score / 100; // 归一化
  
  // 从 untriedMoves 中移除
  const moveIdx = node.untriedMoves.findIndex(p => p.row === move.row && p.col === move.col);
  if (moveIdx >= 0) node.untriedMoves.splice(moveIdx, 1);

  const placeResult = placeStone(node.board, move, node.color);
  const nextColor = opponentColor(node.color as GoColor);
  const child = createMCTSNode(placeResult.board, nextColor, move, node, null);
  child.priorScore = Math.min(1, priorScore); // 限制在 [0, 1]

  // 过滤子节点的非法位置（自杀）
  child.untriedMoves = child.untriedMoves.filter(pos => {
    const result = placeStone(placeResult.board, pos, nextColor);
    return result.alive || result.captured.length > 0;
  });

  node.children.push(child);
  return child;
}

/** 加权随机选择：根据评分权重选择走位 */
function weightedRandomPick(items: Position[], weights: number[]): Position {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return items[Math.floor(Math.random() * items.length)];
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** 评估 rollout 走位的权重 */
function rolloutMoveWeight(board: Board, pos: Position, color: string, size: number): number {
  let weight = 10; // 基础权重
  const result = placeStone(board, pos, color);
  if (!result.alive && result.captured.length === 0) return 0; // 非法走法

  // 能提子 → 高权重
  if (result.captured.length > 0) {
    weight += 150 * result.captured.length;
  }

  // 靠近已有棋子（有根据地）
  const neighbors = getNeighbors(board, pos);
  let friendlyNearby = 0;
  let opponentNearby = 0;
  let emptyNearby = 0;
  for (const n of neighbors) {
    if (board[n.row][n.col] === color) friendlyNearby++;
    else if (board[n.row][n.col] === null) emptyNearby++;
    else opponentNearby++;
  }

  // 连接己方棋子
  weight += friendlyNearby * 20;

  // 靠近中心（天元附近）
  const center = Math.floor(size / 2);
  const distToCenter = Math.abs(pos.row - center) + Math.abs(pos.col - center);
  weight += Math.max(0, 15 - distToCenter);

  // 避免填眼（周围全是自己的子且只有一个空位）
  if (emptyNearby === 1 && friendlyNearby >= 3) {
    weight -= 100;
  }

  // 避免自紧气（落子后只剩1口气）
  const group = findGroup(result.board, pos);
  const liberties = getLiberties(result.board, group);
  if (liberties.size <= 1) {
    weight -= 80;
  }

  // 打吃对方（对方只剩1口气）
  const opponent = color === 'black' ? 'white' : 'black';
  for (const n of neighbors) {
    if (board[n.row][n.col] === opponent) {
      const oppGroup = findGroup(result.board, n);
      const oppLibs = getLiberties(result.board, oppGroup);
      if (oppLibs.size === 1) weight += 80; // 打吃
      else if (oppLibs.size === 2) weight += 20; // 接近打吃
    }
  }

  // 逃子（己方棋子只剩1口气，落子后气增加）
  for (const n of neighbors) {
    if (board[n.row][n.col] === color) {
      const ownGroup = findGroup(board, n);
      const ownLibs = getLiberties(board, ownGroup);
      if (ownLibs.size === 1) {
        // 己方棋子在被打吃，这步棋可能是逃子
        const newGroup = findGroup(result.board, n);
        const newLibs = getLiberties(result.board, newGroup);
        if (newLibs.size >= 2) weight += 100; // 成功逃出
      }
    }
  }

  // 边角位置权重
  const minDist = Math.min(pos.row, size - 1 - pos.row, pos.col, size - 1 - pos.col);
  if (minDist === 0) weight -= 5; // 一线
  else if (minDist === 1) weight -= 2; // 二线
  else if (minDist >= 2 && minDist <= 3) weight += 5; // 三四线好位置

  // 开局星位
  if (board.every(row => row.every(cell => cell === null)) || 
      (board.filter(row => row.some(cell => cell !== null)).length < 4)) {
    const stars = getStarPositions(size, size);
    for (const star of stars) {
      if (pos.row === star.row && pos.col === star.col) weight += 25;
    }
  }

  return Math.max(1, weight);
}

/** 模拟到终局，返回胜者颜色 */
function simulate(board: Board, color: string, opponent: string): string {
  let currentBoard = board;
  let currentColor = color;
  const size = board.length;
  let passCount = 0;
  const maxMoves = Math.floor(size * size * 1.5); // 限制步数

  for (let i = 0; i < maxMoves; i++) {
    // 收集合法走位
    const moves: Position[] = [];
    const weights: number[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (currentBoard[r][c] !== null) continue;
        const pos = { row: r, col: c };
        const result = placeStone(currentBoard, pos, currentColor);
        if (result.alive || result.captured.length > 0) {
          moves.push(pos);
          weights.push(rolloutMoveWeight(currentBoard, pos, currentColor, size));
        }
      }
    }

    if (moves.length === 0) {
      passCount++;
      if (passCount >= 2) break;
      currentColor = opponentColor(currentColor as GoColor);
      continue;
    }

    passCount = 0;
    // 加权随机选择走位
    const pick = weightedRandomPick(moves, weights);
    const result = placeStone(currentBoard, pick, currentColor);
    currentBoard = result.board;
    currentColor = opponentColor(currentColor as GoColor);
  }

  // 评估结果：数子法
  let black = 0, white = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (currentBoard[r][c] === 'black') black++;
      else if (currentBoard[r][c] === 'white') white++;
    }
  }

  // 用简化的领地估算（BFS 填充空区域）
  const territory = estimateTerritory(currentBoard, size);
  black += territory.black;
  white += territory.white;

  // 贴目：中国规则 3.75 子（7.5 目）
  const komi = 3.75;

  return black >= white + komi ? 'black' : 'white';
}

/** 领地估算：BFS 填充空区域，根据边界棋子颜色判断归属 */
function estimateTerritory(board: Board, size: number): { black: number; white: number } {
  const visited = new Set<string>();
  let black = 0, white = 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== null) continue;
      const key = `${r},${c}`;
      if (visited.has(key)) continue;

      // BFS 填充空区域
      const region: Position[] = [];
      const queue: Position[] = [{ row: r, col: c }];
      const borderColors = new Map<string, number>(); // color -> count

      while (queue.length > 0) {
        const pos = queue.shift()!;
        const k = posKey(pos);
        if (visited.has(k)) continue;
        visited.add(k);
        region.push(pos);

        for (const n of getNeighbors(board, pos)) {
          const nk = posKey(n);
          if (visited.has(nk)) continue;
          if (board[n.row][n.col] === null) {
            queue.push(n);
          } else {
            // 统计边界上每种颜色的棋子数
            const c = board[n.row][n.col] as string;
            borderColors.set(c, (borderColors.get(c) || 0) + 1);
          }
        }
      }

      // 归属判断：只有一种颜色且数量 >= 区域大小的一半
      if (borderColors.size === 1) {
        const [color] = borderColors.keys();
        if (color === 'black') black += region.length;
        else white += region.length;
      } else if (borderColors.size === 2) {
        // 两种颜色都有，按比例分配
        const blackCount = borderColors.get('black') || 0;
        const whiteCount = borderColors.get('white') || 0;
        const total = blackCount + whiteCount;
        if (total > 0) {
          black += Math.round(region.length * blackCount / total);
          white += Math.round(region.length * whiteCount / total);
        }
      }
    }
  }

  return { black, white };
}

/** 回溯更新胜率 */
function backpropagate(node: MCTSNode | null, winnerColor: string): void {
  while (node) {
    node.visits++;
    if (node.movedBy === winnerColor) {
      node.wins++;
    }
    node = node.parent;
  }
}
