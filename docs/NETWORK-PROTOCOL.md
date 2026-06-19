# WebSocket 网络通信协议

> 所有消息使用 JSON 格式，UTF-8 编码。
> WebSocket 端点：`ws://<server-ip>:8080`

---

## 1. 消息格式

所有消息统一结构：

```typescript
// 客户端 → 服务端
interface ClientMessage {
  type: string;
  payload: Record<string, unknown>;
  /** 客户端时间戳（毫秒）—— 用于延迟计算，可选 */
  timestamp?: number;
}

// 服务端 → 客户端
interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
  /** 服务端时间戳 */
  timestamp: number;
}
```

---

## 2. 消息类型一览

### 2.1 房间管理

| 方向 | type | 方向 | 说明 |
|------|------|------|------|
| C→S | `create_room` | 请求 | 创建新房间 |
| S→C | `room_created` | 响应 | 返回 roomId |
| C→S | `join_room` | 请求 | 加入已有房间 |
| S→C | `room_joined` | 响应 | 成功加入 |
| S→C | `room_updated` | 广播 | 房间状态变化 |
| C→S | `leave_room` | 请求 | 离开房间 |
| S→C | `player_joined` | 广播 | 有玩家加入 |
| S→C | `player_left` | 广播 | 有玩家离开 |

### 2.2 游戏操作

| 方向 | type | 方向 | 说明 |
|------|------|------|------|
| C→S | `game_start` | 请求 | 房主开始游戏 |
| S→C | `game_started` | 广播 | 游戏正式开始 |
| C→S | `place` | 请求 | 落子 |
| C→S | `pass` | 请求 | 虚手（放弃本回合） |
| C→S | `resign` | 请求 | 认输 |
| S→C | `game_state` | 广播 | 更新游戏状态 |
| S→C | `game_over` | 广播 | 游戏结束 |
| S→C | `error` | 单播 | 错误信息 |
| S→C | `opponent_disconnected` | 广播 | 对方断线 |

### 2.3 连接管理

| 方向 | type | 方向 | 说明 |
|------|------|------|------|
| C→S | `ping` | 请求 | 心跳 |
| S→C | `pong` | 响应 | 心跳回复 |
| - | 连接断开 | 检测 | 服务端自动广播 `player_left` |

---

## 3. 消息体详细定义

### 3.1 create_room / room_created

```typescript
// C → S: 创建房间
{
  "type": "create_room",
  "payload": {
    "gameType": "go",           // 游戏类型
    "playerName": "PlayerA",     // 玩家昵称
    "config": {                  // 游戏配置
      "rows": 19,
      "cols": 19,
      "extra": {
        "komi": 7.5,             // 围棋贴目
        "handicap": 0            // 让子数
      }
    }
  }
}

// S → C: 创建成功
{
  "type": "room_created",
  "payload": {
    "roomId": "abc123",          // 短房间号
    "player": {                  // 你的玩家信息
      "id": "p1",
      "name": "PlayerA",
      "color": "black"
    }
  },
  "timestamp": 1711065600000
}
```

### 3.2 join_room / room_joined

```typescript
// C → S: 加入房间
{
  "type": "join_room",
  "payload": {
    "roomId": "abc123",
    "playerName": "PlayerB"
  }
}

// S → C: 加入成功
{
  "type": "room_joined",
  "payload": {
    "roomId": "abc123",
    "player": {
      "id": "p2",
      "name": "PlayerB",
      "color": "white"
    },
    "room": {                    // 当前房间完整状态
      "status": "waiting",
      "gameType": "go",
      "config": { "rows": 19, "cols": 19, "extra": { "komi": 7.5, "handicap": 0 } },
      "players": [
        { "id": "p1", "name": "PlayerA", "color": "black" },
        { "id": "p2", "name": "PlayerB", "color": "white" }
      ],
      "gameState": null          // 游戏尚未开始
    }
  },
  "timestamp": 1711065601000
}

// S → C: 通知房主（广播）
{
  "type": "player_joined",
  "payload": {
    "player": { "id": "p2", "name": "PlayerB", "color": "white" }
  }
}
```

### 3.3 game_start / game_started

```typescript
// C → S: 房主请求开始（仅在双方到齐时有效）
{
  "type": "game_start",
  "payload": {}
}

// S → C: 广播给双方
{
  "type": "game_started",
  "payload": {
    "gameState": {
      "phase": "playing",
      "currentTurn": "black",
      "board": [ /* 初始棋盘：19×19 全 null */ ],
      "moveCount": 0,
      "lastMove": null,
      "extra": {
        "koPoint": null,
        "consecutivePasses": 0
      }
    }
  }
}
```

### 3.4 place / game_state

