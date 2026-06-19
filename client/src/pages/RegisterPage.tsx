import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = '/api/auth';

export default function RegisterPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError('');
    if (!username || !password) { setError('请填写用户名和密码'); return; }
    if (password.length < 4) { setError('密码至少 4 个字符'); return; }
    if (password !== confirm) { setError('两次密码不一致'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.user.username);
      nav('/');
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>lan-boardgame</h1>
        <h2>用户注册</h2>
        {error && <p className="auth-error">{error}</p>}
        <input placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} />
        <input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} />
        <input type="password" placeholder="确认密码" value={confirm} onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRegister()} />
        <button onClick={handleRegister} disabled={loading}>{loading ? '注册中...' : '注册'}</button>
        <p className="auth-link" onClick={() => nav('/login')}>已有账号？登录</p>
      </div>
    </div>
  );
}
