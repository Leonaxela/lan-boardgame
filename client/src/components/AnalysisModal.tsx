import { useState, useRef } from 'react';

interface AnalysisEntry {
  move: string;
  score: number | null;
  depth: number | null;
  pv: string | null;
  delta: number | null;
}

interface Props {
  onClose: () => void;
}

export default function AnalysisModal({ onClose }: Props) {
  const [pgn, setPgn] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisEntry[]>([]);
  const [bestMove, setBestMove] = useState<AnalysisEntry | null>(null);
  const [worstMove, setWorstMove] = useState<AnalysisEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPgn(reader.result as string);
    reader.readAsText(file);
  };

  const handleAnalyze = async () => {
    if (!pgn.trim()) return;
    setLoading(true);
    setAnalysis([]);
    try {
      const res = await fetch('/api/chess/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setAnalysis(data.analysis || []);
      setBestMove(data.bestMove || null);
      setWorstMove(data.worstMove || null);
    } catch (err) {
      alert('分析失败: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const scores = analysis.filter(a => a.score !== null).map(a => a.score!);
  const maxScore = Math.max(...scores.map(Math.abs), 1);
  const chartW = Math.min(Math.max(analysis.length * 16, 300), 700);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 500, maxWidth: 780, maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ marginBottom: 16 }}>📊 使用 Fairy-Stockfish 分析</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="btn-sidebar" onClick={() => fileRef.current?.click()}>📁 选择 PGN 文件</button>
          <input ref={fileRef} type="file" accept=".pgn,.txt" style={{ display: 'none' }} onChange={handleFile} />
          <button className="btn-sidebar" disabled={loading || !pgn.trim()} onClick={handleAnalyze}>
            {loading ? '⏳ 分析中...' : '🚀 开始分析'}
          </button>
        </div>

        <textarea
          value={pgn}
          onChange={e => setPgn(e.target.value)}
          placeholder="粘贴 PGN 棋谱文本..."
          rows={4}
          style={{
            width: '100%', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: 12, fontFamily: 'monospace',
            resize: 'vertical', marginBottom: 12, boxSizing: 'border-box',
          }}
        />

        {analysis.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>总步数 </span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{analysis.length}</span>
              </div>
              {bestMove && bestMove.delta !== null && (
                <div style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(76,175,80,0.08)' }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>最佳 </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#4caf50' }}>
                    第{analysis.indexOf(bestMove) + 1}手 ({bestMove.delta > 0 ? '+' : ''}{bestMove.delta.toFixed(1)})
                  </span>
                </div>
              )}
              {worstMove && worstMove.delta !== null && (
                <div style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(244,67,54,0.08)' }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>最差 </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#f44336' }}>
                    第{analysis.indexOf(worstMove) + 1}手 ({worstMove.delta.toFixed(1)})
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12, padding: 12, borderRadius: 6, background: 'rgba(255,255,255,0.02)', overflowX: 'auto' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>📈 胜率曲线</div>
              <svg width={chartW} height={100} style={{ display: 'block' }}>
                <line x1={0} y1={50} x2={chartW} y2={50} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                {analysis.map((a, i) => {
                  if (a.score === null) return null;
                  const x = i * (chartW / Math.max(analysis.length - 1, 1));
                  const y = 50 - (a.score / maxScore) * 38;
                  const color = a.score >= 0 ? '#4caf50' : '#f44336';
                  return (
                    <g key={i}>
                      {i > 0 && analysis[i - 1].score !== null && (
                        <line x1={(i - 1) * (chartW / Math.max(analysis.length - 1, 1))} y1={50 - (analysis[i - 1].score! / maxScore) * 38} x2={x} y2={y} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
                      )}
                      <circle cx={x} cy={y} r={2.5} fill={color} />
                    </g>
                  );
                })}
              </svg>
            </div>

            <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', padding: '6px 10px', fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.02)', fontWeight: 600 }}>
                <span style={{ width: 36 }}>#</span>
                <span style={{ width: 72 }}>走法</span>
                <span style={{ width: 52 }}>评分</span>
                <span style={{ width: 48 }}>±</span>
                <span style={{ flex: 1 }}>PV</span>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {analysis.map((a, i) => (
                  <div key={i} style={{ display: 'flex', padding: '4px 10px', fontSize: 11, borderTop: '1px solid rgba(255,255,255,0.03)', background: a.delta !== null && a.delta < -0.5 ? 'rgba(244,67,54,0.04)' : a.delta !== null && a.delta > 0.3 ? 'rgba(76,175,80,0.04)' : 'transparent' }}>
                    <span style={{ width: 36, color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>
                    <span style={{ width: 72, fontFamily: 'monospace' }}>{a.move.replace(/(\w{2})(\w{2})/g, '$1-$2')}</span>
                    <span style={{ width: 52, color: a.score !== null ? (a.score >= 0 ? '#4caf50' : '#f44336') : 'rgba(255,255,255,0.2)' }}>
                      {a.score !== null ? (a.score > 0 ? '+' : '') + a.score.toFixed(1) : '-'}
                    </span>
                    <span style={{ width: 48, color: a.delta !== null ? (a.delta >= 0 ? '#4caf50' : '#f44336') : 'rgba(255,255,255,0.2)' }}>
                      {a.delta !== null ? (a.delta > 0 ? '+' : '') + a.delta.toFixed(1) : '-'}
                    </span>
                    <span style={{ flex: 1, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.pv ? a.pv.replace(/(\w{2})(\w{2})/g, '$1-$2') : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <button className="btn-sidebar" onClick={onClose} style={{ marginTop: 12 }}>关闭</button>
      </div>
    </div>
  );
}
