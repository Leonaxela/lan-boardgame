/**
 * Fairy-Stockfish 进程管理器
 *
 * 每间房启动一个 fairy-stockfish.exe 子进程，通过 stdin/stdout 进行 UCI/UCCI 通信。
 * 对局结束或房间销毁时自动清理子进程。
 *
 * 中国象棋 → UCCI 协议 (variant=xiangqi)
 * 国际象棋 → UCI 协议 (variant=chess)
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// ════════════════════════════════════════════
//  类型定义
// ════════════════════════════════════════════

export interface FairyStockfishConfig {
  variant: 'xiangqi' | 'chess';
  skillLevel: number; // 0-20（越高越强）
  /** 搜索用时上限（毫秒），默认 55000 确保 1 分钟内返回 */
  moveTime: number;
}

interface FairyStockfishSession {
  process: ChildProcess;
  config: FairyStockfishConfig;
  /** 待解析的 stdout 行缓冲区 */
  lineBuffer: string;
  /** 当前等待响应的 resolve */
  pendingResolve: ((response: string) => void) | null;
  /** 超时计时器 */
  timeoutTimer: NodeJS.Timeout | null;
  /** 启动就绪回调 */
  readyResolve: (() => void) | null;
  /** 已走的历史棋步（UCI/UCCI 格式） */
  moveHistory: string[];
}

// ════════════════════════════════════════════
//  坐标转换
// ════════════════════════════════════════════

const COL_LETTERS = 'abcdefghij';

/** Position {row, col} → UCI/UCCI 走法字符串（用于 position 命令） */
function posToUci(pos: { row: number; col: number }, variant: string): string {
  const colChar = COL_LETTERS[pos.col] ?? '?';
  // UCI/UCCI 棋盘：row 0 = 底部（红方/白方侧），与内部 row 0 = 顶部相反
  const maxRow = variant === 'xiangqi' ? 9 : 7;
  // Chess (8行): UCI rank 1 = 内部 row 7, rank 8 = row 0 → uciRow = 8 - row
  // Xiangqi (10行): UCCI row 0 = 内部 row 9, row 9 = row 0 → ucciRow = 9 - row
  const uciRow = variant === 'xiangqi' ? maxRow - pos.row : (maxRow + 1) - pos.row;
  return `${colChar}${uciRow}`;
}

/** UCI/UCCI 走法字符串 → Position {row, col} */
function uciToPos(uci: string, variant: string): { row: number; col: number } | null {
  if (uci.length < 2) return null;
  const colChar = uci[0];
  const col = COL_LETTERS.indexOf(colChar);
  if (col < 0) return null;
  const uciRow = parseInt(uci.slice(1), 10);
  if (isNaN(uciRow)) return null;
  const maxRow = variant === 'xiangqi' ? 9 : 7;
  const row = variant === 'xiangqi' ? maxRow - uciRow : (maxRow + 1) - uciRow;
  if (row < 0 || row > maxRow || col < 0 || col > maxRow) return null;
  return { row, col };
}

/** 内部 {from, to} → 完整 UCI 走法字符串 */
export function moveToUci(from: { row: number; col: number }, to: { row: number; col: number }, variant: string): string {
  return posToUci(from, variant) + posToUci(to, variant);
}

/** 完整 UCI 走法字符串 → 内部 {from, to}（from 可能为 null，表示单步棋） */
export function uciToMove(uci: string, variant: string): { from: { row: number; col: number }; to: { row: number; col: number } } | null {
  if (uci.length < 4) return null;
  const to = uciToPos(uci.slice(2, 4), variant);
  const from = uciToPos(uci.slice(0, 2), variant);
  if (!from || !to) return null;
  return { from, to };
}

// ════════════════════════════════════════════
//  FairyStockfishManager
// ════════════════════════════════════════════

export class FairyStockfishManager {
  private sessions = new Map<string, FairyStockfishSession>();

  /** 获取 fairy-stockfish.exe 绝对路径 */
  private getExePath(): string {
    return path.resolve(process.cwd(), 'fairy-stockfish', 'fairy-stockfish_x86-64-modern.exe');
  }

