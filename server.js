// ===== 의존성 =====
const WebSocket = require("ws");
const osc = require("osc");
const express = require("express");
const fs = require("fs");
const util = require("util");
const textToSpeech = require("@google-cloud/text-to-speech");
const { v4: uuidv4 } = require("uuid");
const wav = require("wav-decoder");
const path = require("path");

require("dotenv").config();

// ===== 설정 =====
const PORT_WS = process.env.PORT_WS || 8080;
const PORT_OSC = process.env.PORT_OSC || 9000;
const PORT_HTTP = process.env.PORT_HTTP || 3000;
const AUDIO_DIR = process.env.AUDIO_DIR || "public/audio";

// ===== Express 서버 (TTS 오디오 제공) =====
const app = express();
app.use("/audio", express.static(AUDIO_DIR));
app.listen(PORT_HTTP, () => console.log(`🌐 오디오 서버 실행 중: http://localhost:${PORT_HTTP}/audio/`));

// ===== Google TTS 클라이언트 =====
const ttsClient = new textToSpeech.TextToSpeechClient();

async function analyzeWavToJson(filePath, jsonPath, frameSize = 512) {
  const buffer = fs.readFileSync(filePath);
  const decoded = await wav.decode(buffer);
  const channelData = decoded.channelData[0]; // 모노 채널 기준
  const sampleRate = decoded.sampleRate;
  const totalFrames = Math.floor(channelData.length / frameSize);

  const frames = [];
  for (let i = 0; i < totalFrames; i++) {
    const slice = channelData.slice(i * frameSize, (i + 1) * frameSize);
    const rms = Math.sqrt(slice.reduce((acc, v) => acc + v * v, 0) / slice.length);
    frames.push(+Math.min(1.0, rms * 20).toFixed(3));
  }

  const result = {
    sampleRate,
    frameSize,
    frames
  };

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`✅ JSON 립싱크 생성됨: ${jsonPath}`);
}

async function synthesizeTTS(text, filename = "tts_fixed.wav") {
  const request = {
    input: { text },
    voice: { languageCode: "ko_KR", ssmlGender: "FEMALE" },
    audioConfig: { audioEncoding: "LINEAR16" }
  };

  const [response] = await ttsClient.synthesizeSpeech(request);

  // ✅ 여기에 디렉토리 생성 추가
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  // 🔁 .json 생성
  // ✅ 순서 보장: 먼저 filePath → 그 다음 jsonPath
  const filePath = `${AUDIO_DIR}/${filename}`;
  await util.promisify(fs.writeFile)(filePath, response.audioContent, "binary");

  const jsonPath = filePath.replace(".wav", ".json");
  await analyzeWavToJson(filePath, jsonPath);

  const baseUrl = `http://localhost:${PORT_HTTP}/audio`;
  return {
    audioUrl: `${baseUrl}/${filename}`,
    jsonUrl: `${baseUrl}/${path.basename(jsonPath)}`
  };
}

// ===== 세션 맵 =====
const clients = new Map(); // socket → { userId, timer }

// ===== 클라이언트 세션 관리 클래스 =====
class ClientSession {
  constructor(ws, userId) {
    this.ws = ws;
    this.userId = userId;
    this.interval = null;
  }

  send(payload) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  startSimulatedLoop() {
    let t = 0;

    this.interval = setInterval(() => {
      const payload = {
        userId: this.userId,
        parameters: {
          mouthOpen: +(Math.sin(t) * 0.5 + 0.5).toFixed(3),
          headYaw: +(Math.cos(t * 0.5) * 20).toFixed(2)
        },
      };
      this.send(payload);
      t += 0.1;
    }, 100);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }
}

// ===== WebSocket 서버 초기화 =====
const wss = new WebSocket.Server({ port: PORT_WS });
console.log(`🟢 WebSocket 서버 실행 중: ws://localhost:${PORT_WS}`);

wss.on("connection", (ws) => {
  console.log("Unity Client connected");

  // user_a: FaceCap 대상 유저, user_b: 시뮬레이터용
  const userId = clients.has("vrm_user_a") ? "user_b" : "vrm_user_a";
  const session = new ClientSession(ws, userId);

  if (userId === "user_b") {
    session.startSimulatedLoop();
  }

  clients.set(userId, session);
  console.log(`🧾 세션 등록됨: ${userId}`);

  ws.on("message", async (message) => {
    try {
      const str = message.toString(); // 🟢 문자열로 변환
      const parsed = JSON.parse(str);
      const readyUserId = parsed.userId || userId;

      if (parsed.ready == true) {
        console.log(`✅ ${readyUserId} 준비 완료 → TTS 음성 생성`);
        const filename = "tts_fixed.wav";//`tts_${uuidv4().slice(0, 8)}.wav`;
        const { audioUrl, jsonUrl } = await synthesizeTTS(
          "안녕하세요! 지금 들리시는 목소리는 TTS를 활용해서 재생되고 있습니다.제 입 모양은 음성에 맞춰 자동으로 립싱크되고 있어요.",          filename
          //"こんにちは！今聞こえている声はTTSを使って再生していて、口の動きは音声に合わせて自動的にリップシンクされています。",
        );
        const payload = {
          userId: readyUserId,
          parameters: {
            mouthOpen: 0.5
          },
          audioUrl: audioUrl,
          jsonUrl: jsonUrl
        };
        clients.get(readyUserId)?.send(payload);
        console.log("📤 전송한 payload:", JSON.stringify(payload));
      }
    }
    catch (err) {
      console.warn("⚠️ JSON 파싱 실패:", err.message);
      console.warn("📨 원본 메시지:", message.toString('utf8'));
    }
  });

  // 종료
  ws.on("close", () => {
    console.log(`🔴 연결 종료: ${userId}`);
    session.stop();
    clients.delete(userId);
  });
});

