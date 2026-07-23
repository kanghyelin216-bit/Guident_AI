import React, { useState, useEffect, useRef, useCallback } from "react";
import p5 from "p5";
import { io } from "socket.io-client"; 

// p5.js Friendly Errors 무력화 (성능 최적화)
if (typeof window !== 'undefined') {
  window.p5 = p5; 
  p5.disableFriendlyErrors = true;
}

/* ==========================================================================
   📐 캔버스 및 레이아웃 설정 (1미터 = 45픽셀 규격 일치)
   ========================================================================== */
const showGrid = false;
const CANVAS_WIDTH = 602;
const CANVAS_HEIGHT = 767;
const PIXEL_SCALE = 45;

// 백엔드 Express 서버 주소
const SERVER_BASE_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:4000`
  : 'http://localhost:4000';

// 미터 -> 픽셀 변환 연산 (화면 이탈 방지 클램핑 포함)
function metersToPixels(xM, yM) {
  const px = xM * PIXEL_SCALE;
  const py = yM * PIXEL_SCALE;
  return {
    x: Math.max(12, Math.min(px, CANVAS_WIDTH - 12)),
    y: Math.max(12, Math.min(py, CANVAS_HEIGHT - 12)),
  };
}

function metersToPixelsRaw(xM, yM) {
  return { x: xM * PIXEL_SCALE, y: yM * PIXEL_SCALE };
}

/* ==========================================================================
   🎨 고정 맵 오브젝트 레이아웃
   ========================================================================== */
const mapObjects = [
  { x: 56,  y: 0,   w: 250, h: 40,  name: '칠판', type: 'etc', desc: '강의 및 발표용 대형 칠판입니다.' },
  { x: 332, y: 84,  w: 30,  h: 111, name: '작품1', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 332, y: 328, w: 30,  h: 111, name: '작품2', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 332, y: 572, w: 30,  h: 111, name: '작품3', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 0,   y: 572, w: 30,  h: 111, name: '작품4', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 0,   y: 328, w: 30,  h: 111, name: '작품5', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 0,   y: 84,  w: 30,  h: 111, name: '작품6', type: 'booth', author: '작가명', desc: '작품 설명' },
  { x: 337, y: 0,   w: 25,  h: 50,  name: '출입문', type: 'door', desc: '전시장 전면 출입구입니다. 통행에 유의해 주세요.' },
  { x: 337, y: 717, w: 25,  h: 50,  name: '출입문', type: 'door', desc: '전시장 후면 출입구 및 비상구입니다.' }
];

const MapSketch = ({ scannerId = null, mapId = '6a4e268e4b23f93d45141083' }) => {
  const canvasRef = useRef(null);
  
  // 📡 상태 관리 정의
  const [userPos, setUserPos] = useState({ x: 181, y: 383 }); 
  const [currentZone, setCurrentZone] = useState(null); 
  const [selectedArtwork, setSelectedArtwork] = useState(null); 
  const [facilities, setFacilities] = useState([]); 
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [avoidCongestion, setAvoidCongestion] = useState(false);
  const [navPath, setNavPath] = useState(null); 
  const [navMessage, setNavMessage] = useState('');
  
  const p5Instance = useRef(null);
  const socketRef = useRef(null);

  /* ==========================================================================
     📡 [소켓 엔지니어링] 실시간 RAW RSSI 기반 추정 위치 수신 루프
     ========================================================================== */
  useEffect(() => {
    if (socketRef.current) return;

    socketRef.current = io(SERVER_BASE_URL, {
      transports: ['websocket'],
      upgrade: false,
      forceNew: true,
      reconnectionAttempts: 5,
    });

    socketRef.current.on('connect', () => {
      console.log("🌐 [리액트] 웹소켓 연결 성공! Socket ID:", socketRef.current.id);
      socketRef.current.emit("join_map", { mapId });
    });

    // 🟢 위치 수신 및 즉시 p5.js 캔버스 변수 연동
    socketRef.current.on('location_update', (data) => {
      if (!data) return;

      const rawX = typeof data.x === 'number' ? data.x : (typeof data.X === 'number' ? data.X : null);
      const rawY = typeof data.y === 'number' ? data.y : (typeof data.Y === 'number' ? data.Y : null);

      if (rawX === null || rawY === null) return;

      const { x: clampedX, y: clampedY } = metersToPixels(rawX, rawY);
      
      setUserPos({ x: clampedX, y: clampedY });
      if (data.zone) setCurrentZone(data.zone);

      // p5.js 인스턴스 변수에 직접 주입하여 프레임 드랍 없는 스무스 이동 구현
      if (p5Instance.current) {
        p5Instance.current.userX = clampedX;
        p5Instance.current.userY = clampedY;
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect(); 
        socketRef.current = null;
      }
    };
  }, [mapId]);

  /* ==========================================================================
     🚻 [REST API] 초기 시설 정보 로드
     ========================================================================== */
  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_BASE_URL}/api/maps/${mapId}`)
      .then(res => res.json())
      .then(doc => { 
        if (!cancelled) setFacilities(doc?.facilities || []); 
      })
      .catch(() => { 
        if (!cancelled) setFacilities([]); 
      });
    return () => { cancelled = true; };
  }, [mapId]);

  /* ==========================================================================
     🧭 [A* 알고리즘] 최단 거리 / 혼잡 회피 경로 탐색
     ========================================================================== */
  const startNavigation = useCallback(async (facility) => {
    if (!currentZone || !facility) return;
    
    setNavMessage('경로를 계산하는 중...');
    const targetFacilityId = facility._id || facility.id;

    try {
      const res = await fetch(`${SERVER_BASE_URL}/api/navigation/path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId,
          fromZone: currentZone,
          toFacilityId: targetFacilityId,
          avoidCongestion,
        }),
      });
      const data = await res.json();
      if (!data.found) {
        setNavPath(null);
        setNavMessage(data.message || '경로를 찾을 수 없습니다.');
        return;
      }
      setNavPath(data.path); 
      setNavMessage(`${facility.label || '목적지'}까지 경로 안내 중${avoidCongestion ? ' (혼잡 회피)' : ''}`);
      setSelectedArtwork(null);
    } catch (err) {
      setNavPath(null);
      setNavMessage('경로 탐색 서버 요청에 실패했습니다.');
    }
  }, [currentZone, mapId, avoidCongestion]);

  useEffect(() => {
    if (selectedFacility && currentZone) {
      startNavigation(selectedFacility);
    }
  }, [avoidCongestion, selectedFacility, startNavigation, currentZone]);

  const clearNavigation = () => {
    setNavPath(null);
    setNavMessage('');
    setSelectedFacility(null);
  };

  /* ==========================================================================
     🔄 p5.js 데이터 레벨 변수 동기화
     ========================================================================== */
  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.userX = userPos.x;
      p5Instance.current.userY = userPos.y;
    }
  }, [userPos]);

  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.facilitiesPx = facilities.map(f => ({ ...f, ...metersToPixelsRaw(f.x, f.y) }));
    }
  }, [facilities]);

  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.navPathPx = navPath
        ? navPath.map(pt => (Array.isArray(pt) ? metersToPixelsRaw(pt[1], pt[0]) : metersToPixelsRaw(pt.x, pt.y)))
        : null;
    }
  }, [navPath]);

  /* ==========================================================================
     🎨 [p5.js Core Canvas Engine]
     ========================================================================== */
  useEffect(() => {
    let myP5;
    if (canvasRef.current) canvasRef.current.innerHTML = ""; 

    const sketch = (p) => {
      p.userX = userPos.x;
      p.userY = userPos.y;
      p.facilitiesPx = [];
      p.navPathPx = null;

      p.setup = () => {
        p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("Inter, system-ui, -apple-system, sans-serif");
      };

      p.draw = () => {
        p.background(248, 249, 250); 

        if (showGrid) {
          p.stroke(230); p.strokeWeight(1);
          for (let x = 0; x < p.width; x += 40) p.line(x, 0, x, p.height);
          for (let y = 0; y < p.height; y += 40) p.line(0, y, p.width, y);
        }

        // 맵 구조물 렌더링
        for (let obj of mapObjects) {
          p.push();
          if (obj.type === 'booth') {
            p.fill(255); p.stroke(218, 222, 229); p.strokeWeight(1.5);
          } else if (obj.type === 'door') {
            p.fill(241, 243, 245); p.stroke(173, 181, 189); p.strokeWeight(1);
          } else {
            p.fill(233, 236, 239); p.stroke(206, 212, 218); p.strokeWeight(1);
          }
          p.rect(obj.x, obj.y, obj.w, obj.h, 8); 

          p.noStroke();
          if (obj.w < 50) {
            p.fill(73, 80, 87); p.textSize(10.5); p.textStyle(p.BOLD);
            let padding = 4;
            p.text(obj.name, obj.x + padding, obj.y + padding, obj.w - padding * 2, obj.h - padding * 2);
          } else {
            p.fill(33, 37, 41); p.textSize(12); p.textStyle(p.BOLD);
            p.text(obj.name, obj.x + obj.w / 2, obj.y + obj.h / 2);
          }
          p.pop(); 
        }

        // A* 경로 시각화
        if (p.navPathPx && p.navPathPx.length > 1) {
          p.push();
          p.stroke(0, 122, 255);
          p.strokeWeight(4);
          p.noFill();
          p.beginShape();
          for (const pt of p.navPathPx) p.vertex(pt.x, pt.y);
          p.endShape();
          p.pop();
        }

        // 편의시설 마커 시각화
        for (const f of p.facilitiesPx) {
          p.push();
          p.fill(40, 167, 69);
          p.stroke(255);
          p.strokeWeight(2.5);
          p.circle(f.x, f.y, 24);
          
          p.fill(255);
          p.textSize(10);
          p.textStyle(p.BOLD);
          p.text(f.label ? f.label.substring(0, 2) : "시설", f.x, f.y);
          p.pop();
        }

        // 실시간 사용자 위치 마커 (파란 펄스 점)
        drawUserMarker(p, p.userX, p.userY); 
      };

      const drawUserMarker = (p, x, y) => {
        p.push();
        let pulse = p.sin(p.frameCount * 0.08) * 8;
        
        p.fill(0, 122, 255, 40);
        p.noStroke();
        p.circle(x, y, 26 + pulse); 

        p.fill(0, 122, 255);
        p.stroke(255);
        p.strokeWeight(3);
        p.circle(x, y, 14); 
        p.pop();
      };

      p.mousePressed = () => {
        for (const f of p.facilitiesPx) {
          const d = p.dist(p.mouseX, p.mouseY, f.x, f.y);
          if (d <= 18) {
            setSelectedFacility(f);
            setSelectedArtwork(null);
            return;
          }
        }
        for (let obj of mapObjects) {
          if (p.mouseX >= obj.x && p.mouseX <= obj.x + obj.w && p.mouseY >= obj.y && p.mouseY <= obj.y + obj.h) {
            if (obj.type === 'door') return; 
            setSelectedArtwork(obj); 
            setSelectedFacility(null);
            return; 
          }
        }
      };
    };

    myP5 = new p5(sketch, canvasRef.current);
    p5Instance.current = myP5;

    return () => {
      if (myP5) myP5.remove();
    };
  }, []);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px", position: "relative" }}>
      <div ref={canvasRef} style={styles.canvasContainer}></div>

      {(navMessage || navPath) && (
        <div style={styles.navBanner}>
          <span style={{fontWeight: "500"}}>{navMessage}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', margin: "0 8px" }}>
            <input
              type="checkbox"
              checked={avoidCongestion}
              onChange={e => setAvoidCongestion(e.target.checked)}
              style={{cursor: 'pointer'}}
            />
            혼잡구간 회피
          </label>
          <button style={styles.navCloseBtn} onClick={clearNavigation}>경로 닫기</button>
        </div>
      )}

      {selectedArtwork && (
        <div style={styles.popupCard}>
          <button style={styles.closeBtn} onClick={() => setSelectedArtwork(null)}>✕</button>
          <div style={styles.contentContainer}>
            <div style={styles.imgPlaceholder}>🎨</div>
            <div style={styles.textGroup}>
              <h3 style={styles.title}>
                {selectedArtwork.name}
                {selectedArtwork.author && <span style={styles.author}>{selectedArtwork.author}</span>}
              </h3>
              <p style={styles.desc}>{selectedArtwork.desc}</p>
            </div>
          </div>
        </div>
      )}

      {selectedFacility && (
        <div style={styles.popupCard}>
          <button style={styles.closeBtn} onClick={() => setSelectedFacility(null)}>✕</button>
          <div style={styles.contentContainer}>
            <div style={{...styles.imgPlaceholder, backgroundColor: "#E6F4EA", color: "#137333", fontSize: "20px"}}>🚻</div>
            <div style={styles.textGroup}>
              <h3 style={styles.title}>{selectedFacility.label}</h3>
              <p style={styles.desc}>
                {currentZone ? `현재 위치(${currentZone})에서 경로를 안내합니다.` : '위치 인프라 신호를 탐색 중입니다.'}
              </p>
            </div>
          </div>
          <button
            style={{
              ...styles.guideBtn,
              backgroundColor: currentZone ? "#007AFF" : "#6B7280",
              cursor: currentZone ? "pointer" : "not-allowed"
            }}
            disabled={!currentZone}
            onClick={() => startNavigation(selectedFacility)}
          >
            {currentZone ? '실시간 길안내 시작' : '위치 스캐닝 중...'}
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  canvasContainer: { borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 24px rgba(0, 0, 0, 0.06)", border: "1px solid #e9ecef" },
  popupCard: { position: "absolute", left: "50%", bottom: "40px", transform: "translateX(-50%)", width: "320px", backgroundColor: "white", padding: "16px", borderRadius: "16px", boxShadow: "0 12px 32px rgba(0,0,0,0.15)", border: "1px solid #f1f3f5", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px", zIndex: 999 },
  navBanner: { position: "absolute", top: "30px", left: "50%", transform: "translateX(-50%)", background: "rgba(255, 255, 255, 0.95)", backdropFilter: "blur(8px)", padding: "10px 18px", borderRadius: "30px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", display: "flex", alignItems: "center", gap: "14px", fontSize: "13px", color: "#212529", zIndex: 998, border: "1px solid rgba(0,0,0,0.05)" },
  navCloseBtn: { padding: "6px 12px", borderRadius: "20px", border: "none", background: "#E8ECEF", fontSize: "11px", cursor: "pointer", color: "#495057", fontWeight: "600" },
  closeBtn: { position: "absolute", top: "12px", right: "14px", background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#adb5bd" },
  contentContainer: { display: "flex", gap: "14px", textAlign: "left" },
  imgPlaceholder: { width: "56px", height: "56px", backgroundColor: "#f1f3f5", borderRadius: "12px", display: "flex", justifyContent: "center", alignItems: "center", flexShrink: 0 },
  textGroup: { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center" },
  title: { margin: "0 0 4px 0", fontSize: "15px", fontWeight: "700", color: "#212529" },
  author: { fontSize: "12px", fontWeight: "400", color: "#868e96", marginLeft: "8px" },
  desc: { margin: 0, fontSize: "12px", color: "#495057", lineHeight: "1.4" },
  guideBtn: { width: "100%", padding: "11px", color: "white", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: "600", transition: "all 0.2s" }
};

export default MapSketch;