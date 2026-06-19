import { Router, Request, Response } from 'express';
import { listSgfFiles, loadSgf } from '../sgf/parser.js';

const router = Router();

/**
 * GET /api/sgf/list
 * SGF 棋谱列表。
 */
router.get('/list', (_req: Request, res: Response) => {
  try {
    const list = listSgfFiles();
    res.json({ files: list });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sgf/:id
 * 加载单个棋谱详情（含全部走棋）。
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const info = loadSgf(req.params.id);
    res.json({ sgf: info });
  } catch (e: any) {
    res.status(404).json({ error: '棋谱未找到' });
  }
});

export default router;
