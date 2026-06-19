/**
 * 五子棋规则引擎。
 * 15×15 棋盘，黑先手，五子连珠获胜。
 * 无禁手、无提子、无劫。
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
  GomokuColor,
  GOMOKU_COLORS,
  GOMOKU_BOARD_SIZE,
  GomokuExtraState,
  opponentColor,
} from '../types/index';

/** 四方向向量：水平、垂直、正斜、反斜 */
const DIRECTIONS = [
  { dr: 0, dc: 1 },  // 水平
  { dr: 1, dc: 0 },  // 垂直
  { dr: 1, dc: 1 },  // 正斜
  { dr: 1, dc: -1 }, // 反斜
];

export class GomokuEngine implements IGameEngine {
  readonly gameType = GameType.Gomoku;

  createInitialState(config: GameConfig, _players: Player[]): GameState {
    const size = config.rows || GOMOKU_BOARD_SIZE;
    const board: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

    return {
      phase: GamePhase.Playing,
      currentTurn: GOMOKU_COLORS.BLACK,
      board,
      moveCount: 0,
      lastMove: null,
      extra: {
        consecutivePasses: 0,
        stoneCount: { black: 0, white: 0 },
      } as GomokuExtraState,
    };
  }

  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult {
    if (state.phase !== GamePhase.Playing) {
      return { valid: false, reason: '游戏已结束' };
    }
    if (playerColor !== state.currentTurn) {
      return { valid: false, reason: '不是您的回合' };
    }
    if (move.row < 0 || move.row >= state.board.length || move.col < 0 || move.col >= state.board[0].length) {
      return { valid: false, reason: '落子在棋盘外' };
    }
    if (state.board[move.row][move.col] !== null) {
      return { valid: false, reason: '该位置已有棋子' };
    }

    return { valid: true };
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    const newBoard = state.board.map(row => [...row]);
    newBoard[move.row][move.col] = playerColor;

    const extra = state.extra as unknown as GomokuExtraState;
    const stoneCount = { ...extra.stoneCount };
    stoneCount[playerColor] = (stoneCount[playerColor] || 0) + 1;

    return {
      phase: GamePhase.Playing,
      currentTurn: opponentColor(playerColor as GomokuColor),
      board: newBoard,
      moveCount: state.moveCount + 1,
      lastMove: move,
      extra: {
        consecutivePasses: 0,
        stoneCount,
      } as unknown as Record<string, unknown>,
    };
  }

  checkGameEnd(state: GameState): GameResult | null {
    const extra = state.extra as unknown as GomokuExtraState;

    // 检查最新一步是否五子连珠
    if (state.lastMove) {
      const winner = this.checkWin(state.board, state.lastMove);
      if (winner) {
        return {
          winner: { id: '', name: '', color: winner },
          reason: WinReason.Score,
          scores: {},
        };
      }
    }

    // 双方连续 Pass → 平局
    if (extra.consecutivePasses >= 2) {
      return {
        winner: null,
        reason: WinReason.Draw,
        scores: {},
      };
    }

    // 棋盘满了 → 平局
    if (state.moveCount >= state.board.length * state.board[0].length) {
      return {
        winner: null,
        reason: WinReason.Draw,
        scores: {},
      };
    }

    return null;
  }

  handlePass(state: GameState, _playerColor: string): GameState {
    const extra = state.extra as unknown as GomokuExtraState;
    return {
      ...state,
      currentTurn: state.currentTurn === GOMOKU_COLORS.BLACK ? GOMOKU_COLORS.WHITE : GOMOKU_COLORS.BLACK,
      moveCount: state.moveCount + 1,
      lastMove: null,
      extra: {
        ...extra,
        consecutivePasses: (extra.consecutivePasses || 0) + 1,
      },
    };
  }

  handleResign(_state: GameState, playerColor: string): GameResult {
    const opponentCol = opponentColor(playerColor as GomokuColor);
    return {
      winner: { id: '', name: '', color: opponentCol },
      reason: WinReason.Resign,
      scores: {},
    };
  }

  getDefaultConfig(): GameConfig {
    return {
      gameType: GameType.Gomoku,
      rows: GOMOKU_BOARD_SIZE,
      cols: GOMOKU_BOARD_SIZE,
      extra: {},
    };
  }

  // ── 胜负判定 ──

  /**
   * 从最后一步落子位置检查是否五子连珠。
   * @returns 胜方颜色，或 null
   */
  private checkWin(board: (string | null)[][], lastMove: Position): string | null {
    const color = board[lastMove.row][lastMove.col];
    if (!color) return null;

    for (const dir of DIRECTIONS) {
      let count = 1;

      // 正方向
      for (let i = 1; i < 5; i++) {
        const r = lastMove.row + dir.dr * i;
        const c = lastMove.col + dir.dc * i;
        if (r < 0 || r >= board.length || c < 0 || c >= board[0].length) break;
        if (board[r][c] !== color) break;
        count++;
      }

      // 反方向
      for (let i = 1; i < 5; i++) {
        const r = lastMove.row - dir.dr * i;
        const c = lastMove.col - dir.dc * i;
        if (r < 0 || r >= board.length || c < 0 || c >= board[0].length) break;
        if (board[r][c] !== color) break;
        count++;
      }

      if (count >= 5) return color;
    }

    return null;
  }
}
