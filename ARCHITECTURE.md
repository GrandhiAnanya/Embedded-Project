# Architecture — Smart Remote + Mock TV Demo

## 0. Goal & Constraints

Build a physical ESP32 smart remote that demos against a fake Smart-TV website on a laptop, over Wi-Fi. College demo, low budget, must work on hostel/hotspot networking, must give instant LED + sound feedback.

Non-goals: IR blasting, real TV control, internet backend, auth, production perfboard (phase 6 only).

## 1. System Overview

```
┌──────────────┐  Wi-Fi (phone hotspot)  ┌────────────────────────────┐
│  ESP32 Remote│ ◄──── WebSocket ──────► │ Laptop: Bun + Next.js      │
│              │   JSON both directions  │  ┌──────────┐ ┌─────────┐  │
│ 8x buttons   │                         │  │ TV UI    │ │ WS Hub  │  │
│ 10x WS2812B  │                         │  │ (React)  │ │(Bun.serve)│
│ passive buzz │                         │  └──────────┘ └─────────┘  │
└──────────────┘                         └────────────────────────────┘
```

Two processes, one transport:

- **ESP32 firmware (C++/Arduino):** owns inputs, validation, LEDs, buzzer. WebSocket **client**.
- **TV mock (Bun + Next.js):** owns display, task selection, progress reflection. WebSocket **server** + web page.

**Why two-way WebSocket (not just ESP32→laptop)?** Task is chosen on the TV screen with a mouse (e.g. click YouTube tile). That selection must travel `laptop → ESP32` as `{"task":"OPEN_YOUTUBE"}`. Button presses and results travel `ESP32 → laptop`. Plain HTTP polling is too laggy; WebSocket handles both directions on one connection.

## 2. Tech Choice: Bun + Next.js (and what "Node or Next" means)

- **Bun** = runtime (replaces Node.js). Runs JS/TS, serves HTTP + WebSocket, installs packages.
- **Next.js** = React framework (runs *on* Bun or Node). Gives you the TV UI pages.
- So it's not either/or — use **Bun (runtime) + Next.js 15 (framework) + TypeScript + Tailwind**.

Why this stack:

- Single `bun install / bun run dev` for whole team, fast installs.
- Bun has native WebSocket server (`Bun.serve({ websocket })`) — no extra `ws` package, less code.
- Next.js App Router gives a convincing TV home screen (tiles, focus states, detail overlay) with zero backend to deploy — runs on `localhost:3000`, ESP32 connects to `ws://<laptop-ip>:3000/api/ws`.
- Latest JS: ES2024, `async/await`, `fetch`, native `WebSocket` in browser.

Lightweight alternative (if Next feels heavy): `Bun + Vite SPA + Elysia`. Same protocol, fewer files. Default to Next.js unless the team already knows Vite.

Proposed `tv-mock/` layout:

```
tv-mock/
  package.json (next, react, tailwind)
  app/page.tsx         # TV grid: YouTube, Netflix, etc. + status bar
  app/components/RemoteMirror.tsx  # on-screen remote that lights up from WS events
  app/api/ws/route.ts  # or server/ws.ts with Bun.serve — WS hub, broadcasts
  lib/protocol.ts      # shared TS types for JSON messages
```

## 3. Message Protocol (v1)

All frames are JSON, newline-free, <256 bytes. ESP32 uses ArduinoJson; web uses `JSON.parse`.

### 3.1 Laptop → ESP32

```ts
type L2E =
  | { task: string; sequence: number[]; timeout_ms?: number } // e.g. { task:"OPEN_YOUTUBE", sequence:[2,5,1,4] }
  | { cmd: "cancel" }
  | { cmd: "ping"; id: number };
```

### 3.2 ESP32 → Laptop

```ts
type E2L =
  | { event: "ready"; buttons: number; leds: number }
  | { event: "task_ack"; task: string }
  | { event: "step_ok"; step: number; button: number }
  | { event: "step_fail"; step: number; expected: number; got: number }
  | { event: "task_complete"; task: string; ms: number }
  | { event: "task_timeout"; task: string }
  | { event: "pong"; id: number };
```

Example session:

```
L→E  {"task":"OPEN_YOUTUBE","sequence":[2,5,1,4]}
E→L  {"event":"task_ack","task":"OPEN_YOUTUBE"}
E→L  {"event":"step_ok","step":0,"button":2}
E→L  {"event":"step_fail","step":1,"expected":5,"got":3}  // LED red + low buzz, step stays 1
E→L  {"event":"step_ok","step":1,"button":5}
...
E→L  {"event":"task_complete","task":"OPEN_YOUTUBE","ms":4200}
```

## 4. Ownership & State Machines

**Rule: ESP32 owns sequence + LEDs. Laptop just reflects.** If Wi-Fi drops, remote still beeps/lights correctly; TV catches up on reconnect.

### ESP32 states

```
IDLE ──task──► ARMED ──correct btn──► ARMED (step++, green LED step, high blip)
  ▲               │──wrong btn──► ARMED (red flash, low buzz, step unchanged)
  │               ├──all steps──► SUCCESS (rainbow chase + jingle → task_complete)
  │               └──timeout/cancel──► IDLE (clear LEDs)
  └──── task_complete/timeout ──┘
```

