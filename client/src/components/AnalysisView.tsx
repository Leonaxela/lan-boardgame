import { useState, useEffect, useRef } from 'react';
import ChessBoard from '../games/chess/ChessBoard';
import { Chess } from 'chess.js';

interface AnalysisEntry {
  move: string;
  san?: string;
  color?: string;
  score: number | null;
  depth: number | null;
  pv: string | null;
  delta: number | null;
}

interface Props {
  width: number;
  height: number;
  analysis: AnalysisEntry[];
  step: number;
  onStep: (step: number) => void;
}

const PIECE_MAP: Record<string, string> = {
  'k': 'king', 'q': 'queen', 'r': 'rook', 'b': 'bishop', 'n': 'knight', 'p': 'pawn',
};

function chessJsBoardToOurBoard(chessBoard: ({ type: string; color: string } | null)[][]): (string | null)[][] {
  return chessBoard.map(row =>
    row.map(cell => {
      if (!cell) return null;
      return `${cell.color === 'w' ? 'white' : 'black'}_${PIECE_MAP[cell.type] || cell.type}`;
    })
  );
}

export default function AnalysisView({ width, height, analysis, step, onStep }: Props) {
  const [board, setBoard] = useState<(string | null)[][]>([]);
  const [lastFrom, setLastFrom] = useState<{ row: number; col: number } | null>(null);
  const [lastTo, setLastTo] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    if (analysis.length === 0) return;
    try {
      const chess = new Chess();
      // 应用走法 up to step
      for (let i = 0; i <= step && i < analysis.length; i++) {
        const uci = analysis[i].move;
        if (uci.length < 4) continue;
        chess.move(uci, { strict: false });
      }
      setBoard(chessJsBoardToOurBoard(chess.board()));

      // 最后一步的 from→to
      if (step >= 0 && step < analysis.length) {
        const u = analysis[step].move;
        if (u.length >= 4) {
          const fc = u.charCodeAt(0) - 97;
          const fr = 8 - parseInt(u[1], 10);
          const tc = u.charCodeAt(2) - 97;
          const tr = 8 - parseInt(u[3], 10);
          setLastFrom({ row: fr, col: fc });
          setLastTo({ row: tr, col: tc });
        }
      } else {
        setLastFrom(null);
        setLastTo(null);
      }
    } catch (e) {
      console.error('[AnalysisView]', e);
    }
  }, [step, analysis]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div style={{ position: 'relative' }} key={step}>
        <ChessBoard board={board} selectedPos={null} validMoves={[]}
          lastMoveFrom={lastFrom} lastMoveTo={lastTo}
          myColor={'white'} isMyTurn={false} onSelect={() => {}}
          width={width} height={height} />
      </div>

      {analysis.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <button className="btn-sidebar" style={{ fontSize: 16, padding: '6px 12px', background: 'rgba(20,20,40,0.6)', color: '#f5f5f5', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }} onClick={() => onStep(-1)} disabled={step <= -1}>⏮</button>
          <button className="btn-sidebar" style={{ fontSize: 16, padding: '6px 12px', background: 'rgba(20,20,40,0.6)', color: '#f5f5f5', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }} onClick={() => onStep(Math.max(-1, step - 1))} disabled={step <= -1}>◀</button>
          <span style={{ fontSize: 14, color: '#f5f5f5', minWidth: 100, textAlign: 'center', background: 'rgba(20,20,40,0.6)', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }}>
            {step === -1 ? '初始' : <>第 <span style={{ color: '#4caf50', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{step + 1}</span> 手 / <span style={{ color: '#4caf50', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{analysis.length}</span></>}
          </span>
          <button className="btn-sidebar" style={{ fontSize: 16, padding: '6px 12px', background: 'rgba(20,20,40,0.6)', color: '#f5f5f5', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }} onClick={() => onStep(Math.min(analysis.length - 1, step + 1))} disabled={step >= analysis.length - 1}>▶</button>
          <button className="btn-sidebar" style={{ fontSize: 16, padding: '6px 12px', background: 'rgba(20,20,40,0.6)', color: '#f5f5f5', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4 }} onClick={() => onStep(analysis.length - 1)} disabled={step >= analysis.length - 1}>⏭</button>
        </div>
      )}
    </div>
  );
}
