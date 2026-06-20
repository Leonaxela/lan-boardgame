import { useEffect, useRef, useCallback } from 'react';

/** 落子音效 */
function playMoveSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch {}
}

interface GoBoardProps {
  board: (string | null)[][];
  boardSize: number;
  lastMove: { row: number; col: number } | null;
  myColor: string | null;   // 'black' | 'white' | null（观战）
  isMyTurn: boolean;
  onPlace: (row: number, col: number) => void;
  width?: number;
  height?: number;
  /** 手数显示：Map<"row,col", number>，传入则在棋子上显示手数 */
  moveNumbers?: Map<string, number> | null;
  /** 分析数据：候选走法 + 胜率 + 领地覆盖 */
  analysisData?: {
    winrate: number;
    scoreLead: number;
    topMoves: Array<{ row: number; col: number; winrate: number; scoreLead: number }>;
    ownership: number[][];
  } | null;
  /** 回看模式下禁止点击 */
  replayMode?: boolean;
}

const COLORS = {
  BOARD: '#dcb35c',
  LINE: '#5a3e0a',
  STAR: '#5a3e0a',
  WHITE_STONE: '#f5f5f5',
  BLACK_STONE: '#1a1a1a',
  LAST_MOVE: '#f44336',
  HOVER: 'rgba(0,0,0,0.3)',
  LABEL: '#5a3e0a',
  BG: '#c89d3c',
};

