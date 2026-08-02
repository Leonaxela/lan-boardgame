import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { wsClient } from '../net/WebSocketClient';
import { modalAlert } from '../components/Modal';
import GoRoomPage from './go/RoomPage';
import GomokuRoomPage from './gomoku/RoomPage';
import ChineseChessRoomPage from './chinese-chess/RoomPage';
import ChessRoomPage from './chess/RoomPage';
import DraughtsRoomPage from './draughts/RoomPage';

export default function RoomPage() {
  const { roomId } = useParams();
  const nav = useNavigate();
  const [gameType, setGameType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // wsClient.on() 注册后立即用缓存数据调用 handler（如果存在）
    // 解决页面跳转后事件已发出的问题
    const unsubs: (() => void)[] = [];

    const resolveType = (payload: any) => {
      const gt = payload?.room?.gameType;
      if (gt) {
        setGameType(gt);
        setLoading(false);
      }
    };

    unsubs.push(wsClient.on('room_created', resolveType));
    unsubs.push(wsClient.on('room_joined', resolveType));
    unsubs.push(wsClient.on('room_updated', resolveType));

    // 刷新/直链进入：先确保 WS 已连接，再凭 localStorage 里的重连凭据自动 rejoin
    wsClient.connect().then(() => {
      const stored = localStorage.getItem('rejoin_room');
      if (stored) {
        try {
          const { roomId, playerId } = JSON.parse(stored);
          if (roomId && playerId) {
            wsClient.send('rejoin_room', { roomId, playerId });
          }
        } catch {}
      }
    }).catch(() => {});

    // 兜底：8 秒仍未解析出游戏类型（房间不存在/无重连凭据），回大厅避免永久 loading
    const fallback = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          modalAlert('无法连接到房间，可能已被销毁');
          wsClient.clearCache(); // 清掉残留 room_joined 缓存，避免回大厅后被旧缓存拉回房间（闪屏）
          nav('/');
        }
        return prev;
      });
    }, 8000);

    return () => {
      unsubs.forEach(fn => fn());
      clearTimeout(fallback);
    };
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <p>正在连接房间 {roomId}...</p>
      </div>
    );
  }

  if (gameType === 'gomoku') {
    return <GomokuRoomPage />;
  }
  if (gameType === 'chinese-chess') {
    return <ChineseChessRoomPage />;
  }
  if (gameType === 'chess') {
    return <ChessRoomPage />;
  }
  if (gameType === 'draughts') {
    return <DraughtsRoomPage />;
  }
  return <GoRoomPage />;
}
