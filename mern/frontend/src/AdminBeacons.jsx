/**
 * AdminBeacons.jsx
 * 관리자용 비콘 좌표 등록 화면
 *
 * - 지도 이미지를 클릭하면 그 지점의 실제 미터 좌표(x, y)를 자동 계산해 등록 폼에 채웁니다.
 * (MapSketch.jsx처럼 고정 PIXEL_SCALE을 가정하지 않고, 선택된 Map 문서의 widthM/heightM과
 * 화면에 렌더링된 이미지 크기의 비율로 매번 계산합니다 → 지도가 바뀌어도 항상 정확함)
 * - 백엔드는 이미 완성된 routes/beacons.js(CRUD) + routes/maps.js(맵 업로드)를 그대로 사용합니다.
 * 이 파일은 새 API를 만들지 않고 기존 API를 위한 화면만 붙입니다.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// 📍 [개선] 하드코딩된 IP를 유연하게 처리: 현재 접속한 도메인 기준 또는 개발용 폴백
const YOUR_COMPUTER_IP = process.env.NODE_ENV === 'production' 
  ? window.location.origin 
  : (window.location.port === '5173' || window.location.port === '3000'
      ? `${window.location.protocol}//${window.location.hostname}:4000` // 백엔드 포트 자동 매핑
      : 'http://192.168.219.104:4000'); // 기존 명시값 폴백

const T = {
  bg: '#FAFBFF', card: '#FFFFFF', border: '#EEF0F6', radius: '14px',
  shadow: '0 2px 12px rgba(100,120,180,0.08)',
  text: '#2D3250', sub: '#8A90A8', inputBg: '#F2F4FA', accent: '#6BAED6',
  danger: '#F768A1', ok: '#74C476',
};

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: `1px solid ${T.border}`, background: T.inputBg,
  fontSize: 13, color: T.text, boxSizing: 'border-box',
};

const btnStyle = (bg, color = 'white') => ({
  padding: '9px 14px', borderRadius: 10, border: 'none',
  background: bg, color, fontSize: 13, fontWeight: 600, cursor: 'pointer',
});

/* ── 새 지도 업로드 (맵이 하나도 없을 때만 노출) ── */
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
      const res = await fetch(`${YOUR_COMPUTER_IP}/api/maps`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('업로드 실패');
      const doc = await res.json();
      onUploaded(doc);
    } catch (err) {
      setError('업로드 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}>🗺️ 새 지도 업로드</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input style={inputStyle} placeholder="지도 이름 (예: 1층 전시장)" value={name} onChange={e => setName(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={inputStyle} type="number" placeholder="가로 길이(m)" value={widthM} onChange={e => setWidthM(e.target.value)} />
          <input style={inputStyle} type="number" placeholder="세로 길이(m)" value={heightM} onChange={e => setHeightM(e.target.value)} />
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
        {error && <div style={{ color: T.danger, fontSize: 12 }}>{error}</div>}
        <button style={btnStyle(T.accent)} onClick={handleSubmit} disabled={busy}>
          {busy ? '업로드 중...' : '업로드'}
        </button>
      </div>
    </div>
  );
}

