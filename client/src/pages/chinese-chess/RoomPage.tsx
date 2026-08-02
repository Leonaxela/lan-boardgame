import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../../hooks/useRoom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { wsClient } from '../../net/WebSocketClient';
import { formatChatTime, isSystemMsg, shouldShowTimeDivider, renderHighlightedText } from '../../utils/chat';
import ChineseChessBoard from '../../games/chinese-chess/ChineseChessBoard';
import Confetti from '../../components/Confetti';
import { playVictorySound } from '../../utils/sound';
import { getGameResultText } from '../../utils/gameResult';
import { useFavicon } from '../../hooks/useFavicon';
import { modalConfirm } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import '../../styles/chinese-chess-room.css';

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

const ROWS = 10;
const COLS = 9;

const INITIAL_BOARD: (string | null)[][] = [
  ['black_rook','black_knight','black_bishop','black_advisor','black_king','black_advisor','black_bishop','black_knight','black_rook'],
  Array(9).fill(null),
  [null,'black_cannon',null,null,null,null,null,'black_cannon',null],
  ['black_pawn',null,'black_pawn',null,'black_pawn',null,'black_pawn',null,'black_pawn'],
  Array(9).fill(null),
  Array(9).fill(null),
  ['red_pawn',null,'red_pawn',null,'red_pawn',null,'red_pawn',null,'red_pawn'],
  [null,'red_cannon',null,null,null,null,null,'red_cannon',null],
  Array(9).fill(null),
  ['red_rook','red_knight','red_bishop','red_advisor','red_king','red_advisor','red_bishop','red_knight','red_rook'],
];

