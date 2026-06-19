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

interface GomokuBoardProps {
  board: (string | null)[][];
  boardSize: number;
  lastMove: { row: number; col: number } | null;
  myColor: string | null;
  isMyTurn: boolean;
  onPlace: (row: number, col: number) => void;
  width?: number;
  height?: number;
}

const COLORS = {
  BOARD: '#e8d5a3',
  LINE: '#8b6914',
  BLACK: '#1a1a1a',
  WHITE: '#f5f5f5',
  LAST_MOVE: '#f44336',
};

export default function GomokuBoard({
  board, boardSize, lastMove, myColor, isMyTurn, onPlace, width = 500, height = 500,
}: GomokuBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ row: number; col: number } | null>(null);

  const padding = 30;
  const cellSize = Math.min(
    (width - padding * 2) / (boardSize - 1),
    (height - padding * 2) / (boardSize - 1),
  );
  const boardPixelW = cellSize * (boardSize - 1);
  const boardPixelH = cellSize * (boardSize - 1);
  const offsetX = (width - boardPixelW) / 2;
  const offsetY = (height - boardPixelH) / 2;

  const transformRow = useCallback((row: number) => {
    if (myColor === 'white') return boardSize - 1 - row;
    return row;
  }, [myColor, boardSize]);

  const transformCol = useCallback((col: number) => {
    if (myColor === 'white') return boardSize - 1 - col;
    return col;
  }, [myColor, boardSize]);

  const pixelToBoard = useCallback((px: number, py: number): { row: number; col: number } | null => {
    const col = Math.round((px - offsetX) / cellSize);
    const row = Math.round((py - offsetY) / cellSize);
    if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return null;
    const cx = offsetX + col * cellSize;
    const cy = offsetY + row * cellSize;
    if (Math.abs(px - cx) > cellSize * 0.45 || Math.abs(py - cy) > cellSize * 0.45) return null;
    return { row: transformRow(row), col: transformCol(col) };
  }, [cellSize, offsetX, offsetY, boardSize, transformRow, transformCol]);

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
      ctx.beginPath(); ctx.moveTo(offsetX, y); ctx.lineTo(offsetX + boardPixelW, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, offsetY); ctx.lineTo(x, offsetY + boardPixelH); ctx.stroke();
    }

    // 星位（五子棋：天元 + 四角星）
    const stars = getStarPositions(boardSize);
    for (const sp of stars) {
      const sx = offsetX + sp.col * cellSize;
      const sy = offsetY + sp.row * cellSize;
      ctx.fillStyle = COLORS.LINE;
      ctx.beginPath(); ctx.arc(sx, sy, cellSize * 0.08, 0, Math.PI * 2); ctx.fill();
    }

    // 坐标标签
    ctx.fillStyle = COLORS.LINE;
    ctx.font = `${Math.max(10, cellSize * 0.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < boardSize; i++) {
      const label = String.fromCharCode(65 + (myColor === 'white' ? boardSize - 1 - i : i));
      ctx.fillText(label, offsetX + i * cellSize, height - padding / 2);
      ctx.fillText(String(myColor === 'white' ? i + 1 : boardSize - i), padding / 2, offsetY + i * cellSize);
    }

    // 棋子
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const value = board[r]?.[c];
        if (!value) continue;
        const dr = transformRow(r);
        const dc = transformCol(c);
        const sx = offsetX + dc * cellSize;
        const sy = offsetY + dr * cellSize;
        const radius = cellSize * 0.43;

        ctx.beginPath();
        ctx.arc(sx + 1, sy + 1, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fill();

        const gradient = ctx.createRadialGradient(sx - radius * 0.3, sy - radius * 0.3, radius * 0.1, sx, sy, radius);
        if (value === 'black') {
          gradient.addColorStop(0, '#555'); gradient.addColorStop(1, '#1a1a1a');
        } else {
          gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#cccccc');
        }
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = value === 'black' ? '#000' : '#aaa';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // 最后一步标记
    if (lastMove) {
      const lr = transformRow(lastMove.row);
      const lc = transformCol(lastMove.col);
      const lx = offsetX + lc * cellSize;
      const ly = offsetY + lr * cellSize;
      ctx.fillStyle = COLORS.LAST_MOVE;
      ctx.beginPath(); ctx.arc(lx, ly, cellSize * 0.12, 0, Math.PI * 2); ctx.fill();
    }

    // 悬停预览
    if (hoverPos && isMyTurn) {
      const hr = transformRow(hoverPos.row);
      const hc = transformCol(hoverPos.col);
      const hx = offsetX + hc * cellSize;
      const hy = offsetY + hr * cellSize;
      if (!board[hoverPos.row]?.[hoverPos.col]) {
        ctx.beginPath();
        ctx.arc(hx, hy, cellSize * 0.43, 0, Math.PI * 2);
        ctx.fillStyle = myColor === 'black' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
    }
  }, [board, boardSize, lastMove, myColor, isMyTurn, cellSize, offsetX, offsetY, boardPixelW, boardPixelH, width, height, transformRow, transformCol]);

  useEffect(() => { draw(hoverRef.current); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverRef.current = pixelToBoard(e.clientX - rect.left, e.clientY - rect.top);
      draw(hoverRef.current);
    };
    const handleLeave = () => { hoverRef.current = null; draw(null); };
    const handleClick = (e: MouseEvent) => {
      if (!isMyTurn) return;
      const rect = canvas.getBoundingClientRect();
      const pos = pixelToBoard(e.clientX - rect.left, e.clientY - rect.top);
      if (pos) {
        const { row, col } = pos;
        if (!board[row]?.[col]) { playMoveSound(); onPlace(row, col); }
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

function getStarPositions(size: number): { row: number; col: number }[] {
  if (size === 19) {
    const s = [3, 9, 15];
    const stars: { row: number; col: number }[] = [];
    for (const r of s) for (const c of s) stars.push({ row: r, col: c });
    return stars;
  }
  if (size === 15) {
    return [
      { row: 3, col: 3 }, { row: 3, col: 7 }, { row: 3, col: 11 },
      { row: 7, col: 3 }, { row: 7, col: 7 }, { row: 7, col: 11 },
      { row: 11, col: 3 }, { row: 11, col: 7 }, { row: 11, col: 11 },
    ];
  }
  return [];
}
