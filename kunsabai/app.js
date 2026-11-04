(() => {
  const C = window.KUNSABAI;
  const TYPES = {
    post:    { label: "Пост полиции", icon: "🚔", color: "#2563eb" },
    patrol:  { label: "Патруль",      icon: "🏍️", color: "#7c3aed" },
    camera:  { label: "Камера",       icon: "📷", color: "#dc2626" },
    accident:{ label: "ДТП",          icon: "💥", color: "#ea580c" },
    road:    { label: "Ремонт/затор", icon: "🚧", color: "#ca8a04" },
    check:   { label: "Проверка (алкотестер)", icon: "🚨", color: "#db2777" }
  };
  const THAILAND = L.latLngBounds([5.4, 97.2], [20.6, 105.8]);
  const $ = s => document.querySelector(s);
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);

  // ---------- хранилище ----------
  const H = { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  const LS = "kunsabai.marks";
  const local = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
  const saveLocal = a => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch {} };

  const api = {
    async list() {
      const since = new Date(Date.now() - C.HIDE_AFTER_HOURS * 3600e3).toISOString();
      if (!live) return local().filter(m => m.last_seen_at > since);
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/marks?select=*&last_seen_at=gt.${since}&order=created_at.desc&limit=1000`, { headers: H });
      if (!r.ok) throw new Error("list " + r.status);
      return r.json();
    },
    async add(m) {
      if (!live) { const a = local(); m = { ...m, id: crypto.randomUUID(), confirms: 1, denies: 0, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }; a.push(m); saveLocal(a); return m; }
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/marks`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(m) });
      if (!r.ok) throw new Error("add " + r.status);
      return (await r.json())[0];
    },
    async vote(id, yes) {
      if (!live) { const a = local(); const m = a.find(x => x.id === id); if (!m) return; if (yes) { m.confirms++; m.last_seen_at = new Date().toISOString(); } else m.denies++; saveLocal(a); return; }
      const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/vote_mark`, { method: "POST", headers: H, body: JSON.stringify({ mark_id: id, is_yes: yes }) });
      if (!r.ok) throw new Error("vote " + r.status);
    }
  };

  // ---------- карта ----------
  const map = L.map("map", { zoomControl: false, maxBounds: THAILAND.pad(0.3), minZoom: 5, attributionControl: true }).fitBounds(THAILAND);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let marks = [], active = new Set(Object.keys(TYPES)), me = null, meMarker = null, picked = null;

  const toast = (t, ms = 2500) => { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? "только что" : m < 60 ? m + " мин назад" : Math.floor(m / 60) + " ч назад"; };
  const isOld = m => Date.now() - new Date(m.last_seen_at) > C.TTL_HOURS * 3600e3;

  function render() {
    layer.clearLayers();
    marks.filter(m => active.has(m.type) && TYPES[m.type]).forEach(m => {
      const t = TYPES[m.type];
      const icon = L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 34], html: `<div class="pin ${isOld(m) ? "old" : ""}" style="background:${t.color}"><span>${t.icon}</span></div>` });
      const mk = L.marker([m.lat, m.lng], { icon }).addTo(layer);
      mk.bindPopup(() => {
        const d = document.createElement("div"); d.className = "pop";
        d.innerHTML = `<b>${t.icon} ${t.label}</b>${m.note ? esc(m.note) + "<br>" : ""}<small>Поставлено ${ago(m.created_at)} · подтверждено ${ago(m.last_seen_at)}<br>👍 ${m.confirms} · 👎 ${m.denies}${isOld(m) ? " · возможно устарело" : ""}</small>
          <div class="vote"><button class="yes">Стоят</button><button class="no">Уже нет</button></div>`;
        d.querySelector(".yes").onclick = () => vote(m, true);
        d.querySelector(".no").onclick = () => vote(m, false);
        return d;
      });
    });
  }

  async function refresh() { try { marks = await api.list(); render(); } catch (e) { toast("Нет связи с сервером"); } }
  async function vote(m, yes) {
    const k = "v." + m.id; try { if (localStorage.getItem(k)) return toast("Вы уже голосовали"); localStorage.setItem(k, "1"); } catch {}
    map.closePopup();
    try { await api.vote(m.id, yes); toast(yes ? "Спасибо, подтверждено" : "Спасибо, учтём"); refresh(); } catch { toast("Не удалось отправить"); }
  }

  // ---------- фильтры ----------
  $("#filters").innerHTML = Object.entries(TYPES).map(([k, t]) => `<button class="chip on" data-k="${k}">${t.icon} ${t.label}</button>`).join("");
  $("#filters").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); render(); };

  // ---------- геолокация ----------
  function locate(zoom = true) {
    if (!navigator.geolocation) return toast("Геолокация недоступна");
    navigator.geolocation.getCurrentPosition(p => {
      me = L.latLng(p.coords.latitude, p.coords.longitude);
      if (!THAILAND.contains(me)) toast("Вы вне Таиланда — показываю как есть");
      meMarker ? meMarker.setLatLng(me) : meMarker = L.circleMarker(me, { radius: 8, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
      if (zoom) map.setView(me, 15);
    }, () => toast("Не удалось определить позицию"), { enableHighAccuracy: true, timeout: 10000 });
  }
  $("#locate").onclick = () => locate();

  // ---------- добавление ----------
  let selType = null;
  $("#typeGrid").innerHTML = Object.entries(TYPES).map(([k, t]) => `<button type="button" data-k="${k}">${t.icon}<br>${t.label}</button>`).join("");
  $("#typeGrid").onclick = e => { const b = e.target.closest("button"); if (!b) return; selType = b.dataset.k; [...$("#typeGrid").children].forEach(x => x.classList.toggle("sel", x === b)); };
  map.on("click", e => { picked = e.latlng; toast("Точка выбрана — жмите ＋"); });
  $("#add").onclick = () => { selType = null; $("#note").value = ""; [...$("#typeGrid").children].forEach(x => x.classList.remove("sel")); $("#addDlg").showModal(); };
  $("#addForm").onsubmit = async e => {
    if (e.submitter?.value !== "ok") return;
    if (!selType) { e.preventDefault(); return toast("Выберите тип"); }
    const pos = picked || me || map.getCenter();
    picked = null;
    try {
      const m = await api.add({ type: selType, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), note: $("#note").value.trim().slice(0, 140) });
      toast("Отметка поставлена"); await refresh(); map.setView([m.lat, m.lng], Math.max(map.getZoom(), 14));
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
  window.__kunsabai = { map, api };
})();
