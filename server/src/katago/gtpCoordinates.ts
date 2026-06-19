/**
 * GTP 坐标 ↔ Position 互转
 *
 * GTP 格式: 列字母 (A-T, 跳过I) + 行数字 (1=底部, 19=顶部)
 * 内部格式: Position { row, col } (0,0) = 左上角
 *
 * 示例: GTP "D4" → Position { row: 15, col: 3 }  (19路棋盘)
 *       GTP "Q16" → Position { row: 3, col: 16 }
 */

// GTP 列字母 (跳过 I)
const COL_LETTERS = 'ABCDEFGHJKLMNOPQRST';

/** Position { row, col } → GTP 顶点字符串 (如 "D4") */
export function positionToGTP(pos: { row: number; col: number }, boardSize: number): string {
  const colLetter = COL_LETTERS[pos.col] ?? '?';
  const gtpRow = boardSize - pos.row; // GTP 行号从底部开始
  return `${colLetter}${gtpRow}`;
}

/** GTP 顶点字符串 (如 "D4") → Position { row, col } */
export function gtpToPosition(gtp: string, boardSize: number): { row: number; col: number } | null {
  if (!gtp || gtp === 'pass' || gtp === 'resign') return null;
  const cleaned = gtp.trim().toUpperCase();
  // 找到第一个数字的位置
  const digitIdx = cleaned.search(/\d/);
  if (digitIdx <= 0) return null;

  const colPart = cleaned.substring(0, digitIdx);
  const rowPart = cleaned.substring(digitIdx);

  const col = COL_LETTERS.indexOf(colPart);
  if (col < 0) return null;

  const gtpRow = parseInt(rowPart, 10);
  if (isNaN(gtpRow) || gtpRow < 1 || gtpRow > boardSize) return null;

  const row = boardSize - gtpRow; // 转换为内部行号
  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return null;

  return { row, col };
}

/** 解析 GTP genmove 的返回值 */
export function parseGenMoveResponse(response: string): { row: number; col: number } | 'pass' | 'resign' | null {
  const vertex = response.replace(/^[=?]\s*/, '').trim().toLowerCase();
  if (vertex === 'pass') return 'pass';
  if (vertex === 'resign') return 'resign';
  return gtpToPosition(vertex, 19);
}

/** 将 GTP genmove 返回值解析为 Position，需要 boardSize */
export function parseGenMove(response: string, boardSize: number): { row: number; col: number } | 'pass' | 'resign' | null {
  // 去掉 GTP 响应前缀 (= 成功, ? 错误) 和空白
  const vertex = response.replace(/^[=?]\s*/, '').trim().toLowerCase();
  if (vertex === 'pass') return 'pass';
  if (vertex === 'resign') return 'resign';
  return gtpToPosition(vertex, boardSize);
}
