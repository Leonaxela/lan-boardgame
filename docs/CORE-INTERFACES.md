# 核心接口与类型定义

> 新游戏扩展必须实现本文件定义的全部抽象接口。
> 实现前请先阅读 `GAME-DEVELOPMENT.md` 了解完整流程。

---

## 1. 游戏类型枚举（shared/src/types.ts）

```typescript
/**
 * 所有支持的棋类游戏。
 * 新增游戏时在此添加枚举成员。
 */
export enum GameType {
  Go     = 'go',
  Goban  = 'goban',      // 五子棋（预留）
  Chess  = 'chess',      // 中国象棋（预留）
  International = 'intl', // 国际象棋（预留）
  Checkers = 'checkers',  // 国际跳棋（预留）
}

/**
 * 游戏配置 —— 每个游戏类型对应一组默认参数。
 */
export interface GameConfig {
  /** 游戏类型 */
  gameType: GameType;
  /** 棋盘行数（如围棋 19） */
  rows: number;
  /** 棋盘列数（如围棋 19） */
  cols: number;
  /** 贴目/让子等游戏特定参数，由各游戏扩展 */
  extra: Record<string, number | string | boolean>;
}
```

---

## 2. 通用数据类型

```typescript
/**
 * 棋盘坐标 —— 所有游戏统一使用 (row, col) 整数坐标。
 * row=0 为顶部，col=0 为左侧。
 */
export interface Position {
  row: number;
  col: number;
}

/**
 * 玩家标识。
 * id 由服务端 Room 分配，全局唯一。
 */
export interface Player {
  id: string;
  name: string;
  /** 游戏内颜色/阵营 —— 泛型字符串，由各游戏定义具体值 */
  color: string;
}

/**
 * 游戏阶段枚举。
 */
export enum GamePhase {
  NotStarted = 'not_started',
  Playing    = 'playing',
  Finished   = 'finished',
  Aborted    = 'aborted',
}

/**
 * 终局结果。
 */
export interface GameResult {
  winner: Player | null;   // null = 平局
  reason: WinReason;
  scores: Record<string, number>;  // playerId → 分数
}

export enum WinReason {
  Resign       = 'resign',        // 对方认输
  Score        = 'score',         // 点数/计分获胜
  OpponentDisconnected = 'disconnect', // 对方断线超时
  RuleViolation = 'violation',    // 违规判负
  Draw         = 'draw',          // 平局
}
```

---

## 3. 服务端核心接口（server/src/core/GameEngine.ts）

这是**最关键的文件**——每个游戏引擎必须实现 `IGameEngine` 接口。

```typescript
import { GameType, GameConfig, Position, Player, GamePhase, GameResult } from 'shared';

/**
 * 游戏状态 —— 不可变对象，每次更新返回新实例。
 * 各游戏通过 extra 字段扩展。
 */
export interface GameState {
  phase: GamePhase;
  /** 当前轮到哪个 color 走棋 */
  currentTurn: string;
  /** 棋盘二维数组，null = 空，string = 棋子颜色/标识 */
  board: (string | null)[][];
  /** 已走棋步数 */
  moveCount: number;
  /** 最后一步落子位置（用于 UI 高亮） */
  lastMove: Position | null;
  /** 游戏特定扩展数据 */
  extra: Record<string, unknown>;
}

/**
 * 合法性检查结果。
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;   // 不合法时的中文描述
}

// ═══════════════════════════════════════════════════
//  ★ 新游戏必须实现此接口 ★
// ═══════════════════════════════════════════════════
export interface IGameEngine {
  /** 游戏类型标识，必须与 GameType 枚举一致 */
  readonly gameType: GameType;

  /**
   * 创建初始游戏状态。
   * 在游戏正式开始前调用一次。
   * @param config 游戏配置（棋盘大小、让子等）
   * @param players 参与玩家列表
   */
  createInitialState(config: GameConfig, players: Player[]): GameState;

  /**
   * 验证一次走棋是否合法。
   * 纯函数 —— 不修改 state。
   * @param state 当前游戏状态（不可变）
   * @param move  落子位置
   * @param playerColor 走棋方的颜色
   */
  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult;

  /**
   * 执行一次走棋，返回新状态。
   * 纯函数 —— 不修改传入的 state。
   * 调用前必须已通过 validateMove 验证。
   * @param state 当前游戏状态
   * @param move  落子位置
   * @param playerColor 走棋方颜色
   */
  applyMove(state: GameState, move: Position, playerColor: string): GameState;

  /**
   * 判断游戏是否结束。
   * 每次走棋后调用。
   * @param state 当前游戏状态
   * @returns null 表示游戏继续，非 null 表示结束
   */
  checkGameEnd(state: GameState): GameResult | null;

  /**
   * 处理虚手（Pass）—— 玩家选择跳过本回合。
   * 某些游戏（如围棋）连续 pass 触发终局，其他游戏不允许 pass。
   * @param state 当前游戏状态
   * @param playerColor 请求 pass 的玩家颜色
   */
  handlePass(state: GameState, playerColor: string): GameState;

  /**
   * 处理认输。
   * @param state 当前游戏状态
   * @param playerColor 认输方的颜色
   */
  handleResign(state: GameState, playerColor: string): GameResult;

  /**
   * 获取该游戏的默认配置。
   * 用于客户端大厅展示游戏选项。
   */
  getDefaultConfig(): GameConfig;
}
```

### 实现要求

