import React, { useState, useEffect, useRef } from "react";
import p5 from "p5";
import { io } from "socket.io-client"; 

/* ==========================================================================
   📐 캔버스 및 레이아웃 설정
   ⚠️ 서버(routes/location.js)는 이제 "미터" 단위 좌표(x, y)를 보냅니다.
      기존처럼 서버가 픽셀을 직접 계산해서 주는 게 아니라, 프론트에서
      PIXEL_SCALE로 미터→픽셀 변환을 해야 합니다.
   ========================================================================== */
const showGrid = false;
const CANVAS_WIDTH = 602;
const CANVAS_HEIGHT = 767;

// 1미터 = 몇 픽셀인지 (안드로이드 BeaconConfig.kt의 PIXEL_SCALE=45와 반드시 동일해야 함)
// ⚠️ 확인 필요: BeaconConfig.kt 주석은 "ROOM_WIDTH 8.04m = 362px"라고 되어 있는데
//    이 파일의 CANVAS_WIDTH는 602입니다. 실제 맵 이미지의 가로 길이(m)를 알려주시면
//    PIXEL_SCALE / CANVAS_WIDTH 값을 정확히 맞춰드리겠습니다. 지금은 45로 가정합니다.
const PIXEL_SCALE = 45;

// 통합 백엔드 서버(4000번 포트) 주소로 변경
const YOUR_COMPUTER_IP = 'http://localhost:4000';

// 이 컴포넌트가 어떤 scannerId의 위치를 보여줄지.
// prop으로 안 넘기면(단일 테스트 기기 단계) 들어오는 모든 location_update를 그대로 반영합니다.
function metersToPixels(xM, yM) {
  const px = xM * PIXEL_SCALE;
  const py = yM * PIXEL_SCALE;
  return {
    x: Math.max(10, Math.min(px, CANVAS_WIDTH - 10)),
    y: Math.max(10, Math.min(py, CANVAS_HEIGHT - 10)),
  };
}

// 시설/경로 좌표는 지도 밖으로 나갈 리 없는 "설계된" 좌표라 클램핑 없이 그대로 변환합니다.
function metersToPixelsRaw(xM, yM) {
  return { x: xM * PIXEL_SCALE, y: yM * PIXEL_SCALE };
}

