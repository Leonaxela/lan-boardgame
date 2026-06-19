# 围棋棋钟功能设计

## 概述

在围棋房间的"申请终局数子"按钮上方添加棋钟，显示对局双方的每步用时和总用时。当前回合玩家的时钟高亮显示。

## 范围

仅围棋房间（Go），其他游戏暂不支持。

## 设计方案

### 服务端

1. **moveHistory 增加时间戳**
   - 每条记录增加 `at: number`（Date.now()）
   - 游戏开始时记录 `gameStartedAt` 到 room 对象

2. **gameState 增加时钟数据**
   ```typescript
   interface GameState {
     // ... 现有字段
     clock?: {
       black: { moveTime: number; totalTime: number };
       white: { moveTime: number; totalTime: number };
       lastMoveAt: number;  // 最后一手的时间戳
     };
   }
   ```

3. **handlePlace 更新时钟**
   - 落子时计算当前玩家的 moveTime（上一手到现在的时间差）
   - 累加 totalTime
   - 更新 lastMoveAt 为当前时间

### 客户端

1. **useRoom hook**
   - 从 gameState 中提取 clock 数据
   - 导出 clock 给 RoomPage 使用

2. **GoRoomPage 显示棋钟**
   - 位置：在 sidebar-actions 区域，"申请终局数子"按钮上方
   - 样式：
     ```
     ⚫ 你  00:12  05:30  ← 当前回合时钟跳动
     ⚪ 对手 00:00  03:45
     ```
   - 当前回合：绿色/金色高亮，数字跳动动画
   - 非当前回合：灰色，静态显示
   - 字体：等宽字体（tabular-nums）防止数字跳动

3. **格式化函数**
   - `formatTime(ms: number): string` → "MM:SS" 或 "HH:MM:SS"
   - 每秒更新一次显示

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `server/src/room/Room.ts` | 添加 `gameStartedAt` 字段 |
| `shared/src/types/engine.ts` | GameState 增加 `clock` 可选字段 |
| `server/src/websocket/Dispatcher.ts` | handlePlace 中更新时钟数据 |
| `client/src/hooks/useRoom.ts` | 导出 clock 数据 |
| `client/src/pages/go/RoomPage.tsx` | 添加棋钟 UI 组件 |

## 交互细节

- 游戏开始时：clock 初始化，双方 moveTime=0, totalTime=0
- 每次落子：当前玩家的 moveTime 重置为 0，对手的 moveTime 开始计时
- 游戏结束时：停止更新，显示最终用时
- Pass/认输：同样触发时钟更新

## 样式参考

```css
.clock-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.clock-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.clock-row.active {
  background: rgba(76, 175, 80, 0.15);
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.clock-move {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.clock-total {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
}

.clock-row.active .clock-move {
  color: #4caf50;
  animation: clock-pulse 1s ease-in-out infinite;
}

@keyframes clock-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```
