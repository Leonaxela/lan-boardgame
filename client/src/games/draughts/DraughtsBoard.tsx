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
const COLS = 10;

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';
const SELECTED_COLOR = 'rgba(220,179,92,0.55)';
const VALID_MOVE_COLOR = 'rgba(0,0,0,0.15)';
const LAST_MOVE_COLOR = 'rgba(155,199,0,0.41)';

function parsePiece(s: string | null): { type: string; color: string } | null {
  if (!s) return null;
  const color = s.startsWith('white_') ? 'white' : 'black';
  const type = s.replace('white_', '').replace('black_', '');
  return { type, color };
}

function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export default function DraughtsBoard({
  board, selectedPos, validMoves, lastMoveFrom, lastMoveTo, myColor, isMyTurn, onSelect,
  width = 560, height = 560,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPos, setHoverPos] = useState<{ row: number; col: number } | null>(null);

  const padding = 30;
  const cellSize = Math.min(
    (width - padding * 2) / (COLS - 1),
    (height - padding * 2) / (ROWS - 1),
  );
  const boardPx = cellSize * (COLS - 1);
  const offsetX = (width - boardPx) / 2;
  const offsetY = (height - boardPx) / 2;

  const transformRow = useCallback((row: number) => {
    if (myColor === 'black') return ROWS - 1 - row;
    return row;
  }, [myColor]);

  const transformCol = useCallback((col: number) => {
    if (myColor === 'black') return COLS - 1 - col;
    return col;
  }, [myColor]);

  const fromCanvas = useCallback((px: number, py: number): { row: number; col: number } | null => {
    const col = Math.round((px - offsetX) / cellSize);
    const row = Math.round((py - offsetY) / cellSize);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    const cx = offsetX + col * cellSize;
    const cy = offsetY + row * cellSize;
    if (Math.abs(px - cx) > cellSize * 0.48 || Math.abs(py - cy) > cellSize * 0.48) return null;
    return { row: transformRow(row), col: transformCol(col) };
  }, [cellSize, offsetX, offsetY, transformRow, transformCol]);

  const toCanvas = useCallback((row: number, col: number) => {
    const tr = transformRow(row);
    const tc = transformCol(col);
    return { x: offsetX + tc * cellSize, y: offsetY + tr * cellSize };
  }, [cellSize, offsetX, offsetY, transformRow, transformCol]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // ── 棋盘格子 ──
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = offsetX + c * cellSize;
        const y = offsetY + r * cellSize;
        const isLight = (r + c) % 2 === 0;
        ctx.fillStyle = isLight ? LIGHT_SQ : DARK_SQ;
        ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
      }
    }

    // ── 上一步走法高亮 ──
    if (lastMoveFrom) {
      const { x, y } = toCanvas(lastMoveFrom.row, lastMoveFrom.col);
      ctx.fillStyle = LAST_MOVE_COLOR;
      ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
    }
    if (lastMoveTo) {
      const { x, y } = toCanvas(lastMoveTo.row, lastMoveTo.col);
      ctx.fillStyle = LAST_MOVE_COLOR;
      ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
    }

    // ── 选中高亮 ──
    if (selectedPos) {
      const { x, y } = toCanvas(selectedPos.row, selectedPos.col);
      ctx.fillStyle = SELECTED_COLOR;
      ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
    }

    // ── 合法走法提示点 ──
    for (const move of validMoves) {
      const { x, y } = toCanvas(move.row, move.col);
      ctx.fillStyle = VALID_MOVE_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, cellSize * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 棋子 ──
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = parsePiece(board[r]?.[c]);
        if (!piece) continue;
        if (!isDarkSquare(r, c)) continue;
        const { x, y } = toCanvas(r, c);
        const radius = cellSize * 0.38;
        const isKing = piece.type === 'king';
        const isWhite = piece.color === 'white';

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.arc(x + 1, y + 2, radius, 0, Math.PI * 2);
        ctx.fill();

        // 棋子底色
        const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
        if (isWhite) {
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(1, '#cccccc');
        } else {
          grad.addColorStop(0, '#555555');
          grad.addColorStop(1, '#1a1a1a');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 边框
        ctx.strokeStyle = isWhite ? '#999' : '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // 王的标记（皇冠）
        if (isKing) {
          ctx.fillStyle = isWhite ? '#d4a854' : '#dcb35c';
          ctx.font = `bold ${Math.round(radius * 0.8)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('♛', x, y + 1);
        }
      }
    }
  }, [board, selectedPos, validMoves, lastMoveFrom, lastMoveTo, myColor, isMyTurn, cellSize, offsetX, offsetY, width, height, hoverPos, toCanvas]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      setHoverPos(fromCanvas(e.clientX - rect.left, e.clientY - rect.top));
    };
    const handleLeave = () => setHoverPos(null);
    const handleClick = (e: MouseEvent) => {
      if (!isMyTurn) return;
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
  }, [fromCanvas, isMyTurn, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ borderRadius: 8, cursor: isMyTurn ? 'pointer' : 'default' }}
    />
  );
}
