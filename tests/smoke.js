// Smoke-тест Kunsabai: node tests/smoke.js  (нужен playwright; сервер поднимается сам)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "kunsabai");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
let fails = 0; const ok = (c, m) => { console.log((c ? "✔ " : "✘ ") + m); if (!c) fails++; };
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch();
  for (const vp of [{ width: 390, height: 800, name: "mobile" }, { width: 1440, height: 900, name: "desktop" }]) {
    const ctx = await b.newContext({ locale: "ru-RU", viewport: vp, geolocation: { latitude: 13.7563, longitude: 100.5018 }, permissions: ["geolocation"], serviceWorkers: "block" });
    await ctx.route(/tile\.openstreetmap|nominatim|supabase\.co/, r => r.abort());
    await ctx.route(/\/config\.js$/, r => r.fulfill({ contentType: "text/javascript", body: `window.KUNSABAI={SUPABASE_URL:"",SUPABASE_ANON_KEY:"",TTL_HOURS:3,HIDE_AFTER_HOURS:12,ALERT_RADIUS_M:500,CLUSTER_BELOW_ZOOM:11};` }));
    await ctx.route(/photon\.komoot\.io/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ features: [{ geometry: { coordinates: [98.2963, 7.8961] }, properties: { name: "Patong", state: "Phuket", osm_key: "place" } }] }) }));
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(800);
    // подсказки поиска
    await p.fill("#q", "Pato"); await p.waitForTimeout(700);
    ok(await p.isVisible("#sug li"), `${vp.name}: подсказки поиска появились`);
    await p.click("#sug li"); await p.waitForTimeout(400);
    const c = await p.evaluate(() => window.__kunsabai.map.getCenter());
    ok(Math.abs(c.lat - 7.8961) < 0.01 && !(await p.isVisible("#sug")), `${vp.name}: выбор подсказки переносит карту`);
    await p.evaluate(() => window.__kunsabai.map.setView([13.7563, 100.5018], 15)); await p.waitForTimeout(300);
    // добавить метку
    await p.click("#add"); await p.click("#typeGrid button[data-k=dps]"); await p.fill("#note", "test"); await p.click("#addOk"); await p.waitForTimeout(800);
    ok(await p.locator(".flag.dps").count() === 1, `${vp.name}: метка ДПС поставлена`);
    await p.click(".flag"); ok(await p.isVisible("#sheet"), `${vp.name}: панель метки открылась`);
    ok(await p.isVisible("#sDel"), `${vp.name}: автор видит «Удалить»`);
    ok(!(await p.isVisible("#sGoneRow")), `${vp.name}: строка «уже нет» скрыта без голосов`);
    // голос без входа → окно входа
    await p.click("#rYes"); ok(await p.evaluate(() => document.querySelector("#authDlg").open), `${vp.name}: без входа просит авторизоваться`);
    await p.fill("#nick", "Tester"); await p.click("#authOk"); await p.click("#rYes"); await p.waitForTimeout(500);
    ok((await p.textContent("#rYes")).includes("1") && (await p.textContent("#rYes")).includes("Tester"), `${vp.name}: голос ✔ засчитан с именем`);
    ok(await p.evaluate(() => document.querySelector("#rYes").classList.contains("mine")), `${vp.name}: своя реакция подсвечена`);
    await p.click("#rYes"); await p.waitForTimeout(200); ok((await p.textContent("#toast")).includes("уже"), `${vp.name}: повторный голос запрещён`);
    // предупреждение рядом (мы стоим в той же точке)
    await p.reload(); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => window.__kunsabai.alerted.size === 1), `${vp.name}: предупреждение о ДПС рядом сработало`);
    // группировка: 5 меток рядом при отдалении
    await p.evaluate(() => { const a = JSON.parse(localStorage.getItem("kunsabai.marks")); const now = new Date().toISOString(); for (let i = 0; i < 5; i++) a.push({ id: "c" + i, type: "dps", lat: 7.88 + i * 0.01, lng: 98.39, author: "x", confirms: 0, denies: 0, created_at: now, last_seen_at: now }); localStorage.setItem("kunsabai.marks", JSON.stringify(a)); });
    await p.reload(); await p.waitForTimeout(800); await p.evaluate(() => window.__kunsabai.map.setZoom(6)); await p.waitForTimeout(600);
    ok(await p.locator(".cluster").count() >= 1, `${vp.name}: при отдалении метки группируются`);
    // удаление своей метки
    await p.evaluate(() => window.__kunsabai.map.setView([13.7563, 100.5018], 15)); await p.waitForTimeout(600);
    p.once("dialog", d => d.accept()); await p.click(".flag.dps"); await p.click("#sDel"); await p.waitForTimeout(600);
    ok(!(await p.evaluate(() => JSON.parse(localStorage.getItem("kunsabai.marks")).some(m => m.note === "test"))), `${vp.name}: своя метка удалена`);
    await p.evaluate(() => window.__kunsabai.map.setView([7.9, 98.39], 13)); await p.waitForTimeout(500);
    // языки: RU → EN → TH
    await p.click("#lang"); ok((await p.textContent(".flag.dps")) === "POLICE" && (await p.getAttribute("#q", "placeholder")).includes("Thailand"), `${vp.name}: английский интерфейс`);
    await p.click("#lang"); ok((await p.textContent(".flag.dps")) === "ตำรวจ" && (await p.textContent("#addDlg h3")) === "จะปักหมุดอะไร?", `${vp.name}: тайский интерфейс`);
    await p.reload(); await p.waitForTimeout(600); ok((await p.textContent("#lang")) === "TH", `${vp.name}: язык запоминается`);
    await p.click("#lang"); ok((await p.textContent("#lang")) === "RU", `${vp.name}: обратно на русский`);
    ok(errs.length === 0, `${vp.name}: без JS-ошибок ${errs.join("; ")}`);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} проверок не прошло` : "\nВсе проверки прошли"); process.exit(fails ? 1 : 0);
})();
