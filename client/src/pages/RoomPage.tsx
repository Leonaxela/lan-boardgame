import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { wsClient } from '../net/WebSocketClient';
import GoRoomPage from './go/RoomPage';
import GomokuRoomPage from './gomoku/RoomPage';
import ChineseChessRoomPage from './chinese-chess/RoomPage';
import ChessRoomPage from './chess/RoomPage';
import DraughtsRoomPage from './draughts/RoomPage';

export default function RoomPage() {
  const { roomId } = useParams();
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

    return () => unsubs.forEach(fn => fn());
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
