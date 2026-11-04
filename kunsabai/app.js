(() => {
  const C = window.KUNSABAI;
  const TYPES = {
    dps:  { label: "ДПС",     text: "ДПС", cls: "dps" },
    warn: { label: "Внимание", text: "!",  cls: "warn" }
  };
  const THAILAND = L.latLngBounds([5.4, 97.2], [20.6, 105.8]);
  const $ = s => document.querySelector(s);
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);

  // ---------- профиль ----------
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let guest = store.get("kunsabai.guest"); if (!guest) { guest = "Пользователь " + (10000 + Math.floor(Math.random() * 90000)); store.set("kunsabai.guest", guest); }
  let nick = store.get("kunsabai.nick") || "";
  const author = () => nick || guest;
  const mine = new Set(JSON.parse(store.get("kunsabai.mine") || "[]"));
  const addMine = id => { mine.add(id); store.set("kunsabai.mine", JSON.stringify([...mine].slice(-200))); };

  // ---------- хранилище ----------
  const H = { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  const LS = "kunsabai.marks";
  const local = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
  const saveLocal = a => store.set(LS, JSON.stringify(a));

  const api = {
    async list() {
      const since = new Date(Date.now() - C.HIDE_AFTER_HOURS * 3600e3).toISOString();
      if (!live) return local().filter(m => m.last_seen_at > since);
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/marks?select=*&last_seen_at=gt.${since}&order=created_at.desc&limit=1000`, { headers: H });
      if (!r.ok) throw new Error("list " + r.status);
      return r.json();
    },
    async add(m) {
      m = { ...m, author: author(), confirms: 0, denies: 0 };
      if (!live) { const a = local(); const now = new Date().toISOString(); m = { ...m, id: crypto.randomUUID(), created_at: now, last_seen_at: now }; a.push(m); saveLocal(a); return m; }
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/marks`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(m) });
      if (!r.ok) throw new Error("add " + r.status);
      return (await r.json())[0];
    },
    async remove(id) {
      if (!live) { saveLocal(local().filter(x => x.id !== id)); return; }
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/delete_mark`, { method: "POST", headers: H, body: JSON.stringify({ mark_id: id, who: marks.find(x => x.id === id)?.author || author() }) });
      if (!r.ok) throw new Error("remove " + r.status);
    },
    async vote(id, yes) {
      if (!live) {
        const a = local(), m = a.find(x => x.id === id); if (!m) return; const now = new Date().toISOString();
        if (yes) { m.confirms++; m.last_confirm_by = author(); m.last_confirm_at = now; m.last_seen_at = now; } else { m.denies++; m.last_deny_by = author(); m.last_deny_at = now; }
        saveLocal(a); return;
      }
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/vote_mark`, { method: "POST", headers: H, body: JSON.stringify({ mark_id: id, is_yes: yes, voter: author() }) });
      if (!r.ok) throw new Error("vote " + r.status);
    }
  };

  // ---------- карта ----------
  const map = L.map("map", { zoomControl: false, maxBounds: THAILAND.pad(0.3), minZoom: 5, attributionControl: true }).fitBounds(THAILAND);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let marks = [], active = new Set(Object.keys(TYPES)), me = null, meMarker = null, picked = null;

  const toast = (t, ms = 2500) => { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = iso => { const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000)); if (m < 1) return "только что"; const h = Math.floor(m / 60); return (h ? h + " ч " : "") + (m % 60 || !h ? (m % 60) + " мин " : "") + "назад"; };
  const when = iso => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    const icon = L.divIcon({ className: "", iconSize: [54, 38], iconAnchor: [27, 38], html: `<span class="flag ${t.cls} ${isOld(m) ? "old" : ""}">${t.text}</span>` });
    L.marker([m.lat, m.lng], { icon }).addTo(layer).on("click", e => { L.DomEvent.stopPropagation(e); openSheet(m.id); });
  }
  map.on("zoomend", () => render());
  function openSheet(id, keep) {
    const m = marks.find(x => x.id === id); if (!m) return closeSheet();
    current = id;
    $("#sNote").hidden = !m.note; $("#sNote span").textContent = m.note || "";
    $("#sAuthor").textContent = m.author || "Аноним";
    $("#sSeen").textContent = ago(seenAt(m));
    $("#sGoneRow").hidden = !m.last_deny_at; $("#sGone").textContent = m.last_deny_at ? ago(m.last_deny_at) : "";
    $("#sAdded").textContent = `${when(m.created_at)} (${ago(m.created_at)})`;
    const fill = (b, n, by, at) => { b.querySelector(".cnt").textContent = n || ""; b.querySelector(".who").innerHTML = by ? `<b>${esc(by)}</b><br>${ago(at)}` : ""; };
    fill($("#rYes"), m.confirms, m.last_confirm_by, m.last_confirm_at);
    fill($("#rNo"), m.denies, m.last_deny_by, m.last_deny_at);
    $("#sDel").hidden = !mine.has(m.id);
    $("#sheet").hidden = false; document.body.classList.add("sheet-open");
  }
  function closeSheet() { current = null; $("#sheet").hidden = true; document.body.classList.remove("sheet-open"); }

  async function refresh() { try { marks = await api.list(); render(); checkNear(); } catch (e) { toast("Нет связи с сервером"); } }
  async function vote(yes) {
    if (!nick) { $("#nick").value = ""; return $("#authDlg").showModal(); }
    const id = current, k = "v." + id + "." + nick;
    if (store.get(k)) return toast("Вы уже голосовали");
    store.set(k, "1");
    try { await api.vote(id, yes); toast(yes ? "Спасибо, подтверждено" : "Спасибо, учтём"); refresh(); } catch { toast("Не удалось отправить"); }
  }
  addEventListener("keydown", e => { if (e.key === "Escape" && current) closeSheet(); });
  $("#sDel").onclick = async () => {
    if (!current || !confirm("Удалить вашу метку?")) return;
    try { await api.remove(current); closeSheet(); toast("Метка удалена"); refresh(); } catch { toast("Не удалось удалить"); }
  };
  $("#rYes").onclick = () => vote(true);
  $("#rNo").onclick = () => vote(false);
  $("#authForm").onsubmit = e => {
    if (e.submitter?.value !== "ok") return;
    const n = $("#nick").value.trim();
    if (!n) { e.preventDefault(); return toast("Введите имя"); }
    nick = n.slice(0, 20); store.set("kunsabai.nick", nick); toast("Вы вошли как " + nick);
  };

  // ---------- фильтры ----------
  $("#filters").innerHTML = Object.entries(TYPES).map(([k, t]) => `<button class="chip on" data-k="${k}">${t.label}</button>`).join("");
  $("#filters").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); render(); };

  // ---------- геолокация, «следовать», предупреждения ----------
  let watchId = null, follow = false, alertsOn = store.get("kunsabai.alerts") !== "0";
  const alerted = new Map();
  function setMe(p) {
    me = L.latLng(p.coords.latitude, p.coords.longitude);
    meMarker ? meMarker.setLatLng(me) : meMarker = L.circleMarker(me, { radius: 8, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
  }
  function locate(zoom = true) {
    if (!navigator.geolocation) return toast("Геолокация недоступна");
    navigator.geolocation.getCurrentPosition(p => {
      setMe(p);
      if (zoom && !THAILAND.contains(me)) toast("Вы вне Таиланда — показываю как есть");
      if (zoom) map.setView(me, 15);
    }, () => zoom && toast("Не удалось определить позицию"), { enableHighAccuracy: true, timeout: 10000 });
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
      toast(`${m.type === "dps" ? "ДПС" : "Внимание"} рядом: ${Math.round(d / 10) * 10} м${m.note ? " — " + m.note : ""}`, 6000);
    });
  }
  function ensureWatch() {
    const need = follow || alertsOn;
    if (need && watchId == null && navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => { setMe(p); if (follow) map.setView(me, Math.max(map.getZoom(), 15), { animate: true }); checkNear(); }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    if (!need && watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
  function setFollow(v) { follow = v; $("#follow").classList.toggle("on", v); ensureWatch(); if (v) { toast("Слежу за вашей позицией"); if (me) map.setView(me, Math.max(map.getZoom(), 15)); } }
  function setAlerts(v) { alertsOn = v; store.set("kunsabai.alerts", v ? "1" : "0"); $("#alerts").textContent = v ? "🔔" : "🔕"; $("#alerts").classList.toggle("on", v); ensureWatch(); }
  map.on("dragstart", () => follow && setFollow(false));
  $("#locate").onclick = () => locate();
  $("#follow").onclick = () => setFollow(!follow);
  $("#alerts").onclick = () => { setAlerts(!alertsOn); toast(alertsOn ? `Предупреждения включены (${C.ALERT_RADIUS_M} м)` : "Предупреждения выключены"); };
  setAlerts(alertsOn);

  // ---------- добавление ----------
  let selType = null;
  $("#typeGrid").innerHTML = Object.entries(TYPES).map(([k, t]) => `<button type="button" data-k="${k}">${t.label}</button>`).join("");
  $("#typeGrid").onclick = e => { const b = e.target.closest("button"); if (!b) return; selType = b.dataset.k; [...$("#typeGrid").children].forEach(x => x.classList.toggle("sel", x === b)); };
  map.on("click", e => { if (current) return closeSheet(); picked = e.latlng; toast("Точка выбрана — жмите ＋"); });
  $("#add").onclick = () => { selType = null; $("#note").value = ""; [...$("#typeGrid").children].forEach(x => x.classList.remove("sel")); $("#addDlg").showModal(); };
  $("#addForm").onsubmit = async e => {
    if (e.submitter?.value !== "ok") return;
    if (!selType) { e.preventDefault(); return toast("Выберите тип"); }
    const pos = picked || me || map.getCenter();
    picked = null;
    try {
      const m = await api.add({ type: selType, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), note: $("#note").value.trim().slice(0, 140) });
      addMine(m.id); toast("Отметка поставлена"); await refresh(); map.setView([m.lat, m.lng], Math.max(map.getZoom(), 14));
    } catch { toast("Не удалось поставить отметку"); }
  };

  // ---------- поиск (Nominatim, только Таиланд) ----------
  $("#search").onsubmit = async e => {
    e.preventDefault(); const q = $("#q").value.trim(); if (!q) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&accept-language=ru&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!j.length) return toast("Ничего не найдено");
      map.setView([+j[0].lat, +j[0].lon], 14); document.activeElement.blur();
    } catch { toast("Поиск недоступен"); }
  };

  // ---------- «Поделиться» (Android Web Share Target) ----------
  (function fromShare() {
    const p = new URLSearchParams(location.search);
    const s = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
    if (!s) return;
    const m = s.match(/(-?\d{1,2}\.\d+)[, ]+\s*(-?\d{2,3}\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) { picked = L.latLng(+m[1], +m[2]); map.setView(picked, 16); toast("Точка из «Поделиться» выбрана — жмите ＋", 4000); }
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
    $("#installText").innerHTML = ios ? "В Safari нажмите кнопку «Поделиться» (квадрат со стрелкой), затем «На экран “Домой”»." : "В меню браузера (⋮) выберите «Установить приложение» или «Добавить на главный экран».";
    $("#installDlg").showModal();
  };
  addEventListener("appinstalled", () => $("#install").hidden = true);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!live) setTimeout(() => toast("Демо-режим: отметки только на этом устройстве", 4000), 800);
  locate(false); refresh(); setInterval(refresh, 30000);
  window.__kunsabai = { map, api, alerted };
})();
