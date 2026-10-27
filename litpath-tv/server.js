// LitPath Smart TV: one HTTP server and two WebSocket endpoints.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const TASKS_PATH = path.join(__dirname, "tasks.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const remoteClients = new Set();
const tvClients = new Set();


// Real laptop control (Windows only). Set REAL_CONTROL=0 to turn it off.
// Each kind runs at most one PowerShell at a time; if more requests arrive meanwhile, only the newest one runs next.
const { execFile } = require("child_process");
const REAL_CONTROL = process.platform === "win32" && process.env.REAL_CONTROL !== "0";
let realBrightness = null;
const psJobs = {};
function runPS(kind, script, done) {
  if (!REAL_CONTROL) return;
  const job = psJobs[kind] || (psJobs[kind] = { busy: false, next: null });
  if (job.busy) { job.next = script; return; }
  job.busy = true;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }, (err, stdout) => {
    if (err) console.warn(`${kind} control failed: ${err.message.split("\n")[0]}`);
    else if (done) done(stdout);
    job.busy = false;
    if (job.next) { const next = job.next; job.next = null; runPS(kind, next); }
  });
}
function setBrightness(level) {
  const v = Math.round(Math.min(100, Math.max(0, Number(level) || 0)));
  realBrightness = v;
  // Works on the laptop's built-in screen only, not external monitors/projectors.
  runPS("brightness", `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${v})`);
}
function setVolume(level) {
  // Windows has no built-in command to set an exact volume, so press Volume Down 50 times (to 0%)
  // and then Volume Up 5 times per level (each press = 2%).
  const v = Math.round(Math.min(10, Math.max(0, Number(level) || 0)));
  runPS("volume", `$w=New-Object -ComObject WScript.Shell; 1..50|%{$w.SendKeys([char]174)}; if(${v}){1..${v * 5}|%{$w.SendKeys([char]175)}}`);
}
function readBrightness() {
  runPS("brightness", "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness", out => {
    const v = parseInt(out, 10);
    if (!Number.isNaN(v)) realBrightness = v;
  });
}


const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  // tasks.json lives beside server.js (shared with the ESP32), not inside /public.
  if (pathname === "/tasks.json") {
    fs.readFile(TASKS_PATH, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Could not read tasks.json");
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(data);
    });
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, "." + requested);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(err.code === "ENOENT" ? "Not found" : "Server error");
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname !== "/remote" && pathname !== "/tv") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.role = pathname === "/remote" ? "remote" : "tv";
    wss.emit("connection", ws, req);
  });
});

function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(set, payload) {
  for (const client of set) sendJSON(client, payload);
}
function statusToTV(connected) {
  broadcast(tvClients, { event: "remote_status", connected });
}
function statusToRemote(connected) {
  broadcast(remoteClients, { event: "tv_status", connected });
}
function parseAndLog(raw, role) {
  const text = raw.toString();
  console.log(`[${new Date().toISOString()}] ${role} -> ${text}`);
  try { return JSON.parse(text); }
  catch { console.warn(`Ignored malformed JSON from ${role}`); return null; }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  const set = ws.role === "remote" ? remoteClients : tvClients;
  const other = ws.role === "remote" ? tvClients : remoteClients;
  const wasEmpty = set.size === 0;
  set.add(ws);
  console.log(`${ws.role} connected (${set.size} connected on this endpoint)`);
  if (ws.role === "remote") { try { sendJSON(ws, { event: "tasks", tasks: JSON.parse(fs.readFileSync(TASKS_PATH, "utf8")) }); } catch (err) { console.warn("Could not load tasks.json:", err.message); sendJSON(ws, { event: "tasks", tasks: [] }); } }

  // Inform the newly connected side and the other side about current status.
  if (ws.role === "tv") {
    sendJSON(ws, { event: "remote_status", connected: remoteClients.size > 0 });
    sendJSON(ws, { event: "sys_state", real: REAL_CONTROL, brightness: realBrightness });
    if (wasEmpty) statusToRemote(true);
  } else {
    sendJSON(ws, { event: "tv_status", connected: tvClients.size > 0 });
    statusToTV(true);
  }

  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    const parsed = parseAndLog(raw, ws.role);
    if (parsed === null) return;
    // {event:"sys"} from the TV controls the laptop itself and is not relayed.
    if (ws.role === "tv" && parsed.event === "sys") {
      if (parsed.brightness !== undefined) setBrightness(parsed.brightness);
      if (parsed.volume !== undefined) setVolume(parsed.volume);
      return;
    }
    // Relay the original payload unchanged; JSON parsing is only for validation.
    const destination = ws.role === "remote" ? tvClients : remoteClients;
    for (const client of destination) {
      if (client.readyState === WebSocket.OPEN) client.send(raw.toString());
    }
  });
  ws.on("close", () => {
    set.delete(ws);
    console.log(`${ws.role} disconnected (${set.size} connected on this endpoint)`);
    if (set.size === 0) {
      if (ws.role === "remote") statusToTV(false);
      else statusToRemote(false);
    }
    // Other side receives its matching connection status event.
    if (ws.role === "remote") statusToRemote(false);
    else statusToTV(false);
  });
  ws.on("error", err => console.warn(`${ws.role} WebSocket error: ${err.message}`));
});

// Ping/pong heartbeat; clients that fail to answer are terminated.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, 15000);
wss.on("close", () => clearInterval(heartbeat));
server.on("close", () => clearInterval(heartbeat));

server.listen(PORT, "0.0.0.0", () => {
  console.log("\nLitPath Smart TV server is running.");
  
  console.log(REAL_CONTROL ? "Real laptop brightness/volume control: ON" : "Real laptop control: OFF");
  readBrightness();

  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push({ name, address: entry.address });
    }
  }
  console.log("\nOpen one of these browser URLs on this laptop:");
  console.log(`  http://localhost:${PORT}`);
  for (const item of addresses) {
    console.log(`  http://${item.address}:${PORT}  (${item.name})`);
    console.log(`  ESP32 WebSocket: ws://${item.address}:${PORT}/remote`);
  }
  if (!addresses.length) console.log("  No non-loopback IPv4 address found. Check Wi-Fi/hotspot connection.");
  console.log("\nPress Ctrl+C to stop.\n");
});
