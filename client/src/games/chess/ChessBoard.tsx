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

const ROWS = 8;
const COLS = 8;

const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  king:   { white: '♔', black: '♚' },
  queen:  { white: '♕', black: '♛' },
  rook:   { white: '♖', black: '♜' },
  bishop: { white: '♗', black: '♝' },
  knight: { white: '♘', black: '♞' },
  pawn:   { white: '♙', black: '♟' },
};

function parsePiece(s: string | null): { type: string; color: string } | null {
  if (!s) return null;
  const color = s.startsWith('white_') ? 'white' : 'black';
  const type = s.replace('white_', '').replace('black_', '');
  return { type, color };
}

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';
const SELECTED_COLOR = 'rgba(220,179,92,0.55)';
const VALID_MOVE_COLOR = 'rgba(0,0,0,0.15)';
const LAST_MOVE_COLOR = 'rgba(155,199,0,0.41)';

export default function ChessBoard({
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
      const target = board[move.row]?.[move.col];
      if (target) {
        // 吃子位置：空心圆环
        ctx.strokeStyle = VALID_MOVE_COLOR;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, cellSize * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // 空位：实心小圆点
        ctx.fillStyle = VALID_MOVE_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, cellSize * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── 棋子 ──
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = parsePiece(board[r]?.[c]);
        if (!piece) continue;
        const { x, y } = toCanvas(r, c);
        const symbol = PIECE_SYMBOLS[piece.type]?.[piece.color] || '?';

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.font = `${cellSize * 0.72}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, x + 1, y + 2);

        // 棋子
        ctx.fillStyle = piece.color === 'white' ? '#ffffff' : '#1a1a1a';
        ctx.fillText(symbol, x, y);

        // 白棋描边
        if (piece.color === 'white') {
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 0.5;
          ctx.strokeText(symbol, x, y);
        }
      }
    }

    // ── 悬停预览 ──
    if (hoverPos && isMyTurn && !board[hoverPos.row]?.[hoverPos.col]) {
      const { x, y } = toCanvas(hoverPos.row, hoverPos.col);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
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
