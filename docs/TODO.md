# 项目优化 TODO

> 创建日期：2026-06-20
> 最近更新：2026-06-26（大厅 UI 优化 + 后端崩溃修复 + 在线时长统计 bug 修复）

---

## 技术层面

### 代码质量

- [x] TypeScript strict 模式 — 逐步修掉现有类型错误并开启（已开启，修复了 sql.js 类型、draughts/gomoku 类型错误）
- [x] Dispatcher.ts 拆分 — 74KB 单文件，按游戏类型/功能拆分（已完成：types.ts, utils.ts, RoomHandler, GameHandler, AIHandler, KataGoHandler, ChallengeHandler, GameRecordSaver + 4 棋谱生成器）
- [x] 消除 `(room as any)` — Room 类挂了十几个动态字段（_katagoGame、_aiDifficulty、_guessFirst、_challengeTimer 等），应改为正式属性
- [x] 消除空 `catch {}` 块 — connection.ts、RoomPersistence.ts、KataGoManager.ts、WSServer.ts 多处静默吞掉错误，出问题无法定位
- [x] DB 查询类型安全 — queryAll/queryOne 返回 `any`，应定义类型
- [x] admin.ts SQL 字段名拼接 — `UPDATE users SET ${updates.join(', ')}` 未做白名单校验，有注入风险（实际已使用 `as const` 白名单）

### 性能与资源

- [ ] execute() 写入优化 — 每次写操作都 saveDb()，改为定时批量落盘
- [ ] getEngine 每次创建新实例 — handlePlace/handlePass 都 new 引擎，可缓存复用
- [ ] React 组件拆分 — RoomPage 过重（围棋 42KB），拆分子组件
- [ ] sql.js 并发问题 — 单进程同步写，高并发时考虑替代方案

### 安全

- [ ] WebSocket 消息限制 — 无 maxPayload 设置，可发送超大消息耗尽内存
- [ ] WebSocket 速率限制 — 无任何限流，恶意客户端可高频发送
- [ ] admin/seed 无认证 — /api/admin/seed 可在无认证时创建管理员账号
- [x] ws.send 未检查 readyState — Dispatcher 多处直接发送未检查连接状态（2026-06-26：Room.broadcast/broadcastExcept/sendTo/broadcastToPlayers、utils.sendError 已包 try/catch 并保留 readyState 检查）

### 资源管理

- [x] **全局错误兜底** — 2026-06-26 新增。`index.ts` 加 `uncaughtException`/`unhandledRejection` handler；`WSServer` 消息分发与断连处理包 try/catch；`RoomHandler.leave_room` 整体包 try/catch。房主退出时 leave_room 与 close 事件并发触发，DB 写或 ws.send 抛错不再杀进程（vite 代理 ECONNREFUSED 已解决）
- [ ] setTimeout 未清理 — scheduleKataGoMove、scheduleAIMove 的 timer ID 未存储，房间销毁后回调仍可能触发
- [ ] HTTP 优雅关闭 — process.on('exit') 只清理 KataGo，HTTP 连接未 drain
- [ ] 重启后活跃房间丢失 — 重启清空 active_rooms，进行中的游戏直接丢失（设计如此，但应文档化）

### 正确性

- [ ] generateSGF komi 硬编码 3.75 — 与游戏配置中的 komi 不一致，应使用 room.config 中的值
- [x] **在线时长统计 UPDATE 不命中** — 2026-06-26 修复。`WSServer.handleDisconnect` 原用 `WHERE id = player.id`，但 player.id 是房间会话 UUID（`crypto.randomUUID()`）非 DB users.id，UPDATE 永不命中。改为 `WHERE username = ?`（users.username 唯一）

## 运维层面

- [ ] CI/CD — GitHub Actions 跑 lint + tsc 检查
- [ ] JWT_SECRET 环境变量 — 当前硬编码在代码里，生产环境需配置
- [ ] .env 管理 — 引入 dotenv，敏感信息不入代码
- [ ] KataGo 日志清理 — gtp_logs/ 无限增长，加自动清理或上限
- [ ] 数据库备份机制 — .db 文件损坏风险，定时备份

## 功能层面

- [ ] 测试覆盖 — 其他 4 款游戏零测试，Go 测试文件已缺失
- [ ] 断线重连恢复 — 重连后恢复回看/分析数据
- [ ] 观战者查看 KataGo 分析报告 — 目前仅对弈者可见
- [ ] 棋钟计时 — 目前只有围棋有，其他游戏未接入
- [ ] KataGo 对局导出棋谱 — 当前无导出功能

## 体验层面

- [x] **大厅游戏卡片视觉优化** — 2026-06-26 完成。玻璃拟态卡片（backdrop-filter blur+saturate）、每游戏独立主题色（围棋=金/五子棋=青/中国象棋=红/国际象棋=紫/跳棋=绿）、悬停上浮+发光+底部装饰条、图标容器圆角背景框、在线状态胶囊脉冲标签、标题金色渐变投影
- [x] **大厅背景星空粒子** — 2026-06-26 完成。新增 `StarfieldBackground.tsx`（Canvas 2D），三层视差星点（远90/中60/近30）独立闪烁缓慢漂移、金色主题配色、鼠标引力星座连线（鼠标→星 + 星↔星）、偶发金色流星带尾迹、DPR≤2 + 失焦暂停。替换原纯黑背景
- [x] **登录页流体背景调色** — 2026-06-26 完成。`FluidBackground.tsx` PALETTE 从冷蓝紫改为暖金琥珀色系匹配全局金色主题，自动喷溅频率/力度降低，由"视觉焦点"转为"氛围背景"
- [ ] 胜率曲线点击跳步 — 点击折线图跳到对应步数
- [ ] 回看模式键盘快捷键 — 左右箭头切步
- [ ] 移动端适配 — 其他 4 款游戏的 RoomPage
