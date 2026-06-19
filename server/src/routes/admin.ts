import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, execute, queryAll, uuid } from '../db/connection.js';
import { signToken, authenticate, requireAdmin } from '../middleware/auth.js';
import { getOnlineCount, getOnlineUsers } from '../room/RoomPersistence.js';

const router = Router();

/**
 * POST /api/admin/login
 */
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: '管理员账号和密码不能为空' });
    return;
  }

  const user = queryOne(
    'SELECT id, username, password_hash, role, nickname FROM users WHERE username = ? AND role = ?',
    [username, 'admin']
  );

  if (!user) {
    res.status(401).json({ error: '管理员账号或密码错误' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: '管理员账号或密码错误' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username, role: 'admin' });

  res.json({
    token,
    user: { id: user.id, username: user.username, nickname: user.nickname || user.username, role: 'admin' },
  });
});

/**
 * GET /api/admin/seed
 * 创建默认管理员（开发用）。
 */
router.get('/seed', (_req: Request, res: Response) => {
  const existing = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (existing) {
    res.json({ message: '管理员账号已存在' });
    return;
  }

  const id = uuid();
  const hash = bcrypt.hashSync('admin123', 10);
  execute(
    'INSERT INTO users (id, username, password_hash, role, nickname) VALUES (?, ?, ?, ?, ?)',
    [id, 'admin', hash, 'admin', '管理员']
  );

  res.json({ message: '默认管理员已创建（admin / admin123）' });
});

/**
 * GET /api/admin/dashboard
 */
router.get('/dashboard', authenticate, requireAdmin, (_req: Request, res: Response) => {
  const totalUsers = (queryOne('SELECT COUNT(*) as c FROM users WHERE role = ?', ['user']) as any).c;
  const totalGames = (queryOne('SELECT COUNT(*) as c FROM game_records') as any).c;
  const todayGames = (queryOne(
    "SELECT COUNT(*) as c FROM game_records WHERE date(created_at) = date('now')"
  ) as any).c;
  const onlineUsers = getOnlineCount();

  res.json({ totalUsers, totalGames, todayGames, onlineUsers });
});

/**
 * GET /api/admin/online-users
 * 在线用户详情。
 */
router.get('/online-users', authenticate, requireAdmin, (_req: Request, res: Response) => {
  const users = getOnlineUsers();
  res.json({ users });
});

/**
 * GET /api/admin/top-players?game_type=go
 * 某游戏的胜局排行。
 */
router.get('/top-players', authenticate, requireAdmin, (req: Request, res: Response) => {
  const gameType = (req.query.game_type as string) || '';
  let players: any[] = [];
  if (gameType) {
    // winner_id 是房间随机 ID，需要从 players JSON 中找到赢家的 username，再关联 users 表
    players = queryAll(
      `SELECT u.id, u.username, COUNT(*) as win_count
       FROM game_records gr,
            json_each(gr.players) p,
            users u
       WHERE gr.game_type = ?
         AND gr.winner_id != ''
         AND gr.winner_id NOT LIKE 'ai-%'
         AND json_extract(p.value, '$.id') = gr.winner_id
         AND json_extract(p.value, '$.name') = u.username
       GROUP BY u.id
       ORDER BY win_count DESC LIMIT 10`,
      [gameType]
    );
  }
  res.json({ players });
});

/**
 * GET /api/admin/users
 * 用户列表（分页 + 搜索）。
 */
