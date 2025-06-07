# 🎙️ LiveVtuberProject WebSocket Server

본 서버는 Unity 또는 Unreal Engine 기반의 실시간 Vtuber 방송 시스템을 위한 WebSocket + OSC + TTS 서버입니다.  
iPhone의 FaceCap 데이터를 OSC로 수신하고, Google TTS를 활용한 립싱크 JSON과 오디오 파일을 생성 및 송출합니다.

---

## 📦 주요 기능

- WebSocket을 통한 Unity/Unreal 클라이언트와의 실시간 통신
- iPhone FaceCap App의 OSC 데이터를 받아 VRM 캐릭터에 전달
- Google TTS를 통한 음성 생성 및 립싱크 JSON 자동 분석
- 시뮬레이터 캐릭터(user_b) 지원

---

## 🚀 실행 방법

### 1. 설치

```bash
npm install