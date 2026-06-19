import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavicon } from '../hooks/useFavicon';
import { modalAlert } from '../components/Modal';

export default function AdminLoginPage() {
  useFavicon('/admin-icon.svg');
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { modalAlert('请填写管理员账号和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { modalAlert(data.error); return; }
      localStorage.setItem('token', data.token);
      localStorage.setItem('admin_name', data.user?.username || 'admin');
      nav('/admin');
    } catch { modalAlert('网络错误，请确认服务端已启动'); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page admin-bg">
      <div className="auth-bg-grid" />
      <div className="auth-card">
        <div className="auth-logo">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <rect x="4" y="4" width="72" height="76" rx="16" fill="none" stroke="#dcb35c" strokeWidth="2"/>
            <path d="M40 12L64 28v24c0 16-10 24-24 28-14-4-24-12-24-28V28l24-16z" fill="none" stroke="#dcb35c" strokeWidth="2.5"/>
            <text x="40" y="52" textAnchor="middle" fontSize="24" fill="#dcb35c" fontWeight="bold">A</text>
          </svg>
        </div>
        <h1>管理后台</h1>
        <p className="auth-subtitle">管理员专用入口</p>
        <div className="auth-form">
          <div className="auth-input-group">
            <input placeholder="管理员账号" value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          </div>
          <div className="auth-input-group">
            <input type="password" placeholder="密码" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          </div>
          <button className="btn-primary auth-btn" onClick={handleLogin} disabled={loading}>
            {loading ? '登录中...' : '登 录 后 台'}
          </button>
        </div>
        <p className="auth-footer">lan-boardgame 管理后台</p>
      </div>
    </div>
  );
}
