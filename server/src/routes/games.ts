import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute, uuid } from '../db/connection.js';

const router = Router();

/**
 * GET /api/games
 * 公开：获取所有已启用的游戏列表（大厅用）。
 */
router.get('/', (_req: Request, res: Response) => {
  const games = queryAll("SELECT * FROM games WHERE enabled = 1 AND status IN ('ready', 'developing') ORDER BY sort_order");
  res.json({ games });
});

/**
 * GET /api/games/all
 * 管理员：获取全部游戏列表。
 */
router.get('/all', (_req: Request, res: Response) => {
  const games = queryAll('SELECT * FROM games ORDER BY sort_order');
  res.json({ games });
});

/**
 * POST /api/games
 * 管理员：添加新游戏。
 */
router.post('/', (req: Request, res: Response) => {
  const { id, name, description, icon_svg, sort_order, status } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: 'id 和 name 不能为空' });
    return;
  }
  const existing = queryOne('SELECT id FROM games WHERE id = ?', [id]);
  if (existing) {
    res.status(409).json({ error: '游戏 ID 已存在' });
    return;
  }
  execute(
    'INSERT INTO games (id, name, description, icon_svg, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, description || '', icon_svg || '', sort_order || 0, status || 'developing']
  );
  const game = queryOne('SELECT * FROM games WHERE id = ?', [id]);
  res.json({ game });
});

/**
 * DELETE /api/games/:id
 * 管理员：删除游戏。
 */
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const game = queryOne('SELECT id FROM games WHERE id = ?', [id]);
  if (!game) {
    res.status(404).json({ error: '游戏不存在' });
    return;
  }
  execute('DELETE FROM games WHERE id = ?', [id]);
  res.json({ success: true });
});

/**
 * PUT /api/games/:id
 * 管理员：更新游戏信息（名称、描述、SVG、排序、状态）。
 */
router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const fields = ['name', 'description', 'icon_svg', 'sort_order', 'enabled', 'status'] as const;
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ error: '没有要更新的字段' });
    return;
  }

  values.push(id);
  execute(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, values);
  const game = queryOne('SELECT * FROM games WHERE id = ?', [id]);
  res.json({ game });
});

export default router;
