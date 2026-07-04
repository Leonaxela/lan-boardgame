import { useState, useRef, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  direction?: 'down' | 'up';
  noBorder?: boolean;
}

export default function Dropdown({ options, value, onChange, direction = 'down', noBorder }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = options.find(o => o.value === value);
  const isUp = direction === 'up';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap', zIndex: open ? 10 : undefined }}>
      {open && isUp && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          minWidth: '100%', background: '#1e1e36',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.4)', zIndex: 100, overflow: 'hidden',
        }}>
          {options.map(opt => (
            <div key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: '8px 14px', fontSize: 13,
                color: opt.value === value ? '#dcb35c' : '#e0e0e0',
                background: opt.value === value ? 'rgba(220,179,92,0.1)' : 'transparent',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (opt.value !== value) (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { if (opt.value !== value) (e.target as HTMLElement).style.background = 'transparent'; }}
            >{opt.label}</div>
          ))}
        </div>
      )}
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: '4px 20px 4px 4px', borderRadius: 4,
          border: noBorder ? 'none' : '1px solid rgba(255,255,255,0.08)',
          background: noBorder ? 'transparent' : 'rgba(255,255,255,0.03)',
          color: '#e0e0e0', fontSize: 12, cursor: 'pointer',
          userSelect: 'none', whiteSpace: 'nowrap', lineHeight: '16px',
          position: 'relative',
        }}
      >
        {selected?.label || value}
        <svg viewBox="0 0 12 12" width="10" height="10"
          style={{
            position: 'absolute', right: 4, top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            transition: 'transform 0.2s', pointerEvents: 'none',
          }}>
          <path d="M2 4l4 4 4-4" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && !isUp && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          minWidth: '100%', background: '#1e1e36',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100, overflow: 'hidden',
        }}>
          {options.map(opt => (
            <div key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: '8px 14px', fontSize: 13,
                color: opt.value === value ? '#dcb35c' : '#e0e0e0',
                background: opt.value === value ? 'rgba(220,179,92,0.1)' : 'transparent',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (opt.value !== value) (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { if (opt.value !== value) (e.target as HTMLElement).style.background = 'transparent'; }}
            >{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
