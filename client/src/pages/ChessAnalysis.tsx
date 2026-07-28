import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface AnalysisEntry {
  move: string;
  score: number | null;
  depth: number | null;
  pv: string | null;
  delta: number | null;
}

export default function ChessAnalysis() {
  const nav = useNavigate();
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
  const width = Math.min(Math.max(analysis.length * 12, 400), 900);

  return (
    <div className="room-page" style={{ position: 'relative', padding: 20, overflow: 'auto' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="btn-sidebar" onClick={() => nav('/')}>← 返回大厅</button>
          <h1 style={{ margin: 0, fontSize: 22 }}>📊 棋谱分析</h1>
        </div>

        {/* 输入区 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
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
          rows={6}
          style={{
            width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: 13, fontFamily: 'monospace', resize: 'vertical',
            marginBottom: 20, boxSizing: 'border-box',
          }}
        />

        {analysis.length > 0 && (
          <>
            {/* 统计摘要 */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>总步数</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{analysis.length}</div>
              </div>
              {bestMove && bestMove.delta !== null && (
                <div style={{ flex: 1, minWidth: 200, padding: 12, borderRadius: 8, background: 'rgba(76,175,80,0.08)' }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>最佳着法</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#4caf50' }}>
                    第{analysis.indexOf(bestMove) + 1}手 {bestMove.move.replace(/(\w{2})(\w{2})/g, '$1-$2')}
                    <span style={{ fontSize: 12, marginLeft: 6 }}>+{bestMove.delta.toFixed(1)}</span>
                  </div>
                </div>
              )}
              {worstMove && worstMove.delta !== null && (
                <div style={{ flex: 1, minWidth: 200, padding: 12, borderRadius: 8, background: 'rgba(244,67,54,0.08)' }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>最差着法</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#f44336' }}>
                    第{analysis.indexOf(worstMove) + 1}手 {worstMove.move.replace(/(\w{2})(\w{2})/g, '$1-$2')}
                    <span style={{ fontSize: 12, marginLeft: 6 }}>{worstMove.delta.toFixed(1)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* 胜率曲线 */}
            <div style={{ marginBottom: 20, padding: 16, borderRadius: 8, background: 'rgba(255,255,255,0.02)', overflowX: 'auto' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>📈 胜率曲线</div>
              <svg width={width} height={140} style={{ display: 'block' }}>
                {/* 中位线 */}
                <line x1={0} y1={70} x2={width} y2={70} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                {/* 数据点 */}
                {analysis.map((a, i) => {
                  if (a.score === null) return null;
                  const x = i * (width / Math.max(analysis.length - 1, 1));
                  const y = 70 - (a.score / maxScore) * 55;
                  const color = a.score >= 0 ? '#4caf50' : '#f44336';
                  return (
                    <g key={i}>
                      {i > 0 && analysis[i - 1].score !== null && (
                        <line x1={(i - 1) * (width / Math.max(analysis.length - 1, 1))} y1={70 - (analysis[i - 1].score! / maxScore) * 55} x2={x} y2={y} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
                      )}
                      <circle cx={x} cy={y} r={3} fill={color} />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* 逐布分析表 */}
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', padding: '8px 12px', fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.02)', fontWeight: 600 }}>
                <span style={{ width: 50, flexShrink: 0 }}>#</span>
                <span style={{ width: 80, flexShrink: 0 }}>走法</span>
                <span style={{ width: 60, flexShrink: 0 }}>评分</span>
                <span style={{ width: 60, flexShrink: 0 }}>±</span>
                <span style={{ flex: 1 }}>PV</span>
              </div>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {analysis.map((a, i) => (
                  <div key={i} style={{ display: 'flex', padding: '6px 12px', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.03)', background: a.delta !== null && a.delta < -0.5 ? 'rgba(244,67,54,0.04)' : a.delta !== null && a.delta > 0.3 ? 'rgba(76,175,80,0.04)' : 'transparent' }}>
                    <span style={{ width: 50, flexShrink: 0, color: 'rgba(255,255,255,0.3)' }}>{i + 1}</span>
                    <span style={{ width: 80, flexShrink: 0, fontFamily: 'monospace' }}>
                      {a.move.replace(/(\w{2})(\w{2})/g, '$1-$2')}
                    </span>
                    <span style={{ width: 60, flexShrink: 0, color: a.score !== null ? (a.score >= 0 ? '#4caf50' : '#f44336') : 'rgba(255,255,255,0.2)' }}>
                      {a.score !== null ? (a.score > 0 ? '+' : '') + a.score.toFixed(1) : '-'}
                    </span>
                    <span style={{ width: 60, flexShrink: 0, color: a.delta !== null ? (a.delta >= 0 ? '#4caf50' : '#f44336') : 'rgba(255,255,255,0.2)' }}>
                      {a.delta !== null ? (a.delta > 0 ? '+' : '') + a.delta.toFixed(1) : '-'}
                    </span>
                    <span style={{ flex: 1, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.pv ? a.pv.replace(/(\w{2})(\w{2})/g, '$1-$2') : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
