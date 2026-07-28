/**
 * PGN 棋谱分析 API
 *
 * 使用 chess.js 解析 PGN 为 UCI 走法，逐布调用 Fairy-Stockfish 评估。
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { Chess } from 'chess.js';

const router = Router();

router.post('/analyze', async (req, res) => {
  const pgn = req.body.pgn as string;
  if (!pgn) return res.status(400).json({ error: '请提供 PGN' });

  try {
    // 用 chess.js 解析 PGN 为 UCI 走法
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    if (history.length === 0) return res.status(400).json({ error: '未解析出有效走法' });

    const uciMoves = history.map(h => h.from + h.to);
    const sanMoves = history.map(h => h.san);
    const moveColors = history.map(h => h.color === 'w' ? 'white' : 'black');

    const results: { move: string; san: string; color: string; score: number | null; depth: number | null; pv: string | null }[] = [];

    // 启动 Fairy-Stockfish
    const exePath = path.resolve(process.cwd(), 'fairy-stockfish', 'fairy-stockfish_x86-64-modern.exe');
    const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], cwd: path.resolve(process.cwd(), 'fairy-stockfish') });

    let bestMoveResolve: ((response: string) => void) | null = null;
    let bestMoveTimer: NodeJS.Timeout | null = null;
    const waitForBestMove = (timeout = 30000): Promise<string> => new Promise((resolve, reject) => {
      bestMoveResolve = resolve;
      bestMoveTimer = setTimeout(() => { bestMoveResolve = null; reject(new Error('timeout')); }, timeout);
    });

    let buffer = '';
    let lastScore: number | null = null;
    let lastDepth: number | null = null;
    let lastPv: string | null = null;
    let currentSideToMove: 'white' | 'black' = 'white';

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const l = line.trim().replace(/\r/g, '');
        if (l.startsWith('info') && l.includes('score')) {
          const cpMatch = l.match(/score cp\s+(-?\d+)/);
          if (cpMatch) {
            const rawScore = parseInt(cpMatch[1], 10) / 100;
            // cp 评分从当前走子方角度，转为白方角度
            lastScore = currentSideToMove === 'white' ? rawScore : -rawScore;
          }
          const mateMatch = l.match(/score mate\s+(-?\d+)/);
          if (mateMatch) {
            const mateIn = parseInt(mateMatch[1], 10);
            // mate N: N>0 = 当前走子方将杀, N<0 = 当前走子方被将杀
            const isWhiteAdvantage = (currentSideToMove === 'white') === (mateIn > 0);
            lastScore = isWhiteAdvantage ? 5 : -5;
          }
          const depthMatch = l.match(/depth\s+(\d+)/);
          if (depthMatch) lastDepth = parseInt(depthMatch[1], 10);
          const pvMatch = l.match(/\bpv\s+((?:[a-z0-9]+\s*)+)/i);
          if (pvMatch) lastPv = pvMatch[1].trim();
        }
        if (l.startsWith('bestmove ') && bestMoveResolve) {
          if (bestMoveTimer) clearTimeout(bestMoveTimer);
          bestMoveResolve(l);
          bestMoveResolve = null;
        }
      }
    });

    const sendCmd = (cmd: string) => { proc.stdin?.write(cmd + '\n'); };

    // 等待 uciok
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('引擎初始化超时')), 15000);
      const handler = (data: Buffer) => {
        if (data.toString('utf-8').includes('uciok')) { clearTimeout(timeout); resolve(); }
      };
      proc.stdout?.on('data', handler);
      sendCmd('uci');
    });

    sendCmd('ucinewgame');

    // 逐布分析（用 UCI 坐标发送给引擎）
    let moveHistory: string[] = [];
    for (let i = 0; i < uciMoves.length; i++) {
      moveHistory.push(uciMoves[i]);
      // 走了 i+1 步后，偶数步数→白方走，奇数步数→黑方走
      currentSideToMove = (i + 1) % 2 === 0 ? 'white' : 'black';
      const posCmd = `position startpos moves ${moveHistory.join(' ')}`;
      sendCmd(posCmd);
      lastScore = null; lastDepth = null; lastPv = null;
      sendCmd('go movetime 500');
      try {
        await waitForBestMove(30000);
      } catch {}
      results.push({ move: uciMoves[i], san: sanMoves[i], color: moveColors[i], score: lastScore, depth: lastDepth, pv: lastPv });
    }

    sendCmd('quit');
    setTimeout(() => { try { proc.kill(); } catch {} }, 1000);

    // 计算 delta
    const scoredResults = results.map((r, i) => {
      const prevScore = i > 0 ? results[i - 1].score : null;
      let delta: number | null = null;
      if (r.score !== null && prevScore !== null) {
        delta = i % 2 === 0 ? r.score - prevScore : prevScore - r.score;
      }
      return { move: r.move, san: r.san, color: r.color, score: r.score, depth: r.depth, pv: r.pv, delta };
    });

    res.json({
      totalMoves: scoredResults.length,
      analysis: scoredResults,
      bestMove: scoredResults.reduce((best, r) => (r.delta !== null && (best.delta === null || r.delta > best.delta) ? r : best), scoredResults[0]),
      worstMove: scoredResults.reduce((worst, r) => (r.delta !== null && (worst.delta === null || r.delta < worst.delta) ? r : worst), scoredResults[0]),
    });

  } catch (err) {
    console.error('[PGN Analysis] 分析失败:', err);
    res.status(500).json({ error: '分析失败: ' + (err as Error).message });
  }
});

export default router;
