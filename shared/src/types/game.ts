/**
 * 棋盘坐标。
 * row=0 为顶部，col=0 为左侧。
 */
export interface Position {
  row: number;
  col: number;
}

/**
 * 玩家标识。
 */
export interface Player {
  id: string;
  name: string;
  /** 游戏内颜色/阵营，由各游戏定义具体值，如 'black'/'white' */
  color: string;
}

/**
 * 所有支持的棋类游戏。
 * 新增游戏时在此添加枚举成员。
 */
export enum GameType {
  Go              = 'go',
  Gomoku          = 'gomoku',
  ChineseChess    = 'chinese-chess',
  Chess           = 'chess',
  Draughts        = 'draughts',
}

/**
 * 游戏配置。
 */
export interface GameConfig {
  gameType: GameType;
  rows: number;
  cols: number;
  /** 游戏特定扩展参数 */
  extra: Record<string, number | string | boolean>;
}

/**
 * 游戏阶段。
 */
export enum GamePhase {
  NotStarted = 'not_started',
  Playing    = 'playing',
  Finished   = 'finished',
  Aborted    = 'aborted',
}

/**
 * 终局原因。
 */
export enum WinReason {
  Resign       = 'resign',
  Score        = 'score',
  OpponentDisconnected = 'disconnect',
  RuleViolation = 'violation',
  Draw         = 'draw',
}

/**
 * 终局结果。
 */
export interface GameResult {
  winner: Player | null;   // null = 平局
  reason: WinReason;
  scores: Record<string, number>;  // playerId → 分数
}
