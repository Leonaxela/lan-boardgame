import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../../hooks/useRoom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { wsClient } from '../../net/WebSocketClient';
import GoBoard from '../../games/go/GoBoard';
import Confetti from '../../components/Confetti';
import { playVictorySound } from '../../utils/sound';
import { getGameResultText } from '../../utils/gameResult';
import { useFavicon } from '../../hooks/useFavicon';
import { modalConfirm } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import LineChart from '../../components/LineChart';
import '../../styles/go-room.css';

/** 格式化毫秒为 MM:SS */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function GoRoomPage() {
  useFavicon('/go-icon.svg');
  const { roomId } = useParams();
  const nav = useNavigate();
  const { connected } = useWebSocket();
  const {
    room, myId, chatMessages, gameState, gameResult, rematchState, challengeState, challengeChallenger,
    guessFirstPhase, guessFirstResult, guessFirstChallenger,
    isMyTurn, myColor,
    place, pass, applyCounting, resign, challenge, respondChallenge, leaveRoom, sendChat,
    requestRematch, exitAfterGame, sendGuessNumber, sendGuessChoice,
    startKatagoGame,
    clock,
    katagoAnalysisReport,
  } = useRoom();

  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState({ w: 560, h: 560 });
  // 分析回看状态
  const [replayMode, setReplayMode] = useState(false);
  const [replayStep, setReplayStep] = useState(0);
  // 棋钟：追踪当前走棋方的开始时间和上一步的步时
  const moveStartRef = useRef(Date.now());
  const lastMoveTimeRef = useRef(0); // 上一步走棋方的步时（冻结）
  const prevTurnForClockRef = useRef<string | null>(null);
  // 棋钟刷新：每秒强制重渲染
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!clock) return;
    const timer = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [clock]);

  // 在渲染时检测回合变化，同步更新（不用 useEffect）
  const currentTurn = gameState?.currentTurn;
  if (currentTurn && currentTurn !== prevTurnForClockRef.current) {
    // 记录上一步走棋方的步时
    if (prevTurnForClockRef.current !== null) {
      lastMoveTimeRef.current = Date.now() - moveStartRef.current;
    }
    // 重置计时器
    moveStartRef.current = Date.now();
    prevTurnForClockRef.current = currentTurn;
  }
  // 监听容器大小变化，铺满 room-board
  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        const size = Math.max(300, Math.min(width - 24, height - 20, 700));
        setBoardPx({ w: size, h: size });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [rematchTimer, setRematchTimer] = useState(60);
  const [challengeCountdown, setChallengeCountdown] = useState(60);
  const [sgfMode, setSgfMode] = useState(false);
  const [sgfFiles, setSgfFiles] = useState<any[]>([]);
  const [sgfMoves, setSgfMoves] = useState<any[]>([]);
  const [sgfStep, setSgfStep] = useState(0);

  // 通知服务端房间状态变化
  const setActivity = useCallback((activity: string) => {
    wsClient.send('set_activity', { activity });
  }, []);

  // 加载 SGF 列表
  const loadSgfList = useCallback(async () => {
    const res = await fetch('/api/sgf/list');
    const data = await res.json();
    setSgfFiles(data.files || []);
  }, []);

  // 加载单个 SGF
  const loadSgfFile = useCallback(async (id: string) => {
    const res = await fetch(`/api/sgf/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (data.sgf) {
      setSgfMoves(data.sgf.moves || []);
      setSgfStep(0);
      setSgfMode(true);
    }
  }, []);

  // 根据 SGF 步数构建棋盘状态
  const sgfBoard = useCallback(() => {
    if (!sgfMoves.length) return null;
    const size = 19;
    const b: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
    for (let i = 0; i <= sgfStep && i < sgfMoves.length; i++) {
      const m = sgfMoves[i];
      if (m.row >= 0 && m.row < size && m.col >= 0 && m.col < size) {
        b[m.row][m.col] = m.color === 'black' ? 'black' : 'white';
      }
    }
    return {
      board: b,
      lastMove: sgfMoves[sgfStep] ? { row: sgfMoves[sgfStep].row, col: sgfMoves[sgfStep].col } : null,
    };
  }, [sgfMoves, sgfStep]);

  // 分析回看：根据步数重建棋盘
  const replayBoard = useMemo(() => {
    if (!katagoAnalysisReport?.moveHistory?.length) return null;
    const moves = katagoAnalysisReport.moveHistory;
    const size = katagoAnalysisReport.boardSize || 19;
    const b: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
    // 重建到 replayStep（含）
    for (let i = 0; i <= replayStep && i < moves.length; i++) {
      const m = moves[i];
      if (m.row >= 0 && m.row < size && m.col >= 0 && m.col < size) {
        b[m.row][m.col] = m.color;
      }
    }
    const last = moves[replayStep];
    return {
      board: b,
      lastMove: last ? { row: last.row, col: last.col } : null,
    };
  }, [katagoAnalysisReport, replayStep]);

  // 当前步的分析数据
  const currentAnalysis = useMemo(() => {
    if (!katagoAnalysisReport?.analysisData) return null;
    return katagoAnalysisReport.analysisData[String(replayStep)] || null;
  }, [katagoAnalysisReport, replayStep]);

  // 进入回看模式时，默认跳到最后一步
  useEffect(() => {
    if (replayMode && katagoAnalysisReport?.moveHistory?.length) {
      setReplayStep(katagoAnalysisReport.moveHistory.length - 1);
    }
  }, [replayMode, katagoAnalysisReport]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (gameState?.board?.length) setBoardSize(gameState.board.length);
  }, [gameState]);

  // 挑战倒计时
  useEffect(() => {
    if (!challengeState) { setChallengeCountdown(60); return; }
    const timer = setInterval(() => {
      setChallengeCountdown(t => {
        if (t <= 1) { clearInterval(timer); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [challengeState]);

  // 终局倒计时
  useEffect(() => {
    if (!gameResult) { setRematchTimer(60); return; }
    const timer = setInterval(() => {
      setRematchTimer(t => {
        if (t <= 1) { clearInterval(timer); exitAfterGame(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameResult, exitAfterGame]);

  const isOwner = room?.owner?.id === myId;

  const handlePlace = (row: number, col: number) => {
    if (!isMyTurn) return;
    place(row, col);
  };

  const handleSendChat = () => {
    if (!chatText.trim()) return;
    sendChat(chatText.trim());
    setChatText('');
  };

  const handleRematch = () => {
    requestRematch();
  };

  const handleExit = () => {
    exitAfterGame();
  };

  const [showConfetti, setShowConfetti] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState(2);
  const [showDiffInfo, setShowDiffInfo] = useState(false);
  const [guessNumber, setGuessNumber] = useState('');
  const lastResultRef = useRef<any>(null);

  // KataGo 配置弹窗 & 加载弹窗
  const [showKatagoConfig, setShowKatagoConfig] = useState(false);
  const [showKatagoLoading, setShowKatagoLoading] = useState(false);
  const [katagoLoadSeconds, setKatagoLoadSeconds] = useState(0);
  const [katagoBoardSize, setKatagoBoardSize] = useState(19);
  const [katagoRules, setKatagoRules] = useState<'chinese' | 'japanese'>('chinese');
  const [katagoDifficulty, setKatagoDifficulty] = useState(2); // 1=简单500, 2=普通1000, 3=困难2000
  const [katagoPlayerColor, setKatagoPlayerColor] = useState<'black' | 'white'>('black');

  // KataGo 弹窗样式
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 };
  const optionBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 12px', borderRadius: 8, border: active ? '1px solid #4caf50' : '1px solid rgba(255,255,255,0.15)',
    background: active ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)', color: active ? '#4caf50' : '#aaa',
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'center' as const,
  });

  // 移动端抽屉状态
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  useEffect(() => {
    if (gameResult?.winner) {
      lastResultRef.current = gameResult;
      const isWinner = gameResult.winner.id === myId ||
        (gameResult.winner.color === myColor && !gameResult.winner.id);
      if (isWinner) {
        setShowConfetti(true);
        playVictorySound();
        setTimeout(() => setShowConfetti(false), 4500);
      }
    }
  }, [gameResult, myId, myColor]);

  const [boardSize, setBoardSize] = useState(19);

  const displayResult = gameResult || lastResultRef.current;
  const winnerText = getGameResultText({
    winner: displayResult?.winner,
    loser: (displayResult as any)?.loser,
    reason: displayResult?.reason,
    scores: displayResult?.scores,
    gameType: 'go',
    boardSize,
  });

  useEffect(() => {
    if (gameState?.phase === 'playing') lastResultRef.current = null;
  }, [gameState?.phase]);

  // KataGo 加载：游戏开始后自动关闭 loading 弹窗
  useEffect(() => {
    if (gameState?.phase === 'playing' && showKatagoLoading) {
      setShowKatagoLoading(false);
      setKatagoLoadSeconds(0);
    }
  }, [gameState?.phase, showKatagoLoading]);

  // KataGo 加载计时器
  useEffect(() => {
    if (!showKatagoLoading) return;
    setKatagoLoadSeconds(0);
    const timer = setInterval(() => setKatagoLoadSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [showKatagoLoading]);

  return (
    <div className="room-page">
      {/* 移动端顶部工具栏 */}
      {isMobile && (
        <div className="mobile-toolbar">
          <button className="mobile-toolbar-btn" onClick={() => { setMobileSidebar(true); setMobileChat(false); }}>☰</button>
          <span className="mobile-toolbar-title">围棋 · 房间 {roomId}</span>
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
            if (!room) {
              await modalConfirm('房间已被销毁，无法继续！');
              window.location.href = '/'; return;
            }
            if (isOwner) {
              const ok = await modalConfirm('确定要销毁房间吗？所有玩家将被移出');
              if (!ok) return;
            }
            leaveRoom(); window.location.href = '/';
          }} title="退出房间">
            退出房间 🚪
          </button>
        </div>
        <div className="player-list">
          {room?.owner && (
            <div className={`player-item owner ${room.owner.id === myId ? 'is-me' : ''}`}>
              👑 {room.owner.username} {gameState?.phase === 'playing' && room.owner.color ? <span className={gameState?.currentTurn === room.owner.color ? 'stone-flip' : ''}>{room.owner.color === 'black' ? '⚫' : '⚪'}</span> : ''}
            </div>
          )}
          {room?.players.filter(p => p.id !== room?.owner?.id && !p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item ${p.id === myId ? 'is-me' : ''}`}>
              🧑 {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'black' ? '⚫' : '⚪'}</span> : ''}
            </div>
          ))}
          {room?.players.filter(p => p.id.startsWith('ai-')).map(p => (
            <div key={p.id} className={`player-item`}>
              {p.username} {gameState?.phase === 'playing' && p.color ? <span className={gameState?.currentTurn === p.color ? 'stone-flip' : ''}>{p.color === 'black' ? '⚫' : '⚪'}</span> : ''}
            </div>
          ))}
          {room?.players.length === 0 && (
            <div className="player-item empty">等待加入...</div>
          )}
          {/* 观战者 */}
          <div className="spectator-divider">👤 观战 ({room?.spectators?.length ?? 0})</div>
          {(room?.spectators?.length ?? 0) > 0 ? room!.spectators.map(s => (
            <div key={s.id} className={`player-item spectator ${s.id === myId ? 'is-me' : ''}`}>
              👤 {s.username}
            </div>
          )) : (
            <div className="player-item empty">暂无观战</div>
          )}
        </div>
          <div className="sidebar-actions">
            {isOwner && (!gameState || gameState.phase === 'finished') && (
              <>
                {/* KataGo 分析报告 */}
                {replayMode && katagoAnalysisReport?.analysisData && (
                  <div style={{ marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 6 }}>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', marginBottom: 2 }}>胜率走势</div>
                    <LineChart
                      data={(() => {
                        const steps = Object.keys(katagoAnalysisReport.analysisData).sort((a, b) => Number(a) - Number(b));
                        return steps.map((step, i) => {
                          const pt = katagoAnalysisReport.analysisData[step];
                          return { label: String(i + 1), value: Math.round((pt.winrate || 0) * 100) };
                        });
                      })()}
                      width={200}
                      height={120}
                      highlightIndex={replayStep}
                    />
                  </div>
                )}
                {katagoAnalysisReport && (
                  <button className="btn-sidebar" style={{
                    background: replayMode ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #2a4a7a, #1a3050)',
                    border: replayMode ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(100,150,255,0.3)',
                  }} onClick={() => setReplayMode(!replayMode)}>
                    {replayMode ? '📊 收起报告' : '📊 查看报告'}
                  </button>
                )}
                {/* 与 KataGo 对弈 */}
                <button className="btn-sidebar" style={{ whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #1a6b37, #0d4a25)', border: '1px solid rgba(76,175,80,0.3)' }} onClick={() => setShowKatagoConfig(true)}>
                  🤖 与KataGo对弈
                </button>
                {/* 内置 AI 对弈 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
                  <button className="btn-sidebar" style={{ whiteSpace: 'nowrap' }} onClick={() => wsClient.send('start_ai_game', { difficulty: aiDifficulty })}>🤖 AI 对弈</button>
                  <Dropdown
                    options={[{value:'1',label:'简单'},{value:'2',label:'普通'},{value:'3',label:'困难'}]}
                    value={String(aiDifficulty)}
                    onChange={v => setAiDifficulty(Number(v))}
                    direction="up"
                  />
                  <span style={{ position: 'relative' }}>
                    <span style={{ cursor: 'pointer', fontSize: 16, opacity: 0.7 }} onClick={() => setShowDiffInfo(!showDiffInfo)}>🛈</span>
                    {showDiffInfo && (
                      <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', width: 200, fontSize: 12, lineHeight: 1.6, color: '#ccc', zIndex: 100, whiteSpace: 'nowrap' }}>
                        <div><b>简单</b> — ~10-15级，入门级</div>
                        <div><b>普通</b> — ~业余1-2段，中级棋手</div>
                        <div><b>困难</b> — ~业余3-5段，强业余棋手</div>
                      </div>
                    )}
                  </span>
                </div>
                <button className="btn-sidebar" onClick={() => { setActivity('idle_1'); loadSgfList(); setSgfMode(true); }}>
                  📖 打谱
                </button>
              </>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                      background: gameState.currentTurn === 'black' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                      border: gameState.currentTurn === 'black' ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                    }}>
                      <span style={{ fontSize: 14 }}>⚫</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 30 }}>
                        {room?.players.find((p: any) => p.color === 'black')?.id === myId ? '你' : '对手'}
                      </span>
                      <span style={{
                        fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 1,
                        color: gameState.currentTurn === 'black' ? '#4caf50' : '#aaa',
                        animation: gameState.currentTurn === 'black' ? 'clock-pulse 1s ease-in-out infinite' : 'none',
                      }}>
                        {gameState.currentTurn === 'black' 
                          ? formatTime(Date.now() - moveStartRef.current)
                          : formatTime(lastMoveTimeRef.current)}
                      </span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(clock.black.totalTime + (gameState.currentTurn === 'black' ? Date.now() - moveStartRef.current : 0))}
                      </span>
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                      background: gameState.currentTurn === 'white' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                      border: gameState.currentTurn === 'white' ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent',
                    }}>
                      <span style={{ fontSize: 14 }}>⚪</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 30 }}>
                        {room?.players.find((p: any) => p.color === 'white')?.id === myId ? '你' : '对手'}
                      </span>
                      <span style={{
                        fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 1,
                        color: gameState.currentTurn === 'white' ? '#4caf50' : '#aaa',
                        animation: gameState.currentTurn === 'white' ? 'clock-pulse 1s ease-in-out infinite' : 'none',
                      }}>
                        {gameState.currentTurn === 'white'
                          ? formatTime(Date.now() - moveStartRef.current)
                          : formatTime(lastMoveTimeRef.current)}
                      </span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(clock.white.totalTime + (gameState.currentTurn === 'white' ? Date.now() - moveStartRef.current : 0))}
                      </span>
                    </div>
                  </div>
                )}
                <button className="btn-sidebar" onClick={applyCounting}>🏁 申请终局数子</button>
                <button className="btn-sidebar" onClick={pass}>⏭️ Pass</button>
                <button className="btn-sidebar btn-resign" onClick={resign}>🏳️ 认输</button>
              </>
            )}
          </div>
      </aside>

      {/* 回看模式：候选走法列表 */}
      {replayMode && currentAnalysis?.topMoves?.length > 0 && (
        <div style={{
          position: 'fixed', left: 16, top: 100, zIndex: 100,
          background: 'rgba(20,20,40,0.92)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
          padding: '10px 14px', minWidth: 170, fontSize: 12,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 8 }}>候选走法</div>
          {currentAnalysis.topMoves.map((m: any, i: number) => {
            const pct = (m.winrate * 100).toFixed(1);
            const lead = m.scoreLead;
            const bestPct = currentAnalysis.topMoves[0]?.winrate ? (currentAnalysis.topMoves[0].winrate * 100).toFixed(1) : '0';
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                borderBottom: i < currentAnalysis.topMoves.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                <span style={{ color: i === 0 ? '#4caf50' : i === 1 ? '#ffa726' : i === 2 ? '#ef5350' : 'rgba(255,255,255,0.4)', fontWeight: 700, width: 16 }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}
                </span>
                <span style={{ color: '#fff', fontFamily: 'monospace', width: 36 }}>
                  {String.fromCharCode(65 + (m.col >= 8 ? m.col + 1 : m.col))}{19 - m.row}
                </span>
                <span style={{ color: '#4caf50', fontVariantNumeric: 'tabular-nums', width: 48, textAlign: 'right' }}>
                  {pct}%
                </span>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                  {lead > 0 ? `+${lead.toFixed(1)}` : lead.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <main className="room-board" ref={boardContainerRef}>
        {sgfMode ? (
          <div style={{ textAlign: 'center', overflow: 'auto', maxHeight: '100%', width: '100%' }}>
            {sgfMoves.length === 0 && sgfFiles.length > 0 ? (
              /* SGF 文件列表 */
              <div className="sgf-list">
                <div className="sgf-header">
                  <h2>棋谱列表</h2>
                  <button className="sgf-close" onClick={() => setSgfMode(false)}>关闭 ✕</button>
                </div>
                {sgfFiles.map(f => (
                  <div key={f.id} className="sgf-item" onClick={() => loadSgfFile(f.id)}>
                    <strong>{f.title}</strong>
                    <p className="text-muted">{f.black} vs {f.white} · {f.result}</p>
                  </div>
                ))}
              </div>
            ) : sgfMoves.length > 0 ? (
              /* SGF 复盘视图 */
              <div className="sgf-row">
                  <div className="sgf-left">
                    <button className="sgf-btn" onClick={() => setSgfStep(Math.max(0, sgfStep - 1))}>◀ 上一步</button>
                    <button className="sgf-btn" disabled>{sgfStep + 1} / {sgfMoves.length}</button>
                  </div>
                  <GoBoard
                    board={sgfBoard()?.board || []}
                    boardSize={19}
                    lastMove={sgfBoard()?.lastMove || null}
                    myColor={null}
                    isMyTurn={false}
                    onPlace={() => {}}
                    width={boardPx.w}
                    height={boardPx.h}
                  />
                  <div className="sgf-right">
                    <button className="sgf-btn" onClick={() => setSgfStep(Math.min(sgfMoves.length - 1, sgfStep + 1))}>下一步 ▶</button>
                    <button className="sgf-btn" onClick={() => { setActivity('idle_0'); setSgfMode(false); }}>退出打谱</button>
                  </div>
                </div>
            ) : (
              <div className="board-placeholder">
                <p>加载棋谱中...</p>
              </div>
            )}
          </div>
        ) : replayMode && replayBoard ? (
          <>
            <GoBoard
              board={replayBoard.board}
              boardSize={replayBoard.board?.length || 19}
              lastMove={replayBoard.lastMove}
              myColor={myColor}
              isMyTurn={false}
              onPlace={() => {}}
              width={boardPx.w}
              height={boardPx.h}
              replayMode={true}
              analysisData={currentAnalysis}
            />
            <div className={`board-status ${isMobile ? 'mobile-status-bar' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                <button className="replay-btn" onClick={() => setReplayStep(Math.max(0, replayStep - 1))}
                  disabled={replayStep <= 0}>⏮上一步</button>
                <span style={{ color: '#4caf50', fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  步数 {replayStep + 1}/{katagoAnalysisReport?.moveHistory?.length || 0}
                </span>
                <button className="replay-btn" onClick={() => setReplayStep(Math.min(
                  (katagoAnalysisReport?.moveHistory?.length || 1) - 1, replayStep + 1))}
                  disabled={replayStep >= (katagoAnalysisReport?.moveHistory?.length || 1) - 1}>下一步⏭</button>
                {currentAnalysis && (
                  <span style={{ color: '#4caf50', fontSize: 14, marginLeft: 4, fontWeight: 600 }}>
                    胜率 {currentAnalysis.winrate ? (currentAnalysis.winrate * 100).toFixed(1) + '%' : '--'}
                    {currentAnalysis.scoreLead !== undefined && ` · ${currentAnalysis.scoreLead > 0 ? '+' : ''}${currentAnalysis.scoreLead.toFixed(1)}目`}
                  </span>
                )}
                <button className="replay-btn" onClick={() => setReplayMode(false)}>✕</button>
              </div>
            </div>
          </>
        ) : !gameState ? (
          <div style={{ textAlign: 'center' }}>
            <GoBoard
              board={Array.from({ length: 19 }, () => Array(19).fill(null))}
              boardSize={19}
              lastMove={null}
              myColor={myColor}
              isMyTurn={false}
              onPlace={() => {}}
              width={boardPx.w}
              height={boardPx.h}
            />
            <div className={`board-status ${isMobile ? 'mobile-status-bar' : ''}`}>
              <p className="text-muted" style={{ margin: 0, color: '#e67e22', fontWeight: 'bold', transform: 'translateY(-6px)' }}>
                {isMobile
                  ? (isOwner ? '点击 ☰ 查看操作' : '等待对局开始')
                  : (isOwner ? '点击 AI 对弈 开始下棋，或加载棋谱研究' : room?.activity === 'idle_1' ? '房主打谱中' : room?.activity === 'idle_2' ? '房主AI对弈中' : '房主空闲中')
                }
              </p>
            </div>
          </div>
        ) : (
          <>
            <GoBoard
              board={gameState.board}
              boardSize={gameState.board?.length || 19}
              lastMove={gameState.lastMove}
              myColor={myColor}
              isMyTurn={isMyTurn}
              onPlace={handlePlace}
              width={boardPx.w}
              height={boardPx.h}
            />
            <div className={`board-status ${isMobile ? 'mobile-status-bar' : ''}`}>
              {gameState.phase === 'playing' ? (
                isMyTurn ? <span className="turn-indicator">你的回合 ({gameState?.currentTurn === 'black' ? '⚫' : '⚪'})</span>
                  : <span className="text-muted">等待对手...</span>
              ) : gameState.phase === 'finished' ? (
                <span className="game-over-label">对局结束 — {winnerText}</span>
              ) : null}
            </div>
          </>
        )}

        {/* 挑战弹窗 */}
        {challengeState === 'sent' && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <div className="challenge-timer">
                <span className="challenge-hourglass">⏳</span>
              </div>
              <p className="challenge-msg">已经向 <span style={{ color: '#DCB35C' }}>👑{room?.owner?.username || '房主'}</span> 申请对局</p>
              <p className={`challenge-countdown ${challengeCountdown <= 10 ? 'countdown-urgent' : ''}`}>
                {challengeCountdown}秒倒计时
              </p>
              <p className="challenge-timeout-warn">倒计时结束，自动拒绝！</p>
            </div>
          </div>
        )}
        {challengeState === 'received' && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <div className="challenge-timer">
                <span className="challenge-hourglass">⏳</span>
              </div>
              <p className="challenge-msg"><span style={{ color: '#DCB35C' }}>{challengeChallenger || '对方'}</span> 申请与您对局</p>
              <p className={`challenge-countdown ${challengeCountdown <= 10 ? 'countdown-urgent' : ''}`}>
                {challengeCountdown}秒倒计时
              </p>
              <p className="challenge-timeout-warn">倒计时结束，自动拒绝！</p>
              <div className="challenge-actions">
                <button className="challenge-accept" onClick={() => respondChallenge(true)}>同意</button>
                <button className="challenge-reject" onClick={() => respondChallenge(false)}>拒绝</button>
              </div>
            </div>
          </div>
        )}

        {/* 终局弹窗 */}
        <Confetti active={showConfetti} />
        {gameResult && (
          <div className="modal-overlay">
            <div className="modal-content game-over-modal">
              <h2>{winnerText}</h2>
              <p className="text-muted">
                黑 {gameResult.scores?.black ?? 0} · 白 {gameResult.scores?.white ?? 0}
              </p>
              {room?.players?.some(p => p.id === myId) ? (
                /* 对局双方：再战/退出 */
                rematchState === 'opponent_exited' ? (
                  <p className="text-muted">对方已退出</p>
                ) : (
                  <div className="rematch-buttons">
                    <button className="btn-primary" onClick={handleRematch} disabled={rematchState === 'sent'}>
                      {rematchState === 'sent' ? '已申请再战' : rematchState === 'opponent_sent' ? '对方已申请再战' : '再战一局'}
                    </button>
                    <button className="btn-close" onClick={handleExit}>退出</button>
                    <p className="text-muted" style={{ marginTop: 8 }}>⏳ {rematchTimer}s</p>
                  </div>
                )
              ) : (
                /* 观战者：仅退出 */
                <div className="rematch-buttons">
                  <button className="btn-close" onClick={handleExit}>退出</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 申请人填数字（仅申请人可见） */}
        {guessFirstPhase === 'prompt_number' && room?.owner?.id !== myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>😀 猜先</h2>
              <p style={{ marginBottom: 12, color: 'rgba(255,255,255,0.6)' }}>请输入一个 1-20 的数字</p>
              <input type="number" min={1} max={20} value={guessNumber}
                onChange={e => setGuessNumber(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && guessNumber) { const n = parseInt(guessNumber); if (n >= 1 && n <= 20) { sendGuessNumber(n); setGuessNumber(''); } } }}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 18, textAlign: 'center', outline: 'none' }}
                placeholder="1-20"
              />
              <button className="btn-primary" style={{ width: '100%', marginTop: 12 }}
                onClick={() => { const n = parseInt(guessNumber); if (n >= 1 && n <= 20) { sendGuessNumber(n); setGuessNumber(''); } }}
                disabled={!guessNumber || parseInt(guessNumber) < 1 || parseInt(guessNumber) > 20}
              >确定</button>
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 申请人等待（仅申请人可见） */}
        {guessFirstPhase === 'waiting_choice' && room?.owner?.id !== myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>😀 猜先</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)' }}>数字已提交，等待对方猜单双...</p>
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <span className="challenge-hourglass" style={{ fontSize: 32 }}>⏳</span>
              </div>
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 房主猜单双（仅房主可见） */}
        {guessFirstPhase === 'prompt_choice' && room?.owner?.id === myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>😀 猜先</h2>
              <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.6)' }}>{guessFirstChallenger} 填写完毕，请选择！</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn-primary" style={{ flex: 1, fontSize: 18, padding: '14px 0' }} onClick={() => sendGuessChoice('odd')}>单</button>
                <button className="btn-primary" style={{ flex: 1, fontSize: 18, padding: '14px 0' }} onClick={() => sendGuessChoice('even')}>双</button>
              </div>
            </div>
          </div>
        )}

        {/* 猜先弹窗 - 房主等待（仅房主可见） */}
        {guessFirstPhase === 'waiting_choice' && room?.owner?.id === myId && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup">
              <h2 style={{ marginBottom: 16 }}>😀 猜先</h2>
              <p style={{ marginBottom: 16, color: 'rgba(255,255,255,0.6)' }}>{guessFirstChallenger} 填写数字中...</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn-primary" style={{ flex: 1, fontSize: 18, padding: '14px 0', opacity: 0.35, cursor: 'not-allowed', pointerEvents: 'none' }} disabled>单</button>
                <button className="btn-primary" style={{ flex: 1, fontSize: 18, padding: '14px 0', opacity: 0.35, cursor: 'not-allowed', pointerEvents: 'none' }} disabled>双</button>
              </div>
            </div>
          </div>
        )}

        {/* 猜先结果弹窗 */}
        {guessFirstPhase === 'result' && guessFirstResult && (
          <div className="modal-overlay">
            <div className="modal-content challenge-popup" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: 8 }}>
                {(() => {
                  const iAmOwner = myId === guessFirstResult.owner.id;
                  const iAmChallenger = myId === guessFirstResult.challenger.id;
                  if (iAmOwner) return guessFirstResult.guessCorrect ? '😀 猜先结果' : '😭 猜先结果';
                  if (iAmChallenger) return guessFirstResult.guessCorrect ? '😭 猜先结果' : '😀 猜先结果';
                  return '猜先结果';
                })()}
              </h2>
              <p style={{ fontSize: 24, margin: '12px 0', color: '#dcb35c', fontWeight: 700 }}>
                数字 {guessFirstResult.number} · {guessFirstResult.choice}
              </p>
              <p style={{ marginBottom: 16 }}>
                {guessFirstResult.isOdd ? '奇数' : '偶数'} · {(() => {
                  const iAmOwner = myId === guessFirstResult.owner.id;
                  const iAmChallenger = myId === guessFirstResult.challenger.id;
                  const ownerGuessed = guessFirstResult.guessCorrect;
                  if (iAmOwner) {
                    return ownerGuessed ? '房主猜对了！执黑先行' : '房主猜错了！执白后行';
                  }
                  if (iAmChallenger) {
                    return ownerGuessed ? '房主猜对了！执白后行' : '房主猜错了！执黑先行';
                  }
                  const ownerColor = guessFirstResult.owner.color === 'black' ? '执黑先行' : '执白后行';
                  return ownerGuessed ? `房主猜对了，${ownerColor}` : `房主猜错了，${ownerColor}`;
                })()}
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <span style={{ color: guessFirstResult.challenger.color === 'black' ? '#dcb35c' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.challenger.username} {guessFirstResult.challenger.color === 'black' ? '⚫黑' : '⚪白'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>vs</span>
                <span style={{ color: guessFirstResult.owner.color === 'black' ? '#dcb35c' : 'rgba(255,255,255,0.5)' }}>
                  {guessFirstResult.owner.username} {guessFirstResult.owner.color === 'black' ? '⚫黑' : '⚪白'}
                </span>
              </div>
              <p style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>对局即将开始...</p>
            </div>
          </div>
        )}

        {/* KataGo 配置弹窗 */}
        {showKatagoConfig && (
          <div className="modal-overlay" onClick={() => setShowKatagoConfig(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ minWidth: 320, maxWidth: 400 }}>
              <h2 style={{ marginBottom: 16, textAlign: 'center' }}>🤖 与KataGo对弈</h2>

              {/* 棋盘大小 */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>棋盘</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[19, 13, 9].map(size => (
                    <button key={size} style={optionBtnStyle(katagoBoardSize === size)} onClick={() => setKatagoBoardSize(size)}>
                      {size}×{size}
                    </button>
                  ))}
                </div>
              </div>

              {/* 围棋规则 */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>围棋规则</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={optionBtnStyle(katagoRules === 'chinese')} onClick={() => { setKatagoRules('chinese'); setKatagoPlayerColor('black'); }}>
                    中国规则
                  </button>
                  <button style={optionBtnStyle(katagoRules === 'japanese')} onClick={() => { setKatagoRules('japanese'); setKatagoPlayerColor('black'); }}>
                    日本规则
                  </button>
                </div>
              </div>

              {/* 难度 */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>难度</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { value: 1, label: '简单', desc: '500 visits' },
                    { value: 2, label: '普通', desc: '1000 visits' },
                    { value: 3, label: '困难', desc: '2000 visits' },
                  ].map(d => (
                    <button key={d.value} style={optionBtnStyle(katagoDifficulty === d.value)} onClick={() => setKatagoDifficulty(d.value)}>
                      {d.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  {katagoDifficulty === 1 ? '约10-5级业余水平' : katagoDifficulty === 2 ? '约5级-业余3段' : '约业余3-5段'}
                </div>
              </div>

              {/* 执黑/执白 */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>执子</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={optionBtnStyle(katagoPlayerColor === 'black')} onClick={() => setKatagoPlayerColor('black')}>
                    ⚫ 执黑（先手）
                  </button>
                  <button style={optionBtnStyle(katagoPlayerColor === 'white')} onClick={() => setKatagoPlayerColor('white')}>
                    ⚪ 执白（后手）
                  </button>
                </div>
              </div>

              {/* 贴目 */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>贴目</label>
                <div style={{ fontSize: 14, color: '#dcb35c', fontWeight: 600 }}>
                  黑贴 {katagoRules === 'japanese' ? '6.5' : '7.5'} 目（{katagoRules === 'japanese' ? '日本规则' : '中国规则 = 3¾子'}）
                </div>
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 14 }} onClick={() => setShowKatagoConfig(false)}>
                  取消
                </button>
                <button style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #2e7d32, #1b5e20)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }} onClick={() => {
                  const visitsMap: Record<number, number> = { 1: 500, 2: 1000, 3: 2000 };
                  startKatagoGame({
                    boardSize: katagoBoardSize,
                    rules: katagoRules,
                    maxVisits: visitsMap[katagoDifficulty],
                    playerColor: katagoPlayerColor,
                  });
                  setShowKatagoConfig(false);
                  setShowKatagoLoading(true);
                }}>
                  开始对弈
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KataGo 加载弹窗 */}
        {showKatagoLoading && (
          <div className="modal-overlay" style={{ zIndex: 200 }}>
            <div className="modal-content" style={{ width: 360, textAlign: 'center', padding: '40px 32px' }}>
              <div style={{ fontSize: 48, marginBottom: 20, animation: 'katago-spin 2s linear infinite' }}>⚫</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8 }}>KataGo 准备中</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>正在初始化引擎，请稍候...</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 160, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #4caf50, #81c784)', animation: 'katago-progress 3s ease-in-out infinite', width: '60%' }} />
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{katagoLoadSeconds}s</span>
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50', animation: `katago-bounce 1.4s ${i * 0.2}s ease-in-out infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <aside className={`room-chat ${mobileChat ? 'mobile-open' : ''}`}>
        <h3>聊天</h3>
        <div className="chat-messages">
          {chatMessages.length === 0 ? (
            <p className="text-muted">暂无消息</p>
          ) : (
            chatMessages.map((msg, i) => (
              <div key={i} className="chat-msg">
                <span className="chat-user">{msg.username}</span>
                <span className="chat-text">{msg.text}</span>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input">
          <input
            placeholder="输入消息..."
            value={chatText}
            onChange={e => setChatText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendChat()}
          />
          <button onClick={handleSendChat} style={{ whiteSpace: 'nowrap' }}>发送</button>
        </div>
      </aside>
    </div>
  );
}