wss.on("error", (err) => {
  console.error("❌ WebSocket 에러:", err);
});

// ===== user_b 시뮬레이터 수동 생성 (WebSocket 연결 없이도 작동하며, FaceCap 데이터를 받을 수도 있음) =====
const createSimulatedUserB = () => {
  const session = new ClientSession(null, "user_b");
  session.send = (payload) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
      }
    });
  };
  session.startSimulatedLoop();
  clients.set("user_b", session);
  console.log("🟡 시뮬레이터 user_b 세션 시작됨");
};
createSimulatedUserB();

/*
👉 user_b도 FaceCap 데이터를 받을 수 있도록 하려면, 아래 주석을 해제하여 user_b를 FaceCap 대상으로 생성
const userBSession = new ClientSession(null, "user_b");
userBSession.send = (payload) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        userId: "user_b",
        parameters: payload.parameters
      }));
    }
  });
};
clients.set("user_b", userBSession);
console.log("🟢 user_b FaceCap 캐릭터로 수동 등록됨");
*/

// ===== OSC 포트 및 FaceCap 메시지 처리 =====
const blendshapeMap = {
  0: "browDown_L",
  1: "browDown_R",
  2: "browInnerUp",
  3: "browOuterUp_L",
  4: "browOuterUp_R",
  5: "eyeLookUp_L",
  6: "eyeLookUp_R",
  7: "eyeLookDown_L",
  8: "eyeLookDown_R",
  9: "eyeLookIn_L",
  10: "eyeLookIn_R",
  11: "eyeLookOut_L",
  12: "eyeLookOut_R",
  13: "eyeBlink_L",
  14: "eyeBlink_R",
  15: "eyeSquint_L",
  16: "eyeSquint_R",
  17: "eyeWide_L",
  18: "eyeWide_R",
  19: "cheekPuff",
  20: "cheekSquint_L",
  21: "cheekSquint_R",
  22: "noseSneer_L",
  23: "noseSneer_R",
  24: "mouthOpen",
  25: "jawForward",
  26: "jawLeft",
  27: "jawRight",
  28: "mouthFunnel",
  29: "mouthPucker",
  30: "mouthLeft",
  31: "mouthRight",
  32: "mouthRollUpper",
  33: "mouthRollLower",
  34: "mouthShrugUpper",
  35: "mouthShrugLower",
  36: "mouthClose",
  37: "mouthSmile_L",
  38: "mouthSmile_R",
  39: "mouthFrown_L",
  40: "mouthFrown_R",
  41: "mouthDimple_L",
  42: "mouthDimple_R",
  43: "mouthUpperUp_L",
  44: "mouthUpperUp_R",
  45: "mouthLowerDown_L",
  46: "mouthLowerDown_R",
  47: "mouthPress_L",
  48: "mouthPress_R",
  49: "mouthStretch_L",
  50: "mouthStretch_R",
  51: "tongueOut",
  52: "headYaw",
  53: "headPitch",
  54: "headRoll"
};

const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: PORT_OSC, // FaceCap의 OSC 포트와 일치 시켜야함
  metadata: true
});
let hasSentOSCText = false;

udpPort.on("message", (oscMsg) => {
  const userId = "vrm_user_a";
  const target = clients.get(userId);
  if (!target) return;

  // HEAD ROTATION
  if (oscMsg.address === "/HR") {
    const [x, y, z] = oscMsg.args.map(arg => arg?.value ?? 0);
    // const x = oscMsg.args?.[0]?.value ?? 0;
    // const y = oscMsg.args?.[1]?.value ?? 0;
    // const z = oscMsg.args?.[2]?.value ?? 0;

    const payload = {
      userId,
      parameters: { headPitch: x, headYaw: y, headRoll: z },
      vrmPath: "Assets/Resources/Model/6493143135142452442.vrm"
    };

    if (!hasSentOSCText) {
      payload.text = "こんにちは、私はリアルタイム配信システムのデモンストレーション用キャラクターです。今からしゃべる間に、口の動きが自然に再生されることに注目してください。";
      hasSentOSCText = true;
    }

    target.send(payload);
    // console.log("📤 전송한 payload:", JSON.stringify(payload));

  } else if (oscMsg.address === "/W") {
    const index = oscMsg.args[0]?.value;
    const value = oscMsg.args[1]?.value;
    const param = blendshapeMap[index] || `Blendshape_${index}`;
    const payload = { userId, parameters: { [param]: value } };
    target.send(payload);
  }
});

udpPort.on("error", (err) => {
  console.error("❌ OSC 에러:", err);
});

udpPort.open();
console.log(`📡 OSC 수신 대기 중 (port ${PORT_OSC})`);

// ===== Graceful 종료 =====
process.on("SIGINT", () => {
  console.log("🛑 서버 종료 중...");

  // WebSocket 클라이언트 강제 종료
  for (const client of wss.clients) {
    client.terminate();
  }

  // WebSocket 서버 종료
  wss.close(() => {
    console.log("🧹 WebSocket 서버 종료 완료");
  });

  // OSC 포트 안전하게 종료
  try {
    udpPort.close(); // 연결 안 되어 있어도 try/catch로 예외 방지
    console.log("📡 OSC 포트 종료 시도");
  } catch (err) {
    console.warn("⚠️ OSC 종료 실패 또는 연결되지 않음:", err.message);
  }

  // 조금 기다렸다가 프로세스 종료
  setTimeout(() => {
    console.log("✅ 서버 종료 완료");
    process.exit(0);
  }, 1000);
});