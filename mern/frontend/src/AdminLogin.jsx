// AdminLogin.jsx
import { useState } from 'react';

const SERVER_BASE_URL = process.env.NODE_ENV === 'production'
  ? window.location.origin
  : `${window.location.protocol}//${window.location.hostname}:4000`;

const T = {
  card: '#FFFFFF', border: '#EEF0F6', radius: '14px',
  shadow: '0 2px 12px rgba(100,120,180,0.08)',
  text: '#2D3250', sub: '#8A90A8', inputBg: '#F2F4FA', accent: '#6BAED6', danger: '#F768A1',
};

export const ADMIN_TOKEN_KEY = 'guidant_admin_token';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

// 🔑 로그아웃용 토큰 파기 헬퍼 함수 추가
export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export default function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    if (!password) { setError('비밀번호를 입력하세요.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(`${SERVER_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인 실패');
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 16px' }}>
      <div style={{
        width: '100%', maxWidth: 320, background: T.card, border: `1.5px solid ${T.border}`,
        borderRadius: T.radius, boxShadow: T.shadow, padding: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 16 }}>
          ⚙️ 관리자 로그인
        </div>
        <input
          type="password"
          placeholder="관리자 비밀번호"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10,
            border: `1px solid ${T.border}`, background: T.inputBg,
            fontSize: 13, color: T.text, boxSizing: 'border-box', marginBottom: 10,
          }}
        />
        {error && <div style={{ color: T.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button
          onClick={handleLogin}
          disabled={busy}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none',
            background: T.accent, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {busy ? '확인 중...' : '로그인'}
        </button>
      </div>
    </div>
  );
}