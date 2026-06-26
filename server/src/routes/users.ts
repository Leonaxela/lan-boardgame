import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../db/connection.js';
import { authenticate } from '../middleware/auth.js';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVATAR_DIR = join(__dirname, '..', '..', 'data', 'avatars');
const MAX_AVATAR_BYTES = 512 * 1024; // base64 解码后上限 512KB

const router = Router();

/**
 * GET /api/users/:username/profile
 * 公开：用户公开资料 + 对局统计 + 游戏热度。
 * 不返回敏感字段（password_hash / birth_date / gender / hometown / occupation / hobbies / banned）。
 */
router.get('/:username/profile', (req: Request, res: Response) => {
  const { username } = req.params;
  const user = queryOne<{ username: string; nickname: string | null; avatar_path: string | null; avatar_status: string; created_at: string; last_online_at: string | null; total_online_seconds: number }>(
    'SELECT username, nickname, avatar_path, avatar_status, created_at, last_online_at, total_online_seconds FROM users WHERE username = ?',
    [username]
  );
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  // ── 对局统计：从 game_records 重新统计，比 users.total_games 更可靠 ──
  // 该用户参与的对局（排除 AI 接管的空壳）
  const totalRow = queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM game_records gr
     WHERE EXISTS (
       SELECT 1 FROM json_each(gr.players) je
       WHERE je.value->>'name' = ? AND je.value->>'id' NOT LIKE 'ai-%'
     )`,
    [username]
  );
  const totalGames = totalRow?.c ?? 0;

  // 胜局：winner_id 等于该用户在 players 中的 id
  const winRow = queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM game_records gr, json_each(gr.players) je
     WHERE je.value->>'name' = ? AND je.value->>'id' = gr.winner_id`,
    [username]
  );
  const winGames = winRow?.c ?? 0;

  // 输局 = 总局数 - 胜局 - 平局；平局 = winner_id 为空的对局
  const drawRow = queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM game_records gr
     WHERE (gr.winner_id IS NULL OR gr.winner_id = '')
     AND EXISTS (
       SELECT 1 FROM json_each(gr.players) je
       WHERE je.value->>'name' = ? AND je.value->>'id' NOT LIKE 'ai-%'
     )`,
    [username]
  );
  const drawGames = drawRow?.c ?? 0;
  const lossGames = Math.max(0, totalGames - winGames - drawGames);
  const winRate = totalGames > 0 ? Math.round((winGames / totalGames) * 100) : 0;

  // ── 游戏热度：各 game_type 对局数 ──
  const heatByGame = queryAll<{ game_type: string; count: number; wins: number }>(
    `SELECT gr.game_type,
            COUNT(*) as count,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM json_each(gr.players) je2
              WHERE je2.value->>'name' = ? AND je2.value->>'id' = gr.winner_id
            ) THEN 1 ELSE 0 END) as wins
     FROM game_records gr
     WHERE EXISTS (
       SELECT 1 FROM json_each(gr.players) je
       WHERE je.value->>'name' = ? AND je.value->>'id' NOT LIKE 'ai-%'
     )
     GROUP BY gr.game_type
     ORDER BY count DESC`,
    [username, username]
  );

  res.json({
    user: {
      username: user.username,
      nickname: user.nickname || user.username,
      avatarPath: user.avatar_path || null,
      avatarStatus: user.avatar_status || 'approved',
      createdAt: user.created_at,
      lastOnlineAt: user.last_online_at,
      totalOnlineSeconds: user.total_online_seconds || 0,
    },
    stats: {
      totalGames,
      winGames,
      lossGames,
      drawGames,
      winRate,
    },
    heatByGame,
  });
});

/**
 * GET /api/users/:username/records?page=1&limit=10
 * 公开：该用户参与的对局列表（分页），每条标注该用户胜负。
 * 返回轻量字段（不含 moves/sgf/pgn/pdn）。
 */
router.get('/:username/records', (req: Request, res: Response) => {
  const { username } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const offset = (page - 1) * limit;

  const user = queryOne<{ username: string }>('SELECT username FROM users WHERE username = ?', [username]);
  if (!user) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }

  const totalRow = queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM game_records gr
     WHERE EXISTS (
       SELECT 1 FROM json_each(gr.players) je
       WHERE je.value->>'name' = ? AND je.value->>'id' NOT LIKE 'ai-%'
     )`,
    [username]
  );
  const total = totalRow?.c ?? 0;

  const records = queryAll<any>(
    `SELECT gr.id, gr.game_type, gr.board_size, gr.players, gr.winner_id, gr.reason, gr.scores, gr.difficulty, gr.created_at, gr.duration_sec
     FROM game_records gr
     WHERE EXISTS (
       SELECT 1 FROM json_each(gr.players) je
       WHERE je.value->>'name' = ? AND je.value->>'id' NOT LIKE 'ai-%'
     )
     ORDER BY gr.created_at DESC
     LIMIT ? OFFSET ?`,
    [username, limit, offset]
  );

  // 标注该用户在每局中的结果
  const enriched = records.map((r: any) => {
    let players: any[] = [];
    try { players = JSON.parse(r.players); } catch {}
    const me = players.find((p: any) => p.name === username && !String(p.id).startsWith('ai-'));
    const opponent = players.find((p: any) => p.name !== username);
    const isWinner = me && r.winner_id === me.id;
    const isDraw = !r.winner_id;
    return {
      id: r.id,
      gameType: r.game_type,
      boardSize: r.board_size,
      opponent: opponent ? opponent.name : '—',
      myColor: me?.color || '',
      result: isWinner ? 'win' : (isDraw ? 'draw' : 'loss'),
      reason: r.reason,
      difficulty: r.difficulty,
      createdAt: r.created_at,
      durationSec: r.duration_sec,
    };
  });

  res.json({
    records: enriched,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;

// ══════════════════════════════════════════════
//  头像上传（认证后只能改自己的头像）
// ══════════════════════════════════════════════

/**
 * POST /api/users/avatar
 * body: { avatar: "<data URI 或纯 base64>" }
 * 前端压缩成 128x128 JPEG/PNG 后上传，base64 解码写文件，DB 只存文件名。
 */
router.post('/avatar', authenticate, (req: Request, res: Response) => {
  const me = (req as any).user;
  if (!me?.username) { res.status(401).json({ error: '未登录' }); return; }

  // 检查头像权限是否被锁定
  const userRow = queryOne<{ avatar_status: string }>('SELECT avatar_status FROM users WHERE username = ?', [me.username]);
  if (userRow?.avatar_status === 'locked') {
    res.status(403).json({ error: '头像权限已被锁定，无法修改' });
    return;
  }

  const { avatar } = req.body as { avatar?: string };
  if (!avatar || typeof avatar !== 'string') {
    res.status(400).json({ error: '缺少头像数据' });
    return;
  }

  // 解析 data URI 或纯 base64
  const m = avatar.match(/^data:image\/(\w+);base64,(.+)$/);
  const ext = m ? m[1] : 'png';
  const b64 = m ? m[2] : avatar.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
    res.status(400).json({ error: '头像数据格式错误' });
    return;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    res.status(400).json({ error: 'base64 解码失败' });
    return;
  }
  if (buf.length === 0) { res.status(400).json({ error: '头像为空' }); return; }
  if (buf.length > MAX_AVATAR_BYTES) {
    res.status(400).json({ error: `头像过大（${Math.round(buf.length / 1024)}KB），请压缩到 512KB 以内` });
    return;
  }

  // 仅允许 png/jpeg/webp
  const safeExt = ['png', 'jpeg', 'jpg', 'webp'].includes(ext) ? ext.replace('jpeg', 'jpg') : 'png';

  // 确保目录存在
  mkdirSync(AVATAR_DIR, { recursive: true });

  // 用 username 作文件名，避免重复上传堆积
  const filename = `${me.username}.${safeExt}`;
  const filepath = join(AVATAR_DIR, filename);

  // 先查旧文件名（可能扩展名不同），删掉
  const oldRow = queryOne<{ avatar_path: string | null }>('SELECT avatar_path FROM users WHERE username = ?', [me.username]);
  if (oldRow?.avatar_path && oldRow.avatar_path !== filename) {
    const oldPath = join(AVATAR_DIR, oldRow.avatar_path);
    try { if (existsSync(oldPath)) unlinkSync(oldPath); } catch {}
  }

  try {
    writeFileSync(filepath, buf);
  } catch (e) {
    res.status(500).json({ error: '写入头像文件失败' });
    return;
  }

  execute('UPDATE users SET avatar_path = ? WHERE username = ?', [filename, me.username]);

  res.json({ success: true, avatarPath: filename });
});
