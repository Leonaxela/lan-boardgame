# AGENTS.md — Lan Boardgame

## Project overview

局域网联机对战棋类平台。npm workspaces monorepo,含 6 个游戏模块(其中麻将刻意独立于主体系)、一个 Express+WebSocket 服务器、一个 Vite+React+Canvas 客户端,以及 KataGo / Fairy-Stockfish 外部 AI 引擎集成。中文是代码、文档、UI 的主要语言。

## Quick start

```bash
npm install          # root — 安装所有 workspaces
npm run server       # server dev (tsx watch, port 8080)
npm run client       # client dev (vite, port 3030, opens browser)
```

无测试脚本。Server 代理 `/api/*` 到 `http://localhost:8080`。Client 使用 `--strictPort` 固定 3030。

**⚠️ 开发期已知现象**:`npm run server` 是 `tsx watch`,保存 server 代码会**自动重启进程**(重启间隙约 0.5~2 秒,8080 端口无监听)。此时任何 HTTP 请求(vite 代理)会报 `ECONNREFUSED`,前端表现为请求失败/网络错误——不是代码 bug。前端关键请求(如 `UserProfileModal` 的 profile/records)已加自动重试绕过此窗口;改完 server 代码后 1~2 秒内避免触发 HTTP 请求即可。

## Workspace structure

| Path | Package | Role |
|------|---------|------|
| `shared/` | `@lan-boardgame/shared` | Types, enums, protocol defs — no runtime |
| `server/` | `@lan-boardgame/server` | Express + ws + sql.js (SQLite in-memory on disk) |
| `client/` | `@lan-boardgame/client` | Vite + React + Canvas renderers |
| `games/go/` | `@lan-boardgame/go` | Go engine + AI (Chinese/Japanese rules), exports per rule set (`./chinese` / `./japanese` / `./ai`) |
| `games/gomoku/` | `@lan-boardgame/gomoku` | Gomoku engine + AI (`./engine` / `./ai`) |
| `games/chinese-chess/` | `@lan-boardgame/chinese-chess` | Chinese Chess engine + AI (`./engine` / `./ai`) |
| `games/chess/` | `@lan-boardgame/chess` | International Chess engine + AI (`./engine` / `./ai`) |
| `games/draughts/` | `@lan-boardgame/draughts` | International Draughts engine + AI (`./engine` / `./ai`) |
| `games/mahjong/` | `@lan-boardgame/mahjong` | 麻将引擎 + AI,独立体系,不走 Dispatcher、不进 GameType |
| `server/src/katago/` | — | KataGo 进程管理器:每房间一个 `katago.exe gtp` 子进程,GTP 协议,围棋对弈/分析 |
| `server/src/fairy-stockfish/` | — | Fairy-Stockfish 进程管理器:每房间一个子进程,UCI/UCCI 协议;中国象棋→UCCI (xiangqi),国际象棋→UCI (chess) |
| `server/src/emoji/` | — | EmojiGameManager:emoji 猜图游戏,独立于 RoomManager 与 Dispatcher |
| `server/src/mahjong/` | — | MahjongRoomManager + MahjongMessageHandler:麻将房间与消息处理 |

## Rules (hard constraints)

