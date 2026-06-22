import { GameType } from '@lan-boardgame/shared';
import { Room } from '../../room/Room.js';
import { execute, uuid } from '../../db/connection.js';
import { generateSgf } from './generators/SgfGenerator.js';
import { generateChineseChessPgn } from './generators/ChineseChessPgnGenerator.js';
import { generateChessPgn } from './generators/ChessPgnGenerator.js';
import { generateDraughtsPdn } from './generators/DraughtsPdnGenerator.js';

export function logRoomActivity(room: Room, idleType: number): void {
  try {
    execute(
      `INSERT INTO room_logs (id, room_id, owner_id, game_type, player_count, idle_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [uuid(), room.roomId, room.owner?.id || '', room.gameType, room.players.length, idleType]
    );
  } catch (e) {
    console.error('[DB] 记录房间活动失败:', e);
  }
}

export function saveGameRecord(room: Room, result: any): void {
  try {
    const moves = room.moveHistory;
    const players = room.players.map(p => ({ id: p.id, name: p.username, color: p.color }));

    const isChineseChess = room.gameType === GameType.ChineseChess;
    const isChess = room.gameType === GameType.Chess;
    const isDraughts = room.gameType === GameType.Draughts;
    const needsPgn = isChineseChess || isChess;
    const sgf = (needsPgn || isDraughts) ? null : generateSgf(room, result);
    const pgn = isChineseChess ? generateChineseChessPgn(room, result)
              : isChess ? generateChessPgn(room, result)
              : null;
    const pdn = isDraughts ? generateDraughtsPdn(room, result) : null;

    const difficulty = room.katagoDifficulty || room.aiDifficulty || 0;

    execute(
      `INSERT INTO game_records (id, game_type, rule_set, board_size, players, winner_id, reason, moves, sgf, pgn, pdn, scores, difficulty, created_at, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)`,
      [
        uuid(),
        room.gameType,
        room.config.extra?.ruleSet || 'chinese',
        room.config.rows || 19,
        JSON.stringify(players),
        result?.winner?.id || '',
        result?.reason || '',
        JSON.stringify(moves),
        sgf,
        pgn,
        pdn,
        JSON.stringify(result?.scores || {}),
        difficulty,
        Math.floor((Date.now() - room.createdAt) / 1000),
      ]
    );

    for (const p of players) {
      if (p.id.startsWith('ai-')) continue;
      const user = queryOne<{ id: string }>('SELECT id FROM users WHERE username = ?', [p.name]);
      if (user) {
        execute('UPDATE users SET total_games = total_games + 1 WHERE id = ?', [user.id]);
      }
    }
    if (result?.winner?.id && !result.winner.id.startsWith('ai-')) {
      const winnerUser = queryOne<{ id: string }>('SELECT id FROM users WHERE username = ?', [result.winner.name || '']);
      if (winnerUser) {
        execute('UPDATE users SET win_games = win_games + 1 WHERE id = ?', [winnerUser.id]);
      }
    }
  } catch (e) {
    console.error('[DB] 保存对局记录失败:', e);
  }
}

import { queryOne } from '../../db/connection.js';
