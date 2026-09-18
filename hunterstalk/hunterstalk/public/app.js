(() => {
  const $ = (id) => document.getElementById(id);
  const toast = (t) => {
    const el = $("toast");
    el.textContent = t;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  };

  const state = {
    deviceId: localStorage.getItem("hs.device") || crypto.randomUUID(),
    name: localStorage.getItem("hs.name") || "",
    campCode: localStorage.getItem("hs.camp") || "",
    campName: localStorage.getItem("hs.campName") || "The Camp",
    key: null,
    online: navigator.onLine,
    connected: false,
    lastTs: Number(localStorage.getItem("hs.lastTs") || 0),
    members: [],
    es: null,
  };
  localStorage.setItem("hs.device", state.deviceId);

  const dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open("hunterstalk", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("messages")) {
        const s = db.createObjectStore("messages", { keyPath: "id" });
        s.createIndex("camp", "campCode");
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  function tx(store, mode, fn) {
    return dbp.then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      fn(t.objectStore(store));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    }));
  }
  const dbPut = (store, value) => tx(store, "readwrite", (s) => s.put(value));
  const dbDelete = (store, key) => tx(store, "readwrite", (s) => s.delete(key));
  function dbGetAll(store, index, query) {
    return dbp.then((db) => new Promise((res, rej) => {
      const t = db.transaction(store, "readonly");
      const os = t.objectStore(store);
      const req = index ? os.index(index).getAll(query) : os.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    }));
  }

  function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function fromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function deriveKey(code) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", enc.encode(code.toUpperCase()), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("hunterstalk.camp.v1"), iterations: 150000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function encryptText(plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.key, new TextEncoder().encode(plain));
    return { iv: b64(iv), ciphertext: b64(ct) };
  }
  async function decryptText(iv, ciphertext) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, state.key, fromB64(ciphertext));
      return new TextDecoder().decode(pt);
    } catch {
      return "⟦ unable to decrypt — wrong camp key ⟧";
    }
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = "Request failed";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  function showChat() {
    $("gate").classList.add("hidden");
    $("chat").classList.remove("hidden");
    $("camp-title").textContent = state.campName;
    $("camp-meta").textContent = state.campCode;
    renderStatus();
  }
  function showGate() {
    $("chat").classList.add("hidden");
    $("gate").classList.remove("hidden");
    $("display-name").value = state.name;
  }
  function renderStatus() {
    const bar = $("status-bar");
    bar.className = "status " + (state.connected ? "online" : "offline");
    $("status-text").textContent = state.connected
      ? "On the wire"
      : state.online
        ? "Reconnecting…"
        : "Off-grid — messages will queue";
    const live = state.members.filter((m) => m.online).map((m) => m.name);
    $("member-strip").textContent = live.length ? live.join(" · ") : "no one else on the wire";
  }

  function dayLabel(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function timeLabel(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function renderMessage(m) {
    const box = $("messages");
    if (box.querySelector(`[data-id="${m.id}"]`)) return;
    const lastDay = box.dataset.lastDay;
    const day = dayLabel(m.ts);
    if (lastDay !== day) {
      const chip = document.createElement("div");
      chip.className = "day-chip";
      chip.textContent = day;
      box.appendChild(chip);
      box.dataset.lastDay = day;
    }
    const el = document.createElement("article");
    el.className = "bubble" + (m.deviceId === state.deviceId ? " me" : "") + (m.queued ? " queued" : "");
    el.dataset.id = m.id;
    el.innerHTML = `<div class="who"></div><div class="text"></div><div class="meta"></div>`;
    el.querySelector(".who").textContent = m.name || "Hunter";
    el.querySelector(".text").textContent = m.text || "…";
    el.querySelector(".meta").textContent = timeLabel(m.ts);
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  async function loadHistory() {
    $("messages").innerHTML = "";
    $("messages").dataset.lastDay = "";
    const rows = (await dbGetAll("messages", "camp", state.campCode)).sort((a, b) => a.ts - b.ts);
    for (const m of rows) renderMessage(m);
    $("messages").scrollTop = $("messages").scrollHeight;
  }

  async function ingestCipher(msg) {
    if (!msg || !msg.id) return;
    const text = await decryptText(msg.iv, msg.ciphertext);
    const row = {
      id: msg.id,
      campCode: msg.campCode || state.campCode,
      deviceId: msg.deviceId,
      name: msg.name,
      text,
      ts: msg.ts,
    };
    const ghosts = [...document.querySelectorAll(".bubble.me")].filter((el) => {
      return el.dataset.id && el.dataset.id.startsWith("local-") && el.querySelector(".text").textContent === text;
    });
    for (const g of ghosts) g.remove();
    await dbPut("messages", row);
    if (row.ts > state.lastTs) {
      state.lastTs = row.ts;
      localStorage.setItem("hs.lastTs", String(state.lastTs));
    }
    renderMessage(row);
  }

  async function applyJoinPayload(data) {
    if (data.camp && data.camp.name) {
      state.campName = data.camp.name;
      localStorage.setItem("hs.campName", state.campName);
      $("camp-title").textContent = state.campName;
    }
    if (data.presence) state.members = data.presence;
    renderStatus();
    for (const m of data.missed || []) await ingestCipher(m);
  }

  async function joinRemote() {
    const data = await api("/api/join", {
      campCode: state.campCode,
      deviceId: state.deviceId,
      name: state.name,
      since: state.lastTs,
    });
    await applyJoinPayload(data);
  }

  function startPoll() {
    if (state.poll) clearInterval(state.poll);
    const tick = async () => {
      if (!state.campCode || !navigator.onLine) return;
      try {
        const res = await fetch(
          "/api/camps/" + encodeURIComponent(state.campCode) + "/messages?since=" + state.lastTs
        );
        if (!res.ok) throw new Error("poll failed");
        const data = await res.json();
        await applyJoinPayload(data);
        state.connected = true;
        renderStatus();
        await flushOutbox();
      } catch {
        state.connected = false;
        renderStatus();
      }
    };
    tick();
    state.poll = setInterval(tick, 2000);
  }

  async function heartbeat() {
    if (!state.campCode || !navigator.onLine) return;
    try {
      const data = await api("/api/heartbeat", {
        campCode: state.campCode, deviceId: state.deviceId, name: state.name,
      });
      if (data.presence) { state.members = data.presence; renderStatus(); }
    } catch {}
  }

  async function connect() {
    try {
      await joinRemote();
      state.connected = true;
      renderStatus();
      startPoll();
      await flushOutbox();
    } catch (e) {
      state.connected = false;
      renderStatus();
      toast(e.message || "Relay unreachable — working offline");
    }
  }

  async function flushOutbox() {
    const pending = await dbGetAll("outbox");
    for (const item of pending) {
      if (item.campCode !== state.campCode) continue;
      try {
        await api("/api/message", {
          campCode: state.campCode, deviceId: state.deviceId, name: state.name,
          ciphertext: item.ciphertext, iv: item.iv,
        });
        await dbDelete("outbox", item.localId);
        const ghost = document.querySelector('[data-id="' + item.localId + '"]');
        if (ghost) ghost.remove();
      } catch { break; }
    }
  }

  async function sendPlain(text) {
    text = text.trim();
    if (!text || !state.key) return;
    const packed = await encryptText(text);
    const localId = "local-" + crypto.randomUUID();
    const row = {
      id: localId, campCode: state.campCode, deviceId: state.deviceId,
      name: state.name, text: text, ts: Date.now(), queued: !state.connected,
    };
    await dbPut("messages", row);
    renderMessage(row);
    try {
      if (!navigator.onLine) throw new Error("offline");
      await api("/api/message", {
        campCode: state.campCode, deviceId: state.deviceId, name: state.name,
        ciphertext: packed.ciphertext, iv: packed.iv,
      });
    } catch {
      await dbPut("outbox", { localId, campCode: state.campCode, ciphertext: packed.ciphertext, iv: packed.iv, ts: row.ts });
      toast("Queued until you’re back on the wire");
    }
  }

  async function enterCamp(code, name, campName) {
    state.name = name.slice(0, 24);
    state.campCode = code.toUpperCase().trim();
    if (campName) state.campName = campName;
    localStorage.setItem("hs.name", state.name);
    localStorage.setItem("hs.camp", state.campCode);
    localStorage.setItem("hs.campName", state.campName);
    state.key = await deriveKey(state.campCode);
    showChat();
    await loadHistory();
    await connect();
  }

  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("display-name").value.trim();
    const code = $("join-code").value.trim();
    if (!name) return toast("Pick a callsign");
    if (!code) return toast("Enter a camp code");
    await enterCamp(code, name);
  });

  $("btn-create").addEventListener("click", async () => {
    const name = $("display-name").value.trim();
    if (!name) return toast("Pick a callsign first");
    try {
      const res = await fetch("/api/camps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name + "'s camp" }),
      });
      const data = await res.json();
      await enterCamp(data.code, name, data.name);
      toast("Camp lit. Invite is on the header.");
    } catch {
      toast("Could not reach the relay");
    }
  });

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("draft");
    sendPlain(input.value);
    input.value = "";
    if (state.connected) {
      api("/api/typing", { campCode: state.campCode, deviceId: state.deviceId, name: state.name, on: false }).catch(() => {});
    }
  });

  let typingTimer;
  $("draft").addEventListener("input", () => {
    if (!state.connected) return;
    api("/api/typing", { campCode: state.campCode, deviceId: state.deviceId, name: state.name, on: true }).catch(() => {});
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      api("/api/typing", { campCode: state.campCode, deviceId: state.deviceId, name: state.name, on: false }).catch(() => {});
    }, 1200);
  });

  $("btn-invite").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.campCode);
      toast("Camp code copied");
    } catch {
      prompt("Copy camp code", state.campCode);
    }
  });

  $("btn-leave").addEventListener("click", () => {
    if (!confirm("Leave this camp on this device?")) return;
    if (state.es) state.es.close();
    localStorage.removeItem("hs.camp");
    localStorage.removeItem("hs.campName");
    localStorage.removeItem("hs.lastTs");
    state.campCode = "";
    state.key = null;
    state.connected = false;
    showGate();
  });

  $("camp-title").addEventListener("blur", () => {
    const name = $("camp-title").textContent.trim().slice(0, 40) || "The Camp";
    $("camp-title").textContent = name;
    state.campName = name;
    localStorage.setItem("hs.campName", name);
    api("/api/rename", { campCode: state.campCode, name }).catch(() => {});
  });

  window.addEventListener("online", () => {
    state.online = true;
    renderStatus();
    if (state.campCode) connect();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    state.connected = false;
    renderStatus();
  });

  setInterval(heartbeat, 12000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  $("display-name").value = state.name;
  if (state.campCode && state.name) {
    deriveKey(state.campCode).then(async (k) => {
      state.key = k;
      showChat();
      await loadHistory();
      await connect();
    });
  } else {
    showGate();
  }
})();