- **Server port = 8080, client dev port = 3030.** Don't change either.
- **Don't auto-start the project.** Tell the user to start it themselves.
- **Use `client/src/components/Dropdown.tsx`** for all dropdowns. Never native `<select>`.
- **Sort buttons swap adjacent items' `sort_order`**, not increment/decrement. Prevents duplicates.
- **SQL state filters use `IN ('ready', 'developing')` whitelist**, never `!= 'conceal'`.
- **GameType 枚举固定 5 个**:`go`、`gomoku`、`chinese-chess`、`chess`、`draughts`。**mahjong 是刻意独立的设计**——不进 GameType、不注册 Dispatcher,消息以 `mahjong_` 前缀在 WSServer 直接路由到 `handleMahjongMessage`。不要试图把它塞进主体系。
- **Chess prefix for International Chess**, never `IntlChess` — `ChessEngine`, `isChess`, `generateChessPGN`.
- **Chinese Chess / International Chess / Draughts use from→to moves** via `state.extra.from`. Go and Gomoku use single-point placement.
- **AI players are filtered out of `playerCount`**: `!p.id.startsWith('ai-')`(主体系)。麻将过滤用 `!p.isAI`。
- **Server uses sql.js** (not better-sqlite3). DB file at `server/data/lan-boardgame.db`.
- **消息前缀路由**:`emoji_` → EmojiGameManager,`mahjong_` → MahjongMessageHandler,其余 → Dispatcher。新增独立游戏子系统的消息必须用独特前缀,并在 `WSServer.setup()` 和 `handleDisconnect()` 注册。

## Adding a new game — Dispatcher integration checklist

每个棋类游戏模块需要在 `server/src/websocket/Dispatcher.ts` 及各 handler 注册:

1. `handlers/GameHandler.ts` `getEngine()` — map GameType to engine class
2. `handlers/AIHandler.ts` `handleStartAIGame()` — color assignment + AI player creation
3. `handlers/AIHandler.ts` `handleRematch()` — AI color re-assignment on rematch
4. `handlers/AIHandler.ts` `scheduleAIMove()` — AI color constant + AI function call
5. `handlers/GameHandler.ts` `handlePlace()` — if from→to game, read `state.extra.from`
6. `websocket/records/generators/` — chess format generation (SGF for Go/Gomoku, PGN for Chess variants, PDN for Draughts)

Games with from→to moves (chess variants) also need: move record with `fromRow`/`fromCol`, and `state.extra.from` injection in `handlePlace`.

## Key architectural facts

- **Server authority**: All game state lives server-side. Client does optimistic rendering only.
- **WebSocket messages**: JSON `{ type, payload, timestamp? }`. 15+ message types defined in `docs/NETWORK-PROTOCOL.md`.麻将消息均为 `mahjong_` 前缀,不在该文档主协议中。
- **Room lifecycle (主体系)**: WAITING → PLAYING → FINISHED. Owner disconnect triggers 30s destruction timer.
- **麻将房间生命周期独立**: 在 `MahjongRoomManager`,owner(seat 0)断线直接销毁房间;对局中其他玩家断线由 AI 接管(`isAI = true`)。
- **Guess-first (猜先)**: PvP games use a guess-first flow before starting. Go/Gomoku use odd/even guessing; chess variants use rock-paper-scissors.
- **麻将独立于猜先**: 直接入座、房主选 variant(sichuan/wuhan/guobiao)后开局;支持单机模式(`mahjong_start_solo`)与真人局。
- **AI 引擎为独立子系统**: KataGo(围棋,每房间一个 GTP 子进程)与 Fairy-Stockfish(象棋类,UCI/UCCI 子进程)由 manager 管理生命周期,进程在 server/katago 与 server/fairy-stockfish 目录;`index.ts` 退出时统一清理。
- **Emoji game is separate**: `EmojiGameManager` handles emoji guess game independently from `RoomManager`. Messages prefixed `emoji_` route via WSServer, not Dispatcher.
- **在线时长统计**: WS 连接级 `_connectAt`/`_username` 每 60s 累加 `total_online_seconds`;断线时兜底结算。

## Conventions

- Coordinate system: `Position { row, col }`, (0,0) = top-left. `board[row][col]`.
- Validation errors return Chinese strings for direct user display.
- `GameState.board` is immutable — `applyMove` returns a new object with cloned board.
- React hooks must be called unconditionally at component top level (no hooks inside conditional branches or render helper functions).
- `lastResultRef` pattern: useRef caches game-end result so status bar shows it after `gameResult` clears.
- 麻将引擎导出 `sichuanRules` / `wuhanRules` / `guobiaoRules`,AI 在 `games/mahjong/src/ai/`。

## Notes

(备用,后续补充)
