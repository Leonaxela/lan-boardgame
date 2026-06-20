/**
 * KataGo 进程管理器
 *
 * 每间房启动一个 katago.exe gtp 子进程，通过 stdin/stdout 进行 GTP 通信。
 * 对局结束或房间销毁时自动清理子进程。
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { positionToGTP, parseGenMove } from './gtpCoordinates.js';

// ════════════════════════════════════════════
//  类型定义
// ════════════════════════════════════════════

export interface KataGoConfig {
  boardSize: number;       // 9, 13, 19
  rules: 'chinese' | 'japanese';
  komi: number;            // 7.5 (chinese) / 6.5 (japanese)
  maxVisits: number;       // 500, 1000, 2000
}

/** 单步分析数据 */
export interface AnalysisPoint {
  /** 胜率 (0~1)，当前走棋方的视角 */
  winrate: number;
  /** 领先目数（正 = 当前走棋方领先） */
  scoreLead: number;
  /** Top N 候选走法 */
  topMoves: Array<{ row: number; col: number; winrate: number; scoreLead: number }>;
  /** 领地预测 board[row][col]，-1(白)→1(黑) */
  ownership: number[][];
}

interface KataGoSession {
  process: ChildProcess;
  config: KataGoConfig;
  /** 缓冲的 stdout 行 */
  lineBuffer: string[];
  /** 当前等待响应的 resolve 回调 */
  pendingResolve: ((response: string) => void) | null;
  /** 响应超时计时器 */
  timeoutTimer: NodeJS.Timeout | null;
  /** 启动就绪回调（等待 GTP 可用） */
  readyResolve: (() => void) | null;
}

// ════════════════════════════════════════════
//  KataGoManager
// ════════════════════════════════════════════

export class KataGoManager {
  private sessions = new Map<string, KataGoSession>();

  /** 获取 katago.exe 的绝对路径 */
  private getKatagoPath(): string {
    return path.resolve(process.cwd(), 'katago', 'katago-v1.16.5-opencl-windows-x64', 'katago.exe');
  }

  /** 获取权重文件路径 */
  private getModelPath(): string {
    return path.resolve(process.cwd(), 'katago', 'kata1-zhizi-b28c512nbt-muonfd2.bin.gz');
  }

  /** 获取 GTP 配置文件路径 */
  private getConfigPath(): string {
    return path.resolve(process.cwd(), 'katago', 'katago-v1.16.5-opencl-windows-x64', 'default_gtp.cfg');
  }

  /**
   * 为房间启动 KataGo 会话
   * 返回 Promise，resolve 表示 KataGo 已就绪
   */
  async startSession(roomId: string, config: KataGoConfig): Promise<void> {
    // 如果已有会话，先销毁
    if (this.sessions.has(roomId)) {
      this.destroySession(roomId);
    }

    const katagoPath = this.getKatagoPath();
    const modelPath = this.getModelPath();
    const configPath = this.getConfigPath();

    console.log(`[KataGo] 启动会话 roomId=${roomId} boardSize=${config.boardSize} rules=${config.rules} visits=${config.maxVisits}`);
    console.log(`[KataGo] 路径: ${katagoPath}`);

    const args = [
      'gtp',
      '-model', modelPath,
      '-config', configPath,
      '-override-config', `maxVisits=${config.maxVisits},maxTime=60`,
    ];

    const proc = spawn(katagoPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.resolve(process.cwd(), 'katago', 'katago-v1.16.5-opencl-windows-x64'),
    });

    const session: KataGoSession = {
      process: proc,
      config,
      lineBuffer: [],
      pendingResolve: null,
      timeoutTimer: null,
      readyResolve: null,
    };

    this.sessions.set(roomId, session);

