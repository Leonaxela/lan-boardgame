import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsClient } from '../../net/WebSocketClient';
import { useFavicon } from '../../hooks/useFavicon';
import { modalAlert, modalConfirm } from '../../components/Modal';

interface Player {
  id: string;
  username: string;
  seat: number;
  score: number;
  hasAnswered: boolean;
}

interface RoomState {
  roomId: string;
  owner: { id: string; username: string; seat: number };
  players: Player[];
  phase: string;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  difficultyConfig: { easy: number; normal: number; hard: number };
}

interface Question { id: number; emoji: string; difficulty: string; }
interface RevealResult { id: string; username: string; answer: string; correct: boolean; score: number; }

const SEAT_POSITIONS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i * 36 - 90) * (Math.PI / 180);
  return { x: 350 + 270 * Math.cos(angle), y: 250 + 170 * Math.sin(angle) };
});

export default function EmojiGamePage() {
  useFavicon('/go-icon.svg');
  const nav = useNavigate();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [screen, setScreen] = useState<'room' | 'game' | 'result'>('room');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [revealResults, setRevealResults] = useState<RevealResult[]>([]);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [ranking, setRanking] = useState<any[]>([]);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [diffConfig, setDiffConfig] = useState({ easy: 4, normal: 4, hard: 2 });
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(wsClient.on('emoji_room_created', (p) => { setRoom(p.room); setMyPlayer(p.player); }));
    unsubs.push(wsClient.on('emoji_room_joined', (p) => { setRoom(p.room); setMyPlayer(p.player); }));
    unsubs.push(wsClient.on('emoji_player_joined', (p) => { setRoom(p.room); }));
    unsubs.push(wsClient.on('emoji_player_left', (p) => { setRoom(p.room); }));
    unsubs.push(wsClient.on('emoji_room_destroyed', (p) => { modalAlert(p.message); setRoom(null); nav('/'); }));
    unsubs.push(wsClient.on('emoji_game_start', (p) => {
      setRoom(p.room); setCurrentQuestion(p.question); setScreen('game');
      setAnswer(''); setRevealResults([]); setCorrectAnswer(''); setAnsweredCount(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }));
    unsubs.push(wsClient.on('emoji_next_question', (p) => {
      setRoom(p.room); setCurrentQuestion(p.question); setScreen('game');
      setAnswer(''); setRevealResults([]); setCorrectAnswer(''); setAnsweredCount(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }));
    unsubs.push(wsClient.on('emoji_timer', (p) => { setTimeLeft(p.timeLeft); }));
    unsubs.push(wsClient.on('emoji_answered', (p) => { setAnsweredCount(p.total); setRoom(p.room); }));
    unsubs.push(wsClient.on('emoji_reveal', (p) => {
      setRevealResults(p.results); setCorrectAnswer(p.correctAnswer); setRoom(p.room);
    }));
    unsubs.push(wsClient.on('emoji_game_over', (p) => { setRanking(p.ranking); setRoom(p.room); setScreen('result'); }));
    unsubs.push(wsClient.on('emoji_difficulty_updated', (p) => { setDiffConfig(p.difficultyConfig); }));
    unsubs.push(wsClient.on('emoji_error', (p) => { modalAlert(p.message); }));
    return () => unsubs.forEach(fn => fn());
  }, []);

  useEffect(() => { if (!room) { const t = setTimeout(() => nav('/'), 500); return () => clearTimeout(t); } }, [room, nav]);

  const isOwner = room?.owner?.id === myPlayer?.id;
  const countdownColor = timeLeft <= 10 ? '#ef4444' : timeLeft <= 30 ? '#f59e0b' : '#22c55e';

  const startGame = () => { wsClient.send('emoji_start_game', {}); setShowSettings(false); };
  const submitAnswer = () => { if (!answer.trim()) return; wsClient.send('emoji_answer', { answer }); setAnswer(''); };
  const nextQuestion = () => { wsClient.send('emoji_next_question', {}); };
  const leaveRoom = async () => {
    if (isOwner) {
      const ok = await modalConfirm('房主退出房间，将销毁房间并清空所有房间人员！');
      if (!ok) return;
      wsClient.send('emoji_owner_exit', {});
      nav('/');
    } else {
      wsClient.send('emoji_leave_room', {});
      nav('/');
    }
  };
  const updateDifficulty = (diff: string, val: number) => {
    const c = { ...diffConfig, [diff]: val };
    setDiffConfig(c);
    wsClient.send('emoji_set_difficulty', c);
  };

  if (!room) return <div style={{ minHeight: '100vh', background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 16 }}>加载中...</div>;

  const diffTotal = diffConfig.easy + diffConfig.normal + diffConfig.hard;

  // ── 圆桌等待界面 ──
  if (screen === 'room') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1520 100%)', display: 'flex' }}>
        {/* 左侧：玩家列表 */}
        <div style={{ width: 220, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8, paddingLeft: 8 }}>玩家 ({room.players.length}/10)</h3>
          {room.players.map((p) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
              background: p.id === myPlayer?.id ? 'rgba(220,179,92,0.12)' : 'rgba(255,255,255,0.03)',
              border: p.id === myPlayer?.id ? '1px solid rgba(220,179,92,0.25)' : '1px solid rgba(255,255,255,0.04)',
            }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(220,179,92,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {p.id === room.owner.id ? '👑' : '😊'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: p.id === myPlayer?.id ? '#dcb35c' : '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.username}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>座位 {p.seat + 1}</div>
              </div>
            </div>
          ))}
          {Array.from({ length: Math.max(0, 4 - room.players.length) }).map((_, i) => (
            <div key={`empty-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.06)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>+</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.15)' }}>等待加入...</div>
            </div>
          ))}
        </div>

        {/* 中间：圆桌 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
          <div style={{ position: 'relative', width: 700, height: 500 }}>
            <svg width="700" height="500" viewBox="0 0 700 500" style={{ position: 'absolute', top: 0, left: 0 }}>
              <defs>
                <radialGradient id="tableGrad" cx="50%" cy="50%">
                  <stop offset="0%" stopColor="#3d2b10" />
                  <stop offset="70%" stopColor="#2a1c0a" />
                  <stop offset="100%" stopColor="#1a1208" />
                </radialGradient>
                <filter id="tableShadow"><feDropShadow dx="0" dy="4" stdDeviation="12" floodColor="#000" floodOpacity="0.4" /></filter>
              </defs>
              <ellipse cx="350" cy="250" rx="270" ry="170" fill="url(#tableGrad)" stroke="#b8963e" strokeWidth="1.5" filter="url(#tableShadow)" />
              <ellipse cx="350" cy="250" rx="220" ry="135" fill="none" stroke="rgba(184,150,62,0.15)" strokeWidth="1" strokeDasharray="4 4" />
              <text x="350" y="242" textAnchor="middle" fill="rgba(184,150,62,0.25)" fontSize="16" fontWeight="600">😀 Emoji</text>
              <text x="350" y="265" textAnchor="middle" fill="rgba(184,150,62,0.2)" fontSize="14">猜猜乐</text>
            </svg>
            {SEAT_POSITIONS.map((pos, i) => {
              const player = room.players.find(p => p.seat === i);
              const isMe = player?.id === myPlayer?.id;
              return (
                <div key={i} style={{
                  position: 'absolute', left: pos.x - 30, top: pos.y - 30, width: 60, height: 60, borderRadius: '50%',
                  border: isMe ? '2.5px solid #dcb35c' : player ? '2px solid rgba(184,150,62,0.35)' : '2px dashed rgba(255,255,255,0.08)',
                  background: player ? (isMe ? 'rgba(220,179,92,0.2)' : 'rgba(184,150,62,0.1)') : 'rgba(255,255,255,0.02)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.3s ease', boxShadow: isMe ? '0 0 12px rgba(220,179,92,0.2)' : 'none',
                }}>
                  {player ? (
                    <>
                      <span style={{ fontSize: 20 }}>{player.id === room.owner.id ? '👑' : '😊'}</span>
                      <span style={{ fontSize: 10, color: isMe ? '#dcb35c' : 'rgba(255,255,255,0.5)', marginTop: 2, maxWidth: 54, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.username}</span>
                    </>
                  ) : <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.08)' }}>+</span>}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {isOwner && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button onClick={() => setShowSettings(!showSettings)}
                  style={{ padding: '10px 36px', borderRadius: 10, fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>⚙️ 题目配置</button>
                <button onClick={startGame} disabled={room.players.length < 2}
                  style={{ padding: '10px 36px', borderRadius: 10, fontSize: 15, fontWeight: 700, border: 'none',
                    cursor: room.players.length >= 2 ? 'pointer' : 'not-allowed',
                    background: room.players.length >= 2 ? 'linear-gradient(135deg, #dcb35c, #b8963e)' : 'rgba(255,255,255,0.06)',
                    color: room.players.length >= 2 ? '#1a1208' : 'rgba(255,255,255,0.2)',
                    boxShadow: room.players.length >= 2 ? '0 4px 16px rgba(220,179,92,0.25)' : 'none' }}>🎮 开始游戏</button>
              </div>
            )}
            {showSettings && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '16px 24px', background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', marginTop: 8 }}>
                {([['easy', '简单', '#22c55e'], ['normal', '普通', '#f59e0b'], ['hard', '困难', '#ef4444']] as const).map(([k, label, color]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color, fontSize: 13, fontWeight: 600, width: 60 }}>{label} <strong>{diffConfig[k]}</strong></span>
                    <input type="range" min="0" max="10" value={diffConfig[k]} onChange={e => updateDifficulty(k, parseInt(e.target.value))}
                      style={{ width: 100, height: 6, accentColor: color, cursor: 'pointer' }} />
                  </div>
                ))}
                <span style={{ fontSize: 13, fontWeight: 600, color: diffTotal > 0 ? '#dcb35c' : '#ef4444' }}>共 {diffTotal} 题</span>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：房间信息 */}
        <div style={{ width: 200, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>房间信息</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#dcb35c', marginBottom: 4 }}>{room.roomId}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>房主: {room.owner.username}</div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>规则</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
              <div>🟢 简单 <span style={{ color: '#22c55e', fontWeight: 600 }}>{diffConfig.easy} 题</span></div>
              <div>🟡 普通 <span style={{ color: '#f59e0b', fontWeight: 600 }}>{diffConfig.normal} 题</span></div>
              <div>🔴 困难 <span style={{ color: '#ef4444', fontWeight: 600 }}>{diffConfig.hard} 题</span></div>
              <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.3)' }}>共 {diffTotal} 题 · 每题 60 秒</div>
            </div>
          </div>
          <button onClick={leaveRoom} style={{ padding: '10px 0', borderRadius: 8, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>退出房间</button>
        </div>
      </div>
    );
  }

  // ── 游戏中 ──
  if (screen === 'game' && room && currentQuestion) {
    const leftPlayers = room.players.slice(0, 5);
    const rightPlayers = room.players.slice(5, 10);
    const revealed = revealResults.length > 0;

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1520 100%)', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部信息栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>第 <strong style={{ color: '#e0e0e0' }}>{room.currentQuestion + 1}</strong>/{room.totalQuestions} 题</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 140, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(timeLeft / 60) * 100}%`, height: '100%', background: countdownColor, borderRadius: 3, transition: 'width 1s linear' }} />
            </div>
            <span style={{ color: countdownColor, fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{timeLeft}s</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>已答 <strong style={{ color: '#e0e0e0' }}>{answeredCount}</strong>/{room.players.length}</span>
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', padding: '20px 24px', gap: 20 }}>
          {/* 左侧玩家 */}
          <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            {leftPlayers.map(p => <AnswerCard key={p.id} player={p} isMe={p.id === myPlayer?.id} revealed={revealed} result={revealResults.find(r => r.id === p.id)} />)}
          </div>

          {/* 中间题目区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: '100%', maxWidth: 820, padding: '68px 30px', borderRadius: 24, textAlign: 'center',
              background: 'linear-gradient(145deg, rgba(220,179,92,0.08), rgba(220,179,92,0.02))',
              border: '1px solid rgba(220,179,92,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 20 }}>
                {currentQuestion.difficulty === 'easy' ? '🟢 简单' : currentQuestion.difficulty === 'normal' ? '🟡 普通' : '🔴 困难'}
              </div>
              <div style={{ fontSize: 120, lineHeight: 1, marginBottom: 24, textShadow: '0 0 40px rgba(220,179,92,0.15)' }}>
                {currentQuestion.emoji}
              </div>

              {!revealed ? (
                <div style={{ display: 'flex', gap: 8, maxWidth: 360, margin: '0 auto' }}>
                  <input ref={inputRef} value={answer} onChange={e => setAnswer(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitAnswer(); }}
                    placeholder="输入你的答案..."
                    style={{ flex: 1, padding: '14px 18px', borderRadius: 12, border: '1.5px solid rgba(220,179,92,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 16, outline: 'none' }} />
                  <button onClick={submitAnswer} disabled={!answer.trim()}
                    style={{ padding: '14px 24px', borderRadius: 12, fontWeight: 700, border: 'none', fontSize: 15, cursor: answer.trim() ? 'pointer' : 'not-allowed',
                      background: answer.trim() ? 'linear-gradient(135deg, #dcb35c, #b8963e)' : 'rgba(255,255,255,0.06)',
                      color: answer.trim() ? '#1a1208' : 'rgba(255,255,255,0.2)' }}>提交</button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 12, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <span style={{ color: '#22c55e', fontSize: 20, fontWeight: 700 }}>答案：{correctAnswer}</span>
                  </div>
                  {isOwner && (
                    <div style={{ marginTop: 16 }}>
                      <button onClick={nextQuestion}
                        style={{ padding: '10px 32px', borderRadius: 10, background: 'linear-gradient(135deg, #dcb35c, #b8963e)', color: '#1a1208', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: 14, boxShadow: '0 4px 16px rgba(220,179,92,0.25)' }}>
                        {room.currentQuestion < room.totalQuestions - 1 ? '下一题 ▶' : '查看结果 🏆'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 右侧玩家 */}
          <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            {rightPlayers.map(p => <AnswerCard key={p.id} player={p} isMe={p.id === myPlayer?.id} revealed={revealed} result={revealResults.find(r => r.id === p.id)} />)}
          </div>
        </div>
      </div>
    );
  }

  // ── 结果 ──
  if (screen === 'result') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1520 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🏆</div>
        <h1 style={{ fontSize: 32, color: '#dcb35c', marginBottom: 4, fontWeight: 700 }}>游戏结束</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 32, fontSize: 14 }}>最终排名</p>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {ranking.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', marginBottom: 6,
              background: i === 0 ? 'linear-gradient(135deg, rgba(220,179,92,0.12), rgba(220,179,92,0.04))' : 'rgba(255,255,255,0.02)',
              border: i === 0 ? '1.5px solid rgba(220,179,92,0.25)' : '1px solid rgba(255,255,255,0.04)',
              borderRadius: 12,
            }}>
              <span style={{ fontSize: 28, width: 36, textAlign: 'center' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>{i + 1}</span>}</span>
              <span style={{ flex: 1, color: '#e0e0e0', fontWeight: i === 0 ? 700 : 500, fontSize: 15 }}>{p.username}</span>
              <span style={{ color: '#dcb35c', fontWeight: 700, fontSize: 16 }}>{p.score}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>分</span></span>
            </div>
          ))}
        </div>
        <button onClick={() => nav('/')} style={{ marginTop: 28, padding: '12px 36px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>返回大厅</button>
      </div>
    );
  }

  return null;
}

// ── 答题板组件 ──
function AnswerCard({ player, isMe, revealed, result }: { player: Player; isMe: boolean; revealed: boolean; result?: RevealResult }) {
  const show = revealed && result;
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10, textAlign: 'center', transition: 'all 0.3s',
      background: isMe ? 'rgba(220,179,92,0.1)' : 'rgba(255,255,255,0.025)',
      border: isMe ? '1px solid rgba(220,179,92,0.2)' : '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: isMe ? '#dcb35c' : '#c0c0c0', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.username}</div>
      {/* 答题板 */}
      <div style={{
        padding: '6px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
        background: show ? (result!.correct ? '#fff' : '#fff') : 'rgba(255,255,255,0.06)',
        color: show ? (result!.correct ? '#16a34a' : '#1a1a1a') : 'rgba(255,255,255,0.35)',
        border: show ? (result!.correct ? '1.5px solid #16a34a' : '1.5px solid #d1d5db') : 'none',
        transition: 'all 0.3s',
      }}>
        {show ? (
          result!.correct ? `✅ ${result!.answer || '—'}` : `❌ ${result!.answer || '—'}`
        ) : (
          player.hasAnswered ? '已提交' : '答题中'
        )}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>{player.score} 分</div>
    </div>
  );
}
