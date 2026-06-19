/**
 * 活跃房间 + 在线用户持久化。
 * 每次房间/用户状态变化时同步写入 DB。
 */

import { execute, queryOne, queryAll } from '../db/connection.js';

// ══════════════════════════════════════════════
//  活跃房间
// ══════════════════════════════════════════════

export function saveActiveRoom(
  roomId: string, ownerId: string, ownerName: string,
  gameType: string, config: any, activity: string, playerIds: string[],
): void {
  execute(
    `INSERT OR REPLACE INTO active_rooms (room_id, owner_id, owner_name, game_type, config, activity, player_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
       COALESCE((SELECT created_at FROM active_rooms WHERE room_id = ?), datetime('now', 'localtime')))`,
    [roomId, ownerId, ownerName, gameType, JSON.stringify(config), activity, JSON.stringify(playerIds), roomId]
  );
}

export function removeActiveRoom(roomId: string): void {
  execute('DELETE FROM active_rooms WHERE room_id = ?', [roomId]);
}

/** 记录房间销毁时间 */
export function logRoomDestroyed(roomId: string): void {
  try {
    execute(
      `UPDATE room_logs SET destroyed_at = datetime('now', 'localtime') WHERE room_id = ? AND destroyed_at IS NULL`,
      [roomId]
    );
  } catch {}
}

export function clearActiveRooms(): void {
  execute('DELETE FROM active_rooms');
}

// ══════════════════════════════════════════════
//  在线用户
// ══════════════════════════════════════════════

export function upsertUserSession(userId: string, username: string, roomId: string | null): void {
  if (roomId) {
    execute(
      `INSERT INTO user_sessions (user_id, username, room_id, last_ping)
       VALUES (?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, room_id=excluded.room_id, last_ping=datetime('now', 'localtime')`,
      [userId, username, roomId]
    );
  } else {
    execute(
      `INSERT INTO user_sessions (user_id, username, last_ping)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, last_ping=datetime('now', 'localtime')`,
      [userId, username]
    );
  }
}

export function updateUserRoom(userId: string, roomId: string | null): void {
  if (roomId) {
    execute('UPDATE user_sessions SET room_id = ?, last_ping = datetime(\'now\') WHERE user_id = ?', [roomId, userId]);
  } else {
    execute('UPDATE user_sessions SET room_id = NULL, last_ping = datetime(\'now\') WHERE user_id = ?', [userId]);
  }
}

export function removeUserSession(userId: string): void {
  execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
}

export function getOnlineCount(): number {
  const row = queryOne('SELECT COUNT(*) as c FROM user_sessions WHERE room_id IS NOT NULL') as any;
  return row?.c ?? 0;
}

export function getOnlineUsers(): { user_id: string; username: string; room_id: string; game_type: string; activity: string; is_owner: boolean; is_player: boolean }[] {
  return queryAll(`
    SELECT s.user_id, s.username, s.room_id,
           COALESCE(r.game_type, '') as game_type,
           COALESCE(r.activity, '') as activity,
           CASE WHEN r.owner_id = s.user_id THEN 1 ELSE 0 END as is_owner,
           CASE WHEN EXISTS (
             SELECT 1 FROM json_each(r.player_ids) WHERE json_each.value = s.user_id
           ) THEN 1 ELSE 0 END as is_player
    FROM user_sessions s
    LEFT JOIN active_rooms r ON s.room_id = r.room_id
    WHERE s.room_id IS NOT NULL
  `);
}