    // 处理 stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      this.handleStdout(roomId, text);
    });

    // 处理 stderr（日志输出，检测调优完成）
    let tuningDetected = false;
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim();
      if (text) console.log(`[KataGo stderr] ${text}`);

      // 检测是否在进行 OpenCL 调优
      if (text.includes('Performing autotuning') || text.includes('Tuning')) {
        tuningDetected = true;
      }

      // 调优完成后（不再输出 Tuning），或首次运行无调优，检测 GTP 就绪
      if (tuningDetected && !text.includes('Tuning') && text.length > 0) {
        // 调优结束后的首次有意义输出 → 视为就绪
        tuningDetected = false;
        const s = this.sessions.get(roomId);
        if (s?.readyResolve) {
          const resolve = s.readyResolve;
          s.readyResolve = null;
          resolve();
        }
      }

      // 检测 GTP 模式启动（非调优场景）
      if (!tuningDetected && (text.includes('GTP ready') || text.includes('beginning main protocol'))) {
        const s = this.sessions.get(roomId);
        if (s?.readyResolve) {
          const resolve = s.readyResolve;
          s.readyResolve = null;
          resolve();
        }
      }
    });

    // 进程退出
    proc.on('exit', (code) => {
      console.log(`[KataGo] 进程退出 roomId=${roomId} code=${code}`);
      this.sessions.delete(roomId);
    });

    proc.on('error', (err) => {
      console.error(`[KataGo] 进程错误 roomId=${roomId}`, err);
      this.sessions.delete(roomId);
    });

    // 等待 KataGo 启动就绪（发送 name 命令测试）
    await this.waitForReady(roomId);
  }

  /** 等待 KataGo 启动就绪（最多 5 分钟，首次运行含 OpenCL 调优） */
  private async waitForReady(roomId: string): Promise<void> {
    const session = this.sessions.get(roomId);
    if (!session) throw new Error('Session not found');

    // 先等 stderr 表示就绪（调优完成或直接就绪），超时 5 分钟
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.readyResolve = null;
        reject(new Error('KataGo 启动超时（5分钟），请检查 GPU 驱动'));
      }, 300000); // 5 分钟

      session.readyResolve = () => {
        clearTimeout(timeout);
        console.log(`[KataGo] stderr 就绪信号已收到`);
        resolve();
      };
    });

    // 再发 name 命令确认 GTP 可用
    const response = await this.sendCommand(roomId, 'name', 30000);
    console.log(`[KataGo] 就绪: ${response}`);
  }

  /** 初始化棋盘 */
  async initializeBoard(roomId: string): Promise<void> {
    const session = this.sessions.get(roomId);
    if (!session) throw new Error(`KataGo session not found: ${roomId}`);

    const { boardSize, rules, komi } = session.config;

    // 设置棋盘大小（OpenCL 初始化可能需要较长时间）
    await this.sendCommand(roomId, `boardsize ${boardSize}`, 30000);

    // 设置规则
    await this.sendCommand(roomId, `kata-set-rules ${rules}`, 10000);

    // 设置贴目
    await this.sendCommand(roomId, `komi ${komi}`, 10000);

    // 清空棋盘
    await this.sendCommand(roomId, 'clear_board', 10000);

    console.log(`[KataGo] 棋盘初始化完成: ${boardSize}x${boardSize} ${rules} komi=${komi}`);
  }

  /** 发送 GTP 命令并等待响应 */
  async sendCommand(roomId: string, command: string, timeoutMs: number = 10000): Promise<string> {
    const session = this.sessions.get(roomId);
    if (!session) throw new Error(`KataGo session not found: ${roomId}`);

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pendingResolve = null;
        reject(new Error(`KataGo command timeout: ${command}`));
      }, timeoutMs);

      session.timeoutTimer = timeout;
      session.pendingResolve = (response) => {
        clearTimeout(timeout);
        session.timeoutTimer = null;
        resolve(response);
      };

      // 发送命令
      const cmd = command + '\n';
      session.process.stdin?.write(cmd);
      console.log(`[KataGo stdin] ${command}`);
    });
  }

  /** 处理 stdout 输出 */
  private handleStdout(roomId: string, text: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;

    // GTP 响应以空行结尾
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.replace(/\r/g, '');
      if (trimmed === '') {
        // 空行 = 响应结束
        const response = session.lineBuffer.join('\n').trim();
        session.lineBuffer = [];
        if (session.pendingResolve) {
          const resolve = session.pendingResolve;
          session.pendingResolve = null;
          resolve(response);
        }
      } else {
        session.lineBuffer.push(trimmed);
      }
    }
  }

  /** 让 KataGo 生成一步棋 */
  async genMove(roomId: string, color: 'black' | 'white'): Promise<{ row: number; col: number } | 'pass' | 'resign' | null> {
    const session = this.sessions.get(roomId);
    if (!session) return null;

    try {
      // 超时 = maxTime*2 + 30s 余量，确保不会在 KataGo 还在思考时就超时
      const maxTimeMs = 60000; // 与启动参数 maxTime=60 一致
      const timeoutMs = Math.max(150000, maxTimeMs * 2 + 30000);
      const start = Date.now();
      const response = await this.sendCommand(roomId, `genmove ${color}`, timeoutMs);
      console.log(`[KataGo] genmove ${color} → ${response} (${Date.now() - start}ms)`);
      return parseGenMove(response, session.config.boardSize);
    } catch (err) {
      console.error(`[KataGo] genMove 错误:`, err);
      return null;
    }
  }

  /** 同步一步棋到 KataGo */
  async playMove(roomId: string, color: 'black' | 'white', pos: { row: number; col: number }): Promise<void> {
    const session = this.sessions.get(roomId);
    if (!session) return;

    const gtpVertex = positionToGTP(pos, session.config.boardSize);
    const cmd = `play ${color} ${gtpVertex}`;
    const start = Date.now();
    await this.sendCommand(roomId, cmd, 10000);
    console.log(`[KataGo] play ${color} ${gtpVertex} 完成 (${Date.now() - start}ms)`);
  }

  /** 让 KataGo pass */
  async passMove(roomId: string, color: 'black' | 'white'): Promise<void> {
    await this.sendCommand(roomId, `play ${color} pass`, 5000);
  }

  /** 获取当前局面的分析数据（kata-raw-nn，纯 NN 评估，非常快） */
  async analyzePosition(roomId: string, perspective: 'black' | 'white' = 'black'): Promise<AnalysisPoint | null> {
    const session = this.sessions.get(roomId);
    if (!session) return null;

    try {
      const response = await this.sendCommand(roomId, 'kata-raw-nn 0', 10000);
      return this.parseRawNN(response, session.config.boardSize, perspective);
    } catch (err) {
      console.error('[KataGo] analyzePosition 错误:', err);
      return null;
    }
  }

  /** 解析 kata-raw-nn 响应 */
  private parseRawNN(response: string, boardSize: number, perspective: 'black' | 'white'): AnalysisPoint | null {
    try {
      // 格式: symmetry 0 whiteWin <float> whiteLoss <float> ... policy <N floats> ... whiteOwnership <N floats>
      const tokens = response.trim().split(/\s+/);
      if (tokens.length < 10) return null;

      const data: Record<string, any> = {};
      let i = 0;
      while (i < tokens.length) {
        const key = tokens[i++];
        if (key === 'symmetry') { i++; continue; } // skip symmetry number
        // 特殊处理：已知是 N 个 float 的 key
        if (key === 'policy' || key === 'whiteOwnership' || key === 'whiteScoreSelfplay' || key === 'whiteScoreSelfplaySq') {
          continue; // skip large arrays for now, we'll handle separately
        }
        if (i < tokens.length) {
          const val = parseFloat(tokens[i]);
          if (!isNaN(val)) {
            data[key] = val;
            i++;
          }
        }
      }

      // 提取 whiteWin/whiteLoss → 转成指定视角的胜率
      const whiteWin = data['whiteWin'] ?? 0.5;
      const whiteLoss = data['whiteLoss'] ?? 0.5;
      const whiteLead = data['whiteLead'] ?? 0;
      
      // kata-raw-nn 的 whiteWin/whiteLoss 是白方视角
      // perspective 参数指定了分析结果从谁的角度看
      let winrate: number;
      let scoreLead: number;
      if (perspective === 'black') {
        winrate = whiteLoss / (whiteWin + whiteLoss || 1);
        scoreLead = -whiteLead;
      } else {
        winrate = whiteWin / (whiteWin + whiteLoss || 1);
        scoreLead = whiteLead;
      }

      // 解析 policy（候选走法）：找到 policy 关键字后的 boardSize*boardSize 个 float
      const policyIdx = tokens.indexOf('policy');
      let topMoves: Array<{ row: number; col: number; winrate: number; scoreLead: number }> = [];
      if (policyIdx >= 0) {
        const numCells = boardSize * boardSize;
        const policyValues: number[] = [];
        for (let j = policyIdx + 1; j < policyIdx + 1 + numCells && j < tokens.length; j++) {
          policyValues.push(parseFloat(tokens[j]) || 0);
        }
        // 取 Top 5
        const indexed = policyValues.map((v, idx) => ({ row: Math.floor(idx / boardSize), col: idx % boardSize, value: v }));
        indexed.sort((a, b) => b.value - a.value);
        topMoves = indexed.slice(0, 5).map(m => ({
          row: m.row,
          col: m.col,
          winrate: m.value,
          scoreLead,
        }));
      }

      // 解析 whiteOwnership
      const ownIdx = tokens.indexOf('whiteOwnership');
      let ownership: number[][] = [];
      if (ownIdx >= 0) {
        const numCells = boardSize * boardSize;
        for (let j = ownIdx + 1; j < ownIdx + 1 + numCells && j < tokens.length; j++) {
          const val = parseFloat(tokens[j]) || 0;
          const idx = j - ownIdx - 1;
          const r = Math.floor(idx / boardSize);
          const c = idx % boardSize;
          if (!ownership[r]) ownership[r] = [];
          ownership[r][c] = val; // -1 (black) to 1 (white)
        }
      }

      return {
        winrate,
        scoreLead: whiteLead,
        topMoves,
        ownership,
      };
    } catch (err) {
      console.error('[KataGo] parseRawNN 错误:', err);
      return null;
    }
  }

  /** 销毁房间的 KataGo 会话 */
  destroySession(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (!session) return;

    console.log(`[KataGo] 销毁会话 roomId=${roomId}`);

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
    }

    try {
      session.process.stdin?.end();
      session.process.kill('SIGTERM');
      // 给 2 秒优雅退出，否则强制杀死
      setTimeout(() => {
        try {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        } catch {}
      }, 2000);
    } catch {}

    this.sessions.delete(roomId);
  }

  /** 检查房间是否有活跃的 KataGo 会话 */
  hasSession(roomId: string): boolean {
    return this.sessions.has(roomId);
  }

  /** 获取会话配置 */
  getSessionConfig(roomId: string): KataGoConfig | null {
    return this.sessions.get(roomId)?.config ?? null;
  }

  /** 销毁所有会话（Server 退出时调用） */
  destroyAll(): void {
    for (const roomId of this.sessions.keys()) {
      this.destroySession(roomId);
    }
  }
}

// 单例导出
export const kataGoManager = new KataGoManager();
