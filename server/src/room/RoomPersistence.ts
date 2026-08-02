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
  } catch (e) {
    console.error('[DB] 记录房间销毁时间失败:', e);
  }
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

/**
 * 确保用户名在 user_sessions 中有一条记录（登录行，room_id=NULL）。
 * 缓存自动进入大厅的用户不会重新调用 /api/auth/login，登录时写入的 session
 * 可能在刷新/断开时被清理；此处按需补建，使 session 生命周期跟随 WS 连接。
 * 若该用户名已有任意记录（登录行或房间行），则不重复插入。
 */
export function ensureUserSession(username: string): void {
  const user = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (!user) return;
  const exists = queryOne('SELECT 1 FROM user_sessions WHERE username = ?', [username]);
  if (exists) return;
  execute(
    `INSERT INTO user_sessions (user_id, username, room_id, last_ping)
     VALUES (?, ?, NULL, datetime('now', 'localtime'))
     ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, room_id=excluded.room_id, last_ping=excluded.last_ping`,
    [user.id, username]
  );
}

export function getOnlineCount(): number {
  // 在线 = 登录成功且心跳活跃（last_ping 120 秒内）。登录即写 session，无需进房间。
  // last_ping 存储为 localtime，比较基准必须同为 localtime（julianday('now') 是 UTC，会时区错位）
  // 注意：同一用户名可能有两行（登录行 user_id=users.id + 房间行 user_id=randomUUID），按 username 去重
  const row = queryOne(
    "SELECT COUNT(DISTINCT username) as c FROM user_sessions WHERE julianday(last_ping) >= julianday(datetime('now', 'localtime')) - 120.0/86400"
  ) as any;
  return row?.c ?? 0;
}

export function getOnlineUsers(): { user_id: string; username: string; room_id: string | null; game_type: string; activity: string; is_owner: boolean; is_player: boolean }[] {
  const fresh = "julianday(s2.last_ping) >= julianday(datetime('now', 'localtime')) - 120.0/86400";
  // 同一用户名可能有两行（登录行 user_id=users.id + 房间行 user_id=randomUUID）。
  // 每 username 只取一行：优先房间行（room_id 非空），否则取登录行，避免后台详情重复。
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
    WHERE julianday(s.last_ping) >= julianday(datetime('now', 'localtime')) - 120.0/86400
      AND s.user_id = (
        SELECT s2.user_id FROM user_sessions s2
        WHERE s2.username = s.username AND ${fresh}
        ORDER BY CASE WHEN s2.room_id IS NOT NULL THEN 0 ELSE 1 END, s2.last_ping DESC
        LIMIT 1
      )
  `);
}
