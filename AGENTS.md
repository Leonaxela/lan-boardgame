# AGENTS.md — Lan Boardgame

## Project overview

LAN multiplayer board game platform. npm workspaces monorepo with 5 game modules, an Express+WebSocket server, and a Vite+React+Canvas client. Chinese is the primary language in code, docs, and UI.

## Quick start

```bash
npm install          # root — installs all workspaces
npm run server       # server dev (tsx watch, port 8080)
npm run client       # client dev (vite, port 3030, opens browser)
npm test             # Go engine + AI tests only (npx tsx)
```

Server proxies `/api/*` to `http://localhost:8080`. Client uses `--strictPort` on 3030.

## Workspace structure

| Path | Package | Role |
|------|---------|------|
| `shared/` | `@lan-boardgame/shared` | Types, enums, protocol defs — no runtime |
| `server/` | `@lan-boardgame/server` | Express + ws + sql.js (SQLite in-memory on disk) |
| `client/` | `@lan-boardgame/client` | Vite + React + Canvas renderers |
| `games/go/` | `@lan-boardgame/go` | Go engine, AI (Chinese/Japanese rules), exports per rule set |
| `games/gomoku/` | `@lan-boardgame/gomoku` | Gomoku engine + AI |
| `games/chinese-chess/` | `@lan-boardgame/chinese-chess` | Chinese Chess engine + AI |
| `games/chess/` | `@lan-boardgame/chess` | International Chess engine + AI |
| `games/draughts/` | `@lan-boardgame/draughts` | International Draughts engine + AI |

## Rules (hard constraints)

- **Server port = 8080, client dev port = 3030.** Don't change either.
- **Don't auto-start the project.** Tell the user to start it themselves.
- **Use `client/src/components/Dropdown.tsx`** for all dropdowns. Never native `<select>`.
- **Sort buttons swap adjacent items' `sort_order`**, not increment/decrement. Prevents duplicates.
- **SQL state filters use `IN ('ready', 'developing')` whitelist**, never `!= 'conceal'`.
- **Game IDs are fixed**: `go`, `gomoku`, `chinese-chess`, `chess`, `draughts`. No `mahjong`.
- **Chess prefix for International Chess**, never `IntlChess` — `ChessEngine`, `isChess`, `generateChessPGN`.
- **Chinese Chess / International Chess / Draughts use from→to moves** via `state.extra.from`. Go and Gomoku use single-point placement.
- **AI players are filtered out of `playerCount`**: `!p.id.startsWith('ai-')`.
- **Server uses sql.js** (not better-sqlite3). DB file at `server/data/lan-boardgame.db`.

## Adding a new game — Dispatcher integration checklist

Each game module needs registration in `server/src/websocket/Dispatcher.ts` at these locations:

1. `getEngine()` — map GameType to engine class
2. `handleStartAIGame()` — color assignment + AI player creation
3. `handleRematch()` — AI color re-assignment on rematch
4. `scheduleAIMove()` — AI color constant + AI function call
5. `handlePlace()` — if from→to game, read `state.extra.from`
6. `saveGameRecord()` — chess format generation (SGF for Go/Gomoku, PGN for Chess variants, PDN for Draughts)

Games with from→to moves (chess variants) also need: move record with `fromRow`/`fromCol`, and `state.extra.from` injection in `handlePlace`.

## Testing

Only Go has tests: `npm test` runs `games/go/src/__tests__/engine.test.ts` and `games/go/src/__tests__/ai.test.ts` via tsx. No test runner (jest/vitest) is configured.

## Key architectural facts

- **Server authority**: All game state lives server-side. Client does optimistic rendering only.
- **WebSocket messages**: JSON `{ type, payload, timestamp? }`. 15+ message types defined in `docs/NETWORK-PROTOCOL.md`.
- **Room lifecycle**: WAITING → PLAYING → FINISHED. Owner disconnect triggers 30s destruction timer.
- **Guess-first (猜先)**: PvP games use a guess-first flow before starting. Go/Gomoku use odd/even guessing; chess variants use rock-paper-scissors.
- **Emoji game is separate**: `EmojiGameManager` handles emoji guess game independently from `RoomManager`. Messages prefixed `emoji_` route via WSServer, not Dispatcher.

## Conventions

- Coordinate system: `Position { row, col }`, (0,0) = top-left. `board[row][col]`.
- Validation errors return Chinese strings for direct user display.
- `GameState.board` is immutable — `applyMove` returns a new object with cloned board.
- React hooks must be called unconditionally at component top level (no hooks inside conditional branches or render helper functions).
- `lastResultRef` pattern: useRef caches game-end result so status bar shows it after `gameResult` clears.
