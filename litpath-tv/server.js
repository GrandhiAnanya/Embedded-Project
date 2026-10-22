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
    if (wasEmpty) statusToRemote(true);
  } else {
    sendJSON(ws, { event: "tv_status", connected: tvClients.size > 0 });
    statusToTV(true);
  }

  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    const parsed = parseAndLog(raw, ws.role);
    if (parsed === null) return;
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
