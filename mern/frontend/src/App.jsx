import { MapPin, Search, MessageSquare, Mic, TrendingUp, ArrowLeft, ArrowRight, Settings, Navigation, ChevronRight } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import MapSection from './MapSketch';
import AdminBeaconsSection from './AdminBeacons';
import AdminLogin, { getAdminToken } from './AdminLogin';
import { useCongestion, getCongestionLevel, countNearExhibit, NEARBY_RADIUS_M, REFRESH_MS } from './congestion';

// 접속한 주소를 기준으로 자동으로 서버 주소를 잡음
const SERVER_BASE_URL = process.env.NODE_ENV === 'production'
  ? window.location.origin
  : `${window.location.protocol}//${window.location.hostname}:4000`;

const CURRENT_MAP_ID = '6a4e268e4b23f93d45141083';

function getOrCreateWebScannerId() {
  const KEY = 'guidant_scanner_id';
  if (typeof window !== 'undefined') {
    const urlSid = new URLSearchParams(window.location.search).get('sid');
    if (urlSid) {
      localStorage.setItem(KEY, urlSid);
      return urlSid;
    }
  }
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'web_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY, id);
  }
  return id;
}

function isPairedWithScanner(scannerId) {
  return typeof scannerId === 'string' && scannerId.startsWith('android_');
}

function createMessageId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MENU_ITEMS = [
  { id: 'map',       icon: MapPin,        label: '지도 및 경로 안내' },
  { id: 'exhibits',  icon: Search,        label: '주변 전시물' },
  { id: 'chat',      icon: MessageSquare, label: 'AI 도슨트' },
  { id: 'recommend', icon: TrendingUp,    label: '맞춤 추천' },
];

const ADMIN_MENU_ITEM = {
  id: 'admin', icon: Settings, label: '관리자: 비콘 등록',
};

const T = {
  bg: '#F7F8FA', card: '#FFFFFF', navy: '#19334F', text: '#172B40',
  sub: '#687789', border: '#E3E8EF', inputBg: '#F1F4F8', radius: 16,
  shadow: '0 3px 12px rgba(25,51,79,0.04)',
};

