# 系统架构设计 · BoardGame Arena

> 版本 1.0 | 2025-03-21
> 适用游戏：围棋（首发）| 中国象棋 · 五子棋 · 国际象棋 · 国际跳棋（待扩展）

---

## 1. 项目概述

局域网联机对战棋类平台，支持两人对战的实时棋类游戏。设计核心原则是 **「一次接口，多游戏共享」**——所有游戏共用同一套网络层、房间管理、生命周期框架，仅需替换游戏规则引擎和棋盘渲染器即可接入新游戏。

### 技术栈

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| 服务端 | Node.js + TypeScript | 跨平台、事件驱动适合 WebSocket 长连接 |
| WebSocket 库 | `ws` | 轻量、标准、零依赖 |
| 客户端 | Vite + TypeScript + Canvas | Canvas 原生绘制复杂棋盘（围棋 19×19 性能远优于 DOM） |
| 通信协议 | JSON over WebSocket | 人类可读、调试友好、自描述 |
| 共享模块 | TypeScript 纯类型（shared/） | 无运行时，仅类型定义和工具函数 |

---

## 2. 三层架构

项目采用**共享类型层 + 服务端 + 客户端**三层分离设计：

```
┌────────────────────────────────────────────────┐
│                  client/                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │   Core    │  │  Games/  │  │   Network    │  │
│  │  ·Board   │  │  ·Go     │  │  ·WebSocket  │  │
│  │  ·Renderer│  │  ·Chess  │  │  ·MessageBus │  │
│  │  ·Input   │  │  ·Goban  │  │  ·Reconnect  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       └──────────────┼──────────────┘           │
└──────────────────────┼──────────────────────────┘
                       │ JSON via WebSocket
┌──────────────────────┼──────────────────────────┐
│                  server/                         │
│  ┌──────────┐  ┌────┴──────┐  ┌──────────────┐  │
│  │   Core    │  │  Games/   │  │   Network    │  │
│  │  ·Engine  │  │  ·Go      │  │  ·WSServer   │  │
│  │  ·Room    │  │  ·Chess   │  │  ·Dispatcher │  │
│  │  ·Rules   │  │  ·Goban   │  │  ·Validator  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       └──────────────┼──────────────┘           │
└──────────────────────┼──────────────────────────┘
                       │ type imports
┌──────────────────────┼──────────────────────────┐
│                  shared/                         │
│  ·GameType enum  ·Board types   ·Move types      │
│  ·Message types  ·Result types  ·Constants       │
│  ·Utility functions (坐标转换、胜负判断辅助)      │
└──────────────────────────────────────────────────┘
```

### 2.1 各层职责

