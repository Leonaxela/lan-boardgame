# 扩展新游戏开发指南

> 目标：新增一种棋类游戏时，按此文档操作即可一次编写成功。
> 前置条件：已阅读 `ARCHITECTURE.md` 和 `CORE-INTERFACES.md`。

---

## 1. 新游戏清单

新增一个游戏需要修改/新增的文件共 **6 处**，其中 **3 处是新增文件**，**3 处是修改已有文件**：

```
□ shared/src/types.ts        [修改] 添加 GameType 枚举成员
□ shared/src/games/<game>.ts [新增] 游戏专用类型
□ shared/src/index.ts        [修改] 添加新导出

□ server/src/games/<Game>GameEngine.ts [新增] 游戏规则引擎

□ client/src/games/<Game>Renderer.ts   [新增] 游戏棋盘渲染器

□ server/src/index.ts        [修改] 注册游戏引擎
```

---

## 2. 分步操作

### 第1步：注册游戏类型

**文件：** `shared/src/types.ts`

在 `GameType` 枚举中添加新成员：

```typescript
export enum GameType {
  Go     = 'go',
  Goban  = 'goban',      // 五子棋
  Chess  = 'chess',      // 中国象棋  ← 新增示例
  // ...
}
```

### 第2步：定义游戏专用类型

**文件：** `shared/src/games/<game>.ts`（新增）

创建该游戏专属的类型定义。示例（中国象棋）：

```typescript
// shared/src/games/chess.ts
import { GameConfig } from '../types';

/** 中国象棋棋子类型 */
export enum ChessPieceType {
  King    = 'king',     // 将/帅
  Advisor = 'advisor',  // 士/仕
  Bishop  = 'bishop',   // 象/相
  Knight  = 'knight',   // 马
  Rook    = 'rook',     // 车
  Cannon  = 'cannon',   // 炮
  Pawn    = 'pawn',     // 兵/卒
}

/** 中国象棋配置扩展 */
export interface ChessConfig extends GameConfig {
  extra: {
    /** 是否允许长将循环（默认否——长将判负） */
    allowPerpetualCheck?: boolean;
  };
}

/** 中国象棋棋子标识格式："{color}_{type}"，如 "red_rook"、"black_knight" */
export type ChessPieceId = `${'red' | 'black'}_${ChessPieceType}`;
```

### 第3步：实现游戏规则引擎

**文件：** `server/src/games/<Game>GameEngine.ts`（新增）

实现 `IGameEngine` 接口。以下模板适用于所有新游戏：

```typescript
// server/src/games/ChessGameEngine.ts
import { IGameEngine, GameState, ValidationResult } from '../core/GameEngine';
import { GameType, GameConfig, Position, Player, GameResult, WinReason } from 'shared';

export class ChessGameEngine implements IGameEngine {
  readonly gameType = GameType.Chess;

  createInitialState(config: GameConfig, players: Player[]): GameState {
    // 1. 创建空棋盘数组 board[row][col]
    // 2. 按中国象棋初始布局填满棋子
    // 3. 设置 currentTurn = 'red'（红先）
    // 4. 返回 GameState
  }

  validateMove(state: GameState, move: Position, playerColor: string): ValidationResult {
    // 1. 检查是否在棋盘范围内
    // 2. 检查目标位置是否为空或有对方棋子（吃子）
    // 3. 按棋子行走规则检查（车走直线、马走日……）
    // 4. 检查是否送将（己方将帅暴露在对方攻击下）
    // 5. 返回 { valid, reason? }
  }

  applyMove(state: GameState, move: Position, playerColor: string): GameState {
    // 1. 浅拷贝 state 和 board（不可变性）
    // 2. 移动棋子到目标位置
    // 3. 如果目标位置有对方棋子，移除（吃子）
    // 4. 更新 currentTurn
    // 5. 更新 lastMove
    // 6. 返回新 state
  }

  checkGameEnd(state: GameState): GameResult | null {
    // 1. 检查将/帅是否被吃掉 → 被吃方输
    // 2. 检查是否无子可走 → 困毙（判负）
    // 3. 返回 GameResult 或 null（继续）
  }

  handlePass(state: GameState, playerColor: string): GameState {
    // 中国象棋不允许 pass，直接抛异常
    throw new Error('Chess does not support pass');
  }

  handleResign(state: GameState, playerColor: string): GameResult {
    const opponentColor = playerColor === 'red' ? 'black' : 'red';
    return {
      winner: { id: '', name: '', color: opponentColor },
      reason: WinReason.Resign,
      scores: {},
    };
  }

  getDefaultConfig(): GameConfig {
    return {
      gameType: GameType.Chess,
      rows: 10,
      cols: 9,
      extra: {},
    };
  }
}
```

### 第4步：实现客户端棋盘渲染器

**文件：** `client/src/games/<Game>Renderer.ts`（新增）

继承 `BoardRenderer` 基类，实现 Canvas 绘画：

