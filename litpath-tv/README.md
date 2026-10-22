# LitPath Smart TV

Offline-friendly mock Smart TV for a college accessibility project. The physical ESP32 remote's LEDs guide the user; the TV view deliberately does not tell the user which button to press. Task guidance and the mirrored remote are visible only in Presenter view (toggle with the top-right button or `P`).

## Run it

1. Install Node.js (18+ recommended).
2. Open a terminal in this folder and run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:8080` in Chrome or Edge.
5. Press `P` to open Presenter view. Demo mode is on by default. Choose a task and use keyboard arrows, Enter (OK), Escape/Backspace (BACK), or H (HOME), or click the mirror remote.

Only Node's `ws` package is required. There are no frameworks, build steps, or CDN dependencies.

## Network / laptop IP

At startup, the server prints each non-loopback IPv4 address with `Browser: http://IP:8080` and `ESP32: ws://IP:8080/remote`. Use the laptop IP from the same local network as the ESP32. College Wi-Fi can block device-to-device traffic; a phone hotspot is often easier, with both laptop and ESP32 connected to it. On Windows, allow Node.js on **Private networks** in Windows Defender Firewall if prompted or if the ESP32 cannot connect.

## Test the WebSocket in browser console

Open the site, open Developer Tools → Console and run:

```js
const testSocket = new WebSocket(`ws://${location.host}/remote`);
testSocket.onopen = () => testSocket.send(JSON.stringify({ action: "right" }));
testSocket.onmessage = e => console.log("server message:", e.data);
```

The test client connects as a remote and sends a RIGHT action. It also receives the task list on connection. Stop the server with Ctrl+C.

## Tasks

`tasks.json` is the single source of truth for task paths. The browser loads it from `/tasks.json`, and the server sends its contents to each remote on connection. Change this file to change task steps without reflashing the ESP32. Restart the server after editing for consistency.

## ESP32 message contract (exact message types)

### ESP32 sends to `/remote`

- `{"action":"home"}`
- `{"action":"up"}`
- `{"action":"down"}`
- `{"action":"left"}`
- `{"action":"right"}`
- `{"action":"ok"}`
- `{"action":"back"}`
- `{"event":"menu","selected":0}`
- `{"event":"task_start","task":"OPEN_YOUTUBE"}`
- `{"event":"led","button":"right"}` (use `"none"` for no LED)
- `{"event":"preview","button":"home"}`
- `{"event":"wrong","pressed":"down","expected":"right"}`
- `{"event":"task_complete","task":"OPEN_YOUTUBE"}`
- `{"event":"hint","level":1}` (levels 1–3)

### ESP32 receives from `/remote`

- `{"event":"tasks","tasks":[...]}` (sent immediately on connection, loaded from `tasks.json`)
- `{"event":"mode","guided":false}` (or `true`; unguided mode can turn LEDs off)
- `{"action":"home"}`, `{"action":"up"}`, `{"action":"down"}`, `{"action":"left"}`, `{"action":"right"}`, `{"action":"ok"}`, `{"action":"back"}` (optional actions forwarded from the browser)

The server forwards valid JSON messages unchanged in both directions, logs messages, ignores malformed JSON, and pings WebSocket clients every 15 seconds. The browser reconnects every two seconds after a disconnect.
