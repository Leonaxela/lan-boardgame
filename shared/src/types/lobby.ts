/**
 * 大厅页面相关类型定义
 */

/** 房间列表项（来自 WS room_list 消息） */
export interface RoomInfo {
  roomId: string;
  owner: string;
  gameType: string;
  totalPeople: number;
  playerCount?: number;
}

/** 游戏信息（来自 GET /api/games，对应 DB games 表） */
export interface GameInfo {
  id: string;
  name: string;
  description: string;
  icon_svg: string;
  sort_order: number;
  enabled: number;
  status: 'ready' | 'developing';
  created_at: string;
}
