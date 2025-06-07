# 🎙️ LiveVtuberProject – WebSocket Server

This server is part of the LiveVtuberProject, built to support real-time avatar streaming using Unity or Unreal Engine. It integrates WebSocket communication, OSC-based facial tracking (via iPhone FaceCap), and Google TTS for automatic lip-syncing.

---

## 📦 Features

- Real-time communication via WebSocket (Unity/Unreal clients)
- OSC data reception from FaceCap (iOS app)
- Google TTS integration for voice and JSON-based lip sync
- Simulated character support (`user_b`) for testing without FaceCap

---

## 🗂️ Project Structure
```
.
├── server.js # Main server code
├── .env # Environment variables (.gitignored)
├── public/audio/ # Generated audio and lip sync files
├── package.json
└── README.md
```
---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
1. npm install

2. Configure Environment Variables
Create a .env file in the root directory.
You can refer to the provided .env.example for the correct format.
cp .env.example .env

3. Run the Server
node server.js