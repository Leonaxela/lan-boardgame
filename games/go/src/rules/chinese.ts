/**
 * 中国围棋规则（数子制）引擎。
 *
 * 规则要点：
 *   - 贴 3¾ 子（相当于 7.5 目）
 *   - 终局数盘上活子数决定胜负
 *   - 禁止全局同形（简单劫：禁止立即回提）
 *   - 允许虚手（连续双方虚手则终局）
 */

import {
  IGameEngine,
  GameState,
  ValidationResult,
  GameConfig,
  Position,
  Player,
  GameResult,
  GamePhase,
  GameType,
  WinReason,
} from '@lan-boardgame/shared';

import {
  Board,
  createBoard,
  cloneBoard,
  isEmpty,
  placeStone,
  PlaceResult,
} from './base';

import {
  GoColor,
  GO_COLORS,
  GoRuleSet,
  GoExtraState,
  getGoExtra,
  opponentColor,
} from '../types/index';

/** 中国规则贴目：3¾ 子 = 7.5 目。用于白方加分 */
const CHINESE_KOMI = 7.5;

export class ChineseGoEngine implements IGameEngine {
  readonly gameType = GameType.Go;

  // ──────────────────────────────────────────────
  //  IGameEngine 接口实现
  // ──────────────────────────────────────────────

  createInitialState(config: GameConfig, players: Player[]): GameState {
    const size = config.rows; // 正方形棋盘
    const board = createBoard(size, size);

    // 初始 extra 状态
    const extra: GoExtraState = {
      koPoint: null,
      consecutivePasses: 0,
      capturedCount: { black: 0, white: 0 },
      stoneCount: { black: 0, white: 0 },
    };

    // 处理让子
    const handicap = (config.extra as any)?.handicap as number ?? 0;
    if (handicap > 0) {
      const positions = getHandicapPositions(size, handicap);
      for (const pos of positions) {
        board[pos.row][pos.col] = GO_COLORS.BLACK;
      }
      extra.stoneCount.black = positions.length;
      extra.handicapPositions = positions;
    }

    return {
      phase: GamePhase.Playing,
      currentTurn: handicap > 0 ? GO_COLORS.WHITE : GO_COLORS.BLACK,
      board,
      moveCount: 0,
      lastMove: null,
      extra: extra as unknown as Record<string, unknown>,
    };
  }

  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult {
    // 游戏阶段检查
    if (state.phase !== GamePhase.Playing) {
      return { valid: false, reason: '游戏已结束' };
    }

    // 轮次检查
    if (playerColor !== state.currentTurn) {
      return { valid: false, reason: '不是您的回合' };
    }

    // 边界检查
    if (!isEmpty(state.board, move)) {
      if (move.row < 0 || move.row >= state.board.length || move.col < 0 || move.col >= state.board[0].length) {
        return { valid: false, reason: '落子在棋盘外' };
      }
      return { valid: false, reason: '该位置已有棋子' };
    }

    // 劫点检查
    const extra = getGoExtra(state.extra);
    if (extra.koPoint && move.row === extra.koPoint.row && move.col === extra.koPoint.col) {
      return { valid: false, reason: '劫 — 禁止立即回提' };
    }

    // 自杀检查：尝试落子，如果己方无气且没有提掉对方，则为自杀
    const result = placeStone(state.board, move, playerColor);
    if (!result.alive && result.captured.length === 0) {
      return { valid: false, reason: '禁止自杀' };
    }

    return { valid: true };
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    // 调用 placeStone 获取新棋盘
    const result = placeStone(state.board, move, playerColor);
    const extra = getGoExtra(state.extra);

    // 更新棋子计数
    const newCapturedCount = { ...extra.capturedCount };
    const opponentCol = opponentColor(playerColor as GoColor);
    newCapturedCount[opponentCol] = (newCapturedCount[opponentCol] || 0) + result.captured.length;

    // 统计棋盘上棋子数
    let blackCount = 0;
    let whiteCount = 0;
    for (let r = 0; r < result.board.length; r++) {
      for (let c = 0; c < result.board[0].length; c++) {
        if (result.board[r][c] === GO_COLORS.BLACK) blackCount++;
        else if (result.board[r][c] === GO_COLORS.WHITE) whiteCount++;
      }
    }

    const newExtra: GoExtraState = {
      koPoint: result.koPoint,
      consecutivePasses: 0, // 有落子，pass 计数清零
      capturedCount: newCapturedCount,
      stoneCount: { black: blackCount, white: whiteCount },
      handicapPositions: extra.handicapPositions,
    };

    return {
      phase: GamePhase.Playing,
      currentTurn: opponentCol,
      board: result.board,
      moveCount: state.moveCount + 1,
      lastMove: move,
      extra: newExtra as unknown as Record<string, unknown>,
    };
  }

