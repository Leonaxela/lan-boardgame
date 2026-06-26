import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDifficultyLabel } from '@lan-boardgame/shared';
import { modalConfirm } from '../components/Modal';
import { useFavicon } from '../hooks/useFavicon';
import GoBoard from '../games/go/GoBoard';
import ChineseChessBoard from '../games/chinese-chess/ChineseChessBoard';
import ChessBoard from '../games/chess/ChessBoard';
import DraughtsBoard from '../games/draughts/DraughtsBoard';
import PieChart from '../components/PieChart';
import LineChart from '../components/LineChart';
import Dropdown from '../components/Dropdown';
import { getGameResultText } from '../utils/gameResult';

const token = () => localStorage.getItem('token');
const adminName = () => localStorage.getItem('admin_name') || '管理员';

const GAME_TYPE_MAP: Record<string, string> = { go: '围棋', gomoku: '五子棋', 'chinese-chess': '中国象棋', chess: '国际象棋', draughts: '国际跳棋', mahjong: '麻将' };

function formatResult(record: any): JSX.Element {
  try {
    const players = JSON.parse(record.players || '[]');
    const winner = players.find((p: any) => p.id === record.winner_id) || null;
    const text = getGameResultText({
      winner,
      reason: record.reason,
      scores: JSON.parse(record.scores || '{}'),
      gameType: record.game_type,
      boardSize: record.board_size,
      hideName: true,
    });
    // 标红胜方颜色词
    const WINNER_LABELS = ['黑棋', '白棋', '红方', '黑方', '白方'];
    for (const label of WINNER_LABELS) {
      if (text.includes(label)) {
        const parts = text.split(label);
        return <>{parts[0]}<span style={{ color: '#f44336', fontWeight: 600 }}>{label}</span>{parts.slice(1).join(label)}</>;
      }
    }
    return <>{text}</>;
  } catch {
    return <>{record.reason || '-'}</>;
  }
}

function formatPlayers(record: any): React.ReactNode {
  try {
    const players = JSON.parse(record.players || '[]');
    const isCC = record.game_type === 'chinese-chess';
    const diff = getDifficultyLabel(record.difficulty || 0);
    return players.map((p: any, i: number) => {
      const icon = isCC ? (p.color === 'red' ? '🔴' : '⚫') : (p.color === 'black' ? '⚫' : p.color === 'white' ? '⚪' : '');
      const isAI = p.name?.startsWith('🤖');
      return (
        <span key={i}>
          {i > 0 && ' vs '}
          {icon} {p.name}
          {isAI && diff && <><span style={{ fontSize: 12 }}>：</span><span style={{ color: '#dcb35c', fontSize: 12 }}>{diff}</span></>}
        </span>
      );
    });
  } catch { return '-'; }
}

