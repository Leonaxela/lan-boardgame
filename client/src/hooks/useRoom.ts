import { useState, useCallback, useEffect, useRef } from 'react';
import { wsClient } from '../net/WebSocketClient';
import { modalAlert, modalConfirm } from '../components/Modal';

interface RoomPlayer {
  id: string;
  username: string;
  color: string;
  isOwner?: boolean;
}

interface RoomSnapshot {
  roomId: string;
  gameType: string;
  activity: string;
  owner: RoomPlayer | null;
  players: RoomPlayer[];
  spectators: { id: string; username: string }[];
  playerCount: number;
  spectatorCount: number;
}

interface ChatMessage {
  playerId: string;
  username: string;
  text: string;
  timestamp: number;
  /** 系统消息标记：true 时按系统消息样式渲染 */
  isSystem?: boolean;
  /** 需要在 text 中高亮显示的人名/关键词列表 */
  highlights?: string[];
}

interface GameResult {
  winner: { id: string; name: string; color: string } | null;
  reason: string;
  scores: Record<string, number>;
}

export function useRoom() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const setMyIdAndRef = (id: string | null) => { setMyId(id); myIdRef.current = id; };
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [gameState, setGameState] = useState<any>(null);
  const [challengeState, setChallengeState] = useState<string | null>(null);
  const [challengeChallenger, setChallengeChallenger] = useState('');
  const [myColor, setMyColor] = useState<string | null>(null);
  const myIdRef = useRef<string | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [rematchState, setRematchState] = useState<string | null>(null);

  // 猜先状态
  const [guessFirstPhase, setGuessFirstPhase] = useState<string | null>(null); // 'prompt_number' | 'waiting_choice' | 'prompt_choice' | 'result' | null
  const [guessFirstResult, setGuessFirstResult] = useState<any>(null);
  const [guessFirstChallenger, setGuessFirstChallenger] = useState('');

  // KataGo 分析报告
  const [katagoAnalysisReport, setKatagoAnalysisReport] = useState<any>(null);

  const createRoom = useCallback((gameType: string, username: string) => {
    wsClient.send('create_room', {
      gameType, username,
      config: { rows: 19, cols: 19, extra: { boardSize: 19, ruleSet: 'chinese', komi: 7.5, handicap: 0 } },
    });
  }, []);

  const joinRoom = useCallback((roomId: string, username: string) => {
    wsClient.send('join_room', { roomId, username });
  }, []);

  const place = useCallback((row: number, col: number) => {
    wsClient.send('place', { position: { row, col } });
  }, []);

  const pass = useCallback(() => { wsClient.send('pass', {}); }, []);
  const applyCounting = useCallback(() => { wsClient.send('apply_counting', {}); }, []);
  const resign = useCallback(() => { wsClient.send('resign', {}); }, []);
  const challenge = useCallback(() => { wsClient.send('challenge', {}); }, []);
  const respondChallenge = useCallback((accepted: boolean) => {
    wsClient.send('challenge_response', { accepted });
  }, []);
  const leaveRoom = useCallback(() => { localStorage.removeItem('rejoin_room'); wsClient.send('leave_room', {}); }, []);
  const sendChat = useCallback((text: string) => { wsClient.send('chat', { text }); }, []);
  const sendGuessNumber = useCallback((number: number) => { wsClient.send('guess_first_number', { number }); }, []);
  const sendGuessChoice = useCallback((choice: string) => { wsClient.send('guess_first_choice', { choice }); }, []);
  const sendRpsChoice = useCallback((choice: string) => { wsClient.send('guess_first_number', { rps: choice }); }, []);

  // KataGo 对弈
  const startKatagoGame = useCallback((config: { boardSize: number; rules: string; maxVisits: number; maxTime: number; playerColor: string }) => {
    wsClient.send('start_katago_game', config);
  }, []);

  // 再战一局
  const requestRematch = useCallback(() => {
    wsClient.send('rematch', {});
  }, []);

  const exitAfterGame = useCallback(() => {
    wsClient.send('rematch_response', {});
    setGameResult(null);
    setRematchState(null);
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(wsClient.on('room_created', (p) => { setRoom(p.room); setMyIdAndRef(p.player.id); setChatMessages([]); setGameState(null); setGameResult(null);  setMyColor(p.player.color); }));
    unsubs.push(wsClient.on('room_joined', (p) => { setRoom(p.room); setMyIdAndRef(p.player.id); setChatMessages([]); setGameState(null); setGameResult(null); setMyColor(p.player.color); }));
    unsubs.push(wsClient.on('room_updated', (p) => { setRoom(p.room); if (p.room?.gameState) setGameState(p.room.gameState); else setGameState(null); const me = p.room?.players?.find((pl: any) => pl.id === myIdRef.current); if (me) setMyColor(me.color); }));

    unsubs.push(wsClient.on('room_destroyed', (p) => {
      setRoom(null); setMyIdAndRef(null); setGameState(null); setGameResult(null); setKatagoAnalysisReport(null); localStorage.removeItem('rejoin_room');
      if (window.location.pathname.startsWith('/room/')) {
        window.location.href = '/';
      }
    }));

    unsubs.push(wsClient.on('game_started', (p) => {
      setGameState(p.gameState);
      setGameResult(null);
      setGuessFirstPhase(null);
      setRematchState(null);
      setChallengeState(null);
      setChallengeChallenger('');
      setKatagoAnalysisReport(null); // 新对局清空分析报告
      // 从 game_started 重建房间状态
      if (p.players && p.gameState) {
        setRoom((prev: any) => {
          if (!prev) return prev;
          // 同步更新 owner 的颜色
          const updatedPlayers = p.players;
          let newOwner = prev.owner;
          if (newOwner) {
            const updated = updatedPlayers.find((pl: any) => pl.id === newOwner.id);
            if (updated) newOwner = { ...newOwner, color: updated.color, username: updated.username };
          }
          return { ...prev, owner: newOwner, players: updatedPlayers, activity: 'playing', gameState: p.gameState };
        });
        // 更新 myColor
        const me = p.players.find((pl: any) => pl.id === myIdRef.current);
        if (me) setMyColor(me.color);
      }
    }));

    unsubs.push(wsClient.on('game_state', (p) => { setGameState(p.gameState); }));

    // 申请终局数子
    unsubs.push(wsClient.on('counting_sent', (p) => { modalAlert(p.message || '已申请终局数子'); }));
    unsubs.push(wsClient.on('counting_rejected', (p) => { modalAlert(p.message || '对方拒绝终局数子'); }));
    unsubs.push(wsClient.on('counting_request', (p) => {
      modalConfirm(`${p.username || '对手'} 申请终局数子，是否同意？`).then(ok => {
        wsClient.send('counting_response', { accepted: ok });
      });
    }));

    unsubs.push(wsClient.on('game_over', (p) => {
      setGameState(p.gameState);
      setGameResult(p.result);
      setRematchState(null);
    }));

    unsubs.push(wsClient.on('chat', (p) => { setChatMessages(prev => [...prev, p]); }));
    unsubs.push(wsClient.on('challenge_sent', (p) => { setChallengeState('sent'); }));
    unsubs.push(wsClient.on('challenge_request', (p) => { setChallengeState('received'); setChallengeChallenger(p.challenger?.username || ''); }));
    unsubs.push(wsClient.on('challenge_timeout', () => { setChallengeState(null); setChallengeChallenger(''); modalAlert('⏰ 申请超时'); }));
    unsubs.push(wsClient.on('challenge_response', (p) => { setChallengeChallenger('');
      if (!p.accepted && p.message !== '已拒绝') modalAlert(p.message || '对局请求被拒绝');
      setChallengeState(null);
    }));

    // 猜先
    unsubs.push(wsClient.on('guess_first_start', () => { setChallengeState(null); setChallengeChallenger(''); setGuessFirstPhase(null); setGuessFirstResult(null); }));
    unsubs.push(wsClient.on('guess_first_prompt_number', () => { setTimeout(() => setGuessFirstPhase('prompt_number'), 1000); }));
    unsubs.push(wsClient.on('guess_first_number_submitted', () => { setGuessFirstPhase('waiting_choice'); }));
    unsubs.push(wsClient.on('guess_first_prompt_choice', (p) => { setGuessFirstPhase(p.waiting ? 'waiting_choice' : 'prompt_choice'); setGuessFirstChallenger(p.challenger || ''); }));
    unsubs.push(wsClient.on('guess_first_result', (p) => { setGuessFirstResult(p); setGuessFirstPhase('result'); }));

    // 再战
    unsubs.push(wsClient.on('player_rejoined', () => { wsClient.send('get_rooms', {}); }));
    unsubs.push(wsClient.on('rematch_self', (p) => { setRematchState('sent'); }));
    unsubs.push(wsClient.on('rematch_notify', (p) => {
      setRematchState(p.bothReady ? 'both_ready' : 'opponent_sent');
    }));
    unsubs.push(wsClient.on('rematch_exit', (p) => {
      setRematchState('opponent_exited');
      setTimeout(() => { setGameResult(null); setRematchState(null); }, 2000);
    }));

    unsubs.push(wsClient.on('error', (p) => { modalAlert(`错误：${p.message}`); }));

    // KataGo 分析报告（仅对弈者收到）
    unsubs.push(wsClient.on('katago_analysis_report', (p) => {
      setKatagoAnalysisReport(p);
    }));

    return () => unsubs.forEach(fn => fn());
  }, []);

  // 断线重连：自动恢复房间
  useEffect(() => {
    const stored = localStorage.getItem('rejoin_room');
    if (stored) {
      try {
        const { roomId, playerId } = JSON.parse(stored);
        if (roomId && playerId) {
          wsClient.send('rejoin_room', { roomId, playerId });
        }
      } catch {}
    }
  }, []);

  return {
    room, myId, myColor, chatMessages, gameState, gameResult, rematchState, challengeState, challengeChallenger,
    guessFirstPhase, guessFirstResult, guessFirstChallenger,
    isMyTurn: gameState?.currentTurn === myColor,
    isPlayer: room?.players.some(p => p.id === myId) ?? false,
    createRoom, joinRoom, place, pass, applyCounting, resign, challenge, respondChallenge,
    leaveRoom, sendChat, requestRematch, exitAfterGame,
    sendGuessNumber, sendGuessChoice, sendRpsChoice,
    startKatagoGame,
    clock: gameState?.clock || null,
    katagoAnalysisReport,
  };
}
