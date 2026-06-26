import { useEffect, useRef } from 'react';

interface Props {
  /** 是否启用动效；false 时只渲染静态深色底，不跑 RAF 循环，省 CPU/GPU */
  enabled?: boolean;
}

/**
 * Canvas 2D 星空粒子背景
 * - 三层视差星点（远/中/近），独立闪烁
 * - 鼠标引力：附近星点高亮并连成星座线
 * - 偶发金色流星，带渐隐尾迹
 * - 配色呼应全局金色主题（#dcb35c + 暖白）
 */
export default function StarfieldBackground({ enabled = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const applyEnabledRef = useRef<() => void>(() => {});
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    // ── 星点配置 ──
    // 三层：远（多/小/暗/慢）、中、近（少/大/亮/快）
    const LAYERS = [
      { count: 90, sizeMin: 0.4, sizeMax: 1.1, alphaMin: 0.25, alphaMax: 0.6,  speed: 0.015 },
      { count: 60, sizeMin: 0.8, sizeMax: 1.8, alphaMin: 0.4,  alphaMax: 0.85, speed: 0.04  },
      { count: 30, sizeMin: 1.2, sizeMax: 2.6, alphaMin: 0.6,  alphaMax: 1.0,  speed: 0.09  },
    ];

    // 星点颜色：金/暖白/冷白
    const COLORS = [
      { r: 220, g: 179, b: 92  }, // 金 #dcb35c
      { r: 245, g: 217, b: 138 }, // 浅金 #f5d98a
      { r: 255, g: 245, b: 220 }, // 暖白
      { r: 255, g: 250, b: 240 }, // 暖白2
      { r: 255, g: 245, b: 220 },
      { r: 220, g: 179, b: 92  },
      { r: 200, g: 220, b: 255 }, // 少量冷白
    ];

    type Star = {
      x: number; y: number; size: number; baseA: number;
      twPhase: number; twSpeed: number; twAmp: number;
      vx: number; vy: number; color: { r: number; g: number; b: number };
    };

    type Meteor = {
      x: number; y: number; vx: number; vy: number;
      life: number; maxLife: number; len: number;
    };

    let stars: Star[] = [];
    let meteors: Meteor[] = [];

    function makeStar(layer: typeof LAYERS[number]): Star {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      const size = layer.sizeMin + Math.random() * (layer.sizeMax - layer.sizeMin);
      const baseA = layer.alphaMin + Math.random() * (layer.alphaMax - layer.alphaMin);
      // 漂移方向：轻微向上偏左
      const angle = Math.PI * (1.1 + Math.random() * 0.3); // 朝左上
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        size,
        baseA,
        twPhase: Math.random() * Math.PI * 2,
        twSpeed: 0.5 + Math.random() * 1.8,
        twAmp: 0.15 + Math.random() * 0.35,
        vx: Math.cos(angle) * layer.speed * (0.5 + Math.random()),
        vy: Math.sin(angle) * layer.speed * (0.5 + Math.random()),
        color: c,
      };
    }

    function initStars() {
      stars = [];
      for (const layer of LAYERS) {
        for (let i = 0; i < layer.count; i++) stars.push(makeStar(layer));
      }
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      initStars();
    }

    // ── 鼠标 ──
    const mouse = { x: -9999, y: -9999, active: false };
    const LINK_DIST = 130;       // 鼠标连线半径
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }
    function onMouseLeave() {
      mouse.active = false;
      mouse.x = -9999; mouse.y = -9999;
    }
    // 触屏
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length > 0) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
        mouse.active = true;
      }
    }

    // ── 流星 ──
    let nextMeteor = performance.now() + 3000 + Math.random() * 7000;
    function spawnMeteor(now: number) {
      // 从右上方向左下飞，或从顶部向下
      const fromTop = Math.random() < 0.5;
      const speed = 7 + Math.random() * 6;
      let x: number, y: number, vx: number, vy: number;
      if (fromTop) {
        x = Math.random() * W * 0.7 + W * 0.2;
        y = -20;
        vx = -(2 + Math.random() * 2);
        vy = speed;
      } else {
        x = W + 20;
        y = Math.random() * H * 0.5;
        vx = -(speed);
        vy = 2 + Math.random() * 2;
      }
      meteors.push({
        x, y, vx, vy,
        life: 0,
        maxLife: 60 + Math.random() * 40,
        len: 80 + Math.random() * 80,
      });
      nextMeteor = now + 4000 + Math.random() * 9000;
    }

    // ── 渲染循环 ──
    let raf = 0;
    let lastT = performance.now();
    let running = true;

    /** 画一帧背景底色（关闭动效时静态底） */
    function drawStaticBase() {
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.3, Math.max(W, H));
      grad.addColorStop(0, '#10102a');
      grad.addColorStop(0.6, '#0a0a1e');
      grad.addColorStop(1, '#06060f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      const topGlow = ctx.createRadialGradient(W * 0.5, -H * 0.2, 0, W * 0.5, -H * 0.2, H * 0.9);
      topGlow.addColorStop(0, 'rgba(220,179,92,0.10)');
      topGlow.addColorStop(1, 'rgba(220,179,92,0)');
      ctx.fillStyle = topGlow;
      ctx.fillRect(0, 0, W, H);
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - lastT) / 16.67, 3); // 归一化到 60fps，clamp 防跳帧
      lastT = now;
      const t = now / 1000;

      drawStaticBase();

      // ── 星点 ──
      for (const s of stars) {
        // 漂移
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // 环绕回卷
        if (s.x < -5) s.x = W + 5;
        else if (s.x > W + 5) s.x = -5;
        if (s.y < -5) s.y = H + 5;
        else if (s.y > H + 5) s.y = -5;

        // 闪烁
        const tw = Math.sin(t * s.twSpeed + s.twPhase);
        let a = s.baseA * (1 - s.twAmp + s.twAmp * (tw * 0.5 + 0.5));

        // 鼠标引力：靠近鼠标时增亮
        let boosted = false;
        if (mouse.active) {
          const dx = s.x - mouse.x, dy = s.y - mouse.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < LINK_DIST_SQ) {
            const k = 1 - Math.sqrt(dSq) / LINK_DIST;
            a = Math.min(1, a + k * 0.5);
            boosted = true;
          }
        }
        a = Math.max(0, Math.min(1, a));

        const { r, g, b } = s.color;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();

        // 大星点带光晕
        if (s.size > 1.6) {
          ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.12})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        // 被鼠标激活的星点画十字星芒
        if (boosted && s.size > 1.3) {
          ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.5})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(s.x - s.size * 3, s.y);
          ctx.lineTo(s.x + s.size * 3, s.y);
          ctx.moveTo(s.x, s.y - s.size * 3);
          ctx.lineTo(s.x, s.y + s.size * 3);
          ctx.stroke();
        }
      }

      // ── 鼠标星座连线 ──
      if (mouse.active) {
        // 收集附近星点
        const near: Star[] = [];
        for (const s of stars) {
          const dx = s.x - mouse.x, dy = s.y - mouse.y;
          if (dx * dx + dy * dy < LINK_DIST_SQ) near.push(s);
        }
        // 连鼠标→星
        for (const s of near) {
          const dx = s.x - mouse.x, dy = s.y - mouse.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const a = (1 - d / LINK_DIST) * 0.75;
          ctx.strokeStyle = `rgba(245,217,138,${a})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(mouse.x, mouse.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        // 星↔星（仅近邻之间，限制数量）
        const maxLinks = near.length > 14 ? 14 : near.length;
        for (let i = 0; i < maxLinks; i++) {
          for (let j = i + 1; j < maxLinks; j++) {
            const a = near[i], b = near[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dSq = dx * dx + dy * dy;
            if (dSq < LINK_DIST_SQ * 0.6) {
              const d = Math.sqrt(dSq);
              const alpha = (1 - d / (LINK_DIST * 0.77)) * 0.5;
              ctx.strokeStyle = `rgba(220,179,92,${alpha})`;
              ctx.lineWidth = 0.6;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }

      // ── 流星 ──
      if (now >= nextMeteor) spawnMeteor(now);
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.life += dt;
        const lifeRatio = m.life / m.maxLife;
        // 渐入渐出
        const fade = lifeRatio < 0.2
          ? lifeRatio / 0.2
          : lifeRatio > 0.7 ? Math.max(0, (1 - lifeRatio) / 0.3) : 1;
        // 尾迹
        const tailX = m.x - m.vx * (m.len / 8);
        const tailY = m.y - m.vy * (m.len / 8);
        const lg = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        lg.addColorStop(0, `rgba(255,245,220,${0.9 * fade})`);
        lg.addColorStop(0.3, `rgba(245,217,138,${0.5 * fade})`);
        lg.addColorStop(1, 'rgba(220,179,92,0)');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        // 头部光点
        ctx.fillStyle = `rgba(255,250,235,${fade})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.4, 0, Math.PI * 2);
        ctx.fill();

        if (m.life >= m.maxLife || m.x < -50 || m.y > H + 50) {
          meteors.splice(i, 1);
        }
      }

      // 触发下一帧
    }

    // ── 可见性/失焦暂停 ──
    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && enabledRef.current) {
        running = true;
        lastT = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }

    /** 根据 enabled 开关启停动画循环；关闭时画一次静态底色省 CPU */
    function applyEnabled() {
      if (enabledRef.current) {
        if (!running) {
          running = true;
          lastT = performance.now();
          raf = requestAnimationFrame(frame);
        }
      } else {
        running = false;
        cancelAnimationFrame(raf);
        drawStaticBase();
      }
    }

    resize();
    applyEnabledRef.current = applyEnabled;
    applyEnabled();
    if (running) raf = requestAnimationFrame(frame);

    window.addEventListener('resize', resize);
    if (enabledRef.current) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseleave', onMouseLeave);
      window.addEventListener('touchmove', onTouchMove, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // enabled prop 变化时启停动画
  useEffect(() => {
    applyEnabledRef.current();
  }, [enabled]);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />;
}