Implementation: `uint8_t seq[16]; uint8_t step; unsigned long deadline;` + non-blocking `loop()` (no `delay()` except tiny debounce). LEDs via FastLED/NeoPixel `show()` only on state change. Buzzer via `tone()`/`ledcWriteTone()` short envelopes (60 ms ok, 200 ms fail).

### Web (TV) states

```
HOME ──click tile──► CHALLENGE_SENT ──step_ok──► PROGRESS ──task_complete──► APP_OPEN (fake YouTube page)
                        └──step_fail──► SHAKE + red hint, stays in PROGRESS
```

Web never decides pass/fail — only renders `E2L` events into `RemoteMirror` + progress bar. Reconnect logic: exponential backoff, resend current task on ESP32 `ready`.

## 5. Hardware Design

### 5.1 Pin map (default, avoids strapping pins 0/2/12/15)

| Function | GPIO | Notes |
|----------|------|-------|
| BTN 0–7 | 13, 14, 16, 17, 18, 19, 21, 22 | `INPUT_PULLUP`, button to GND, 30–50 ms debounce |
| LED strip DIN | 27 | Via 330–470 Ω series resistor |
| Buzzer + | 25 | Passive buzzer to GND, `tone()` |
| (spare BTN8) | 23 or 33 | Optional OK/Back buttons |
| Power | 5V/VIN + GND | USB 5V; external 5V 2A brick if LEDs white/full |

I2C (21/22) and SPI defaults are sacrificed for buttons — fine, no sensors need them.

### 5.2 Power & signal

- WS2812B: 5V VCC, ~60 mA/LED full-white → 10 LEDs ≈ 0.6 A. USB (500 mA) is marginal; demo at low brightness (`FastLED.setBrightness(64)`) or use external 5V.
- 1000 µF electrolytic across LED VCC/GND (watch polarity) absorbs inrush.
- 330 Ω on DIN + common GND (ESP32 GND = LED GND = PSU GND).
- ESP32 outputs 3.3V logic; WS2812B expects 5V. Short (<30 cm) wires usually work. Proper fix: 74AHCT125 level shifter if flicker.

### 5.3 Networking

- Both laptop + ESP32 join **phone hotspot** (avoids college client-isolation).
- Laptop firewall: allow Bun on private networks.
- ESP32 uses `WiFi.begin(ssid,pass)` + `WebSocketsClient.begin(host, 3000, "/api/ws")`, heartbeat `ping/pong` every 20 s, auto-reconnect 5 s.
- For demo, print laptop hotspot IP on TV page (`ipconfig` / hotspot settings) so firmware `WS_HOST` is trivial to set.

## 6. Build Phases

| Phase | What | Exit criteria |
|-------|------|---------------|
| 0. Sim (no parts) | Wokwi: ESP32 + 4 buttons + 4 NeoPixels + buzzer, Serial prints JSON | State machine works in sim |
| 1. Buttons | 8 buttons on breadboard, debounce, Serial `{"button":N}` | No double-fires, no boot-loop pins |
| 2. LEDs + buzzer | Strip on GPIO27, `FastLED` patterns: step-green, fail-red, win-rainbow; `tone()` ok/fail | Instant (<50 ms) feedback |
| 3. Wi-Fi + WS | ESP32 client ↔ Bun echo server, send button JSON, receive task JSON | Survives hotspot drop/rejoin |
| 4. Integration | Full loop: TV click → ESP32 sequence → TV progress → fake app opens | End-to-end demo video |
| 5. Polish | Mount on cardboard/perfboard, cable-tie, brightness cap, timeout + cancel | Transport-safe, 5-min live demo |
| 6. (optional) Solder | Perfboard + shifter + cap + headers | Neat final remote |

Work in parallel: one member on `firmware/`, one on `tv-mock/`, agree on §3 protocol first. Mock the other side with stubs (firmware prints to Serial; web has "simulate remote" buttons) so neither blocks.

## 7. Risks & Mitigations

- Hostel Wi-Fi isolation → phone hotspot (tested day 1).
- 3.3V→5V LED glitches → resistor + cap + short wires; shifter backup.
- Button bounce / boot-pin lockup → ezButton/Bounce2 + safe pin list.
- Single USB can't power 10 LEDs white → cap brightness at 25%, external 5V for finals.
- Active vs passive buzzer → order passive; code degrades to single beep if active.
- Charge-only USB cable → test data (Serial appears) before wiring day.

## 8. Testing Checklist

- [ ] Each button → correct index on Serial + correct LED index lights.
- [ ] Wrong press → red + low tone, step doesn't advance.
- [ ] Pull hotspot (phone airplane 10 s) → auto-reconnect + `ready` + task resume.
- [ ] Full task ≤5 s input-to-photon latency perceived instant.
- [ ] TV mirror matches physical LEDs for 20/20 presses.
- [ ] Overnight: 100 tasks, no heap crash (check `ESP.getFreeHeap()` stable).
