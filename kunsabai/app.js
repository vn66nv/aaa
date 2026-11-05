(() => {
  const C = window.KUNSABAI;
  // ---------- язык ----------
  const LANGS = ["ru", "en", "th"];
  let lang = (() => { try { const s = localStorage.getItem("kunsabai.lang"); if (LANGS.includes(s)) return s; } catch {} const n = (navigator.language || "ru").slice(0, 2); return LANGS.includes(n) ? n : "ru"; })();
  const t = (k, ...v) => (I18N[lang][k] ?? I18N.ru[k] ?? k).replace(/\{(\d)\}/g, (_, i) => v[i]);
  const TYPES = {
    dps:  { label: () => t("t_dps"), text: () => t("f_dps"), cls: "dps" },
    warn: { label: () => t("t_warn"), text: () => "!", cls: "warn" }
  };
  const THAILAND = L.latLngBounds([5.4, 97.2], [20.6, 105.8]);
  const $ = s => document.querySelector(s);
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);

  // ---------- профиль ----------
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let guest = store.get("kunsabai.guest"); if (!guest) { guest = String(10000 + Math.floor(Math.random() * 90000)); store.set("kunsabai.guest", guest); }
  let nick = store.get("kunsabai.nick") || "";
  const author = () => nick || t("guest") + " " + guest.replace(/\D/g, "");
  const mine = new Set(JSON.parse(store.get("kunsabai.mine") || "[]"));
  const addMine = id => { mine.add(id); store.set("kunsabai.mine", JSON.stringify([...mine].slice(-200))); };

  // ---------- сессия Supabase (анонимная → вход по e-mail коду) ----------
  const SK = "kunsabai.session";
  let session = (() => { try { return JSON.parse(store.get(SK) || "null"); } catch { return null; } })();
  const saveSession = s => { session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user } : null; store.set(SK, JSON.stringify(session)); };
  const isAnon = () => !session || session.user?.is_anonymous !== false;
  async function authFetch(path, body) {
    const r = await fetch(`${C.SUPABASE_URL}/auth/v1/${path}`, { method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "auth " + r.status);
    return j;
  }
  let sessionP = null;   // один запрос на всех: иначе при запуске создавалось бы два гостя
  function ensureSession() {
    if (!live || (session && session.expires_at - 60 > Date.now() / 1000)) return Promise.resolve();
    return sessionP ||= (async () => {
      if (session?.refresh_token) { try { return saveSession(await authFetch("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); } catch {} }
      saveSession(await authFetch("signup", {}));   // анонимный пользователь
    })().finally(() => { sessionP = null; });
  }
  // publishable-ключ (sb_publishable_…) — не JWT: в Authorization идёт только токен пользователя
  const headers = async () => { await ensureSession(); const h = { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" }; if (session?.access_token) h.Authorization = "Bearer " + session.access_token; return h; };
  async function rest(path, opt = {}) {
    const r = await fetch(`${C.SUPABASE_URL}/rest/v1/${path}`, { ...opt, headers: { ...(await headers()), ...(opt.headers || {}) } });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message || "rest " + r.status);
    return j;
  }

  // ---------- хранилище ----------
  const LS = "kunsabai.marks";
  const local = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
  const saveLocal = a => store.set(LS, JSON.stringify(a));

  const api = {
    async list() {
      const since = new Date(Date.now() - C.HIDE_AFTER_HOURS * 3600e3).toISOString();
      if (!live) return local().filter(m => m.last_seen_at > since);
      const a = await rest(`marks?select=*&last_seen_at=gt.${since}&order=created_at.desc&limit=1000`);
      try { store.set("kunsabai.cache", JSON.stringify(a)); } catch {}
      return a;
    },
    async add(m) {
      if (!live) { const a = local(); const now = new Date().toISOString(); m = { ...m, author: author(), confirms: 0, denies: 0, id: crypto.randomUUID(), created_at: now, last_seen_at: now }; a.push(m); saveLocal(a); return m; }
      return (await rest("marks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(m) }))[0];
    },
    async remove(id) {
      if (!live) { saveLocal(local().filter(x => x.id !== id)); return; }
      if (!(await rest("rpc/delete_mark", { method: "POST", body: JSON.stringify({ mark_id: id }) }))) throw new Error(t("onlyOwn"));
    },
    async vote(id, yes) {
      if (!live) {
        const a = local(), m = a.find(x => x.id === id); if (!m) return; const now = new Date().toISOString();
        if (yes) { m.confirms++; m.last_confirm_by = author(); m.last_confirm_at = now; m.last_seen_at = now; } else { m.denies++; m.last_deny_by = author(); m.last_deny_at = now; }
        saveLocal(a); return "ok";
      }
      return rest("rpc/vote_mark", { method: "POST", body: JSON.stringify({ mark_id: id, is_yes: yes }) });
    },
    // вход: шаг 1 — код на почту, шаг 2 — проверка кода и имя
    // гость превращается в постоянный аккаунт (метки остаются его); если почта уже занята — обычный вход
    async sendCode(email) {
      this.otpType = "email";
      if (session && isAnon()) {
        const r = await fetch(`${C.SUPABASE_URL}/auth/v1/user`, { method: "PUT", headers: await headers(), body: JSON.stringify({ email }) });
        if (r.ok) { this.otpType = "email_change"; return; }
      }
      await authFetch("otp", { email, create_user: true });
    },
    async verify(email, token, name) {
      saveSession(await authFetch("verify", { type: this.otpType || "email", email, token }));
      const uid = session.user.id;
      await rest("profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: uid, name }) }).catch(async () => {
        await rest(`profiles?id=eq.${uid}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name }) });
      });
    }
  };

  // ---------- живое обновление (Supabase Realtime, протокол Phoenix) ----------
  function realtime(onChange) {
    if (!live || !("WebSocket" in window)) return;
    let ws, hb, ref = 0;
    const connect = async () => {
      try { await ensureSession(); } catch {}
      ws = new WebSocket(`${C.SUPABASE_URL.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${C.SUPABASE_ANON_KEY}&vsn=1.0.0`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ topic: "realtime:kunsabai", event: "phx_join", ref: String(++ref), payload: { config: { postgres_changes: [{ event: "*", schema: "public", table: "marks" }] }, access_token: session?.access_token } }));
        hb = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) })), 25000);
      };
      ws.onmessage = e => { try { if (JSON.parse(e.data).event === "postgres_changes") onChange(); } catch {} };
      ws.onclose = () => { clearInterval(hb); setTimeout(connect, 5000); };
    };
    connect();
  }

  // ---------- карта ----------
  const map = L.map("map", { zoomControl: false, maxBounds: THAILAND.pad(0.3), minZoom: 5, attributionControl: true }).fitBounds(THAILAND);
  // тайлы: OpenStreetMap, при сбоях — запасной бесплатный источник CARTO
  let tileErr = 0;
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  osm.on("tileerror", () => {
    if (++tileErr !== 4) return;
    map.removeLayer(osm);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }).addTo(map);
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let marks = [], active = new Set(Object.keys(TYPES)), me = null, meMarker = null, picked = null;

  const toast = (t, ms = 2500) => { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = iso => { const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000)); if (m < 1) return t("justNow"); const h = Math.floor(m / 60); return (h ? h + " " + t("h") + " " : "") + (m % 60 || !h ? (m % 60) + " " + t("min") + " " : "") + t("ago"); };
  const when = iso => new Date(iso).toLocaleString(t("locale"), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const seenAt = m => m.last_confirm_at || m.created_at;
  const isOld = m => (m.last_deny_at && m.last_deny_at > seenAt(m)) || Date.now() - new Date(m.last_seen_at) > C.TTL_HOURS * 3600e3;

  let current = null;
  function render() {
    layer.clearLayers();
    const vis = marks.filter(m => active.has(m.type) && TYPES[m.type]);
    if (map.getZoom() < C.CLUSTER_BELOW_ZOOM) {
      const cells = new Map();
      vis.forEach(m => { const p = map.project([m.lat, m.lng]); const k = Math.floor(p.x / 70) + ":" + Math.floor(p.y / 70); (cells.get(k) || cells.set(k, []).get(k)).push(m); });
      for (const g of cells.values()) {
        if (g.length === 1) { addFlag(g[0]); continue; }
        const lat = g.reduce((s, m) => s + m.lat, 0) / g.length, lng = g.reduce((s, m) => s + m.lng, 0) / g.length;
        const icon = L.divIcon({ className: "", iconSize: [40, 40], iconAnchor: [20, 20], html: `<span class="cluster">${g.length}</span>` });
        L.marker([lat, lng], { icon }).addTo(layer).on("click", () => map.flyToBounds(L.latLngBounds(g.map(m => [m.lat, m.lng])).pad(0.3), { maxZoom: 14 }));
      }
    } else vis.forEach(addFlag);
    if (current) openSheet(current, true);
  }
  function addFlag(m) {
    const t = TYPES[m.type];
    const icon = L.divIcon({ className: "", iconSize: [54, 38], iconAnchor: [27, 38], html: `<span class="flag ${t.cls} ${isOld(m) ? "old" : ""}">${t.text()}</span>` });
    L.marker([m.lat, m.lng], { icon }).addTo(layer).on("click", e => { L.DomEvent.stopPropagation(e); openSheet(m.id); });
  }
  map.on("zoomend", () => render());
  function openSheet(id, keep) {
    const m = marks.find(x => x.id === id); if (!m) return closeSheet();
    current = id;
    $("#sNote").hidden = !m.note; $("#sNote span").textContent = m.note || "";
    $("#sAuthor").textContent = (m.author || t("anon")) + (m.author_verified ? " ⭐" : "");
    $("#sSeen").textContent = ago(seenAt(m));
    $("#sGoneRow").hidden = !m.last_deny_at; $("#sGone").textContent = m.last_deny_at ? ago(m.last_deny_at) : "";
    $("#sAdded").textContent = `${when(m.created_at)} (${ago(m.created_at)})`;
    const fill = (b, n, by, at) => { b.querySelector(".cnt").textContent = n || ""; b.querySelector(".who").innerHTML = by ? `<b>${esc(by)}</b><br>${ago(at)}` : ""; };
    fill($("#rYes"), m.confirms, m.last_confirm_by, m.last_confirm_at);
    fill($("#rNo"), m.denies, m.last_deny_by, m.last_deny_at);
    const my = store.get(voteKey(m.id));
    $("#rYes").classList.toggle("mine", my === "yes"); $("#rNo").classList.toggle("mine", my === "no");
    $("#sDel").hidden = !mine.has(m.id);
    $("#sheet").hidden = false; document.body.classList.add("sheet-open");
  }
  function closeSheet() { current = null; $("#sheet").hidden = true; document.body.classList.remove("sheet-open"); }

  let offline = false;
  async function refresh() {
    try { marks = await api.list(); offline = false; render(); checkNear(); }
    catch (e) { if (!marks.length) { try { marks = JSON.parse(store.get("kunsabai.cache") || "[]"); render(); } catch {} } if (!offline) toast(t("offline")); offline = true; }
  }
  const loggedIn = () => live ? !isAnon() : !!nick;
  const voteKey = id => "v." + id + "." + (live ? session?.user?.id : nick);
  function openAuth() {
    $("#nick").value = nick; $("#email").value = ""; $("#code").value = "";
    $("#emailRow").hidden = !live; $("#codeRow").hidden = true; $("#authOk").textContent = live ? t("getCode") : t("login");
    $("#authDlg").showModal();
  }
  async function vote(yes) {
    if (!loggedIn()) return openAuth();
    const id = current, k = voteKey(id);
    if (store.get(k)) return toast(t("voted"));
    try {
      const r = await api.vote(id, yes); store.set(k, yes ? "yes" : "no");
      toast(r === "already" ? t("voted") : yes ? t("thanksYes") : t("thanksNo")); refresh();
    } catch (err) { toast(err.message || t("sendFail")); }
  }
  $("#authForm").onsubmit = async e => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const n = $("#nick").value.trim().slice(0, 20);
    if (!n) return toast(t("enterName"));
    if (!live) { nick = n; store.set("kunsabai.nick", nick); $("#authDlg").close(); return toast(t("loggedAs", nick)); }
    const email = $("#email").value.trim();
    try {
      if ($("#codeRow").hidden) {
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast(t("enterEmail"));
        await api.sendCode(email); $("#codeRow").hidden = false; $("#authOk").textContent = t("login"); $("#code").focus();
        return toast(t("codeSent", email), 4000);
      }
      await api.verify(email, $("#code").value.trim(), n);
      nick = n; store.set("kunsabai.nick", nick); $("#authDlg").close(); toast(t("loggedAs", nick));
    } catch (err) { toast(err.message || t("loginFail")); }
  };

  addEventListener("keydown", e => { if (e.key === "Escape" && current) closeSheet(); });
  $("#sDel").onclick = async () => {
    if (!current || !confirm(t("delAsk"))) return;
    try { await api.remove(current); closeSheet(); toast(t("deleted")); refresh(); } catch (err) { toast(err.message || t("delFail")); }
  };
  $("#rYes").onclick = () => vote(true);
  $("#rNo").onclick = () => vote(false);

  // ---------- фильтры ----------
  function buildChips() {
    $("#filters").innerHTML = Object.entries(TYPES).map(([k, ty]) => `<button class="chip ${active.has(k) ? "on" : ""}" data-k="${k}">${ty.label()}</button>`).join("") + `<button class="chip on lang" id="lang">${lang.toUpperCase()}</button>`;
    $("#typeGrid").innerHTML = Object.entries(TYPES).map(([k, ty]) => `<button type="button" data-k="${k}">${ty.label()}</button>`).join("");
  }
  function applyLang() {
    document.documentElement.lang = lang; document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach(e => e.textContent = t(e.dataset.i18n));
    document.querySelectorAll("[data-i18n-ph]").forEach(e => e.placeholder = t(e.dataset.i18nPh));
    buildChips(); render();
  }
  $("#filters").onclick = e => {
    const b = e.target.closest(".chip"); if (!b) return;
    if (b.id === "lang") { lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]; store.set("kunsabai.lang", lang); return applyLang(); }
    const k = b.dataset.k; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); render();
  };

  // ---------- геолокация, «следовать», предупреждения ----------
  let watchId = null, follow = false, alertsOn = store.get("kunsabai.alerts") !== "0";
  const alerted = new Map();
  function setMe(p) {
    me = L.latLng(p.coords.latitude, p.coords.longitude);
    meMarker ? meMarker.setLatLng(me) : meMarker = L.circleMarker(me, { radius: 8, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
  }
  function locate(zoom = true) {
    if (!navigator.geolocation) return toast(t("noGeo"));
    navigator.geolocation.getCurrentPosition(p => {
      setMe(p);
      if (zoom && !THAILAND.contains(me)) toast(t("outside"));
      if (zoom) map.setView(me, 15);
    }, () => zoom && toast(t("geoFail")), { enableHighAccuracy: true, timeout: 10000 });
  }
  function beep() {
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.3, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2); }); } catch {}
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
  }
  function checkNear() {
    if (!alertsOn || !me) return;
    const now = Date.now();
    marks.forEach(m => {
      if (isOld(m) || !active.has(m.type)) return;
      const d = me.distanceTo([m.lat, m.lng]);
      if (d > C.ALERT_RADIUS_M || now - (alerted.get(m.id) || 0) < 10 * 60e3) return;
      alerted.set(m.id, now); beep();
      toast(t("near", TYPES[m.type].label(), Math.round(d / 10) * 10) + (m.note ? " — " + m.note : ""), 6000);
    });
  }
  function ensureWatch() {
    const need = follow || alertsOn;
    if (need && watchId == null && navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => { setMe(p); if (follow) map.setView(me, Math.max(map.getZoom(), 15), { animate: true }); checkNear(); }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    if (!need && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
  function setFollow(v) { follow = v; $("#follow").classList.toggle("on", v); ensureWatch(); if (v) { toast(t("following")); if (me) map.setView(me, Math.max(map.getZoom(), 15)); } }
  function setAlerts(v) { alertsOn = v; store.set("kunsabai.alerts", v ? "1" : "0"); $("#alerts").textContent = v ? "🔔" : "🔕"; $("#alerts").classList.toggle("on", v); ensureWatch(); }
  map.on("dragstart", () => follow && setFollow(false));
  $("#locate").onclick = () => locate();
  $("#follow").onclick = () => setFollow(!follow);
  $("#alerts").onclick = () => { setAlerts(!alertsOn); toast(alertsOn ? t("alertsOn", C.ALERT_RADIUS_M) : t("alertsOff")); };
  setAlerts(alertsOn);

  // ---------- добавление ----------
  let selType = null;
  $("#typeGrid").onclick = e => { const b = e.target.closest("button"); if (!b) return; selType = b.dataset.k; [...$("#typeGrid").children].forEach(x => x.classList.toggle("sel", x === b)); };
  map.on("click", e => { if (current) return closeSheet(); picked = e.latlng; toast(t("picked")); });
  $("#add").onclick = () => { selType = null; $("#note").value = ""; [...$("#typeGrid").children].forEach(x => x.classList.remove("sel")); $("#addDlg").showModal(); };
  $("#addForm").onsubmit = async e => {
    if (e.submitter?.value !== "ok") return;
    if (!selType) { e.preventDefault(); return toast(t("chooseType")); }
    const pos = picked || me || map.getCenter();
    picked = null;
    try {
      const m = await api.add({ type: selType, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), note: $("#note").value.trim().slice(0, 140) });
      addMine(m.id); toast(t("added_ok")); await refresh(); map.setView([m.lat, m.lng], Math.max(map.getZoom(), 14));
    } catch { toast(t("addFail")); }
  };

  // ---------- поиск: подсказки при вводе (Photon), по Enter — Nominatim; только Таиланд ----------
  const sug = $("#sug");
  const hideSug = () => { sug.hidden = true; sug.innerHTML = ""; };
  const go = (lat, lng, z = 14) => { map.setView([lat, lng], z); hideSug(); document.activeElement.blur(); };
  $("#q").addEventListener("input", () => {
    clearTimeout(go.t); const q = $("#q").value.trim(); if (q.length < 3) return hideSug();
    go.t = setTimeout(async () => {
      try {
        const r = await fetch(`https://photon.komoot.io/api/?limit=6&bbox=97.2,5.4,105.8,20.6&lang=${lang === "en" ? "en" : "default"}&q=${encodeURIComponent(q)}`);
        const f = (await r.json()).features || [];
        if ($("#q").value.trim() !== q) return;
        sug.innerHTML = f.map((x, i) => { const p = x.properties; const sub = [p.city || p.county, p.state].filter(v => v && v !== p.name).join(", "); return `<li data-i="${i}"><b>${esc(p.name || p.street || "")}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</li>`; }).join("");
        sug.hidden = !f.length;
        sug.onclick = ev => { const li = ev.target.closest("li"); if (!li) return; const x = f[+li.dataset.i]; $("#q").value = x.properties.name || ""; go(x.geometry.coordinates[1], x.geometry.coordinates[0], x.properties.osm_key === "place" ? 13 : 16); };
      } catch { hideSug(); }
    }, 350);
  });
  map.on("movestart", hideSug);
  $("#search").onsubmit = async e => {
    e.preventDefault(); clearTimeout(go.t); const q = $("#q").value.trim(); if (!q) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&accept-language=${lang}&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!j.length) return toast(t("notFound"));
      go(+j[0].lat, +j[0].lon);
    } catch { toast(t("searchFail")); }
  };

  // ---------- «Поделиться» (Android Web Share Target) ----------
  (function fromShare() {
    const p = new URLSearchParams(location.search);
    const s = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
    if (!s) return;
    const m = s.match(/(-?\d{1,2}\.\d+)[, ]+\s*(-?\d{2,3}\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) { picked = L.latLng(+m[1], +m[2]); map.setView(picked, 16); toast(t("sharePicked"), 4000); }
    history.replaceState(null, "", location.pathname);
  })();

  // ---------- установка на экран «Домой» ----------
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferred = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("#install").hidden = false; });
  if (ios && !standalone) $("#install").hidden = false;
  $("#install").onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $("#install").hidden = true; return; }
    $("#installText").innerHTML = ios ? t("installIos") : t("installOther");
    $("#installDlg").showModal();
  };
  addEventListener("appinstalled", () => $("#install").hidden = true);

  applyLang();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!live) setTimeout(() => toast(t("demo"), 4000), 800);
  locate(false); refresh(); setInterval(refresh, live ? 60000 : 30000); realtime(() => { clearTimeout(refresh.t); refresh.t = setTimeout(refresh, 300); });
  window.__kunsabai = { map, api, alerted };
})();
