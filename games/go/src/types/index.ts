import { GameConfig, Position } from '@lan-boardgame/shared';

// ══════════════════════════════════════════════
//  颜色常量
// ══════════════════════════════════════════════

export const GO_COLORS = {
  BLACK: 'black',
  WHITE: 'white',
} as const;

export type GoColor = (typeof GO_COLORS)[keyof typeof GO_COLORS];

/** 获取对方颜色 */
export function opponentColor(color: GoColor): GoColor {
  return color === GO_COLORS.BLACK ? GO_COLORS.WHITE : GO_COLORS.BLACK;
}

// ══════════════════════════════════════════════
//  围棋配置
// ══════════════════════════════════════════════

/** 规则类型 */
export enum GoRuleSet {
  Chinese = 'chinese',   // 中国规则（数子制）
  Japanese = 'japanese', // 日韩规则（数目制）
}

/** 标准棋盘大小 */
export const GO_BOARD_SIZES = [19, 13, 9] as const;
export type GoBoardSize = (typeof GO_BOARD_SIZES)[number];

/** 围棋配置扩展 */
export interface GoConfig {
  /** 棋盘大小（默认 19） */
  boardSize: GoBoardSize;
  /** 规则体系 */
  ruleSet: GoRuleSet;
  /** 贴目（中国规则：7.5 目 = 3¾ 子；日韩规则：6.5 目） */
  komi: number;
  /** 让子数 */
  handicap: number;
}

/** 从通用 GameConfig 解析围棋配置 */
export function parseGoConfig(config: GameConfig): GoConfig {
  return {
    boardSize: (config.extra.boardSize as GoBoardSize) ?? 19,
    ruleSet: (config.extra.ruleSet as GoRuleSet) ?? GoRuleSet.Chinese,
    komi: (config.extra.komi as number) ?? 7.5,
    handicap: (config.extra.handicap as number) ?? 0,
  };
}

/** 生成围棋默认 GameConfig */
export function createDefaultGoConfig(ruleSet: GoRuleSet = GoRuleSet.Chinese): GameConfig {
  return {
    gameType: 'go' as any,   // GameType.Go 会循环引用，运行时赋值
    rows: 19,
    cols: 19,
    extra: {
      boardSize: 19,
      ruleSet,
      komi: ruleSet === GoRuleSet.Chinese ? 7.5 : 6.5,
      handicap: 0,
    },
  };
}

// ══════════════════════════════════════════════
//  围棋状态扩展
// ══════════════════════════════════════════════

/**
 * GameState.extra 中围棋特有的字段类型。
 * 使用 as 断言写入 extra，读取时用本接口解析。
 */
export interface GoExtraState {
  /** 劫点 —— 刚被提子的位置，禁止立即回提 */
  koPoint: Position | null;
  /** 连续虚手次数（双方各一次=2 时触发终局数子） */
  consecutivePasses: number;
  /** 已被提走的棋子数 */
  capturedCount: Record<string, number>;  // color → count
  /** 棋盘上当前每个颜色的棋子数 */
  stoneCount: Record<string, number>;     // color → count
  /** 让子位置（如果 handicap > 0） */
  handicapPositions?: Position[];
}

/** 从 state.extra 安全读取 GoExtraState */
export function getGoExtra(extra: Record<string, unknown>): GoExtraState {
  return {
    koPoint: (extra.koPoint as Position | null) ?? null,
    consecutivePasses: (extra.consecutivePasses as number) ?? 0,
    capturedCount: (extra.capturedCount as Record<string, number>) ?? { black: 0, white: 0 },
    stoneCount: (extra.stoneCount as Record<string, number>) ?? { black: 0, white: 0 },
    handicapPositions: extra.handicapPositions as Position[] | undefined,
  };
}