  checkGameEnd(state: GameState): GameResult | null {
    const extra = getGoExtra(state.extra);
    if (extra.consecutivePasses < 2) return null;

    // 双方连续 pass → 终局，中国规则数子
    return this.countChineseScore(state);
  }

  handlePass(state: GameState, playerColor: string): GameState {
    const extra = getGoExtra(state.extra);
    const opponentCol = opponentColor(playerColor as GoColor);

    const newExtra: GoExtraState = {
      ...extra,
      consecutivePasses: extra.consecutivePasses + 1,
    };

    return {
      ...state,
      currentTurn: opponentCol,
      moveCount: state.moveCount + 1,
      lastMove: null,
      extra: newExtra as unknown as Record<string, unknown>,
    };
  }

  handleResign(state: GameState, playerColor: string): GameResult {
    const opponentCol = opponentColor(playerColor as GoColor);
    return {
      winner: { id: '', name: '', color: opponentCol },
      reason: WinReason.Resign,
      scores: {},
    };
  }

  getDefaultConfig(): GameConfig {
    return {
      gameType: GameType.Go,
      rows: 19,
      cols: 19,
      extra: {
        boardSize: 19,
        ruleSet: GoRuleSet.Chinese,
        komi: CHINESE_KOMI,
        handicap: 0,
      },
    };
  }

  // ──────────────────────────────────────────────
  //  中国规则特有的胜负判定
  // ──────────────────────────────────────────────

