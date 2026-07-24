import { useEffect, useRef, useState, useCallback } from 'react';

interface SpriteAnim {
  frames: string[];
  loop: boolean;
  speed: number;
}

interface SpriteData {
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, SpriteAnim>;
}

interface CoachPetProps {
  /** 当前教练消息 */
  message: { text: string; type: 'good' | 'ok' | 'bad' | 'miss' } | null;
  /** 是否可见 */
  visible: boolean;
}

const ANIM_MAP: Record<string, string> = {
  'good': 'happy',
  'ok': 'idle',
  'bad': 'think',
  'miss': 'surprise',
};

// 各动画的裁剪区域（源图中有效的像素区域），保证所有动画缩放后人物大小一致
const ANIM_CROP: Record<string, { y: number; h: number }> = {
  idle: { y: 0, h: 480 },
  wave: { y: 0, h: 480 },
  happy: { y: 0, h: 480 },
  think: { y: 0, h: 480 },
  sad: { y: 0, h: 480 },
  surprise: { y: 0, h: 480 },
};

export default function CoachPet({ message, visible }: CoachPetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spriteData, setSpriteData] = useState<SpriteData | null>(null);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const currentAnimRef = useRef<string>('idle');
  const frameIdxRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const rafRef = useRef(0);
  const [currentMsg, setCurrentMsg] = useState(message);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: window.innerWidth - 220, y: window.innerHeight - 300 });

  // 加载精灵配置
  useEffect(() => {
    fetch('/ai-coach/sprite2/sprites.json')
      .then(r => r.json())
      .then((data: SpriteData) => {
        setSpriteData(data);
        // 预加载所有图片
        const allFrames = new Set<string>();
        for (const anim of Object.values(data.animations)) {
          for (const f of anim.frames) allFrames.add(f);
        }
        for (const f of allFrames) {
          const img = new Image();
          img.src = `/ai-coach/sprite2/sliced/${f}`;
          imagesRef.current[f] = img;
        }
      })
      .catch(() => {});
  }, []);

  // 消息变化时切换动画
  useEffect(() => {
    if (!message) return;
    setCurrentMsg(message);
    // 根据消息内容选择动画
    let anim: string;
    if (message.text.includes('👋')) {
      anim = 'wave';
    } else if (message.type === 'miss' && message.text.includes('损失惨重')) {
      anim = 'sad';
    } else if (message.type === 'miss' && message.text.includes('大漏')) {
      anim = 'sad';
    } else {
      anim = ANIM_MAP[message.type] || 'idle';
    }

    // 非 loop 动画只播放一次，然后回到 idle
    currentAnimRef.current = anim;
    frameIdxRef.current = 0;
    lastFrameTimeRef.current = 0;

    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    const sd = spriteData;
    if (sd && !sd.animations[anim]?.loop) {
      const totalFrames = sd.animations[anim]?.frames.length || 1;
      const duration = totalFrames * sd.animations[anim]!.speed * 100;
      msgTimerRef.current = setTimeout(() => {
        currentAnimRef.current = 'idle';
        frameIdxRef.current = 0;
        lastFrameTimeRef.current = 0;
      }, duration + 200);
    }
  }, [message, spriteData]);

  // 动画循环
  useEffect(() => {
    if (!spriteData) return;

    const draw = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(draw); return; }

      const anim = currentAnimRef.current;
      const animData = spriteData.animations[anim];
      if (!animData) { rafRef.current = requestAnimationFrame(draw); return; }

      const speedMs = animData.speed * 100;
      if (time - lastFrameTimeRef.current > speedMs) {
        frameIdxRef.current++;
        lastFrameTimeRef.current = time;
        if (frameIdxRef.current >= animData.frames.length) {
          frameIdxRef.current = animData.loop ? 0 : animData.frames.length - 1;
        }
      }

      const frame = animData.frames[frameIdxRef.current];
      const img = imagesRef.current[frame];
      if (img && img.complete) {
        const fw = spriteData.frameWidth;
        const fh = spriteData.frameHeight;
        const crop = ANIM_CROP[anim] || { y: 0, h: fh };
        const ch = Math.min(crop.h, fh - crop.y);
        const scale = Math.min(280 / fw, 280 / ch);
        const dw = fw * scale;
        const dh = ch * scale;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, crop.y, fw, ch, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spriteData]);

  // 拖拽
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }, [pos]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newX = e.clientX - dragStartRef.current.x;
      const newY = e.clientY - dragStartRef.current.y;
      setPos({ x: Math.max(0, newX), y: Math.max(0, newY) });
    };
    const handleMouseUp = () => { isDraggingRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!visible || !spriteData) return null;

  return (
    <div
      ref={elRef}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 100, cursor: 'grab' }}
      onMouseDown={handleMouseDown}
    >
      {/* 气泡 */}
      {currentMsg && (
        <div style={{
          position: 'absolute', bottom: 145, right: -10, minWidth: 180, maxWidth: 240,
          background: 'rgba(20,20,40,0.92)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
          color: 'rgba(255,255,255,0.85)',
        }}>
          {currentMsg.text}
          {/* 气泡尾巴 */}
          <div style={{
            position: 'absolute', bottom: -6, right: 50, width: 12, height: 12,
            background: 'rgba(20,20,40,0.92)', borderRight: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            transform: 'rotate(45deg)',
          }} />
        </div>
      )}
      {/* 精灵 */}
      <canvas
        ref={canvasRef}
        width={spriteData.frameWidth}
        height={spriteData.frameHeight}
        style={{ width: 160, height: 160, display: 'block' }}
      />
    </div>
  );
}
