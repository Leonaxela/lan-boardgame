import { useEffect, useState, useCallback, useRef } from 'react';

interface UserProfileModalProps {
  username: string;
  isMe?: boolean;
  onClose: () => void;
}

interface ProfileData {
  user: {
    username: string;
    nickname: string;
    avatarPath: string | null;
    avatarStatus: string;
    createdAt: string;
    lastOnlineAt: string | null;
    totalOnlineSeconds: number;
  };
  stats: {
    totalGames: number;
    winGames: number;
    lossGames: number;
    drawGames: number;
    winRate: number;
  };
  heatByGame: { game_type: string; count: number; wins: number }[];
}

interface RecordItem {
  id: string;
  gameType: string;
  boardSize: number;
  opponent: string;
  myColor: string;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  difficulty: number | string;
  createdAt: string;
  durationSec: number;
}

interface RecordsData {
  records: RecordItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const GAME_NAMES: Record<string, string> = {
  go: '围棋',
  gomoku: '五子棋',
  'chinese-chess': '中国象棋',
  chess: '国际象棋',
  draughts: '国际跳棋',
  emoji: '你画我猜',
};

const GAME_COLORS: Record<string, string> = {
  go: '#dcb35c',
  gomoku: '#26c6da',
  'chinese-chess': '#ef5350',
  chess: '#7c4dff',
  draughts: '#66bb6a',
  emoji: '#ec407a',
};

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—';
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

function formatOnlineTime(sec: number): string {
  if (!sec || sec <= 0) return '0分钟';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return d.replace('T', ' ').slice(0, 16);
}

/** 压缩图片到指定尺寸，返回 JPEG data URI */
function compressImage(file: File, w: number, h: number, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        // 居中裁剪
        const scale = Math.max(w / img.width, h / img.height);
        const sw = w / scale;
        const sh = h / scale;
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export default function UserProfileModal({ username, isMe = false, onClose }: UserProfileModalProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [records, setRecords] = useState<RecordsData | null>(null);
  const [page, setPage] = useState(1);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/profile`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || '加载失败'); return; }
      setProfile(data);
    } catch {
      setError('网络错误');
    } finally {
      setLoadingProfile(false);
    }
  }, [username]);

  const loadRecords = useCallback(async (p: number) => {
    setLoadingRecords(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/records?page=${p}&limit=10`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || '加载失败'); return; }
      setRecords(data);
    } catch {
      setError('网络错误');
    } finally {
      setLoadingRecords(false);
    }
  }, [username]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadRecords(page); }, [loadRecords, page]);

  const maxHeat = profile?.heatByGame?.[0]?.count || 1;

  /** 头像 URL：有 avatarPath 用文件，否则 undefined（首字母占位） */
  const avatarUrl = profile?.user?.avatarPath
    ? `/api/avatars/${encodeURIComponent(profile.user.avatarPath)}?t=${Date.now()}`
    : undefined;

  /** 头像是否可上传：自己的资料且未被锁定 */
  const canUpload = isMe && profile?.user?.avatarStatus !== 'locked';

  /** 选择文件 → canvas 压缩 128x128 → 上传 */
  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // 允许重复选同一文件

    // 压缩
    const dataUrl = await compressImage(file, 256, 256, 0.92);
    if (!dataUrl) { setError('图片处理失败'); return; }

    setUploading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users/avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ avatar: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '上传失败'); return; }
      // 刷新 profile
      loadProfile();
    } catch {
      setError('网络错误');
    } finally {
      setUploading(false);
    }
  }, [loadProfile]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content user-profile-modal" onClick={e => e.stopPropagation()}>
        <button className="btn-logout user-profile-close" onClick={onClose}>关闭</button>

        {error && <p className="text-muted">{error}</p>}

        {/* ── 顶部资料区 ── */}
        {loadingProfile ? (
          <p className="text-muted">加载中...</p>
        ) : profile ? (
          <>
            <div className="user-profile-header">
              <div
                className={`user-profile-avatar ${canUpload ? 'avatar-clickable' : ''}`}
                onClick={() => canUpload && !uploading && fileInputRef.current?.click()}
                title={canUpload ? (uploading ? '上传中...' : '点击更换头像') : (profile?.user?.avatarStatus === 'locked' ? '头像权限已锁定' : undefined)}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="user-avatar-img" />
                ) : (
                  <span>{profile.user.nickname.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={canUpload ? handleAvatarChange : undefined}
              />
              <div className="user-profile-info">
                <h2 className="user-profile-name">{profile.user.nickname}</h2>
                <p className="user-profile-sub">@{profile.user.username}</p>
                <div className="user-profile-meta">
                  <span>注册于 {formatDate(profile.user.createdAt)}</span>
                  <span>· 在线 {formatOnlineTime(profile.user.totalOnlineSeconds)}</span>
                </div>
              </div>
            </div>

            {/* ── 统计卡片 ── */}
            <div className="user-stats-row">
              <div className="user-stat-card">
                <div className="user-stat-value">{profile.stats.totalGames}</div>
                <div className="user-stat-label">总对局</div>
              </div>
              <div className="user-stat-card win">
                <div className="user-stat-value">{profile.stats.winGames}</div>
                <div className="user-stat-label">胜局</div>
              </div>
              <div className="user-stat-card loss">
                <div className="user-stat-value">{profile.stats.lossGames}</div>
                <div className="user-stat-label">负局</div>
              </div>
              <div className="user-stat-card draw">
                <div className="user-stat-value">{profile.stats.drawGames}</div>
                <div className="user-stat-label">平局</div>
              </div>
              <div className="user-stat-card rate">
                <div className="user-stat-value">{profile.stats.winRate}%</div>
                <div className="user-stat-label">胜率</div>
              </div>
            </div>

            {/* ── 游戏热度 ── */}
            {profile.heatByGame.length > 0 && (
              <div className="user-heat-section">
                <h3 className="user-section-title">游戏热度</h3>
                <div className="user-heat-list">
                  {profile.heatByGame.map((g) => {
                    const color = GAME_COLORS[g.game_type] || '#888';
                    const pct = Math.max(8, Math.round((g.count / maxHeat) * 100));
                    const wr = g.count > 0 ? Math.round((g.wins / g.count) * 100) : 0;
                    return (
                      <div key={g.game_type} className="user-heat-item">
                        <span className="user-heat-name" style={{ color }}>
                          {GAME_NAMES[g.game_type] || g.game_type}
                        </span>
                        <div className="user-heat-bar-wrap">
                          <div className="user-heat-bar" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span className="user-heat-count">{g.count} 局</span>
                        <span className="user-heat-wr">{wr}% 胜</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}

        {/* ── 对局列表 ── */}
        <div className="user-records-section">
          <h3 className="user-section-title">
            对局记录
            {records && <span className="user-records-total">（共 {records.total} 场）</span>}
          </h3>

          {loadingRecords ? (
            <p className="text-muted">加载中...</p>
          ) : records && records.records.length > 0 ? (
            <>
              <table className="user-records-table">
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>游戏</th>
                    <th>对手</th>
                    <th>结果</th>
                    <th>时长</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {records.records.map((r, i) => {
                    const color = GAME_COLORS[r.gameType] || '#888';
                    const resultText = r.result === 'win' ? '胜' : r.result === 'loss' ? '负' : '平';
                    const resultClass = r.result === 'win' ? 'ur-win' : r.result === 'loss' ? 'ur-loss' : 'ur-draw';
                    const seq = (records.page - 1) * records.limit + (i + 1);
                    return (
                      <tr key={r.id}>
                        <td className="ur-seq">{seq}</td>
                        <td>
                          <span className="ur-game-dot" style={{ background: color }} />
                          {GAME_NAMES[r.gameType] || r.gameType}
                        </td>
                        <td>{r.opponent}</td>
                        <td><span className={`ur-result ${resultClass}`}>{resultText}</span></td>
                        <td>{formatDuration(r.durationSec)}</td>
                        <td className="ur-time">{formatDate(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* 分页 */}
              {records.totalPages > 1 && (
                <div className="user-records-pagination">
                  <button
                    className="btn-page"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >上一页</button>
                  <span className="page-info">{page} / {records.totalPages}</span>
                  <button
                    className="btn-page"
                    disabled={page >= records.totalPages}
                    onClick={() => setPage(p => Math.min(records.totalPages, p + 1))}
                  >下一页</button>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted">暂无对局记录</p>
          )}
        </div>
      </div>
    </div>
  );
}
