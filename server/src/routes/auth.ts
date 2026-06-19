import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, execute, uuid } from '../db/connection.js';
import { signToken } from '../middleware/auth.js';

const router = Router();
const SALT_ROUNDS = 10;

/**
 * POST /api/auth/register
 */
router.post('/register', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }
  if (username.length < 2 || username.length > 20) {
    res.status(400).json({ error: '用户名长度 2-20 个字符' });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: '密码至少 4 个字符' });
    return;
  }

  // 检查用户名是否已存在
  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    res.status(409).json({ error: '用户名已被使用' });
    return;
  }

  // 创建用户
  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  execute(
    'INSERT INTO users (id, username, password_hash, role, nickname) VALUES (?, ?, ?, ?, ?)',
    [id, username, passwordHash, 'user', username]
  );

  const token = signToken({ userId: id, username, role: 'user' });

  res.status(201).json({
    token,
    user: { id, username, nickname: username, role: 'user' },
  });
});

/**
 * POST /api/auth/login
 */
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }

  const user = queryOne(
    'SELECT id, username, password_hash, role, nickname, banned FROM users WHERE username = ?',
    [username]
  );

  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  if (user.banned) {
    res.status(403).json({ error: '账号已被封禁' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
      role: user.role,
    },
  });
});

export default router;