  /**
   * 中国规则数子法：
   * 1. 移除所有死子（无气或被围死的棋组）
   * 2. 数活子 + 数领地
   * 3. 黑得分 = 黑活子 + 黑领地
   *    白得分 = 白活子 + 白领地
   *    （scores 不含贴目，贴目在显示层处理）
   * 4. 胜子数 = 一方总得点 - (归本数 + 贴目)
   */
  private countChineseScore(state: GameState): GameResult {
    const size = state.board.length;

    // 1. 移除死子
    let board = state.board.map(r => [...r]);
    this.removeDeadStones(board, size);

    // 2. 数活子
    let blackCount = 0, whiteCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === GO_COLORS.BLACK) blackCount++;
        else if (board[r][c] === GO_COLORS.WHITE) whiteCount++;
      }
    }

    // 3. 数领地：BFS 填充空区域
    const visited = new Set<string>();
    let blackTerritory = 0, whiteTerritory = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== null) continue;
        const key = `${r},${c}`;
        if (visited.has(key)) continue;
        const region: Position[] = [];
        const queue: Position[] = [{ row: r, col: c }];
        const borderColors = new Map<string, number>();
        while (queue.length > 0) {
          const pos = queue.shift()!;
          const k = `${pos.row},${pos.col}`;
          if (visited.has(k)) continue;
          if (pos.row < 0 || pos.row >= size || pos.col < 0 || pos.col >= size) continue;
          if (board[pos.row][pos.col] !== null) {
            const cc = board[pos.row][pos.col] as string;
            borderColors.set(cc, (borderColors.get(cc) || 0) + 1);
            continue;
          }
          visited.add(k);
          region.push(pos);
          queue.push({ row: pos.row - 1, col: pos.col });
          queue.push({ row: pos.row + 1, col: pos.col });
          queue.push({ row: pos.row, col: pos.col - 1 });
          queue.push({ row: pos.row, col: pos.col + 1 });
        }
        if (borderColors.size === 1) {
          const [color] = borderColors.keys();
          if (color === GO_COLORS.BLACK) blackTerritory += region.length;
          else whiteTerritory += region.length;
        } else if (borderColors.size === 2) {
          const blackB = borderColors.get(GO_COLORS.BLACK) || 0;
          const whiteB = borderColors.get(GO_COLORS.WHITE) || 0;
          const total = blackB + whiteB;
          if (total > 0) {
            blackTerritory += Math.round(region.length * blackB / total);
            whiteTerritory += Math.round(region.length * whiteB / total);
          }
        }
      }
    }

    // 4. 计算得分（不含贴目）
    const blackScore = blackCount + blackTerritory;
    const whiteScore = whiteCount + whiteTerritory;

    // 5. 判定胜负：中国规则第11条
    //    胜子数 = 一方总得点 - (归本数 + 贴目)
    //    归本数 = 棋盘总点数 / 2，贴目 = 3.75 子
    const baseNumber = (size * size) / 2;
    const komi = CHINESE_KOMI / 2; // 3.75 子
    const blackMargin = blackScore - (baseNumber + komi);
    const whiteMargin = whiteScore - (baseNumber - komi);

    let winner: Player | null = null;
    let reason: WinReason;
    if (blackMargin > 0) {
      winner = { id: '', name: '', color: GO_COLORS.BLACK };
      reason = WinReason.Score;
    } else if (whiteMargin > 0) {
      winner = { id: '', name: '', color: GO_COLORS.WHITE };
      reason = WinReason.Score;
    } else {
      reason = WinReason.Draw;
    }

    return {
      winner,
      reason,
      scores: {
        [GO_COLORS.BLACK]: blackScore,
        [GO_COLORS.WHITE]: whiteScore,
      },
    };
  }

  /**
   * 迭代式死子检测。
   * 每轮收集所有死子，一次性移除，避免级联误判。
   *
   * 死子判定：
   * 1. 气数=0 → 死子
   * 2. 所有气都是眼 且 眼<2 → 死子（被围死的孤棋）
   * 3. 只有1口气 且 该气不是眼 且 该气四周都是对方棋子 → 死子（即将被提）
   */
  private removeDeadStones(board: (string | null)[][], size: number): void {
    const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let changed = true;
    while (changed) {
      changed = false;
      const toRemove: Position[][] = [];
      for (const color of [GO_COLORS.BLACK, GO_COLORS.WHITE]) {
        const opponent = color === GO_COLORS.BLACK ? GO_COLORS.WHITE : GO_COLORS.BLACK;
        const visited = new Set<string>();
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            if (board[r][c] !== opponent) continue;
            const key = `${r},${c}`;
            if (visited.has(key)) continue;
            const group: Position[] = [];
            const queue: Position[] = [{ row: r, col: c }];
            while (queue.length > 0) {
              const pos = queue.shift()!;
              const k = `${pos.row},${pos.col}`;
              if (visited.has(k)) continue;
              if (pos.row < 0 || pos.row >= size || pos.col < 0 || pos.col >= size) continue;
              if (board[pos.row][pos.col] !== opponent) continue;
              visited.add(k);
              group.push(pos);
              for (const [dr, dc] of DIRS) {
                queue.push({ row: pos.row + dr, col: pos.col + dc });
              }
            }
            const liberties = new Set<string>();
            for (const pos of group) {
              for (const [dr, dc] of DIRS) {
                const nr = pos.row + dr, nc = pos.col + dc;
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === null) {
                  liberties.add(`${nr},${nc}`);
                }
              }
            }
            if (liberties.size === 0) {
              toRemove.push(group);
              continue;
            }
            const { eyeCount, eyePointCount } = this.countEyes(board, size, group, liberties, DIRS);
            // 情况2：所有气都是眼 且 眼<2
            if (eyePointCount === liberties.size && eyeCount < 2) {
              toRemove.push(group);
              continue;
            }
            // 情况3：只有1口气，该气不是眼，且该气没有己方非本棋组的邻居
            //        （如果己方邻居也共享同一个气且没有眼，则不算活的连接）
            if (liberties.size === 1 && eyePointCount === 0) {
              const onlyLib = [...liberties][0];
              const [lr, lc] = onlyLib.split(',').map(Number);
              const groupColor = board[group[0].row][group[0].col];
              const groupSet = new Set<string>(group.map(p => `${p.row},${p.col}`));
              let hasLivingFriendlyNeighbor = false;
              for (const [dr, dc] of DIRS) {
                const nr = lr + dr, nc = lc + dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                if (board[nr][nc] === groupColor && !groupSet.has(`${nr},${nc}`)) {
                  // 检查这个己方邻居是否也共享同一个气且没有眼
                  const neighborLibs = new Set<string>();
                  const nQueue = [{ row: nr, col: nc }];
                  const nVisited = new Set<string>();
                  while (nQueue.length > 0) {
                    const np = nQueue.shift()!;
                    const nk = `${np.row},${np.col}`;
                    if (nVisited.has(nk)) continue;
                    if (np.row < 0 || np.row >= size || np.col < 0 || np.col >= size) continue;
                    if (board[np.row][np.col] !== groupColor) continue;
                    nVisited.add(nk);
                    for (const [ndr, ndc] of DIRS) {
                      nQueue.push({ row: np.row + ndr, col: np.col + ndc });
                    }
                  }
                  for (const nKey of nVisited) {
                    const [nkr, nkc] = nKey.split(',').map(Number);
                    for (const [ndr, ndc] of DIRS) {
                      const nnr = nkr + ndr, nnc = nkc + ndc;
                      if (nnr >= 0 && nnr < size && nnc >= 0 && nnc < size && board[nnr][nnc] === null) {
                        neighborLibs.add(`${nnr},${nnc}`);
                      }
                    }
                  }
                  if (neighborLibs.size === 1 && neighborLibs.has(onlyLib)) {
                    continue;
                  }
                  hasLivingFriendlyNeighbor = true;
                  break;
                }
              }
              if (!hasLivingFriendlyNeighbor) {
                toRemove.push(group);
              }
            }
          }
        }
      }
      if (toRemove.length > 0) {
        changed = true;
        for (const group of toRemove) {
          for (const pos of group) board[pos.row][pos.col] = null;
        }
      }
    }
  }

  /**
   * 统计棋组的眼数。
   * 眼：空点的上下左右全是该棋组的棋子或棋盘边界。
   * 连通的眼区域算作一个眼。
   * 返回：{ eyeCount: 眼区域数, eyePointCount: 眼点总数 }
   */
  private countEyes(
    board: (string | null)[][],
    size: number,
    group: Position[],
    liberties: Set<string>,
    DIRS: [number, number][],
  ): { eyeCount: number; eyePointCount: number } {
    const groupColor = board[group[0].row][group[0].col];
    const eyePoints: string[] = [];
    for (const lib of liberties) {
      const [r, c] = lib.split(',').map(Number);
      let isEye = true;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (board[nr][nc] !== groupColor) {
          isEye = false;
          break;
        }
      }
      if (isEye) eyePoints.push(lib);
    }
    if (eyePoints.length === 0) return { eyeCount: 0, eyePointCount: 0 };
    const eyeVisited = new Set<string>();
    let eyeCount = 0;
    for (const ep of eyePoints) {
      if (eyeVisited.has(ep)) continue;
      eyeCount++;
      const queue = [ep];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (eyeVisited.has(cur)) continue;
        eyeVisited.add(cur);
        const [cr, cc] = cur.split(',').map(Number);
        for (const [dr, dc] of DIRS) {
          const nr = cr + dr, nc = cc + dc;
          const nk = `${nr},${nc}`;
          if (nr >= 0 && nr < size && nc >= 0 && nc < size
            && board[nr][nc] === null && liberties.has(nk) && !eyeVisited.has(nk)) {
            queue.push(nk);
          }
        }
      }
    }
    return { eyeCount, eyePointCount: eyePoints.length };
  }
}

