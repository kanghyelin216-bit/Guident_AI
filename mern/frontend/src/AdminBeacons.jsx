import { useState, useEffect, useRef, useCallback } from 'react';
import { getAdminToken, ADMIN_TOKEN_KEY } from './AdminLogin';

const YOUR_COMPUTER_IP = process.env.NODE_ENV === 'production' 
  ? window.location.origin 
  : (window.location.port === '5173' || window.location.port === '3000'
      ? `${window.location.protocol}//${window.location.hostname}:4000`
      : 'http://192.168.219.113:4000');

async function authFetch(url, options = {}) {
  const token = getAdminToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
    throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.');
  }
  return res;
}

const T = {
  bg: '#FAFBFF', card: '#FFFFFF', border: '#EEF0F6', radius: '14px',
  shadow: '0 2px 12px rgba(100,120,180,0.08)', text: '#2D3250', sub: '#8A90A8',
  inputBg: '#F2F4FA', accent: '#6BAED6', danger: '#F768A1', ok: '#74C476',
};

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: `1px solid ${T.border}`, background: T.inputBg, fontSize: 13, color: T.text, boxSizing: 'border-box',
};

const btnStyle = (bg, color = 'white') => ({
  padding: '9px 14px', borderRadius: 10, border: 'none', background: bg, color, fontSize: 13, fontWeight: 600, cursor: 'pointer',
});

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: '#FEF0F5', border: `1px solid ${T.danger}`, color: T.danger,
      borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 500,
    }}>
      ⚠️ {message}
    </div>
  );
}