  /**
   * 为房间启动 Fairy-Stockfish 会话
   * 返回 Promise，resolve 表示引擎已就绪
   */
  async startSession(roomId: string, config: FairyStockfishConfig): Promise<void> {
    if (this.sessions.has(roomId)) {
      this.destroySession(roomId);
    }

    const exePath = this.getExePath();
    console.log(`[Fairy-Stockfish] 启动会话 roomId=${roomId} variant=${config.variant} skill=${config.skillLevel}`);

    const proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.resolve(process.cwd(), 'fairy-stockfish'),
    });

    const session: FairyStockfishSession = {
      process: proc,
      config,
      lineBuffer: '',
      pendingResolve: null,
      timeoutTimer: null,
      readyResolve: null,
      moveHistory: [],
    };

    this.sessions.set(roomId, session);

    // stdout 处理
    proc.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(roomId, data.toString('utf-8'));
    });

    // stderr 日志
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim();
      if (text) console.log(`[Fairy-Stockfish stderr] ${text}`);
    });

    proc.on('exit', (code) => {
      console.log(`[Fairy-Stockfish] 进程退出 roomId=${roomId} code=${code}`);
      this.sessions.delete(roomId);
    });

    proc.on('error', (err) => {
      console.error(`[Fairy-Stockfish] 进程错误 roomId=${roomId}`, err);
      this.sessions.delete(roomId);
    });

    // 等待 UCI/UCCI 就绪
    await this.waitForReady(roomId);
  }

  /** 等待引擎就绪 */
  private async waitForReady(roomId: string): Promise<void> {
    const session = this.sessions.get(roomId);
    if (!session) throw new Error('Session not found');

    const isUcci = session.config.variant === 'xiangqi';

    // 发送 uci/ucci 协议初始化命令
    const initCmd = isUcci ? 'ucci' : 'uci';
    const initResponse = await this.sendCommand(roomId, initCmd, 30000);
    console.log(`[Fairy-Stockfish] ${initCmd} 响应: ${initResponse.substring(0, 100)}`);

    // 设置变体
    if (isUcci) {
      this.sendSilentCommand(roomId, 'setoption name UCCI_Variant value xiangqi');
    }

    // 设置 Skill Level（0-20），限制引擎强度，低难度下故意走出次优棋
    if (session.config.skillLevel < 20) {
      this.sendSilentCommand(roomId, `setoption name Skill Level value ${session.config.skillLevel}`);
    }

    // 检测就绪
    await this.sendCommand(roomId, 'isready', 10000);
    console.log(`[Fairy-Stockfish] 就绪 roomId=${roomId} variant=${session.config.variant}`);
  }

  /** 发送命令并等待响应（适用于 uci/ucci、isready、go 等有返回的命令） */
  async sendCommand(roomId: string, command: string, timeoutMs: number = 10000): Promise<string> {
    const session = this.sessions.get(roomId);
    if (!session) throw new Error(`Fairy-Stockfish session not found: ${roomId}`);

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pendingResolve = null;
        reject(new Error(`Fairy-Stockfish command timeout: ${command}`));
      }, timeoutMs);

      session.timeoutTimer = timeout;
      session.pendingResolve = (response) => {
        clearTimeout(timeout);
        session.timeoutTimer = null;
        resolve(response);
      };

      session.process.stdin?.write(command + '\n');
      console.log(`[Fairy-Stockfish stdin] ${command}`);
    });
  }

  /** 发送无需等待响应的命令（适用于 setoption、ucinewgame、position 等静默命令） */
  sendSilentCommand(roomId: string, command: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;
    session.process.stdin?.write(command + '\n');
    console.log(`[Fairy-Stockfish stdin] ${command}`);
  }

  /** 处理 stdout */
  private handleStdout(roomId: string, text: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;

    session.lineBuffer += text;

    // UCI 协议：响应以特定关键词结尾
    // uciok → uci 初始化完成
    // readyok → isready 响应
    // bestmove ... → go 命令响应
    const lines = session.lineBuffer.split('\n');
    let resolved = false;

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim().replace(/\r/g, '');

      if (line === '') continue;

      // 检查是否是完整的响应行
      if (line === 'uciok' || line === 'ucciok') {
        resolved = true;
        this.resolvePending(roomId, session.lineBuffer.substring(0, session.lineBuffer.lastIndexOf('\n', session.lineBuffer.length - 1) + 1));
        session.lineBuffer = '';
        break;
      }

      if (line === 'readyok') {
        resolved = true;
        this.resolvePending(roomId, 'readyok');
        session.lineBuffer = '';
        break;
      }

      if (line.startsWith('bestmove ')) {
        resolved = true;
        this.resolvePending(roomId, line);
        session.lineBuffer = '';
        break;
      }

      // id name 等行继续等待
    }

    // 如果 buffer 过长，截断防止内存泄漏
    if (session.lineBuffer.length > 65536) {
      session.lineBuffer = session.lineBuffer.slice(-32768);
    }
  }

  private resolvePending(roomId: string, response: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;
    if (session.pendingResolve) {
      const resolve = session.pendingResolve;
      session.pendingResolve = null;
      resolve(response);
    }
  }

  /** 新开一局 */
  async newGame(roomId: string): Promise<void> {
    this.sendSilentCommand(roomId, 'ucinewgame');
    const session = this.sessions.get(roomId);
    if (session) session.moveHistory = [];
  }

  /** 在引擎中执行一步棋 */
  async playMove(roomId: string, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
    const session = this.sessions.get(roomId);
    if (!session) return;
    const uci = moveToUci(from, to, session.config.variant);
    session.moveHistory.push(uci);
  }

  /** 获取 AI 最佳走法 */
  async getBestMove(roomId: string): Promise<{ from: { row: number; col: number }; to: { row: number; col: number } } | null> {
    const session = this.sessions.get(roomId);
    if (!session) return null;

    try {
      // 设置局面：position startpos moves ...
      const movesStr = session.moveHistory.join(' ');
      const posCmd = movesStr ? `position startpos moves ${movesStr}` : 'position startpos';
      this.sendSilentCommand(roomId, posCmd);

      // 搜索（movetime 控制时间，确保 1 分钟内返回）
      const goCmd = `go movetime ${session.config.moveTime}`;
      const response = await this.sendCommand(roomId, goCmd, 60000);

      // 解析 bestmove
      const match = response.match(/bestmove\s+(\S+)/);
      if (!match) return null;

      const bestMoveUci = match[1].toLowerCase();
      return uciToMove(bestMoveUci, session.config.variant);
    } catch (err) {
      console.error(`[Fairy-Stockfish] getBestMove 错误:`, err);
      return null;
    }
  }

  /** 销毁房间会话 */
  destroySession(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;

    console.log(`[Fairy-Stockfish] 销毁会话 roomId=${roomId}`);

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
    }

    try {
      session.process.stdin?.write('quit\n');
      session.process.stdin?.end();
      setTimeout(() => {
        try {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch { /* ignore */ }

    this.sessions.delete(roomId);
  }

  hasSession(roomId: string): boolean {
    return this.sessions.has(roomId);
  }

  destroyAll(): void {
    for (const roomId of this.sessions.keys()) {
      this.destroySession(roomId);
    }
  }
}

// 单例导出
export const fairyStockfishManager = new FairyStockfishManager();
