import { useState, useRef, useEffect, useCallback } from 'react';

/* ── 类型 ── */

interface Track {
  id: string;
  name: string;
  artist: string;
  src: string;
  isLocal?: boolean;
}

type LoopMode = 'list' | 'single' | 'shuffle';

interface MusicPlayerProps {
  onClose: () => void;
}

/* ── 常量 ── */

const LOOP_TITLES: Record<LoopMode, string> = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' };

/* ── SVG 图标（替代 emoji，避免蓝底） ── */

function RepeatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4" x2="11" y2="4" />
      <polyline points="12,3 15,4 12,5" />
      <line x1="15" y1="5" x2="15" y2="15" />
      <line x1="9" y1="16" x2="15" y2="16" />
      <polyline points="8,15 5,16 8,17" />
      <line x1="5" y1="5" x2="5" y2="15" />
    </svg>
  );
}

function RepeatOneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4" x2="11" y2="4" />
      <polyline points="12,3 15,4 12,5" />
      <line x1="15" y1="5" x2="15" y2="15" />
      <line x1="9" y1="16" x2="15" y2="16" />
      <polyline points="8,15 5,16 8,17" />
      <line x1="5" y1="5" x2="5" y2="15" />
      <text x="10" y="13" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" stroke="none">1</text>
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="6" x2="9" y2="6" />
      <polyline points="10,5 13,6 10,7" />
      <line x1="8" y1="14" x2="15" y2="14" />
      <polyline points="16,13 19,14 16,15" />
    </svg>
  );
}

const LOOP_SVGS: Record<LoopMode, () => JSX.Element> = { list: RepeatIcon, single: RepeatOneIcon, shuffle: ShuffleIcon };

/* ── 模块级持久引用（关闭弹窗后仍保留，支持后台播放） ── */

let persistentAudio: HTMLAudioElement | null = null;
let persistentAudioCtx: AudioContext | null = null;
let persistentAnalyser: AnalyserNode | null = null;
let persistentRaf = 0;
let persistentTracks: Track[] = (() => {
  try { const d: Track[] = JSON.parse(sessionStorage.getItem('music_tracks') || '[]'); return Array.isArray(d) ? d : []; }
  catch { return []; }
})();
let persistentCurrentIndex: number = (() => {
  try { return JSON.parse(sessionStorage.getItem('music_index') || '-1'); }
  catch { return -1; }
})();
let persistentCustomCover = sessionStorage.getItem('music_cover') || '';

function saveState() {
  try {
    sessionStorage.setItem('music_tracks', JSON.stringify(persistentTracks));
    sessionStorage.setItem('music_index', String(persistentCurrentIndex));
    sessionStorage.setItem('music_cover', persistentCustomCover);
  } catch { /* quota exceeded, ignore */ }
}

function getOrCreateAudio(): HTMLAudioElement {
  if (!persistentAudio) {
    persistentAudio = new Audio();
    persistentAudio.preload = 'metadata';
  }
  return persistentAudio;
}

function initPersistentAudioContext(audio: HTMLAudioElement) {
  if (persistentAudioCtx) return;
  const ctx = new AudioContext();
  persistentAudioCtx = ctx;
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  persistentAnalyser = analyser;
  source.connect(analyser);
  analyser.connect(ctx.destination);
}

/* ── 组件 ── */

