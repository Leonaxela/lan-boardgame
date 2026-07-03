// ── 核心类型 ──

/** 花色 */
export type Suit = 'wan' | 'tiao' | 'tong';
/** 字牌 */
export type Honor = 'feng' | 'jian';
/** 万条筒值 */
export type SuitValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** 风牌值（东南西北） */
export type FengValue = 1 | 2 | 3 | 4;
/** 箭牌值（中发白） */
export type JianValue = 1 | 2 | 3;

/** 一张牌 */
export interface Tile {
  suit: 'wan' | 'tiao' | 'tong' | 'feng' | 'jian';
  value: number; // wan/tiao/tong=1-9, feng=1-4(东南西北), jian=1-3(中发白)
}

/** 规则变种 */
export type RuleVariant = 'sichuan' | 'wuhan' | 'guobiao';

/** 牌型组合 */
export type MeldType = 'chi' | 'peng' | 'gang' | 'concealed_gang';
export interface Meld {
  type: MeldType;
  tiles: Tile[];
}

/** 操作 */
export type MahjongAction = 'discard' | 'chi' | 'peng' | 'gang' | 'hu' | 'pass';

/** 可选操作（给玩家的选项） */
export interface AvailableAction {
  type: 'chi' | 'peng' | 'gang' | 'angang' | 'jiagang' | 'hu';
  tiles: Tile[];     // 吃碰杠涉及的具体牌
  seat: number;      // 执行操作的绝对座位号 (0-3)
  /** 吃牌时可选的组合（可能有多种吃法） */
  chiCombos?: Tile[][];  // 每种吃法需要的两张配牌
}

/** 方向 */
export type Wind = 'east' | 'south' | 'west' | 'north';

/** 胡牌结果 */
export interface MahjongResult {
  winner: number;
  fan: number;
  reason: string;
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  loser?: number;
}

/** 游戏阶段 */
export type MahjongPhase = 'waiting' | 'playing' | 'finished';

/** 游戏全状态 */
export interface MahjongState {
  phase: MahjongPhase;
  variant: RuleVariant;
  wall: Tile[];
  hands: Tile[][];
  handSizes: number[];     // 手牌数量（对其他玩家隐藏具体牌）
  discards: Tile[][];
  melds: Meld[][];
  currentPlayer: number;
  lastDiscard: Tile | null;
  lastDiscardPlayer: number;
  drawnTile: Tile | null;  // 当前玩家刚摸的牌（null=非摸牌阶段或已出牌）
  dealer: number;
  wind: Wind;
  round: number;
  wallEnd: boolean;
  result: MahjongResult | null;
  winners: number[];       // 血战到底：已胡的玩家
}

/** 客户端可见状态（对其他玩家隐藏手牌） */
export interface ClientState {
  phase: MahjongPhase;
  variant: RuleVariant;
  myHand: Tile[];          // 自己的手牌
  handSizes: number[];     // 其他人手牌数量
  discards: Tile[][];
  melds: Meld[][];
  currentPlayer: number;
  lastDiscard: Tile | null;
  lastDiscardPlayer: number;
  drawnTile: Tile | null;  // 自己刚摸的牌（仅自己可见，其他座位为 null）
  dealer: number;
  wind: Wind;
  round: number;
  wallEnd: boolean;
  result: MahjongResult | null;
  winners: number[];
  availableActions: AvailableAction[];
  seat: number;
}

/** 规则集接口 */
export interface Ruleset {
  name: string;
  tilesPerHand: number;
  tileSet: () => Tile[];
  /** 摸牌/吃碰杠后检测是否胡牌 */
  checkWin: (hand: Tile[], melds: Meld[], winTile: Tile) => boolean;
  /** 算番（seat=胡牌者座位，用于门风刻计算） */
  calculateFan: (hand: Tile[], melds: Meld[], winTile: Tile, isSelfDraw: boolean, wind: Wind, seat: number) => number;
  minFan: number;
  allowSelfDrawOnly: boolean;
}

/** 数值常量 */
export const SUIT_NAMES: Record<string, string> = {
  wan: '万', tiao: '条', tong: '筒',
  feng: '风', jian: '箭',
};

export const FENG_NAMES: Record<number, string> = {
  1: '东', 2: '南', 3: '西', 4: '北',
};

export const JIAN_NAMES: Record<number, string> = {
  1: '中', 2: '发', 3: '白',
};

export const WIND_NAMES: Record<string, string> = {
  east: '东', south: '南', west: '西', north: '北',
};
