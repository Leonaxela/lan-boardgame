import { useState, useMemo } from 'react';
import GoBoard from '../games/go/GoBoard';
import GomokuBoard from '../games/gomoku/GomokuBoard';
import ChineseChessBoard from '../games/chinese-chess/ChineseChessBoard';
import ChessBoard from '../games/chess/ChessBoard';
import DraughtsBoard from '../games/draughts/DraughtsBoard';

interface GameReplayViewerProps {
  record: {
    id: string;
    gameType: string;
    boardSize: number;
    opponent: string;
    result: string;
    createdAt: string;
    durationSec?: number;
    moves: string;
  };
  onClose: () => void;
}

function initChineseChessBoard(): (string | null)[][] {
  const b: (string | null)[][] = Array.from({ length: 10 }, () => Array(9).fill(null));
  const RED = ['red_rook','red_knight','red_bishop','red_advisor','red_king','red_advisor','red_bishop','red_knight','red_rook'];
  const BLACK = ['black_rook','black_knight','black_bishop','black_advisor','black_king','black_advisor','black_bishop','black_knight','black_rook'];
  for (let c = 0; c < 9; c++) { b[9][c] = RED[c]; b[0][c] = BLACK[c]; }
  for (const c of [0,2,4,6,8]) { b[6][c] = 'red_pawn'; b[3][c] = 'black_pawn'; }
  b[7][1] = 'red_cannon'; b[7][7] = 'red_cannon';
  b[2][1] = 'black_cannon'; b[2][7] = 'black_cannon';
  return b;
}

function initChessBoard(): (string | null)[][] {
  const b: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  const BACK = ['white_rook','white_knight','white_bishop','white_queen','white_king','white_bishop','white_knight','white_rook'];
  for (let c = 0; c < 8; c++) {
    b[7][c] = BACK[c]; b[0][c] = BACK[c].replace('white_', 'black_');
    b[6][c] = 'white_pawn'; b[1][c] = 'black_pawn';
  }
  return b;
}

function initDraughtsBoard(): (string | null)[][] {
  const ROWS = 10, COLS = 10;
  const b: (string | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < COLS; c++) if ((r + c) % 2 === 1) b[r][c] = 'black_man';
  for (let r = 7; r < 10; r++) for (let c = 0; c < COLS; c++) if ((r + c) % 2 === 1) b[r][c] = 'white_man';
  return b;
}

function buildReplayBoard(gameType: string, boardSize: number, moves: any[], step: number) {
  if (gameType === 'chinese-chess') {
    const board = initChineseChessBoard();
    for (let i = 0; i <= step && i < moves.length; i++) {
      const m = moves[i];
      if (m.fromRow !== undefined && m.fromCol !== undefined) {
        board[m.row][m.col] = board[m.fromRow][m.fromCol];
        board[m.fromRow][m.fromCol] = null;
      }
    }
    const last = moves[step];
    return { board, lastMove: last ? { row: last.row, col: last.col } : null, lastFrom: last?.fromRow !== undefined ? { row: last.fromRow, col: last.fromCol } : null, isCC: true };
  }

  if (gameType === 'chess') {
    const board = initChessBoard();
    for (let i = 0; i <= step && i < moves.length; i++) {
      const m = moves[i];
      if (m.fromRow !== undefined && m.fromCol !== undefined) {
        board[m.row][m.col] = board[m.fromRow][m.fromCol];
        board[m.fromRow][m.fromCol] = null;
      }
    }
    const last = moves[step];
    return { board, lastMove: last ? { row: last.row, col: last.col } : null, lastFrom: last?.fromRow !== undefined ? { row: last.fromRow, col: last.fromCol } : null, isChess: true };
  }

  if (gameType === 'draughts') {
    const board = initDraughtsBoard();
    for (let i = 0; i <= step && i < moves.length; i++) {
      const m = moves[i];
      if (m.fromRow !== undefined && m.fromCol !== undefined) {
        board[m.row][m.col] = board[m.fromRow][m.fromCol];
        board[m.fromRow][m.fromCol] = null;
      }
    }
    const last = moves[step];
    return { board, lastMove: last ? { row: last.row, col: last.col } : null, lastFrom: last?.fromRow !== undefined ? { row: last.fromRow, col: last.fromCol } : null, isDraughts: true };
  }

  // 围棋/五子棋
  const size = boardSize || 19;
  const board: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  const getGroup = (b: (string | null)[][], r: number, c: number): { positions: { r: number; c: number }[]; color: string } | null => {
    const color = b[r][c];
    if (!color) return null;
    const visited = new Set<string>();
    const positions: { r: number; c: number }[] = [];
    const queue = [{ r, c }];
    while (queue.length > 0) {
      const pos = queue.pop()!;
      const key = `${pos.r},${pos.c}`;
      if (visited.has(key)) continue;
      if (pos.r < 0 || pos.r >= size || pos.c < 0 || pos.c >= size) continue;
      if (b[pos.r][pos.c] !== color) continue;
      visited.add(key);
      positions.push(pos);
      queue.push({ r: pos.r - 1, c: pos.c }, { r: pos.r + 1, c: pos.c }, { r: pos.r, c: pos.c - 1 }, { r: pos.r, c: pos.c + 1 });
    }
    return { positions, color };
  };

  const getLiberties = (b: (string | null)[][], group: { r: number; c: number }[]): number => {
    const libs = new Set<string>();
    for (const pos of group) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = pos.r + dr, nc = pos.c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size && b[nr][nc] === null) libs.add(`${nr},${nc}`);
      }
    }
    return libs.size;
  };

  const removeDeadGroups = (b: (string | null)[][], color: string) => {
    const checked = new Set<string>();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (b[r][c] !== color) continue;
        const key = `${r},${c}`;
        if (checked.has(key)) continue;
        const group = getGroup(b, r, c);
        if (!group) continue;
        for (const p of group.positions) checked.add(`${p.r},${p.c}`);
        if (getLiberties(b, group.positions) === 0) {
          for (const p of group.positions) b[p.r][p.c] = null;
        }
      }
    }
  };

  for (let i = 0; i <= step && i < moves.length; i++) {
    const m = moves[i];
    if (m.row >= 0 && m.row < size && m.col >= 0 && m.col < size) {
      board[m.row][m.col] = m.color;
      if (gameType === 'go') {
        const opponent = m.color === 'black' ? 'white' : 'black';
        removeDeadGroups(board, opponent);
        removeDeadGroups(board, m.color);
      }
    }
  }
  const last = moves[step];
  return { board, lastMove: last ? { row: last.row, col: last.col } : null };
}

