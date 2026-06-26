import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';
import { modalAlert } from '../components/Modal';
import { useFavicon } from '../hooks/useFavicon';
import StarfieldBackground from '../components/StarfieldBackground';
import UserProfileModal from '../components/UserProfileModal';
import type { RoomInfo, GameInfo } from '@lan-boardgame/shared';

export default function LobbyPage() {
  useFavicon('/favicon.svg');
  const nav = useNavigate();
  const token = localStorage.getItem('token');
  const { connected, send, onMessage } = useWebSocket();
  const [showDialog, setShowDialog] = useState(false);
  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);
  const [gameStats, setGameStats] = useState<Record<string, {rooms:number,players:number}>>({});
  const [emojiStats, setEmojiStats] = useState({ rooms: 0, players: 0 });
  const totalRooms = Object.values(gameStats).reduce((sum, g) => sum + g.rooms, 0);
  const totalPlayers = Object.values(gameStats).reduce((sum, g) => sum + g.players, 0);
  const [username, setUsername] = useState(localStorage.getItem('username') || '');
  const [games, setGames] = useState<GameInfo[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [bgEnabled, setBgEnabled] = useState(() => localStorage.getItem('lobby_bg') !== 'off');

  // 未登录重定向
  useEffect(() => { if (!token) nav('/login'); }, [token, nav]);

  // 加载游戏列表
  useEffect(() => {
    fetch('/api/games').then(r => r.json()).then(d => setGames(d.games || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const u1 = onMessage('room_list', (p) => { setRoomList(p.rooms || []); setGameStats(p.gameStats || {}); });
    const u2 = onMessage('room_created', (p) => {
      localStorage.setItem('username', username);
      nav(`/room/${p.roomId}`);
    });
    const u3 = onMessage('room_joined', (p) => {
      localStorage.setItem('username', username);
      nav(`/room/${p.roomId}`);
    });
    const u4 = onMessage('emoji_room_list', (p) => {
      const rooms = (p.rooms || []) as RoomInfo[];
      setEmojiStats({ rooms: rooms.length, players: rooms.reduce((s, r) => s + (r.playerCount || 0), 0) });
    });
      return () => { u1(); u2(); u3(); u4(); };
  }, [onMessage, nav, username]);

  // 连接成功后获取房间列表，之后每3秒刷新
  useEffect(() => {
    if (!connected) return;
    send('get_rooms', {});
    send('emoji_get_rooms', {});
    const timer = setInterval(() => { send('get_rooms', {}); send('emoji_get_rooms', {}); }, 3000);
    return () => clearInterval(timer);
  }, [connected, send]);

  const openGame = (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    if (!game || game.status !== 'ready') {
      modalAlert('游戏开发中，请稍待！');
      return;
    }
    setSelectedGame(game);
    if (game.id === 'emoji') {
      send('emoji_get_rooms', {});
    } else {
      send('get_rooms');
    }
    setShowDialog(true);
  };

  const createRoom = () => {
    const id = selectedGame?.id || 'go';
    if (id === 'emoji') {
      localStorage.setItem('emoji_username', username || '玩家');
      send('emoji_create_room', { username: username || '玩家' });
      nav('/emoji');
      return;
    }
    let cfg: { rows: number; cols: number; extra: Record<string, number | string | boolean> };
    if (id === 'gomoku') {
      cfg = { rows: 15, cols: 15, extra: {} };
    } else if (id === 'chinese-chess') {
      cfg = { rows: 10, cols: 9, extra: {} };
    } else if (id === 'chess') {
      cfg = { rows: 8, cols: 8, extra: {} };
    } else if (id === 'draughts') {
      cfg = { rows: 10, cols: 10, extra: {} };
    } else {
      cfg = { rows: 19, cols: 19, extra: { boardSize: 19, ruleSet: 'chinese', komi: 7.5, handicap: 0 } };
    }
    send('create_room', { gameType: id, username: username || '玩家', config: cfg });
  };

  const joinRoom = (roomId: string) => {
    if (selectedGame?.id === 'emoji') {
      localStorage.setItem('emoji_username', username || '玩家');
      send('emoji_join_room', { roomId, username: username || '玩家' });
      nav('/emoji');
      return;
    }
    send('join_room', { roomId, username: username || '观战者' });
  };

  return (
    <div className="lobby-page">
      <StarfieldBackground enabled={bgEnabled} />
      <header className="lobby-header">
        <h1>游戏大厅</h1>
        <div className="lobby-header-left">
        <span className={`status-dot ${connected ? 'online' : 'offline'}`}>
          {connected ? '已连接' : '连接中...'}
        </span>
          共 <span className="stat-green">{totalRooms}</span> 个房间，
          共 <span className="stat-green">{totalPlayers}</span> 人在线
        </div>
        <div className="lobby-header-right">
          <button
            className="btn-username"
            onClick={() => setShowProfile(true)}
            title="查看个人资料"
          >{username || '玩家'}</button>
          <button className="btn-logout" onClick={() => nav('/login')} title="退出登录">退出</button>
          <button
            className="btn-bg-toggle"
            onClick={() => {
              const next = !bgEnabled;
              setBgEnabled(next);
              localStorage.setItem('lobby_bg', next ? 'on' : 'off');
            }}
            title={bgEnabled ? '关闭背景动效' : '开启背景动效'}
          >{bgEnabled ? '✦' : '✧'}</button>
        </div>
      </header>

      <div className="game-grid">
        {games.map(game => (
          <div
            key={game.id}
            data-game={game.id}
            className={`game-card ${game.status === 'ready' ? 'card-ready' : 'card-coming'}`}
            onClick={() => openGame(game.id)}
          >
            {game.icon_svg && (
              <div className="game-icon" dangerouslySetInnerHTML={{ __html: game.icon_svg }} />
            )}
            <h2>{game.name}</h2>
            <p>{game.description}</p>
            {game.status === 'ready' && (
              <p className={(game.id === 'emoji' ? emojiStats.rooms > 0 : gameStats[game.id]) ? 'game-stats' : 'game-stats-empty'}>
                {game.id === 'emoji'
                  ? (emojiStats.rooms > 0 ? `🟢 ${emojiStats.rooms}个房间 · ${emojiStats.players}人在线` : '💤💤💤')
                  : (gameStats[game.id] ? `🟢 ${gameStats[game.id].rooms}个房间 · ${gameStats[game.id].players}人在线` : '💤💤💤')
                }
              </p>
            )}
            {game.status !== 'ready' && <span className="badge">开发中</span>}
          </div>
        ))}
      </div>

      {showDialog && (
        <div className="modal-overlay" onClick={() => setShowDialog(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{selectedGame?.name || '围棋'} · 房间</h2>
            <button className="btn-primary" onClick={createRoom}>创建房间</button>
            <div className="room-divider" />
            <div className="room-list">
              {(() => {
                const filtered = roomList.filter(r => r.gameType === selectedGame?.id);
                return filtered.length === 0 ? (
                  <p className="text-muted room-empty">暂无房间 💤</p>
                ) : (
                  filtered.map(r => (
                    <div key={r.roomId} className="room-list-item" onClick={() => joinRoom(r.roomId)}>
                      <span className="room-owner">👑 {r.owner}</span>
                      <span className="room-count">{r.totalPeople}/{selectedGame?.id === 'emoji' ? 10 : 2} 人</span>
                      <button className="btn-small">加入</button>
                    </div>
                  ))
                );
              })()}
            </div>
            <button className="btn-close" onClick={() => setShowDialog(false)}>关闭</button>
          </div>
        </div>
      )}

      {showProfile && username && (
        <UserProfileModal username={username} isMe onClose={() => setShowProfile(false)} />
      )}
    </div>
  );
}
