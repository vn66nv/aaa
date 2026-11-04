// Тест «живого» режима с имитацией Supabase: node tests/live-mock.js
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "kunsabai");
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, q.url.split("?")[0].replace(/\/$/, "/index.html")); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
let fails = 0; const ok = (c, m) => { console.log((c ? "✔ " : "✘ ") + m); if (!c) fails++; };
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = `http://localhost:${srv.address().port}`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, geolocation: { latitude: 13.7563, longitude: 100.5018 }, permissions: ["geolocation"], serviceWorkers: "block" });
  await ctx.route(/tile\.openstreetmap|nominatim/, r => r.abort());
  await ctx.route(`${base}/config.js`, r => r.fulfill({ contentType: "text/javascript", body: `window.KUNSABAI={SUPABASE_URL:"https://demo.supabase.co",SUPABASE_ANON_KEY:"ANON",TTL_HOURS:3,HIDE_AFTER_HOURS:12,ALERT_RADIUS_M:500,CLUSTER_BELOW_ZOOM:11};` }));
  const db = { marks: [], log: [] };
  const user = (anon, id) => ({ id, is_anonymous: anon });
  await ctx.route("https://demo.supabase.co/**", async r => {
    const u = new URL(r.request().url()), m = r.request().method(), auth = r.request().headers()["authorization"], body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
    db.log.push(`${m} ${u.pathname} ${auth}`);
    const J = (o, s = 200) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });
    if (u.pathname === "/auth/v1/signup") return J({ access_token: "T_ANON", refresh_token: "R1", expires_in: 3600, user: user(true, "u-anon") });
    if (u.pathname === "/auth/v1/otp") { db.otpEmail = body.email; db.otpType = "email"; return J({}); }
    if (u.pathname === "/auth/v1/user" && m === "PUT") { if (body.email === "taken@b.co") return J({ msg: "already registered" }, 422); db.otpEmail = body.email; db.otpType = "email_change"; return J(user(true, "u-anon")); }
    if (u.pathname === "/auth/v1/verify") { db.verifyType = body.type; return body.token === "123456" ? J({ access_token: "T_USER", refresh_token: "R2", expires_in: 3600, user: user(false, body.type === "email_change" ? "u-anon" : "u-1") }) : J({ msg: "Неверный код" }, 400); }
    if (u.pathname === "/rest/v1/profiles") { db.profile = body; return r.fulfill({ status: 201, body: "" }); }
    if (u.pathname === "/rest/v1/marks" && m === "GET") return J(db.marks);
    if (u.pathname === "/rest/v1/marks" && m === "POST") { const now = new Date().toISOString(); const x = { ...body, user_id: auth === "Bearer T_USER" ? "?" : "u-anon", id: "m" + db.marks.length, author: "Пользователь 55555", confirms: 0, denies: 0, created_at: now, last_seen_at: now }; db.marks.push(x); return J([x], 201); }
    if (u.pathname === "/rest/v1/rpc/vote_mark") { if (auth !== "Bearer T_USER") return J({ message: "Авторизуйтесь" }, 400); const x = db.marks.find(k => k.id === body.mark_id); x.confirms++; x.last_confirm_by = db.profile.name; x.last_confirm_at = new Date().toISOString(); return J("ok"); }
    if (u.pathname === "/rest/v1/rpc/delete_mark") { const n = db.marks.length; db.marks = db.marks.filter(k => !(k.id === body.mark_id && k.user_id === db.uid)); return J(db.marks.length < n); }
    return J({ message: "unmocked " + u.pathname }, 404);
  });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(base + "/index.html"); await p.waitForTimeout(800);
  ok(db.log.some(l => l.startsWith("POST /auth/v1/signup")), "анонимная сессия создана при запуске");
  ok(db.log.some(l => l === "GET /rest/v1/marks Bearer T_ANON"), "метки запрашиваются с токеном сессии");
  await p.click("#add"); await p.click("#typeGrid button[data-k=dps]"); await p.click("#addOk"); await p.waitForTimeout(800);
  ok(db.marks.length === 1 && !("author" in JSON.parse(JSON.stringify(db.marks[0]))) === false, "метка сохранена в базе");
  ok(await p.locator(".flag.dps").count() === 1, "метка из базы на карте");
  await p.click(".flag"); await p.click("#rYes");
  ok(await p.isVisible("#emailRow"), "при голосе гостем — вход по e-mail");
  await p.fill("#nick", "Сомчай"); await p.fill("#email", "a@b.co"); await p.click("#authOk"); await p.waitForTimeout(300);
  ok(db.otpEmail === "a@b.co" && await p.isVisible("#codeRow"), "код запрошен, появилось поле кода");
  await p.fill("#code", "000000"); await p.click("#authOk"); await p.waitForTimeout(300);
  ok((await p.textContent("#toast")).includes("Неверный"), "неверный код — понятная ошибка");
  await p.fill("#code", "123456"); await p.click("#authOk"); await p.waitForTimeout(300);
  ok(db.verifyType === "email_change" && db.profile?.name === "Сомчай" && db.profile.id === "u-anon", "гость превращён в аккаунт (тот же id), профиль сохранён");
  db.uid = "u-anon";
  await p.click("#rYes"); await p.waitForTimeout(800);
  ok(db.marks[0].confirms === 1, "голос ушёл с токеном пользователя");
  ok((await p.textContent("#rYes")).includes("Сомчай"), "в кнопке ✔ имя проголосовавшего");
  p.once("dialog", d => d.accept()); await p.click("#sDel"); await p.waitForTimeout(600);
  ok(db.marks.length === 0, "своя метка удалена через delete_mark");
  // чужую метку удалить нельзя — честная ошибка
  db.marks.push({ id: "foreign", user_id: "u-other", type: "dps", lat: 13.7563, lng: 100.5018, author: "X", confirms: 0, denies: 0, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
  await p.evaluate(() => { const s = new Set(JSON.parse(localStorage.getItem("kunsabai.mine"))); s.add("foreign"); localStorage.setItem("kunsabai.mine", JSON.stringify([...s])); });
  await p.reload(); await p.waitForTimeout(800); p.once("dialog", d => d.accept()); await p.click(".flag"); await p.click("#sDel"); await p.waitForTimeout(400);
  ok(db.marks.length === 1 && (await p.textContent("#toast")).includes("только свою"), "чужая метка не удаляется, показана ошибка");
  ok(errs.length === 0, "без JS-ошибок " + errs.join("; "));
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} проверок не прошло` : "\nВсе проверки прошли"); process.exit(fails ? 1 : 0);
})();
