import { GameType, GameConfig, Position, Player, GamePhase, GameResult } from './game';

/**
 * 游戏状态。
 * board[row][col] —— null 表示空位，字符串表示棋子颜色/标识。
 * 不可变对象 —— 每次更新返回新实例。
 */
export interface GameState {
  phase: GamePhase;
  /** 当前轮到哪个 color 走棋 */
  currentTurn: string;
  /**
   * 棋盘二维数组。
   * board[row][col]：
   *   - null       = 空位
   *   - 'black'    = 黑子（围棋/五子棋）
   *   - 'white'    = 白子（围棋/五子棋）
   *   - 'red_rook' = 红车（象棋，格式自定）
   */
  board: (string | null)[][];
  /** 已走棋步数 */
  moveCount: number;
  /** 最后一步落子位置 */
  lastMove: Position | null;
  /** 游戏特定扩展数据 */
  extra: Record<string, unknown>;
  /** 棋钟数据（仅围棋） */
  clock?: {
    black: { moveTime: number; totalTime: number };
    white: { moveTime: number; totalTime: number };
    lastMoveAt: number;
    blackTurnAt: number;
    whiteTurnAt: number;
  };
}

/**
 * 走棋合法性检查结果。
 */
export interface ValidationResult {
  valid: boolean;
  /** 不合法时的中文描述，合法时为 undefined */
  reason?: string;
}

/**
 * 游戏引擎接口 —— 所有游戏必须实现此接口。
 *
 * 设计原则：
 * - 纯函数：不修改传入的参数，每次返回新对象
 * - 服务端权威：规则验证只在服务端执行
 */
export interface IGameEngine {
  /** 游戏类型标识，必须与 GameType 枚举一致 */
  readonly gameType: GameType;

  /**
   * 创建初始游戏状态。
   * @param config  游戏配置
   * @param players 参与玩家列表
   */
  createInitialState(config: GameConfig, players: Player[]): GameState;

  /**
   * 验证一次走棋是否合法。
   * 不修改 state。
   * @param state       当前游戏状态
   * @param move        落子位置
   * @param playerColor 走棋方的颜色
   */
  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult;

  /**
   * 执行一次走棋，返回新状态。
   * 调用前必须已通过 validateMove 验证。
   * @param state       当前游戏状态
   * @param move        落子位置
   * @param playerColor 走棋方颜色
   */
  applyMove(state: GameState, move: Position, playerColor: string): GameState;

  /**
   * 判断游戏是否结束。
   * 每次走棋后调用。
   * @returns null 表示继续，非 null 表示结束
   */
  checkGameEnd(state: GameState): GameResult | null;

  /**
   * 处理虚手（Pass）。
   * 某些游戏（如围棋）连续 pass 触发终局。
   * @param state       当前游戏状态
   * @param playerColor 请求 pass 的玩家颜色
   */
  handlePass(state: GameState, playerColor: string): GameState;

  /**
   * 处理认输。
   * @param state       当前游戏状态
   * @param playerColor 认输方的颜色
   */
  handleResign(state: GameState, playerColor: string): GameResult;

  /**
   * 获取该游戏的默认配置。
   */
  getDefaultConfig(): GameConfig;
}
