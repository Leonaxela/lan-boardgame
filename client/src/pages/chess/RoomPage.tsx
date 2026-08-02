import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../../hooks/useRoom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { wsClient } from '../../net/WebSocketClient';
import { formatChatTime, isSystemMsg, shouldShowTimeDivider, renderHighlightedText } from '../../utils/chat';
import ChessBoard from '../../games/chess/ChessBoard';
import { ChessEngine } from '@lan-boardgame/chess/engine';
import Confetti from '../../components/Confetti';
import AnalysisView from '../../components/AnalysisView';
import { playVictorySound } from '../../utils/sound';
import { getGameResultText } from '../../utils/gameResult';
import { useFavicon } from '../../hooks/useFavicon';
import { modalConfirm } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import CoachPet from '../../components/CoachPet';

function playCheckSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function playCheckmateSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [800, 1000, 1200, 1600];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12); osc.stop(ctx.currentTime + i * 0.12 + 0.15);
    });
  } catch {}
}

const ROWS = 8;
const COLS = 8;

const INITIAL_BOARD: (string | null)[][] = [
  ['black_rook','black_knight','black_bishop','black_queen','black_king','black_bishop','black_knight','black_rook'],
  ['black_pawn','black_pawn','black_pawn','black_pawn','black_pawn','black_pawn','black_pawn','black_pawn'],
  Array(8).fill(null),
  Array(8).fill(null),
  Array(8).fill(null),
  Array(8).fill(null),
  ['white_pawn','white_pawn','white_pawn','white_pawn','white_pawn','white_pawn','white_pawn','white_pawn'],
  ['white_rook','white_knight','white_bishop','white_queen','white_king','white_bishop','white_knight','white_rook'],
];

