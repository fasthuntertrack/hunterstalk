/**
 * Cloudflare Pages Function — HunterStalk API
 * Bind a KV namespace as STORE in the Pages dashboard.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function needStore(env) {
  if (!env.STORE) {
    return json(
      {
        error:
          "KV is not bound. In Pages → Settings → Bindings, add KV namespace with variable name STORE, then Redeploy.",
      },
      500
    );
  }
  return null;
}

function makeCampCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let i = 0; i < 6; i++) raw += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `HS-${raw.slice(0, 3)}-${raw.slice(3)}`;
}

function validCode(code) {
  return /^HS-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(String(code || ""));
}

async function getCamp(env, code) {
  const raw = await env.STORE.get(`camp:${code}`);
  return raw ? JSON.parse(raw) : null;
}

async function putCamp(env, camp) {
  await env.STORE.put(`camp:${camp.code}`, JSON.stringify(camp));
}

async function getMsgs(env, code) {
  const raw = await env.STORE.get(`msgs:${code}`);
  return raw ? JSON.parse(raw) : [];
}

async function putMsgs(env, code, msgs) {
  await env.STORE.put(`msgs:${code}`, JSON.stringify(msgs));
}

function presenceOf(camp) {
  const now = Date.now();
  return Object.entries(camp.members || {}).map(([deviceId, info]) => ({
    deviceId,
    name: info.name,
    lastSeen: info.lastSeen,
    online: now - info.lastSeen < 25000,
  }));
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const parts = (params.route || []).map((p) => decodeURIComponent(p));
  const path = parts.join("/");

  const missing = needStore(env);
  if (missing && path !== "health") return missing;

  if (path === "health" && request.method === "GET") {
    return json({ ok: true, name: "HunterStalk", version: "0.1.0", host: "pages", kv: !!env.STORE });
  }

  if (path === "camps" && request.method === "POST") {
    const body = await readJson(request);
    const name = String(body.name || "The Camp").slice(0, 40);
    const code = makeCampCode();
    const camp = { code, name, createdAt: Date.now(), members: {} };
    await putCamp(env, camp);
    await putMsgs(env, code, []);
    return json({ code, name });
  }

  if (parts[0] === "camps" && parts[1] && parts[2] === "messages" && request.method === "GET") {
    const code = parts[1].toUpperCase();
    const camp = await getCamp(env, code);
    if (!camp) return json({ error: "Camp not found" }, 404);
    const since = Number(url.searchParams.get("since") || 0);
    const missed = (await getMsgs(env, code)).filter((m) => m.ts > since);
    return json({ camp: { code: camp.code, name: camp.name }, missed, presence: presenceOf(camp) });
  }

  if (parts[0] === "camps" && parts[1] && request.method === "GET") {
    const code = parts[1].toUpperCase();
    const camp = await getCamp(env, code);
    if (!camp) return json({ error: "Camp not found" }, 404);
    return json({
      code: camp.code,
      name: camp.name,
      memberCount: Object.keys(camp.members || {}).length,
      createdAt: camp.createdAt,
    });
  }

  if (path === "join" && request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.campCode || "").toUpperCase().trim();
    if (!validCode(code)) return json({ error: "Bad camp code" }, 400);
    let camp = await getCamp(env, code);
    if (!camp) {
      camp = { code, name: "The Camp", createdAt: Date.now(), members: {} };
    }
    const deviceId = String(body.deviceId || "").slice(0, 64);
    const name = String(body.name || "Hunter").slice(0, 24);
    if (!deviceId) return json({ error: "Missing device" }, 400);
    camp.members = camp.members || {};
    camp.members[deviceId] = { name, lastSeen: Date.now() };
    await putCamp(env, camp);
    const since = Number(body.since || 0);
    const missed = (await getMsgs(env, code)).filter((m) => m.ts > since);
    return json({ camp: { code: camp.code, name: camp.name }, missed, presence: presenceOf(camp) });
  }

  if (path === "rename" && request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.campCode || "").toUpperCase();
    const camp = await getCamp(env, code);
    if (!camp) return json({ error: "Camp not found" }, 404);
    camp.name = String(body.name || "The Camp").slice(0, 40);
    await putCamp(env, camp);
    return json({ name: camp.name });
  }

  if (path === "message" && request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.campCode || "").toUpperCase();
    const camp = await getCamp(env, code);
    if (!camp) return json({ error: "Camp not found" }, 404);
    const msg = {
      id: crypto.randomUUID(),
      campCode: code,
      deviceId: String(body.deviceId || "").slice(0, 64),
      name: String(body.name || "Hunter").slice(0, 24),
      ciphertext: String(body.ciphertext || "").slice(0, 20000),
      iv: String(body.iv || ""),
      ts: Date.now(),
    };
    if (!msg.ciphertext || !msg.iv) return json({ error: "Empty payload" }, 400);
    const msgs = await getMsgs(env, code);
    msgs.push(msg);
    await putMsgs(env, code, msgs.slice(-2000));
    return json({ id: msg.id, ts: msg.ts });
  }

  if (path === "typing" && request.method === "POST") {
    return json({ ok: true });
  }

  if (path === "heartbeat" && request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.campCode || "").toUpperCase();
    const deviceId = String(body.deviceId || "");
    const name = String(body.name || "Hunter").slice(0, 24);
    const camp = await getCamp(env, code);
    if (camp && deviceId) {
      camp.members = camp.members || {};
      camp.members[deviceId] = { name, lastSeen: Date.now() };
      await putCamp(env, camp);
      return json({ ok: true, presence: presenceOf(camp) });
    }
    return json({ ok: true, presence: [] });
  }

  if (path === "stream") {
    return json({ error: "Use polling on Pages" }, 404);
  }

  return json({ error: "Not found" }, 404);
}
