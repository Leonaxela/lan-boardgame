import { useEffect, useRef, useCallback, useState } from 'react';
import { playMoveSound } from '../../utils/sound';

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

/** 内部类型 → SVG 文件名后缀 */
const PIECE_FILE: Record<string, string> = {
  king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P',
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
const VALID_MOVE_COLOR = 'rgba(76,175,80,0.5)';
const LAST_MOVE_COLOR = 'rgba(155,199,0,0.41)';

/** 预加载棋子 SVG 图片 */
function loadPieceImages(): Record<string, HTMLImageElement> {
  const imgs: Record<string, HTMLImageElement> = {};
  const colors = ['w', 'b'];
  const types = ['K', 'Q', 'R', 'B', 'N', 'P'];
  for (const c of colors) {
    for (const t of types) {
      const key = `${c}${t}`;
      const img = new Image();
      img.src = `/pieces/${key}.svg`;
      imgs[key] = img;
    }
  }
  return imgs;
}

export default function ChessBoard({
  board, selectedPos, validMoves, lastMoveFrom, lastMoveTo, myColor, isMyTurn, onSelect,
  width = 560, height = 560,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPos, setHoverPos] = useState<{ row: number; col: number } | null>(null);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});

  // 懒加载图片
  useEffect(() => {
    imagesRef.current = loadPieceImages();
  }, []);

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
        ctx.strokeStyle = VALID_MOVE_COLOR;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, cellSize * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = VALID_MOVE_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, cellSize * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── 棋子（SVG 图片） ──
    const imgs = imagesRef.current;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = parsePiece(board[r]?.[c]);
        if (!piece) continue;
        const { x, y } = toCanvas(r, c);
        const fileKey = `${piece.color === 'white' ? 'w' : 'b'}${PIECE_FILE[piece.type] || ''}`;
        const img = imgs[fileKey];
        if (img && img.complete) {
          const sz = cellSize * 0.88;
          ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
        } else {
          // 图片未加载完成时 fallback 显示 Unicode
          ctx.fillStyle = piece.color === 'white' ? '#fff' : '#000';
          ctx.font = `${cellSize * 0.72}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const fallback: Record<string, Record<string, string>> = {
            king: { white: '♔', black: '♚' }, queen: { white: '♕', black: '♛' },
            rook: { white: '♖', black: '♜' }, bishop: { white: '♗', black: '♝' },
            knight: { white: '♘', black: '♞' }, pawn: { white: '♙', black: '♟' },
          };
          ctx.fillText(fallback[piece.type]?.[piece.color] || '?', x, y);
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