export default function ChineseChessRoomPage() {
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
  const [boardPx, setBoardPx] = useState({ w: 540, h: 600 });
  const [selectedPos, setSelectedPos] = useState<{ row: number; col: number } | null>(null);
  const [validMoves, setValidMoves] = useState<{ row: number; col: number }[]>([]);

  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        const w = Math.max(360, Math.min(width - 24, 540));
        const h = Math.max(400, Math.min(height - 20, 600));
        setBoardPx({ w, h });
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
  // 每秒刷新棋钟
  useEffect(() => {
    if (!gameState?.clock || gameState.phase !== 'playing') return;
    const timer = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [gameState?.clock, gameState?.phase]);
  // 新对局重置棋钟和评估
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

  // ── Fairy-Stockfish 评估 ──
  const [fairyEval, setFairyEval] = useState<number | null>(null);
  const [fairyDepth, setFairyDepth] = useState<number | null>(null);
  const [fairyPv, setFairyPv] = useState<string | null>(null);
  useEffect(() => {
    const unsub = wsClient.on('fairy_eval', (p: any) => {
      setFairyEval(p.score ?? null);
      setFairyDepth(p.depth ?? null);
      setFairyPv(p.pv ?? null);
    });
    return unsub;
  }, []);

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

  // 中国象棋的 from-to 走法处理
  const handleSelect = useCallback((row: number, col: number) => {
    if (!isMyTurn || !gameState) return;
    const board = gameState.board;
    const piece = board[row]?.[col];

    if (selectedPos) {
      // 已选中棋子，尝试走棋
      if (piece && piece.startsWith(myColor || '')) {
        // 点击自己的其他棋子 → 切换选中
        setSelectedPos({ row, col });
        return;
      }
      // 走棋
      wsClient.send('place', { from: selectedPos, position: { row, col } });
      setSelectedPos(null);
      setValidMoves([]);
    } else {
      // 选中棋子
      if (piece && piece.startsWith(myColor || '')) {
        setSelectedPos({ row, col });
        // 计算合法走法（简化：只检查是否在棋盘内且不是自己的棋子）
        const moves: { row: number; col: number }[] = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (r === row && c === col) continue;
            const target = board[r]?.[c];
            if (!target || !target.startsWith(myColor || '')) {
              moves.push({ row: r, col: c });
            }
          }
        }
        setValidMoves(moves);
      }
    }
  }, [isMyTurn, gameState, selectedPos, myColor]);

  // 新对局开始时重置选中状态
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
    if (gameResult?.winner) {
      lastResultRef.current = gameResult;
    }
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
    gameType: 'chinese-chess',
  });

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

  const [showConfetti, setShowConfetti] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState(2);
  const [showDiffInfo, setShowDiffInfo] = useState(false);
  const [showFairyConfig, setShowFairyConfig] = useState(false);
  const [fairyDifficulty, setFairyDifficulty] = useState(2);
  const [fairyPlayerColor, setFairyPlayerColor] = useState('red');
  const [guessNumber, setGuessNumber] = useState('');
  const prevInCheck = useRef(false);

  // 移动端抽屉状态
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  useEffect(() => {
    if (gameResult?.winner) {
      const isWinner = gameResult.winner.id === myId || (gameResult.winner.color === myColor && !gameResult.winner.id);
      if (isWinner) { setShowConfetti(true); playVictorySound(); setTimeout(() => setShowConfetti(false), 4500); }
      else { playCheckmateSound(); }
    }
  }, [gameResult, myId, myColor]);

  // 将军音效
  useEffect(() => {
    if (gameState?.extra?.inCheck && !prevInCheck.current && gameState.phase === 'playing') {
      playCheckSound();
    }
    prevInCheck.current = !!gameState?.extra?.inCheck;
  }, [gameState?.extra?.inCheck, gameState?.phase]);

  return (
    <>
    <div className="room-page">
      {/* 移动端顶部工具栏 */}
      {isMobile && (
        <div className="mobile-toolbar">
          <button className="mobile-toolbar-btn" onClick={() => { setMobileSidebar(true); setMobileChat(false); }}>☰</button>
          <span className="mobile-toolbar-title">中国象棋 · 房间 {roomId}</span>
          <button className="mobile-toolbar-btn" onClick={() => { setMobileChat(true); setMobileSidebar(false); }}>💬</button>
        </div>
      )}

      {/* 移动端遮罩 */}
      {isMobile && (mobileSidebar || mobileChat) && (
        <div className="mobile-drawer-overlay" onClick={() => { setMobileSidebar(false); setMobileChat(false); }} />
      )}

      <aside className={`room-sidebar ${mobileSidebar ? 'mobile-open' : ''}`}>
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
              👑 {room.owner.username} {gameState?.phase === 'playing' && room.owner.color ? <span className={gameState?.currentTurn === room.owner.color ? 'stone-flip' : ''}>{room.owner.color === 'red' ? '🔴' : '⚫'}</span> : ''}
            </div>
          )}
          {room?.players.filter(p => p.id !== room?.owner?.id && !p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item ${p.id === myId ? 'is-me' : ''}`}>
              🧑 {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'red' ? '🔴' : '⚫'}</span> : ''}
            </div>
          ))}
          {room?.players.filter(p => p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item`}>
              {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'red' ? '🔴' : '⚫'}</span> : ''}
            </div>
          ))}
          {room?.players.length === 0 && <div className="player-item empty">等待加入...</div>}
          <div className="spectator-divider">👤 观战 ({room?.spectators?.length ?? 0})</div>
          {(room?.spectators?.length ?? 0) > 0 ? room!.spectators.map(s => (
            <div key={s.id} className={`player-item spectator ${s.id === myId ? 'is-me' : ''}`}>👤 {s.username}</div>
          )) : <div className="player-item empty">暂无观战</div>}
        </div>
        <div className="sidebar-actions">
          {isOwner && (!gameState || gameState.phase === 'finished') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
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
                    background: gameState.currentTurn === 'red' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                    border: gameState.currentTurn === 'red' ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                  }}>
                    <span style={{ fontSize: 14 }}>🔴</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 30 }}>
                      {room?.players?.find((p: any) => p.color === 'red')?.id === myId ? '你' : '对手'}
                    </span>
                    <span style={{
                      fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 1,
                      color: gameState.currentTurn === 'red' ? '#4caf50' : '#aaa',
                    }}>
                      {gameState.currentTurn === 'red'
                        ? formatTime(Date.now() - moveStartRef.current)
                        : formatTime(lastMoveTimeRef.current)}
                    </span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(clock.red?.totalTime + (gameState.currentTurn === 'red' ? Date.now() - moveStartRef.current : 0))}
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
              {/* Fairy-Stockfish 胜率条 */}
              {room?.players?.some(p => p.id.startsWith('ai-fairy')) && fairyEval !== null && (
                <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: '#018B8D' }}>
                  {(() => {
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
                          <span style={{ fontSize: 16, lineHeight: 1 }}>🔴</span>
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
              {/* 下一步预测 */}
              {room?.players?.some(p => p.id.startsWith('ai-fairy')) && fairyPv && (
                <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  <div style={{ marginBottom: 2 }}>下一步预测 {fairyDepth ? `(深度 ${fairyDepth})` : ''}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
                    {(() => {
                      const flip = myColor === 'black';
                      return fairyPv.split(' ').map((move: string) => {
                        if (move.length < 4) return move;
                        const flipCoord = (s: string) => {
                          const col = s.charCodeAt(0) - 97;
                          const row = parseInt(s[1], 10);
                          const fc = flip ? 8 - col : col;
                          const fr = flip ? 9 - row : row;
                          return String.fromCharCode(97 + fc) + fr;
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
        {!gameState ? (
          <div style={{ textAlign: 'center' }}>
            <ChineseChessBoard
              board={INITIAL_BOARD}
              selectedPos={null} validMoves={[]} myColor={myColor} isMyTurn={false}
              onSelect={() => {}} width={boardPx.w} height={boardPx.h}
            />
            <div className={`board-status ${isMobile ? 'mobile-status-bar' : ''}`}>
              <p className="text-muted" style={{ marginTop: -2, color: '#e67e22', fontWeight: 'bold', margin: 0 }}>
                {isMobile
                  ? (isOwner ? '点击 ☰ 查看操作' : '等待对局开始')
                  : (isOwner ? '点击 AI 对弈 开始下棋' : room?.activity === 'idle_2' ? '房主AI对弈中' : '等待对局开始...')
                }
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 被吃红棋（左侧） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignContent: 'flex-start', paddingTop: 4, width: boardPx.w * 0.22 }}>
              {(gameState.extra?.captured as string[] || []).filter((p: string) => p.startsWith('red_')).reverse().map((p: string, i: number) => {
                const type = p.replace('red_', '');
                const chars: Record<string, string> = { king: '帅', advisor: '仕', bishop: '相', knight: '馬', rook: '車', cannon: '砲', pawn: '兵' };
                return <span key={i} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: boardPx.w * 0.08, height: boardPx.w * 0.08, borderRadius: '50%', background: 'radial-gradient(circle, #fff5f5, #e8d0c0)', border: '2px solid #c0392b', fontSize: boardPx.w * 0.045, color: '#c0392b', fontWeight: 600 }}>{chars[type] || '?'}</span>;
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ChineseChessBoard
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
              <div className={`board-status ${isMobile ? 'mobile-status-bar' : ''}`}>
                {gameState.phase === 'playing' ? (
                  isMyTurn ? <span className="turn-indicator">你的回合 ({gameState?.currentTurn === 'red' ? '🔴红方' : '⚫黑方'})</span>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-end', alignContent: 'flex-start', paddingTop: 4, width: boardPx.w * 0.22 }}>
              {(gameState.extra?.captured as string[] || []).filter((p: string) => p.startsWith('black_')).reverse().map((p: string, i: number) => {
                const type = p.replace('black_', '');
                const chars: Record<string, string> = { king: '将', advisor: '士', bishop: '象', knight: '马', rook: '车', cannon: '炮', pawn: '卒' };
                return <span key={i} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: boardPx.w * 0.08, height: boardPx.w * 0.08, borderRadius: '50%', background: 'radial-gradient(circle, #f5f5f5, #d0d0d0)', border: '2px solid #333', fontSize: boardPx.w * 0.045, color: '#1a1a1a', fontWeight: 600 }}>{chars[type] || '?'}</span>;
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

        {/* 猜先弹窗 - 申请人等待（仅申请人可见） */}
        {guessFirstPhase === 'waiting_choice' && room?.owner?.id !== myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>✊ 猜先</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)' }}>已提交，等待对方选择...</p>
              <div style={{ marginTop: 16, textAlign: 'center' }}><span style={{ fontSize: 32 }}>⏳</span></div>
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 被申请人选石头剪刀布（等待中，仅房主可见） */}
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

        {/* 猜先弹窗 - 被申请人选石头剪刀布（可操作，仅房主可见） */}
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

        {/* 猜先结果弹窗 */}
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
                  return iWon ? '你赢了！执红先行' : '你输了！执黑后行';
                })()}
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <span style={{ color: guessFirstResult.challenger.color === 'red' ? '#f44336' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.challenger.username} {guessFirstResult.challenger.color === 'red' ? '🔴红' : '⚫黑'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>vs</span>
                <span style={{ color: guessFirstResult.owner.color === 'red' ? '#f44336' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.owner.username} {guessFirstResult.owner.color === 'red' ? '🔴红' : '⚫黑'}
                </span>
              </div>
              <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>对局即将开始...</p>
            </div>
          </div>
        )}
      </main>

      <aside className={`room-chat ${mobileChat ? 'mobile-open' : ''}`}>
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
                  flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${fairyPlayerColor === 'red' ? '#dcb35c' : 'rgba(255,255,255,0.1)'}`,
                  background: fairyPlayerColor === 'red' ? 'rgba(220,179,92,0.1)' : 'transparent', color: fairyPlayerColor === 'red' ? '#dcb35c' : '#aaa',
                  cursor: 'pointer', fontSize: 13, transition: '0.15s',
                }}
                onClick={() => setFairyPlayerColor('red')}
              >🔴 执红（先手）</button>
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
    </>
  );
}
