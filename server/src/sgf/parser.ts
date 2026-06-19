import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SGF_DIR = join(__dirname, '..', '..', 'data', 'sgf');

// ── 导出类型 ──

export interface SgfMove {
  color: 'black' | 'white';
  row: number;
  col: number;
}

export interface SgfInfo {
  id: string;
  filename: string;
  title: string;
  black: string;
  white: string;
  result: string;
  date: string;
  komi: number;
  boardSize: number;
  moves: SgfMove[];
}

// ── 列表 ──

export function listSgfFiles(): { id: string; title: string; black: string; white: string; result: string }[] {
  const files = readdirSync(SGF_DIR).filter(f => f.endsWith('.sgf'));
  return files.map(f => {
    const parsed = parseSgfFile(f);
    return {
      id: f,
      title: parsed.title,
      black: parsed.black,
      white: parsed.white,
      result: parsed.result,
    };
  });
}

// ── 读取 + 解析 ──

export function loadSgf(id: string): SgfInfo {
  return parseSgfFile(id);
}

function parseSgfFile(filename: string): SgfInfo {
  const content = readFileSync(join(SGF_DIR, filename), 'utf-8');
  return parseSgf(content, filename);
}

export function parseSgf(content: string, filename: string): SgfInfo {
  // 提取属性
  const getProp = (name: string): string => {
    const m = content.match(new RegExp(`${name}\\[([^\\]]*)\\]`));
    return m ? m[1] : '';
  };

  const boardSize = parseInt(getProp('SZ')) || 19;
  const black = getProp('PB');
  const white = getProp('PW');
  const result = getProp('RE');
  const date = getProp('DT');
  const komi = parseFloat(getProp('KM')) || 0;
  const gameName = getProp('GN');

  // 提取走棋序列
  const moves: SgfMove[] = [];
  // 匹配 ;B[ab] 或 ;W[ab] 格式
  const moveRegex = /;(B|W)\[([a-z]{1,2})\]/gi;
  let match;
  while ((match = moveRegex.exec(content)) !== null) {
    const color = match[1].toUpperCase() === 'B' ? 'black' : 'white';
    const sgfCoord = match[2];
    const { row, col } = sgfToBoard(sgfCoord, boardSize);
    moves.push({ color, row, col });
  }

  // 生成标题
  const title = gameName || `${black} vs ${white}`;

  return { id: filename, filename, title, black, white, result, date, komi, boardSize, moves };
}

// ── 坐标转换 ──

/**
 * SGF 坐标转棋盘坐标。
 * SGF: a=0行/列, b=1, ..., z=25
 * 棋盘: row=0顶部, col=0左侧
 * SGF 的 a 对应 board[0][0]（左上角）
 */
function sgfToBoard(sgfCoord: string, boardSize: number): { row: number; col: number } {
  const col = sgfCoord.charCodeAt(0) - 97; // 'a' = 0
  const row = sgfCoord.length > 1 ? sgfCoord.charCodeAt(1) - 97 : 0;
  // 处理超过 'z'(25) 的情况，用 'aa'=26 等
  return { row, col };
}

/**
 * 棋盘坐标转 SGF 坐标。
 */
export function boardToSgf(row: number, col: number): string {
  return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
}