/* ── 메인: 비콘 좌표 등록 화면 (+ 시설 등록 탭) ── */
export default function AdminBeaconsSection() {
  const [tab, setTab] = useState('beacon'); // 'beacon' | 'facility'
  const [maps, setMaps] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [selectedMap, setSelectedMap] = useState(null);
  const [beacons, setBeacons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingClick, setPendingClick] = useState(null); // {xM, yM, pxX, pxY}
  const [formState, setFormState] = useState({ beaconId: '', major: '', minor: '', txPower: -59, label: '' });
  const [facilityForm, setFacilityForm] = useState({ id: '', label: '', icon: 'toilet' });
  const [error, setError] = useState('');
  const imgRef = useRef(null);

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

  useEffect(() => { loadMaps(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadBeacons(selectedMapId);
    loadSelectedMapDetail(selectedMapId);
    setPendingClick(null);
  }, [selectedMapId, loadBeacons, loadSelectedMapDetail]);

  // 지도 이미지를 클릭한 지점 → 실제 미터 좌표로 변환
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
    if (!formState.beaconId) { setError('beaconId를 입력하세요. (예: A1)'); return; }

    try {
      const res = await fetch(`${YOUR_COMPUTER_IP}/api/beacons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beaconId: formState.beaconId.trim(), // 공백 제거
          x: Number(pendingClick.xM.toFixed(2)),
          y: Number(pendingClick.yM.toFixed(2)),
          txPower: Number(formState.txPower) || -59,
          mapId: selectedMapId,
          label: formState.label,
        }),
      });
      if (!res.ok) throw new Error('등록 실패 (beaconId 중복일 수 있음)');
      setFormState({ beaconId: '', major: '', minor: '', txPower: -59, label: '' });
      setPendingClick(null);
      await loadBeacons(selectedMapId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleVisible = async (beacon) => {
    await fetch(`${YOUR_COMPUTER_IP}/api/beacons/${beacon._id}/visible`, { method: 'PATCH' });
    loadBeacons(selectedMapId);
  };

  const handleDelete = async (beacon) => {
    if (!window.confirm(`비콘 "${beacon.beaconId}"을(를) 삭제할까요?`)) return;
    await fetch(`${YOUR_COMPUTER_IP}/api/beacons/${beacon._id}`, { method: 'DELETE' });
    loadBeacons(selectedMapId);
  };

  const handleRegisterFacility = async () => {
    if (!pendingClick) { setError('먼저 지도를 클릭해 위치를 지정하세요.'); return; }
    if (!facilityForm.id || !facilityForm.label) { setError('시설 id와 이름을 입력하세요.'); return; }

    const newFacility = {
      id: facilityForm.id,
      label: facilityForm.label,
      icon: facilityForm.icon,
      x: Number(pendingClick.xM.toFixed(2)),
      y: Number(pendingClick.yM.toFixed(2)),
    };
    const nextFacilities = [...(selectedMap.facilities || []), newFacility];

    try {
      const res = await fetch(`${YOUR_COMPUTER_IP}/api/maps/${selectedMapId}/facilities`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beaconId: formState.beaconId.trim().toUpperCase() }),
      });
      if (!res.ok) throw new Error('시설 등록 실패');
      setFacilityForm({ id: '', label: '', icon: 'toilet' });
      setPendingClick(null);
      await loadSelectedMapDetail(selectedMapId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteFacility = async (facilityId) => {
    if (!window.confirm(`시설 "${facilityId}"을(를) 삭제할까요?`)) return;
    const nextFacilities = (selectedMap.facilities || []).filter(f => f.id !== facilityId);
    await fetch(`${YOUR_COMPUTER_IP}/api/maps/${selectedMapId}/facilities`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilities: nextFacilities }),
    });
    loadSelectedMapDetail(selectedMapId);
  };

  const meterToDisplayPx = (xM, yM) => {
    if (!selectedMap || !imgRef.current) return { left: 0, top: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      left: (xM / selectedMap.widthM) * rect.width,
      top: (yM / selectedMap.heightM) * rect.height,
    };
  };

  if (loading) {
    return <div style={{ padding: 20, color: T.sub, fontSize: 13 }}>불러오는 중...</div>;
  }

  return (
    <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 6, background: T.inputBg, padding: 4, borderRadius: 12 }}>
        <button
          onClick={() => { setTab('beacon'); setPendingClick(null); setError(''); }}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: tab === 'beacon' ? T.card : 'transparent', color: tab === 'beacon' ? T.text : T.sub,
            boxShadow: tab === 'beacon' ? T.shadow : 'none',
          }}
        >📡 비콘 좌표 등록</button>
        <button
          onClick={() => { setTab('facility'); setPendingClick(null); setError(''); }}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: tab === 'facility' ? T.card : 'transparent', color: tab === 'facility' ? T.text : T.sub,
            boxShadow: tab === 'facility' ? T.shadow : 'none',
          }}
        >🚻 시설(화장실·출구) 등록</button>
      </div>

      <p style={{ fontSize: 13, color: T.sub, margin: 0 }}>
        {tab === 'beacon'
          ? '지도를 클릭해서 비콘을 설치한 실제 위치를 찍고, 안드로이드 앱과 일치하는 ID(예: A1)를 입력해 등록하세요.'
          : '지도를 클릭해서 화장실·출구 등 안내가 필요한 시설 위치를 등록하세요. 여기서 등록해야 방문객 화면에서 "길안내"가 가능합니다.'}
      </p>

      {maps.length === 0 ? (
        <MapUploadForm onUploaded={(doc) => { setMaps([doc]); setSelectedMapId(doc._id); }} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: T.sub, flexShrink: 0 }}>지도</label>
            <select
              style={{ ...inputStyle, width: 'auto', flex: 1 }}
              value={selectedMapId}
              onChange={e => setSelectedMapId(e.target.value)}
            >
              {maps.map(m => (
                <option key={m._id} value={m._id}>
                  {m.name} ({m.widthM}m × {m.heightM}m)
                </option>
              ))}
            </select>
          </div>

          {selectedMap && (
            <div
              onClick={handleMapClick}
              style={{
                position: 'relative', width: '100%', borderRadius: T.radius, overflow: 'hidden',
                border: `1.5px solid ${T.border}`, cursor: 'crosshair', lineHeight: 0,
              }}
            >
              <img
                ref={imgRef}
                src={`${YOUR_COMPUTER_IP}${selectedMap.imageUrl}`}
                alt={selectedMap.name}
                style={{ width: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' }}
                draggable={false}
              />

              {tab === 'beacon' && beacons.map(b => {
                const { left, top } = meterToDisplayPx(b.x, b.y);
                return (
                  <div key={b._id} title={`${b.beaconId} (${b.x}m, ${b.y}m)`} style={{
                    position: 'absolute', left, top, transform: 'translate(-50%, -50%)',
                    width: 14, height: 14, borderRadius: '50%',
                    background: b.visible ? T.accent : '#CBD3E6',
                    border: '2px solid white', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }} />
                );
              })}

              {tab === 'facility' && (selectedMap.facilities || []).map(f => {
                const { left, top } = meterToDisplayPx(f.x, f.y);
                return (
                  <div key={f.id} title={`${f.label} (${f.x}m, ${f.y}m)`} style={{
                    position: 'absolute', left, top, transform: 'translate(-50%, -50%)',
                    width: 22, height: 22, borderRadius: '50%',
                    background: T.ok, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, border: '2px solid white', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }}>🚻</div>
                );
              })}

              {pendingClick && (
                <div style={{
                  position: 'absolute', left: pendingClick.pxX, top: pendingClick.pxY,
                  transform: 'translate(-50%, -50%)', width: 16, height: 16, borderRadius: '50%',
                  background: T.danger, border: '2px solid white',
                  boxShadow: '0 0 0 4px rgba(247,104,161,0.25)',
                }} />
              )}
            </div>
          )}

          {tab === 'beacon' && (
          <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
              📍 새 비콘 등록
              {pendingClick
                ? <span style={{ fontWeight: 400, color: T.sub }}> — 지정된 좌표: {pendingClick.xM.toFixed(2)}m, {pendingClick.yM.toFixed(2)}m</span>
                : <span style={{ fontWeight: 400, color: T.sub }}> — 위 지도를 먼저 클릭하세요</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* ⚠️ [원인 B 근본 수정] 안드로이드 기기 하드코딩 식별자와 수동 입력 텍스트 결합 오류 원천 차단 */}
              <input
                style={inputStyle}
                placeholder="비콘 ID 입력 (안드로이드 전송 ID와 동일하게 입력: 예: A1, A2)"
                value={formState.beaconId}
                onChange={e => setFormState(s => ({ ...s, beaconId: e.target.value }))}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={inputStyle} type="number" placeholder="txPower (기본 -59)"
                  value={formState.txPower}
                  onChange={e => setFormState(s => ({ ...s, txPower: e.target.value }))}
                />
                <input
                  style={inputStyle} placeholder="표시 이름 (예: 중앙 로비 비콘)"
                  value={formState.label}
                  onChange={e => setFormState(s => ({ ...s, label: e.target.value }))}
                />
              </div>
              {error && <div style={{ color: T.danger, fontSize: 12 }}>{error}</div>}
              <button style={btnStyle(T.accent)} onClick={handleRegister}>비콘 등록</button>
            </div>
          </div>
          )}

          {tab === 'beacon' && (
          <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
              등록된 비콘 ({beacons.length}개)
            </div>
            {beacons.length === 0 && (
              <div style={{ fontSize: 12, color: T.sub }}>아직 등록된 비콘이 없습니다.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {beacons.map(b => (
                <div key={b._id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  background: T.inputBg, borderRadius: 10, fontSize: 12,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: b.visible ? T.ok : '#CBD3E6',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.label || b.beaconId}
                    </div>
                    <div style={{ color: T.sub, fontSize: 11 }}>
                      {b.beaconId} · ({b.x}m, {b.y}m) · txPower {b.txPower}
                    </div>
                  </div>
                  <button onClick={() => handleToggleVisible(b)} style={btnStyle(b.visible ? '#CBD3E6' : T.ok, b.visible ? T.text : 'white')}>
                    {b.visible ? '숨기기' : '표시'}
                  </button>
                  <button onClick={() => handleDelete(b)} style={btnStyle(T.danger)}>삭제</button>
                </div>
              ))}
            </div>
          </div>
          )}

          {tab === 'facility' && (
          <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
              🚻 새 시설 등록
              {pendingClick
                ? <span style={{ fontWeight: 400, color: T.sub }}> — 지정된 좌표: {pendingClick.xM.toFixed(2)}m, {pendingClick.yM.toFixed(2)}m</span>
                : <span style={{ fontWeight: 400, color: T.sub }}> — 위 지도를 먼저 클릭하세요</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={inputStyle} placeholder="시설 id (예: toilet_1)"
                  value={facilityForm.id}
                  onChange={e => setFacilityForm(s => ({ ...s, id: e.target.value }))}
                />
                <input
                  style={inputStyle} placeholder="표시 이름 (예: 화장실)"
                  value={facilityForm.label}
                  onChange={e => setFacilityForm(s => ({ ...s, label: e.target.value }))}
                />
              </div>
              <select
                style={inputStyle}
                value={facilityForm.icon}
                onChange={e => setFacilityForm(s => ({ ...s, icon: e.target.value }))}
              >
                <option value="toilet">🚻 화장실</option>
                <option value="exit">🚪 출구</option>
                <option value="cafe">☕ 카페/음식점</option>
                <option value="info">ℹ️ 안내데스크</option>
              </select>
              {error && <div style={{ color: T.danger, fontSize: 12 }}>{error}</div>}
              <button style={btnStyle(T.ok)} onClick={handleRegisterFacility}>시설 등록</button>
            </div>
          </div>
          )}

          {tab === 'facility' && (
          <div style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
              등록된 시설 ({(selectedMap.facilities || []).length}개)
            </div>
            {(selectedMap.facilities || []).length === 0 && (
              <div style={{ fontSize: 12, color: T.sub }}>아직 등록된 시설이 없습니다. 등록해야 방문객 화면에서 길안내가 가능합니다.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(selectedMap.facilities || []).map(f => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  background: T.inputBg, borderRadius: 10, fontSize: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: T.text }}>{f.label}</div>
                    <div style={{ color: T.sub, fontSize: 11 }}>id: {f.id} · ({f.x}m, {f.y}m)</div>
                  </div>
                  <button onClick={() => handleDeleteFacility(f.id)} style={btnStyle(T.danger)}>삭제</button>
                </div>
              ))}
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}