router.get('/users', authenticate, requireAdmin, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || '';
  const offset = (page - 1) * limit;

  let where = "WHERE role = 'user'";
  const params: any[] = [];
  if (search) {
    where += ' AND (username LIKE ? OR nickname LIKE ? OR hometown LIKE ? OR occupation LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const totalRow = queryOne(`SELECT COUNT(*) as c FROM users ${where}`, params) as any;
  const total = totalRow?.c ?? 0;

  const users = queryAll(
    `SELECT id, username, role, nickname, birth_date, gender, hometown, occupation, hobbies,
            total_games, win_games, last_online_at, total_online_seconds, created_at, banned
     FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
});

/**
 * PUT /api/admin/users/:id
 * 修改用户信息。
 */
router.put('/users/:id', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const fields = ['nickname', 'birth_date', 'gender', 'hometown', 'occupation', 'hobbies', 'banned'] as const;
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (req.body.password) {
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(req.body.password, 10));
  }

  if (updates.length === 0) {
    res.status(400).json({ error: '没有要更新的字段' });
    return;
  }

  values.push(id);
  execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

  const user = queryOne('SELECT id, username, role, nickname, birth_date, gender, hometown, occupation, hobbies, total_games, win_games, last_online_at, total_online_seconds, created_at, banned FROM users WHERE id = ?', [id]);
  res.json({ user });
});

/**
 * POST /api/admin/users
 * 创建新用户。
 */
router.post('/users', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: '用户名和密码不能为空' });
    return;
  }
  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    res.status(409).json({ error: '用户名已存在' });
    return;
  }
  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  execute(
    'INSERT INTO users (id, username, password_hash, role, nickname) VALUES (?, ?, ?, ?, ?)',
    [id, username, hash, 'user', nickname || '']
  );
  const user = queryOne('SELECT id, username, role, nickname, birth_date, gender, hometown, occupation, hobbies, total_games, win_games, last_online_at, total_online_seconds, created_at, banned FROM users WHERE id = ?', [id]);
  res.json({ user });
});

/**
 * DELETE /api/admin/users/:id
 * 删除用户。
 */
router.delete('/users/:id', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const user = queryOne('SELECT role FROM users WHERE id = ?', [id]) as any;
  if (!user) { res.status(404).json({ error: '用户不存在' }); return; }
  if (user.role === 'admin') { res.status(403).json({ error: '不能删除管理员' }); return; }
  execute('DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
});

/**
 * GET /api/admin/records
 * 对局记录列表（分页）。
 */
router.get('/records', authenticate, requireAdmin, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const total = (queryOne('SELECT COUNT(*) as c FROM game_records') as any).c;
  const records = queryAll(
    'SELECT id, game_type, board_size, players, winner_id, reason, scores, created_at, duration_sec FROM game_records ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  res.json({ records, total, page, limit, totalPages: Math.ceil(total / limit) });
});

/**
 * GET /api/admin/records/:id
 * 对局记录详情（含 moves 和 sgf）。
 */
router.get('/records/:id', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const record = queryOne(
    'SELECT id, game_type, rule_set, board_size, players, winner_id, reason, moves, sgf, scores, created_at, duration_sec FROM game_records WHERE id = ?',
    [id]
  );
  if (!record) {
    res.status(404).json({ error: '记录不存在' });
    return;
  }
  res.json({ record });
});

/**
 * DELETE /api/admin/records/:id
 * 删除对局记录。
 */
router.delete('/records/:id', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const record = queryOne('SELECT id FROM game_records WHERE id = ?', [id]);
  if (!record) { res.status(404).json({ error: '记录不存在' }); return; }
  execute('DELETE FROM game_records WHERE id = ?', [id]);
  res.json({ success: true });
});

/**
 * GET /api/admin/statistics
 * 统计数据：概览、游戏热度、每日趋势、高分玩家、用户画像。
 */
router.get('/statistics', authenticate, requireAdmin, (_req: Request, res: Response) => {
  // 概览
  const totalUsers = (queryOne('SELECT COUNT(*) as c FROM users WHERE role = ?', ['user']) as any).c;
  const totalGames = (queryOne('SELECT COUNT(*) as c FROM game_records') as any).c;
  const todayGames = (queryOne("SELECT COUNT(*) as c FROM game_records WHERE date(created_at) = date('now', 'localtime')") as any).c;
  const activeUsers7d = (queryOne("SELECT COUNT(DISTINCT winner_id) as c FROM game_records WHERE created_at >= datetime('now', '-7 days', 'localtime')") as any).c;

  // 游戏热度（按对局数排序）
  const gameStats = queryAll(
    `SELECT game_type, COUNT(*) as play_count,
            AVG(duration_sec) as avg_duration
     FROM game_records GROUP BY game_type ORDER BY play_count DESC`
  );

  // 近 7 天每日对局趋势
  const dailyGames = queryAll(
    `SELECT date(created_at) as day, COUNT(*) as count
     FROM game_records WHERE created_at >= datetime('now', '-7 days', 'localtime')
     GROUP BY date(created_at) ORDER BY day`
  );

  // 高分玩家（胜局数 Top 10）
  const topPlayers = queryAll(
    `SELECT id, username, total_games, win_games,
            CAST(win_games AS REAL) / MAX(total_games, 1) as win_rate
     FROM users WHERE role = 'user' AND total_games > 0
     ORDER BY win_games DESC LIMIT 10`
  );

  // 空闲类型分布
  const idleStats = queryAll(
    `SELECT idle_type, COUNT(*) as count FROM room_logs
     WHERE idle_type IS NOT NULL GROUP BY idle_type ORDER BY idle_type`
  );

  // 用户性别分布
  const genders = queryAll(
    `SELECT CASE WHEN gender = 'male' THEN '男' WHEN gender = 'female' THEN '女' ELSE '未设置' END as name, COUNT(*) as value
     FROM users WHERE role = 'user' GROUP BY gender`
  );

  // 用户年龄分布
  const ageGroups = queryAll(
    `SELECT
       CASE
         WHEN CAST((julianday('now') - julianday(birth_date)) / 365.25 AS INTEGER) < 18 THEN '18岁以下'
         WHEN CAST((julianday('now') - julianday(birth_date)) / 365.25 AS INTEGER) < 25 THEN '18-24岁'
         WHEN CAST((julianday('now') - julianday(birth_date)) / 365.25 AS INTEGER) < 35 THEN '25-34岁'
         WHEN CAST((julianday('now') - julianday(birth_date)) / 365.25 AS INTEGER) < 45 THEN '35-44岁'
         ELSE '45岁以上'
       END as name, COUNT(*) as value
     FROM users WHERE role = 'user' AND birth_date IS NOT NULL AND birth_date != ''
     GROUP BY name ORDER BY name`
  );
  const unknownAge = (queryOne("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND (birth_date IS NULL OR birth_date = '')") as any).c;

  res.json({
    overview: { totalUsers, totalGames, todayGames, activeUsers7d },
    gameStats,
    dailyGames,
    topPlayers,
    idleStats,
    demographics: { genders, ageGroups, unknownAge },
  });
});

export default router;