| 方法 | 必须实现？ | 说明 |
|------|-----------|------|
| `createInitialState` | ✅ 必须 | 返回初始棋盘布局 |
| `validateMove` | ✅ 必须 | 是游戏的核心安全边界 |
| `applyMove` | ✅ 必须 | 推进游戏状态 |
| `checkGameEnd` | ✅ 必须 | 至少返回 `null`（永不到终局） |
| `handlePass` | ⚠️ 可选 | 默认抛异常表示不支持 pass |
| `handleResign` | ✅ 必须 | 默认实现：另一玩家获胜 |
| `getDefaultConfig` | ✅ 必须 | 返回合理默认值 |

---

## 4. 服务端房间接口（server/src/core/Room.ts）

```typescript
export enum RoomStatus {
  Waiting = 'waiting',   // 等待对手加入
  Playing = 'playing',   // 对局中
  Finished = 'finished', // 已结束
}

/**
 * 房间 —— 管理两个玩家 + 游戏状态。
 */
export interface IRoom {
  readonly roomId: string;
  readonly status: RoomStatus;
  readonly gameType: GameType;
  readonly config: GameConfig;

  /** 加入房间 */
  join(player: Player): void;
  /** 离开房间 */
  leave(playerId: string): void;
  /** 处理走棋 */
  handleMove(playerId: string, position: Position): GameState;
  /** 处理 Pass */
  handlePass(playerId: string): GameState;
  /** 处理认输 */
  handleResign(playerId: string): GameResult;
  /** 获取当前状态快照 */
  getState(): GameRoomState;
}

/**
 * 发送给客户端的房间状态快照。
 * 不包含服务端内部状态。
 */
export interface GameRoomState {
  roomId: string;
  status: RoomStatus;
  gameType: GameType;
  config: GameConfig;
  players: Player[];
  gameState: GameState;
  spectators: number;
}
```

---

## 5. 客户端核心接口

### 5.1 棋盘渲染器（client/src/core/BoardRenderer.ts）

```typescript
import { GameType, GameState, Position, GameConfig } from 'shared';

/**
 * 棋盘渲染 —— 每个游戏实现一个子类。
 * 使用 Canvas 2D API 绘制。
 */
export interface IBoardRenderer {
  /** 游戏类型 */
  readonly gameType: GameType;

  /**
   * 挂载到 DOM 容器。
   * @param container 用于放置 Canvas 的 HTMLElement
   * @param config 游戏配置（棋盘大小等）
   */
  mount(container: HTMLElement, config: GameConfig): void;

  /**
   * 卸载并清理。
   */
  unmount(): void;

  /**
   * 渲染当前游戏状态。
   * 每次游戏状态更新时调用。
   * @param state 当前游戏状态
   */
  render(state: GameState): void;

  /**
   * 高亮最后一步落子位置。
   * @param position 最后落子坐标
   */
  highlightLastMove(position: Position): void;

  /**
   * 标记当前鼠标悬停位置（预览落子效果）。
   * @param position 鼠标所在棋盘坐标 | null 表示离开棋盘
   */
  showHoverPreview(position: Position | null): void;

  /**
   * 将 Canvas 像素坐标转换为棋盘坐标。
   * @param x Canvas 像素 X
   * @param y Canvas 像素 Y
   * @returns 棋盘坐标，如果点击在棋盘外则返回 null
   */
  pixelToBoard(x: number, y: number): Position | null;

  /**
   * 注册落子回调。
   * @param callback 用户点击棋盘时调用
   */
  onPlace(callback: (position: Position) => void): void;

  /**
   * 计算棋盘最佳像素尺寸。
   */
  getPreferredSize(): { width: number; height: number };
}
```

### 5.2 输入处理器（client/src/core/InputHandler.ts）

```typescript
/**
 * 输入事件处理 —— 将鼠标/触摸事件转换为游戏操作。
 */
export interface IInputHandler {
  /** 绑定到 Canvas 元素 */
  bind(canvas: HTMLCanvasElement): void;
  /** 解绑 */
  unbind(): void;
  /** 启用手势（默认可拖拽/缩放大棋盘） */
  enablePanZoom(enabled: boolean): void;
}
```

### 5.3 游戏客户端协调器（client/src/core/GameClient.ts）

```typescript
/**
 * 游戏客户端 —— 协调 渲染器 + 网络层 + 输入处理。
 */
export interface IGameClient {
  /** 连接到服务端 */
  connect(serverUrl: string): Promise<void>;
  /** 加入房间 */
  joinRoom(roomId: string, playerName: string): void;
  /** 落子 */
  place(position: Position): void;
  /** 虚手 */
  pass(): void;
  /** 认输 */
  resign(): void;
  /** 断开连接 */
  disconnect(): void;
}
```

---

## 6. 各游戏颜色定义

新增游戏时，必须在此明确定义该游戏的颜色枚举。

| 游戏 | 颜色值 | 先手 |
|------|--------|------|
| 围棋 | `'black'` / `'white'` |黑（Black）|
| 五子棋 | `'black'` / `'white'` | 黑 |
| 中国象棋 | `'red'` / `'black'` | 红 |
| 国际象棋 | `'white'` / `'black'` | 白 |
| 国际跳棋 | `'white'` / `'black'` | 白 |

---

## 7. 实现约定

1. **坐标系统**：`Position { row, col }`，左上角为 `(0, 0)`。所有游戏统一。
2. **棋盘数组**：`board[row][col]` —— 第一维是行，第二维是列。
3. **不可变性**：`GameState.board` 每次更新应返回**新数组副本**，不修改原数组。
4. **空值表示**：`null` = 空位，字符串 = 棋子颜色。如需棋子类型（象棋），使用 `'red_rook'` 格式，由游戏自行解析。
5. **错误消息**：`ValidationResult.reason` 使用中文，直接显示给玩家。
