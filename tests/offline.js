// PWA: устанавливаемость и работа без сети: node tests/offline.js
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "kunsabai");
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, q.url.split("?")[0].replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
let fails = 0; const ok = (c, m) => { console.log((c ? "✔ " : "✘ ") + m); if (!c) fails++; };
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "ru-RU" });
  const carto = []; await ctx.route(/cartocdn/, r => { carto.push(r.request().url()); r.abort(); });
  await ctx.route(/tile\.openstreetmap|nominatim|photon|supabase\.co/, r => r.abort());
  const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(p);
  ok(carto.length > 0, "при сбое тайлов OSM карта переключилась на CARTO");
  ok((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors.length === 0, "Chrome считает сайт устанавливаемым приложением");
  ok((await cdp.send("Page.getAppManifest")).errors.length === 0, "manifest без ошибок");
  ok(await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), "service worker активен");
  await p.reload(); await p.waitForTimeout(1000);
  await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!window.L && !!document.querySelector(".leaflet-container") && !!document.querySelector("#add")), "без сети приложение открывается");
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} проверок не прошло` : "\nВсе проверки прошли"); process.exit(fails ? 1 : 0);
})();