const GAME_NAMES: Record<string, string> = {
  go: '围棋', gomoku: '五子棋', 'chinese-chess': '中国象棋', chess: '国际象棋', draughts: '国际跳棋',
};

export default function GameReplayViewer({ record, onClose }: GameReplayViewerProps) {
  const [step, setStep] = useState(0);
  const [showNumbers, setShowNumbers] = useState(false);
  const moves = useMemo(() => {
    try { return JSON.parse(record.moves || '[]'); } catch { return []; }
  }, [record.moves]);

  const replayData = useMemo(
    () => buildReplayBoard(record.gameType, record.boardSize, moves, step),
    [record.gameType, record.boardSize, moves, step]
  );

  const isFromTo = ['chinese-chess', 'chess', 'draughts'].includes(record.gameType);

  const commonProps = {
    selectedPos: null as any,
    validMoves: [] as any[],
    myColor: null as string | null,
    isMyTurn: false,
    onSelect: () => {},
    onPlace: () => {},
  };

  const boardWidth = Math.min(window.innerWidth - 32, Math.min(window.innerHeight - 120, 460));
  const boardHeight = record.gameType === 'chinese-chess' ? Math.round(boardWidth * 1.1) : boardWidth;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ padding: '8px', width: 'auto', maxWidth: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 4 }}>
          <button className="btn-small" onClick={onClose}>✕</button>
        </div>
        {replayData && (
          <>
            {isFromTo ? (
              record.gameType === 'chinese-chess' ? (
                <ChineseChessBoard board={replayData.board} {...commonProps}
                  lastMoveFrom={(replayData as any).lastFrom || null}
                  lastMoveTo={replayData.lastMove || null}
                  width={boardWidth} height={boardHeight} />
              ) : record.gameType === 'chess' ? (
                <ChessBoard board={replayData.board} {...commonProps}
                  lastMoveFrom={(replayData as any).lastFrom || null}
                  lastMoveTo={replayData.lastMove || null}
                  width={boardWidth} height={boardHeight} />
              ) : (
                <DraughtsBoard board={replayData.board} {...commonProps}
                  lastMoveFrom={(replayData as any).lastFrom || null}
                  lastMoveTo={replayData.lastMove || null}
                  width={boardWidth} height={boardHeight} />
              )
            ) : record.gameType === 'go' ? (
              <GoBoard board={replayData.board} {...commonProps}
                boardSize={record.boardSize || 19}
                lastMove={(replayData.lastMove as any) || null}
                width={boardWidth} height={boardHeight}
                moveNumbers={showNumbers ? new Map(Object.entries((() => {
                  const nums: Record<string, number> = {};
                  for (let i = 0; i <= step && i < moves.length; i++) {
                    const m = moves[i];
                    nums[`${m.row},${m.col}`] = i + 1;
                  }
                  return nums;
                })())) : null}
              />
            ) : (
              <GomokuBoard board={replayData.board} {...commonProps}
                boardSize={record.boardSize || 15}
                lastMove={(replayData.lastMove as any) || null}
                width={boardWidth} height={boardHeight} />
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <button className="btn-small" disabled={step <= 0} onClick={() => setStep(0)}>⏮</button>
              <button className="btn-small" disabled={step <= 0} onClick={() => setStep(s => Math.max(0, s - 1))}>◀</button>
              <span style={{ color: '#ccc', fontSize: 13 }}>{step + 1} / {moves.length}</span>
              <button className="btn-small" disabled={step >= moves.length - 1} onClick={() => setStep(s => Math.min(moves.length - 1, s + 1))}>▶</button>
              <button className="btn-small" disabled={step >= moves.length - 1} onClick={() => setStep(moves.length - 1)}>⏭</button>
              {record.gameType === 'go' && <button className="btn-small" onClick={() => setShowNumbers(s => !s)}>🔢</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