// ──────────────────────────────────────────────
//  让子位置
// ──────────────────────────────────────────────

/**
 * 获取标准让子位置。
 * 仅适用于 19×19。9×9 和 13×13 有各自的星位。
 */
function getHandicapPositions(size: number, handicap: number): Position[] {
  if (size === 19) {
    // 标准 9 个星位
    const star4 = 3;
    const star10 = 9;
    const star16 = 15;
    const stars = [
      { row: star4, col: star4 },   // 左上 (A)
      { row: star4, col: star16 },  // 右上 (B)
      { row: star16, col: star4 },  // 左下 (C)
      { row: star16, col: star16 }, // 右下 (D)
      { row: star4, col: star10 },  // 左边 (E)
      { row: star16, col: star10 }, // 右边 (F)
      { row: star10, col: star4 },  // 上边 (G)
      { row: star10, col: star16 }, // 下边 (H)
      { row: star10, col: star10 }, // 天元 (J)
    ];
    return stars.slice(0, Math.min(handicap, 9));
  }

  if (size === 13) {
    const star3 = 3;
    const star6 = 6;
    const star9 = 9;
    const stars = [
      { row: star3, col: star3 },
      { row: star3, col: star9 },
      { row: star9, col: star3 },
      { row: star9, col: star9 },
      { row: star3, col: star6 },
      { row: star9, col: star6 },
      { row: star6, col: star3 },
      { row: star6, col: star9 },
      { row: star6, col: star6 },
    ];
    return stars.slice(0, Math.min(handicap, 9));
  }

  if (size === 9) {
    const star2 = 2;
    const star4 = 4;
    const star6 = 6;
    const stars = [
      { row: star2, col: star2 },
      { row: star2, col: star6 },
      { row: star6, col: star2 },
      { row: star6, col: star6 },
      { row: star4, col: star4 },
    ];
    return stars.slice(0, Math.min(handicap, 5));
  }

  return [];
}
