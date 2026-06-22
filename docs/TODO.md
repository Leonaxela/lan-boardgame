# 项目优化 TODO

> 创建日期：2026-06-20

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
- [ ] ws.send 未检查 readyState — Dispatcher 多处直接发送未检查连接状态

### 资源管理

- [ ] setTimeout 未清理 — scheduleKataGoMove、scheduleAIMove 的 timer ID 未存储，房间销毁后回调仍可能触发
- [ ] HTTP 优雅关闭 — process.on('exit') 只清理 KataGo，HTTP 连接未 drain
- [ ] 重启后活跃房间丢失 — 重启清空 active_rooms，进行中的游戏直接丢失（设计如此，但应文档化）

### 正确性

- [ ] generateSGF komi 硬编码 3.75 — 与游戏配置中的 komi 不一致，应使用 room.config 中的值

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

- [ ] 胜率曲线点击跳步 — 点击折线图跳到对应步数
- [ ] 回看模式键盘快捷键 — 左右箭头切步
- [ ] 移动端适配 — 其他 4 款游戏的 RoomPage
