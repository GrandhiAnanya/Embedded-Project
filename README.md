# Smart Remote + Mock Smart-TV Demo (ESP32)

ESP32-based smart remote with tactile buttons, WS2812B LED feedback, and buzzer audio, paired with a mock Smart-TV website that demos the remote over Wi-Fi WebSockets.

**Demo loop:**
1. TV website (laptop) shows a task, e.g. `OPEN_YOUTUBE`, plus an expected button sequence.
2. Task is sent to ESP32: `laptop → ESP32`.
3. User presses physical buttons on the remote.
4. ESP32 validates locally, drives LEDs + buzzer, and reports progress: `ESP32 → laptop`.
5. TV UI reflects progress / success / fail in real time.

> Design rule: **ESP32 owns the sequence and LEDs. Laptop just reflects actions.** This keeps feedback instant even if Wi-Fi lags.

---

## 1. Required Components

### Hardware (core kit ~₹1,200–2,000 in India)

| Item | Qty | Notes | Approx. ₹ |
|------|-----|-------|-----------|
| ESP32 DevKit V1 (30-pin) | 1 (2 is safer) | CP2102 or CH340 USB chip | 450–600 each |
| Push buttons 12mm with caps + icons | 10–12 | 9 needed (Power, YouTube, Netflix, Back, Home, Vol-, Vol+, Up, Down) + spares | 50–100 |
| WS2812B LEDs (5mm individual / breakout) | 10 | 9 needed, 1 per button glued above button. Cut strip pieces also work | 150–300 |
| Passive buzzer | 1–2 | Passive = different tones for correct/wrong. Active = one pitch only | 20–40 |
| Breadboard (full size, 830 pt) | 1–2 | Half-size is too cramped | 100–150 |
| Jumper wires (M-M, M-F, F-F pack) | 1 set each | — | 150 |
| 330–470 Ω resistor, 1000 µF 6.3V+ capacitor | 1 each (buy assortment) | LED data + power protection | 50 |
| Micro-USB or USB-C data cable | 1 | Must be **data**, not charge-only | 100 |
| Optional: 74AHCT125 level shifter | 1 | Only if LEDs flicker/misbehave | 50 |
| Enclosure: remote case + top panel (acrylic/3D-print/wood) | 1 | Drill 9× 12mm button holes + 9× 5mm LED holes (see ARCHITECTURE §5.4) | 150–300 |
| Hot glue / M3 standoffs | 1 set | Glue each NeoPixel above its button, fix ESP32 perfboard inside | 50 |
| Optional: perfboard, soldering iron, solder | — | For final neat version (ESP32 mounted at bottom of case) | 400+ |

Buy from: Robu.in, Robocraze, ThinkRobotics, Sunrom, Amazon India. In Bengaluru: SP Road shops for same-day.

### Software (all free)

- Arduino IDE 2.x **or** PlatformIO in VS Code (recommended for team)
- Bun (latest, for mock TV website + WebSocket server)
- VS Code + Chrome/Edge
- ESP32 board package (Espressif)

### Libraries / Packages