```typescript
// C → S: 落子
{
  "type": "place",
  "payload": {
    "position": { "row": 9, "col": 9 }
  }
}

// S → C: 广播更新（成功）
{
  "type": "game_state",
  "payload": {
    "gameState": {
      "phase": "playing",
      "currentTurn": "white",
      "board": [ /* 更新后的 19×19 数组 */ ],
      "moveCount": 1,
      "lastMove": { "row": 9, "col": 9 },
      "extra": {
        "koPoint": null,
        "consecutivePasses": 0
      }
    }
  }
}

// S → C: 单播错误（不合法）
{
  "type": "error",
  "payload": {
    "code": "INVALID_MOVE",
    "message": "该位置已有棋子"
  }
}
```

### 3.5 pass

```typescript
// C → S: 虚手
{
  "type": "pass",
  "payload": {}
}

// S → C: 广播
{
  "type": "game_state",
  "payload": {
    "gameState": {
      /* ... 状态更新，currentTurn 切换 */
      "extra": { "consecutivePasses": 1, /* ... */ }
    }
  }
}
```

### 3.6 resign

```typescript
// C → S: 认输
{
  "type": "resign",
  "payload": {}
}

// S → C: 广播
{
  "type": "game_over",
  "payload": {
    "result": {
      "winner": { "id": "p1", "name": "PlayerA", "color": "black" },
      "reason": "resign",
      "scores": { "p1": 0, "p2": 0 }
    }
  }
}
```

### 3.7 game_over（正常终局）

```typescript
{
  "type": "game_over",
  "payload": {
    "result": {
      "winner": { "id": "p1", "name": "PlayerA", "color": "black" },
      "reason": "score",
      "scores": {
        "p1": 185.5,     // 黑棋 185.5 子（含贴目）
        "p2": 176        // 白棋 176 子
      }
    }
  }
}
```

### 3.8 ping / pong

```typescript
// C → S
{ "type": "ping", "payload": { "seq": 1 } }

// S → C
{ "type": "pong", "payload": { "seq": 1 }, "timestamp": 1711065602000 }
```

---

## 4. 连接生命周期

```
客户端连接 WebSocket
  │
  ├─ create_room  → 成为房主，等待对手
  │     └─ 对手 join_room → 双方到齐
  │
  ├─ join_room    → 成为挑战者
  │     └─ 房主 game_start → 游戏开始
  │
  ├─ 游戏过程中
  │     ├─ place / pass / resign
  │     └─ 服务端广播 game_state 或 game_over
  │
  ├─ 断线处理
  │     ├─ 90秒内重连 → 恢复游戏
  │     └─ 超时 → 判负，game_over
  │
  └─ 游戏结束：game_over → 双方可 leave_room 或再次 game_start
```

---

## 5. 错误码

| code | HTTP 类比 | 说明 |
|------|-----------|------|
| `ROOM_NOT_FOUND` | 404 | 房间号不存在 |
| `ROOM_FULL` | 409 | 房间已满（已有2人） |
| `NOT_YOUR_TURN` | 403 | 不是你的回合 |
| `INVALID_MOVE` | 400 | 落子不合法 |
| `GAME_NOT_STARTED` | 400 | 游戏尚未开始 |
| `GAME_ALREADY_OVER` | 400 | 游戏已结束 |
| `NOT_ROOM_OWNER` | 403 | 非房主操作 |

---

## 6. 消息示例（完整对局）

<details>
<summary>点击展开完整对局日志</summary>

```
[Client A] → { "type":"create_room", "payload":{"gameType":"go","playerName":"小明","config":{"rows":19,"cols":19,"extra":{"komi":7.5,"handicap":0}}} }
[Server]   → { "type":"room_created", "payload":{"roomId":"abc123","player":{"id":"p1","name":"小明","color":"black"}}, "timestamp":... }

[Client B] → { "type":"join_room", "payload":{"roomId":"abc123","playerName":"小红"} }
[Server]   → { "type":"room_joined", "payload":{"player":{"id":"p2","name":"小红","color":"white"}, "room":{...}} }
[Server]   → { "type":"player_joined", "payload":{"player":{"id":"p2","name":"小红","color":"white"}} }

[Client A] → { "type":"game_start", "payload":{} }
[Server]   → { "type":"game_started", "payload":{"gameState":{...}} }

[Client A] → { "type":"place", "payload":{"position":{"row":9,"col":9}} }
[Server]   → { "type":"game_state", "payload":{"gameState":{"currentTurn":"white",...}} }
[Client B] → { "type":"place", "payload":{"position":{"row":10,"col":9}} }
[Server]   → { "type":"game_state", "payload":{"gameState":{"currentTurn":"black",...}} }
... 交替 ...

[Client A] → { "type":"pass", "payload":{} }
[Server]   → { "type":"game_state", "payload":{"gameState":{"currentTurn":"white","extra":{"consecutivePasses":1,...}}} }
[Client B] → { "type":"pass", "payload":{} }
[Server]   → { "type":"game_over", "payload":{"result":{"winner":{"id":"p1","name":"小明","color":"black"},"reason":"score","scores":{"p1":185.5,"p2":176}}} }
```
</details>