/* ==========================================================================
   🎨 맵 오브젝트 배치 및 데이터 구조 (단위: 픽셀, px)
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

const MapSketch = ({ scannerId = null, mapId = '6600a1b2c3d4e5f6789abcde' } = {}) => {
  const canvasRef = useRef(null);
  
  // 📡 초기값 (아직 위치 갱신 이벤트를 못 받았을 때의 기본 표시 위치)
  const [userPos, setUserPos] = useState({ x: 181, y: 383 }); 
  const [currentZone, setCurrentZone] = useState(null); // 경로탐색의 출발지(fromZone)로 사용
  const [selectedArtwork, setSelectedArtwork] = useState(null); 
  const [facilities, setFacilities] = useState([]); // Map.facilities (화장실/출구 등, 관리자 화면에서 등록)
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [avoidCongestion, setAvoidCongestion] = useState(false);
  const [navPath, setNavPath] = useState(null); // [{x(m), y(m), zone}, ...]
  const [navMessage, setNavMessage] = useState('');
  
  const p5Instance = useRef(null);
  const socketRef = useRef(null); // 리액트 StrictMode로 인한 소켓 중복 생성 방지 가드

  /* ==========================================================================
     📡 [소켓 연동] 서버가 보내는 실제 위치추정 결과(미터 단위)를 픽셀로 변환해 반영
     ========================================================================== */
  useEffect(() => {
    if (socketRef.current) return;

    socketRef.current = io(YOUR_COMPUTER_IP, {
      transports: ['websocket'],
      upgrade: false,
      forceNew: true,
      reconnectionAttempts: 5,
    });

    socketRef.current.on('connect', () => {
      console.log("🌐 [리액트] 중계 웹소켓 서버 연결 성공! ID:", socketRef.current.id);
    });

    socketRef.current.on('location_update', (data) => {
      // data: { scannerId, mapId, x(m), y(m), zone, confidence, usedBeacons }
      if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;

      // scannerId를 지정한 경우, 다른 스캐너의 갱신은 무시
      if (scannerId && data.scannerId !== scannerId) return;

      const { x: clampedX, y: clampedY } = metersToPixels(data.x, data.y);
      console.log(`🎯 위치 갱신 [scanner=${data.scannerId}, zone=${data.zone}]: 미터(${data.x.toFixed(2)}, ${data.y.toFixed(2)}) → 픽셀(${clampedX.toFixed(0)}, ${clampedY.toFixed(0)})`);
      setUserPos({ x: clampedX, y: clampedY });
      if (data.zone) setCurrentZone(data.zone); // 경로탐색 출발지로 사용
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect(); 
        socketRef.current = null;
      }
    };
  }, []);

  /* ==========================================================================
     🚻 [시설 로드] 관리자 화면(AdminBeacons)에서 등록한 화장실/출구 등을 불러옴
     ========================================================================== */
  useEffect(() => {
    let cancelled = false;
    fetch(`${YOUR_COMPUTER_IP}/api/maps/${mapId}`)
      .then(res => res.json())
      .then(doc => { if (!cancelled) setFacilities(doc?.facilities || []); })
      .catch(() => { if (!cancelled) setFacilities([]); });
    return () => { cancelled = true; };
  }, [mapId]);

  /* ==========================================================================
     🧭 [경로탐색] 백엔드 A* 알고리즘 호출 → 결과를 지도 위에 그릴 좌표 배열로 저장
     ========================================================================== */
  const startNavigation = async (facility) => {
    if (!currentZone) {
      setNavMessage('아직 내 위치가 확인되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setNavMessage('경로를 계산하는 중...');
    try {
      const res = await fetch(`${YOUR_COMPUTER_IP}/api/navigation/path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId,
          fromZone: currentZone,
          toFacilityId: facility.id,
          avoidCongestion,
        }),
      });
      const data = await res.json();
      if (!data.found) {
        setNavPath(null);
        setNavMessage(data.message || '경로를 찾을 수 없습니다.');
        return;
      }
      setNavPath(data.path); // [{x(m), y(m), zone}, ...]
      setNavMessage(`${facility.label}까지 ${data.steps}칸 경로 안내 중${avoidCongestion ? ' (혼잡구간 회피)' : ''}`);
      setSelectedArtwork(null);
    } catch (err) {
      setNavPath(null);
      setNavMessage('경로탐색 서버 요청에 실패했습니다.');
    }
  };

  const clearNavigation = () => {
    setNavPath(null);
    setNavMessage('');
    setSelectedFacility(null);
  };


  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.currentX = userPos.x;
      p5Instance.current.currentY = userPos.y;
    }
  }, [userPos]);

  // 시설/경로 데이터가 바뀔 때마다 p5 인스턴스 메모리에 픽셀 좌표로 변환해 주입
  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.facilitiesPx = facilities.map(f => ({ ...f, ...metersToPixelsRaw(f.x, f.y) }));
    }
  }, [facilities]);

  useEffect(() => {
    if (p5Instance.current) {
      p5Instance.current.navPathPx = navPath ? navPath.map(pt => metersToPixelsRaw(pt.x, pt.y)) : null;
    }
  }, [navPath]);


  /* ==========================================================================
     🎨 [p5.js 렌더링 엔진] 지도 디자인 및 마커 드로잉 루프 결합
     ========================================================================== */
  useEffect(() => {
    let myP5;
    if (canvasRef.current) canvasRef.current.innerHTML = ""; 

    const sketch = (p) => {
      // 리액트 useEffect가 접근할 수 있도록 p 객체 인스턴스 멤버 변수로 선언
      p.currentX = 181;
      p.currentY = 383;
      p.facilitiesPx = [];
      p.navPathPx = null;

      p.setup = () => {
        p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("Inter, system-ui, -apple-system, sans-serif");
      };

      p.draw = () => {
        // 1. 캔버스 배경 클리어
        p.background(248, 249, 250); 

        // 2. 보조 격자선 활성화 여부 처리
        if (showGrid){
          p.stroke(230); p.strokeWeight(1);
          for (let x = 0; x < p.width; x += 40) p.line(x, 0, x, p.height);
          for (let y = 0; y < p.height; y += 40) p.line(0, y, p.width, y);
        }

        // 3. 맵 오브젝트(부스, 작품, 문) 통동형 그래픽 렌더링 (사라졌던 디자인 핵심 복구)
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

        // 4. 경로탐색 결과 라인 (있을 때만)
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

        // 5. 등록된 시설(화장실/출구 등) 마커
        for (const f of p.facilitiesPx) {
          p.push();
          p.fill(116, 196, 118);
          p.stroke(255);
          p.strokeWeight(2);
          p.circle(f.x, f.y, 22);
          p.pop();
        }

        // 6. 실시간 위치 동기화가 반영된 파란 점 그리기
        drawUserMarker(p, p.currentX, p.currentY); 
      };

      // 파란색 현 위치 마커 디자인 함수
      const drawUserMarker = (p, x, y) => {
        p.push();
        let pulse = p.sin(p.frameCount * 0.05) * 6;
        
        p.fill(0, 122, 255, 40);
        p.noStroke();
        p.circle(x, y, 24 + pulse); 

        p.fill(0, 122, 255);
        p.stroke(255);
        p.strokeWeight(2);
        p.circle(x, y, 12); 
        p.pop();
      };

      // 작품 / 시설 터치 이벤트 인터랙션
      p.mousePressed = () => {
        // 1) 등록된 시설(화장실/출구 등) 마커를 우선 검사
        for (const f of p.facilitiesPx) {
          const d = p.dist(p.mouseX, p.mouseY, f.x, f.y);
          if (d <= 14) {
            setSelectedFacility(f);
            setSelectedArtwork(null);
            return;
          }
        }
        // 2) 작품/부스
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

    // 초기 마운트 시 최초 위치 동기화
    myP5.currentX = userPos.x;
    myP5.currentY = userPos.y;

    return () => {
      if (myP5) myP5.remove();
    };
  }, []); 

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px", position: "relative" }}>
      <div ref={canvasRef} style={styles.canvasContainer}></div>

      {/* 경로탐색 상태 배너 + 혼잡구간 회피 토글 */}
      {(navMessage || navPath) && (
        <div style={styles.navBanner}>
          <span>{navMessage}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={avoidCongestion}
              onChange={e => setAvoidCongestion(e.target.checked)}
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
            <div style={styles.imgPlaceholder}></div>
            <div style={styles.textGroup}>
              <h3 style={styles.title}>
                {selectedArtwork.name}
                {selectedArtwork.author && <span style={styles.author}>{selectedArtwork.author}</span>}
              </h3>
              <p style={styles.desc}>{selectedArtwork.desc}</p>
            </div>
          </div>
          {/* 작품은 관리자 화면에 등록된 "시설"이 아니라 경로탐색 대상이 아닙니다.
              AI 도우미에게 물어보도록 안내만 합니다. */}
        </div>
      )}

      {selectedFacility && (
        <div style={styles.popupCard}>
          <button style={styles.closeBtn} onClick={() => setSelectedFacility(null)}>✕</button>
          <div style={styles.contentContainer}>
            <div style={styles.imgPlaceholder}>🚻</div>
            <div style={styles.textGroup}>
              <h3 style={styles.title}>{selectedFacility.label}</h3>
              <p style={styles.desc}>
                {currentZone ? `현재 위치(${currentZone})에서 경로를 안내해 드릴게요.` : '내 위치가 확인되면 경로를 안내해 드려요.'}
              </p>
            </div>
          </div>
          <button
            style={styles.guideBtn}
            disabled={!currentZone}
            onClick={() => startNavigation(selectedFacility)}
          >
            {currentZone ? '길안내 시작하기' : '위치 확인 중...'}
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  canvasContainer: { borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 24px rgba(0, 0, 0, 0.06)", border: "1px solid #e9ecef" },
  popupCard: { position: "absolute", left: "100px", top: "70px", width: "282px", height: "160px", backgroundColor: "white", padding: "15px 15px 12px 15px", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,0.12)", border: "1px solid #efefef", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", zIndex: 999 },
  navBanner: { position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)", background: "white", padding: "8px 14px", borderRadius: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", alignItems: "center", gap: "12px", fontSize: "12px", color: "#212529", zIndex: 998, whiteSpace: "nowrap" },
  navCloseBtn: { padding: "4px 10px", borderRadius: "8px", border: "none", background: "#F1F3F5", fontSize: "11px", cursor: "pointer", color: "#495057" },
  closeBtn: { position: "absolute", top: "10px", right: "12px", background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#ccc" },
  contentContainer: { display: "flex", gap: "12px", textAlign: "left", flex: 1 },
  imgPlaceholder: { width: "65px", height: "65px", backgroundColor: "#f1f3f5", borderRadius: "8px", display: "flex", justifyContent: "center", alignItems: "center" },
  textGroup: { flex: 1, overflow: "hidden" },
  title: { margin: "0 0 4px 0", fontSize: "14px", fontWeight: "bold", color: "#212529" },
  author: { fontSize: "11px", fontWeight: "normal", color: "#868e96", marginLeft: "6px" },
  desc: { margin: 0, fontSize: "11px", color: "#495057", lineHeight: "1.4", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
  guideBtn: { width: "100%", padding: "9px", backgroundColor: "#212529", color: "white", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: "600", marginTop: "8px", transition: "background 0.2s" }
};

export default MapSketch;