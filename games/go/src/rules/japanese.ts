/**
 * 日韩围棋规则（数目制）引擎。
 *
 * 规则要点：
 *   - 贴 6.5 目
 *   - 终局数围空 + 提子数决定胜负
 *   - 需要判断空点的归属（围空 vs 单官 dame）
 *   - 其他（落子验证、提子、劫）与中国规则共享 base.ts
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
  getNeighbors,
  posKey,
} from './base';

import {
  GoColor,
  GO_COLORS,
  GoRuleSet,
  GoExtraState,
  getGoExtra,
  opponentColor,
} from '../types/index';

/** 日韩规则贴目：6.5 目 */
const JAPANESE_KOMI = 6.5;

export class JapaneseGoEngine implements IGameEngine {
  readonly gameType = GameType.Go;
  private readonly komi = JAPANESE_KOMI;

  // ──────────────────────────────────────────────
  //  IGameEngine 接口实现
  // ──────────────────────────────────────────────

  createInitialState(config: GameConfig, players: Player[]): GameState {
    const size = config.rows;
    const board = createBoard(size, size);

    const extra: GoExtraState = {
      koPoint: null,
      consecutivePasses: 0,
      capturedCount: { black: 0, white: 0 },
      stoneCount: { black: 0, white: 0 },
    };

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

  /**
   * 落子验证逻辑与中国规则完全相同：
   * 边界、轮次、占位、劫、自杀。
   */
  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult {
    if (state.phase !== GamePhase.Playing) {
      return { valid: false, reason: '游戏已结束' };
    }
    if (playerColor !== state.currentTurn) {
      return { valid: false, reason: '不是您的回合' };
    }
    if (!isEmpty(state.board, move)) {
      return { valid: false, reason: '该位置已有棋子' };
    }

    const extra = getGoExtra(state.extra);
    if (extra.koPoint && move.row === extra.koPoint.row && move.col === extra.koPoint.col) {
      return { valid: false, reason: '劫 — 禁止立即回提' };
    }

    const result = placeStone(state.board, move, playerColor);
    if (!result.alive && result.captured.length === 0) {
      return { valid: false, reason: '禁止自杀' };
    }

    return { valid: true };
  }

  /**
   * applyMove 逻辑与中国规则相同（核心棋盘操作无差别）。
   * 唯一不同在于 extra 中记录规则类型。
   */
  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    const result = placeStone(state.board, move, playerColor);
    const extra = getGoExtra(state.extra);

    const newCapturedCount = { ...extra.capturedCount };
    const opponentCol = opponentColor(playerColor as GoColor);
    newCapturedCount[opponentCol] = (newCapturedCount[opponentCol] || 0) + result.captured.length;

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
      consecutivePasses: 0,
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

    // 双方连续 pass → 终局，日本规则数目
    return this.countJapaneseScore(state);
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
        ruleSet: GoRuleSet.Japanese,
        komi: JAPANESE_KOMI,
        handicap: 0,
      },
    };
  }

  // ──────────────────────────────────────────────
  //  日韩规则特有的胜负判定（数目法）
  // ──────────────────────────────────────────────

  /**
   * 日本规则数目法：
   *   终局时，计算各方的「目」= 围空中的交叉点数 + 提掉的对方棋子数
   *
   *   空点归属判断：
   *     用洪水填充找空群组
   *     空群组只接触一种颜色 → 该色的地盘
   *     空群组接触两种颜色 → 单官（dame，不计入任何一方）
   *
   *   得分 = 围空 + 提子
   *   白方得分 = 白空 + 黑方被提子数 + 6.5 贴目
   *   黑方得分 = 黑空 + 白方被提子数
   */
  private countJapaneseScore(state: GameState): GameResult {
    const extra = getGoExtra(state.extra);

    // 1. 找所有空群组并判断归属
    const { blackTerritory, whiteTerritory } = this.findTerritories(state.board);

    // 2. 计算得分
    const blackScore = blackTerritory + (extra.capturedCount.white || 0);
    const whiteScore = whiteTerritory + (extra.capturedCount.black || 0) + this.komi;

    // 3. 判定胜负
    let winner: Player | null = null;
    let reason: WinReason;

    const margin = blackScore - whiteScore;
    if (margin > 0) {
      winner = { id: '', name: '', color: GO_COLORS.BLACK };
      reason = WinReason.Score;
    } else if (margin < 0) {
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
   * 通过洪水填充找出所有空群组，判断归属。
   *
   * 算法：
   *   1. 遍历棋盘上所有空位
   *   2. 对未访问的空位做 BFS，收集整个空群组
   *   3. 检查空群组的邻居中有哪些颜色
   *   4. 只有一种颜色 → 该颜色领地；两种颜色 → 单官
   */
  private findTerritories(board: Board): { blackTerritory: number; whiteTerritory: number } {
    const visited = new Set<string>();
    let blackTerritory = 0;
    let whiteTerritory = 0;

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== null) continue;
        const key = posKey({ row: r, col: c });
        if (visited.has(key)) continue;

        // BFS 收集一个空群组
        const group: Position[] = [];
        const adjacentColors = new Set<string>();
        const queue: Position[] = [{ row: r, col: c }];
        visited.add(key);

        while (queue.length > 0) {
          const current = queue.shift()!;
          group.push(current);

          for (const neighbor of getNeighbors(board, current)) {
            const nBoardVal = board[neighbor.row][neighbor.col];
            if (nBoardVal === null) {
              const nKey = posKey(neighbor);
              if (!visited.has(nKey)) {
                visited.add(nKey);
                queue.push(neighbor);
              }
            } else {
              // 相邻有棋子
              adjacentColors.add(nBoardVal);
            }
          }
        }

        // 判断归属
        if (adjacentColors.size === 1) {
          const color = adjacentColors.values().next().value;
          if (color === GO_COLORS.BLACK) {
            blackTerritory += group.length;
          } else {
            whiteTerritory += group.length;
          }
        }
        // size > 1 → 单官，不计分
      }
    }

    return { blackTerritory, whiteTerritory };
  }
}

// ──────────────────────────────────────────────
//  让子位置（与中国规则相同）
// ──────────────────────────────────────────────

function getHandicapPositions(size: number, handicap: number): Position[] {
  if (size === 19) {
    const star4 = 3;
    const star10 = 9;
    const star16 = 15;
    const stars = [
      { row: star4, col: star4 },
      { row: star4, col: star16 },
      { row: star16, col: star4 },
      { row: star16, col: star16 },
      { row: star4, col: star10 },
      { row: star16, col: star10 },
      { row: star10, col: star4 },
      { row: star10, col: star16 },
      { row: star10, col: star10 },
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
