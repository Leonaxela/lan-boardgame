interface Point {
  label: string;
  value: number;
}

export default function LineChart({ data, width = 500, height = 220, highlightIndex }: { data: Point[]; width?: number; height?: number; highlightIndex?: number }) {
  if (data.length === 0) return <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>;

  const pad = { top: 24, right: 8, bottom: width < 250 ? 20 : 32, left: width < 250 ? 30 : 50 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const range = maxVal || 1;

  const points = data.map((d, i) => {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - (d.value / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cp1x = prev.x + (p.x - prev.x) / 2;
      const cp2x = p.x - (p.x - prev.x) / 2;
      return `C ${cp1x} ${prev.y} ${cp2x} ${p.y} ${p.x} ${p.y}`;
    })
    .join(' ');

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${pad.top + chartH} L ${points[0].x} ${pad.top + chartH} Z`;

  const gridLines = 4;
  const gridYs = Array.from({ length: gridLines + 1 }, (_, i) => {
    const y = pad.top + (chartH / gridLines) * i;
    const val = maxVal - (maxVal / gridLines) * i;
    return { y, val: Math.round(val) };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dcb35c" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#dcb35c" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {gridYs.map((g, i) => (
        <g key={i}>
          <line x1={pad.left} y1={g.y} x2={width - pad.right} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={pad.left - 8} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="11">
            {g.val}
          </text>
        </g>
      ))}

      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={linePath} fill="none" stroke="#dcb35c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {points.map((p, i) => {
        // 数据点太多时稀疏显示标签，保证间隔约 40px
        const labelStep = Math.max(1, Math.floor(data.length / (chartW / 40)));
        const showLabel = i % labelStep === 0 || i === data.length - 1 || i === highlightIndex;
        return (
        <g key={i}>
          {i === highlightIndex ? (
            <>
              <circle cx={p.x} cy={p.y} r="8" fill="#1a1a2e" stroke="#ff6b6b" strokeWidth="3" />
              <circle cx={p.x} cy={p.y} r="3" fill="#ff6b6b" />
            </>
          ) : (
            <circle cx={p.x} cy={p.y} r="4" fill="#1a1a2e" stroke="#dcb35c" strokeWidth="2.5" />
          )}
          {showLabel && (
            <text x={p.x} y={p.y - 12} textAnchor="middle" fill="#dcb35c" fontSize="11" fontWeight="600">
              {p.value}
            </text>
          )}
          {showLabel && (
            <text x={p.x} y={pad.top + chartH + 18} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="11">
              {p.label}
            </text>
          )}
        </g>
      );})}
    </svg>
  );
}