/* ── 헤더 ── */
function Header({ activePage, onBack, paired, allMenuItems }) {
  const activeMenu = allMenuItems.find(m => m.id === activePage);
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 20, width: '100%', boxSizing: 'border-box',
      background: 'rgba(247,248,250,0.96)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${T.border}`,
      padding: '15px 20px', minHeight: 70, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {activePage ? (
          <button type="button" aria-label="홈으로 돌아가기" onClick={onBack} style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ArrowLeft size={19} />
          </button>
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 11, background: T.navy, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Navigation size={19} strokeWidth={2} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: activePage ? 16 : 21, fontWeight: 800, color: T.navy, letterSpacing: '-0.6px', lineHeight: 1.2 }}>{activePage ? activeMenu?.label : 'Guidant'}</div>
          {!activePage && <div style={{ marginTop: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#8390A0' }}>YOUR EXHIBITION GUIDE</div>}
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, padding: '7px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        color: paired ? '#287357' : '#8A642D', background: paired ? '#EAF5EF' : '#FFF4E3', border: `1px solid ${paired ? '#D4EADD' : '#F0E1C9'}`,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: paired ? '#38936D' : '#C19244' }} />
        {paired ? '위치 연동됨' : '위치 미연동'}
      </div>
    </header>
  );
}

/* ── 기존 전시물·비콘 매핑 유지 ── */
const EXHIBITS = [
  { beaconId: 'A7', name: 'AI 임베디드 시스템',   author: '온디바이스 AI 체험',   dot: '#6BAED6', topic: 'ai' },
  { beaconId: 'A6', name: '스마트 센서 네트워크', author: 'IoT 데이터 수집·분석', dot: '#74C476', topic: 'hw' },
  { beaconId: 'A5', name: '자율주행 로봇',        author: '센서 기반 자율주행',   dot: '#FDAE6B', topic: 'hw' },
  { beaconId: 'A3', name: 'ICT PBL 프로젝트',     author: '학생 융합 프로젝트',   dot: '#F768A1', topic: 'project' },
  { beaconId: 'A2', name: '실시간 이미지 분류',   author: '딥러닝 이미지 인식',   dot: '#9B8FE8', topic: 'ai' },
  { beaconId: 'A1', name: '스마트 홈 제어판',     author: '음성·앱 기반 제어',    dot: '#F9A8D4', topic: 'hw' },
];

function useExhibitCrowd() {
  const congestion = useCongestion(CURRENT_MAP_ID, SERVER_BASE_URL);
  return EXHIBITS.map(e => ({ ...e, count: countNearExhibit(congestion, e.beaconId) }));
}

/* ── 홈: 지도 → 주변 전시물·AI → 한산한 전시 → 추천 ── */
function HomeMenu({ items, onNavigate, paired }) {
  const crowd = useExhibitCrowd();
  const quiet = crowd.reduce((a, b) => (b.count < a.count ? b : a), crowd[0]);
  const quietLevel = getCongestionLevel(quiet.count);
  const hasAdmin = items.some(item => item.id === 'admin');

  return (
    <div style={{ padding: '26px 20px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <div style={{ marginBottom: 8, color: '#718196', fontSize: 10, fontWeight: 750, letterSpacing: '0.12em' }}>2026 CAPSTONE EXHIBITION</div>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, lineHeight: 1.35, letterSpacing: '-1.1px', color: T.text }}>어디부터 둘러볼까요?</h1>
        <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.65, color: T.sub, letterSpacing: '-0.2px' }}>지도와 AI로 전시를 더 편하게 관람하세요.</p>
      </section>

      <button type="button" onClick={() => onNavigate('map')} style={{
        position: 'relative', width: '100%', boxSizing: 'border-box', overflow: 'hidden', padding: 22,
        border: 'none', borderRadius: 18, background: T.navy, color: '#FFFFFF', cursor: 'pointer', textAlign: 'left',
        boxShadow: '0 8px 20px rgba(25,51,79,0.14)',
      }}>
        <div aria-hidden="true" style={{ position: 'absolute', right: -28, top: -36, width: 150, height: 150, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.09)', pointerEvents: 'none' }} />
        <div aria-hidden="true" style={{ position: 'absolute', right: -5, top: -13, width: 105, height: 105, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.09)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 11, color: '#BDD0E3', fontSize: 11, fontWeight: 650 }}><Navigation size={12} />관람 시작하기</div>
            <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.7px', marginBottom: 7 }}>전시장 지도</div>
            <div style={{ color: '#C3D1DE', fontSize: 13, lineHeight: 1.6 }}>전시물 위치와 관람 동선을<br />한눈에 확인하세요.</div>
          </div>
          <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, background: 'rgba(255,255,255,0.11)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPin size={25} strokeWidth={1.7} />
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 750 }}>지도 보기</span><ArrowRight size={18} />
        </div>
      </button>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <button type="button" onClick={() => onNavigate('exhibits')} style={{ minWidth: 0, padding: '18px 16px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.card, textAlign: 'left', cursor: 'pointer', boxShadow: T.shadow }}>
          <div style={{ width: 40, height: 40, marginBottom: 15, borderRadius: 12, background: '#EAF3EF', color: '#32755E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Search size={21} strokeWidth={1.8} /></div>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: '-0.5px', marginBottom: 6 }}>주변 전시물</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.5, marginBottom: 17 }}>작품과 혼잡도 확인</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#32755E', fontSize: 12, fontWeight: 750 }}>작품 보기<ArrowRight size={15} /></div>
        </button>
        <button type="button" onClick={() => onNavigate('chat')} style={{ minWidth: 0, padding: '18px 16px', borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.card, textAlign: 'left', cursor: 'pointer', boxShadow: T.shadow }}>
          <div style={{ width: 40, height: 40, marginBottom: 15, borderRadius: 12, background: '#EEF0FC', color: '#6361AC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MessageSquare size={21} strokeWidth={1.8} /></div>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: '-0.5px', marginBottom: 6 }}>AI 도슨트</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.5, marginBottom: 17 }}>궁금한 내용을 질문</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#6361AC', fontSize: 12, fontWeight: 750 }}>질문하기<ArrowRight size={15} /></div>
        </button>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: '-0.4px' }}>지금 한산한 전시</h2>
          <span style={{ fontSize: 10, color: T.sub, flexShrink: 0 }}>{REFRESH_MS / 1000}초마다 갱신</span>
        </div>
        <button type="button" onClick={() => onNavigate('exhibits')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '17px 15px', border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.card, cursor: 'pointer', textAlign: 'left', boxShadow: T.shadow }}>
          <div style={{ width: 44, height: 48, flexShrink: 0, borderRadius: 11, background: '#F0F4F8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: T.navy }}>
            <MapPin size={17} /><span style={{ fontSize: 10, fontWeight: 800 }}>{quiet.beaconId}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: T.text, letterSpacing: '-0.3px', lineHeight: 1.4 }}>{quiet.name}</div>
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5, color: T.sub }}>{quiet.author}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '4px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: quietLevel.bg, color: quietLevel.color }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: quietLevel.color }} />주변 {quiet.count}명 · {quietLevel.label}
            </div>
          </div>
          <ChevronRight size={18} color="#8A97A6" style={{ flexShrink: 0 }} />
        </button>
      </section>

      <button type="button" onClick={() => onNavigate('recommend')} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '15px 16px', background: '#EDF1F6', border: '1px solid #E1E7EF', borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: T.navy }}>
        <TrendingUp size={19} strokeWidth={1.8} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 750, marginBottom: 3 }}>나에게 맞는 전시 찾기</div>
          <div style={{ fontSize: 11, color: T.sub }}>관심사와 혼잡도로 추천받으세요.</div>
        </div>
        <ChevronRight size={17} />
      </button>

      <p style={{ margin: 0, textAlign: 'center', color: '#778597', fontSize: 11, lineHeight: 1.65 }}>
        {paired ? '스캐너와 연동되어 지도에서 내 위치를 확인할 수 있어요.' : '스캐너 앱에서 접속하면 내 위치가 지도에 표시돼요.'}
      </p>
      {hasAdmin && (
        <button type="button" onClick={() => onNavigate('admin')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', border: '1px dashed #CCD5DF', borderRadius: 10, background: 'transparent', color: T.sub, fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
          <Settings size={16} /><span style={{ flex: 1 }}>관리자 도구 · 비콘 등록</span><ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

/* ── 주변 전시물 ── */
function ExhibitsSection() {
  const items = useExhibitCrowd();
  return (
    <div style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ marginBottom: 5 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 800, color: T.text, letterSpacing: '-0.7px' }}>전시물을 둘러보세요.</h2>
        <p style={{ margin: 0, fontSize: 12, color: T.sub, lineHeight: 1.7 }}>전시물 반경 {NEARBY_RADIUS_M}m 이내 인원 기준<br />{REFRESH_MS / 1000}초마다 혼잡도가 갱신됩니다.</p>
      </div>
      {items.map(item => {
        const level = getCongestionLevel(item.count);
        return (
          <div key={item.beaconId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '17px 14px', background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
            <div style={{ width: 39, height: 43, flexShrink: 0, borderRadius: 10, background: '#F1F4F8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.dot }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: T.navy }}>{item.beaconId}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 750, color: T.text, lineHeight: 1.4 }}>{item.name}</div>
              <div style={{ fontSize: 11, color: T.sub, marginTop: 5, lineHeight: 1.5 }}>{item.author}</div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 750, color: level.color, background: level.bg, padding: '5px 8px', borderRadius: 7, whiteSpace: 'nowrap' }}>{level.label}</span>
              <span style={{ fontSize: 10, color: T.sub }}>{item.count}명</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── AI 도슨트 ── */
function ChatSection({ scannerId }) {
  const newId = () => globalThis.crypto?.randomUUID?.() || createMessageId('conversation');
  const greeting = () => [{
    id: 'greeting', sender: 'bot',
    text: '안녕하세요! Guidant AI 도슨트입니다. 전시물이나 체험 방법에 대해 궁금한 점을 물어보세요.',
  }];

  const [conversationId, setConversationId] = useState(newId);
  const [messages, setMessages] = useState(greeting);
  const [chatMessage, setChatMessage] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const bottomRef = useRef(null);

  const historyBase = `${SERVER_BASE_URL}/api/chat/conversations/${encodeURIComponent(scannerId)}`;
  const historyUrl = id => `${historyBase}/${encodeURIComponent(id)}`;
  const isLegacy = conversationId === 'legacy';
  const inputDisabled = busy || isLegacy || !scannerId;
  const buttonStyle = {
    padding: '8px 10px', borderRadius: 9, border: `1px solid ${T.border}`,
    background: T.card, color: T.navy, fontSize: 12,
    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.55 : 1,
  };

  async function readJson(res) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
    return data;
  }

  function resetConversation() {
    setConversationId(newId());
    setMessages(greeting());
    setChatMessage('');
    setIsVoiceMode(false);
    setShowHistory(false);
    setNotice('');
  }

  // 화면 진입 시 과거 기록을 불러오지 않고 새로 시작
  useEffect(() => {
    generationRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    resetConversation();
    setConversations([]);

    return () => {
      generationRef.current += 1;
      busyRef.current = false;
    };
  }, [scannerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  // 기존 위치 기반 선제 안내 유지
  useEffect(() => {
    if (!scannerId) return;
    const socket = io(SERVER_BASE_URL, { transports: ['websocket'] });
    const joinMap = () => socket.emit('join_map', { mapId: CURRENT_MAP_ID });
    const handler = payload => {
      if (!payload || payload.scannerId !== scannerId || typeof payload.message !== 'string') return;
      setMessages(prev => [...prev, {
        id: createMessageId('proactive'), sender: 'bot',
        text: payload.message, zone: payload.zone,
      }]);
    };

    socket.on('connect', joinMap);
    socket.on('proactive_message', handler);
    return () => {
      socket.off('connect', joinMap);
      socket.off('proactive_message', handler);
      socket.disconnect();
    };
  }, [scannerId]);

  // 중복 요청 방지 및 화면 종료 후 오래된 응답 무시
  async function runTask(task) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    try {
      await task(isCurrent);
    } catch (err) {
      if (isCurrent()) setNotice(err.message);
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function startNewConversation() {
    if (!busyRef.current) resetConversation();
  }

  function loadConversations() {
    return runTask(async isCurrent => {
      const data = await readJson(await fetch(historyBase));
      if (!isCurrent()) return;
      setConversations(data);
      setShowHistory(true);
    });
  }

  function openConversation(id) {
    return runTask(async isCurrent => {
      const history = await readJson(await fetch(historyUrl(id)));
      if (!isCurrent()) return;
      setConversationId(id);
      setMessages([...greeting(), ...history.map(h => ({
        id: String(h._id), sender: h.role === 'user' ? 'user' : 'bot',
        text: h.message, zone: h.zone,
      }))]);
      setChatMessage('');
      setShowHistory(false);
    });
  }

  function deleteConversation(id) {
    if (busyRef.current) return;
    if (!window.confirm('이 대화 기록을 실제로 삭제할까요?\n삭제한 기록은 복구할 수 없습니다.')) return;


    return runTask(async isCurrent => {
      await readJson(await fetch(historyUrl(id), { method: 'DELETE' }));
      if (!isCurrent()) return;
      setConversations(prev => prev.filter(item => item.conversationId !== id));
      if (id === conversationId) {
        setConversationId(newId());
        setMessages(greeting());
        setChatMessage('');
        setIsVoiceMode(false);
      }
      setNotice('대화 기록을 삭제했습니다.');
    });
  }

  function handleSend(textToSend) {
    const userText = (typeof textToSend === 'string' ? textToSend : chatMessage).trim();
    if (!userText || !scannerId || busyRef.current || isLegacy) return;

    return runTask(async isCurrent => {
      const loadId = createMessageId('loading');
      setMessages(prev => [...prev,
        { id: createMessageId('user'), sender: 'user', text: userText },
        { id: loadId, sender: 'bot', text: 'Guidant가 생각 중입니다...' },
      ]);
      setChatMessage('');

      try {
        const data = await readJson(await fetch(`${SERVER_BASE_URL}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userText, scannerId, conversationId }),
        }));
        if (!isCurrent()) return;
        setMessages(prev => prev.map(msg => msg.id === loadId
          ? { ...msg, text: data.reply || '응답을 받지 못했습니다.', zone: data.zone }
          : msg));
      } catch (err) {
        if (!isCurrent()) return;
        setMessages(prev => prev.map(msg => msg.id === loadId
          ? { ...msg, text: `응답을 받지 못했습니다. ${err.message}` }
          : msg));
      }
    });
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100dvh - 70px)', minHeight: 350, background: T.bg,
    }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px',
        borderBottom: `1px solid ${T.border}`, background: T.card,
      }}>
        <button type="button" disabled={busy} onClick={startNewConversation} style={buttonStyle}>새 대화</button>
        <button type="button" disabled={busy}
          onClick={showHistory ? () => setShowHistory(false) : loadConversations} style={buttonStyle}>
          {showHistory ? '기록 닫기' : '기록 보기'}
        </button>
        <button type="button" disabled={busy} onClick={() => deleteConversation(conversationId)}
          style={{ ...buttonStyle, color: '#B54848' }}>현재 대화 삭제</button>
      </div>

      {notice && <div role="status" style={{
        padding: '10px 16px', fontSize: 12, color: T.sub, background: '#FFF4E3',
      }}>{notice}</div>}

      {showHistory && (
        <div style={{
          flexShrink: 0, maxHeight: '35%', overflowY: 'auto',
          padding: '12px 16px', borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 750, color: T.text }}>보관된 대화</div>
          {conversations.length === 0 && <div style={{ fontSize: 12, color: T.sub }}>보관된 대화가 없습니다.</div>}
          {conversations.map(item => (
            <div key={item.conversationId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button type="button" disabled={busy} onClick={() => openConversation(item.conversationId)}
                style={{ ...buttonStyle, flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.conversationId === 'legacy' ? '이전 기록' : item.title}
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: T.sub }}>
                  {new Date(item.updatedAt).toLocaleString('ko-KR')} · 메시지 {item.messageCount}개
                </div>
              </button>
              <button type="button" disabled={busy} onClick={() => deleteConversation(item.conversationId)}
                style={{ ...buttonStyle, color: '#B54848', flexShrink: 0 }}>삭제</button>
            </div>
          ))}
        </div>
      )}

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {messages.map(msg => {
          const isUser = msg.sender === 'user';
          return (
            <div key={msg.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start',
            }}>
              {!isUser && <div style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
                paddingLeft: 3, color: T.sub, fontSize: 10, fontWeight: 700,
              }}><MessageSquare size={11} />Guidant</div>}
              <div style={{
                maxWidth: '84%', boxSizing: 'border-box', padding: '13px 15px',
                borderRadius: 16, fontSize: 13, lineHeight: 1.75,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                ...(isUser
                  ? { background: T.navy, color: '#FFFFFF', borderTopRightRadius: 5 }
                  : { background: T.card, color: T.text, borderTopLeftRadius: 5,
                      border: `1px solid ${T.border}`, boxShadow: T.shadow }),
              }}>{msg.text}</div>
              {msg.id === 'greeting' && !isVoiceMode && !isLegacy && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                  {['이 전시물은 뭔가요?', '체험 방법 알려줘'].map(chip => (
                    <button type="button" key={chip} disabled={inputDisabled}
                      onClick={() => handleSend(chip)} style={buttonStyle}>{chip}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{
        flexShrink: 0, background: T.card, borderTop: `1px solid ${T.border}`,
        padding: '14px 16px max(18px, env(safe-area-inset-bottom))',
      }}>
        {isLegacy && <div style={{ marginBottom: 10, fontSize: 11, color: T.sub, lineHeight: 1.6 }}>
          이전 기록은 조회·삭제만 가능합니다. 질문하려면 '새 대화'를 눌러주세요.
        </div>}
        {isVoiceMode && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12,
            padding: '11px 12px', background: T.inputBg, borderRadius: 10, color: T.sub, fontSize: 11,
          }}>
            <span>음성 입력 기능은 준비 중입니다.</span>
            <button type="button" onClick={() => setIsVoiceMode(false)}
              style={{ border: 'none', background: 'transparent', color: T.navy, cursor: 'pointer' }}>닫기</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, minWidth: 0, background: T.inputBg, borderRadius: 12,
            padding: '12px 13px', border: `1px solid ${T.border}`,
          }}>
            <input type="text" aria-label="AI 도슨트에게 메시지 입력" value={chatMessage}
              disabled={inputDisabled} maxLength={4000}
              placeholder={isLegacy ? '새 대화를 시작해 주세요' : busy ? '처리 중입니다...' : '궁금한 내용을 입력하세요'}
              onChange={e => setChatMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              style={{
                width: '100%', minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', fontSize: 13, color: T.text, padding: 0, fontFamily: 'inherit',
              }}
            />
          </div>
          <button type="button" aria-label="메시지 보내기" disabled={inputDisabled}
            onClick={() => handleSend()} style={{
              width: 42, height: 42, borderRadius: 12, background: T.navy, color: '#FFFFFF',
              border: 'none', cursor: inputDisabled ? 'not-allowed' : 'pointer',
              opacity: inputDisabled ? 0.5 : 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
            }}><ArrowRight size={20} /></button>
          <button type="button" aria-label="음성 입력 안내" onClick={() => setIsVoiceMode(prev => !prev)}
            style={{
              width: 38, height: 42, borderRadius: 12, background: T.inputBg,
              border: `1px solid ${T.border}`, cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}><Mic size={17} color={T.sub} /></button>
        </div>
      </div>
    </div>
  );
}

/* ── 맞춤 추천 ── */
function RecommendSection() {
  const crowd = useExhibitCrowd();
  const quiet = [...crowd].sort((a, b) => a.count - b.count).slice(0, 2);
  const busy = crowd.filter(e => getCongestionLevel(e.count).key === 'high');
  const line = e => `${e.name} (${e.beaconId}) — ${e.author} · 주변 ${e.count}명`;
  const names = topic => crowd.filter(e => e.topic === topic).map(e => `${e.name} (${e.beaconId})`).join(' · ');
  const groups = [
    { icon: MapPin, title: '지금 한산한 전시물', bg: '#EAF3EF', accent: '#32755E', items: quiet.map(line) },
    { icon: TrendingUp, title: '지금 붐비는 전시물', bg: '#FFF3E4', accent: '#A47030', items: busy.length ? busy.map(line) : ['지금은 붐비는 전시물이 없어요.'] },
    { icon: Search, title: '관심사 기반 추천', bg: '#EEF0FC', accent: '#6361AC', items: [
      `하드웨어·IoT에 관심 있다면 → ${names('hw')}`,
      `AI·소프트웨어라면 → ${names('ai')}`,
      `융합 프로젝트가 궁금하다면 → ${names('project')}`,
    ] },
  ];

  return (
    <div style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ marginBottom: 3 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 800, color: T.text, letterSpacing: '-0.7px' }}>나에게 맞는 전시를 찾아요.</h2>
        <p style={{ margin: 0, color: T.sub, fontSize: 12, lineHeight: 1.7 }}>실시간 혼잡도와 관심 분야를 기준으로 안내합니다.</p>
      </div>
      {groups.map(g => {
        const Icon = g.icon;
        return (
          <section key={g.title} style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: 'hidden' }}>
            <div style={{ background: g.bg, padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 8, color: g.accent }}>
              <Icon size={18} strokeWidth={1.8} /><span style={{ fontSize: 14, fontWeight: 800 }}>{g.title}</span>
            </div>
            <div style={{ padding: '12px 16px 16px' }}>
              {g.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 0' }}>
                  <span style={{ width: 5, height: 5, marginTop: 8, borderRadius: '50%', background: g.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: T.text, lineHeight: 1.8, overflowWrap: 'anywhere' }}>{item}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── 관리자 접근 게이트 ── */
function AdminGate(props) {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
  return <AdminBeaconsSection {...props} />;
}

const SECTION_MAP = { map: MapSection, exhibits: ExhibitsSection, chat: ChatSection, recommend: RecommendSection, admin: AdminGate };

export default function App() {
  const [activePage, setActivePage] = useState(null);
  const [scannerId, setScannerId] = useState(() => getOrCreateWebScannerId());

  // 안드로이드 앱에서 전달한 sid 동기화
  useEffect(() => {
    const urlSid = new URLSearchParams(window.location.search).get('sid');
    if (urlSid && urlSid !== scannerId) {
      localStorage.setItem('guidant_scanner_id', urlSid);
      setScannerId(urlSid);
    }
  }, [activePage, scannerId]);

  const paired = isPairedWithScanner(scannerId);
  const ActiveSection = activePage ? SECTION_MAP[activePage] : null;
  const isAdmin = new URLSearchParams(window.location.search).get('admin') === '1';
  const menuItems = isAdmin ? [...MENU_ITEMS, ADMIN_MENU_ITEM] : MENU_ITEMS;

  return (
    <div style={{
      width: '100%', minHeight: '100vh', background: T.bg, display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: activePage === 'map' ? 'hidden' : 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: activePage === 'map' ? 'none' : 480, display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <Header activePage={activePage} onBack={() => setActivePage(null)} paired={paired} allMenuItems={menuItems} />
        <main style={{ width: '100%', margin: '0 auto', flex: 1, minWidth: 0, overflowY: activePage === 'map' ? 'auto' : 'visible' }}>
          {activePage === null
            ? <HomeMenu items={menuItems} onNavigate={setActivePage} paired={paired} />
            : ActiveSection ? <ActiveSection scannerId={scannerId} mapId={CURRENT_MAP_ID} /> : null}
        </main>
      </div>
    </div>
  );
}