export default function AdminDashboard() {
  useFavicon('/admin-icon.svg');
  const nav = useNavigate();
  const [tab, setTab] = useState('dashboard');
  const [stats, setStats] = useState({ totalUsers: 0, totalGames: 0, todayGames: 0, onlineUsers: 0 });
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [showOnlineDetail, setShowOnlineDetail] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userTotalPages, setUserTotalPages] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const recordsPerPage = 20;
  const [statsData, setStatsData] = useState<any>(null);
  const [gameList, setGameList] = useState<any[]>([]);
  const [editingGame, setEditingGame] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<any>({});
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [recordMoves, setRecordMoves] = useState<any[]>([]);
  const [recordStep, setRecordStep] = useState(0);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [gameWinType, setGameWinType] = useState('go');
  const [gameWinPlayers, setGameWinPlayers] = useState<any[]>([]);

  const api = useCallback(async (path: string, options?: RequestInit) => {
    const res = await fetch(path, {
      ...options,
      headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json', ...options?.headers },
    });
    return res.json();
  }, []);

  const loadUsers = useCallback(async (page: number, search: string) => {
    const s = search ? `&search=${encodeURIComponent(search)}` : '';
    const d = await api(`/api/admin/users?page=${page}&limit=20${s}`);
    setUsers(d.users || []);
    setUserTotal(d.total || 0);
    setUserTotalPages(d.totalPages || 0);
    setUserPage(d.page || 1);
  }, [api]);

  const loadRecords = useCallback(async (page: number) => {
    const d = await api(`/api/admin/records?page=${page}&limit=20`);
    setRecords(d.records || []);
    setRecordsTotal(d.total || 0);
    setRecordsPage(d.page || 1);
  }, [api]);

  useEffect(() => {
    if (!token()) { nav('/admin/login'); return; }
    api('/api/admin/dashboard').then(setStats);
    loadUsers(1, '');
    loadRecords(1);
    api('/api/admin/statistics').then(d => setStatsData(d));
    api('/api/games/all').then(d => setGameList(d.games || []));
  }, [nav, api, loadUsers]);

  useEffect(() => {
    const t = setTimeout(() => loadUsers(1, userSearch), 300);
    return () => clearTimeout(t);
  }, [userSearch, loadUsers]);

  useEffect(() => {
    if (!token()) return;
    api(`/api/admin/top-players?game_type=${gameWinType}`).then(d => setGameWinPlayers(d.players || []));
  }, [gameWinType, api]);

  const toggleBan = async (userId: string, currentBanned: number) => {
    await api(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ banned: currentBanned ? 0 : 1 }),
    });
    loadUsers(userPage, userSearch);
  };

  const deleteUser = async (userId: string, username: string) => {
    const ok = await modalConfirm(`确定删除用户「${username}」？此操作不可撤销。`);
    if (!ok) return;
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    loadUsers(userPage, userSearch);
  };

  const saveUser = async () => {
    if (editingUser === 'new') {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(userForm) });
    } else {
      const data: any = { ...userForm };
      if (!data.password) delete data.password;
      await api(`/api/admin/users/${editingUser}`, { method: 'PUT', body: JSON.stringify(data) });
    }
    setEditingUser(null);
    loadUsers(userPage, userSearch);
  };

  /** 设置用户头像状态：approved / forbidden / locked */
  const setAvatarStatus = async (userId: string, status: 'approved' | 'forbidden' | 'locked') => {
    const d = await api(`/api/admin/users/${userId}/avatar-status`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (d.success) {
      // 更新 userForm 中的头像状态
      setUserForm((f: any) => ({ ...f, avatar_status: status, avatar_path: status === 'forbidden' || status === 'locked' ? null : f.avatar_path }));
      loadUsers(userPage, userSearch);
    } else {
      alert(d.error || '操作失败');
    }
  };

  const renderTab = () => {
    switch (tab) {
      case 'dashboard':
        const toggleOnlineDetail = async () => {
          if (showOnlineDetail) { setShowOnlineDetail(false); return; }
          const d = await api('/api/admin/online-users');
          setOnlineUsers(d.users || []);
          setShowOnlineDetail(true);
        };
        return (
          <>
            <h1>总览</h1>
            <div className="stat-cards">
              <div className="stat-card clickable" onClick={toggleOnlineDetail}><h3>在线人数</h3><p className="stat-number">{stats.onlineUsers ?? '-'}</p></div>
              <div className="stat-card"><h3>总用户数</h3><p className="stat-number">{stats.totalUsers}</p></div>
              <div className="stat-card"><h3>对局总数</h3><p className="stat-number">{stats.totalGames}</p></div>
              <div className="stat-card"><h3>今日对局</h3><p className="stat-number">{stats.todayGames}</p></div>
            </div>
            {showOnlineDetail && (
              <div className="online-detail">
                <h3>在线人数详情</h3>
                {onlineUsers.length === 0 ? (
                  <p className="text-muted">暂无在线用户</p>
                ) : (
                  <table className="admin-table">
                    <thead><tr><th>序号</th><th>用户</th><th>房间</th><th>角色</th><th>状态</th></tr></thead>
                    <tbody>
                      {onlineUsers.map((u, i) => {
                        const gameLabel = GAME_TYPE_MAP[u.game_type] || u.game_type;
                        const role = u.is_owner ? '👑 房主' : u.is_player ? '🎮 玩家' : '👤 观众';
                        const status = u.activity === 'playing' ? <span className="status-playing">对弈中</span> : <span className="status-idle">空闲</span>;
                        return (
                          <tr key={u.user_id}>
                        <td>{(recordsPage - 1) * recordsPerPage + i + 1}</td>
                            <td><strong>{u.username}</strong></td>
                            <td>{gameLabel}</td>
                            <td>{role}</td>
                            <td>{status}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        );

      case 'users':
        const fmtTime = (t: string) => t ? t.slice(0, 19).replace('T', ' ') : '-';
        const fmtDuration = (sec: number) => {
          if (!sec) return '0';
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          return h > 0 ? `${h}h${m}m` : `${m}m`;
        };
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h1 style={{ margin: 0 }}>用户管理 <span className="text-muted" style={{ fontSize: 14 }}>(共 {userTotal} 人)</span></h1>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="admin-search" placeholder="搜索用户名" value={userSearch}
                  onChange={e => setUserSearch(e.target.value)} />
                <button className="btn-small" style={{ padding: '8px 16px', fontSize: 14 }} onClick={() => { setEditingUser('new'); setUserForm({ username: '', password: '', nickname: '', birth_date: '', gender: '', hometown: '', occupation: '', hobbies: '' }); }}>+ 添加用户</button>
              </div>
            </div>
            <table className="admin-table">
              <thead><tr>
                <th>序号</th><th>姓名</th><th>胜局/总局</th><th>胜率</th><th>累计时间</th><th>最近在线</th><th>状态</th><th>操作</th>
              </tr></thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id}>
                    <td>{i + 1}</td>
                    <td><strong>{u.nickname || u.username}</strong></td>
                    <td>{u.win_games}/{u.total_games}</td>
                    <td>{u.total_games > 0 ? `${(u.win_games / u.total_games * 100).toFixed(1)}%` : '-'}</td>
                    <td>{fmtDuration(u.total_online_seconds)}</td>
                    <td>{fmtTime(u.last_online_at)}</td>
                    <td>{u.banned ? '🚫 封禁' : '✅ 正常'}</td>
                    <td>
                      <button className="btn-small" onClick={() => {
                        setEditingUser(u.id);
                        setUserForm({ ...u });
                      }}>编辑</button>
                      <button className="btn-small" style={{ marginLeft: 4 }} onClick={() => toggleBan(u.id, u.banned)}>
                        {u.banned ? '解封' : '封禁'}
                      </button>
                      <button className="btn-small" style={{ marginLeft: 4, color: '#f44336' }}
                        onClick={() => deleteUser(u.id, u.nickname || u.username)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 分页 */}
            {userTotalPages > 1 && (
              <div className="pagination">
                <button disabled={userPage <= 1} onClick={() => loadUsers(userPage - 1, userSearch)}>上一页</button>
                <span>第 {userPage}/{userTotalPages} 页</span>
                <button disabled={userPage >= userTotalPages} onClick={() => loadUsers(userPage + 1, userSearch)}>下一页</button>
              </div>
            )}

            {/* 编辑弹窗 */}
            {editingUser && (
              <div className="modal-overlay" onClick={() => setEditingUser(null)}>
                <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
                  <h2>{editingUser === 'new' ? '添加用户' : '编辑用户'}</h2>

                  {/* 头像预览 + 审核按钮（仅编辑已有用户时显示） */}
                  {editingUser !== 'new' && (
                    <div className="admin-avatar-section">
                      <div className="admin-avatar-preview">
                        {userForm.avatar_path ? (
                          <img src={`/api/avatars/${encodeURIComponent(userForm.avatar_path)}?t=${Date.now()}`} alt="avatar" className="admin-avatar-img" />
                        ) : (
                          <span className="admin-avatar-placeholder">
                            {(userForm.nickname || userForm.username || '?').charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="admin-avatar-controls">
                        <div className="admin-avatar-status">
                          状态：{
                            userForm.avatar_status === 'locked' ? <span className="avatar-status-tag locked">🔒 锁定</span> :
                            userForm.avatar_path ? <span className="avatar-status-tag approved">✅ 允许</span> :
                            <span className="avatar-status-tag none">无头像</span>
                          }
                        </div>
                        <div className="admin-avatar-buttons">
                          <button
                            className="btn-avatar-action approve"
                            onClick={() => setAvatarStatus(editingUser, 'approved')}
                          >允许</button>
                          <button
                            className="btn-avatar-action forbid"
                            onClick={async () => { if (await modalConfirm('确定<span class="danger">禁止</span>该用户头像？将清空当前头像，<span class="danger">用户可重新上传</span>。')) setAvatarStatus(editingUser, 'forbidden'); }}
                            disabled={!userForm.avatar_path}
                          >禁止</button>
                          <button
                            className="btn-avatar-action lock"
                            onClick={async () => { if (await modalConfirm('确定<span class="danger">锁定</span>该用户头像权限？将清空当前头像且<span class="danger">用户不能再改</span>。')) setAvatarStatus(editingUser, 'locked'); }}
                            disabled={userForm.avatar_status === 'locked'}
                          >锁定</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {editingUser === 'new' && (
                    <>
                      <label>用户名</label>
                      <input value={userForm.username || ''} onChange={e => setUserForm({ ...userForm, username: e.target.value })} />
                    </>
                  )}
                  <label>密码{editingUser !== 'new' ? '（留空不修改）' : ''}</label>
                  <input type="password" value={userForm.password || ''} onChange={e => setUserForm({ ...userForm, password: e.target.value })} />
                  <label>昵称</label>
                  <input value={userForm.nickname || ''} onChange={e => setUserForm({ ...userForm, nickname: e.target.value })} />
                  <label>出生日期</label>
                  <input type="date" value={userForm.birth_date || ''} onChange={e => setUserForm({ ...userForm, birth_date: e.target.value })} />
                  <label>性别</label>
                  <Dropdown
                    options={[{ value: '', label: '未设置' }, { value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '其他' }]}
                    value={userForm.gender || ''}
                    onChange={v => setUserForm({ ...userForm, gender: v })}
                  />
                  <label>籍贯</label>
                  <input value={userForm.hometown || ''} onChange={e => setUserForm({ ...userForm, hometown: e.target.value })} />
                  <label>职业</label>
                  <input value={userForm.occupation || ''} onChange={e => setUserForm({ ...userForm, occupation: e.target.value })} />
                  <label>爱好（逗号分隔）</label>
                  <input value={userForm.hobbies || ''} onChange={e => setUserForm({ ...userForm, hobbies: e.target.value })} />
                   <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn-primary" style={{ flex: 1, width: 'auto' }} onClick={saveUser}>保存</button>
                    <button className="btn-close" style={{ flex: 1, width: 'auto', marginTop: 0 }} onClick={() => setEditingUser(null)}>取消</button>
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case 'records':
        const viewRecord = async (record: any) => {
          const d = await api(`/api/admin/records/${record.id}`);
          if (d.record) {
            let moves = [];
            try { moves = JSON.parse(d.record.moves || '[]'); } catch {}
            setViewingRecord(d.record);
            setRecordMoves(moves);
            setRecordStep(moves.length - 1);
            setFullscreen(false);
          }
        };
        const deleteRecord = async (record: any) => {
          const ok = await modalConfirm('确定删除这条对局记录？此操作不可撤销。');
          if (!ok) return;
          await api(`/api/admin/records/${record.id}`, { method: 'DELETE' });
          loadRecords(recordsPage);
        };
        const downloadSGF = (record: any) => {
          if (!record.sgf) { alert('该记录无 SGF 数据'); return; }
          const blob = new Blob([record.sgf], { type: 'application/x-go-sgf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `game_${record.id}.sgf`;
          a.click();
          URL.revokeObjectURL(url);
        };
        const buildReplayBoard = () => {
          if (!viewingRecord) return null;
          const isCC = viewingRecord.game_type === 'chinese-chess';

          if (isCC) {
            // 中国象棋：从初始棋盘 + moves 重建
            const INIT_BOARD: (string | null)[][] = Array.from({ length: 10 }, () => Array(9).fill(null));
            const RED_BACK = ['red_rook','red_knight','red_bishop','red_advisor','red_king','red_advisor','red_bishop','red_knight','red_rook'];
            const BLACK_BACK = ['black_rook','black_knight','black_bishop','black_advisor','black_king','black_advisor','black_bishop','black_knight','black_rook'];
            for (let c = 0; c < 9; c++) { INIT_BOARD[9][c] = RED_BACK[c]; INIT_BOARD[0][c] = BLACK_BACK[c]; }
            for (const c of [0,2,4,6,8]) { INIT_BOARD[6][c] = 'red_pawn'; INIT_BOARD[3][c] = 'black_pawn'; }
            INIT_BOARD[7][1] = 'red_cannon'; INIT_BOARD[7][7] = 'red_cannon';
            INIT_BOARD[2][1] = 'black_cannon'; INIT_BOARD[2][7] = 'black_cannon';

            const board = INIT_BOARD.map(r => [...r]);
            for (let i = 0; i <= recordStep && i < recordMoves.length; i++) {
              const m = recordMoves[i];
              if (m.fromRow !== undefined && m.fromCol !== undefined) {
                board[m.row][m.col] = board[m.fromRow][m.fromCol];
                board[m.fromRow][m.fromCol] = null;
              }
            }
            const lastMove = recordMoves[recordStep] ? { row: recordMoves[recordStep].row, col: recordMoves[recordStep].col } : null;
            const lastFrom = recordMoves[recordStep]?.fromRow !== undefined ? { row: recordMoves[recordStep].fromRow, col: recordMoves[recordStep].fromCol } : null;
            return { board, lastMove, lastFrom, isCC: true };
          }

          if (viewingRecord.game_type === 'chess') {
            // 国际象棋：从初始棋盘 + moves 重建
            const INIT_BOARD: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
            const BACK = ['white_rook','white_knight','white_bishop','white_queen','white_king','white_bishop','white_knight','white_rook'];
            for (let c = 0; c < 8; c++) {
              INIT_BOARD[7][c] = BACK[c]; INIT_BOARD[0][c] = BACK[c].replace('white_', 'black_');
              INIT_BOARD[6][c] = 'white_pawn'; INIT_BOARD[1][c] = 'black_pawn';
            }

            const board = INIT_BOARD.map(r => [...r]);
            for (let i = 0; i <= recordStep && i < recordMoves.length; i++) {
              const m = recordMoves[i];
              if (m.fromRow !== undefined && m.fromCol !== undefined) {
                board[m.row][m.col] = board[m.fromRow][m.fromCol];
                board[m.fromRow][m.fromCol] = null;
              }
            }
            const lastMove = recordMoves[recordStep] ? { row: recordMoves[recordStep].row, col: recordMoves[recordStep].col } : null;
            const lastFrom = recordMoves[recordStep]?.fromRow !== undefined ? { row: recordMoves[recordStep].fromRow, col: recordMoves[recordStep].fromCol } : null;
            return { board, lastMove, lastFrom, isChess: true };
          }

          if (viewingRecord.game_type === 'draughts') {
            // 国际跳棋：10x10 棋盘，只用深色格子
            const ROWS = 10, COLS = 10;
            const INIT_BOARD: (string | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < COLS; c++) {
                if ((r + c) % 2 === 1) INIT_BOARD[r][c] = 'black_man';
              }
            }
            for (let r = 7; r < 10; r++) {
              for (let c = 0; c < COLS; c++) {
                if ((r + c) % 2 === 1) INIT_BOARD[r][c] = 'white_man';
              }
            }

            const board = INIT_BOARD.map(r => [...r]);
            for (let i = 0; i <= recordStep && i < recordMoves.length; i++) {
              const m = recordMoves[i];
              if (m.fromRow !== undefined && m.fromCol !== undefined) {
                board[m.row][m.col] = board[m.fromRow][m.fromCol];
                board[m.fromRow][m.fromCol] = null;
              }
            }
            const lastMove = recordMoves[recordStep] ? { row: recordMoves[recordStep].row, col: recordMoves[recordStep].col } : null;
            const lastFrom = recordMoves[recordStep]?.fromRow !== undefined ? { row: recordMoves[recordStep].fromRow, col: recordMoves[recordStep].fromCol } : null;
            return { board, lastMove, lastFrom, isDraughts: true };
          }

          // 围棋/五子棋
          const size = viewingRecord.board_size || 19;
          const board: (string | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

          // 围棋提子检测辅助函数
          const getGroup = (b: (string|null)[][], r: number, c: number): { positions: {r:number,c:number}[], color: string } | null => {
            const color = b[r][c];
            if (!color) return null;
            const visited = new Set<string>();
            const positions: {r:number,c:number}[] = [];
            const queue = [{r, c}];
            while (queue.length > 0) {
              const pos = queue.pop()!;
              const key = `${pos.r},${pos.c}`;
              if (visited.has(key)) continue;
              if (pos.r < 0 || pos.r >= size || pos.c < 0 || pos.c >= size) continue;
              if (b[pos.r][pos.c] !== color) continue;
              visited.add(key);
              positions.push(pos);
              queue.push({r: pos.r-1, c: pos.c}, {r: pos.r+1, c: pos.c}, {r: pos.r, c: pos.c-1}, {r: pos.r, c: pos.c+1});
            }
            return { positions, color };
          };

          const getLiberties = (b: (string|null)[][], group: {r:number,c:number}[]): number => {
            const libs = new Set<string>();
            for (const pos of group) {
              for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nr = pos.r + dr, nc = pos.c + dc;
                if (nr >= 0 && nr < size && nc >= 0 && nc < size && b[nr][nc] === null) {
                  libs.add(`${nr},${nc}`);
                }
              }
            }
            return libs.size;
          };

          const removeDeadGroups = (b: (string|null)[][], color: string) => {
            const checked = new Set<string>();
            for (let r = 0; r < size; r++) {
              for (let c = 0; c < size; c++) {
                if (b[r][c] !== color) continue;
                const key = `${r},${c}`;
                if (checked.has(key)) continue;
                const group = getGroup(b, r, c);
                if (!group) continue;
                for (const p of group.positions) checked.add(`${p.r},${p.c}`);
                if (getLiberties(b, group.positions) === 0) {
                  for (const p of group.positions) b[p.r][p.c] = null;
                }
              }
            }
          };

          for (let i = 0; i <= recordStep && i < recordMoves.length; i++) {
            const m = recordMoves[i];
            if (m.row >= 0 && m.row < size && m.col >= 0 && m.col < size) {
              board[m.row][m.col] = m.color;
              // 围棋：提掉对方无气棋组
              if (viewingRecord.game_type === 'go') {
                const opponent = m.color === 'black' ? 'white' : 'black';
                removeDeadGroups(board, opponent);
                removeDeadGroups(board, m.color);
              }
            }
          }
          const lastMove = recordMoves[recordStep] ? { row: recordMoves[recordStep].row, col: recordMoves[recordStep].col } : null;
          return { board, lastMove, isCC: false };
        };
        const replayData = buildReplayBoard();
        return (
          <>
            <h1>对局记录</h1>
            {records.length === 0 ? (
              <p className="text-muted">暂无对局记录</p>
            ) : (
              <table className="admin-table">
                <thead><tr><th>序号</th><th>游戏</th><th>棋盘</th><th>玩家</th><th>结果</th><th>时间</th><th>操作</th></tr></thead>
                <tbody>
                  {records.map((r, i) => (
                      <tr key={r.id}>
                        <td>{i + 1}</td>
                        <td>{GAME_TYPE_MAP[r.game_type] || r.game_type}</td>
                        <td>{r.board_size}×{r.board_size}</td>
                        <td>{formatPlayers(r)}</td>
                        <td>{formatResult(r)}</td>
                        <td>{r.created_at?.slice(0, 19) || '-'}</td>
                        <td>
                          <button className="btn-small" onClick={() => viewRecord(r)}>查看</button>
                          <button className="btn-small" style={{ marginLeft: 4, color: '#f44336' }} onClick={() => deleteRecord(r)}>删除</button>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            )}
            {recordsTotal > recordsPerPage && (
              <div className="pagination">
                <button disabled={recordsPage <= 1} onClick={() => loadRecords(recordsPage - 1)}>上一页</button>
                <span>第 {recordsPage}/{Math.ceil(recordsTotal / recordsPerPage)} 页</span>
                <button disabled={recordsPage >= Math.ceil(recordsTotal / recordsPerPage)} onClick={() => loadRecords(recordsPage + 1)}>下一页</button>
              </div>
            )}

            {/* 棋谱回放弹窗 */}
            {viewingRecord && (
              <div className="modal-overlay" onClick={() => { setViewingRecord(null); setFullscreen(false); }}>
                <div className={`modal-content record-view-modal ${fullscreen ? 'fullscreen' : ''}`} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h2 style={{ margin: 0 }}>棋谱回放</h2>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-small" onClick={() => setFullscreen(true)}>全屏预览</button>
                      {['chinese-chess', 'chess'].includes(viewingRecord.game_type) ? (
                        <button className="btn-small" onClick={() => {
                          const data = viewingRecord.pgn || viewingRecord.sgf;
                          if (!data) { alert('该记录无棋谱数据'); return; }
                          const blob = new Blob([data], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `game_${viewingRecord.id}.pgn`; a.click(); URL.revokeObjectURL(url);
                        }}>下载 PGN</button>
                      ) : viewingRecord.game_type === 'draughts' ? (
                        <button className="btn-small" onClick={() => {
                          const data = viewingRecord.pdn || viewingRecord.sgf;
                          if (!data) { alert('该记录无棋谱数据'); return; }
                          const blob = new Blob([data], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `game_${viewingRecord.id}.pdn`; a.click(); URL.revokeObjectURL(url);
                        }}>下载 PDN</button>
                      ) : (
                        <button className="btn-small" onClick={() => downloadSGF(viewingRecord)}>下载 SGF</button>
                      )}
                      <button className="btn-small" onClick={() => { setViewingRecord(null); setFullscreen(false); }}>✕</button>
                    </div>
                  </div>
                  <p className="text-muted" style={{ marginBottom: 12, fontSize: 13, color: '#fff' }}>
                    {(() => { try { return JSON.parse(viewingRecord.players).map((p: any) => `${p.name}(${p.color})`).join(' vs '); } catch { return ''; } })()}
                    {' · '}
                    {formatResult(viewingRecord)} · {viewingRecord.created_at?.slice(0, 19)}
                    {viewingRecord.scores && (() => { try { const s = JSON.parse(viewingRecord.scores); return ` · 黑${s.black ?? 0} 白${s.white ?? 0}`; } catch { return ''; } })()}
                  </p>
                  {replayData && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {replayData.isCC ? (
                        <ChineseChessBoard
                          board={replayData.board}
                          selectedPos={null}
                          validMoves={[]}
                          lastMoveFrom={replayData.lastFrom || null}
                          lastMoveTo={replayData.lastMove || null}
                          myColor={null}
                          isMyTurn={false}
                          onSelect={() => {}}
                          width={fullscreen ? Math.min(window.innerWidth - 80, 540) : 480}
                          height={fullscreen ? Math.min(window.innerHeight - 200, 600) : 530}
                        />
                      ) : replayData.isChess ? (
                        <ChessBoard
                          board={replayData.board}
                          selectedPos={null}
                          validMoves={[]}
                          lastMoveFrom={replayData.lastFrom || null}
                          lastMoveTo={replayData.lastMove || null}
                          myColor={null}
                          isMyTurn={false}
                          onSelect={() => {}}
                          width={fullscreen ? Math.min(window.innerWidth - 80, 480) : 420}
                          height={fullscreen ? Math.min(window.innerHeight - 200, 480) : 420}
                        />
                      ) : replayData.isDraughts ? (
                        <DraughtsBoard
                          board={replayData.board}
                          selectedPos={null}
                          validMoves={[]}
                          lastMoveFrom={replayData.lastFrom || null}
                          lastMoveTo={replayData.lastMove || null}
                          myColor={null}
                          isMyTurn={false}
                          onSelect={() => {}}
                          width={fullscreen ? Math.min(window.innerWidth - 80, 560) : 480}
                          height={fullscreen ? Math.min(window.innerHeight - 200, 560) : 480}
                        />
                      ) : (
                        <GoBoard
                          board={replayData.board}
                          boardSize={viewingRecord.board_size || 19}
                          lastMove={replayData.lastMove}
                          myColor={null}
                          isMyTurn={false}
                          onPlace={() => {}}
                          width={fullscreen ? Math.min(window.innerWidth - 80, 800) : 560}
                          height={fullscreen ? Math.min(window.innerHeight - 200, 800) : 560}
                          moveNumbers={showMoveNumbers && viewingRecord.game_type === 'go' ? (() => {
                            const nums = new Map<string, number>();
                            for (let i = 0; i <= recordStep && i < recordMoves.length; i++) {
                              const m = recordMoves[i];
                              if (m.row >= 0 && m.row < (viewingRecord.board_size || 19) && m.col >= 0 && m.col < (viewingRecord.board_size || 19)) {
                                nums.set(`${m.row},${m.col}`, i + 1);
                              }
                            }
                            return nums;
                          })() : null}
                        />
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                        <button className="btn-small" disabled={recordStep <= 0} onClick={() => setRecordStep(0)}>⏮</button>
                        <button className="btn-small" disabled={recordStep <= 0} onClick={() => setRecordStep(s => Math.max(0, s - 1))}>◀</button>
                        <span style={{ minWidth: 80, textAlign: 'center', fontSize: 13 }}>
                          {recordStep + 1} / {recordMoves.length}
                        </span>
                        <button className="btn-small" disabled={recordStep >= recordMoves.length - 1} onClick={() => setRecordStep(s => Math.min(recordMoves.length - 1, s + 1))}>▶</button>
                        <button className="btn-small" disabled={recordStep >= recordMoves.length - 1} onClick={() => setRecordStep(recordMoves.length - 1)}>⏭</button>
                        {viewingRecord?.game_type === 'go' && (
                          <button className="btn-small" style={{ marginLeft: 8, background: showMoveNumbers ? 'rgba(220,179,92,0.3)' : undefined }} onClick={() => setShowMoveNumbers(!showMoveNumbers)}>
                            {showMoveNumbers ? '🔢 隐藏手数' : '🔢 显示手数'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {fullscreen && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                      <button className="btn-small" onClick={() => setFullscreen(false)}>退出全屏</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        );

      case 'games':
        const startEdit = (g: any) => { setEditingGame(g.id); setEditForm({ ...g }); };
        const saveGame = async () => {
          if (editingGame === 'new') {
            await api('/api/games', { method: 'POST', body: JSON.stringify(editForm) });
          } else if (editingGame !== editForm.id) {
            await api(`/api/games/${editingGame}`, { method: 'DELETE' });
            await api('/api/games', { method: 'POST', body: JSON.stringify(editForm) });
          } else {
            await api(`/api/games/${editingGame}`, { method: 'PUT', body: JSON.stringify(editForm) });
          }
          setEditingGame(null);
          api('/api/games/all').then(d => setGameList(d.games || []));
        };
        const deleteGame = async (id: string, name: string) => {
          const ok = await modalConfirm(`确定删除游戏「${name}」？`);
          if (!ok) return;
          await api(`/api/games/${id}`, { method: 'DELETE' });
          api('/api/games/all').then(d => setGameList(d.games || []));
        };
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h1 style={{ margin: 0 }}>游戏管理</h1>
              <button className="btn-small" style={{ padding: '8px 16px', fontSize: 14 }} onClick={() => { setEditingGame('new'); setEditForm({ id: '', name: '', description: '', icon_svg: '', sort_order: 0, status: 'developing' }); }}>+ 添加游戏</button>
            </div>
            <table className="admin-table">
              <thead><tr><th>排序</th><th>游戏</th><th>标识</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {gameList.map((g, i) => (
                  <tr key={g.id}>
                    <td>{g.sort_order}</td>
                    <td><strong>{g.name}</strong><p className="text-muted" style={{ fontSize: 11 }}>{g.description}</p></td>
                    <td><code style={{ fontSize: 11 }}>{g.id}</code></td>
                    <td>{g.status === 'ready' ? '🟢 已开放' : g.status === 'conceal' ? '⚫ 隐藏' : '🟡 开发中'}</td>
                    <td>
                      <button className="btn-small" onClick={() => startEdit(g)}>编辑</button>
                      <button className="btn-small" style={{ marginLeft: 4, color: '#f44336' }} onClick={() => deleteGame(g.id, g.name)}>删除</button>
                      <button className="btn-small" style={{ marginLeft: 4 }} disabled={i === 0} onClick={async () => {
                        const prev = gameList[i - 1];
                        if (!prev) return;
                        await api(`/api/games/${g.id}`, { method: 'PUT', body: JSON.stringify({ sort_order: prev.sort_order }) });
                        await api(`/api/games/${prev.id}`, { method: 'PUT', body: JSON.stringify({ sort_order: g.sort_order }) });
                        api('/api/games/all').then(d => setGameList(d.games || []));
                      }}>▲</button>
                      <button className="btn-small" style={{ marginLeft: 2 }} disabled={i === gameList.length - 1} onClick={async () => {
                        const next = gameList[i + 1];
                        if (!next) return;
                        await api(`/api/games/${g.id}`, { method: 'PUT', body: JSON.stringify({ sort_order: next.sort_order }) });
                        await api(`/api/games/${next.id}`, { method: 'PUT', body: JSON.stringify({ sort_order: g.sort_order }) });
                        api('/api/games/all').then(d => setGameList(d.games || []));
                      }}>▼</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editingGame && (
              <div className="modal-overlay" onClick={() => setEditingGame(null)}>
                <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
                  <h2>{editingGame === 'new' ? '添加游戏' : '编辑游戏'}</h2>
                  <label>游戏 ID</label>
                  <input value={editForm.id || ''} placeholder="如 chess、chinese-chess、draughts、mahjong" onChange={e => setEditForm({ ...editForm, id: e.target.value })} />
                  <label>名称</label>
                  <input value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                  <label>描述</label>
                  <input value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
                  <label>排序</label>
                  <input type="number" value={editForm.sort_order ?? 0} onChange={e => setEditForm({ ...editForm, sort_order: parseInt(e.target.value) || 0 })} />
                  <label>状态</label>
                  <Dropdown
                    options={[{ value: 'ready', label: '已开放' }, { value: 'developing', label: '开发中' }, { value: 'conceal', label: '隐藏' }]}
                    value={editForm.status || 'developing'}
                    onChange={v => setEditForm({ ...editForm, status: v })}
                  />
                  <label>图标 SVG</label>
                  <textarea rows={8} value={editForm.icon_svg || ''}
                    onChange={e => setEditForm({ ...editForm, icon_svg: e.target.value })}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, padding: 8 }} />
                  {editForm.icon_svg && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                      <div dangerouslySetInnerHTML={{ __html: editForm.icon_svg }} style={{ width: 48, height: 48 }} />
                      <span className="text-muted">预览</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="btn-primary" style={{ flex: 1, width: 'auto' }} onClick={saveGame}>保存</button>
                    <button className="btn-close" style={{ flex: 1, width: 'auto', marginTop: 0 }} onClick={() => setEditingGame(null)}>取消</button>
                  </div>
                </div>
              </div>
            )}
          </>
        );

      case 'stats':
        const PIE_COLORS = ['#dcb35c', '#0071e3', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
        const GAME_NAME: Record<string, string> = { go: '围棋', gomoku: '五子棋', 'chinese-chess': '中国象棋', chess: '国际象棋', draughts: '国际跳棋', mahjong: '麻将' };
        const gameStatsData = statsData?.gameStats || [];
        const maxPlayCount = Math.max(1, ...gameStatsData.map((g: any) => g.play_count));
        const pieData = gameStatsData.filter((g: any) => g.play_count > 0).slice(0, 10).map((g: any, i: number) => ({
          label: GAME_NAME[g.game_type] || g.game_type,
          value: g.play_count,
          color: PIE_COLORS[i % PIE_COLORS.length],
        }));
        const lineData = (statsData?.dailyGames || []).map((d: any) => ({
          label: d.day?.slice(5) || '-',
          value: d.count,
        }));
        const topPlayers = statsData?.topPlayers || [];
        const demographics = statsData?.demographics;

        const GAME_OPTIONS = [
          { value: 'go', label: '围棋' },
          { value: 'gomoku', label: '五子棋' },
          { value: 'chinese-chess', label: '中国象棋' },
          { value: 'chess', label: '国际象棋' },
          { value: 'draughts', label: '国际跳棋' },
        ];

        return (
          <>
            <h1>数据统计</h1>

            {/* 游戏热度 */}
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>游戏热度</h2>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                {gameStatsData.length === 0 ? (
                  <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>
                ) : (
                  gameStatsData.map((g: any) => (
                    <div key={g.game_type} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ width: 80, fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>{GAME_NAME[g.game_type] || g.game_type}</div>
                      <div style={{ flex: 1, position: 'relative', height: 28, display: 'flex', alignItems: 'center' }}>
                        <div style={{ height: '100%', background: 'linear-gradient(90deg, rgba(220,179,92,0.15), rgba(220,179,92,0.35))', borderRadius: 6, minWidth: 4, width: `${(g.play_count / maxPlayCount) * 100}%`, transition: 'width 0.5s ease' }} />
                        <span style={{ position: 'absolute', left: 12, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{g.play_count} 局</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 图表行：饼图 + 折线图 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>对局分布</h2>
                <PieChart data={pieData} />
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>近 7 天对局趋势</h2>
                <LineChart data={lineData} />
              </div>
            </div>

            {/* 排行榜 + 游戏胜局 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
              {/* 总排行榜 */}
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>排行榜</h2>
                <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {topPlayers.length === 0 ? (
                    <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', padding: '12px 24px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ width: 36 }}></span>
                        <span style={{ flex: 1 }}>玩家</span>
                        <span style={{ width: 60, textAlign: 'right' }}>胜局</span>
                        <span style={{ width: 60, textAlign: 'right' }}>总局</span>
                        <span style={{ width: 60, textAlign: 'right' }}>胜率</span>
                      </div>
                      {topPlayers.map((p: any, i: number) => (
                        <div key={p.id} style={{ display: 'flex', padding: '12px 24px', fontSize: 14, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ width: 36, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </span>
                          <span style={{ flex: 1, fontWeight: 500, color: '#e0e0e0' }}>{p.username}</span>
                          <span style={{ width: 60, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#dcb35c' }}>{p.win_games}</span>
                          <span style={{ width: 60, textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{p.total_games}</span>
                          <span style={{ width: 60, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: p.win_rate >= 0.6 ? '#22c55e' : 'rgba(255,255,255,0.5)' }}>{(p.win_rate * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* 游戏胜局 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e0e0e0' }}>游戏胜局</h2>
                  <Dropdown options={GAME_OPTIONS} value={gameWinType} onChange={setGameWinType} />
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {gameWinPlayers.length === 0 ? (
                    <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', padding: '12px 24px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ width: 36 }}></span>
                        <span style={{ flex: 1 }}>玩家</span>
                        <span style={{ width: 60, textAlign: 'right' }}>胜局</span>
                      </div>
                      {gameWinPlayers.map((p: any, i: number) => (
                        <div key={p.id} style={{ display: 'flex', padding: '12px 24px', fontSize: 14, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ width: 36, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </span>
                          <span style={{ flex: 1, fontWeight: 500, color: '#e0e0e0' }}>{p.username}</span>
                          <span style={{ width: 60, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#dcb35c' }}>{p.win_count}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 用户分析 */}
            {demographics && (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>用户分析</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* 性别比例 - 柱状图 */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>性别比例</h3>
                    {demographics.genders.length > 0 ? (() => {
                      const total = demographics.genders.reduce((s: number, x: any) => s + x.value, 0);
                      const maxVal = Math.max(1, ...demographics.genders.map((g: any) => g.value));
                      const GENDER_COLORS: Record<string, string> = { '男': '#0071e3', '女': '#ec4899', '未设置': '#888' };
                      const sortedGenders = [...demographics.genders].sort((a: any, b: any) => {
                        const order: Record<string, number> = { '男': 0, '女': 1, '未设置': 2 };
                        return (order[a.name] ?? 3) - (order[b.name] ?? 3);
                      });
                      return (
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 40, padding: '16px 0', height: 180 }}>
                          {sortedGenders.map((g: any, i: number) => {
                            const pct = total > 0 ? ((g.value / total) * 100).toFixed(0) : '0';
                            const barH = (g.value / maxVal) * 130;
                            return (
                              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>{g.value}人 ({pct}%)</span>
                                <div style={{ width: 48, height: barH, background: GENDER_COLORS[g.name] || PIE_COLORS[i], borderRadius: '6px 6px 0 0', transition: 'height 0.5s ease' }} />
                                <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>{g.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })() : <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>}
                  </div>
                  {/* 年龄分布 */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#e0e0e0' }}>年龄分布</h3>
                    {demographics.ageGroups.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {demographics.ageGroups.map((a: any, i: number) => {
                          const total = demographics.ageGroups.reduce((s: number, x: any) => s + x.value, 0);
                          const pct = total > 0 ? ((a.value / total) * 100).toFixed(0) : '0';
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ width: 72, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>{a.name}</span>
                              <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 6, transition: 'width .5s ease' }} />
                              </div>
                              <span style={{ width: 80, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>{a.value}人 ({pct}%)</span>
                            </div>
                          );
                        })}
                        {demographics.unknownAge > 0 && (
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>未填写生日：{demographics.unknownAge} 人</div>
                        )}
                      </div>
                    ) : <p style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>暂无数据</p>}
                  </div>
                </div>
              </div>
            )}
          </>
        );

      default: return null;
    }
  };

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <h2>后台管理</h2>
        <ul>
          <li className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>📊 总览</li>
          <li className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>📈 数据统计</li>
          <li className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>👥 用户管理</li>
          <li className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}>📝 对局记录</li>
          <li className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}>🎮 游戏管理</li>
        </ul>
        <div style={{ marginTop: 'auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>👑 {adminName()}</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
            onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('admin_name'); nav('/admin/login'); }}>退出</span>
        </div>
      </nav>
      <main className="admin-content">{renderTab()}</main>
    </div>
  );
}
