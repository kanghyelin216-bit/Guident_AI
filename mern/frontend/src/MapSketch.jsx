import React, { useState, useEffect, useRef, useCallback } from "react";
import p5 from "p5";
import { io } from "socket.io-client"; 

if (typeof window !== 'undefined') {
  window.p5 = p5; 
  p5.disableFriendlyErrors = true;
}

/* ==========================================================================
   📐 캔버스 규격 및 백엔드 서버 설정 (1미터 = 1격자칸 = 75픽셀 규격)
   ========================================================================== */
const showGrid = true;          // 8x10 격자선 표시
const GRID_COLS = 8;            // 가로 8m (8칸)
const GRID_ROWS = 10;           // 세로 10m (10칸)
const PIXEL_SCALE = 75;         // 1m = 1칸 = 75px

const BASE_WIDTH = GRID_COLS * PIXEL_SCALE;   // 600px
const BASE_HEIGHT = GRID_ROWS * PIXEL_SCALE;  // 750px

// 🔵 테스트용 임의의 내 위치 (4m, 8m 지점 -> x: 300px, y: 600px)
const DEFAULT_MOCK_USER_POS = { x: 300, y: 600 };

const SERVER_BASE_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:4000`
  : 'http://localhost:4000';

function metersToPixels(xM, yM) {
  const px = xM * PIXEL_SCALE;
  const py = yM * PIXEL_SCALE;
  return {
    x: Math.max(12, Math.min(px, BASE_WIDTH - 12)),
    y: Math.max(12, Math.min(py, BASE_HEIGHT - 12)),
  };
}

function metersToPixelsRaw(xM, yM) {
  return { x: xM * PIXEL_SCALE, y: yM * PIXEL_SCALE };
}

/* ==========================================================================
   🎨 고정 맵 오브젝트 레이아웃
   ========================================================================== */
const mapObjects = [
  {x: 94, y: 0, w: 412, h: 40, name: '칠판', type: 'etc', desc: '전시 소개, 발표 및 시연 안내가 진행되는 공간입니다.'},
  {x: 0, y: 80, w: 50, h: 110, name: '스마트 홈 제어판', shortName:'작품1', type: 'booth', beaconId: 'A1', author: '음성·앱 기반 제어', desc: '음성 명령과 모바일 앱으로 조명, 온도, 보안 장치를 제어하는 스마트 홈 시스템 체험 부스입니다.'},
  {x: 0, y: 320, w: 50, h: 110, name: '실시간 이미지 분류', shortName:'작품2', type: 'booth', beaconId: 'A2', author: '작가명', desc: '카메라로 사물을 촬영하면 딥러닝 모델이 이미지를 분석하여 분류 결과를 실시간으로 보여주는 체험입니다.'},
  {x: 0, y: 560, w: 50, h: 110, name: 'ICT PBL 프로젝트', shortName:'작품3', type: 'booth', beaconId: 'A3', author: '학생 융합 프로젝트', desc: '학생들이 직접 기획하고 개발한 ICT 융합 프로젝트의 결과물을 소개하고 체험할 수 있는 전시입니다.'},
  {x: 550, y: 560, w: 50, h: 110, name: '자율주행 로봇', shortName: '작품6', type: 'booth', beaconId: 'A5', author: '센서 기반 자율주행', desc: '라이다와 카메라 센서로 주변 장애물을 인식하고, 스스로 안전한 경로를 찾아 이동하는 로봇 시연입니다.'},
  {x: 550, y: 320, w: 50, h: 110, name: '스마트 센서 네트워크', shortName:'작품5', type: 'booth', beaconId: 'A6', author: 'IoT 데이터 수집·분석', desc: '온도·습도·조도 등 다양한 센서를 IoT로 연결하고, 실시간 데이터를 수집·분석하는 시스템입니다.'},
  {x: 550, y: 80, w: 50, h: 110, name: 'AI 임베디드 시스템', shortName:'작품4', type: 'booth', beaconId: 'A7', author: '온디바이스 AI 체험', desc: '하드웨어에 AI를 직접 내장하여 인터넷 연결 없이도 동작하는 온디바이스 AI 기술을 체험하는 전시입니다.'},
  {x: 558, y: 0, w: 42, h: 50, name: '출입문', type: 'door', desc: '전시장 전면 출입구입니다. 통행에 유의해 주세요.'},
  {x: 558, y: 700, w: 42, h: 50, name: '출입문', type: 'door', desc: '전시장 후면 출입구 및 비상구입니다.'},
];

const MapSketch = ({ scannerId = null, mapId = '6a4e268e4b23f93d45141083' }) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [visitorPositions, setVisitorPositions] = useState([]); 
  // 🔵 기본값으로 임의의 테스트 파란 점 데이터 주입
  const [userPos, setUserPos] = useState(DEFAULT_MOCK_USER_POS);
  const [currentZone, setCurrentZone] = useState('A-ZONE'); 
  const [selectedArtwork, setSelectedArtwork] = useState(null); 
  const [facilities, setFacilities] = useState([]); 
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [avoidCongestion, setAvoidCongestion] = useState(false);
  const [navPath, setNavPath] = useState(null); 
  const [navMessage, setNavMessage] = useState('');
  
  const p5Instance = useRef(null);
  const socketRef = useRef(null);

  /* 백엔드 소켓 연동 (실제 데이터 수신 시 위치 갱신) */
  useEffect(() => {
    if (socketRef.current) return;

    socketRef.current = io(SERVER_BASE_URL, {
      transports: ['websocket'],
      upgrade: false,
      forceNew: true,
      reconnectionAttempts: 5,
    });

    socketRef.current.on('connect', () => {
      socketRef.current.emit("join_map", { mapId });
    });

    socketRef.current.on('location_update', (data) => {
      if (!data?.scannerId) return;

      const rawX = typeof data.x === 'number' ? data.x : (typeof data.X === 'number' ? data.X : null);
      const rawY = typeof data.y === 'number' ? data.y : (typeof data.Y === 'number' ? data.Y : null);

      if (rawX === null || rawY === null) return;
      const now = Date.now();

      setVisitorPositions((previous) => {
        const byScannerId = new Map(previous.map((visitor) => [visitor.scannerId, visitor]));
        byScannerId.set(data.scannerId, {
          scannerId: data.scannerId,
          x: rawX,
          y: rawY,
          zone: data.zone || null,
          updatedAt: now,
        });
        return [...byScannerId.values()].filter((visitor) => now - visitor.updatedAt < 15000);
      });

      // 실제 내 폰 데이터가 들어오면 기존 테스트 좌표를 덮어씌웁니다.
      if (data.scannerId === scannerId) {
        const { x: clampedX, y: clampedY } = metersToPixels(rawX, rawY);
        setUserPos({ x: clampedX, y: clampedY });
        if (data.zone) setCurrentZone(data.zone);
        
        if (p5Instance.current) {
          p5Instance.current.userX = clampedX;
          p5Instance.current.userY = clampedY;
        }
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect(); 
        socketRef.current = null;
      }
    };
  }, [mapId, scannerId]);

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

  const askAI = async (questionText, targetNameKorean) => {
    try {
      await fetch(`${SERVER_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scannerId, mapId, zone: currentZone, targetName: targetNameKorean, message: questionText
        }),
      });
    } catch (err) {
      console.error("AI 챗봇 API 요청 실패:", err);
    }
  };

  /* 🧭 길안내 동선 계산 (서버 실패 시에도 내 위치->목적지 테스트 경로 생성) */
  const fetchPath = useCallback(async (targetId, targetName, targetPos) => {
    setNavMessage(`${targetName}(으)로 경로를 계산하는 중...`);

    const currentX = userPos ? userPos.x : DEFAULT_MOCK_USER_POS.x;
    const currentY = userPos ? userPos.y : DEFAULT_MOCK_USER_POS.y;

    try {
      const res = await fetch(`${SERVER_BASE_URL}/api/navigation/path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId,
          fromZone: currentZone || 'A-ZONE',
          toFacilityId: targetId,
          avoidCongestion,
        }),
      });
      const data = await res.json();
      if (data.found && data.path) {
        setNavPath(data.path);
        setNavMessage(`${targetName}까지 경로 안내 중${avoidCongestion ? ' (혼잡 회피)' : ''}`);
        return;
      }
    } catch (err) {
      console.log("서버 통신 미작동: 테스트용 바로 연결 경로 생성");
    }

    // 서버 미응답 시: 임의 파란점 위치에서 클릭한 목적지 중앙까지 직선 안내선 생성
    if (targetPos) {
      setNavPath([
        { x: currentX / PIXEL_SCALE, y: currentY / PIXEL_SCALE },
        { x: targetPos.x / PIXEL_SCALE, y: targetPos.y / PIXEL_SCALE }
      ]);
      setNavMessage(`${targetName}까지 경로 안내 중 (테스트 모드)`);
    }
  }, [currentZone, mapId, avoidCongestion, userPos]);

  const startNavigation = useCallback((facility) => {
    if (!facility) return;
    const targetPx = metersToPixelsRaw(facility.x, facility.y);
    fetchPath(facility._id || facility.id, facility.label || '목적지', targetPx);
  }, [fetchPath]);

  const startNavigationForArtwork = (artwork) => {
    if (!artwork) return;
    const targetId = artwork.beaconId || artwork.name;
    const targetCenter = { x: artwork.x + artwork.w / 2, y: artwork.y + artwork.h / 2 };
    fetchPath(targetId, artwork.name, targetCenter);
    setSelectedArtwork(null);
  };

  const clearNavigation = () => {
    setNavPath(null);
    setNavMessage('');
    setSelectedFacility(null);
    setSelectedArtwork(null);
  };

  useEffect(() => {
    if (!p5Instance.current) return;
    p5Instance.current.visitorPositionsPx = visitorPositions.map((visitor) => {
      const point = metersToPixels(visitor.x, visitor.y);
      return { ...visitor, x: point.x, y: point.y };
    });
  }, [visitorPositions]);

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

  useEffect(() => {
    let myP5;
    if (canvasRef.current) canvasRef.current.innerHTML = ""; 

    const sketch = (p) => {
      p.userX = userPos?.x ?? DEFAULT_MOCK_USER_POS.x;
      p.userY = userPos?.y ?? DEFAULT_MOCK_USER_POS.y;
      p.facilitiesPx = [];
      p.navPathPx = null;
      p.visitorPositionsPx = [];
      p.myScannerId = scannerId;
      p.scaleFactor = 1;

      p.setup = () => {
        const containerWidth = containerRef.current ? containerRef.current.clientWidth : BASE_WIDTH;
        p.scaleFactor = containerWidth / BASE_WIDTH;
        
        p.createCanvas(containerWidth, BASE_HEIGHT * p.scaleFactor);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("Inter, system-ui, -apple-system, sans-serif");
      };

      p.draw = () => {
        p.background(248, 249, 250); 

        p.push();
        p.scale(p.scaleFactor);

        // 📐 1m 단위(75px 간격) 격자선 (가로 8칸, 세로 10칸)
        if (showGrid) {
          p.stroke(218, 222, 229);
          p.strokeWeight(1);
          for (let x = 0; x <= BASE_WIDTH; x += PIXEL_SCALE) {
            p.line(x, 0, x, BASE_HEIGHT);
          }
          for (let y = 0; y <= BASE_HEIGHT; y += PIXEL_SCALE) {
            p.line(0, y, BASE_WIDTH, y);
          }
        }

        // 맵 구조물
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
          if (obj.type === 'booth') {
            p.fill(73, 80, 87); p.textSize(10.5); p.textStyle(p.BOLD);
            const padding = 4;
            p.text(obj.name, obj.x + padding, obj.y + padding, obj.w - padding * 2, obj.h - padding * 2);
          } else {
            p.fill(33, 37, 41); p.textSize(12); p.textStyle(p.BOLD);
            p.text(obj.name, obj.x + obj.w / 2, obj.y + obj.h / 2);
          }
          p.pop();
        }
        
        // 🧭 길안내 동선 선 그리기
        if (p.navPathPx && p.navPathPx.length > 1) {
          p.push();
          p.stroke(0, 122, 255);
          p.strokeWeight(5);
          p.noFill();
          p.beginShape();
          for (const pt of p.navPathPx) p.vertex(pt.x, pt.y);
          p.endShape();
          p.pop();
        }

        // 편의시설
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

        // 🔵 내 위치 (임의 파란점 애니메이션)
        if (p.userX !== null && p.userY !== null) {
          p.push();
          let pulse = p.sin(p.frameCount * 0.08) * 8;
          p.fill(0, 122, 255, 40);
          p.noStroke();
          p.circle(p.userX, p.userY, 26 + pulse); 
          p.fill(0, 122, 255);
          p.stroke(255);
          p.strokeWeight(3);
          p.circle(p.userX, p.userY, 14); 
          p.pop();
        }

        p.pop();
      };

      p.mousePressed = () => {
        const scaledMouseX = p.mouseX / p.scaleFactor;
        const scaledMouseY = p.mouseY / p.scaleFactor;

        for (const f of p.facilitiesPx) {
          const d = p.dist(scaledMouseX, scaledMouseY, f.x, f.y);
          if (d <= 18) {
            setSelectedFacility(f);
            setSelectedArtwork(null);
            return;
          }
        }
        for (let obj of mapObjects) {
          if (scaledMouseX >= obj.x && scaledMouseX <= obj.x + obj.w && scaledMouseY >= obj.y && scaledMouseY <= obj.y + obj.h) {
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

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0 && myP5) {
          myP5.scaleFactor = newWidth / BASE_WIDTH;
          myP5.resizeCanvas(newWidth, BASE_HEIGHT * myP5.scaleFactor);
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (myP5) myP5.remove();
    };
  }, [scannerId, userPos]);

  return (
    <div 
      ref={containerRef}
      style={{
        width: "100%",
        maxWidth: "600px",
        margin: "0 auto",
        padding: "20px 0",
        position: "relative",
        boxSizing: "border-box"
      }}
    >
      <div style={{
        position: 'absolute',
        top: 30,
        left: 10,
        zIndex: 10,
        background: 'rgba(255,255,255,0.93)',
        border: '1px solid #E9ECEF',
        borderRadius: 12,
        padding: '9px 12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: 13,
        fontWeight: 700,
        color: '#2D3250',
      }}>
        👥 현재 공간 내 <span style={{ color: '#007AFF' }}>{visitorPositions.length}명</span>
      </div>

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
          
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button 
              style={{
                ...styles.guideBtn,
                backgroundColor: "#007AFF",
                cursor: "pointer",
                flex: 1
              }}
              onClick={() => startNavigationForArtwork(selectedArtwork)}
            >
              🧭 길안내 시작
            </button>
            <button 
              style={{...styles.guideBtn, backgroundColor: "#10B981", flex: 1, cursor: "pointer"}}
              onClick={() => askAI("이 작품/상점에 대해 더 자세히 알려줘", selectedArtwork.name)}
            >
              🤖 AI 질문하기
            </button>
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
              <p style={styles.desc}>임의 내 위치에서 경로를 안내합니다.</p>
            </div>
          </div>
          <button
            style={{
              ...styles.guideBtn,
              backgroundColor: "#007AFF",
              cursor: "pointer",
              marginTop: "8px"
            }}
            onClick={() => startNavigation(selectedFacility)}
          >
            실시간 길안내 시작
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  canvasContainer: { width: "100%", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 24px rgba(0, 0, 0, 0.06)", border: "1px solid #e9ecef" },
  popupCard: { position: "absolute", left: "50%", bottom: "40px", transform: "translateX(-50%)", width: "90%", maxWidth: "340px", backgroundColor: "white", padding: "16px", borderRadius: "16px", boxShadow: "0 12px 32px rgba(0,0,0,0.15)", border: "1px solid #f1f3f5", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px", zIndex: 999 },
  navBanner: { position: "absolute", top: "30px", left: "50%", transform: "translateX(-50%)", width: "90%", maxWidth: "400px", background: "rgba(255, 255, 255, 0.95)", backdropFilter: "blur(8px)", padding: "10px 14px", borderRadius: "30px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", color: "#212529", zIndex: 998, border: "1px solid rgba(0,0,0,0.05)" },
  navCloseBtn: { padding: "6px 12px", borderRadius: "20px", border: "none", background: "#E8ECEF", fontSize: "11px", cursor: "pointer", color: "#495057", fontWeight: "600", shrink: 0 },
  closeBtn: { position: "absolute", top: "12px", right: "14px", background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#adb5bd" },
  contentContainer: { display: "flex", gap: "14px", textAlign: "left" },
  imgPlaceholder: { width: "56px", height: "56px", backgroundColor: "#f1f3f5", borderRadius: "12px", display: "flex", justifyContent: "center", alignItems: "center", flexShrink: 0 },
  textGroup: { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center" },
  title: { margin: "0 0 4px 0", fontSize: "15px", fontWeight: "700", color: "#212529" },
  author: { fontSize: "12px", fontWeight: "400", color: "#868e96", marginLeft: "8px" },
  desc: { margin: 0, fontSize: "12px", color: "#495057", lineHeight: "1.4" },
  guideBtn: { width: "100%", padding: "11px", color: "white", border: "none", borderRadius: "10px", fontSize: "12px", fontWeight: "600", transition: "all 0.2s" }
};

export default MapSketch;