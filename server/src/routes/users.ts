import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/connection.js';

const router = Router();

/**
 * GET /api/users/:username/profile
 * 公开：用户公开资料 + 对局统计 + 游戏热度。
 * 不返回敏感字段（password_hash / birth_date / gender / hometown / occupation / hobbies / banned）。
 */
router.get('/:username/profile', (req: Request, res: Response) => {
  const { username } = req.params;
  const user = queryOne<{ username: string; nickname: string | null; created_at: string; last_online_at: string | null; total_online_seconds: number }>(
    'SELECT username, nickname, created_at, last_online_at, total_online_seconds FROM users WHERE username = ?',
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