ESP32 (Arduino):
- `FastLED` **or** `Adafruit NeoPixel` (pick one, don't mix)
- `WebSockets` by Markus Sattler (`Links2004/arduinoWebSockets`) — use `WebSocketsClient` examples (ESP32 is client)
- `ArduinoJson` (v6/v7)
- `ezButton` or `Bounce2` (debounce, easier than hand-rolled)

Laptop / TV mock:
- `bun` runtime (replaces Node for this project)
- Next.js 15 + React + TypeScript + Tailwind (see `ARCHITECTURE.md` for why)
- WebSocket: Bun native `Bun.serve({ websocket })` — no `ws` npm package needed. If you fall back to Node, `npm install ws`.

---

## 2. Wiring Summary

```
Phone Hotspot ─┬─ Laptop (Bun :3000 HTTP + :81 WS)
               └─ ESP32 (WebSocket client)

ESP32 3.3V ── buttons ── GND (use INPUT_PULLUP, active LOW)
ESP32 GPIO27 ──[330Ω]── WS2812B DIN, WS2812B VCC → 5V, GND → GND
                         + 1000µF cap across VCC/GND (mind polarity)
ESP32 GPIO25 ── passive buzzer ── GND (use tone()/ledc)
ESP32 5V/VIN ← USB 5V (power LEDs from separate 5V 2A if >10 LEDs full-white)
```

Safe button pins (avoid boot-strapping `0, 2, 12, 15`): `13, 14, 16, 17, 18, 19, 21, 22, 23, 25*, 26, 27*, 32, 33` (*don't double-use if used for LED/buzzer).

Final product layout (9 buttons, 1 NeoPixel glued above each — LED index = button index):

| ID | Icon | Task example | GPIO (suggested) | LED |
|----|------|--------------|------------------|-----|
| 0 | Power | `POWER_TOGGLE` | 13 | LED0 red |
| 1 | YouTube | `OPEN_YOUTUBE` | 14 | LED1 red |
| 2 | Netflix | `OPEN_NETFLIX` | 16 | LED2 purple |
| 3 | Back ← | `GO_BACK` | 17 | LED3 blue |
| 4 | Home ⌂ | `GO_HOME` | 18 | LED4 cyan |
| 5 | Vol- | `VOL_DOWN` | 19 | LED5 green |
| 6 | Vol+ | `VOL_UP` | 21 | LED6 yellow |
| 7 | Up ∧ | `NAV_UP` | 22 | LED7 white |
| 8 | Down ∨ | `NAV_DOWN` | 23 | LED8 white |

Suggested default (see `ARCHITECTURE.md` § Pin Map):
`BTN0-8 → 13, 14, 16, 17, 18, 19, 21, 22, 23` + `LED_CHAIN (all 9) → 27`, `BUZZER → 25`.
Wire LEDs as one WS2812B daisy-chain snaked button-to-button, in ID order.

> WS2812B wants 5V data, ESP32 gives 3.3V. At short wires it usually works. If flicker: add 74AHCT125 level shifter.

---

## 3. Repo Structure (to create)

```
/
├── README.md
├── ARCHITECTURE.md
├── firmware/               # PlatformIO project (ESP32)
│   ├── platformio.ini
│   └── src/main.cpp        # buttons, LEDs, buzzer, WS client, state machine
├── tv-mock/                # Bun + Next.js mock Smart-TV
│   ├── package.json
│   ├── app/page.tsx        # TV home screen
│   └── server/ws.ts        # Bun WebSocket hub (or Route Handler)
├── docs/
│   ├── product.png         # product look / mounting reference
│   └── wiring.png
```

---

## 4. Quickstart

### A. Firmware (no hardware? use Wokwi first)

1. Open `firmware/` in PlatformIO, install libs above.
2. Set `WIFI_SSID`, `WIFI_PASS` to your **phone hotspot**, `WS_HOST` to laptop hotspot IP.
3. Flash, open Serial @115200. You should see `WiFi OK → WS connected`.
4. Press buttons → Serial shows JSON + LEDs step + buzzer beeps.

### B. TV mock (Bun + Next.js)

```bash
cd tv-mock
bun install
bun run dev        # http://localhost:3000
# ESP32 connects to ws://<laptop-hotspot-ip>:3000/api/ws
```

Open TV UI on laptop, click a task (e.g. YouTube) → ESP32 receives `{"task":"OPEN_YOUTUBE"}` → do the sequence on the remote → TV shows progress.

### C. Wi-Fi gotcha

College/hostel Wi-Fi usually has **client isolation** (devices can't talk to each other). **Use phone hotspot for both laptop + ESP32.** Allow Bun/Node through Windows firewall when prompted.

---

## 5. WebSocket Protocol (summary)

```jsonc
// laptop → ESP32 (task chosen on TV)
{ "task": "OPEN_YOUTUBE", "sequence": [2, 5, 1, 4] }

// ESP32 → laptop
{ "event": "ready" }
{ "event": "step_ok", "step": 1, "button": 2 }
{ "event": "step_fail", "expected": 5, "got": 3 }
{ "event": "task_complete", "task": "OPEN_YOUTUBE" }
```

Full spec + state machine: see `ARCHITECTURE.md`.

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| ESP32 won't connect to WS | Check hotspot IP, same hotspot for both, firewall allow, `ws://` not `wss://` on LAN |
| LEDs flicker / wrong colors | Add 330Ω on DIN, 1000µF on 5V, shorten wires, add 74AHCT125, external 5V supply |
| Buttons double-trigger | Use ezButton/Bounce2, 30–50 ms debounce, `INPUT_PULLUP` |
| ESP32 boot loops when button pressed | You used pin 0/2/12/15 — move to safe pins |
| Buzzer one pitch only | You bought active buzzer — get passive for `tone()` melodies |

---

## 7. Learning Resources (search titles for current URLs)

- Random Nerd Tutorials: ESP32 pinout, Digital Inputs/Outputs, ESP32 WebSocket Server (+ `WebSocketsClient` examples)
- DroneBot Workshop (YT): ESP32 intro, NeoPixel/FastLED
- Andreas Spiess (YT): ESP32 power + pin gotchas
- Arduino docs: Debounce example; also ezButton / Bounce2
- Adafruit NeoPixel Überguide (power + best practices); FastLED wiki (`Blink`, `FirstLight`)
- `ws` npm README; MDN: WebSockets API, Writing WebSocket client applications
- Traversy Media / freeCodeCamp: Node.js + JavaScript crash courses
- Search: "Arduino finite state machine tutorial", "Arduino sequence array step tracking"
- Wokwi (wokwi.com): simulate ESP32 + buttons + NeoPixels + buzzer before parts arrive
