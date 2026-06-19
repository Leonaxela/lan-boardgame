import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { initDb } from './db/connection.js';
import { RoomManager } from './room/RoomManager.js';
import { ChatHandler } from './chat/ChatHandler.js';
import { GameWSServer } from './websocket/WSServer.js';
import { kataGoManager } from './katago/KataGoManager.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import sgfRoutes from './routes/sgf.js';
import gamesRoutes from './routes/games.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

async function start() {
  await initDb();

  // HTTP 路由
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/sgf', sgfRoutes);
  app.use('/api/games', gamesRoutes);
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

start().catch(console.error);
