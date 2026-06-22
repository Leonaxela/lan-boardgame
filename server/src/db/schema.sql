-- ===========================================
-- lan-boardgame 数据库建表
-- ===========================================

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user',
  nickname            TEXT,
  birth_date          TEXT,                -- 出生日期 YYYY-MM-DD
  gender              TEXT,                -- male / female / other
  hometown            TEXT,                -- 籍贯
  occupation          TEXT,                -- 职业
  hobbies             TEXT,                -- 爱好（逗号分隔）
  total_games         INTEGER NOT NULL DEFAULT 0,
  win_games           INTEGER NOT NULL DEFAULT 0,
  last_online_at      TEXT,                -- 最后一次在线时间
  total_online_seconds INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  banned              INTEGER NOT NULL DEFAULT 0
);

-- 对局记录
CREATE TABLE IF NOT EXISTS game_records (
  id            TEXT PRIMARY KEY,
  game_type     TEXT NOT NULL,
  rule_set      TEXT,
  board_size    INTEGER NOT NULL DEFAULT 19,
  players       TEXT NOT NULL,             -- JSON: [{id, name, color}]
  winner_id     TEXT,
  reason        TEXT,                      -- resign / score / disconnect
  moves         TEXT,                     -- JSON: [{color, row, col}]
  sgf           TEXT,                      -- 标准 SGF 格式棋谱
  pgn           TEXT,                      -- 中国象棋/国际象棋 PGN 格式棋谱
  pdn           TEXT,                      -- 国际跳棋 PDN 格式棋谱
  scores        TEXT,                      -- JSON: {playerId: score}
  difficulty    TEXT,                      -- AI 难度: 'easy'/'normal'/'hard'/'master' 或 KataGo: '30v'/'100v'/'500v'/'2000v'
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  duration_sec  INTEGER                    -- 对局时长（秒）
);

-- 房间日志（活跃记录 / 统计用）
CREATE TABLE IF NOT EXISTS room_logs (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  owner_id      TEXT NOT NULL,
  game_type     TEXT NOT NULL,
  player_count  INTEGER NOT NULL DEFAULT 0,
  idle_type     INTEGER,                   -- 0/1/2（空闲类型统计）
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  destroyed_at  TEXT
);

-- 活跃房间表（持久化当前房间状态，重启恢复用）
CREATE TABLE IF NOT EXISTS active_rooms (
  room_id       TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  owner_name    TEXT NOT NULL,
  game_type     TEXT NOT NULL,
  config        TEXT,             -- JSON
  activity      TEXT NOT NULL DEFAULT 'idle_0',
  player_ids    TEXT,             -- JSON: 玩家ID列表
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 在线用户会话表
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id       TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  room_id       TEXT,             -- 当前所在房间
  connected_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  last_ping     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 游戏配置表（后台管理用）
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,          -- 'go', 'gomoku', 'chess', ...
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  icon_svg      TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'ready',  -- 'ready' | 'developing'
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_game_records_game_type ON game_records(game_type);
CREATE INDEX IF NOT EXISTS idx_game_records_created_at ON game_records(created_at);
CREATE INDEX IF NOT EXISTS idx_room_logs_owner ON room_logs(owner_id);
