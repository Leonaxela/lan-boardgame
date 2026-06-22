import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../../hooks/useRoom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { wsClient } from '../../net/WebSocketClient';
import GomokuBoard from '../../games/gomoku/GomokuBoard';
import Confetti from '../../components/Confetti';
import { playVictorySound } from '../../utils/sound';
import { getGameResultText } from '../../utils/gameResult';
import { useFavicon } from '../../hooks/useFavicon';
import { modalConfirm } from '../../components/Modal';
import Dropdown from '../../components/Dropdown';
import '../../styles/gomoku-room.css';

export default function GomokuRoomPage() {
  useFavicon('/go-icon.svg');
  const { roomId } = useParams();
  const nav = useNavigate();
  const { connected } = useWebSocket();
  const {
    room, myId, chatMessages, gameState, gameResult, rematchState, challengeState, challengeChallenger,
    guessFirstPhase, guessFirstResult, guessFirstChallenger,
    isMyTurn, myColor,
    place, pass, resign, challenge, respondChallenge, leaveRoom, sendChat,
    requestRematch, exitAfterGame, sendGuessNumber, sendGuessChoice,
  } = useRoom();

  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState({ w: 560, h: 560 });
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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

  const displayResult = gameResult || lastResultRef.current;
  const winnerText = getGameResultText({
    winner: displayResult?.winner,
    loser: (displayResult as any)?.loser,
    reason: displayResult?.reason,
    scores: displayResult?.scores,
    gameType: 'gomoku',
  });

  useEffect(() => {
    if (gameState?.phase === 'playing') lastResultRef.current = null;
  }, [gameState?.phase]);

  const boardSize = gameState?.board?.length || 15;

  return (
    <div className="room-page">
      {/* 移动端顶部工具栏 */}
      {isMobile && (
        <div className="mobile-toolbar">
          <button className="mobile-toolbar-btn" onClick={() => { setMobileSidebar(true); setMobileChat(false); }}>☰</button>
          <span className="mobile-toolbar-title">五子棋 · 房间 {roomId}</span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
                <button className="btn-sidebar" style={{ whiteSpace: 'nowrap' }} onClick={() => wsClient.send('start_ai_game', { difficulty: aiDifficulty })}>🤖 AI 对弈</button>
                <Dropdown
                  options={[{value:'1',label:'简单'},{value:'2',label:'普通'},{value:'3',label:'中等'},{value:'4',label:'困难'}]}
                  value={String(aiDifficulty)}
                  onChange={v => setAiDifficulty(Number(v))}
                  direction="up"
                />
                <span style={{ position: 'relative' }}>
                  <span style={{ cursor: 'pointer', fontSize: 16, opacity: 0.7}} onClick={() => setShowDiffInfo(!showDiffInfo)}>🛈</span>
                  {showDiffInfo && (
                    <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', width: 180, fontSize: 12, lineHeight: 1.6, color: '#ccc', zIndex: 100, whiteSpace: 'nowrap' }}>
                      <div><b>简单</b> — 入门级</div>
                      <div><b>普通</b> — 业余初级</div>
                      <div><b>困难</b> — 业余中级</div>
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
                <button className="btn-sidebar" onClick={pass}>⏭️ Pass</button>
                <button className="btn-sidebar btn-resign" onClick={resign}>🏳️ 认输</button>
              </>
            )}
          </div>
      </aside>

      <main className="room-board" ref={boardContainerRef}>
        {!gameState ? (
          <div style={{ textAlign: 'center' }}>
            <GomokuBoard
              board={Array.from({ length: 15 }, () => Array(15).fill(null))}
              boardSize={15}
              lastMove={null}
              myColor={myColor}
              isMyTurn={false}
              onPlace={() => {}}
              width={boardPx.w}
              height={boardPx.h}
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
            <GomokuBoard
              board={gameState.board}
              boardSize={boardSize}
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
              {room?.players?.some(p => p.id === myId) ? (
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
              <div style={{ marginTop: 16, textAlign: 'center' }}><span style={{ fontSize: 32 }}>⏳</span></div>
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
              <p style={{ fontSize: 24, margin: '12px 0', color: '#dcb35c', fontWeight: 700 }}>数字 {guessFirstResult.number} · {guessFirstResult.choice}</p>
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
                <span style={{ color: guessFirstResult.challenger.color === 'black' ? '#dcb35c' : 'rgba(255,255,255,0.5)' }}>{guessFirstResult.challenger.username} {guessFirstResult.challenger.color === 'black' ? '⚫黑' : '⚪白'}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>vs</span>
                <span style={{ color: guessFirstResult.owner.color === 'black' ? '#dcb35c' : 'rgba(255,255,255,0.5)' }}>{guessFirstResult.owner.username} {guessFirstResult.owner.color === 'black' ? '⚫黑' : '⚪白'}</span>
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