function MapUploadForm({ onUploaded }) {
  const [name, setName] = useState('');
  const [widthM, setWidthM] = useState('8');
  const [heightM, setHeightM] = useState('17');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name || !file) { setError('지도 이름과 이미지 파일을 모두 입력하세요.'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('name', name);
      form.append('widthM', widthM);
      form.append('heightM', heightM);
      form.append('cellSizeM', '1');
      form.append('image', file);

      const res = await authFetch(`${YOUR_COMPUTER_IP}/api/maps`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('업로드 실패');
      const doc = await res.json();
      onUploaded(doc);
    } catch (err) {
      setError('업로드 중 오류: ' + err.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}>🗺️ 새 지도 업로드</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input style={inputStyle} placeholder="지도 이름" value={name} onChange={e => setName(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={inputStyle} type="number" placeholder="가로(m)" value={widthM} onChange={e => setWidthM(e.target.value)} />
          <input style={inputStyle} type="number" placeholder="세로(m)" value={heightM} onChange={e => setHeightM(e.target.value)} />
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
        {error && <div style={{ color: T.danger, fontSize: 12 }}>{error}</div>}
        <button style={btnStyle(T.accent)} onClick={handleSubmit} disabled={busy}>{busy ? '업로드 중...' : '업로드'}</button>
      </div>
    </div>
  );
}

export default function AdminBeaconsSection() {
  const [tab, setTab] = useState('beacon');
  const [maps, setMaps] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [selectedMap, setSelectedMap] = useState(null);
  const [beacons, setBeacons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingClick, setPendingClick] = useState(null);
  const [formState, setFormState] = useState({ beaconId: '', major: '', minor: '', txPower: -59, label: '' });
  const [facilityForm, setFacilityForm] = useState({ id: '', label: '', icon: 'toilet' });
  const [error, setError] = useState('');
  const imgRef = useRef(null);

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
  };

  const loadMaps = useCallback(async () => {
    const res = await fetch(`${YOUR_COMPUTER_IP}/api/maps`);
    const data = await res.json();
    setMaps(data);
    if (data.length > 0 && !selectedMapId) setSelectedMapId(data[0]._id);
    setLoading(false);
  }, [selectedMapId]);

  const loadBeacons = useCallback(async (mapId) => {
    if (!mapId) { setBeacons([]); return; }
    const res = await fetch(`${YOUR_COMPUTER_IP}/api/beacons?mapId=${mapId}`);
    setBeacons(await res.json());
  }, []);

  const loadSelectedMapDetail = useCallback(async (mapId) => {
    if (!mapId) { setSelectedMap(null); return; }
    const res = await fetch(`${YOUR_COMPUTER_IP}/api/maps/${mapId}`);
    setSelectedMap(await res.json());
  }, []);

  useEffect(() => { loadMaps(); }, []);
  useEffect(() => {
    loadBeacons(selectedMapId);
    loadSelectedMapDetail(selectedMapId);
    setPendingClick(null);
  }, [selectedMapId, loadBeacons, loadSelectedMapDetail]);

  const handleMapClick = (e) => {
    if (!selectedMap || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const xM = (pxX / rect.width) * selectedMap.widthM;
    const yM = (pxY / rect.height) * selectedMap.heightM;
    setPendingClick({ xM, yM, pxX, pxY });
    setError('');
  };

  const handleRegister = async () => {
    if (!pendingClick) { setError('먼저 지도를 클릭해 위치를 지정하세요.'); return; }
    if (!formState.beaconId) { setError('beaconId를 입력하세요.'); return; }

    try {
      const res = await authFetch(`${YOUR_COMPUTER_IP}/api/beacons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beaconId: formState.beaconId.trim().toUpperCase(),
          x: Number(pendingClick.xM.toFixed(2)),
          y: Number(pendingClick.yM.toFixed(2)),
          txPower: Number(formState.txPower) || -59,
          mapId: selectedMapId,
          label: formState.label,
        }),
      });
      if (!res.ok) throw new Error('등록 실패 (중복 beaconId 확인)');
      setFormState({ beaconId: '', major: '', minor: '', txPower: -59, label: '' });
      setPendingClick(null);
      setError('');
      await loadBeacons(selectedMapId);
    } catch (err) { setError(err.message); }
  };

  const handleToggleVisible = async (beacon) => {
    try {
      await authFetch(`${YOUR_COMPUTER_IP}/api/beacons/${beacon._id}/visible`, { method: 'PATCH' });
      await loadBeacons(selectedMapId);
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (beacon) => {
    if (!window.confirm(`비콘 "${beacon.beaconId}"을(를) 삭제할까요?`)) return;
    try {
      await authFetch(`${YOUR_COMPUTER_IP}/api/beacons/${beacon._id}`, { method: 'DELETE' });
      await loadBeacons(selectedMapId);
    } catch (err) { setError(err.message); }
  };

  const handleRegisterFacility = async () => {
    if (!pendingClick) { setError('지도를 먼저 클릭하세요.'); return; }
    if (!facilityForm.id || !facilityForm.label) { setError('id와 이름을 모두 입력하세요.'); return; }
    if (!selectedMap) { setError('지도 정보를 아직 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }

    if ((selectedMap.facilities || []).some(f => f.id === facilityForm.id)) {
      setError(`시설 id "${facilityForm.id}"가 이미 존재합니다. 다른 id를 사용하세요.`);
      return;
    }

    const newFacility = {
      id: facilityForm.id,
      label: facilityForm.label,
      icon: facilityForm.icon,
      x: Number(pendingClick.xM.toFixed(2)),
      y: Number(pendingClick.yM.toFixed(2)),
    };
    const nextFacilities = [...(selectedMap?.facilities || []), newFacility];

    try {
      const res = await authFetch(`${YOUR_COMPUTER_IP}/api/maps/${selectedMapId}/facilities`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilities: nextFacilities }),
      });
      if (!res.ok) throw new Error('시설 등록 실패');
      setFacilityForm({ id: '', label: '', icon: 'toilet' });
      setPendingClick(null);
      setError('');
      await loadSelectedMapDetail(selectedMapId);
    } catch (err) { setError(err.message); }
  };

  const handleDeleteFacility = async (facilityId) => {
    if (!window.confirm(`시설 "${facilityId}"을(를) 삭제할까요?`)) return;
    if (!selectedMap) return;
    const nextFacilities = (selectedMap.facilities || []).filter(f => f.id !== facilityId);

    try {
      const res = await authFetch(`${YOUR_COMPUTER_IP}/api/maps/${selectedMapId}/facilities`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilities: nextFacilities }),
      });
      if (!res.ok) throw new Error('시설 삭제 실패');
      await loadSelectedMapDetail(selectedMapId);
    } catch (err) { setError(err.message); }
  };

  const meterToDisplayPx = (xM, yM) => {
    if (!selectedMap || !imgRef.current) return { left: 0, top: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      left: (xM / selectedMap.widthM) * rect.width,
      top: (yM / selectedMap.heightM) * rect.height,
    };
  };

  if (loading) return <div style={{ padding: 20, color: T.sub, fontSize: 13 }}>불러오는 중...</div>;

  return (
    <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720, margin: '0 auto' }}>
      {/* 관리자 헤더 영역 (제목 & 로그아웃 버튼) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.card, padding: '12px 16px', borderRadius: T.radius, border: `1.5px solid ${T.border}`, boxShadow: T.shadow }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>⚙️ 관리자 대시보드</div>
        <button
          onClick={handleLogout}
          style={{
            ...btnStyle('transparent', T.danger),
            border: `1px solid ${T.danger}`,
            padding: '6px 12px',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          🚪 로그아웃
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, background: T.inputBg, padding: 4, borderRadius: 12 }}>
        <button onClick={() => { setTab('beacon'); setPendingClick(null); setError(''); }} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: tab === 'beacon' ? T.card : 'transparent', color: tab === 'beacon' ? T.text : T.sub, boxShadow: tab === 'beacon' ? T.shadow : 'none' }}>📡 비콘 좌표 등록</button>
        <button onClick={() => { setTab('facility'); setPendingClick(null); setError(''); }} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: tab === 'facility' ? T.card : 'transparent', color: tab === 'facility' ? T.text : T.sub, boxShadow: tab === 'facility' ? T.shadow : 'none' }}>🚻 시설(화장실·출구) 등록</button>
      </div>

      <ErrorBanner message={error} />

      {maps.length === 0 ? (
        <MapUploadForm onUploaded={(doc) => { setMaps([doc]); setSelectedMapId(doc._id); }} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ ...inputStyle, flex: 1 }} value={selectedMapId} onChange={e => setSelectedMapId(e.target.value)}>
              {maps.map(m => (<option key={m._id} value={m._id}>{m.name} ({m.widthM}m × {m.heightM}m)</option>))}
            </select>
          </div>

          {selectedMap && (
            <div onClick={handleMapClick} style={{ position: 'relative', width: '100%', borderRadius: T.radius, overflow: 'hidden', border: `1.5px solid ${T.border}`, cursor: 'crosshair', lineHeight: 0 }}>
              <img ref={imgRef} src={`${YOUR_COMPUTER_IP}${selectedMap.imageUrl}`} alt={selectedMap.name} style={{ width: '100%', display: 'block', userSelect: 'none' }} draggable={false} />
              {tab === 'beacon' && beacons.map(b => {
                const { left, top } = meterToDisplayPx(b.x, b.y);
                return (<div key={b._id} style={{ position: 'absolute', left, top, transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: '50%', background: b.visible ? T.accent : '#CBD3E6', border: '2px solid white' }} />);
              })}
              {tab === 'facility' && (selectedMap.facilities || []).map(f => {
                const { left, top } = meterToDisplayPx(f.x, f.y);
                return (<div key={f.id} style={{ position: 'absolute', left, top, transform: 'translate(-50%, -50%)', width: 22, height: 22, borderRadius: '50%', background: T.ok, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: '2px solid white' }}>🚻</div>);
              })}
              {pendingClick && (<div style={{ position: 'absolute', left: pendingClick.pxX, top: pendingClick.pxY, transform: 'translate(-50%, -50%)', width: 16, height: 16, borderRadius: '50%', background: T.danger, border: '2px solid white' }} />)}
            </div>
          )}

          {tab === 'beacon' ? (
            <>
              <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16 }}>
                <input style={inputStyle} placeholder="비콘 ID (예: A1)" value={formState.beaconId} onChange={e => setFormState(s => ({ ...s, beaconId: e.target.value }))} />
                <button style={{ ...btnStyle(T.accent), marginTop: 8, width: '100%' }} onClick={handleRegister}>비콘 등록</button>
                {!pendingClick && (
                  <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>💡 위 지도를 클릭해 좌표를 먼저 지정하세요.</div>
                )}
              </div>

              <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
                  등록된 비콘 ({beacons.length}개)
                </div>
                {beacons.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: T.sub }}>등록된 비콘이 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {beacons.map(b => (
                      <div key={b._id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 10, background: T.inputBg,
                      }}>
                        <div style={{
                          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                          background: b.visible ? T.accent : '#CBD3E6',
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{b.beaconId}</div>
                          <div style={{ fontSize: 11, color: T.sub }}>
                            x: {b.x?.toFixed?.(2) ?? b.x} · y: {b.y?.toFixed?.(2) ?? b.y} · TX: {b.txPower}dBm
                          </div>
                        </div>
                        <button
                          onClick={() => handleToggleVisible(b)}
                          style={{ ...btnStyle(b.visible ? T.ok : '#CBD3E6', b.visible ? 'white' : T.text), padding: '6px 10px', fontSize: 11.5 }}
                        >
                          {b.visible ? '표시중' : '숨김'}
                        </button>
                        <button
                          onClick={() => handleDelete(b)}
                          style={{ ...btnStyle('transparent', T.danger), padding: '6px 10px', fontSize: 11.5, border: `1px solid ${T.danger}` }}
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16 }}>
                <input style={inputStyle} placeholder="시설 id (예: toilet_1)" value={facilityForm.id} onChange={e => setFacilityForm(s => ({ ...s, id: e.target.value }))} />
                <input style={{ ...inputStyle, marginTop: 8 }} placeholder="시설 이름 (예: 화장실)" value={facilityForm.label} onChange={e => setFacilityForm(s => ({ ...s, label: e.target.value }))} />
                <button style={{ ...btnStyle(T.ok), marginTop: 8, width: '100%' }} onClick={handleRegisterFacility}>시설 등록</button>
                {!pendingClick && (
                  <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>💡 위 지도를 클릭해 좌표를 먼저 지정하세요.</div>
                )}
              </div>

              <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
                  등록된 시설 ({(selectedMap?.facilities || []).length}개)
                </div>
                {(selectedMap?.facilities || []).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: T.sub }}>등록된 시설이 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(selectedMap?.facilities || []).map(f => (
                      <div key={f.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 10, background: T.inputBg,
                      }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                          background: T.ok, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                        }}>🚻</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{f.label}</div>
                          <div style={{ fontSize: 11, color: T.sub }}>
                            id: {f.id} · x: {f.x} · y: {f.y}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteFacility(f.id)}
                          style={{ ...btnStyle('transparent', T.danger), padding: '6px 10px', fontSize: 11.5, border: `1px solid ${T.danger}` }}
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}