export default function MusicPlayer({ onClose }: MusicPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [tracks, setTracks] = useState<Track[]>(persistentTracks);
  const [currentIndex, setCurrentIndex] = useState(persistentCurrentIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('music_volume');
    return saved !== null ? parseFloat(saved) : 0.6;
  });
  const [showVolume, setShowVolume] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>('list');
  const [loading, setLoading] = useState(false);

  const currentTrack = currentIndex >= 0 && currentIndex < tracks.length ? tracks[currentIndex] : null;
  const handleTrackEndRef = useRef<() => void>(() => {});

  /* ── 关闭弹窗 = 只关 UI，不碰音频 ── */

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  /* ── 绑定/解绑持久 Audio 的事件 ── */

  useEffect(() => {
    const audio = getOrCreateAudio();

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => handleTrackEndRef.current();
    const onError = () => { console.warn('[Music] 音频加载失败:', audio.src); setLoading(false); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    // 同步当前播放状态
    if (!audio.paused) setIsPlaying(true);
    if (audio.duration) setDuration(audio.duration);
    setCurrentTime(audio.currentTime);
    // 如果 audio 已加载了某首歌但 currentIndex 不对，通过 src 匹配
    if (audio.src && currentIndex === -1 && tracks.length > 0) {
      const idx = tracks.findIndex(t => audio.src && (t.src === audio.src || audio.src.endsWith(t.src)));
      if (idx !== -1) setCurrentIndex(idx);
    }
    // 如果页面刷新后 audio 是新的（无 src），但有恢复的曲目，预加载 src 以便直接播放
    if (!audio.src && currentIndex >= 0 && currentIndex < tracks.length) {
      audio.src = tracks[currentIndex].src;
    }

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      // 不 pause/stop/clear audio — 后台播放
      if (persistentRaf) cancelAnimationFrame(persistentRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 音量同步 ── */

  useEffect(() => {
    const audio = getOrCreateAudio();
    audio.volume = volume;
    localStorage.setItem('music_volume', String(volume));
  }, [volume]);

  /* ── 加载服务器曲目 ── */

  useEffect(() => {
    fetch('/api/music/tracks')
      .then(r => r.json())
      .then(d => {
        if (d.tracks && d.tracks.length > 0) {
          setTracks(prev => {
      const merged = [...prev.filter(t => !t.id.startsWith('server-')), ...d.tracks];
      persistentTracks = merged;
      saveState();
      return merged;
    });
        }
      })
      .catch(() => {});
  }, []);

  /* ── 音频柱 ── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const barCount = 24;
    const gap = 1.5;

    const draw = () => {
      persistentRaf = requestAnimationFrame(draw);
      const analyser = persistentAnalyser;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bw = w / barCount;

      for (let i = 0; i < barCount; i++) {
        let n: number;
        if (analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          const step = Math.floor(data.length / barCount);
          let s = 0;
          for (let j = 0; j < step; j++) s += data[i * step + j];
          n = (s / step) / 255;
        } else {
          n = 0.05 + 0.02 * Math.sin(i * 0.6 + Date.now() * 0.001);
        }
        const bh = Math.max(1.5, n * h);
        const x = i * bw + gap / 2;
        const ww = bw - gap;
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, 'rgba(220,179,92,0.4)');
        grad.addColorStop(1, 'rgba(220,179,92,0.85)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, h - bh, ww, bh);
        ctx.fillStyle = 'rgba(245,217,138,0.5)';
        ctx.fillRect(x, h - bh, ww, 1);
      }
    };
    draw();
    return () => { if (persistentRaf) cancelAnimationFrame(persistentRaf); };
  }, []);

  /* ── 播放控制 ── */

  const playTrack = useCallback(async (index: number) => {
    const audio = getOrCreateAudio();
    if (index < 0 || index >= tracks.length) return;
    if (!persistentAudioCtx) initPersistentAudioContext(audio);
    if (persistentAudioCtx?.state === 'suspended') await persistentAudioCtx.resume();
    persistentCurrentIndex = index;
    saveState();
    setCurrentIndex(index);
    setLoading(true);
    audio.src = tracks[index].src;
    try { await audio.play(); setIsPlaying(true); }
    catch { setIsPlaying(false); }
    finally { setLoading(false); }
  }, [tracks]);

  const togglePlay = useCallback(async () => {
    const audio = getOrCreateAudio();
    if (currentIndex === -1 && tracks.length > 0) { await playTrack(0); return; }
    if (!persistentAudioCtx) initPersistentAudioContext(audio);
    if (persistentAudioCtx?.state === 'suspended') await persistentAudioCtx.resume();
    if (audio.paused) { try { await audio.play(); setIsPlaying(true); } catch {} }
    else { audio.pause(); setIsPlaying(false); }
  }, [currentIndex, tracks.length, playTrack]);

  const prevTrack = useCallback(() => {
    if (tracks.length === 0) return;
    playTrack(currentIndex <= 0 ? tracks.length - 1 : currentIndex - 1);
  }, [currentIndex, tracks.length, playTrack]);

  const nextTrack = useCallback(() => {
    if (tracks.length === 0) return;
    let idx: number;
    if (loopMode === 'shuffle') {
      do { idx = Math.floor(Math.random() * tracks.length); }
      while (idx === currentIndex && tracks.length > 1);
    } else {
      idx = currentIndex >= tracks.length - 1 ? 0 : currentIndex + 1;
    }
    playTrack(idx);
  }, [currentIndex, tracks.length, loopMode, playTrack]);

  const handleTrackEnd = useCallback(() => {
    if (loopMode === 'single') {
      const audio = getOrCreateAudio();
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else { nextTrack(); }
  }, [loopMode, nextTrack]);

  useEffect(() => { handleTrackEndRef.current = handleTrackEnd; }, [handleTrackEnd]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = getOrCreateAudio();
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  }, [duration]);

  /* ── 添加本地文件 ── */

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAddFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newTracks: Track[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = f.name.replace(/\.[^.]+$/, '');
      const di = name.indexOf(' - ');
      newTracks.push({
        id: `local-${Date.now()}-${i}`,
        name: di !== -1 ? name.slice(di + 3).trim() : name,
        artist: di !== -1 ? name.slice(0, di).trim() : '未知',
        src: URL.createObjectURL(f),
        isLocal: true,
      });
    }
    setTracks(prev => {
      const updated = [...prev, ...newTracks];
      persistentTracks = updated;
      saveState();
      return updated;
    });
    e.target.value = '';
  }, []);

  /* ── 上传自定义封面（临时，存模块变量） ── */

  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const handleCoverUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (persistentCustomCover) URL.revokeObjectURL(persistentCustomCover);
    persistentCustomCover = URL.createObjectURL(file);
    saveState();
    // 触发重渲染
    setTracks(prev => [...prev]);
    e.target.value = '';
  }, []);

  const removeTrack = useCallback((id: string) => {
    setTracks(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      if (prev[idx].isLocal) URL.revokeObjectURL(prev[idx].src);
      const next = prev.filter(t => t.id !== id);
      persistentTracks = next;
      saveState();
      if (idx === currentIndex) {
        const a = getOrCreateAudio();
        a.pause(); a.src = '';
        setIsPlaying(false); setCurrentIndex(-1); setCurrentTime(0); setDuration(0);
      } else if (idx < currentIndex) {
        setCurrentIndex((prev: number) => prev - 1);
      }
      return next;
    });
  }, [currentIndex]);

  const cycleLoop = useCallback(() => {
    setLoopMode(p => (['list', 'single', 'shuffle'] as LoopMode[])[(['list', 'single', 'shuffle'] as LoopMode[]).indexOf(p) + 1] || 'list');
  }, []);

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '00:00';
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const volIcon = volume === 0 ? '🔇' : volume < 0.3 ? '🔈' : volume < 0.7 ? '🔉' : '🔊';

  return (
    <div className="modal-overlay music-overlay" onClick={handleClose}>
      <div className="music-modal" onClick={e => e.stopPropagation()}>
        {/* ── 左侧：播放器 ── */}
        <div className="music-left">
          <div className="music-left-inner">
            <div className="music-viz-wrap">
              <canvas ref={canvasRef} width={240} height={48} className="music-viz" />
            </div>

            <div className="music-info">
              {currentTrack ? (
                <>
                  <div className="music-title">{currentTrack.name}</div>
                  <div className="music-artist">{currentTrack.artist}</div>
                </>
              ) : (
                <div className="music-title music-title-empty">未选择歌曲</div>
              )}
            </div>

            <div className="music-progress" onClick={handleSeek}>
              <div className="music-track-bar">
                <div className="music-track-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="music-time">
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>

            {/* 旋转 CD（点击上传自定义封面） */}
            <div className="music-cd-wrap">
              <div
                className={`music-cd ${isPlaying ? 'spinning' : ''}`}
                onClick={() => coverInputRef.current?.click()}
                title="点击更换封面"
              >
                <img
                  src={persistentCustomCover || '/api/music/files/default.png'}
                  alt="cover"
                  className="music-cd-img"
                  onError={e => {
                    const img = e.target as HTMLImageElement;
                    if (!persistentCustomCover && img.src.endsWith('.png')) {
                      img.src = '/api/music/files/default.svg';
                    } else {
                      img.style.display = 'none';
                    }
                  }}
                />
                <div className="music-cd-hole" />
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCoverUpload}
              />
            </div>

            <div className="music-ctrl">
              <button className="music-ctrl-btn" onClick={prevTrack} title="上一曲">⏮</button>
              <button
                className={`music-ctrl-btn music-play-btn ${loading ? 'music-loading' : ''}`}
                onClick={togglePlay}
                title={isPlaying ? '暂停' : '播放'}
              >
                {loading ? '⏳' : isPlaying ? '⏸' : '▶'}
              </button>
              <button className="music-ctrl-btn" onClick={nextTrack} title="下一曲">⏭</button>
              <button className="music-ctrl-btn" onClick={cycleLoop} title={LOOP_TITLES[loopMode]}>
                {LOOP_SVGS[loopMode]()}
              </button>
              <div className="music-vol-wrap">
                <button className="music-ctrl-btn" onClick={() => setShowVolume(p => !p)} title="音量">
                  {volIcon}
                </button>
                {showVolume && (
                  <div className="music-vol-popup">
                    <div className="music-vol-value">{Math.round(volume * 100)}%</div>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={volume}
                      onChange={e => setVolume(parseFloat(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 右侧：播放列表 ── */}
        <div className="music-right">
          <div className="music-right-header">
            <span>播放列表</span>
            <button className="music-add-btn" onClick={() => fileInputRef.current?.click()}>➕ 添加</button>
            <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={handleAddFiles} />
          </div>
          <div className="music-list">
            {tracks.length === 0 ? (
              <div className="music-list-empty">暂无曲目<br/>可添加本地音乐</div>
            ) : (
              tracks.map((track, i) => (
                <div
                  key={track.id}
                  className={`music-item${i === currentIndex ? ' active' : ''}`}
                  onClick={() => playTrack(i)}
                >
                  <span className="music-item-idx">{i === currentIndex ? '♪' : String(i + 1).padStart(2, '0')}</span>
                  <span className="music-item-name">{track.name}</span>
                  <span className="music-item-artist">{track.artist}</span>
                  {track.isLocal && (
                    <button className="music-item-del" onClick={e => { e.stopPropagation(); removeTrack(track.id); }}>✕</button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <button className="music-close" onClick={handleClose}>✕</button>
      </div>
    </div>
  );
}
