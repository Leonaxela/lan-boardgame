import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../../hooks/useRoom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { wsClient } from '../../net/WebSocketClient';
import { formatChatTime, isSystemMsg, shouldShowTimeDivider, renderHighlightedText } from '../../utils/chat';
import ChessBoard from '../../games/chess/ChessBoard';
import Confetti from '../../components/Confetti';
import { playVictorySound } from '../../utils/sound';
import { getGameResultText } from '../../utils/gameResult';
import { useFavicon } from '../../hooks/useFavicon';
import { modalConfirm } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';

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
        return;
      }
      wsClient.send('place', { from: selectedPos, position: { row, col } });
      setSelectedPos(null);
      setValidMoves([]);
    } else {
      if (piece && piece.startsWith(myColor || '')) {
        setSelectedPos({ row, col });
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
  const [aiDifficulty, setAiDifficulty] = useState(2);
  const [showDiffInfo, setShowDiffInfo] = useState(false);
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
    <div className="room-page">
      <aside className="room-sidebar">
        <div className="room-header">
          <button className="btn-room-id">房间 {roomId}</button>
          <button className="btn-exit-room" onClick={async () => {
            if (!room) { await modalConfirm('房间已被销毁！'); window.location.href = '/'; return; }
            if (isOwner) { const ok = await modalConfirm('确定销毁房间？'); if (!ok) return; }
            leaveRoom(); window.location.href = '/';
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
          {isOwner && (!gameState || gameState.phase === 'finished') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
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
            <button className="btn-sidebar btn-resign" onClick={resign}>🏳️ 认输</button>
          )}
        </div>
      </aside>

      <main className="room-board" ref={boardContainerRef}>
        {!gameState ? (
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
            <ChessBoard
              board={gameState.board}
              selectedPos={selectedPos}
              validMoves={validMoves}
              lastMoveFrom={gameState.extra?.lastMoveFrom || null}
              lastMoveTo={gameState.lastMove || null}
              myColor={myColor}
              isMyTurn={isMyTurn}
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
        {gameResult && (
          <div className="modal-overlay">
            <div className="modal-content game-over-modal">
              <h2>{winnerText}</h2>
              {room?.players?.some(p => p.id === myId) ? (
                rematchState === 'opponent_exited' ? <p className="text-muted">对方已退出</p> : (
                  <div className="rematch-buttons">
                    <button className="btn-primary" onClick={requestRematch} disabled={rematchState === 'sent'}>
                      {rematchState === 'sent' ? '已申请再战' : rematchState === 'opponent_sent' ? '对方已申请再战' : '再战一局'}
                    </button>
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
  );
}
