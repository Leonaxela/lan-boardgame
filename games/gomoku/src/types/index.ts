/** 五子棋专用类型 */

export const GOMOKU_COLORS = {
  BLACK: 'black',
  WHITE: 'white',
} as const;

export type GomokuColor = (typeof GOMOKU_COLORS)[keyof typeof GOMOKU_COLORS];

export function opponentColor(color: GomokuColor): GomokuColor {
  return color === GOMOKU_COLORS.BLACK ? GOMOKU_COLORS.WHITE : GOMOKU_COLORS.BLACK;
}

/** 标准棋盘大小 */
export const GOMOKU_BOARD_SIZE = 15;

/** GameConfig.extra 中的五子棋配置 */
export interface GomokuConfig {
  boardSize: number;
}

/** GameState.extra 中的五子棋状态扩展 */
export interface GomokuExtraState {
  /** 连续虚手次数 */
  consecutivePasses: number;
  /** 棋盘上各颜色棋子数 */
  stoneCount: Record<string, number>;
}
