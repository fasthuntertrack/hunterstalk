/**
 * HunterStalk relay — Node stdlib only.
 * Stores ciphertext. Fan-out via Server-Sent Events.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3847;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return { camps: {}, messages: {} };
  }
}
let store = loadStore();
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store));
  }, 200);
}

function uuid() {
  return crypto.randomUUID();
}
function makeCampCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let i = 0; i < 6; i++) raw += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `HS-${raw.slice(0, 3)}-${raw.slice(3)}`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 1_000_000) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function ensureCamp(code) {
  code = String(code || "").toUpperCase().trim();
  if (!/^HS-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) return null;
  if (!store.camps[code]) {
    store.camps[code] = { code, name: "The Camp", createdAt: Date.now(), members: {} };
    store.messages[code] = [];
    scheduleSave();
  }
  return store.camps[code];
}

// campCode -> Set of SSE responses
const subscribers = new Map();
// campCode -> Map(deviceId -> { name, lastSeen, online })
const presence = new Map();

function getPresence(code) {
  const map = presence.get(code);
  if (!map) return [];
  const now = Date.now();
  const out = [];
  for (const [deviceId, info] of map.entries()) {
    const online = now - info.lastSeen < 25000;
    out.push({ deviceId, name: info.name, online, lastSeen: info.lastSeen });
  }
  return out;
}

function broadcast(code, event, data) {
  const set = subscribers.get(code);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(urlPath)));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && p === "/api/health") {
      return sendJson(res, 200, { ok: true, name: "HunterStalk", version: "0.1.0" });
    }

    if (req.method === "POST" && p === "/api/camps") {
      const body = await readBody(req);
      const name = String(body.name || "The Camp").slice(0, 40);
      const code = makeCampCode();
      store.camps[code] = { code, name, createdAt: Date.now(), members: {} };
      store.messages[code] = [];
      scheduleSave();
      return sendJson(res, 200, { code, name });
    }

    if (req.method === "GET" && p.startsWith("/api/camps/") && p.endsWith("/messages")) {
      const code = decodeURIComponent(p.split("/")[3] || "").toUpperCase();
      const camp = store.camps[code];
      if (!camp) return sendJson(res, 404, { error: "Camp not found" });
      const since = Number(url.searchParams.get("since") || 0);
      const missed = (store.messages[code] || []).filter((m) => m.ts > since);
      return sendJson(res, 200, { camp: { code: camp.code, name: camp.name }, missed, presence: getPresence(code) });
    }

    if (req.method === "GET" && p.startsWith("/api/camps/") && !p.includes("/stream")) {
      const code = decodeURIComponent(p.slice("/api/camps/".length)).toUpperCase();
      const camp = store.camps[code];
      if (!camp) return sendJson(res, 404, { error: "Camp not found" });
      return sendJson(res, 200, {
        code: camp.code,
        name: camp.name,
        memberCount: Object.keys(camp.members).length,
        createdAt: camp.createdAt,
      });
    }

    if (req.method === "POST" && p === "/api/join") {
      const body = await readBody(req);
      const camp = ensureCamp(body.campCode);
      if (!camp) return sendJson(res, 400, { error: "Bad camp code" });
      const deviceId = String(body.deviceId || "").slice(0, 64);
      const name = String(body.name || "Hunter").slice(0, 24);
      if (!deviceId) return sendJson(res, 400, { error: "Missing device" });
      camp.members[deviceId] = { name, lastSeen: Date.now() };
      if (!presence.has(camp.code)) presence.set(camp.code, new Map());
      presence.get(camp.code).set(deviceId, { name, lastSeen: Date.now() });
      scheduleSave();
      broadcast(camp.code, "presence", getPresence(camp.code));
      const since = Number(body.since || 0);
      return sendJson(res, 200, {
        camp: { code: camp.code, name: camp.name },
        missed: (store.messages[camp.code] || []).filter((m) => m.ts > since),
        presence: getPresence(camp.code),
      });
    }

    if (req.method === "POST" && p === "/api/rename") {
      const body = await readBody(req);
      const camp = store.camps[String(body.campCode || "").toUpperCase()];
      if (!camp) return sendJson(res, 404, { error: "Camp not found" });
      camp.name = String(body.name || "The Camp").slice(0, 40);
      scheduleSave();
      broadcast(camp.code, "camp", { name: camp.name });
      return sendJson(res, 200, { name: camp.name });
    }

    if (req.method === "POST" && p === "/api/message") {
      const body = await readBody(req);
      const camp = store.camps[String(body.campCode || "").toUpperCase()];
      if (!camp) return sendJson(res, 404, { error: "Camp not found" });
      const msg = {
        id: uuid(),
        campCode: camp.code,
        deviceId: String(body.deviceId || "").slice(0, 64),
        name: String(body.name || "Hunter").slice(0, 24),
        ciphertext: String(body.ciphertext || "").slice(0, 20000),
        iv: String(body.iv || ""),
        ts: Date.now(),
      };
      if (!msg.ciphertext || !msg.iv) return sendJson(res, 400, { error: "Empty payload" });
      store.messages[camp.code] = store.messages[camp.code] || [];
      store.messages[camp.code].push(msg);
      if (store.messages[camp.code].length > 2000) {
        store.messages[camp.code] = store.messages[camp.code].slice(-2000);
      }
      scheduleSave();
      broadcast(camp.code, "message", msg);
      return sendJson(res, 200, { id: msg.id, ts: msg.ts });
    }

    if (req.method === "POST" && p === "/api/typing") {
      const body = await readBody(req);
      const code = String(body.campCode || "").toUpperCase();
      if (!store.camps[code]) return sendJson(res, 404, { error: "Camp not found" });
      broadcast(code, "typing", {
        deviceId: body.deviceId,
        name: body.name,
        on: !!body.on,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/heartbeat") {
      const body = await readBody(req);
      const code = String(body.campCode || "").toUpperCase();
      const deviceId = String(body.deviceId || "");
      const name = String(body.name || "Hunter").slice(0, 24);
      if (store.camps[code] && deviceId) {
        if (!presence.has(code)) presence.set(code, new Map());
        presence.get(code).set(deviceId, { name, lastSeen: Date.now() });
        store.camps[code].members[deviceId] = { name, lastSeen: Date.now() };
        scheduleSave();
        broadcast(code, "presence", getPresence(code));
      }
      return sendJson(res, 200, { ok: true, presence: getPresence(code) });
    }

    if (req.method === "GET" && p === "/api/stream") {
      const code = String(url.searchParams.get("camp") || "").toUpperCase();
      if (!store.camps[code]) {
        res.writeHead(404);
        return res.end("unknown camp");
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      if (!subscribers.has(code)) subscribers.set(code, new Set());
      subscribers.get(code).add(res);
      const ping = setInterval(() => {
        try {
          res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      req.on("close", () => {
        clearInterval(ping);
        subscribers.get(code)?.delete(res);
      });
      return;
    }

    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    serveStatic(req, res, p);
  } catch (err) {
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HunterStalk running at http://localhost:${PORT}`);
});