export default function GoBoard({
  board, boardSize, lastMove, myColor, isMyTurn, onPlace, width = 500, height = 500, moveNumbers = null,
  analysisData = null, replayMode = false,
}: GoBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ row: number; col: number } | null>(null);
  const animRef = useRef<number>(0);

  // 计算布局参数
  const padding = 30;
  const cellSize = Math.max(10, Math.min(
    (width - padding * 2) / (boardSize - 1),
    (height - padding * 2) / (boardSize - 1),
  ));
  const boardPixelW = cellSize * (boardSize - 1);
  const boardPixelH = cellSize * (boardSize - 1);
  const offsetX = (width - boardPixelW) / 2;
  const offsetY = (height - boardPixelH) / 2;

  // 坐标转换（考虑视角反转）
  const transformRow = useCallback((row: number) => {
    if (myColor === 'white') return boardSize - 1 - row;
    return row;
  }, [myColor, boardSize]);

  const transformCol = useCallback((col: number) => {
    if (myColor === 'white') return boardSize - 1 - col;
    return col;
  }, [myColor, boardSize]);

  // 像素 ↔ 棋盘坐标
  const pixelToBoard = useCallback((px: number, py: number): { row: number; col: number } | null => {
    const col = Math.round((px - offsetX) / cellSize);
    const row = Math.round((py - offsetY) / cellSize);
    if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return null;
    // 检查点击是否靠近交叉点（容忍半个格子）
    const cx = offsetX + col * cellSize;
    const cy = offsetY + row * cellSize;
    if (Math.abs(px - cx) > cellSize * 0.45 || Math.abs(py - cy) > cellSize * 0.45) return null;
    return { row: transformRow(row), col: transformCol(col) };
  }, [cellSize, offsetX, offsetY, boardSize, transformRow, transformCol]);

  // 渲染
  const draw = useCallback((hoverPos: { row: number; col: number } | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // 棋盘背景
    ctx.fillStyle = COLORS.BOARD;
    ctx.fillRect(0, 0, width, height);

    // 网格线
    ctx.strokeStyle = COLORS.LINE;
    ctx.lineWidth = 1;
    for (let i = 0; i < boardSize; i++) {
      const x = offsetX + i * cellSize;
      const y = offsetY + i * cellSize;

      // 横线
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + boardPixelW, y);
      ctx.stroke();

      // 竖线
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + boardPixelH);
      ctx.stroke();
    }

    // 星位
    const starPoints = getStarPositions(boardSize);
    for (const sp of starPoints) {
      const sx = offsetX + sp.col * cellSize;
      const sy = offsetY + sp.row * cellSize;
      ctx.fillStyle = COLORS.STAR;
      ctx.beginPath();
      ctx.arc(sx, sy, cellSize * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    // 坐标标签 (Go 坐标跳过 I)
    const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';
    ctx.fillStyle = COLORS.LABEL;
    ctx.font = `${Math.max(10, cellSize * 0.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < boardSize; i++) {
      // 底部列标签
      const labelIdx = myColor === 'white' ? boardSize - 1 - i : i;
      const label = GTP_COLS[labelIdx] ?? '?';
      ctx.fillText(label, offsetX + i * cellSize, height - padding / 2);
      // 左侧行标签
      const rowLabel = String(myColor === 'white' ? i + 1 : boardSize - i);
      ctx.fillText(rowLabel, padding / 2, offsetY + i * cellSize);
    }

    // 棋子
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const displayR = transformRow(r);
        const displayC = transformCol(c);
        const value = board[r]?.[c];
        if (!value) continue;

        const sx = offsetX + displayC * cellSize;
        const sy = offsetY + displayR * cellSize;
        const radius = cellSize * 0.43;

        // 棋子阴影
        ctx.beginPath();
        ctx.arc(sx + 1, sy + 1, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fill();

        // 棋子本体
        const gradient = ctx.createRadialGradient(sx - radius * 0.3, sy - radius * 0.3, radius * 0.1, sx, sy, radius);
        if (value === 'black') {
          gradient.addColorStop(0, '#555');
          gradient.addColorStop(1, '#1a1a1a');
        } else {
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(1, '#cccccc');
        }
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = value === 'black' ? '#000' : '#aaa';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // 显示手数
        if (moveNumbers) {
          const num = moveNumbers.get(`${r},${c}`);
          if (num !== undefined) {
            ctx.fillStyle = value === 'black' ? '#fff' : '#000';
            ctx.font = `bold ${Math.max(10, radius * 0.9)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), sx, sy);
          }
        }
      }
    }

    // 最后一步标记
    if (lastMove) {
      const lr = transformRow(lastMove.row);
      const lc = transformCol(lastMove.col);
      const lx = offsetX + lc * cellSize;
      const ly = offsetY + lr * cellSize;
      const stone = board[lastMove.row]?.[lastMove.col];
      ctx.fillStyle = stone === 'black' ? '#fff' : '#f44336';
      ctx.beginPath();
      ctx.arc(lx, ly, cellSize * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // 分析数据：领地覆盖
    if (analysisData?.ownership?.length) {
      const { ownership } = analysisData;
      const ownBoardSize = ownership.length;
      for (let r = 0; r < ownBoardSize; r++) {
        for (let c = 0; c < ownBoardSize; c++) {
          const displayR = transformRow(r);
          const displayC = transformCol(c);
          const val = ownership[r]?.[c];
          if (val === undefined || board[r]?.[c]) continue; // 有棋子的位置不覆盖

          const sx = offsetX + displayC * cellSize;
          const sy = offsetY + displayR * cellSize;
          // val: -1(黑) ~ 1(白)，转成透明度
          const alpha = Math.min(Math.abs(val) * 0.6, 0.5);
          if (Math.abs(val) < 0.1) continue; // 不确定区域不画
          ctx.fillStyle = val > 0
            ? `rgba(255,255,255,${alpha})`   // 白方领地
            : `rgba(0,0,0,${alpha})`;         // 黑方领地
          ctx.fillRect(sx - cellSize / 2, sy - cellSize / 2, cellSize, cellSize);
        }
      }
    }

    // 分析数据：候选走法
    if (analysisData?.topMoves?.length) {
      const { topMoves } = analysisData;
      const bestWinrate = topMoves[0]?.winrate || 0;
      for (let i = 0; i < topMoves.length; i++) {
        const m = topMoves[i];
        const displayR = transformRow(m.row);
        const displayC = transformCol(m.col);
        const sx = offsetX + displayC * cellSize;
        const sy = offsetY + displayR * cellSize;
        const isEmpty = !board[m.row]?.[m.col];
        if (!isEmpty) continue; // 有棋子的位置不画候选点

        // 画空心圆
        const radius = cellSize * 0.35;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        // 颜色根据胜率：绿(高) → 黄(中) → 红(低)
        const ratio = bestWinrate > 0 ? Math.min(m.winrate / bestWinrate, 1) : 0.5;
        const green = Math.min(Math.floor(ratio * 200 + 55), 255);
        const red = Math.min(Math.floor((1 - ratio) * 200 + 55), 255);
        ctx.strokeStyle = `rgb(${red},${green},80)`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 胜率文字
        const pct = (m.winrate * 100).toFixed(0);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(9, cellSize * 0.28)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        ctx.fillText(`${pct}%`, sx, sy + radius + cellSize * 0.3);
        ctx.shadowBlur = 0;
      }
    }

    // 悬停预览
    if (hoverPos && isMyTurn) {
      const hr = transformRow(hoverPos.row);
      const hc = transformCol(hoverPos.col);
      const hx = offsetX + hc * cellSize;
      const hy = offsetY + hr * cellSize;
      const isEmpty = !board[hoverPos.row]?.[hoverPos.col];

      if (isEmpty) {
        ctx.beginPath();
        ctx.arc(hx, hy, cellSize * 0.43, 0, Math.PI * 2);
        ctx.fillStyle = myColor === 'black' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.4)';
        ctx.fill();
      }
    }
  }, [board, boardSize, lastMove, myColor, isMyTurn, cellSize, offsetX, offsetY, boardPixelW, boardPixelH, width, height, transformRow, transformCol, analysisData]);

  // 首次渲染 + 每帧动画
  useEffect(() => {
    draw(hoverRef.current);
  }, [draw]);

  // 鼠标事件
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = pixelToBoard(e.clientX - rect.left, e.clientY - rect.top);
      hoverRef.current = pos;
      draw(pos);
    };

    const handleLeave = () => {
      hoverRef.current = null;
      draw(null);
    };

    const handleClick = (e: MouseEvent) => {
      if (!isMyTurn || replayMode) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const pos = pixelToBoard(px, py);
      console.log(`[GoBoard click] px=${px.toFixed(1)} py=${py.toFixed(1)} canvas=${width}x${height} cellSize=${cellSize.toFixed(2)} offsetX=${offsetX.toFixed(2)} → col=${pos?.col} row=${pos?.row}`);
      if (pos) {
        const { row, col } = pos;
        if (!board[row]?.[col]) {
          playMoveSound();
          onPlace(row, col);
        }
      }
    };

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', handleLeave);
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('mouseleave', handleLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [board, isMyTurn, onPlace, pixelToBoard, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ borderRadius: 8, cursor: isMyTurn ? 'pointer' : 'default' }}
    />
  );
}

/** 获取星位 */
function getStarPositions(size: number): { row: number; col: number }[] {
  if (size === 19) {
    const s = [3, 9, 15];
    const stars: { row: number; col: number }[] = [];
    for (const r of s) for (const c of s) stars.push({ row: r, col: c });
    return stars;
  }
  if (size === 13) {
    const s = [3, 6, 9];
    const stars: { row: number; col: number }[] = [];
    for (const r of s) for (const c of s) stars.push({ row: r, col: c });
    return stars;
  }
  return [
    { row: 2, col: 2 }, { row: 2, col: 6 },
    { row: 4, col: 4 },
    { row: 6, col: 2 }, { row: 6, col: 6 },
  ];
}
