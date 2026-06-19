import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'lan-boardgame.db');

let db: SqlJsDatabase | null = null;

/**
 * 初始化数据库并返回实例。
 */
export async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('[DB] 已加载数据库文件');
  } else {
    db = new SQL.Database();
    console.log('[DB] 已创建新数据库');
  }

  const schemaPath = join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.run(schemaSql);

  // 迁移：添加 pgn 列（如果不存在）
  try { db.run('ALTER TABLE game_records ADD COLUMN pgn TEXT'); } catch {}
  // 迁移：添加 pdn 列（如果不存在）
  try { db.run('ALTER TABLE game_records ADD COLUMN pdn TEXT'); } catch {}

  // 清空过期的在线会话和活跃房间（重启后全部无效）
  db.run('DELETE FROM user_sessions');
  db.run('DELETE FROM active_rooms');

  saveDb();

  console.log('[DB] 数据库已初始化');
  return db;
}

/**
 * 获取数据库实例。
 */
export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

/**
 * 保存数据库到文件。
 */
export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * 查询多条记录。
 */
export function queryAll(sql: string, params?: any[]): any[] {
  const stmt = db!.prepare(sql);
  if (params) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * 查询单条记录。
 */
export function queryOne(sql: string, params?: any[]): any | undefined {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

/**
 * 执行写操作（INSERT/UPDATE/DELETE）。
 * 自动保存数据库。
 */
export function execute(sql: string, params?: any[]): void {
  db!.run(sql, params);
  saveDb();
}

/**
 * 生成 UUID v4。
 */
export function uuid(): string {
  return crypto.randomUUID();
}
