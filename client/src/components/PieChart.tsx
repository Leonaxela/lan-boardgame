import { useState } from 'react';

interface Slice {
  label: string;
  value: number;
  color: string;
}

const COLORS = [
  '#dcb35c', '#0071e3', '#a855f7', '#22c55e', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316',
];

export default function PieChart({ data, size = 200 }: { data: Slice[]; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (total === 0) return <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>;

  const pad = 16;
  const svgSize = size + pad * 2;
  const radius = size / 2 - 4;
  const center = svgSize / 2;
  let angle = -Math.PI / 2;

  const slices = data.map((d) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const startAngle = angle;
    const endAngle = angle + sliceAngle;
    const midAngle = angle + sliceAngle / 2;
    angle = endAngle;
    const large = sliceAngle > Math.PI ? 1 : 0;
    const pct = ((d.value / total) * 100).toFixed(1);
    const x1 = center + radius * Math.cos(startAngle);
    const y1 = center + radius * Math.sin(startAngle);
    const x2 = center + radius * Math.cos(endAngle);
    const y2 = center + radius * Math.sin(endAngle);
    const mx = center + radius * 0.68 * Math.cos(midAngle);
    const my = center + radius * 0.68 * Math.sin(midAngle);
    return {
      ...d,
      path: `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`,
      pct, mx, my,
      showLabel: Number(pct) > 5,
      midAngle,
    };
  });

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, overflow: 'visible' }}>
        <svg viewBox={`0 0 ${svgSize} ${svgSize}`} style={{ width: svgSize, height: svgSize, margin: -16, overflow: 'visible' }}>
          {slices.map((s, i) => (
            <g
              key={i}
              style={{ transformOrigin: `${center}px ${center}px`, cursor: 'pointer' }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <path
                d={s.path}
                fill={s.color}
                stroke="#1a1a2e"
                strokeWidth="2"
                style={{
                  transformOrigin: `${center}px ${center}px`,
                  transform: hoverIdx === i ? 'scale(1.08)' : 'scale(1)',
                  transition: 'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)',
                }}
              />
              {s.showLabel && (
                <text x={s.mx} y={s.my} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="11" fontWeight="700" style={{ pointerEvents: 'none' }}>
                  {s.pct}%
                </text>
              )}
            </g>
          ))}
        </svg>
        {hoverIdx !== null && (
          <div style={{
            position: 'absolute',
            left: slices[hoverIdx].mx + 16,
            top: slices[hoverIdx].my - 10,
            background: '#2a2a3e',
            borderRadius: 8,
            padding: '6px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,.3)',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}>
            {slices[hoverIdx].label} · {slices[hoverIdx].value} 局
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', flex: 1 }}>{d.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#dcb35c' }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