export default function ChessRoomPage() {
  useFavicon('/go-icon.svg');
  const { roomId } = useParams();
  const nav = useNavigate();
  const { connected } = useWebSocket();
  const {
    room, myId, chatMessages, gameState, gameResult, rematchState, challengeState, challengeChallenger,
    guessFirstPhase, guessFirstResult, guessFirstChallenger,
    isMyTurn, myColor,
    place, pass, resign, challenge, respondChallenge, leaveRoom, sendChat,
    requestRematch, exitAfterGame, sendGuessNumber, sendGuessChoice, sendRpsChoice,
  } = useRoom();

  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState({ w: 560, h: 560 });
  const [selectedPos, setSelectedPos] = useState<{ row: number; col: number } | null>(null);
  const [validMoves, setValidMoves] = useState<{ row: number; col: number }[]>([]);

  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        const size = Math.max(320, Math.min(width - 24, height - 20, 640));
        setBoardPx({ w: size, h: size });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── 棋钟 ──
  const [clockTick, setClockTick] = useState(0);
  const moveStartRef = useRef(Date.now());
  const lastMoveTimeRef = useRef(0);
  const prevTurnForClockRef = useRef<string | null>(null);
  const currentTurn = gameState?.currentTurn;
  if (currentTurn && currentTurn !== prevTurnForClockRef.current) {
    if (prevTurnForClockRef.current !== null) {
      lastMoveTimeRef.current = Date.now() - moveStartRef.current;
    }
    moveStartRef.current = Date.now();
    prevTurnForClockRef.current = currentTurn;
  }
  // 每秒刷新棋钟显示
  useEffect(() => {
    if (!gameState?.clock || gameState.phase !== 'playing') return;
    const timer = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [gameState?.clock, gameState?.phase]);
  // 新对局开始时重置棋钟和评估数据
  useEffect(() => {
    if (gameState?.phase === 'playing') {
      moveStartRef.current = Date.now();
      lastMoveTimeRef.current = 0;
      prevTurnForClockRef.current = null;
      setClockTick(0);
      setFairyEval(null);
      setFairyDepth(null);
      setFairyPv(null);
    }
  }, [gameState?.phase]);
  const clock = gameState?.clock;
  const formatTime = (ms: number) => {
    if (!ms || ms < 0) return '00:00';
    const sec = Math.floor(ms / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };

  const [rematchTimer, setRematchTimer] = useState(60);
  const [challengeCountdown, setChallengeCountdown] = useState(60);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (!challengeState) { setChallengeCountdown(60); return; }
    const timer = setInterval(() => {
      setChallengeCountdown(t => { if (t <= 1) { clearInterval(timer); return 0; } return t - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [challengeState]);

  useEffect(() => {
    if (!gameResult) { setRematchTimer(60); return; }
    const timer = setInterval(() => {
      setRematchTimer(t => { if (t <= 1) { clearInterval(timer); exitAfterGame(); return 0; } return t - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameResult, exitAfterGame]);

  const isOwner = room?.owner?.id === myId;

  const handleSelect = useCallback((row: number, col: number) => {
    if (!isMyTurn || !gameState) return;
    const board = gameState.board;
    const piece = board[row]?.[col];

    if (selectedPos) {
      if (piece && piece.startsWith(myColor || '')) {
        setSelectedPos({ row, col });
        const engine = new ChessEngine();
        const moves = engine.getLegalMoves(gameState, { row, col });
        setValidMoves(moves);
        return;
      }
      wsClient.send('place', { from: selectedPos, position: { row, col } });
      setSelectedPos(null);
      setValidMoves([]);
    } else {
      if (piece && piece.startsWith(myColor || '')) {
        setSelectedPos({ row, col });
        // 使用引擎计算合法走法，只显示确实可移动到的格子
        const engine = new ChessEngine();
        const moves = engine.getLegalMoves(gameState, { row, col });
        setValidMoves(moves);
      }
    }
  }, [isMyTurn, gameState, selectedPos, myColor]);

  useEffect(() => {
    if (gameState?.phase === 'playing') {
      setSelectedPos(null);
      setValidMoves([]);
    }
  }, [gameState?.phase]);

  const handleSendChat = () => {
    if (!chatText.trim()) return;
    sendChat(chatText.trim());
    setChatText('');
  };

  const lastResultRef = useRef<any>(null);
  useEffect(() => {
    if (gameResult?.winner) { lastResultRef.current = gameResult; }
  }, [gameResult]);
  useEffect(() => {
    if (gameState?.phase === 'playing') lastResultRef.current = null;
  }, [gameState?.phase]);

  const displayResult = gameResult || lastResultRef.current;

  const winnerText = getGameResultText({
    winner: displayResult?.winner,
    loser: (displayResult as any)?.loser,
    reason: displayResult?.reason,
    scores: displayResult?.scores,
    gameType: 'chess',
  });

  const [showConfetti, setShowConfetti] = useState(false);
  const [fairyEval, setFairyEval] = useState<number | null>(null);
  const [fairyDepth, setFairyDepth] = useState<number | null>(null);
  const [fairyPv, setFairyPv] = useState<string | null>(null);
  // ── AI 教练 ──
  const [coachMsgs, setCoachMsgs] = useState<{ text: string; type: 'good' | 'ok' | 'bad' | 'miss' }[]>([]);
  const prevCoachScore = useRef<number | null>(null);
  // 扩展 fairy_eval handler 添加教练评价
  const coachUnsubRef = useRef<() => void>(() => {});
  useEffect(() => {
    coachUnsubRef.current();
    const unsub = wsClient.on('fairy_eval', (p: any) => {
      const score = p.score;
      if (score !== null && prevCoachScore.current !== null) {
        const myColor = room?.players?.find(p => p.id === myId)?.color || 'white';
        const delta = myColor === 'white' ? score - prevCoachScore.current : prevCoachScore.current - score;
        let text = '', type: 'good' | 'ok' | 'bad' | 'miss' = 'ok';
        if (delta > 0.8) { text = `💪 好棋！优势扩大 (+${delta.toFixed(1)})`; type = 'good'; }
        else if (delta > 0.3) { text = `👍 不错，逐步占优 (+${delta.toFixed(1)})`; type = 'good'; }
        else if (delta > 0.1) { text = `📌 有进步 (+${delta.toFixed(1)})`; type = 'good'; }
        else if (delta > -0.1) { text = `⏳ 局势平稳`; type = 'ok'; }
        else if (delta > -0.5) { text = `🤔 这步值得商榷 (${delta.toFixed(1)})`; type = 'bad'; }
        else if (delta > -1.5) { text = `😬 漏算了！损失约 ${Math.abs(delta).toFixed(1)} 兵`; type = 'miss'; }
        else { text = `😱 大漏！损失惨重 (${delta.toFixed(1)})`; type = 'miss'; }
        if (p.pv) {
          const suggestion = p.pv.replace(/(\w{2})(\w{2})/g, '$1-$2').split(' ').slice(0, 3).join(' ');
          if (type === 'bad' || type === 'miss') text += ` 建议 ${suggestion}`;
          else if (delta > 0.3) text += ` 推荐 ${suggestion}`;
        }
        // 劣势时加油打气
        if (delta < -0.3 && prevCoachScore.current !== null && prevCoachScore.current < -1) text = `💪 别灰心，还有机会！${text}`;
        setCoachMsgs(prev => [...prev.slice(-4), { text, type }]);
      }
      prevCoachScore.current = score;
      setFairyEval(score);
      setFairyDepth(p.depth ?? null);
      setFairyPv(p.pv ?? null);
    });
    coachUnsubRef.current = unsub;
    return unsub;
  }, [myId, room?.players]);

  // AI 教练开局问候
  useEffect(() => {
    if (gameState?.phase === 'playing' && room?.players?.some(p => p.id.startsWith('ai-fairy')) && coachMsgs.length === 0) {
      setCoachMsgs([{ text: '👋 我是你的 AI 教练，让我们变得更强吧！😊', type: 'ok' }]);
    }
  }, [gameState?.phase, room?.players]);

  // AI 对局终局弹窗延迟 3 秒
  const [showGameOver, setShowGameOver] = useState(false);
  useEffect(() => {
    if (gameResult) {
      const isAiGame = room?.players?.some(p => p.id.startsWith('ai-'));
      if (isAiGame) {
        const t = setTimeout(() => setShowGameOver(true), 3000);
        return () => clearTimeout(t);
      }
      setShowGameOver(true);
    } else {
      setShowGameOver(false);
    }
  }, [gameResult, room?.players]);
  const [aiDifficulty, setAiDifficulty] = useState(2);
  const [showDiffInfo, setShowDiffInfo] = useState(false);
  const [showFairyConfig, setShowFairyConfig] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showAnalysisPgn, setShowAnalysisPgn] = useState(false);
  const [analysisPgn, setAnalysisPgn] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<any[]>([]);
  const [analysisStep, setAnalysisStep] = useState(-1);
  const [progressPct, setProgressPct] = useState(0);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  // 分析图表自动滚动到当前步
  useEffect(() => {
    if (!chartScrollRef.current || analysisStep < 0) return;
    const el = chartScrollRef.current;
    const chartW = Math.min(Math.max(analysisData.length * 12, 200), 600);
    const targetX = analysisStep * (chartW / Math.max(analysisData.length - 1, 1)) - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' });
  }, [analysisStep, analysisData]);
  const [fairyDifficulty, setFairyDifficulty] = useState(2);
  const [fairyPlayerColor, setFairyPlayerColor] = useState('white');
  const [guessNumber, setGuessNumber] = useState('');
  const prevInCheck = useRef(false);
  useEffect(() => {
    if (gameResult?.winner) {
      const isWinner = gameResult.winner.id === myId || (gameResult.winner.color === myColor && !gameResult.winner.id);
      if (isWinner) { setShowConfetti(true); playVictorySound(); setTimeout(() => setShowConfetti(false), 4500); }
      else { playCheckmateSound(); }
    }
  }, [gameResult, myId, myColor]);

  useEffect(() => {
    if (gameState?.extra?.inCheck && !prevInCheck.current && gameState.phase === 'playing') {
      playCheckSound();
    }
    prevInCheck.current = !!gameState?.extra?.inCheck;
  }, [gameState?.extra?.inCheck, gameState?.phase]);

  return (
    <>
    <div className="room-page" style={{ position: 'relative' }}>
      <aside className="room-sidebar">
        <div className="room-header">
          <button className="btn-room-id">房间 {roomId}</button>
          <button className="btn-exit-room" onClick={async () => {
            if (!room) { await modalConfirm('房间已被销毁！'); nav('/'); return; }
            if (isOwner) { const ok = await modalConfirm('确定销毁房间？'); if (!ok) return; }
            leaveRoom(); nav('/');
          }}>退出房间 🚪</button>
        </div>
        <div className="player-list">
          {room?.owner && (
            <div className={`player-item owner ${room.owner.id === myId ? 'is-me' : ''}`}>
              👑 {room.owner.username} {gameState?.phase === 'playing' && room.owner.color ? <span className={gameState?.currentTurn === room.owner.color ? 'stone-flip' : ''}>{room.owner.color === 'white' ? '⚪' : '⚫'}</span> : ''}
            </div>
          )}
          {room?.players.filter(p => p.id !== room?.owner?.id && !p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item ${p.id === myId ? 'is-me' : ''}`}>
              🧑 {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'white' ? '⚪' : '⚫'}</span> : ''}
            </div>
          ))}
          {room?.players.filter(p => p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item`}>
              {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'white' ? '⚪' : '⚫'}</span> : ''}
            </div>
          ))}
          {room?.players.length === 0 && <div className="player-item empty">等待加入...</div>}
          <div className="spectator-divider">👤 观战 ({room?.spectators?.length ?? 0})</div>
          {(room?.spectators?.length ?? 0) > 0 ? room!.spectators.map(s => (
            <div key={s.id} className={`player-item spectator ${s.id === myId ? 'is-me' : ''}`}>👤 {s.username}</div>
          )) : <div className="player-item empty">暂无观战</div>}
        </div>
        <div className="sidebar-actions">
          {showAnalysis ? (
            <>
              {/* 分析数据先显示 */}
              {analysisData.length > 0 && analysisStep >= 0 && analysisStep < analysisData.length && (
                <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(() => {
                    const cur = analysisData[analysisStep];
                    const scores = analysisData.filter((a: any) => a.score !== null).map((a: any) => a.score);
                    const maxScore = Math.min(Math.max(...scores.map(Math.abs), 1), 5);
                    const chartW = Math.min(Math.max(analysisData.length * 12, 200), 600);
                    return (
                      <>
                        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', fontSize: 11 }}>
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>第 {analysisStep + 1} 手 {cur.move.replace(/(\w{2})(\w{2})/g, '$1-$2')}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {cur.score !== null && <span style={{ color: cur.score >= 0 ? '#4caf50' : '#f44336' }}>评分 {cur.score > 0 ? '+' : ''}{cur.score.toFixed(1)}</span>}
                            {cur.delta !== null && <span style={{ color: cur.delta >= 0 ? '#4caf50' : '#f44336' }}>±{cur.delta > 0 ? '+' : ''}{cur.delta.toFixed(1)}</span>}
                            {cur.depth !== null && <span>深度 {cur.depth}</span>}
                          </div>
                          {cur.pv && <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: 2, fontFamily: 'monospace', fontSize: 10 }}>PV: {cur.pv.replace(/(\w{2})(\w{2})/g, '$1-$2')}</div>}
                        </div>
                        <div ref={chartScrollRef} style={{ padding: 6, borderRadius: 6, background: 'rgba(255,255,255,0.02)', overflowX: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.06) transparent', flexShrink: 0 }}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>📈 胜率曲线</div>
                          <svg width={chartW} height={76} style={{ display: 'block', cursor: 'pointer', flexShrink: 0 }}>
                            {/* 中位线 (50%) */}
                            <line x1={0} y1={38} x2={chartW} y2={38} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
                            {/* 纵轴标注 */}
                            <text x={3} y={7} fill="rgba(255,255,255,0.12)" fontSize="7">100%</text>
                            <text x={3} y={40} fill="rgba(255,255,255,0.12)" fontSize="7">50%</text>
                            <text x={3} y={72} fill="rgba(255,255,255,0.12)" fontSize="7">0%</text>
                            {/* 折线 + 数据点 */}
                            {analysisData.map((a: any, i: number) => {
                              const x = 5 + i * ((chartW - 10) / Math.max(analysisData.length - 1, 1));
                              const wr = a.score !== null ? 100 / (1 + Math.pow(10, -a.score / 4)) : null;
                              const y = wr !== null ? Math.max(5, Math.min(71, 71 - (wr / 100) * 66)) : 38;
                              return <g key={i} onClick={() => setAnalysisStep(i)} style={{ cursor: 'pointer' }}>
                                {i > 0 && wr !== null && analysisData[i - 1].score !== null && (() => {
                                  const pwr = 100 / (1 + Math.pow(10, -analysisData[i - 1].score / 4));
                                  const py = Math.max(5, Math.min(71, 71 - (pwr / 100) * 66));
                                  return <line x1={5 + (i - 1) * ((chartW - 10) / Math.max(analysisData.length - 1, 1))} y1={py} x2={x} y2={y} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />;
                                })()}
                                <circle cx={x} cy={y} r={2} fill={wr !== null ? '#fff' : 'rgba(255,255,255,0.05)'} stroke={wr !== null ? 'rgba(0,0,0,0.4)' : 'transparent'} strokeWidth={1} />
                              </g>;
                            })}
                            {/* 当前步指示 */}
                            {analysisStep >= 0 && (() => {
                              const stepX = 5 + analysisStep * ((chartW - 10) / Math.max(analysisData.length - 1, 1));
                              const curScore = analysisData[analysisStep]?.score;
                              const wr = curScore !== null ? 100 / (1 + Math.pow(10, -curScore / 4)) : null;
                              return <>
                                <line x1={stepX} y1={3} x2={stepX} y2={70} stroke="#dcb35c" strokeWidth={1} strokeDasharray="2,2" />
                                {/* 手数（中间） */}
                                <text x={stepX} y={37} textAnchor="middle" fill="#dcb35c" fontSize="10" fontWeight="700">{analysisStep + 1}</text>
                                {/* 顶部白方胜率 */}
                                {wr !== null && <text x={stepX + 4} y={9} textAnchor="start" fill="#fff" fontSize="9" fontWeight="600">{wr.toFixed(1)}%</text>}
                                {/* 底部黑方胜率 */}
                                {wr !== null && <text x={stepX + 4} y={68} textAnchor="start" fill="rgba(255,255,255,0.35)" fontSize="9" fontWeight="600">{(100 - wr).toFixed(1)}%</text>}
                              </>;
                            })()}
                          </svg>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <button className="btn-sidebar" onClick={() => setShowAnalysis(false)}>← 退出分析</button>
            </>
          ) : isOwner && (!gameState || gameState.phase === 'finished') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              <button className="btn-sidebar" style={{ whiteSpace: 'nowrap' }}
                onClick={() => setShowAnalysisPgn(true)}>
                📊 使用Fairy-Stockfish分析
              </button>
              <button className="btn-sidebar" style={{ whiteSpace: 'nowrap' }}
                onClick={() => setShowFairyConfig(true)}>
                🤖 与Fairy-Stockfish对弈
              </button>
              <button className="btn-sidebar" style={{ whiteSpace: 'nowrap' }} onClick={() => wsClient.send('start_ai_game', { difficulty: aiDifficulty })}>🤖 AI 对弈</button>
              <Dropdown
                options={[{value:'1',label:'简单'},{value:'2',label:'普通'},{value:'3',label:'中等'},{value:'4',label:'困难'}]}
                value={String(aiDifficulty)}
                onChange={v => setAiDifficulty(Number(v))}
                direction="up"
              />
              <span style={{ position: 'relative' }}>
                <span style={{ cursor: 'pointer', fontSize: 16, opacity: 0.7 }} onClick={() => setShowDiffInfo(!showDiffInfo)}>🛈</span>
                {showDiffInfo && (
                  <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', width: 220, fontSize: 12, lineHeight: 1.6, color: '#ccc', zIndex: 100, whiteSpace: 'nowrap' }}>
                    <div><b>简单</b> — 800-1000分，入门级</div>
                    <div><b>普通</b> — 1200-1400分，俱乐部棋手</div>
                    <div><b>中等</b> — 1500-1700分，中级棋手</div>
                    <div><b>困难</b> — 1800-2000分，候补大师</div>
                  </div>
                )}
              </span>
            </div>
          )}
          {!isOwner && (!gameState || gameState.phase === 'finished') && room?.activity !== 'playing' && (
            <div className="challenge-area">
              <p className="challenge-name">{localStorage.getItem('username') || '观战者'}</p>
              <button className="btn-sidebar" onClick={challenge}>🏆 申请对局</button>
            </div>
          )}
          {challengeState === 'received' && (
            <div className="challenge-buttons">
              <button className="btn-sidebar btn-accept" onClick={() => respondChallenge(true)}>同意</button>
              <button className="btn-sidebar btn-reject" onClick={() => respondChallenge(false)}>拒绝</button>
            </div>
          )}
          {gameState && gameState.phase === 'playing' && room?.players?.some((p: any) => p.id === myId) && (
            <>
              {/* 棋钟 */}
              {clock && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8,
                    background: gameState.currentTurn === 'white' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                    border: gameState.currentTurn === 'white' ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                  }}>
                    <span style={{ fontSize: 14 }}>⚪</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 30 }}>
                      {room?.players?.find((p: any) => p.color === 'white')?.id === myId ? '你' : '对手'}
                    </span>
                    <span style={{
                      fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 1,
                      color: gameState.currentTurn === 'white' ? '#4caf50' : '#aaa',
                    }}>
                      {gameState.currentTurn === 'white'
                        ? formatTime(Date.now() - moveStartRef.current)
                        : formatTime(lastMoveTimeRef.current)}
                    </span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(clock.white.totalTime + (gameState.currentTurn === 'white' ? Date.now() - moveStartRef.current : 0))}
                    </span>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8,
                    background: gameState.currentTurn === 'black' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                    border: gameState.currentTurn === 'black' ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                  }}>
                    <span style={{ fontSize: 14 }}>⚫</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 30 }}>
                      {room?.players?.find((p: any) => p.color === 'black')?.id === myId ? '你' : '对手'}
                    </span>
                    <span style={{
                      fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 1,
                      color: gameState.currentTurn === 'black' ? '#4caf50' : '#aaa',
                    }}>
                      {gameState.currentTurn === 'black'
                        ? formatTime(Date.now() - moveStartRef.current)
                        : formatTime(lastMoveTimeRef.current)}
                    </span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(clock.black.totalTime + (gameState.currentTurn === 'black' ? Date.now() - moveStartRef.current : 0))}
                    </span>
                  </div>
                </div>
              )}
              {/* Fairy-Stockfish 实时胜率条 */}
              {room?.players?.some(p => p.id.startsWith('ai-fairy')) && fairyEval !== null && (
                <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: '#018B8D' }}>
                  {/* 胜率条 */}
                  {(() => {
                    // centipawn → 白方胜率（%）
                    const wr = 100 / (1 + Math.pow(10, -fairyEval / 4));
                    const blackPct = Math.max(2, Math.min(98, 100 - wr));
                    const whitePct = Math.max(2, Math.min(98, wr));
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
                          <span style={{ fontSize: 16, lineHeight: 1 }}>⚫</span>
                          <div style={{ flex: 1, height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', background: '#018B8D' }}>
                            <div style={{ width: `${blackPct}%`, background: '#000', transition: 'width 0.3s' }} />
                            <div style={{ width: `${whitePct}%`, background: '#fff', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 16, lineHeight: 1 }}>⚪</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                          <span>{blackPct.toFixed(0)}%</span>
                          <span>{whitePct.toFixed(0)}%</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {/* 下一步预测（PV） */}
              {room?.players?.some(p => p.id.startsWith('ai-fairy')) && fairyPv && (
                <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  <div style={{ marginBottom: 2 }}>下一步预测 {fairyDepth ? `(深度 ${fairyDepth})` : ''}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
                    {(() => {
                      const flip = myColor === 'black';
                      return fairyPv.split(' ').map(move => {
                        if (move.length < 4) return move;
                        const flipCoord = (s: string) => {
                          const col = s.charCodeAt(0) - 97;
                          const row = parseInt(s[1], 10) - 1;
                          const fc = flip ? 7 - col : col;
                          const fr = flip ? 7 - row : row;
                          return String.fromCharCode(97 + fc) + (fr + 1);
                        };
                        return flipCoord(move.slice(0,2)) + '-' + flipCoord(move.slice(2,4));
                      }).join(' ');
                    })()}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-sidebar" style={{ flex: 1 }} onClick={resign}>🏳️ 认输</button>
                <button className="btn-sidebar" style={{ flex: 1 }} onClick={() => wsClient.send('undo_move', {})}>↩ 悔棋</button>
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="room-board" ref={boardContainerRef} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {showAnalysis ? (
          <AnalysisView width={boardPx.w} height={boardPx.h} analysis={analysisData} step={analysisStep} onStep={setAnalysisStep} />
        ) : !gameState ? (
          <div style={{ textAlign: 'center' }}>
            <ChessBoard
              board={INITIAL_BOARD}
              selectedPos={null} validMoves={[]} myColor={myColor} isMyTurn={false}
              onSelect={() => {}} width={boardPx.w} height={boardPx.h}
            />
            <p className="text-muted" style={{ marginTop: -2, color: '#e67e22', fontWeight: 'bold' }}>
              {isOwner ? '点击 AI 对弈 开始下棋' : room?.activity === 'idle_2' ? '房主AI对弈中' : '等待对局开始...'}
            </p>
          </div>
        ) : (
          <>
            {/* 被吃白棋（左侧） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignContent: 'flex-start', paddingTop: 4, width: boardPx.h * 0.22 }}>
              {(gameState.extra?.captured as string[] || []).filter((p: string) => p.startsWith('white_')).reverse().map((p: string, i: number) => {
                const type = p.replace('white_', '');
                const fileKey = `w${type === 'knight' ? 'N' : type[0].toUpperCase()}`;
                return <img key={i} src={`/pieces/${fileKey}.svg`} style={{ width: boardPx.h * 0.1, height: boardPx.h * 0.1, opacity: 0.65 }} />;
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ChessBoard
                board={gameState.board}
                selectedPos={selectedPos}
                validMoves={validMoves}
                lastMoveFrom={gameState.extra?.lastMoveFrom || null}
                lastMoveTo={gameState.lastMove || null}
                myColor={myColor}
                isMyTurn={isMyTurn}
                inCheck={gameState.extra?.inCheck as boolean}
                onSelect={handleSelect}
                width={boardPx.w}
                height={boardPx.h}
              />
              <div className="board-status">
                {gameState.phase === 'playing' ? (
                  isMyTurn ? <span className="turn-indicator">你的回合 ({gameState?.currentTurn === 'white' ? '⚪白方' : '⚫黑方'})</span>
                    : <span className="text-muted">等待对手...</span>
                ) : gameState.phase === 'finished' ? (
                  <span className="game-over-label">对局结束 — {winnerText}</span>
                ) : null}
                {gameState.extra?.inCheck && gameState.phase === 'playing' && (
                  <span style={{ color: '#f44336', fontWeight: 700, marginLeft: 12 }}>⚠️ 将军！</span>
                )}
              </div>
            </div>
            {/* 被吃黑棋（右侧） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-end', alignContent: 'flex-start', paddingTop: 4, width: boardPx.h * 0.22 }}>
              {(gameState.extra?.captured as string[] || []).filter((p: string) => p.startsWith('black_')).reverse().map((p: string, i: number) => {
                const type = p.replace('black_', '');
                const fileKey = `b${type === 'knight' ? 'N' : type[0].toUpperCase()}`;
                return <img key={i} src={`/pieces/${fileKey}.svg`} style={{ width: boardPx.h * 0.1, height: boardPx.h * 0.1, opacity: 0.85 }} />;
              })}
            </div>
          </>
        )}

        {/* 挑战弹窗 */}
        {challengeState === 'sent' && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <div className="challenge-timer"><span className="challenge-hourglass">⏳</span></div>
              <p className="challenge-msg">已经向 <span style={{ color: '#DCB35C' }}>👑{room?.owner?.username || '房主'}</span> 申请对局</p>
              <p className={`challenge-countdown ${challengeCountdown <= 10 ? 'countdown-urgent' : ''}`}>{challengeCountdown}秒倒计时</p>
            </div>
          </div>
        )}
        {challengeState === 'received' && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <div className="challenge-timer"><span className="challenge-hourglass">⏳</span></div>
              <p className="challenge-msg"><span style={{ color: '#DCB35C' }}>{challengeChallenger || '对方'}</span> 申请与您对局</p>
              <p className={`challenge-countdown ${challengeCountdown <= 10 ? 'countdown-urgent' : ''}`}>{challengeCountdown}秒倒计时</p>
              <div className="challenge-actions">
                <button className="challenge-accept" onClick={() => respondChallenge(true)}>同意</button>
                <button className="challenge-reject" onClick={() => respondChallenge(false)}>拒绝</button>
              </div>
            </div>
          </div>
        )}

        {/* 终局弹窗 */}
        <Confetti active={showConfetti} />
        {showGameOver && (
          <div className="modal-overlay">
            <div className="modal-content game-over-modal">
              <h2>{winnerText}</h2>
              {room?.players?.some(p => p.id === myId) ? (
                rematchState === 'opponent_exited' ? <p className="text-muted">对方已退出</p> : (
                  <div className="rematch-buttons">
                    {room?.players?.some(p => p.id.startsWith('ai-fairy')) ? (
                      <button className="btn-primary" onClick={() => wsClient.send('start_fairy_stockfish_game', { skillLevel: fairyDifficulty, playerColor: fairyPlayerColor })}>
                        再战一局
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={requestRematch} disabled={rematchState === 'sent'}>
                        {rematchState === 'sent' ? '已申请再战' : rematchState === 'opponent_sent' ? '对方已申请再战' : '再战一局'}
                      </button>
                    )}
                    <button className="btn-close" onClick={exitAfterGame}>退出</button>
                    <p className="text-muted" style={{ marginTop: 8 }}>⏳ {rematchTimer}s</p>
                  </div>
                )
              ) : <div className="rematch-buttons"><button className="btn-close" onClick={exitAfterGame}>退出</button></div>}
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 申请人选石头剪刀布（仅申请人可见） */}
        {guessFirstPhase === 'prompt_number' && room?.owner?.id !== myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: 16 }}>✊ 猜先</h2>
              <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.6)' }}>请选择石头、剪刀或布</p>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
                <button onClick={() => sendRpsChoice('rock')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >✊</button>
                <button onClick={() => sendRpsChoice('scissors')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >✌️</button>
                <button onClick={() => sendRpsChoice('paper')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >🖐</button>
              </div>
            </div>
          </div>
        )}

        {guessFirstPhase === 'waiting_choice' && room?.owner?.id !== myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>✊ 猜先</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)' }}>已提交，等待对方选择...</p>
              <div style={{ marginTop: 16, textAlign: 'center' }}><span style={{ fontSize: 32 }}>⏳</span></div>
            </div>
          </div>
        )}

        {guessFirstPhase === 'waiting_choice' && room?.owner?.id === myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: 16 }}>✊ 猜先</h2>
              <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.6)' }}>{guessFirstChallenger} 选择中...</p>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center', opacity: 0.35, pointerEvents: 'none' }}>
                <div style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16 }}>✊</div>
                <div style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16 }}>✌️</div>
                <div style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16 }}>🖐</div>
              </div>
            </div>
          </div>
        )}

        {guessFirstPhase === 'prompt_choice' && room?.owner?.id === myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: 16 }}>✊ 猜先</h2>
              <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.6)' }}>{guessFirstChallenger} 选择完毕，请选择！</p>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
                <button onClick={() => sendGuessChoice('rock')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >✊</button>
                <button onClick={() => sendGuessChoice('scissors')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >✌️</button>
                <button onClick={() => sendGuessChoice('paper')}
                  style={{ fontSize: 48, width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,179,92,0.15)', border: '2px solid rgba(220,179,92,0.3)', borderRadius: 16, cursor: 'pointer', transition: '0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(220,179,92,0.15)')}
                >🖐</button>
              </div>
            </div>
          </div>
        )}

        {guessFirstPhase === 'result' && guessFirstResult && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: 8 }}>✊ 猜先结果</h2>
              <div style={{ fontSize: 40, margin: '12px 0' }}>
                {guessFirstResult.challengerChoice === 'rock' ? '✊' : guessFirstResult.challengerChoice === 'scissors' ? '✌️' : '🖐'}
                <span style={{ margin: '0 12px', fontSize: 20, color: 'rgba(255,255,255,0.3)' }}>VS</span>
                {guessFirstResult.ownerChoice === 'rock' ? '✊' : guessFirstResult.ownerChoice === 'scissors' ? '✌️' : '🖐'}
              </div>
              <p style={{ marginBottom: 16 }}>
                {(() => {
                  const iAmChallenger = myId === guessFirstResult.challenger.id;
                  const iWon = iAmChallenger ? guessFirstResult.guessCorrect : !guessFirstResult.guessCorrect;
                  return iWon ? '你赢了！执白先行' : '你输了！执黑后行';
                })()}
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <span style={{ color: guessFirstResult.challenger.color === 'white' ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.challenger.username} {guessFirstResult.challenger.color === 'white' ? '⚪白' : '⚫黑'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>vs</span>
                <span style={{ color: guessFirstResult.owner.color === 'white' ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.owner.username} {guessFirstResult.owner.color === 'white' ? '⚪白' : '⚫黑'}
                </span>
              </div>
              <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>对局即将开始...</p>
            </div>
          </div>
        )}
      </main>

      {/* AI 教练 桌面宠物 */}
      {room?.players?.some(p => p.id.startsWith('ai-fairy')) && (
        <CoachPet
          visible={coachMsgs.length > 0}
          message={coachMsgs.length > 0 ? coachMsgs[coachMsgs.length - 1] : null}
        />
      )}

      <aside className="room-chat">
        <h3>聊天</h3>
        <div className="chat-messages">
          {chatMessages.length === 0 ? (
            <p className="text-muted chat-empty-hint">暂无消息，发条招呼吧 ✦</p>
          ) : (
            chatMessages.map((msg, i) => {
              const prev = chatMessages[i - 1];
              const showDivider = shouldShowTimeDivider(msg, prev);
              const isSystem = isSystemMsg(msg);
              const isMe = !!myId && msg.playerId === myId;
              return (
                <Fragment key={i}>
                  {showDivider && (
                    <div className="chat-time-divider">
                      <span>{formatChatTime(msg.timestamp)}</span>
                    </div>
                  )}
                  {isSystem ? (
                    <div className="chat-msg system">
                      <span className="chat-system-text">{renderHighlightedText(msg.text, msg.highlights)}</span>
                    </div>
                  ) : (
                    <div className={`chat-msg ${isMe ? 'me' : 'other'}`}>
                      {!isMe && <span className="chat-user">{msg.username}</span>}
                      <div className="chat-bubble">{msg.text}</div>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input">
          <input placeholder="输入消息..." value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendChat()} />
          <button onClick={handleSendChat} style={{ whiteSpace: 'nowrap' }}>发送</button>
        </div>
      </aside>
    </div>

    {/* Fairy-Stockfish 配置弹窗 */}
    {showFairyConfig && (
      <div className="modal-overlay" onClick={() => setShowFairyConfig(false)}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 320, maxWidth: 380 }}>
          <h2 style={{ marginBottom: 16, textAlign: 'center' }}>🤖 与Fairy-Stockfish对弈</h2>

          {/* 执子 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>执子</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${fairyPlayerColor === 'white' ? '#dcb35c' : 'rgba(255,255,255,0.1)'}`,
                  background: fairyPlayerColor === 'white' ? 'rgba(220,179,92,0.1)' : 'transparent', color: fairyPlayerColor === 'white' ? '#dcb35c' : '#aaa',
                  cursor: 'pointer', fontSize: 13, transition: '0.15s',
                }}
                onClick={() => setFairyPlayerColor('white')}
              >⚪ 执白（先手）</button>
              <button
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${fairyPlayerColor === 'black' ? '#dcb35c' : 'rgba(255,255,255,0.1)'}`,
                  background: fairyPlayerColor === 'black' ? 'rgba(220,179,92,0.1)' : 'transparent', color: fairyPlayerColor === 'black' ? '#dcb35c' : '#aaa',
                  cursor: 'pointer', fontSize: 13, transition: '0.15s',
                }}
                onClick={() => setFairyPlayerColor('black')}
              >⚫ 执黑（后手）</button>
            </div>
          </div>

          {/* 难度 */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>难度</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { value: 1, label: '简单', desc: 'depth 6' },
                { value: 2, label: '普通', desc: 'depth 10' },
                { value: 3, label: '中等', desc: 'depth 14' },
                { value: 4, label: '困难', desc: 'depth 18' },
                { value: 5, label: '顶级', desc: 'depth 22' },
              ].map(d => (
                <button
                  key={d.value}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${fairyDifficulty === d.value ? '#dcb35c' : 'rgba(255,255,255,0.1)'}`,
                    background: fairyDifficulty === d.value ? 'rgba(220,179,92,0.1)' : 'transparent',
                    color: fairyDifficulty === d.value ? '#dcb35c' : '#aaa',
                    cursor: 'pointer', fontSize: 12, transition: '0.15s',
                  }}
                  onClick={() => setFairyDifficulty(d.value)}
                >{d.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4, textAlign: 'center' }}>
              {['思考3秒', '思考8秒', '思考15秒', '思考30秒', '思考55秒'][fairyDifficulty - 1]}
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 14 }}
              onClick={() => setShowFairyConfig(false)}
            >取消</button>
            <button
              style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #2e7d32, #1b5e20)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              onClick={() => {
                wsClient.send('start_fairy_stockfish_game', { skillLevel: fairyDifficulty, playerColor: fairyPlayerColor });
                setShowFairyConfig(false);
              }}
            >开始对弈</button>
          </div>
        </div>
      </div>
    )}

    {showAnalysisPgn && (
      <div className="modal-overlay" onClick={() => { if (!analysisLoading) setShowAnalysisPgn(false); }}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 400, maxWidth: 500, minHeight: 260, position: 'relative' }}>
          {analysisLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, minHeight: 200 }}>
              <div style={{ fontSize: 48, marginBottom: 16, animation: 'hourglassFlip 1.5s ease-in-out infinite' }}>⏳</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.7)', marginBottom: 12 }}>正在分析棋谱...</div>
              <div style={{ width: 220, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: 'linear-gradient(90deg, #dcb35c, #f5d98a, #dcb35c)', backgroundSize: '200% 100%', borderRadius: 2, animation: 'shimmer 1.5s ease-in-out infinite' }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 12 }}>引擎评估中，步数越多时间越长...</div>
              <style>{`@keyframes hourglassFlip { 0% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } 100% { transform: rotate(180deg); } } @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
            </div>
          ) : (
            <>
              <h2 style={{ marginBottom: 16 }}>📊 PGN 棋谱分析</h2>
              <div style={{ marginBottom: 8 }}>
                <button className="btn-sidebar" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => document.getElementById('pgn-file-input')?.click()}>
                  📁 选择 PGN 文件
                </button>
                <input id="pgn-file-input" type="file" accept=".pgn,.txt" style={{ display: 'none' }} onChange={e => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const r = new FileReader(); r.onload = () => setAnalysisPgn(r.result as string); r.readAsText(f);
                }} />
              </div>
              <textarea
                value={analysisPgn}
                onChange={e => setAnalysisPgn(e.target.value)}
                placeholder="粘贴 PGN 棋谱文本..."
                rows={6}
                style={{
                  width: '100%', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: 12, fontFamily: 'monospace',
                  resize: 'vertical', marginBottom: 12, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-sidebar" onClick={() => setShowAnalysisPgn(false)} disabled={analysisLoading}>取消</button>
                <button className="btn-sidebar" disabled={!analysisPgn.trim() || analysisLoading} onClick={async () => {
                  setAnalysisLoading(true);
                  setProgressPct(0);
                  const progressTimer = setInterval(() => {
                    setProgressPct(p => p < 85 ? p + Math.random() * 3 + 0.5 : p < 90 ? p + 0.3 : p);
                  }, 800);
                  try {
                    const res = await fetch('/api/chess/analyze', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ pgn: analysisPgn }),
                    });
                    const data = await res.json();
                    if (data.error) { alert(data.error); return; }
                    setAnalysisData(data.analysis || []);
                    setAnalysisStep(-1);
                    setShowAnalysisPgn(false);
                    setShowAnalysis(true);
                  } catch { alert('分析失败'); }
                  finally { clearInterval(progressTimer); setAnalysisLoading(false); }
                }}>
                  {analysisLoading ? '⏳ 分析中...' : '🚀 开始分析'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
