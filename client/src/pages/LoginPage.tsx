import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { modalAlert } from '../components/Modal';
import { useFavicon } from '../hooks/useFavicon';
import FluidBackground from '../components/FluidBackground';

const API = '/api/auth';

export default function LoginPage() {
  useFavicon('/user-icon.svg');
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { modalAlert('请填写用户名和密码'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      let data: any;
      try { data = await res.json(); }
      catch { modalAlert('服务端返回异常（非 JSON 响应）'); return; }
      if (!res.ok) { modalAlert(data.error || `登录失败 (${res.status})`); return; }
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.user.username);
      nav('/');
    } catch (err) {
      modalAlert(err instanceof TypeError ? '网络错误，请确认服务端已启动' : `请求失败：${err}`);
    }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <FluidBackground />
      <div className="auth-card" style={{ userSelect: 'none' }}>
        <div className="auth-logo">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <rect width="80" height="80" rx="16" fill="#dcb35c"/>
            <line x1="16" y1="16" x2="16" y2="64" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="32" y1="16" x2="32" y2="64" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="48" y1="16" x2="48" y2="64" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="64" y1="16" x2="64" y2="64" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="16" y1="16" x2="64" y2="16" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="16" y1="32" x2="64" y2="32" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="16" y1="48" x2="64" y2="48" stroke="#5a3e0a" strokeWidth="1"/>
            <line x1="16" y1="64" x2="64" y2="64" stroke="#5a3e0a" strokeWidth="1"/>
            <circle cx="32" cy="32" r="7" fill="#1a1a1a"/>
            <circle cx="48" cy="48" r="7" fill="#f0f0f0" stroke="#ccc" strokeWidth="0.5"/>
          </svg>
        </div>
        <h1>lan-boardgame</h1>
        <p className="auth-subtitle">局域网棋类对战平台</p>
        <div className="auth-form">
          <div className="auth-input-group">
            <input placeholder="用户名" value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          </div>
          <div className="auth-input-group">
            <input type={showPassword ? 'text' : 'password'} placeholder="密码" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button type="button" className="auth-toggle-pwd" onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}>
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                  <line x1="2" y1="2" x2="22" y2="22"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
          <button className="btn-primary auth-btn" onClick={handleLogin} disabled={loading}>
            {loading ? <span className="btn-loading">登录中...</span> : '进 入 大 厅'}
          </button>
        </div>
        <p className="auth-footer">
          若忘记密码，请联系管理员
        </p>
      </div>
    </div>
  );
}