```typescript
// client/src/games/ChessRenderer.ts
import { IBoardRenderer } from '../core/BoardRenderer';
import { GameType, GameState, Position, GameConfig } from 'shared';

export class ChessRenderer implements IBoardRenderer {
  readonly gameType = GameType.Chess;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cellSize: number = 0;
  private config!: GameConfig;
  private placeCallback: ((pos: Position) => void) | null = null;

  mount(container: HTMLElement, config: GameConfig): void {
    this.config = config;
    // 1. 创建 Canvas
    // 2. 计算 cellSize = min(宽/col, 高/row)
    // 3. 绘制棋盘网格（中国象棋：9×10 带河界）
    // 4. 绑定点击事件 → pixelToBoard → placeCallback
  }

  unmount(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }

  render(state: GameState): void {
    // 1. 清空 Canvas
    // 2. 绘制棋盘网格
    // 3. 遍历 board 数组，对每个非空位置绘制棋子
    //    根据棋子 ID（如 'red_rook'）选择文字和颜色
  }

  highlightLastMove(position: Position): void { /* 用圆圈标记 */ }
  showHoverPreview(position: Position | null): void { /* 半透明预览 */ }

  pixelToBoard(x: number, y: number): Position | null {
    const col = Math.round((x - padding) / this.cellSize);
    const row = Math.round((y - padding) / this.cellSize);
    if (row < 0 || row >= this.config.rows || col < 0 || col >= this.config.cols) {
      return null;
    }
    return { row, col };
  }

  onPlace(callback: (position: Position) => void): void {
    this.placeCallback = callback;
  }

  getPreferredSize(): { width: number; height: number } {
    return { width: 500, height: 560 }; // 中国象棋比例
  }
}
```

### 第5步：在服务端注册新游戏

**文件：** `server/src/index.ts`

在游戏引擎工厂/注册表中添加：

```typescript
import { ChessGameEngine } from './games/ChessGameEngine';

// 游戏引擎注册表
const engineRegistry = new Map<GameType, IGameEngine>();
engineRegistry.set(GameType.Go, new GoGameEngine());
engineRegistry.set(GameType.Chess, new ChessGameEngine());  // ← 新增
```

### 第6步：更新共享模块导出

**文件：** `shared/src/index.ts`

```typescript
export * from './types';
export * from './protocol';
export * from './utils';
export * from './games/go';
export * from './games/chess';  // ← 新增
```

---

## 3. 各游戏实现要点速查

| 游戏 | 棋盘 | 棋子 | 规则核心 | 难度 | 预计工作量 |
|------|------|------|----------|------|-----------|
| **围棋** ✅已实现 | 19×19 交叉点 | 黑/白石子 | 气、眼、劫、终局数子 | ⭐⭐⭐⭐⭐ | ~500 行 |
| **五子棋** | 15×15 交叉点 | 黑/白子 | 五子连珠、禁手 | ⭐⭐ | ~200 行 |
| **中国象棋** | 9×10 格线 | 7 种 × 2 色 | 各棋子走法、将军、长将 | ⭐⭐⭐⭐ | ~600 行 |
| **国际象棋** | 8×8 格线 | 6 种 × 2 色 | 各棋子走法、王车易位、升变 | ⭐⭐⭐⭐ | ~700 行 |
| **国际跳棋** | 8×8 格子 | 白/黑棋子 | 斜走、跳过吃子、连吃、升级王 | ⭐⭐⭐ | ~400 行 |

---

## 4. 注意事项与常见陷阱

### 4.1 服务端安全

- ❌ **不要在客户端做规则判断** —— 客户端只发请求，服务端负责验证，防止作弊
- ❌ **不要信任客户端传来的 board 状态** —— 服务端维护自己的状态副本
- ✅ **`validateMove` 必须覆盖所有非法操作**：越界、占位、非己方回合、无气落子（围棋）等

### 4.2 不可变性

每次 `applyMove` 必须返回新的 `GameState` 对象。推荐使用结构化克隆：

```typescript
// ✅ 正确：深拷贝 board
const newBoard = state.board.map(row => [...row]);
newBoard[pos.row][pos.col] = playerColor;

return { ...state, board: newBoard, moveCount: state.moveCount + 1, /* ... */ };
```

### 4.3 坐标一致性

- 所有游戏使用 `board[row][col]`，`row` 为纵轴（0 = 顶部）
- 渲染器将 `(0,0)` 映射到 Canvas 左上角
- 行列转像素时：`x = col * cellSize + padding`，`y = row * cellSize + padding`

### 4.4 围棋特殊注意点

围棋的 `extra` 字段中包含：

```typescript
// GameState.extra 中围棋特有的字段
extra: {
  /** 上一个被提子的位置（劫） */
  koPoint: Position | null;
  /** 连续 pass 次数 */
  consecutivePasses: number;
  /** 当前存活棋子的气数缓存（优化用） */
  // liberties?: number;
}
```

其他游戏请参考围棋实现来设计自己的 `extra` 字段。

### 4.5 测试建议

每个游戏引擎应该覆盖以下测试场景：

```
□ 正常走棋 + 吃子
□ 边界位置落子
□ 非法位置（已占、越界）
□ 非己方回合
□ 终局判定
□ 连续 Pass / 不允许 Pass
□ 认输
□ 让子/自定义开局
```
