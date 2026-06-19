import { useEffect, useRef, useCallback, useState } from 'react';

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

interface Piece {
  type: string;
  color: string;
}

interface Props {
  board: (string | null)[][];
  selectedPos: { row: number; col: number } | null;
  validMoves: { row: number; col: number }[];
  lastMoveFrom?: { row: number; col: number } | null;
  lastMoveTo?: { row: number; col: number } | null;
  myColor: string | null;
  isMyTurn: boolean;
  onSelect: (row: number, col: number) => void;
  width?: number;
  height?: number;
}

const ROWS = 10;
const COLS = 9;

const PIECE_NAMES: Record<string, Record<string, string>> = {
  king: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  bishop: { red: '相', black: '象' },
  knight: { red: '馬', black: '马' },
  rook: { red: '車', black: '车' },
  cannon: { red: '砲', black: '炮' },
  pawn: { red: '兵', black: '卒' },
};

function parsePiece(s: string | null): Piece | null {
  if (!s) return null;
  const color = s.startsWith('red_') ? 'red' : 'black';
  const type = s.replace('red_', '').replace('black_', '');
  return { type, color };
}

export default function ChineseChessBoard({
  board, selectedPos, validMoves, lastMoveFrom, lastMoveTo, myColor, isMyTurn, onSelect,
  width = 540, height = 600,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPos, setHoverPos] = useState<{ row: number; col: number } | null>(null);

  const padX = 40;
  const padY = 40;
  const cellW = (width - padX * 2) / (COLS - 1);
  const cellH = (height - padY * 2) / (ROWS - 1);
  const pieceR = Math.min(cellW, cellH) * 0.42;

  const toCanvas = useCallback((row: number, col: number) => ({
    x: padX + col * cellW,
    y: padY + row * cellH,
  }), [cellW, cellH]);

  const fromCanvas = useCallback((px: number, py: number): { row: number; col: number } | null => {
    const col = Math.round((px - padX) / cellW);
    const row = Math.round((py - padY) / cellH);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    const { x, y } = toCanvas(row, col);
    if (Math.abs(px - x) > cellW * 0.45 || Math.abs(py - y) > cellH * 0.45) return null;
    return { row, col };
  }, [cellW, cellH, toCanvas]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── 背景 ──
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#e8c98a');
    grad.addColorStop(0.5, '#d4a854');
    grad.addColorStop(1, '#c49a3c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // ── 木纹效果 ──
    ctx.strokeStyle = 'rgba(139,105,20,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < height; i += 3) {
      ctx.beginPath();
      ctx.moveTo(0, i + Math.sin(i * 0.02) * 2);
      ctx.lineTo(width, i + Math.sin(i * 0.02 + 1) * 2);
      ctx.stroke();
    }

    // ── 棋盘线 ──
    ctx.strokeStyle = '#5a3e0a';
    ctx.lineWidth = 1.5;

    // 横线
    for (let r = 0; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(padX, padY + r * cellH);
      ctx.lineTo(padX + (COLS - 1) * cellW, padY + r * cellH);
      ctx.stroke();
    }

    // 竖线（左右两边到河界断开）
    for (let c = 0; c < COLS; c++) {
      if (c === 0 || c === COLS - 1) {
        // 边线贯通
        ctx.beginPath();
        ctx.moveTo(padX + c * cellW, padY);
        ctx.lineTo(padX + c * cellW, padY + (ROWS - 1) * cellH);
        ctx.stroke();
      } else {
        // 上半
        ctx.beginPath();
        ctx.moveTo(padX + c * cellW, padY);
        ctx.lineTo(padX + c * cellW, padY + 4 * cellH);
        ctx.stroke();
        // 下半
        ctx.beginPath();
        ctx.moveTo(padX + c * cellW, padY + 5 * cellH);
        ctx.lineTo(padX + c * cellW, padY + 9 * cellH);
        ctx.stroke();
      }
    }

    // ── 九宫格斜线 ──
    ctx.lineWidth = 1.2;
    // 黑方九宫
    ctx.beginPath();
    ctx.moveTo(padX + 3 * cellW, padY); ctx.lineTo(padX + 5 * cellW, padY + 2 * cellH);
    ctx.moveTo(padX + 5 * cellW, padY); ctx.lineTo(padX + 3 * cellW, padY + 2 * cellH);
    ctx.stroke();
    // 红方九宫
    ctx.beginPath();
    ctx.moveTo(padX + 3 * cellW, padY + 7 * cellH); ctx.lineTo(padX + 5 * cellW, padY + 9 * cellH);
    ctx.moveTo(padX + 5 * cellW, padY + 7 * cellH); ctx.lineTo(padX + 3 * cellW, padY + 9 * cellH);
    ctx.stroke();

    // ── 楚河汉界 ──
    ctx.fillStyle = '#5a3e0a';
    ctx.font = `bold ${Math.round(cellH * 0.4)}px "KaiTi", "STKaiti", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = padY + 4.5 * cellH;
    ctx.fillText('楚  河', padX + 2 * cellW, riverY);
    ctx.fillText('汉  界', padX + 6 * cellW, riverY);

    // ── 外框加粗 ──
    ctx.strokeStyle = '#5a3e0a';
    ctx.lineWidth = 3;
    ctx.strokeRect(padX - 2, padY - 2, (COLS - 1) * cellW + 4, (ROWS - 1) * cellH + 4);

    // ── 选中高亮：虚线圆 ──
    if (selectedPos) {
      const { x, y } = toCanvas(selectedPos.row, selectedPos.col);
      ctx.strokeStyle = '#dcb35c';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(x, y, pieceR + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── 上一步走法轨迹：原位白色虚线圆 + 新位绿色四角 ──
    if (lastMoveFrom) {
      const { x, y } = toCanvas(lastMoveFrom.row, lastMoveFrom.col);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(x, y, pieceR + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (lastMoveTo) {
      const { x, y } = toCanvas(lastMoveTo.row, lastMoveTo.col);
      const s = pieceR + 4;
      const cornerLen = pieceR * 0.3;
      ctx.strokeStyle = '#4caf50';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x - s, y - s + cornerLen); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + cornerLen, y - s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s - cornerLen, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + cornerLen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - s, y + s - cornerLen); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s + cornerLen, y + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s - cornerLen, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s, y + s - cornerLen); ctx.stroke();
    }

    // ── 棋子 ──
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = parsePiece(board[r]?.[c]);
        if (!piece) continue;
        const { x, y } = toCanvas(r, c);

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.arc(x + 2, y + 3, pieceR, 0, Math.PI * 2);
        ctx.fill();

        // 棋子底色
        const isRed = piece.color === 'red';
        const grad2 = ctx.createRadialGradient(x - pieceR * 0.3, y - pieceR * 0.3, pieceR * 0.1, x, y, pieceR);
        grad2.addColorStop(0, isRed ? '#fff5f5' : '#f5f5f5');
        grad2.addColorStop(1, isRed ? '#e8d0c0' : '#d0d0d0');
        ctx.fillStyle = grad2;
        ctx.beginPath();
        ctx.arc(x, y, pieceR, 0, Math.PI * 2);
        ctx.fill();

        // 边框
        ctx.strokeStyle = isRed ? '#c0392b' : '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, pieceR, 0, Math.PI * 2);
        ctx.stroke();

        // 内圈
        ctx.strokeStyle = isRed ? 'rgba(192,57,43,0.3)' : 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, pieceR * 0.82, 0, Math.PI * 2);
        ctx.stroke();

        // 文字
        const name = PIECE_NAMES[piece.type]?.[piece.color] || '?';
        ctx.fillStyle = isRed ? '#c0392b' : '#1a1a1a';
        ctx.font = `bold ${Math.round(pieceR * 1.1)}px "KaiTi", "STKaiti", "SimSun", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x, y + 1);
      }
    }
  }, [board, selectedPos, validMoves, width, height, cellW, cellH, pieceR, toCanvas]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = fromCanvas(e.clientX - rect.left, e.clientY - rect.top);
      setHoverPos(pos);
    };
    const handleLeave = () => setHoverPos(null);
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = fromCanvas(e.clientX - rect.left, e.clientY - rect.top);
      if (pos) { playMoveSound(); onSelect(pos.row, pos.col); }
    };
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', handleLeave);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('mouseleave', handleLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [fromCanvas, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ borderRadius: 8, cursor: isMyTurn ? 'pointer' : 'default' }}
    />
  );
}