| 层 | 职责 | 不负责 |
|----|------|--------|
| **shared/** | 类型定义、常量、纯工具函数 | 任何运行时逻辑、可变状态 |
| **server/** | 游戏规则验证、状态管理、房间/玩家管理、消息路由 | 界面渲染、用户输入事件 |
| **client/** | 棋盘渲染、用户交互、网络消息编码/解码 | 游戏规则判断（仅做本地乐观渲染） |

---

## 3. 核心数据流

### 3.1 完整对局生命周期

```
Player A                Server                Player B
   │                     │                       │
   │── join_room ──────► │◄─── join_room ───────│
   │                     │ [双方到齐，游戏开始]   │
   │── place_stone ────► │                       │
   │                     │── game_state_update ─►│
   │                     │ (验证、更新棋盘、切换)  │
   │                     │                       │
   │◄── game_state_update│── place_stone ────────│
   │ (对方落子)           │                       │
   │                     │                       │
   │         ... 交替落子 ...                      │
   │                     │                       │
   │                       [终局判定触发]
   │                     │                       │
   │◄─── game_over ──────│─── game_over ────────►│
```

### 3.2 单次落子流程（服务端内部）

```
Client → place_stone(msg)
  │
  ▼
Dispatcher.match(msg.type) → Room.handleMove(playerId, pos)
  │
  ├─ 1. GameEngine.validateMove(pos, playerId, state)
  │     ├─ 边界检查（棋盘范围内）
  │     ├─ 位置占用检查（空位）
  │     ├─ 规则检查（围棋的"气"、打劫规则）
  │     └─ 轮次检查（黑白交替）
  │
  ├─ 2. GameEngine.applyMove(pos, state) → newState
  │     ├─ 放置棋子
  │     ├─ 提子（围棋：无气棋子移除）
  │     └─ 更新劫点（围棋 ko 点）
  │
  ├─ 3. GameEngine.checkGameEnd(state) → GameResult | null
  │     ├─ 双方 pass → 进入数子判定
  │     └─ 一方认输 / 超时 → 直接判负
  │
  └─ 4. Room.broadcast(game_state_update | game_over)
```

---

## 4. 模块设计要点

### 4.1 房间管理（server/src/core/RoomManager）

- 每个房间有一个唯一 `roomId`（短字符串，可分享给局域网友人）
- 房间状态机：`WAITING` → `PLAYING` → `FINISHED`
- 房主（先进入者）可设置游戏类型和参数（棋盘大小、让子数等）
- 两个玩家 + 一个围观位（未来扩展）

### 4.2 WebSocket 消息路由（server/src/network/Dispatcher）

- 所有消息类型统一 `{ type: string, payload: object }` 格式
- Dispatcher 根据 `type` 分发到对应 handler
- 每个 handler 返回响应或广播

### 4.3 客户端渲染（client/src/core/BoardRenderer）

- 抽象基类 `BoardRenderer<G extends GameType>`
- 每个游戏实现自己的渲染子类（如 `GoRenderer`、`ChessRenderer`）
- 使用 Canvas API 绘制棋盘和棋子
- 支持缩放/拖拽（大棋盘如 19×19 围棋需要）

---

## 5. 目录结构总览

```
boardgame-arena/
├── README.md                        # 项目简介 + 快速启动
├── package.json                     # monorepo 根（workspaces）
│
├── shared/                          # 共享类型层
│   ├── package.json                 # npm workspace
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # 统一导出
│       ├── constants.ts             # 通用常量
│       ├── types.ts                 # 核心类型定义
│       ├── protocol.ts              # WebSocket 消息类型
│       ├── utils.ts                 # 纯工具函数
│       └── games/
│           ├── go.ts                # 围棋专用类型
│           ├── goban.ts             # 五子棋专用类型（预留）
│           ├── chess.ts             # 中国象棋专用类型（预留）
│           ├── international.ts     # 国际象棋专用类型（预留）
│           └── checkers.ts          # 国际跳棋专用类型（预留）
│
├── server/                          # 服务端
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # 入口：启动 WebSocket 服务
│       ├── core/
│       │   ├── GameEngine.ts        # 抽象游戏引擎基类
│       │   ├── Room.ts              # 房间模型
│       │   ├── RoomManager.ts       # 房间管理
│       │   └── Player.ts            # 玩家模型
│       ├── games/
│       │   ├── GoGameEngine.ts      # 围棋引擎实现
│       │   └── ...                  # 未来游戏引擎
│       └── network/
│           ├── WSServer.ts          # WebSocket 服务器封装
│           └── Dispatcher.ts        # 消息分发器
│
├── client/                          # 客户端
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.ts                  # 入口
│       ├── core/
│       │   ├── BoardRenderer.ts     # 抽象棋盘渲染基类
│       │   ├── InputHandler.ts      # 用户输入处理
│       │   └── GameClient.ts        # 游戏客户端协调器
│       ├── games/
│       │   ├── GoRenderer.ts        # 围棋渲染
│       │   └── ...                  # 未来游戏渲染
│       ├── network/
│       │   └── WSClient.ts          # WebSocket 客户端封装
│       └── components/
│           ├── Lobby.ts             # 大厅界面
│           └── GameView.ts          # 对局界面容器
│
└── docs/                            # 开发文档
    ├── ARCHITECTURE.md              # ← 本文
    ├── CORE-INTERFACES.md           # 核心接口参考
    ├── GAME-DEVELOPMENT.md          # 扩展新游戏指南
    └── NETWORK-PROTOCOL.md          # 网络协议
```

---

## 6. 设计原则与约束

### 6.1 接口先行

所有游戏必须实现 `IGameEngine` 接口（服务端）和 `IBoardRenderer` 接口（客户端）。新增游戏不需要修改任何现有代码——只新增文件。

### 6.2 服务端权威（Server Authority）

**服务端是游戏状态的唯一权威来源。** 客户端发送操作请求，服务端验证后返回更新的状态。客户端不做规则判断（仅做本地乐观渲染以降低延迟感知）。

### 6.3 纯函数规则引擎

游戏规则引擎应为纯函数：`validateMove(state, move) → ValidationResult` 和 `applyMove(state, move) → GameState`。不持有内部状态，状态由 Room 管理。

### 6.4 无锁顺序执行

单线程 Node.js 模型，每个房间的消息按接收顺序串行处理。不需要分布式锁。

---

## 7. 围棋首发特殊设计

围棋作为首发游戏，其规则复杂度（劫、打吃、终局数子、贴目）对其他棋类具有**代表性覆盖**：

| 围棋特性 | 覆盖的通用问题 | 同类游戏 |
|----------|---------------|---------|
| 落子 + 提子 | 棋子移除/变换 | 国际跳棋（吃子）、国际象棋（吃子） |
| 劫（Ko） | 禁止重复局面（三劫循环） | 中国象棋（长将判负） |
| 贴目（Komi） | 条件性加分 | 五子棋（禁手规则） |
| 点目/数子 | 非简单胜负判定 | 所有棋类的终局计算 |
| 虚手（Pass） | 放弃回合 | 所有棋类 |
| 让子（Handicap） | 不对称初始状态 | 国际象棋（让子）、中国象棋（让子） |

因此，围棋规则引擎实现得足够健壮，其他游戏的实现工作量会大幅降低。

---

## 8. 运行架构

```
┌─────── LAN ────────┐
│                     │
│  ┌──────────┐       │
│  │  Server  │       │
│  │:8080 (WS)│       │
│  └────┬─────┘       │
│       │             │
│  ┌────┴─────┐  ┌───┴──────┐
│  │ Client A │  │ Client B │
│  │:3000     │  │:3000     │
│  └──────────┘  └──────────┘
│                     │
│  (同一局域网或同机)   │
└─────────────────────┘
```

- **服务端**：任意一台机器启动（通常是房主），局域网内其他玩家通过 `ws://<host-ip>:8080` 连接
- **客户端**：每个玩家在浏览器打开 `http://localhost:3000` 或局域网地址
- **零外部依赖**：不需要互联网、不需要注册账号、不需要数据库
