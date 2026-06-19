import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(__dirname, '..', '..', 'data', 'emoji-questions', 'questions.json');

interface Question {
  id: number;
  emoji: string;
  answer: string;
  difficulty: 'easy' | 'normal' | 'hard';
}

interface EmojiPlayer {
  id: string;
  username: string;
  seat: number;
  ws: WebSocket;
  score: number;
  currentAnswer: string;
}

interface EmojiRoom {
  roomId: string;
  owner: EmojiPlayer;
  players: EmojiPlayer[];
  phase: 'waiting' | 'playing' | 'answering' | 'revealing' | 'finished';
  questions: Question[];
  currentQuestion: number;
  timer: NodeJS.Timeout | null;
  timeLeft: number;
  difficultyConfig: { easy: number; normal: number; hard: number };
}

let allQuestions: Question[] = [];

function loadQuestions(): void {
  try {
    allQuestions = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8'));
    // console.log(`[Emoji] 已加载 ${allQuestions.length} 道题目`);
  } catch (e) {
    console.error('[Emoji] 加载题库失败:', e);
    allQuestions = [];
  }
}
loadQuestions();

const rooms = new Map<string, EmojiRoom>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(id)) return id;
  }
  return Date.now().toString(36).toUpperCase();
}

function selectQuestions(config: { easy: number; normal: number; hard: number }): Question[] {
  const byDiff: Record<string, Question[]> = { easy: [], normal: [], hard: [] };
  for (const q of allQuestions) byDiff[q.difficulty].push(q);

  const result: Question[] = [];
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    const pool = [...byDiff[diff]];
    const count = Math.min(config[diff], pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool.splice(idx, 1)[0]);
    }
  }
  // 打乱顺序
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function broadcast(room: EmojiRoom, message: object): void {
  const data = JSON.stringify(message);
  for (const p of room.players) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function sendTo(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

// ── 消息处理 ──

export function handleEmojiMessage(ws: WebSocket, msg: any): void {
  const type = msg.type;
  const payload = msg.payload || {};

  switch (type) {
    case 'emoji_create_room': return handleCreateRoom(ws, payload);
    case 'emoji_join_room': return handleJoinRoom(ws, payload);
    case 'emoji_leave_room': return handleLeaveRoom(ws);
    case 'emoji_owner_exit': return handleOwnerExit(ws);
    case 'emoji_start_game': return handleStartGame(ws, payload);
    case 'emoji_answer': return handleAnswer(ws, payload);
    case 'emoji_next_question': return handleNextQuestion(ws);
    case 'emoji_get_rooms': return handleGetRooms(ws);
    case 'emoji_set_difficulty': return handleSetDifficulty(ws, payload);
  }
}

function handleCreateRoom(ws: WebSocket, payload: any): void {
  const username = payload.username || '玩家';
  const roomId = generateRoomId();
  const player: EmojiPlayer = {
    id: crypto.randomUUID().slice(0, 8),
    username, seat: 0, ws, score: 0, currentAnswer: '',
  };
  const room: EmojiRoom = {
    roomId, owner: player, players: [player],
    phase: 'waiting', questions: [], currentQuestion: 0,
    timer: null, timeLeft: 0,
    difficultyConfig: { easy: 4, normal: 4, hard: 2 },
  };
  rooms.set(roomId, room);
  sendTo(ws, { type: 'emoji_room_created', payload: { roomId, player, room: roomSnapshot(room) } });
}

function handleJoinRoom(ws: WebSocket, payload: any): void {
  const { roomId, username } = payload;
  const room = rooms.get(roomId);
  if (!room) { sendTo(ws, { type: 'emoji_error', payload: { message: '房间不存在' } }); return; }
  if (room.players.length >= 10) { sendTo(ws, { type: 'emoji_error', payload: { message: '房间已满' } }); return; }
  if (room.phase !== 'waiting') { sendTo(ws, { type: 'emoji_error', payload: { message: '游戏已开始' } }); return; }

  // 随机分配座位（排除已占用的）
  const usedSeats = new Set(room.players.map(p => p.seat));
  let seat = 0;
  while (usedSeats.has(seat) && seat < 10) seat++;

  const player: EmojiPlayer = {
    id: crypto.randomUUID().slice(0, 8),
    username: username || '玩家', seat, ws, score: 0, currentAnswer: '',
  };
  room.players.push(player);
  sendTo(ws, { type: 'emoji_room_joined', payload: { roomId, player, room: roomSnapshot(room) } });
  broadcast(room, { type: 'emoji_player_joined', payload: { player, room: roomSnapshot(room) } });
}

function handleLeaveRoom(ws: WebSocket): void {
  const room = findRoomByWs(ws);
  if (!room) return;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;

  room.players = room.players.filter(p => p.ws !== ws);

  if (room.players.length === 0) {
    if (room.timer) clearInterval(room.timer);
    rooms.delete(room.roomId);
    return;
  }

  // 如果房主离开，转移房主
  if (player.id === room.owner.id && room.players.length > 0) {
    room.owner = room.players[0];
  }

  broadcast(room, { type: 'emoji_player_left', payload: { playerId: player.id, room: roomSnapshot(room) } });
}

function handleOwnerExit(ws: WebSocket): void {
  const room = findRoomByWs(ws);
  if (!room || room.owner.ws !== ws) return;

  // 通知所有人房间被销毁
  broadcast(room, { type: 'emoji_room_destroyed', payload: { message: '房主已销毁房间，即将返回大厅' } });

  // 清理
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.roomId);
}

function handleStartGame(ws: WebSocket, payload: any): void {
  const room = findRoomByWs(ws);
  if (!room || room.owner.ws !== ws) { sendTo(ws, { type: 'emoji_error', payload: { message: '只有房主能开始' } }); return; }
  if (room.players.length < 2) { sendTo(ws, { type: 'emoji_error', payload: { message: '至少需要2人' } }); return; }

  const config = room.difficultyConfig;
  const total = config.easy + config.normal + config.hard;
  if (total !== 10) { sendTo(ws, { type: 'emoji_error', payload: { message: '题目数量必须为10' } }); return; }

  room.questions = selectQuestions(config);
  room.currentQuestion = 0;
  room.phase = 'answering';
  room.timeLeft = 60;

  // 重置分数
  for (const p of room.players) { p.score = 0; p.currentAnswer = ''; }

  // 开始倒计时
  room.timer = setInterval(() => {
    room.timeLeft--;
    broadcast(room, { type: 'emoji_timer', payload: { timeLeft: room.timeLeft } });
    if (room.timeLeft <= 0) {
      clearInterval(room.timer!);
      room.timer = null;
      revealAndScore(room);
    }
  }, 1000);

  // 发送题目（不含答案）
  broadcast(room, {
    type: 'emoji_game_start',
    payload: { room: roomSnapshot(room), question: hideAnswer(room.questions[0]) },
  });
}

function handleAnswer(ws: WebSocket, payload: any): void {
  const room = findRoomByWs(ws);
  if (!room || room.phase !== 'answering') return;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;

  player.currentAnswer = (payload.answer || '').trim();
  broadcast(room, { type: 'emoji_answered', payload: { playerId: player.id, total: room.players.filter(p => p.currentAnswer).length, room: roomSnapshot(room) } });
}

function handleNextQuestion(ws: WebSocket): void {
  const room = findRoomByWs(ws);
  if (!room || room.owner.ws !== ws) return;

  room.currentQuestion++;
  if (room.currentQuestion >= room.questions.length) {
    // 游戏结束
    room.phase = 'finished';
    const ranking = room.players
      .map(p => ({ id: p.id, username: p.username, score: p.score }))
      .sort((a, b) => b.score - a.score);
    broadcast(room, { type: 'emoji_game_over', payload: { ranking, room: roomSnapshot(room) } });
    return;
  }

  // 下一题
  room.phase = 'answering';
  room.timeLeft = 60;
  for (const p of room.players) p.currentAnswer = '';

  room.timer = setInterval(() => {
    room.timeLeft--;
    broadcast(room, { type: 'emoji_timer', payload: { timeLeft: room.timeLeft } });
    if (room.timeLeft <= 0) {
      clearInterval(room.timer!);
      room.timer = null;
      revealAndScore(room);
    }
  }, 1000);

  broadcast(room, {
    type: 'emoji_next_question',
    payload: { questionIndex: room.currentQuestion, question: hideAnswer(room.questions[room.currentQuestion]), room: roomSnapshot(room) },
  });
}

function handleGetRooms(ws: WebSocket): void {
  const list: any[] = [];
  for (const room of rooms.values()) {
    if (room.phase === 'waiting') {
      list.push({ roomId: room.roomId, owner: room.owner.username, playerCount: room.players.length });
    }
  }
  sendTo(ws, { type: 'emoji_room_list', payload: { rooms: list } });
}

function handleSetDifficulty(ws: WebSocket, payload: any): void {
  const room = findRoomByWs(ws);
  if (!room || room.owner.ws !== ws) return;
  const { easy, normal, hard } = payload;
  if (easy + normal + hard > 0) {
    room.difficultyConfig = { easy, normal, hard };
    broadcast(room, { type: 'emoji_difficulty_updated', payload: { difficultyConfig: room.difficultyConfig } });
  }
}

function revealAndScore(room: EmojiRoom): void {
  room.phase = 'revealing';
  const q = room.questions[room.currentQuestion];

  const results = room.players.map(p => {
    const correct = normalizeAnswer(p.currentAnswer) === normalizeAnswer(q.answer);
    if (correct) p.score++;
    return { id: p.id, username: p.username, answer: p.currentAnswer, correct, score: p.score };
  });

  broadcast(room, {
    type: 'emoji_reveal',
    payload: { question: q, correctAnswer: q.answer, results, room: roomSnapshot(room) },
  });

  room.phase = 'playing';
}

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function hideAnswer(q: Question): Omit<Question, 'answer'> {
  const { answer, ...rest } = q;
  return rest;
}

function roomSnapshot(room: EmojiRoom) {
  return {
    roomId: room.roomId,
    owner: { id: room.owner.id, username: room.owner.username, seat: room.owner.seat },
    players: room.players.map(p => ({ id: p.id, username: p.username, seat: p.seat, score: p.score, hasAnswered: !!p.currentAnswer })),
    phase: room.phase,
    currentQuestion: room.currentQuestion,
    totalQuestions: room.questions.length,
    timeLeft: room.timeLeft,
    difficultyConfig: room.difficultyConfig,
  };
}

function findRoomByWs(ws: WebSocket): EmojiRoom | undefined {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.ws === ws)) return room;
  }
  return undefined;
}

export function handleEmojiDisconnect(ws: WebSocket): void {
  handleLeaveRoom(ws);
}
