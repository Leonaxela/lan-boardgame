/**
 * 胜利音效 —— 使用 Web Audio API 生成，无需音频文件。
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * 播放胜利音效（一段上升的琶音）。
 */
export function playVictorySound() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // 创建增益节点（淡出）
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    // 五个上升音调
    const notes = [523, 659, 784, 1047, 1319]; // C5 E5 G5 C6 E6

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      osc.connect(gain);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });

    // 最后一个和弦
    const chordGain = ctx.createGain();
    chordGain.connect(ctx.destination);
    chordGain.gain.setValueAtTime(0.1, now + 0.6);
    chordGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    [523, 659, 784].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + 0.6);
      osc.connect(chordGain);
      osc.start(now + 0.6);
      osc.stop(now + 1.5);
    });
  } catch {
    // 静默失败（浏览器可能不允许自动播放）
  }
}
