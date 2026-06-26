import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/connection.js';
import { RoomManager } from './room/RoomManager.js';
import { ChatHandler } from './chat/ChatHandler.js';
import { GameWSServer } from './websocket/WSServer.js';
import { kataGoManager } from './katago/KataGoManager.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import sgfRoutes from './routes/sgf.js';
import gamesRoutes from './routes/games.js';
import usersRoutes from './routes/users.js';

const app = express();
const PORT = process.env.PORT || 8080;

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: '2mb' })); // 头像 base64 可能较大，放宽到 2MB

// 头像静态服务
app.use('/api/avatars', express.static(join(__dirname, '..', 'data', 'avatars'), {
  maxAge: '7d',
  setHeaders: (res) => { res.setHeader('Cache-Control', 'public, max-age=604800'); },
}));

async function start() {
  await initDb();

  // HTTP 路由
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/sgf', sgfRoutes);
  app.use('/api/games', gamesRoutes);
  app.use('/api/users', usersRoutes);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // 共享 HTTP server（WebSocket 升级用）
  const httpServer = createServer(app);

  // 房间管理 + 聊天 + WebSocket
  const roomManager = new RoomManager();
  const chatHandler = new ChatHandler();
  new GameWSServer(httpServer, roomManager, chatHandler);

  httpServer.listen(PORT, () => {
    console.log(`[Server] http://localhost:${PORT}`);
    console.log(`[Server] WS: ws://localhost:${PORT}`);
  });
}

// 退出时清理所有 KataGo 子进程
function cleanupKataGo() {
  console.log('[Server] 正在关闭 KataGo 进程...');
  kataGoManager.destroyAll();
}

process.on('SIGINT', () => { cleanupKataGo(); process.exit(0); });
process.on('SIGTERM', () => { cleanupKataGo(); process.exit(0); });
process.on('exit', () => { cleanupKataGo(); });

// ── 全局兜底：防止任意未捕获异常/拒绝直接拖垮进程 ──
// 没有这两个 handler，WS 消息回调 / setTimeout / 事件回调里任何一次 throw
// 都会让整个 Node 进程崩溃，表现为前端 vite 代理 ECONNREFUSED。
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

start().catch(console.error);
