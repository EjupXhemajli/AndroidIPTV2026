/* ============================================================
   EX-IPTV – Frontend-Logik
   ============================================================ */
(() => {
"use strict";

/* ---------------- Kürzel & Helfer ---------------- */
const $ = id => document.getElementById(id);
const video = $("video");

/* Android-Kennzeichnung: zuverlässig über die von der Android-App injizierte
   JavaScript-Brücke "AndroidPlayer" (immer vorhanden), zusätzlich abgesichert über
   den ?app=android-Parameter und den User-Agent. Windows/Edge erfüllt nichts davon
   und bleibt damit unverändert. */
const IS_ANDROID =
  (typeof window.AndroidPlayer !== "undefined" && window.AndroidPlayer !== null) ||
  new URLSearchParams(location.search).get("app") === "android" ||
  /Android/i.test(navigator.userAgent || "");
if (IS_ANDROID) document.documentElement.classList.add("is-android");

async function api(path, body) {
  const opt = body !== undefined
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined;
  const r = await fetch(path, opt);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && data.error) || ("Fehler " + r.status));
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtHM = u => new Date(u * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmtDate = u => new Date(u * 1000).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
function fmtBytes(b) {
  if (b > 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (b > 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  return Math.round(b / 1024) + " KB";
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ---------------- Zustand ---------------- */
let state = { version: "", playlists: [], favorites: [], settings: {} };
let favSet = new Set();
const st = () => state.settings;

async function loadState() {
  state = await api("/api/state");
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  if (!state.settings.bufferSec) state.settings.bufferSec = 4;
  if (!state.settings.enhance) state.settings.enhance = "klar";
  if (state.settings.startupSound === undefined) state.settings.startupSound = true;
  favSet = new Set(state.favorites || []);
  return state;
}
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api("/api/settings", st()).catch(() => {}), 250);
}

/* ---------------- Lebenszeichen ---------------- */
fetch("/api/heartbeat").catch(() => {});
setInterval(() => fetch("/api/heartbeat").catch(() => {}), 2000);
addEventListener("pagehide", () => { try { navigator.sendBeacon("/api/bye"); } catch {} });

/* ============================================================
   Splash & Start
   ============================================================ */
const splashStart = Date.now();
function splashStatus(s) { $("splash-status").textContent = s; }

async function tryIntro() {
  const a = $("intro-audio");
  a.volume = 0.85;
  try { await a.play(); return true; } catch { return false; }
}

async function boot() {
  splashStatus("Verbinde mit EX-IPTV …");
  const statePromise = loadState().catch(e => { splashStatus("Start fehlgeschlagen: " + e.message); throw e; });

  let withSound = false;
  if (st().startupSound !== false) {
    withSound = await tryIntro();
    if (!withSound) {
      // Autoplay blockiert (z. B. normaler Browser): Knopf kurz anbieten
      const btn = $("splash-sound");
      btn.classList.remove("hidden");
      withSound = await new Promise(res => {
        const t = setTimeout(() => res(false), 2600);
        btn.onclick = async () => { clearTimeout(t); btn.classList.add("hidden"); res(await tryIntro()); };
      });
      btn.classList.add("hidden");
    }
  }

  await statePromise;
  applyAccent();
  applyHomeBg();
  applyShowNums();
  const rv = $("rail-version");
  if (rv) rv.textContent = "v" + (state.version || "");
  splashStatus("Lade Senderlisten …");

  const minShow = withSound ? 3200 : 900;
  const rest = splashStart + minShow - Date.now();
  if (rest > 0) await new Promise(r => setTimeout(r, rest));

  splashStatus("Bereit.");
  $("splash").style.transition = "opacity .45s ease";
  $("splash").style.opacity = "0";
  setTimeout(() => $("splash").classList.add("hidden"), 460);
  $("app").classList.remove("hidden");

  renderHome();
  if (!state.playlists.length) { openSetup(true); return; }
  const sv = st().startView || "home";
  if (sv === "tv") showView("tv");
  else if (sv === "resume" && st().lastChannel) playLive(st().lastChannel);
}

/* ============================================================
   Navigation
   ============================================================ */
let currentView = "home";
const viewLoader = {
  tv: loadTvView, guide: loadGuideView, movies: () => loadVodView("movie"),
  series: () => loadVodView("series"), favs: loadFavsView, recs: loadRecsView,
  continue: loadContinueView,
  settings: renderSettingsView, search: () => $("search-input").focus(), home: renderHome,
};
function showView(name) {
  currentView = name;
  if (name !== "home") stopCityRotation();
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $("view-" + name).classList.remove("hidden");
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
  (viewLoader[name] || (() => {}))();
}
document.querySelectorAll("[data-nav]").forEach(el =>
  el.addEventListener("click", () => showView(el.dataset.nav)));

/* ============================================================
   Start-Seite
   ============================================================ */
function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  if ($("home-greet")) $("home-greet").textContent = g + "!";
  if ($("home-clock")) $("home-clock").textContent =
    new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) +
    " · " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}
setInterval(updateGreeting, 30000);

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function tickClock() {
  const n = new Date(), h = n.getHours();
  const hh = $("bc-hh"), mm = $("bc-mm"), gd = $("bc-greet"), dt = $("bc-date");
  if (hh) hh.textContent = pad2(h);
  if (mm) mm.textContent = pad2(n.getMinutes());
  if (gd) gd.textContent = h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  if (dt) dt.textContent = n.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}
setInterval(tickClock, 1000); tickClock();

// Saubere Strich-Icons (Lucide-Stil); erben die Kachelfarbe über currentColor.
const ICON = {
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="m7 7 5-4 5 4"/></svg>',
  guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M3 14h11"/></svg>',
  movies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M17 8h4M3 16h4M17 16h4"/></svg>',
  series: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="m7 7 3-4M17 7l-3-4"/></svg>',
  cont: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M21 3v5h-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19l1-5.8L3.6 9.1l5.8-.8z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
};

async function renderHome() {
  const nCh = state.playlists.reduce((a, p) => a + (p.channels || 0), 0);
  const nVod = state.playlists.reduce((a, p) => a + (p.vod || 0), 0);
  // Erste Reihe: die drei Hauptbereiche – groß. Zweite Reihe: die übrigen – kompakt.
  const primary = [
    { v: "tv", n: "Live-TV", s: nCh ? nCh.toLocaleString("de-DE") + " Sender" : "Sender ansehen", c: "tv", i: ICON.tv },
    { v: "movies", n: "Filme", s: nVod ? "Mediathek" : "Auf Abruf", c: "movies", i: ICON.movies },
    { v: "series", n: "Serien", s: "Staffeln & Folgen", c: "series", i: ICON.series },
  ];
  const secondary = [
    { v: "guide", n: "TV-Guide", s: "Was läuft jetzt?", c: "guide", i: ICON.guide },
    { v: "continue", n: "Weiter schauen", s: "Dort weitermachen", c: "continue", i: ICON.cont },
    { v: "favs", n: "Favoriten", s: (favSet.size || "Keine") + " markiert", c: "favs", i: ICON.star },
    { v: "search", n: "Suche", s: "Alles finden", c: "search", i: ICON.search },
  ];
  const tileHTML = t =>
    `<div class="tile tile-${t.c}" data-nav="${t.v}">
       <span class="t-icon">${t.i}</span>
       <div class="t-name">${t.n}</div><div class="t-sub">${esc(t.s)}</div></div>`;
  if (IS_ANDROID) {
    // Android: zwei Kachelreihen (3 + 4), proportional zentriert – kein Bilder-Fenster.
    $("home-tiles").innerHTML =
      `<div class="tile-row tile-row-primary">${primary.map(tileHTML).join("")}</div>` +
      `<div class="tile-row tile-row-secondary">${secondary.map(tileHTML).join("")}</div>`;
  } else {
    $("home-tiles").innerHTML =
      `<div class="tile-row tile-row-primary">${primary.map(tileHTML).join("")}</div>`;
  }
  updateGreeting();
  tickClock();
  $("home-tiles").querySelectorAll(".tile").forEach(el =>
    el.addEventListener("click", () => showView(el.dataset.nav)));

  applyHomeBg();
  if (IS_ANDROID) {
    // Android zeigt das Kachelraster statt der Bildershow.
    stopCityRotation();
    const hc = $("home-cities"); if (hc) hc.classList.add("hidden");
  } else {
    startCityRotation();                       // sofort sichtbar (Namen/Farbverläufe)
    loadCities().then(() => { if (currentView === "home") startCityRotation(); }); // Fotos nachladen
  }

  const last = st().lastChannel;
  const wrap = $("home-continue");
  if (wrap) { wrap.classList.add("hidden"); return; }
  if (last && state.playlists.length) {
    try {
      const info = await api("/api/stream?key=" + encodeURIComponent(last));
      wrap.classList.remove("hidden");
      $("home-continue-card").innerHTML =
        `<div class="cont-card">
           <img src="${esc(info.logo || "")}" onerror="this.style.visibility='hidden'">
           <div><div style="font-weight:600">${esc(info.name)}</div>
           <div class="muted small">${esc(info.group || "Live-TV")}</div></div>
           <span class="c-play">▶</span></div>`;
      $("home-continue-card").firstElementChild.onclick = () => playLive(last);
    } catch { wrap.classList.add("hidden"); }
  } else wrap.classList.add("hidden");
}

function applyHomeBg() {
  const v = $("view-home");
  if (v) v.setAttribute("data-bg", String(st().homeBg || "1"));
}

/* ---- Startseiten-Fenster: 100 Gebäude-/Denkmal-Fotos + 50 Nachrichten ----
   (Sport/Politik/Auto), 2:1 verschachtelt, Crossfade alle 6 s, Dauerschleife.
   Robust: zeigt sofort Farbverlauf-Kacheln; Fotos/News werden nachgeladen. */
const CITY_FALLBACK = [
  "Paris – Eiffelturm", "Dubai – Burj Khalifa", "New York – Empire State", "Singapur – Marina Bay",
  "London – Tower Bridge", "Rom – Kolosseum", "Barcelona – Sagrada Família", "Sydney – Opernhaus",
  "Berlin – Brandenburger Tor", "Tokio – Skytree", "Taipeh – Taipei 101", "Kuala Lumpur – Petronas",
  "San Francisco – Golden Gate", "Agra – Taj Mahal", "Moskau – Basilius-Kathedrale", "Athen – Parthenon"
];
let buildItems = [], newsItems2 = [], showItems = [], cityIdx = 0, cityTimer = 0, cityLayer = 0, cityToken = 0;
function cityGradient(i) {
  const h = (i * 47) % 360;
  return `linear-gradient(135deg, hsl(${h} 55% 24%), hsl(${(h + 50) % 360} 60% 14%))`;
}
function buildShowcase() {
  const photos = buildItems.length ? buildItems : CITY_FALLBACK.map(n => ({ kind: "photo", title: n, image: "" }));
  const news = newsItems2;
  const out = []; let pi = 0, ni = 0;
  while (pi < photos.length || ni < news.length) {
    for (let k = 0; k < 2 && pi < photos.length; k++) out.push(photos[pi++]);
    if (ni < news.length) out.push(news[ni++]);
  }
  showItems = out;
}
async function loadCities() {
  const [c, n] = await Promise.allSettled([api("/api/cities"), api("/api/topnews")]);
  if (c.status === "fulfilled" && c.value && Array.isArray(c.value.items) && c.value.items.length)
    buildItems = c.value.items.map(x => ({ kind: "photo", title: x.title || "", image: x.image || "" }));
  if (n.status === "fulfilled" && n.value && Array.isArray(n.value.items) && n.value.items.length)
    newsItems2 = n.value.items.map(x => ({ kind: "news", cat: x.type || "News", title: x.title || "", subtitle: x.subtitle || "", image: x.image || "" }));
  buildShowcase();
}
function ensureCityLayers() {
  const el = $("home-cities"); if (!el) return null;
  if (!el.dataset.init) {
    el.innerHTML =
      `<div class="city-slide" data-l="0"></div>
       <div class="city-slide" data-l="1"></div>
       <div class="city-shade" id="city-shade"></div>
       <div class="city-cap" id="city-cap"></div>`;
    el.dataset.init = "1";
  }
  return el;
}
const NEWS_ICON = { Sport: "⚽", Politik: "🏛️", Auto: "🚗" };
function renderCaption(it) {
  if (it.kind === "news") {
    const cat = it.cat || "News";
    const ic = NEWS_ICON[cat] || "📰";
    return `<div class="news-cap">
        <span class="news-chip chip-${cat}">${ic} ${esc(cat)}</span>
        <div class="news-h">${esc(it.title || "")}</div>
        ${it.subtitle ? `<div class="news-s">${esc(it.subtitle)}</div>` : ""}
      </div>`;
  }
  return `<div class="city-name">${esc(it.title || "")}</div>`;
}
function showCity(i) {
  const el = ensureCityLayers(); if (!el) return;
  if (!showItems.length) buildShowcase();
  const it = showItems[i % showItems.length]; if (!it) return;
  const myToken = ++cityToken;
  const layers = el.querySelectorAll(".city-slide");
  const nxt = cityLayer ^ 1, lay = layers[nxt];
  lay.style.backgroundImage = cityGradient(i);             // sofortiger Platzhalter
  const shade = $("city-shade"), cap = $("city-cap");
  let revealed = false;
  const reveal = () => {
    if (revealed || myToken !== cityToken) return;
    revealed = true;
    if (shade) shade.className = "city-shade " + (it.kind === "news" ? "sh-news" : "sh-photo");
    if (cap) cap.innerHTML = renderCaption(it);
    lay.classList.add("show");
    layers[cityLayer].classList.remove("show");
    cityLayer = nxt;
  };
  if (it.image) {
    const pre = new Image();
    pre.referrerPolicy = "no-referrer";
    pre.onload = () => { if (myToken !== cityToken) return; lay.style.backgroundImage = `url("${it.image}")`; reveal(); };
    pre.onerror = reveal;                                   // Bild fehlt -> Farbverlauf bleibt
    pre.src = it.image;
    setTimeout(reveal, 1400);
  } else {
    reveal();
  }
}
function startCityRotation() {
  stopCityRotation();
  const el = $("home-cities"); if (!el) return;
  el.classList.remove("hidden");
  if (!showItems.length) buildShowcase();
  cityIdx = 0;
  showCity(cityIdx);
  cityTimer = setInterval(() => {
    if (currentView !== "home") { stopCityRotation(); return; }
    cityIdx = (cityIdx + 1) % showItems.length;
    showCity(cityIdx);
  }, 6000);
}
function stopCityRotation() {
  if (cityTimer) { clearInterval(cityTimer); cityTimer = 0; }
}

/* ============================================================
   EPG-Hilfen (Jetzt/Gleich für Listen)
   ============================================================ */
const epgNowCache = new Map(); // key -> {now,next,at}
let epgQueue = new Set(), epgTimer = 0;
function queueEpgNow(key, cb) {
  const c = epgNowCache.get(key);
  if (c && Date.now() - c.at < 90000) { cb(c); return; }
  epgQueue.add(key);
  pendingEpgCbs.set(key, (pendingEpgCbs.get(key) || []).concat(cb));
  clearTimeout(epgTimer);
  epgTimer = setTimeout(flushEpgNow, 180);
}
const pendingEpgCbs = new Map();
async function flushEpgNow() {
  const keys = [...epgQueue].slice(0, 60);
  keys.forEach(k => epgQueue.delete(k));
  if (!keys.length) return;
  try {
    const res = await api("/api/epg/now?keys=" + encodeURIComponent(keys.join(",")));
    for (const k of keys) {
      const ent = { ...(res[k] || {}), at: Date.now() };
      epgNowCache.set(k, ent);
      (pendingEpgCbs.get(k) || []).forEach(cb => cb(ent));
      pendingEpgCbs.delete(k);
    }
  } catch {}
  if (epgQueue.size) { epgTimer = setTimeout(flushEpgNow, 120); }
}

const lazyImgObserver = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) {
    const img = e.target;
    if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
    lazyImgObserver.unobserve(img);
  }
}, { rootMargin: "600px" });

const epgRowObserver = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) {
    const row = e.target;
    epgRowObserver.unobserve(row);
    queueEpgNow(row.dataset.key, ent => {
      const sub = row.querySelector(".r-sub"), prog = row.querySelector(".r-prog");
      if (!sub) return;
      if (ent.now) {
        sub.textContent = "Jetzt: " + ent.now.title;
        if (prog) {
          const pct = Math.min(100, Math.max(0, (Date.now() / 1000 - ent.now.start) / (ent.now.stop - ent.now.start) * 100));
          prog.innerHTML = `<div style="width:${pct}%"></div>`;
          prog.style.display = "block";
        }
      } else if (ent.next) sub.textContent = "Gleich: " + ent.next.title + " (" + fmtHM(ent.next.start) + ")";
    });
  }
}, { rootMargin: "150px" });

function channelRow(c, opts = {}) {
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.key = c.key;
  row.innerHTML =
    `<span class="r-num">${c.num || ""}</span>
     <img class="r-logo" data-src="${esc(imgUrl(c.logo))}" onerror="this.style.visibility='hidden'">
     <div class="r-main"><div class="r-name">${esc(c.name)}</div><div class="r-sub muted"></div></div>
     ${favSet.has(c.key) ? '<span class="r-fav">★</span>' : ""}
     <div class="r-prog" style="display:none"></div>`;
  if (c.logo) lazyImgObserver.observe(row.querySelector("img"));
  if (!opts.noEpg) epgRowObserver.observe(row);
  return row;
}

/* ============================================================
   Live-TV-Ansicht
   ============================================================ */
let tvGroups = [], tvCurrentGroup = null, tvChannels = [], tvSelected = null;

async function loadTvView() {
  if (!state.playlists.length) { $("tv-groups").innerHTML = '<p class="muted pad">Füge zuerst eine Playlist hinzu (Einstellungen).</p>'; return; }
  try { tvGroups = await api("/api/groups"); } catch { tvGroups = []; }
  const box = $("tv-groups");
  box.innerHTML = "";
  const mk = (name, label, count) => {
    const r = document.createElement("div");
    r.className = "row";
    r.innerHTML = `<div class="r-main"><div class="r-name">${esc(label)}</div></div><span class="r-count">${count ?? ""}</span>`;
    r.onclick = () => { box.querySelectorAll(".row").forEach(x => x.classList.remove("active")); r.classList.add("active"); loadTvChannels(name, label); };
    box.appendChild(r);
    return r;
  };
  const allRow = mk("", "Alle Kanäle", state.playlists.reduce((a, p) => a + (p.channels || 0), 0));
  mk("__fav__", "★ Favoriten", favSet.size);
  tvGroups.filter(g => !g.hidden).forEach(g => {
    const r = mk(g.name, (g.locked ? "🔒 " : "") + esc(g.name), g.count);
    if (g.locked) {
      r.onclick = async () => {
        const p = prompt("Diese Gruppe ist gesperrt. PIN eingeben:");
        if (p === null || p === "") return;
        try {
          await api("/api/pin", { unlock: p });
          toast("Entsperrt für 30 Minuten");
          tvCurrentGroup = { group: g.name, label: esc(g.name) };
          loadTvView();
        } catch { toast("PIN falsch"); }
      };
    }
  });
  if (tvCurrentGroup === null) allRow.click();
  else {
    const prev = [...box.children].find(r => r.querySelector(".r-name").textContent === tvCurrentGroup.label);
    (prev || allRow).click();
  }
}

async function loadTvChannels(group, label) {
  tvCurrentGroup = { group, label };
  $("tv-group-title").textContent = label.replace("★ ", "");
  const list = $("tv-channels");
  list.innerHTML = '<p class="muted" style="padding:14px">Lade …</p>';
  try { tvChannels = await api("/api/channels?group=" + encodeURIComponent(group)); }
  catch { tvChannels = []; }
  $("tv-count").textContent = tvChannels.length;
  list.innerHTML = "";
  if (!tvChannels.length) { list.innerHTML = '<p class="muted" style="padding:14px">Keine Kanäle in dieser Gruppe.</p>'; return; }
  renderChannelsProgressive(list, tvChannels);
}

// Kanäle in Schüben rendern (statt 9630 Zeilen auf einmal). Hält Start und
// Fernbedienungs-Navigation flott, weil das DOM klein bleibt.
function renderChannelsProgressive(list, chans) {
  const BATCH = 120;
  let pos = 0;
  const token = (list._token = (list._token || 0) + 1);
  function renderBatch() {
    if (list._token !== token) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(chans.length, pos + BATCH);
    for (; pos < end; pos++) {
      const c = chans[pos];
      const row = channelRow(c);
      row.onclick = () => { selectTvChannel(c, row); playLive(c.key, chans); };
      frag.appendChild(row);
    }
    list.appendChild(frag);
    if (pos < chans.length) {
      const sentinel = document.createElement("div");
      sentinel.style.cssText = "height:1px";
      list.appendChild(sentinel);
      new IntersectionObserver((es, obs) => {
        if (es.some(e => e.isIntersecting)) { obs.disconnect(); sentinel.remove(); renderBatch(); }
      }, { rootMargin: "1200px" }).observe(sentinel);
    }
  }
  renderBatch();
}

function selectTvChannel(c, row) {
  tvSelected = c.key;
  if (row) {
    row.parentElement.querySelectorAll(".row").forEach(x => x.classList.remove("active"));
    row.classList.add("active");
  }
  const card = $("tv-info");
  card.className = "info-card";
  card.innerHTML =
    `<div class="i-head">
       <img class="i-logo" src="${esc(c.logo || "")}" onerror="this.style.visibility='hidden'">
       <div><h3>${esc(c.name)}</h3><div class="muted small">${esc(c.group)} · Nr. ${c.num || "–"}</div></div>
     </div>
     <div class="i-now muted">Programmdaten werden geladen …</div>
     <div class="i-actions">
       <button class="primary-btn" id="i-play">▶ Ansehen</button>
       <button class="ghost-btn" id="i-fav">${favSet.has(c.key) ? "★ Favorit entfernen" : "☆ Als Favorit"}</button>
       <button class="ghost-btn" id="i-epgmap" title="Programmdaten manuell zuordnen">EPG zuordnen</button>
     </div>`;
  card.querySelector("#i-play").onclick = () => playLive(c.key, tvChannels);
  card.querySelector("#i-epgmap").onclick = () => openEpgMapModal(c);
  card.querySelector("#i-fav").onclick = async ev => {
    const on = !favSet.has(c.key);
    await toggleFavorite(c.key, on);
    ev.target.textContent = on ? "★ Favorit entfernen" : "☆ Als Favorit";
    loadTvView();
  };
  queueEpgNow(c.key, ent => {
    const box = card.querySelector(".i-now");
    if (!box) return;
    if (ent.now) {
      const pct = Math.min(100, Math.max(0, (Date.now() / 1000 - ent.now.start) / (ent.now.stop - ent.now.start) * 100));
      box.classList.remove("muted");
      box.innerHTML =
        `<div class="i-title">${esc(ent.now.title)}</div>
         <div class="i-time">${fmtHM(ent.now.start)} – ${fmtHM(ent.now.stop)}</div>
         <div class="i-prog"><div style="width:${pct}%"></div></div>
         ${ent.now.desc ? `<div class="i-desc">${esc(ent.now.desc)}</div>` : ""}
         ${ent.next ? `<div class="i-time" style="margin-top:10px">Danach: ${esc(ent.next.title)} (${fmtHM(ent.next.start)})</div>` : ""}`;
    } else box.textContent = "Keine Programmdaten für diesen Sender.";
  });
}

async function toggleFavorite(key, on) {
  if (on) favSet.add(key); else favSet.delete(key);
  state.favorites = [...favSet];
  try { await api("/api/favorite", { key, on }); } catch {}
  toast(on ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt");
}

/* ============================================================
   Favoriten-Ansicht
   ============================================================ */
async function loadFavsView() {
  const list = $("favs-list");
  let chans = [];
  try { chans = await api("/api/channels?group=__fav__"); } catch {}
  $("favs-count").textContent = chans.length;
  list.innerHTML = chans.length ? "" : '<p class="muted">Noch keine Favoriten. Markiere Sender mit ★.</p>';
  chans.forEach(c => {
    const row = channelRow(c);
    row.onclick = () => playLive(c.key, chans);
    list.appendChild(row);
  });
}

/* ============================================================
   TV-Guide
   ============================================================ */
const PX_PER_SEC = 180 / 1800; // 180px je 30 Minuten
let guideStart = 0, guideChannels = [], guideToken = 0, guideTimer = 0;

async function loadGuideView() {
  const sel = $("guide-group");
  if (!sel.dataset.filled) {
    let groups = [];
    try { groups = await api("/api/groups"); } catch {}
    sel.innerHTML = `<option value="">Alle Kanäle</option><option value="__fav__">★ Favoriten</option>` +
      groups.filter(g => !g.hidden).map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("");
    sel.dataset.filled = "1";
    sel.onchange = () => renderGuide(true);
    $("guide-prev").onclick = () => { guideStart -= 2 * 3600; renderGuide(false); };
    $("guide-next").onclick = () => { guideStart += 2 * 3600; renderGuide(false); };
    $("guide-now").onclick = () => renderGuide(true);
  }
  renderGuide(true);
  clearInterval(guideTimer);
  guideTimer = setInterval(updateNowLine, 30000);
}

async function renderGuide(resetTime) {
  const token = ++guideToken;
  if (resetTime) {
    const now = Math.floor(Date.now() / 1000);
    guideStart = Math.floor(now / 1800) * 1800 - 1800;
  }
  const winSecs = 4 * 3600, winEnd = guideStart + winSecs;

  // Zeitleiste
  const times = $("guide-times");
  times.innerHTML = "";
  for (let t = guideStart; t < winEnd; t += 1800) {
    const d = document.createElement("div");
    d.className = "g-time";
    d.textContent = fmtHM(t) + (new Date(t * 1000).getHours() === 0 && new Date(t * 1000).getMinutes() === 0 ? " · " + fmtDate(t) : "");
    times.appendChild(d);
  }

  const rows = $("guide-rows");
  rows.innerHTML = '<p class="muted" style="padding:16px 16px 16px 252px">Lade Programm …</p>';
  try { guideChannels = await api("/api/channels?group=" + encodeURIComponent($("guide-group").value)); }
  catch { guideChannels = []; }
  if (token !== guideToken) return;
  const capped = guideChannels.slice(0, 150);
  rows.innerHTML = "";
  const bandW = winSecs * PX_PER_SEC;

  for (const c of capped) {
    const r = document.createElement("div");
    r.className = "g-row";
    r.innerHTML =
      `<div class="g-ch" title="Ansehen">
         <img data-src="${esc(c.logo || "")}" onerror="this.style.visibility='hidden'">
         <div style="min-width:0"><div class="g-nm">${esc(c.name)}</div><div class="g-no">${c.num || ""}</div></div>
       </div><div class="g-band" style="width:${bandW}px"></div>`;
    if (c.logo) lazyImgObserver.observe(r.querySelector("img"));
    r.querySelector(".g-ch").onclick = () => playLive(c.key, guideChannels);
    rows.appendChild(r);
    r.querySelector(".g-band").dataset.key = c.key;
  }
  if (guideChannels.length > capped.length)
    rows.insertAdjacentHTML("beforeend", `<p class="muted" style="padding:12px 16px 18px 252px">Es werden die ersten ${capped.length} von ${guideChannels.length} Kanälen angezeigt – wähle oben eine Gruppe für mehr Übersicht.</p>`);
  updateNowLine();

  // EPG in Häppchen laden
  const keys = capped.map(c => c.key);
  for (let i = 0; i < keys.length; i += 30) {
    if (token !== guideToken) return;
    const chunk = keys.slice(i, i + 30);
    let grid = {};
    try { grid = await api(`/api/epg/grid?from=${guideStart}&to=${winEnd}&keys=` + encodeURIComponent(chunk.join(","))); }
    catch { continue; }
    if (token !== guideToken) return;
    const now = Date.now() / 1000;
    for (const k of chunk) {
      const band = rows.querySelector(`.g-band[data-key="${CSS.escape(k)}"]`);
      if (!band) continue;
      (grid[k] || []).forEach(p => {
        const s = Math.max(p.start, guideStart), e = Math.min(p.stop, winEnd);
        if (e - s < 60) return;
        const el = document.createElement("div");
        el.className = "g-prog" + (p.start <= now && p.stop > now ? " now" : "");
        el.style.left = (s - guideStart) * PX_PER_SEC + "px";
        el.style.width = Math.max(34, (e - s) * PX_PER_SEC - 4) + "px";
        el.innerHTML = `<div class="p-t">${esc(p.title)}</div><div class="p-s">${fmtHM(p.start)} – ${fmtHM(p.stop)}</div>`;
        el.onclick = () => openProgModal(p, k);
        band.appendChild(el);
      });
      if (!band.children.length)
        band.innerHTML = `<div class="g-prog" style="left:4px;width:${bandW - 12}px;opacity:.45;cursor:default"><div class="p-t">Keine Programmdaten</div></div>`;
    }
  }
}

function updateNowLine() {
  const now = Date.now() / 1000, line = $("guide-nowline");
  const x = (now - guideStart) * PX_PER_SEC;
  if (x < 0 || x > 4 * 3600 * PX_PER_SEC) { line.style.display = "none"; return; }
  line.style.display = "block";
  line.style.left = (240 + x) + "px";
}

function openProgModal(p, chanKey) {
  $("prog-title").textContent = p.title;
  $("prog-time").textContent = fmtDate(p.start) + " · " + fmtHM(p.start) + " – " + fmtHM(p.stop);
  $("prog-desc").textContent = p.desc || "Keine Beschreibung verfügbar.";
  const watch = $("prog-watch");
  const now = Date.now() / 1000;
  watch.classList.toggle("hidden", !(p.start <= now && p.stop > now));
  watch.onclick = () => { closeModal("prog-modal"); playLive(chanKey, guideChannels); };
  $("prog-modal").classList.remove("hidden");
}

/* ============================================================
   Filme & Serien
   ============================================================ */
const vodState = { movie: { group: null }, series: { group: null } };

// Misst nach dem Rendern die erste Kachel. Kollabiert sie (CSS-Konflikt o. Ä.),
// wird ein Notfall-Stil mit Vorrang eingespielt – das Grid heilt sich selbst.
let gridChecked = false;
function gridSelfCheck(grid) {
  requestAnimationFrame(() => {
    const card = grid.querySelector(".poster");
    if (!card) return;
    const h = card.offsetHeight;
    const nm = (card.querySelector(".p-name") || {}).textContent || "";
    jlog("Grid-Kachel: " + h + "px hoch, Name=" + JSON.stringify(nm.slice(0, 30)));
    if (h >= 150 || gridChecked) return;
    gridChecked = true;
    jlog("Grid-Kachel kollabiert – Notfall-Stil aktiviert");
    const st = document.createElement("style");
    st.textContent = `
      .poster-grid{grid-auto-rows:356px!important;align-items:start!important}
      .poster{display:flex!important;flex-direction:column!important;height:356px!important}
      .poster .p-frame{position:relative!important;width:100%!important;height:292px!important;
        flex:none!important;overflow:hidden!important}
      .poster .p-frame img{position:absolute!important;inset:0!important;width:100%!important;
        height:100%!important;object-fit:cover!important;opacity:1!important}
      .poster .p-name{display:block!important;color:#E7ECF5!important;font-size:14px!important;
        min-height:0!important;-webkit-line-clamp:unset!important;max-height:2.8em!important;overflow:hidden!important}
      .poster .p-body{display:block!important;padding:8px 10px!important}`;
    document.head.appendChild(st);
  });
}

// ---------- EPG-Suche im Guide ----------
let guideSearchTimer = 0;
$("guide-search").oninput = e => {
  clearTimeout(guideSearchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $("guide-results").classList.add("hidden"); return; }
  guideSearchTimer = setTimeout(async () => {
    let hits = [];
    try { hits = await api("/api/epg/search?q=" + encodeURIComponent(q)); } catch {}
    const box = $("guide-results");
    box.classList.remove("hidden");
    box.innerHTML = hits.length ? "" : '<p class="muted">Keine Sendung gefunden (Suche umfasst die nächsten 48 Stunden).</p>';
    const now = Date.now() / 1000;
    hits.forEach(hit => {
      const r = document.createElement("div");
      r.className = "row";
      const d = new Date(hit.start * 1000);
      const when = hit.start <= now ? "läuft" :
        d.toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      r.innerHTML = `<div class="r-main"><div class="r-name">${esc(hit.title)}</div>
        <div class="r-sub muted">${esc(hit.chName)} · ${when}</div></div>
        <button class="ghost-btn" data-a="play" title="Sender ansehen">▶</button>
        ${hit.start > now + 120 ? '<button class="ghost-btn" data-a="rem" title="Erinnern">⏰</button>' : ""}`;
      r.querySelector('[data-a="play"]').onclick = () => playLive(hit.key);
      const rb = r.querySelector('[data-a="rem"]');
      if (rb) rb.onclick = async () => {
        await api("/api/reminders", { key: hit.key, title: hit.title, start: hit.start, chName: hit.chName });
        rb.textContent = "✓";
        toast("Erinnerung gesetzt: " + hit.title);
      };
      box.appendChild(r);
    });
  }, 350);
};

// ---------- Erinnerungen ----------
const remNotified = new Set();
async function checkReminders() {
  let rems = [];
  try { rems = await api("/api/reminders"); } catch { return; }
  const now = Date.now() / 1000;
  for (const rm of rems) {
    if (rm.start - now < 90 && rm.start - now > -120 && !remNotified.has(rm.id)) {
      remNotified.add(rm.id);
      showReminderToast(rm);
      api("/api/reminders", { delete: rm.id }).catch(() => {});
    } else if (rm.start < now - 300) {
      api("/api/reminders", { delete: rm.id }).catch(() => {});
    }
  }
}
function showReminderToast(rm) {
  const old = $("rem-toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.id = "rem-toast";
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:90;" +
    "display:flex;gap:14px;align-items:center;background:rgba(12,16,26,.97);border:1px solid rgba(139,92,246,.5);" +
    "border-radius:14px;padding:14px 20px;box-shadow:0 12px 36px rgba(0,0,0,.5)";
  t.innerHTML = `<span>⏰ Gleich: <b>${esc(rm.title)}</b>${rm.chName ? " auf " + esc(rm.chName) : ""}</span>
    <button class="primary-btn" style="padding:6px 14px">Umschalten</button>
    <button class="ghost-btn" style="padding:6px 10px">✕</button>`;
  const btns = t.querySelectorAll("button");
  btns[0].onclick = () => { t.remove(); playLive(rm.key, tvChannels.length ? tvChannels : undefined); };
  btns[1].onclick = () => t.remove();
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 30000);
}
setInterval(checkReminders, 30000);
setTimeout(checkReminders, 4000);

// ---------- EPG-Zuordnung ----------
function openEpgMapModal(ch) {
  let m = $("epgmap-modal");
  if (m) m.remove();
  m = document.createElement("div");
  m.id = "epgmap-modal";
  m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="max-width:480px">
    <div class="modal-head"><span>EPG zuordnen: ${esc(ch.name)}</span><button class="ghost-btn" id="em-close">✕</button></div>
    <div class="pad">
      <input id="em-q" type="text" placeholder="EPG-Kanal suchen (Name oder ID) …" style="width:100%;margin-bottom:10px">
      <div id="em-hits" style="max-height:260px;overflow:auto"></div>
      <button id="em-clear" class="ghost-btn" style="margin-top:10px">Zuordnung entfernen</button>
    </div></div>`;
  document.body.appendChild(m);
  const hits = m.querySelector("#em-hits");
  const search = async q => {
    let list = [];
    try { list = await api("/api/epg/channels?q=" + encodeURIComponent(q)); } catch {}
    hits.innerHTML = list.length ? "" : '<p class="muted">Keine EPG-Kanäle gefunden.</p>';
    list.forEach(c => {
      const b = document.createElement("button");
      b.className = "ghost-btn";
      b.style.cssText = "display:block;width:100%;text-align:left;margin:2px 0";
      b.textContent = (c.name ? c.name + "  ·  " : "") + c.id;
      b.onclick = async () => {
        await api("/api/epgmap", { key: ch.key, tvg: c.id });
        m.remove();
        toast("EPG zugeordnet – Guide wird aktualisiert");
        selectTvChannel(ch, null);
      };
      hits.appendChild(b);
    });
  };
  m.querySelector("#em-q").oninput = e => { if (e.target.value.trim().length >= 2) search(e.target.value.trim()); };
  search(ch.name.replace(/^\W+|\W+$/g, "").split(" ")[0] || "");
  m.querySelector("#em-clear").onclick = async () => {
    await api("/api/epgmap", { key: ch.key, tvg: "" });
    m.remove();
    toast("Zuordnung entfernt");
    selectTvChannel(ch, null);
  };
  m.querySelector("#em-close").onclick = () => m.remove();
}

// ---------- Weiter schauen ----------
async function loadContinueView() {
  const grid = $("continue-grid");
  grid.innerHTML = '<p class="muted" style="padding:6px">Lade …</p>';
  let items = [];
  try { items = await api("/api/continue"); } catch {}
  $("continue-count").textContent = items.length;
  if (!items.length) {
    grid.innerHTML = '<p class="muted" style="padding:14px">Hier erscheinen Filme und Serien, die du angefangen hast. Sobald du etwas anschaust und mittendrin aufhörst, findest du es hier wieder.</p>';
    return;
  }
  grid.innerHTML = "";
  items.forEach(it => {
    const card = document.createElement("div");
    card.className = "poster continue-card";
    card.innerHTML =
      `<div class="p-frame">${it.logo ? `<img loading="lazy" decoding="async" data-src="${esc(imgUrl(it.logo))}" onload="this.classList.add('loaded')" onerror="this.remove()">` : ""}
         <button class="cw-remove" title="Aus „Weiter schauen“ entfernen">✕</button>
         <span class="cw-kind">${it.kind === "series" ? "Serie" : "Film"}</span>
         <span class="p-progress"><i style="width:${it.pct}%"></i></span>
         <span class="cw-play">▶</span>
       </div>
       <div class="p-body"><div class="p-name" title="${esc(it.title)}">${esc(it.title)}</div>
       <div class="p-meta">${it.kind === "series" && it.sub ? esc(it.sub) + " · " : ""}${it.pct}% gesehen</div></div>`;
    const im = card.querySelector("img");
    if (im) lazyImgObserver.observe(im);
    // Klick/OK: am TV Aktionsmenü (Fortsetzen/Entfernen), am PC direkt fortsetzen
    const openOrResume = () => {
      if (document.documentElement.classList.contains("tv-mode")) openCwAction(it);
      else resumeContinue(it);
    };
    card.querySelector(".p-frame").onclick = e => {
      if (e.target.closest(".cw-remove")) return;
      openOrResume();
    };
    card.querySelector(".p-name").onclick = openOrResume;
    card.querySelector(".cw-remove").onclick = async e => {
      e.stopPropagation();
      card.style.opacity = "0.3";
      await removeContinueItem(it);
      card.remove();
      const n = grid.querySelectorAll(".continue-card").length;
      $("continue-count").textContent = n;
      if (!n) loadContinueView();
    };
    grid.appendChild(card);
  });
}

async function removeContinueItem(it) {
  const body = it.kind === "series" ? { serKey: it.serKey } : { key: it.key };
  try { await api("/api/continue/remove", body); } catch (e) {}
}
let cwCurrent = null;
function openCwAction(it) {
  cwCurrent = it;
  $("cw-action-title").textContent = it.title || "Weiter schauen";
  $("cw-action").classList.remove("hidden");
  setTimeout(() => { try { $("cw-resume").focus(); } catch (e) {} }, 30);
}
function closeCwAction() { $("cw-action").classList.add("hidden"); }
$("cw-cancel").onclick = closeCwAction;
$("cw-resume").onclick = () => { const it = cwCurrent; closeCwAction(); if (it) resumeContinue(it); };
$("cw-delete").onclick = async () => {
  const it = cwCurrent; closeCwAction();
  if (!it) return;
  await removeContinueItem(it);
  loadContinueView();
};
let cwClearArmed = false, cwClearTimer = 0;
$("continue-clear").onclick = async () => {
  const btn = $("continue-clear");
  if (!cwClearArmed) {
    cwClearArmed = true; btn.textContent = "Wirklich alle entfernen?";
    cwClearTimer = setTimeout(() => { cwClearArmed = false; btn.textContent = "🗑 Alle entfernen"; }, 4000);
    return;
  }
  clearTimeout(cwClearTimer); cwClearArmed = false; btn.textContent = "🗑 Alle entfernen";
  let items = []; try { items = await api("/api/continue"); } catch (e) {}
  for (const it of items) await removeContinueItem(it);
  loadContinueView();
};

function resumeContinue(it) {
  if (it.kind === "movie") {
    // Film direkt an gespeicherter Stelle fortsetzen
    playVod({ key: it.key, name: it.title, logo: it.logo },
      it.playUrl ? { url: it.playUrl, title: it.title, watchKey: it.key } : null);
  } else {
    // Serie: das Serien-Fenster öffnen, dort ist die laufende Folge als „Als Nächstes“ markiert
    openSeriesModal({ key: it.serKey, name: it.serName || it.title, logo: it.logo });
  }
}

// ---------- Merkliste & Sehstatus im Grid ----------
let wlSet = new Set(), watchAll = {};
async function refreshVodMeta() {
  try { wlSet = new Set(await api("/api/watchlist")); } catch {}
  try { watchAll = await api("/api/watch?key=all"); } catch {}
}

async function renderSeriesResume() {
  let bar = $("series-resume");
  try {
    const last = await api("/api/watch?key=last");
    if (!last || !last.playUrl) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "series-resume";
      $("series-grid").insertAdjacentElement("beforebegin", bar);
    }
    bar.innerHTML =
      `<div class="resume-card">
         <div class="rc-ico">▶</div>
         <div class="rc-main"><div class="rc-name">${esc(last.serName || last.title || "Weiterschauen")}</div>
         <div class="rc-sub muted">${esc(last.title || "")} · fortsetzen bei ${fmtTime(last.pos || 0)}</div></div>
         <button class="primary-btn">Weiterschauen</button>
       </div>`;
    bar.querySelector("button").onclick = () =>
      playVod(null, { url: last.playUrl, title: last.title, watchKey: last.key, serKey: last.serKey, serName: last.serName });
  } catch { if (bar) bar.remove(); }
}

async function loadVodView(kind) {
  const pfx = kind === "movie" ? "movies" : "series";
  // Beim Betreten immer mit der Kategorienansicht starten (Posterseite zu).
  const lay = document.querySelector("#view-" + pfx + " .vod-layout");
  if (lay) lay.classList.remove("grid-open");
  vodGridOpenKind = null;
  if (kind === "series") renderSeriesResume();
  const gbox = $(pfx + "-groups");
  let groups = [];
  const metaP = refreshVodMeta();
  try { groups = await api("/api/vod?kind=" + kind); } catch {}
  await metaP;
  if (wlSet.size) groups = [{ name: "★ Merkliste", count: "", __wl: true }, ...groups];
  gbox.innerHTML = "";
  if (!groups.length) {
    gbox.innerHTML = '<p class="muted" style="padding:14px">Keine Inhalte – deine Playlist enthält ' + (kind === "movie" ? "keine Filme." : "keine Serien.") + "</p>";
    $(pfx + "-grid").innerHTML = "";
    $(pfx + "-count").textContent = "";
    return;
  }
  const mk = (name, label, count) => {
    const r = document.createElement("div");
    r.className = "row";
    r.innerHTML = `<div class="r-main"><div class="r-name">${esc(label)}</div></div><span class="r-count">${count ?? ""}</span>`;
    r.onclick = () => {
      gbox.querySelectorAll(".row").forEach(x => x.classList.remove("active"));
      r.classList.add("active");
      vodState[kind].group = name;
      loadVodItems(kind, name, label);
      openVodGrid(kind);   // eigene Posterseite (nur Poster) öffnen
    };
    gbox.appendChild(r);
    return r;
  };
  const total = groups.reduce((a, g) => a + g.count, 0);
  const all = mk("__all__", kind === "movie" ? "Alle Filme" : "Alle Serien", total);
  groups.forEach(g => mk(g.name, esc(g.name), g.count));
  // Suchfeld beim Betreten des Bereichs leeren (Wert, ohne Handler neu zu setzen)
  const sInput = $(pfx + "-search");
  if (sInput && document.activeElement !== sInput) sInput.value = "";
  // Beim Betreten NUR die Kategorien zeigen + „Alle" vorladen – die Posterseite
  // öffnet sich erst, wenn der Nutzer eine Kategorie wählt.
  all.classList.add("active");
  vodState[kind].group = "__all__";
  loadVodItems(kind, "__all__", kind === "movie" ? "Alle Filme" : "Alle Serien");
}

let vodGridOpenKind = null;
function vodViewSel(kind) { return "#view-" + (kind === "movie" ? "movies" : "series") + " .vod-layout"; }

// Eigene Posterseite öffnen: Kategorienspalte ausblenden, nur Poster zeigen.
function openVodGrid(kind) {
  const layout = document.querySelector(vodViewSel(kind));
  if (!layout) return;
  layout.classList.add("grid-open");
  vodGridOpenKind = kind;
  setTimeout(() => { try { window.EXTV && EXTV.refocus(); } catch (e) {} }, 80);
}
function closeVodGrid() {
  if (!vodGridOpenKind) return;
  const layout = document.querySelector(vodViewSel(vodGridOpenKind));
  if (layout) layout.classList.remove("grid-open");
  vodGridOpenKind = null;
  setTimeout(() => { try { window.EXTV && EXTV.refocus(); } catch (e) {} }, 80);
}
window.EXVOD = { isGridOpen: () => !!vodGridOpenKind, closeGrid: () => closeVodGrid() };

// Suchfelder EINMALIG verdrahten – nicht bei jedem Ansichtswechsel, damit
// Fokus und Eingabe während des Tippens nie verloren gehen.
function wireVodSearch(kind) {
  const pfx = kind === "movie" ? "movies" : "series";
  const sInput = $(pfx + "-search");
  if (!sInput || sInput._wired) return;
  sInput._wired = true;
  let sTimer = 0;
  sInput.addEventListener("input", () => {
    clearTimeout(sTimer);
    const q = sInput.value.trim();
    sTimer = setTimeout(() => {
      if (q.length < 2) {
        const gbox = $(pfx + "-groups");
        const act = gbox.querySelector(".row.active");
        const name = (vodState[kind] && vodState[kind].group) || "__all__";
        loadVodItems(kind, name, act ? act.querySelector(".r-name").textContent : (kind === "movie" ? "Alle Filme" : "Alle Serien"));
      } else {
        runVodSearch(kind, q);
      }
    }, 280);
  });
}
wireVodSearch("movie");
wireVodSearch("series");

// Tolerante Suche im aktuellen Bereich: lädt alle Titel und filtert nach Wörtern.
const vodAllCache = {};
function foldText(x) {
  return (x || "").toLowerCase()
    .replace(/[äàâá]/g, "a").replace(/[öòôó]/g, "o").replace(/[üùûú]/g, "u").replace(/ß/g, "ss")
    .replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i").replace(/[çć]/g, "c").replace(/[ñ]/g, "n")
    .replace(/[šžčđ]/g, m => ({ "š": "s", "ž": "z", "č": "c", "đ": "d" }[m]))
    .replace(/[^a-z0-9]+/g, " ").trim();
}
async function runVodSearch(kind, q) {
  const pfx = kind === "movie" ? "movies" : "series";
  const grid = $(pfx + "-grid");
  $(pfx + "-title").textContent = "Suche: „" + q + "“";
  grid.innerHTML = '<p class="muted" style="padding:6px">Suche …</p>';
  if (!vodAllCache[kind]) {
    try { vodAllCache[kind] = await api(`/api/vod?kind=${kind}&group=__all__`); }
    catch { vodAllCache[kind] = []; }
  }
  const tokens = foldText(q).split(" ").filter(Boolean);
  const hits = vodAllCache[kind].filter(v => {
    const n = " " + foldText(v.name) + " ";
    return tokens.every(t => n.includes(t));
  });
  $(pfx + "-count").textContent = hits.length;
  vodCurrent[kind] = { items: hits, mode: "search", group: "", label: "Suche: „" + q + "“", query: q };
  $(pfx + "-sort").value = vodSortMode;
  renderVodGrid(kind, sortVodItems(hits));
}

let vodSortMode = "standard", vodSortApply = null;
function sortVodItems(items) {
  const m = vodSortMode;
  const arr = [...items];
  if (m === "name") return arr.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true }));
  if (m === "jahr") return arr.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0) || a.name.localeCompare(b.name, "de"));
  if (m === "datum") return arr.sort((a, b) => (b.added || 0) - (a.added || 0) || a.name.localeCompare(b.name, "de"));
  if (m === "bewertung") return arr.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0) || a.name.localeCompare(b.name, "de"));
  if (m === "genre") return arr.sort((a, b) => (a.group || "").localeCompare(b.group || "", "de") || a.name.localeCompare(b.name, "de"));
  return items;
}

// Merkt sich, was gerade angezeigt wird, damit Umsortieren ohne Neuladen geht.
const vodCurrent = { movie: { items: [], mode: "category", group: "__all__", label: "Alle Filme", query: "" },
                     series: { items: [], mode: "category", group: "__all__", label: "Alle Serien", query: "" } };

async function loadVodItems(kind, group, label) {
  if (group === "★ Merkliste") group = "__watchlist__";
  const pfx = kind === "movie" ? "movies" : "series";
  $(pfx + "-title").textContent = label;
  const grid = $(pfx + "-grid");
  grid.innerHTML = '<p class="muted" style="padding:6px">Lade …</p>';
  let rawItems = [];
  try { rawItems = await api(`/api/vod?kind=${kind}&group=` + encodeURIComponent(group)); } catch {}
  $(pfx + "-count").textContent = rawItems.length;
  vodCurrent[kind] = { items: rawItems, mode: "category",
    group: group === "__watchlist__" ? "★ Merkliste" : group, label, query: "" };
  const sortSel = $(pfx + "-sort");
  sortSel.value = vodSortMode;
  renderVodGrid(kind, sortVodItems(rawItems));
}

// Sortierauswahl gilt für die aktuelle Ansicht – egal ob Kategorie oder Suche.
function applyVodSort(kind) {
  const pfx = kind === "movie" ? "movies" : "series";
  vodSortMode = $(pfx + "-sort").value;
  const cur = vodCurrent[kind];
  renderVodGrid(kind, sortVodItems(cur.items));
}
$("movies-sort").addEventListener("change", () => applyVodSort("movie"));
$("series-sort").addEventListener("change", () => applyVodSort("series"));

// Gemeinsame Kachel-Darstellung für Kategorie-Ansicht und Suche.
function renderVodGrid(kind, items) {
  const pfx = kind === "movie" ? "movies" : "series";
  const grid = $(pfx + "-grid");
  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = '<p class="muted" style="padding:14px">Keine Treffer.</p>';
    return;
  }
  const BATCH = 150;
  let pos = 0;
  const token = (grid._token = (grid._token || 0) + 1);
  function renderBatch() {
    if (grid._token !== token) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(items.length, pos + BATCH);
    for (; pos < end; pos++) {
      const v = items[pos];
      const card = document.createElement("div");
      card.className = "poster";
      const wm = watchAll[v.key] || {};
      const inWl = wlSet.has(v.key);
      card.innerHTML =
        `<div class="p-frame">${v.logo ? `<img loading="lazy" decoding="async" data-src="${esc(imgUrl(v.logo))}" onload="this.classList.add('loaded')" onerror="this.remove()">` : ""}
           <button class="wl-btn ${inWl ? "on" : ""}" title="${inWl ? "Von Merkliste entfernen" : "Auf die Merkliste"}">${inWl ? "★" : "☆"}</button>
           ${wm.done ? '<span class="seen-badge">✓ Gesehen</span>' : ""}
           ${!wm.done && wm.pct ? `<span class="p-progress"><i style="width:${wm.pct}%"></i></span>` : ""}
         </div>
         <div class="p-body"><div class="p-name" title="${esc(v.name)}">${esc(v.name)}</div>
         <div class="p-meta">${esc(v.year || "")}${v.rating ? " · ★ " + esc(v.rating) : ""}</div></div>`;
      const im = card.querySelector("img");
      if (im) lazyImgObserver.observe(im);
      const wb = card.querySelector(".wl-btn");
      wb.onclick = async e => {
        e.stopPropagation();
        const on = !wlSet.has(v.key);
        if (on) wlSet.add(v.key); else wlSet.delete(v.key);
        wb.classList.toggle("on", on);
        wb.textContent = on ? "★" : "☆";
        api("/api/watchlist", { key: v.key, on }).catch(() => {});
      };
      card.onclick = () => kind === "movie" ? playVod(v) : openSeriesModal(v);
      frag.appendChild(card);
    }
    grid.appendChild(frag);
    if (pos <= BATCH) gridSelfCheck(grid);
    if (pos < items.length) {
      const sentinel = document.createElement("div");
      sentinel.style.cssText = "grid-column:1/-1;height:1px";
      grid.appendChild(sentinel);
      new IntersectionObserver((es, obs) => {
        if (es.some(e => e.isIntersecting)) { obs.disconnect(); sentinel.remove(); renderBatch(); }
      }, { rootMargin: "1400px" }).observe(sentinel);
    }
  }
  renderBatch();
}

function epDescriptor(v, sn, ep) {
  const epn = ep.episode_num ?? ep.episodeNum ?? "";
  const ext = ep.container_extension || "mp4";
  return {
    url: `/v/${encodeURIComponent(v.key)}/${encodeURIComponent(ep.id)}.${ext}`,
    title: v.name + " – S" + sn + (epn ? "E" + epn : "") + (ep.title ? " · " + ep.title : ""),
    short: "S" + sn + (epn ? "E" + epn : "") + (ep.title ? " · " + ep.title : ""),
    watchKey: ep.id, serKey: v.key, serName: v.name, epId: ep.id, epExt: ext,
  };
}

async function openSeriesModal(v) {
  $("series-name").textContent = v.name;
  $("series-meta").textContent = "Lade Folgen …";
  $("series-cover").src = v.logo || "/assets/favicon-192.png";
  $("series-seasons").innerHTML = "";
  $("series-modal").classList.remove("hidden");
  let data;
  const metaP = refreshVodMeta();
  try { data = await api("/api/series?key=" + encodeURIComponent(v.key)); }
  catch (e) { $("series-meta").textContent = "Folgen konnten nicht geladen werden: " + e.message; return; }
  await metaP;
  const info = data.info || {};
  $("series-meta").textContent = [info.genre, info.releaseDate || info.release_date, info.plot && String(info.plot).slice(0, 140)].filter(Boolean).join(" · ") || "Serie";
  const box = $("series-seasons");
  let eps = data.episodes || {};
  let seasons = Array.isArray(eps)
    ? eps.map((arr, i) => [String(i + 1), arr]).filter(x => Array.isArray(x[1]) && x[1].length)
    : Object.entries(eps).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!seasons.length) { box.innerHTML = '<p class="muted" style="padding:12px">Keine Folgen gefunden.</p>'; return; }
  // Geordnete Gesamtfolge über alle Staffeln: Grundlage für „Nächste Folge“
  const queue = [];
  for (const [sn, list] of seasons) (list || []).forEach(ep => queue.push(epDescriptor(v, sn, ep)));
  queue.forEach((d, i) => { d.queue = queue; d.qIdx = i; });
  // „Als Nächstes“: erste angefangene, sonst erste ungesehene Folge
  let nextIdx = queue.findIndex(d => watchAll[d.watchKey] && !watchAll[d.watchKey].done);
  if (nextIdx < 0) nextIdx = queue.findIndex(d => !watchAll[d.watchKey]);
  let qi = 0;
  for (const [sn, list] of seasons) {
    box.insertAdjacentHTML("beforeend", `<div class="season-head">Staffel ${esc(sn)}</div>`);
    (list || []).forEach(ep => {
      const d = queue[qi];
      const idx = qi;
      qi++;
      const r = document.createElement("div");
      r.className = "row";
      const epn = ep.episode_num ?? ep.episodeNum ?? "";
      const wm = watchAll[d.watchKey] || {};
      const status = wm.done
        ? '<span class="ep-seen" title="Gesehen">✓</span>'
        : wm.pct ? `<span class="ep-prog" title="${wm.pct}% gesehen"><i style="width:${wm.pct}%"></i></span>` : "";
      const isNext = idx === nextIdx;
      if (isNext) r.classList.add("ep-next");
      r.innerHTML = `<span class="r-num">${esc(epn)}</span>
        <div class="r-main"><div class="r-name">${esc(ep.title || "Folge " + epn)}${isNext ? ' <span class="ep-next-tag">Als Nächstes</span>' : ""}</div>
        <div class="r-sub">${esc((ep.info && (ep.info.duration || ep.info.releasedate)) || "")}</div></div>
        ${status}
        <span class="c-play" style="background:var(--grad);-webkit-background-clip:text;color:transparent">▶</span>`;
      r.onclick = () => { closeModal("series-modal"); playVod(v, d); };
      box.appendChild(r);
    });
  }
  const nx = box.querySelector(".ep-next");
  if (nx) nx.scrollIntoView({ block: "center" });
}

/* ============================================================
   Suche
   ============================================================ */
let searchTimer = 0;
$("search-input").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});
async function runSearch() {
  const q = $("search-input").value.trim();
  const box = $("search-results");
  if (q.length < 2) { box.innerHTML = '<p class="muted">Mindestens zwei Zeichen eingeben …</p>'; return; }
  let res = { channels: [], vod: [] };
  try { res = await api("/api/search?q=" + encodeURIComponent(q)); } catch {}
  box.innerHTML = "";
  if (res.channels.length) {
    box.insertAdjacentHTML("beforeend", `<h3>Sender (${res.channels.length})</h3><div class="result-grid" id="sr-ch"></div>`);
    const g = $("sr-ch");
    res.channels.forEach(c => { const r = channelRow(c); r.onclick = () => playLive(c.key, res.channels); g.appendChild(r); });
  }
  if (res.vod.length) {
    box.insertAdjacentHTML("beforeend", `<h3>Filme & Serien (${res.vod.length})</h3><div class="result-grid" id="sr-vod"></div>`);
    const g = $("sr-vod");
    res.vod.forEach(v => {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML = `<img class="r-logo" data-src="${esc(v.logo || "")}" onerror="this.style.visibility='hidden'">
        <div class="r-main"><div class="r-name">${esc(v.name)}</div>
        <div class="r-sub">${v.kind === "movie" ? "Film" : "Serie"} · ${esc(v.group)}</div></div>`;
      lazyImgObserver.observe(r.querySelector("img"));
      r.onclick = () => v.kind === "movie" ? playVod(v) : openSeriesModal(v);
      g.appendChild(r);
    });
  }
  if (!res.channels.length && !res.vod.length) box.innerHTML = '<p class="muted">Nichts gefunden für „' + esc(q) + '“.</p>';
}

/* ============================================================
   Aufnahmen
   ============================================================ */
let recsTimer = 0;
async function loadRecsView() {
  let data = { files: [], active: [], dir: "" };
  try { data = await api("/api/recordings"); } catch {}
  $("recs-dir").textContent = data.dir ? " · " + data.dir : "";
  const list = $("recs-list");
  list.innerHTML = "";
  (data.active || []).forEach(j => {
    const r = document.createElement("div");
    r.className = "row";
    r.innerHTML = `<span style="color:var(--danger)">●</span>
      <div class="r-main"><div class="r-name">${esc(j.name)}</div>
      <div class="r-sub">Aufnahme läuft · ${fmtBytes(j.bytes)}</div></div>
      <button class="ghost-btn">Stopp</button>`;
    r.querySelector("button").onclick = async () => { await api("/api/record/stop", { id: j.id }); toast("Aufnahme gestoppt"); loadRecsView(); };
    list.appendChild(r);
  });
  (data.files || []).forEach(f => {
    if ((data.active || []).some(j => j.file === f.name)) return;
    const r = document.createElement("div");
    r.className = "row";
    r.innerHTML = `<span class="r-num">▶</span>
      <div class="r-main"><div class="r-name">${esc(f.name)}</div>
      <div class="r-sub">${fmtBytes(f.size)} · ${new Date(f.mtime * 1000).toLocaleString("de-DE")}</div></div>
      <button class="ghost-btn">Löschen</button>`;
    r.onclick = e => { if (e.target.tagName !== "BUTTON") playRecording(f.name); };
    r.querySelector("button").onclick = async () => {
      if (!confirm("„" + f.name + "“ wirklich löschen?")) return;
      await api("/api/recordings/delete", { name: f.name });
      loadRecsView();
    };
    list.appendChild(r);
  });
  if (!list.children.length) list.innerHTML = '<p class="muted">Noch keine Aufnahmen. Starte eine mit ● im Player oder plane eine unten.</p>';
  renderRecPlans();
  clearTimeout(recsTimer);
  if ((data.active || []).length && currentView === "recs") recsTimer = setTimeout(loadRecsView, 3000);
}

/* ============================================================
   Player
   ============================================================ */
// Frontend-Ringlog für die Diagnose
const jsLog = [];
function jlog(msg) {
  const t = new Date().toLocaleTimeString("de-DE");
  jsLog.push(t + " " + msg);
  if (jsLog.length > 80) jsLog.shift();
}
window.addEventListener("error", e => jlog("JS-Fehler: " + (e.message || e.type) + " @" + (e.filename || "").split("/").pop() + ":" + (e.lineno || "")));
window.addEventListener("unhandledrejection", e => jlog("Promise-Fehler: " + (e.reason && e.reason.message || e.reason)));

let engine = null;             // {kind:'hls'|'ts'|'native', h|p}
let playerMode = null;         // 'live' | 'vod'
let playerCtx = { key: null, list: [], idx: -1, title: "", url: "" };
let restartAttempts = 0, restartTimer = 0, stallTimer = 0, bootTimer = 0, healthTimer = 0, lastT = -1, stallCount = 0, everPlayed = false;
// Standbild-Wächter: erkennt eingefrorenes Bild auch bei gefülltem Puffer
let freezeTimer = 0, freezeT = -1, freezeCount = 0, freezeStrikes = 0, lastFreezeAt = 0, freezeFrames = -1;
let osdTimer = 0, clockTimer = 0, epgOsdTimer = 0;
let recJob = null;
let audioGraph = null;         // {ctx, src, comp, gain, on}

const ACCENTS = {
  violett:  ["#8B5CF6", "#22D3EE"],
  cyan:     ["#38BDF8", "#818CF8"],
  smaragd:  ["#34D399", "#22D3EE"],
  amber:    ["#F59E0B", "#F97316"],
  magenta:  ["#E879F9", "#8B5CF6"],
};
function applyAccent() {
  const [a, b] = ACCENTS[st().accent] || ACCENTS.violett;
  document.documentElement.style.setProperty("--acc1", a);
  document.documentElement.style.setProperty("--acc2", b);
}
function applyShowNums() {
  document.body.classList.toggle("hide-nums", st().showNums === false);
}

// Selbsttest der Abspielbibliotheken
try {
  jlog("hls.js: " + (window.Hls ? (Hls.isSupported() ? "bereit (v" + Hls.version + ")" : "GELADEN, ABER NICHT UNTERSTÜTZT") : "NICHT GELADEN"));
} catch (e) { jlog("hls.js-Test: " + e.message); }
try {
  jlog("mpegts.js: " + (window.mpegts ? (mpegts.getFeatureList().mseLivePlayback ? "bereit (v" + mpegts.version + ")" : "GELADEN, ABER MSE-LIVE NICHT UNTERSTÜTZT") : "NICHT GELADEN"));
} catch (e) { jlog("mpegts.js-Test: " + e.message); }

function stopEngine() {
  clearTimeout(restartTimer);
  clearTimeout(bootTimer);
  clearInterval(stallTimer);
  clearInterval(freezeTimer);
  if (engine) {
    try {
      if (engine.kind === "hls" && engine.h) engine.h.destroy();
      else if (engine.p) { engine.p.pause(); engine.p.unload(); engine.p.detachMediaElement(); engine.p.destroy(); }
    } catch {}
    engine = null;
  }
  try { video.pause(); video.removeAttribute("src"); video.load(); } catch {}
}

// Standbild-Wächter: erkennt ein eingefrorenes Bild auch dann, wenn der Puffer
// noch gefüllt ist (readyState >= 3). Der normale Stillstands-Wächter hält einen
// Sender mit Daten für "gesund" – ein echtes Standbild (Zeit bewegt sich nicht,
// obwohl nicht pausiert) würde er übersehen. Dieser Wächter greift genau dann:
// erst Wiederherstellung, nach drei erfolglosen Anläufen der nächste Sender.
function startFreezeWatch() {
  clearInterval(freezeTimer);
  freezeT = -1; freezeCount = 0; freezeFrames = -1;
  freezeTimer = setInterval(() => {
    if (!playerCtx.url || video.paused || playerMode !== "live" || !everPlayed) {
      freezeT = video.currentTime; freezeCount = 0; freezeFrames = -1; return;
    }
    // Zahl der tatsächlich DEKODIERTEN Bilder lesen – das zuverlässigste Signal
    // für ein echtes, laufendes Bild. Ein hängender Decoder liefert keine neuen
    // Bilder mehr, obwohl Abspielzeit und Puffer "in Ordnung" aussehen.
    let frames = -1;
    try {
      const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
      if (q && typeof q.totalVideoFrames === "number") frames = q.totalVideoFrames;
    } catch {}
    const timeMoved = Math.abs(video.currentTime - freezeT) > 0.05;
    freezeT = video.currentTime;
    // Kommen neue Bilder an? Wenn die Bildzählung fehlt, ersatzweise die Zeit.
    const framesMoved = frames < 0 ? timeMoved : (frames !== freezeFrames);
    freezeFrames = frames;

    if (framesMoved) {
      freezeCount = 0;
      // Lange ohne Standbild gelaufen → Strike-Zähler zurücksetzen.
      if (lastFreezeAt && Date.now() - lastFreezeAt > 30000) { freezeStrikes = 0; lastFreezeAt = 0; }
      return;
    }
    // Keine neuen Bilder, obwohl nicht pausiert → eingefroren.
    freezeCount++;
    if (freezeCount >= 3) {            // ~6 s ohne neues Bild
      freezeCount = 0;
      lastFreezeAt = Date.now();
      registerStall();
      freezeStrikes++;
      if (freezeStrikes >= 3) {
        freezeStrikes = 0;
        jlog("Standbild bleibt bestehen – weiter zum nächsten Sender");
        skipToNextChannel("Standbild");
      } else {
        jlog("Standbild erkannt (" + freezeStrikes + "/3) – Wiederherstellung");
        softReconnectLive();
      }
    }
  }, 2000);
}

function spinner(on, text) {
  $("player-spinner").classList.toggle("hidden", !on);
  if (text) $("player-spinner-text").textContent = text;
  if (on) $("player-error").classList.add("hidden");
}

function applyEnhance(mode) {
  video.classList.remove("fx-klar", "fx-kino", "fx-brillant");
  if (mode && mode !== "aus") video.classList.add("fx-" + mode);
  document.querySelectorAll("#enhance-menu button").forEach(b => b.classList.toggle("on", b.dataset.fx === mode));
  $("pl-enhance").classList.toggle("on", mode !== "aus");
}

function setupAudioBoost(on) {
  try {
    if (!audioGraph) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(video);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -28; comp.knee.value = 22; comp.ratio.value = 9;
      comp.attack.value = 0.005; comp.release.value = 0.28;
      const gain = ctx.createGain(); gain.gain.value = 1.35;
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = (st().audioDelayMs || 0) / 1000;
      audioGraph = { ctx, src, comp, gain, delay, on: false };
    }
    const g = audioGraph;
    try { g.src.disconnect(); g.comp.disconnect(); g.gain.disconnect(); g.delay.disconnect(); } catch {}
    // Kette: Quelle -> [Kompressor+Anhebung wenn an] -> Verzögerung -> Ausgabe
    if (on) { g.src.connect(g.comp); g.comp.connect(g.gain); g.gain.connect(g.delay); }
    else g.src.connect(g.delay);
    g.delay.connect(g.ctx.destination);
    g.on = on;
    g.ctx.resume().catch(() => {});
    $("pl-audio").classList.toggle("on", on);
  } catch { /* WebAudio nicht verfügbar */ }
}

function setAudioDelay(ms) {
  st().audioDelayMs = ms;
  saveSettings();
  try {
    if (!audioGraph) setupAudioBoost(!!st().audioBoost);
    if (audioGraph) audioGraph.delay.delayTime.value = ms / 1000;
  } catch {}
}

// Absolute Adresse: die Lade-Worker der Player können relative Pfade nicht auflösen.
const absUrl = u => new URL(u, location.href).href;
// Externe Bilder über den Server holen (richtige Kennung + Platten-Cache)
const imgUrl = u => u && /^https?:\/\//i.test(u) ? "/img?u=" + encodeURIComponent(u) : (u || "");

// Wiedergabestufen: 0 = direkt, 1 = anderes Format (TS<->HLS),
// 2 = ffmpeg wandelt den Ton in lokales HLS (AAC), 3 = ffmpeg wandelt Bild+Ton (H.264).
function resolveStage() {
  if (playerMode !== "live" || !playerCtx.key) return { url: playerCtx.url, kind: playerCtx.kind };
  const alt = playerCtx.baseKind === "ts" ? "hls" : "ts";
  const k = encodeURIComponent(playerCtx.key);
  const back = (playerCtx.tsBack || 0) > 2 ? (playerCtx.baseUrl.includes("?") ? "&" : "?") + "back=" + Math.round(playerCtx.tsBack) : "";
  switch (playerCtx.stage || 0) {
    case 1:  return { url: playerCtx.baseUrl + back, kind: alt };
    case 2:  return { url: "/x/" + k + "/index.m3u8", kind: "hls" };
    case 3:  return { url: "/x/" + k + "/index.m3u8?m=h264", kind: "hls" };
    default: return { url: playerCtx.baseUrl + back, kind: playerCtx.baseKind };
  }
}

function nextStage(cur) {
  let order = playerCtx.ffmpegOk ? [0, 1, 2, 3] : [0, 1];
  // Hochauflösend (4K/UHD/FHD): Vollwandlung auslassen – sie schafft die
  // Echtzeit nicht und liefert ein schwarzes Bild. Tonumwandlung reicht das
  // Originalbild unverändert durch und ist daher die sinnvolle Endstufe.
  if (playerCtx.hires) order = playerCtx.ffmpegOk ? [0, 1, 2] : [0, 1];
  const i = order.indexOf(cur);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : -1;
}

const STAGE_NAMES = ["Direkt", "Anderes Format", "Tonumwandlung", "Vollwandlung"];

function startEngine() {
  // --- Native Wiedergabe (Android-TV-Hülle): Video läuft im nativen
  //     ExoPlayer statt im Browserfenster. Ein hängender Stream kann so die
  //     Oberfläche NICHT mehr einfrieren, und das Weiterschalten nach drei
  //     Fehlversuchen übernimmt der native Player. ---
  if (window.AndroidPlayer && (playerMode === "live" || playerMode === "vod")) {
    stopEngine();
    spinner(false);
    try {
      if (playerMode === "live") {
        window.AndroidPlayer.play(
          absUrl(playerCtx.baseUrl),
          playerCtx.title || "",
          playerCtx.key || "",
          playerCtx.baseKind || "ts"
        );
      } else if (window.AndroidPlayer.playVod) {
        // Film/Serie nativ abspielen (echtes Spulen, hardwarebeschleunigt).
        const resume = Math.max(0, Math.floor(playerCtx.resumeSec || playerCtx.nativePos || 0));
        window.AndroidPlayer.playVod(
          absUrl(playerCtx.url),
          playerCtx.title || "",
          playerCtx.watchKey || "",
          playerCtx.kind || "vod",
          resume
        );
        playerCtx.resumeSec = 0; // Fortsetz-Punkt nur einmal anwenden
      }
    } catch (e) { jlog("native play: " + e); }
    return;
  }
  stopEngine();
  const stg = playerMode === "live" ? (playerCtx.stage || 0) : 0;
  spinner(true, stg > 0 ? "Verbinde … (Stufe: " + STAGE_NAMES[stg] + ")" : "Verbinde …");
  restartTimer = 0;
  const buf = Math.max(1, Math.min(10, st().bufferSec || 4));
  // Profile: schnell = flinkes Zappen, stabil = maximaler Puffer gegen Ruckler
  const bm = st().bufferMode || "ausgewogen";
  let prof = {
    schnell:    { sync: 2,       maxBuf: 20, stash: false, stashKB: 64,        chase: true  },
    ausgewogen: { sync: buf + 1, maxBuf: 45, stash: true,  stashKB: 256,       chase: false },
    stabil:     { sync: buf + 4, maxBuf: 90, stash: true,  stashKB: buf * 256, chase: false },
  }[bm] || { sync: buf + 1, maxBuf: 45, stash: true, stashKB: 256, chase: false };
  if (bufferBoost > 0) {
    prof = { ...prof, sync: prof.sync + bufferBoost * 3, maxBuf: prof.maxBuf + bufferBoost * 30,
             stash: true, stashKB: Math.max(prof.stashKB, 256) * (1 + bufferBoost), chase: false };
  }
  let { url, kind } = resolveStage();
  url = absUrl(url);
  jlog("Start Stufe " + stg + " (" + kind + "/" + bm + ") " + url);
  try {
  if (kind === "hls" && window.Hls && Hls.isSupported()) {
    const h = new Hls({
      liveSyncDuration: prof.sync,
      liveMaxLatencyDuration: prof.sync + 12,
      maxBufferLength: prof.maxBuf,
      maxMaxBufferLength: 120,
      manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 800,
      levelLoadingMaxRetry: 6, levelLoadingRetryDelay: 800,
      fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 700, fragLoadingMaxRetryTimeout: 16000,
      enableWorker: true, lowLatencyMode: false, backBufferLength: 30,
    });
    h.loadSource(url);
    h.attachMedia(video);
    h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    h.on(Hls.Events.MANIFEST_PARSED, () => {
      try {
        const L = h.levels || [];
        if (L.length < 2) return;
        const wantHi = (st().quality || "hoch") === "hoch";
        const wantFps = (st().fps || "max") === "max";
        if (!wantHi && !wantFps) return;             // Automatik/Quelle -> ABR entscheidet selbst
        let bi = 0, best = -1;
        for (let i = 0; i < L.length; i++) {
          const f = L[i].frameRate || (L[i].attrs && parseFloat(L[i].attrs["FRAME-RATE"])) || 0;
          const sc = (wantFps ? f * 1e7 : 0) + (L[i].height || 0) * 1000 + (L[i].bitrate || 0) / 1000;
          if (sc > best) { best = sc; bi = i; }
        }
        h.nextLevel = bi;                            // höchste Bildrate, dann Auflösung/Bitrate
      } catch (e) {}
    });
    h.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) jlog("hls FATAL " + d.type + "/" + d.details);
      if (!d.fatal) return;
      // Netzwerk-/Medienfehler erst intern beheben, ohne die laufende
      // Wiedergabe sichtbar abzureißen.
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) { h.startLoad(); return; }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); return; }
      // Sonstiger fataler Fehler: nur eingreifen, wenn das Bild wirklich steht.
      const t0 = video.currentTime;
      setTimeout(() => {
        if (video.paused) return;
        if (video.currentTime - t0 > 0.1 || video.readyState >= 3) return;
        scheduleRestart("HLS-Fehler");
      }, 1500);
    });
    engine = { kind: "hls", h };
  } else if (kind === "ts" && window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
    const p = mpegts.createPlayer(
      { type: "mpegts", isLive: true, url },
      {
        enableWorker: true,
        enableStashBuffer: prof.stash,
        stashInitialSize: prof.stashKB * 1024,
        liveBufferLatencyChasing: prof.chase,
        liveBufferLatencyMaxLatency: prof.sync + 8,
        liveBufferLatencyMinRemain: Math.max(1, prof.sync * 0.6),
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30,
        reuseRedirectedURL: true,
        lazyLoad: false,
      });
    p.attachMediaElement(video);
    p.on(mpegts.Events.ERROR, (t, d, info) => {
      jlog("mpegts FEHLER " + t + "/" + d + (info && info.msg ? " " + info.msg : ""));
      // Läuft das Bild trotz Fehler weiter? Dann nicht neu starten – ein
      // einzelner verspäteter Datenblock soll die Wiedergabe nicht abreißen.
      // Erst nach kurzer Prüfung eingreifen, wenn die Zeit wirklich steht.
      const t0 = video.currentTime;
      setTimeout(() => {
        if (video.paused) return;                 // pausiert -> Nutzer, nicht eingreifen
        const moved = video.currentTime - t0 > 0.1;
        const ahead = (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0) - video.currentTime;
        if (moved || video.readyState >= 3 || ahead > 1) {
          // Wiedergabe läuft weiter – Fehler war harmlos, ignorieren.
          return;
        }
        scheduleRestart("Stream-Fehler");
      }, 1500);
    });
    p.load();
    try { const pr = p.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {}
    engine = { kind: "ts", p };
  } else if (kind === "native") {
    video.src = url;
    video.play().catch(e => jlog("native play: " + e.message));
    engine = { kind: "native" };
  } else {
    // Gewünschte Engine nicht verfügbar – sinnlosen Nativ-Versuch überspringen
    jlog("Engine fehlt für " + kind + " (Hls=" + !!window.Hls + ", mpegts=" + !!window.mpegts + ")");
    engine = { kind: "none" };
    scheduleRestart("Player-Bibliothek nicht verfügbar");
    return;
  }
  } catch (e) {
    jlog("startEngine-Ausnahme: " + e.message);
    engine = engine || { kind: "none" };
    scheduleRestart("Player-Fehler: " + e.message);
    return;
  }

  // Anlauf-Wächter: kommt binnen 4 s kein Bild, sofort nächsten Schritt einleiten.
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    if (!video.paused && video.readyState >= 3) return;
    scheduleRestart("Kein Bild");
  }, 4000);
  // Dauerhafter Gesundheits-Monitor: prüft alle 2 s, ob sich das Bild bewegt
  // UND ob der Server den Sender noch für erreichbar hält. Greift auch NACH dem
  // ersten Bild – so wird ein Sender, der kurz läuft und dann abbricht, sicher
  // erkannt und nach kurzer Zeit übersprungen, statt endlos hängen zu bleiben.
  startHealthMonitor();
  startFreezeWatch();

  // Stillstands-Wächter: greift NUR bei echtem, anhaltendem Stillstand ein und
  // reißt einen laufenden Stream niemals nieder. Ein Stream gilt als „läuft",
  // sobald sich die Abspielzeit bewegt ODER genügend Puffer vorhanden ist.
  lastT = -1; stallCount = 0;
  clearInterval(stallTimer);
  stallTimer = setInterval(() => {
    if (!playerCtx.url || video.paused) { lastT = video.currentTime; stallCount = 0; return; }
    const moved = Math.abs(video.currentTime - lastT) > 0.05;
    const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    const ahead = end - video.currentTime;       // wie viel Puffer noch vor uns liegt
    // Läuft die Zeit ODER ist genug Puffer da (readyState>=3) → alles in Ordnung.
    if (moved || video.readyState >= 3 || ahead > 1.5) {
      stallCount = 0;
      // Falls noch ein Spinner sichtbar war, obwohl es längst läuft: wegräumen.
      if (!video.paused && (moved || video.readyState >= 3)) {
        const sp = $("player-spinner");
        if (sp && !sp.classList.contains("hidden")) spinner(false);
      }
      // Lief der Sender seit dem letzten Aussetzer wieder lange stabil, ist er
      // offenbar gesund – Aussetzer-Zähler zurücksetzen.
      if (postPlayFails > 0 && lastFailAt && Date.now() - lastFailAt > 15000) postPlayFails = 0;
      lastT = video.currentTime;
      return;
    }
    // Hier nur, wenn die Zeit steht UND der Puffer praktisch leer ist.
    stallCount++;
    if (playerMode === "live" && stallCount === 1 && ahead > 2) {
      jlog("Hänger – springe ans Pufferende (" + ahead.toFixed(1) + " s)");
      try { video.currentTime = end - 0.6; } catch {}
    } else if (stallCount >= 3) {
      // Drei aufeinanderfolgende Prüfungen (≈13 s) echter Stillstand:
      stallCount = 0;
      registerStall();
      if (everPlayed && playerMode === "live") {
        jlog("Anhaltender Aussetzer – Puffer anheben, Stufe bleibt " + (playerCtx.stage || 0));
        softReconnectLive();
      } else {
        scheduleRestart("Stream hängt");
      }
    } else {
      spinner(true, "Puffern …");
    }
    lastT = video.currentTime;
  }, 4500);
}

// ---------- Timeshift für Live-TV ----------
let tsDepth = 0, tsPoll = 0;
async function pollTsDepth() {
  if (playerMode !== "live") return;
  try { const st = await api("/api/relay/stats"); tsDepth = st.tsDepth || 0; } catch { tsDepth = 0; }
  updateLiveSeekUI();
}
function liveTsAvailable() {
  return playerMode === "live" && (playerCtx.stage || 0) <= 1 && tsDepth > 10;
}
function liveBehind() {
  const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
  return (playerCtx.tsBack || 0) + Math.max(0, end - video.currentTime);
}
function updateLiveSeekUI() {
  if (playerMode !== "live") return;
  const osd = $("osd");
  if (!liveTsAvailable()) { osd.classList.remove("livets"); return; }
  osd.classList.add("livets");
  const behind = liveBehind();
  const v = Math.round(Math.max(0, tsDepth - behind) / tsDepth * 1000);
  if (!seekDrag) { seekBar.value = v; seekBar.style.setProperty("--sk", (v / 10) + "%"); }
  $("sk-cur").textContent = behind > 3 ? "−" + fmtTime(behind) : "LIVE";
  $("sk-dur").innerHTML = behind > 3 ? '<button id="go-live" class="pl-skip" style="border:none;background:none;color:var(--acc2);cursor:pointer;font:inherit;font-weight:700">▶ LIVE</button>' : "LIVE";
  const gl = $("go-live");
  if (gl) gl.onclick = goLive;
}
function goLive() {
  if ((playerCtx.tsBack || 0) > 0) { playerCtx.tsBack = 0; startEngine(); }
  else {
    const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    if (end > 1) try { video.currentTime = end - 0.5; } catch {}
  }
  video.play().catch(() => {});
}
function liveSeekTo(behindTarget) {
  const back = playerCtx.tsBack || 0;
  const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
  const start = video.buffered.length ? video.buffered.start(0) : 0;
  const localBehind = behindTarget - back; // gewünschter Abstand innerhalb der Engine-Sitzung
  if (localBehind >= 0 && end - localBehind >= start + 1) {
    try { video.currentTime = end - localBehind; } catch {}
  } else {
    // außerhalb des Gepufferten: Engine ab Platten-Timeshift neu anwerfen
    playerCtx.tsBack = Math.min(Math.round(behindTarget), Math.max(0, Math.round(tsDepth - 5)));
    jlog("Timeshift: Neustart bei −" + playerCtx.tsBack + " s");
    startEngine();
  }
}

// Adaptiver Puffer: häufen sich Hänger, fährt die App den Puffer selbst hoch.
let stallLog = [], bufferBoost = 0;
function registerStall() {
  if (st().bufferAutoTune === false) return;
  const now = Date.now();
  stallLog = stallLog.filter(t => now - t < 90000);
  stallLog.push(now);
  if (stallLog.length >= 2 && bufferBoost < 2) {
    bufferBoost++;
    stallLog = [];
    jlog("Stabilitätsstufe " + bufferBoost + " – Puffer wird angehoben");
    toast("Verbindung schwankt – Puffer automatisch erhöht");
  }
}

// Sendernummer direkt eintippen (im Player), wie am Fernseher
let numBuf = "", numTimer = 0;
document.addEventListener("keydown", e => {
  if ($("player").classList.contains("hidden") || playerMode !== "live") return;
  if (e.key < "0" || e.key > "9") return;
  numBuf += e.key;
  let el = $("num-osd");
  if (!el) {
    el = document.createElement("div");
    el.id = "num-osd";
    el.style.cssText = "position:absolute;top:18px;right:22px;z-index:30;background:rgba(10,13,22,.85);border:1px solid rgba(139,92,246,.5);border-radius:12px;padding:10px 18px;font-size:26px;font-weight:700;letter-spacing:2px";
    $("player").appendChild(el);
  }
  el.textContent = numBuf;
  clearTimeout(numTimer);
  numTimer = setTimeout(() => {
    const n = parseInt(numBuf, 10);
    numBuf = "";
    el.remove();
    const hit = (playerCtx.list || []).find(c => c.num === n) || tvChannels.find(c => c.num === n);
    if (hit) playLive(hit.key, playerCtx.list && playerCtx.list.length ? playerCtx.list : tvChannels);
    else toast("Kein Sender mit Nummer " + n);
  }, 1300);
});

// Mausrad über dem Bild wechselt den Sender
$("player").addEventListener("wheel", e => {
  if (playerMode !== "live" || !$("osd")) return;
  e.preventDefault();
  (e.deltaY > 0 ? $("pl-next-ch") : $("pl-prev")).click();
}, { passive: false });

function showPlayerError(text) {
  const el = $("player-error");
  el.innerHTML = "";
  el.appendChild(document.createTextNode(text + "  "));
  const b = document.createElement("button");
  b.textContent = "Diagnose";
  b.style.cssText = "margin-left:10px;padding:4px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font:inherit";
  b.onclick = showDiag;
  el.appendChild(b);
  el.classList.remove("hidden");
}

async function showDiag() {
  let box = $("diag-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "diag-box";
    box.style.cssText = "position:absolute;inset:8% 12%;z-index:60;background:#0c0f16f2;border:1px solid #2a3349;border-radius:14px;padding:18px;overflow:auto;font:12px/1.5 Consolas,monospace;color:#cdd6e4;white-space:pre-wrap";
    document.getElementById("player").appendChild(box);
  }
  box.textContent = "Diagnose läuft …";
  box.style.display = "block";
  const close = document.createElement("button");
  close.textContent = "Schließen";
  close.style.cssText = "position:absolute;top:10px;right:12px;padding:5px 14px;border-radius:8px;border:1px solid #3a4663;background:#1a2236;color:#fff;cursor:pointer";
  close.onclick = () => { box.style.display = "none"; };
  try {
    const d = await api("/api/diag?key=" + encodeURIComponent(playerCtx.key));
    const lg = await api("/api/log");
    const lines = (lg.lines || []).slice(-20).join("\n");
    box.textContent = "";
    box.appendChild(close);
    const eng = engine ? engine.kind : "—";
    const ve = video.error ? ("code=" + video.error.code + (video.error.message ? " " + video.error.message : "")) : "—";
    box.appendChild(document.createTextNode(
      "── Sender-Diagnose ──\n" +
      "Stufe:        " + (playerCtx.stage || 0) + " (" + STAGE_NAMES[playerCtx.stage || 0] + ")\n" +
      "Adresse:      " + (d.url || "") + "\n" +
      "Kennung:      " + (d.ua || "") + "\n" +
      "ffmpeg:       " + (d.ffmpeg ? "vorhanden" : "FEHLT") + "\n" +
      (d.fehler ? "Fehler:       " + d.fehler + "\n"
                : "Status:       " + d.status + "\n" +
                  "Content-Type: " + (d.contentType || "—") + "\n" +
                  "Format:       " + d.format + "\n" +
                  "Erste Bytes:  " + d.bytesText + "\n") +
      "\n── Player ──\n" +
      "Engine:       " + eng + "\n" +
      "readyState:   " + video.readyState + "  networkState: " + video.networkState + "\n" +
      "video.error:  " + ve + "\n" +
      "\n── App-Meldungen ──\n" + jsLog.slice(-18).join("\n") +
      "\n\n── Server-Meldungen ──\n" + lines));
  } catch (e) {
    box.textContent = "Diagnose fehlgeschlagen: " + e.message;
    box.appendChild(close);
  }
}

let autoSkipChain = 0; // wie viele Sender in Folge automatisch übersprungen wurden
let postPlayFails = 0; // Aussetzer NACHDEM bereits ein Bild lief
let lastFailAt = 0;
let healthMon = 0, hmLastT = -1, hmStuck = 0, hmServerBad = 0;
// Überwacht laufend Bildbewegung + Server-Status. Erkennt tote/abgebrochene
// Sender zuverlässig – auch wenn vorher schon ein Bild lief.
function startHealthMonitor() {
  clearInterval(healthMon);
  hmLastT = -1; hmStuck = 0; hmServerBad = 0;
  const myKey = playerCtx.key;
  healthMon = setInterval(async () => {
    if (playerMode !== "live" || playerCtx.key !== myKey) { clearInterval(healthMon); return; }
    if (video.paused) { hmLastT = video.currentTime; hmStuck = 0; hmServerBad = 0; return; }
    // 1) Bewegt sich die Abspielzeit? Das ist das verlässlichste Signal – viel
    //    zuverlässiger als readyState (das nach Stream-Ende noch hoch bleibt).
    const moved = Math.abs(video.currentTime - hmLastT) > 0.1;
    hmLastT = video.currentTime;
    if (moved) { hmStuck = 0; }
    else { hmStuck++; }
    // 2) Server fragen, ob der Sender überhaupt noch Daten liefert.
    let serverBad = false;
    try {
      const h = await api("/api/streamhealth?key=" + encodeURIComponent(myKey));
      if (h && h.err) serverBad = true;
    } catch {}
    if (serverBad) hmServerBad++; else hmServerBad = 0;
    if (playerCtx.key !== myKey) return; // inzwischen umgeschaltet

    // Sender abbrechen, wenn: Bild steht seit ~3 s (2 Prüfungen) UND der Server
    // meldet ein Problem – ODER der Server zweimal in Folge „tot" meldet.
    const reallyDead = (hmStuck >= 2 && hmServerBad >= 1) || hmServerBad >= 2;
    if (reallyDead) {
      clearInterval(healthMon);
      jlog("Sender liefert kein Bild mehr (steht " + hmStuck + "×, Server-Fehler " + hmServerBad + "×) – weiter zum nächsten");
      skipToNextChannel("Sender nicht erreichbar");
    }
  }, 1500);
}

// Schaltet ohne Nachfrage zum nächsten Sender; bricht ab, wenn die ganze Liste
// erfolglos durchlaufen wurde (dann Wahl-Karte).
function skipToNextChannel(reason) {
  clearTimeout(restartTimer); restartTimer = 0;
  clearTimeout(bootTimer); clearTimeout(healthTimer); clearInterval(healthMon);
  const list = playerCtx.list || [];
  if (list.length > 1 && autoSkipChain < list.length) {
    autoSkipChain++;
    const idx = list.findIndex(c => c.key === playerCtx.key);
    const next = list[(idx + 1 + list.length) % list.length];
    if (next && next.key) {
      spinner(true, "Sender nicht verfügbar – weiter zum nächsten …");
      restartTimer = setTimeout(() => { restartTimer = 0; playLive(next.key, list); }, 350);
      return;
    }
  }
  autoSkipChain = 0;
  spinner(false);
  showChannelFailed(reason || "Sender nicht erreichbar");
}

function scheduleRestart(reason) {
  if (restartTimer) return;
  restartAttempts++;
  // Kam bisher kein Bild an: zwei schnelle Versuche auf der Direktstufe, dann
  // EINE Wandlungsstufe probieren, sonst zügig zum nächsten Sender. Insgesamt
  // soll ein toter Sender in wenigen Sekunden übersprungen sein.
  if (!everPlayed && playerMode === "live") {
    // Stufe 0: genau zwei Versuche (der Nutzer wünscht „nach 2 Versuchen weiter")
    if ((playerCtx.stage || 0) === 0 && restartAttempts < 2) {
      spinner(true, "Verbinde … (Versuch " + (restartAttempts + 1) + ")");
      restartTimer = setTimeout(() => { restartTimer = 0; startEngine(); }, 600);
      return;
    }
    // Eine Wandlungsstufe als Rettung versuchen (z. B. exotischer Codec),
    // aber nur EINEN Anlauf, damit es schnell weitergeht.
    const nxt = nextStage(playerCtx.stage || 0);
    if (nxt >= 0 && nxt <= 2) {  // Tonumwandlung; Vollwandlung übernimmt nextStage nur bei Nicht-hires
      playerCtx.stage = nxt;
      restartAttempts = 1;
      spinner(true, "Anderes Verfahren wird probiert …");
      restartTimer = setTimeout(() => { restartTimer = 0; startEngine(); }, 400);
      return;
    }
    if (nxt === 3) {
      playerCtx.stage = nxt;
      restartAttempts = 1;
      spinner(true, "Sender wird umgewandelt …");
      restartTimer = setTimeout(() => { restartTimer = 0; startEngine(); }, 400);
      return;
    }
    // Alle Verfahren erschöpft: automatisch zum nächsten Sender – ohne Nachfrage.
    skipToNextChannel(reason);
    return;
  }
  // Lief schon ein Bild, der Sender bricht aber ab:
  if (everPlayed && playerMode === "live") {
    const ahead = (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0) - video.currentTime;
    // Läuft das Bild noch flüssig? Dann war es nur eine Schwankung – ignorieren.
    if (!video.paused && (ahead > 0.5 || video.readyState >= 3)) {
      restartAttempts = Math.max(0, restartAttempts - 1);
      return;
    }
    // Echter Aussetzer trotz vorherigem Bild. Zählen – und nach 2 erfolglosen
    // Rettungsversuchen den Sender aufgeben und zum nächsten wechseln, statt
    // dauerhaft denselben nicht funktionierenden Sender neu zu verbinden.
    postPlayFails++;
    lastFailAt = Date.now();
    if (postPlayFails >= 2) {
      postPlayFails = 0;
      jlog("Sender bricht wiederholt ab – weiter zum nächsten Sender");
      skipToNextChannel("Sender instabil");
      return;
    }
    jlog("Aussetzer nach Bild (" + postPlayFails + "/2) – Rettungsversuch");
    softReconnectLive();
    return;
  }
  const delays = [600, 1200, 2000, 3000, 5000, 8000];
  const wait = restartAttempts <= delays.length ? delays[restartAttempts - 1] : 10000;
  if (restartAttempts > 4) {
    showPlayerError(reason + " – EX-IPTV versucht es automatisch weiter …");
  } else spinner(true, "Verbindung unterbrochen – neuer Versuch …");
  restartTimer = setTimeout(() => { restartTimer = 0; startEngine(); }, wait);
}

// Sanfter Neuaufbau bei Aussetzern: Stufe behalten, Puffer hoch, neu verbinden.
let softReconnects = 0, softReconnectAt = 0;
function softReconnectLive() {
  const now = Date.now();
  if (now - softReconnectAt < 6000) return; // nicht häufiger als alle 6 s
  softReconnectAt = now;
  softReconnects++;
  if (bufferBoost < 2) bufferBoost++;
  // Bei wiederholten Aussetzern auf Direktwiedergabe AUS dem Relais bleiben –
  // der Server-Relay puffert ohnehin; ein höherer Client-Puffer glättet den Rest.
  spinner(true, "Verbindung wird stabilisiert …");
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { restartTimer = 0; startEngine(); }, 500);
}

// Sender startet nicht: klare Karte mit direktem Weiterzappen.
function showChannelFailed(reason) {
  const el = $("player-error");
  el.innerHTML = "";
  const head = document.createElement("div");
  head.style.cssText = "font-weight:600;margin-bottom:10px";
  head.textContent = "Dieser Sender ist gerade nicht erreichbar.";
  el.appendChild(head);
  if (playerCtx.key) {
    api("/api/stream?key=" + encodeURIComponent(playerCtx.key)).then(i => {
      if (i && i.lastErr) { head.textContent = "Sender nicht erreichbar: " + i.lastErr; }
    }).catch(() => {});
  }
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
  const mk = (label, fn, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:8px 16px;border-radius:10px;cursor:pointer;font:inherit;border:1px solid rgba(255,255,255,.25);" +
      (primary ? "background:linear-gradient(90deg,var(--acc1),var(--acc2));color:#fff;border:none" : "background:rgba(255,255,255,.08);color:#fff");
    b.onclick = fn;
    row.appendChild(b);
  };
  mk("Nächster Sender ▸", () => { el.classList.add("hidden"); $("pl-next-ch").click(); }, true);
  mk("◂ Voriger", () => { el.classList.add("hidden"); $("pl-prev").click(); });
  mk("Erneut versuchen", () => { el.classList.add("hidden"); restartAttempts = 0; playerCtx.stage = 0; startEngine(); });
  mk("Diagnose", showDiag);
  el.appendChild(row);
  el.classList.remove("hidden");
}

video.addEventListener("playing", () => {
  restartAttempts = 0;
  everPlayed = true;
  autoSkipChain = 0; // Sender spielt – Skip-Kette beenden
  clearTimeout(healthTimer);
  clearTimeout(bootTimer);
  if (playerMode === "live" && playerCtx.key) {
    fetch("/api/streammode", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: playerCtx.key, mode: playerCtx.stage || 0 }) }).catch(() => {});
  }
  spinner(false);
  $("player-error").classList.add("hidden");
  $("pl-pause").textContent = "⏸";
});
let waitingSince = 0;
video.addEventListener("waiting", () => {
  // Nur „Puffern" zeigen, wenn der Puffer wirklich leer ist UND das Stocken
  // kurz anhält. Ein momentanes Nachladen bei laufendem Bild bleibt unsichtbar.
  if (!playerCtx.url) return;
  waitingSince = Date.now();
  setTimeout(() => {
    // 600 ms später noch immer am Warten und Puffer leer? Dann Spinner zeigen.
    if (video.paused) return;
    const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    if (Date.now() - waitingSince >= 550 && end - video.currentTime < 0.4 && video.readyState < 3)
      spinner(true, "Puffern …");
  }, 600);
});
video.addEventListener("playing", () => { waitingSince = 0; });
// Sobald wieder genug Daten da sind, Spinner zuverlässig wegräumen.
video.addEventListener("canplay", () => { if (!video.paused) spinner(false); });
video.addEventListener("timeupdate", () => {
  // Läuft die Zeit, ist die Wiedergabe gesund – etwaigen Rest-Spinner entfernen.
  if (!video.paused && video.readyState >= 3) {
    const sp = $("player-spinner");
    if (sp && !sp.classList.contains("hidden")) spinner(false);
  }
});
video.addEventListener("pause", () => { $("pl-pause").textContent = "▶"; reportWatch(true); });
video.addEventListener("error", () => {
  const ve = video.error;
  if (ve) jlog("video.error code=" + ve.code + (ve.message ? " " + ve.message : ""));
  if (playerCtx.url && engine && engine.kind === "native") scheduleRestart("Wiedergabefehler");
});
video.addEventListener("timeupdate", () => {
  if (playerMode !== "vod" || !video.duration) return;
  $("pl-prog-fill").style.width = (video.currentTime / video.duration * 100) + "%";
  $("pl-now").textContent = fmtClock(video.currentTime) + " / " + fmtClock(video.duration);
});

/* ---------------- Player öffnen/schließen ---------------- */
function openPlayerShell(mode, title, logo) {
  playerMode = mode;
  $("player").classList.remove("hidden");
  $("pl-name").textContent = title || "–";
  $("pl-now").textContent = "";
  $("pl-next").textContent = "";
  $("pl-prog-fill").style.width = "0";
  const logoEl = $("pl-logo");
  if (logo) { logoEl.src = logo; logoEl.style.display = ""; } else logoEl.style.display = "none";
  const liveOnly = mode === "live";
  ["pl-prev", "pl-next-ch", "pl-list", "pl-fav", "pl-rec"].forEach(id => $(id).style.display = liveOnly ? "" : "none");
  ["pl-rew", "pl-fwd"].forEach(id => $(id).style.display = liveOnly ? "none" : "");
  if (liveOnly) { $("pl-tracks").style.display = "none"; const tm = $("tracks-menu"); if (tm) tm.remove(); }
  $("osd").classList.toggle("vod", !liveOnly);
  applyEnhance(st().enhance || "aus");
  if (st().audioBoost) setupAudioBoost(true);
  showOsd();
  if (st().autoFull !== false && !document.fullscreenElement) {
    const de = document.documentElement, rf = de.requestFullscreen || de.webkitRequestFullscreen;
    if (rf) { try { const p = rf.call(de); if (p && p.catch) p.catch(() => {}); } catch {} }
  }
  clearInterval(clockTimer);
  clockTimer = setInterval(() => $("pl-clock").textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), 1000);
  $("pl-clock").textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

async function playLive(key, list) {
  let info;
  try { info = await api("/api/stream?key=" + encodeURIComponent(key)); }
  catch (e) { toast("Kanal kann nicht geladen werden: " + e.message); return; }
  playerCtx = {
    key, url: info.url, kind: info.kind, title: info.name,
    baseUrl: info.url, baseKind: info.kind,
    ffmpegOk: !!info.ffmpeg && (st().playbackPref || "auto") !== "direkt",
    hires: !!info.hires,
    stage: 0,
    list: list && list.length ? list : (tvChannels.length ? tvChannels : [info]),
    idx: -1,
  };
  clearTimeout(restartTimer); restartTimer = 0;
  clearTimeout(bootTimer);
  restartAttempts = 0;
  cancelAutoplay();
  $("player-error").classList.add("hidden");
  playerCtx.tsBack = 0; tsDepth = 0;
  clearInterval(tsPoll);
  tsPoll = setInterval(pollTsDepth, 5000);
  setTimeout(pollTsDepth, 2500);
  playerCtx.idx = playerCtx.list.findIndex(c => c.key === key);
  const pref = st().playbackPref || "auto";
  if (pref === "ffmpeg" && playerCtx.ffmpegOk) {
    playerCtx.stage = 3; // Nutzer will ausdrücklich immer umwandeln
  } else if (pref === "direkt") {
    playerCtx.stage = 0; // Nutzer will ausdrücklich nie umwandeln
  } else {
    // Automatik: Tonumwandlung (Stufe 2) als gespeicherte Bestwahl übernehmen,
    // weil sie das Bild direkt durchreicht und nur den Ton umsetzt. Die teure
    // VOLLwandlung (3) aber NICHT vorab wählen – sie scheitert bei 4K/hohen
    // Bitraten und liefert ein schwarzes Bild. Lieber direkt starten und nur
    // bei echtem Codec-Problem schrittweise hochgehen.
    const saved = Math.max(0, info.mode || 0);
    const cap = playerCtx.ffmpegOk ? 2 : 1; // Tonumwandlung als höchste Auto-Startstufe
    playerCtx.stage = Math.min(cap, saved);
  }
  everPlayed = false;
  softReconnects = 0; bufferBoost = 0; stallLog = []; postPlayFails = 0; lastFailAt = 0;
  openPlayerShell("live", info.name, info.logo);
  $("pl-fav").classList.toggle("on", favSet.has(key));
  updateRecButton();
  restartAttempts = 0;
  startEngine();
  loadOsdEpg();
  clearInterval(epgOsdTimer);
  epgOsdTimer = setInterval(loadOsdEpg, 60000);
  st().lastChannel = key;
  saveSettings();
}

// ---------- Geplante Aufnahmen ----------
async function renderRecPlans() {
  let box = $("rec-plans");
  if (!box) {
    box = document.createElement("div");
    box.id = "rec-plans";
    box.className = "pad";
    $("recs-list").insertAdjacentElement("beforebegin", box);
  }
  let plans = [];
  try { plans = await api("/api/record/plans"); } catch {}
  box.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin:4px 0 10px">
    <strong>Geplante Aufnahmen</strong>
    <button id="btn-plan-add" class="ghost-btn">+ Aufnahme planen</button></div>`;
  plans.forEach(p => {
    const row = document.createElement("div");
    row.className = "row";
    const d = new Date(p.startAt * 1000);
    row.innerHTML = `<div class="r-main"><div class="r-name">${esc(p.name)}</div>
      <div class="r-sub muted">${d.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      · ${Math.round((p.endAt - p.startAt) / 60)} Min.${p.started ? " · läuft" : ""}</div></div>
      <button class="ghost-btn" title="Plan löschen">✕</button>`;
    row.querySelector("button").onclick = async () => {
      await api("/api/record/plans", { delete: p.id });
      renderRecPlans();
    };
    box.appendChild(row);
  });
  $("btn-plan-add").onclick = openPlanModal;
}

function openPlanModal() {
  let m = $("plan-modal");
  if (m) m.remove();
  m = document.createElement("div");
  m.id = "plan-modal";
  m.className = "modal-bg";
  const start = new Date(Date.now() + 10 * 60000);
  start.setSeconds(0, 0);
  const pad = n => String(n).padStart(2, "0");
  const dtVal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
  m.innerHTML = `<div class="modal" style="max-width:460px">
    <div class="modal-head"><span>Aufnahme planen</span><button class="ghost-btn" id="plan-close">✕</button></div>
    <div class="pad">
      <label class="muted" style="font-size:13px">Sender suchen</label>
      <input id="plan-ch" type="text" placeholder="Sendername …" style="width:100%;margin:4px 0 10px">
      <div id="plan-hits" style="max-height:160px;overflow:auto;margin-bottom:10px"></div>
      <label class="muted" style="font-size:13px">Start</label>
      <input id="plan-start" type="datetime-local" value="${dtVal}" style="width:100%;margin:4px 0 10px">
      <label class="muted" style="font-size:13px">Dauer (Minuten)</label>
      <input id="plan-dur" type="number" value="60" min="1" max="600" style="width:100%;margin:4px 0 14px">
      <p class="muted" style="font-size:12px">Hinweis: Bei einem Abo mit nur einer Verbindung beendet die geplante Aufnahme eine laufende Live-Wiedergabe eines anderen Senders.</p>
      <button id="plan-save" class="primary-btn" disabled>Planen</button>
    </div></div>`;
  document.body.appendChild(m);
  let chosen = null;
  const hits = m.querySelector("#plan-hits");
  m.querySelector("#plan-ch").oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    hits.innerHTML = "";
    chosen = null;
    m.querySelector("#plan-save").disabled = true;
    if (q.length < 2) return;
    tvChannels.concat([]).filter(c => c.name.toLowerCase().includes(q)).slice(0, 12).forEach(c => {
      const b = document.createElement("button");
      b.className = "ghost-btn";
      b.style.cssText = "display:block;width:100%;text-align:left;margin:2px 0";
      b.textContent = c.name;
      b.onclick = () => { chosen = c; m.querySelector("#plan-ch").value = c.name; hits.innerHTML = "";
        m.querySelector("#plan-save").disabled = false; };
      hits.appendChild(b);
    });
  };
  m.querySelector("#plan-close").onclick = () => m.remove();
  m.querySelector("#plan-save").onclick = async () => {
    const startTs = Math.floor(new Date(m.querySelector("#plan-start").value).getTime() / 1000);
    const dur = parseInt(m.querySelector("#plan-dur").value, 10) || 60;
    if (!chosen || !startTs) return;
    await api("/api/record/plans", { key: chosen.key, name: chosen.name, start: startTs, durMin: dur });
    m.remove();
    toast("Aufnahme geplant: " + chosen.name);
    renderRecPlans();
  };
}

// ---------- Autoplay: nächste Folge ----------
let autoplayTimer = 0;
function nextEpisode() {
  if (!playerCtx.queue || playerCtx.qIdx < 0) return null;
  return playerCtx.queue[playerCtx.qIdx + 1] || null;
}
function cancelAutoplay() {
  clearInterval(autoplayTimer);
  autoplayTimer = 0;
  const o = $("autoplay-card");
  if (o) o.remove();
}
function showAutoplay() {
  const nx = nextEpisode();
  if (!nx || $("autoplay-card")) return;
  reportWatch(true);
  const o = document.createElement("div");
  o.id = "autoplay-card";
  o.innerHTML = `<div class="ap-title">Nächste Folge</div>
    <div class="ap-ep">${esc(nx.short || nx.title)}</div>
    <div class="ap-row">
      <button class="primary-btn" id="ap-now">▶ Jetzt abspielen <span id="ap-count">10</span></button>
      <button class="ghost-btn" id="ap-cancel">Abbrechen</button>
    </div>`;
  $("player").appendChild(o);
  let left = 10;
  const start = () => { cancelAutoplay(); playVod({ key: nx.serKey, name: nx.serName, logo: "" }, nx); };
  o.querySelector("#ap-now").onclick = start;
  o.querySelector("#ap-cancel").onclick = cancelAutoplay;
  autoplayTimer = setInterval(() => {
    left--;
    const c = $("ap-count");
    if (c) c.textContent = left;
    if (left <= 0) start();
  }, 1000);
}
video.addEventListener("ended", () => {
  if (playerMode === "vod" && (st().autoplayNext !== false)) showAutoplay();
});

// ---------- Ton- & Untertitelwahl bei Filmen/Serien ----------
let vodTracks = null, vodSel = { a: 0, s: -1 };
async function loadVodTracks() {
  vodTracks = null; vodSel = { a: 0, s: -1 };
  $("pl-tracks").style.display = "none";
  if (!playerCtx.watchKey) return;
  try {
    const q = "key=" + encodeURIComponent(playerCtx.serKey || playerCtx.watchKey) +
      (playerCtx.epId ? "&ep=" + encodeURIComponent(playerCtx.epId) + "&ext=" + encodeURIComponent(playerCtx.epExt || "mp4") : "");
    vodTracks = await api("/api/vodinfo?" + q);
    if (vodTracks && vodTracks.duration > 0) playerCtx.knownDur = vodTracks.duration;
    if (vodTracks && ((vodTracks.audio || []).length > 1 || (vodTracks.subs || []).length > 0))
      $("pl-tracks").style.display = "";
    applyTrackPref();
  } catch {}
}

// Gewählte Sprache merken und bei der nächsten Folge derselben Serie übernehmen.
function trackPrefKey() { return playerCtx.serKey || ""; }
function saveTrackPref() {
  const k = trackPrefKey();
  if (!k || !vodTracks) return;
  const prefs = st().trackPrefs || {};
  const aLang = (vodTracks.audio[vodSel.a] || {}).lang || "";
  const sLang = vodSel.s >= 0 ? ((vodTracks.subs[vodSel.s] || {}).lang || "") : null;
  prefs[k] = { a: aLang, s: sLang };
  st().trackPrefs = prefs;
  saveSettings();
}
function applyTrackPref() {
  const k = trackPrefKey();
  const pref = k && (st().trackPrefs || {})[k];
  if (!pref || !vodTracks) return;
  let a = 0, sIdx = -1;
  if (pref.a) {
    const hit = (vodTracks.audio || []).find(t => (t.lang || "") === pref.a);
    if (hit) a = hit.i;
  }
  if (pref.s) {
    const hit = (vodTracks.subs || []).find(t => (t.lang || "") === pref.s);
    if (hit) sIdx = hit.i;
  }
  if (a !== 0 || sIdx !== -1) {
    switchVodTracks(a, sIdx, true);
    const names = [langName(pref.a)];
    if (sIdx >= 0) names.push("UT " + langName(pref.s));
    toast("Spurwahl übernommen: " + names.join(" · "));
  }
}

const LANGNAMES = { ger: "Deutsch", deu: "Deutsch", eng: "Englisch", alb: "Albanisch", sqi: "Albanisch",
  srp: "Serbisch", hrv: "Kroatisch", bos: "Bosnisch", tur: "Türkisch", gre: "Griechisch", ell: "Griechisch",
  fre: "Französisch", fra: "Französisch", spa: "Spanisch", ita: "Italienisch", rus: "Russisch",
  ara: "Arabisch", pol: "Polnisch", und: "Unbekannt" };
const langName = l => LANGNAMES[(l || "").toLowerCase()] || (l ? l.toUpperCase() : "Spur");

function openTracksMenu() {
  let m = $("tracks-menu");
  if (m) { m.remove(); return; }
  m = document.createElement("div");
  m.id = "tracks-menu";
  m.style.cssText = "position:absolute;bottom:74px;left:50%;transform:translateX(-50%);z-index:40;" +
    "background:rgba(12,16,26,.96);border:1px solid rgba(139,92,246,.4);border-radius:14px;padding:14px 18px;" +
    "min-width:300px;max-height:60vh;overflow:auto;backdrop-filter:blur(8px)";
  const sec = (title) => { const d = document.createElement("div");
    d.style.cssText = "font-weight:700;font-size:13px;color:var(--muted);margin:8px 0 6px"; d.textContent = title; m.appendChild(d); };
  const row = (label, active, fn) => {
    const b = document.createElement("button");
    b.textContent = (active ? "● " : "○ ") + label;
    b.style.cssText = "display:block;width:100%;text-align:left;padding:7px 10px;margin:2px 0;border-radius:9px;" +
      "border:none;cursor:pointer;font:inherit;color:#fff;background:" + (active ? "rgba(139,92,246,.25)" : "transparent");
    b.onmouseenter = () => b.style.background = "rgba(255,255,255,.08)";
    b.onmouseleave = () => b.style.background = active ? "rgba(139,92,246,.25)" : "transparent";
    b.onclick = fn; m.appendChild(b);
  };
  sec("Tonspur");
  (vodTracks.audio || []).forEach(t =>
    row(langName(t.lang) + (t.title ? " · " + t.title : "") + "  (" + t.codec + ")", vodSel.a === t.i,
      () => { m.remove(); switchVodTracks(t.i, vodSel.s); }));
  sec("Untertitel");
  row("Aus", vodSel.s === -1, () => { m.remove(); switchVodTracks(vodSel.a, -1); });
  (vodTracks.subs || []).forEach(t =>
    row(langName(t.lang) + (t.title ? " · " + t.title : ""), vodSel.s === t.i,
      () => { m.remove(); switchVodTracks(vodSel.a, t.i); }));
  if ((vodTracks.subs || []).length) {
    const hint = document.createElement("div");
    hint.style.cssText = "margin-top:8px;font-size:11.5px;color:var(--muted)";
    hint.textContent = "Untertitel werden ins Bild eingerechnet – der Start dauert einen Moment.";
    m.appendChild(hint);
  }
  $("player").appendChild(m);
}

async function switchVodTracks(a, sIdx, silent) {
  if (a === vodSel.a && sIdx === vodSel.s) return;
  const pos = Math.max(0, video.currentTime - 0.5);
  vodSel = { a, s: sIdx };
  if (!silent) saveTrackPref();
  spinner(true, "Spur wird gewechselt …");
  try {
    if (a === 0 && sIdx === -1) {
      // Standardspur ohne Untertitel: zurück zur Direktwiedergabe
      playerCtx.url = playerCtx.baseVodUrl || playerCtx.url;
      playerCtx.kind = "vod";
      startEngine();
      const apply = () => { video.removeEventListener("loadedmetadata", apply); try { video.currentTime = pos; } catch {} };
      video.addEventListener("loadedmetadata", apply);
      return;
    }
    const r = await api("/api/vodsession", {
      key: playerCtx.serKey || playerCtx.watchKey, ep: playerCtx.epId || "", ext: playerCtx.epExt || "",
      a, s: sIdx, ss: pos });
    playerCtx.vodSessionBase = pos;
    playerCtx.url = "/xv/" + r.sid + "/index.m3u8";
    playerCtx.kind = "hls";
    startEngine();
  } catch (e) { spinner(false); toast("Spurwechsel fehlgeschlagen: " + e.message); }
}
$("pl-tracks").onclick = openTracksMenu;

let watchTimer = 0;
function reportWatch(final) {
  if (playerMode !== "vod" || !playerCtx.watchKey) return;
  const isXv = playerCtx.url && playerCtx.url.startsWith("/xv/");
  const dur = playerCtx.knownDur || video.duration;
  const curPos = (isXv ? (playerCtx.vodSessionBase || 0) : 0) + video.currentTime;
  if (!isFinite(dur) || dur <= 0 || curPos < 5) return;
  fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: playerCtx.watchKey, pos: curPos, dur,
      playUrl: playerCtx.baseVodUrl || playerCtx.url, title: playerCtx.title,
      serKey: playerCtx.serKey || "", serName: playerCtx.serName || "",
      epId: playerCtx.epId || "", epExt: playerCtx.epExt || "", logo: playerCtx.logo || "" }),
    keepalive: !!final }).catch(() => {});
}

function playVod(v, ep) {
  cancelAutoplay();
  clearTimeout(restartTimer); restartTimer = 0;
  clearTimeout(bootTimer);
  restartAttempts = 0;
  clearInterval(tsPoll);
  $("player-error").classList.add("hidden");
  playerCtx = {
    key: v ? v.key : (ep && ep.watchKey) || "",
    url: ep ? ep.url : "/v/" + encodeURIComponent(v.key),
    kind: "vod", title: ep ? ep.title : v.name, list: [], idx: -1,
    watchKey: ep && ep.watchKey ? ep.watchKey : (v ? v.key : ""),
    serKey: (ep && ep.serKey) || "", serName: (ep && ep.serName) || "",
    epId: (ep && ep.epId) || "", epExt: (ep && ep.epExt) || "",
    queue: (ep && ep.queue) || null, qIdx: ep && Number.isInteger(ep.qIdx) ? ep.qIdx : -1,
    logo: (v && v.logo) || (ep && ep.logo) || "",
  };
  playerCtx.baseVodUrl = playerCtx.url;
  loadVodTracks();
  const NATIVE_VOD = !!(window.AndroidPlayer && window.AndroidPlayer.playVod);
  clearInterval(watchTimer);
  if (!NATIVE_VOD) {
    watchTimer = setInterval(() => reportWatch(false), 10000);
  }
  // Gespeicherte Position abrufen und nach dem Laden dort fortsetzen
  if (playerCtx.watchKey) {
    api("/api/watch?key=" + encodeURIComponent(playerCtx.watchKey)).then(wp => {
      if (!wp || !wp.pos || wp.pos < 60 || (wp.dur && wp.pos / wp.dur > 0.95)) return;
      if (NATIVE_VOD) {
        playerCtx.resumeSec = wp.pos;
        try { window.AndroidPlayer.vodSeek(Math.floor(wp.pos)); } catch (e) {}
        toast("Fortgesetzt bei " + fmtTime(wp.pos));
        return;
      }
      const apply = () => {
        video.removeEventListener("loadedmetadata", apply);
        try { video.currentTime = wp.pos; } catch {}
        toast("Fortgesetzt bei " + fmtTime(wp.pos));
      };
      if (video.readyState >= 1 && isFinite(video.duration)) apply();
      else video.addEventListener("loadedmetadata", apply);
    }).catch(() => {});
  }
  openPlayerShell("vod", playerCtx.title, v ? v.logo : null);
  restartAttempts = 0;
  // Android: nativer ExoPlayer übernimmt (echtes Spulen, stabil). PC: WebView.
  if (NATIVE_VOD) { startEngine(); return; }
  // VOD: erst nativ, bei m3u8-Antwort übernimmt hls.js im Fehlerfall
  stopEngine();
  spinner(true, "Lade …");
  video.src = playerCtx.url;
  engine = { kind: "native" };
  video.play().catch(() => {});
  const onErr = () => {
    video.removeEventListener("error", onErr);
    if (window.Hls && Hls.isSupported()) {
      const h = new Hls({ maxBufferLength: 60 });
      h.loadSource(absUrl(playerCtx.url));
      h.attachMedia(video);
      h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { spinner(false); $("player-error").textContent = "Dieses Format kann nicht wiedergegeben werden."; $("player-error").classList.remove("hidden"); } });
      engine = { kind: "hls", h };
    }
  };
  video.addEventListener("error", onErr, { once: true });
}

function playRecording(name) {
  playerCtx = { key: null, url: "/rec/" + encodeURIComponent(name), kind: "vod", title: name, list: [], idx: -1 };
  openPlayerShell("vod", name, null);
  stopEngine();
  spinner(true, "Lade …");
  video.src = playerCtx.url;
  engine = { kind: "native" };
  video.play().catch(() => {});
}

function closePlayer() {
  stopEngine();
  clearInterval(clockTimer); clearInterval(epgOsdTimer);
  playerCtx = { key: null, list: [], idx: -1, url: "" };
  playerMode = null;
  $("player").classList.add("hidden");
  hideZap(); $("enhance-menu").classList.add("hidden");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (currentView === "recs") loadRecsView();
}

/* ---------------- OSD ---------------- */
function showOsd() {
  $("osd").classList.remove("hide");
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => $("osd").classList.add("hide"), 3500);
}
$("player").addEventListener("mousemove", showOsd);
$("player").addEventListener("click", e => { if (e.target === video) showOsd(); });

function loadOsdEpg() {
  if (playerMode !== "live" || !playerCtx.key) return;
  epgNowCache.delete(playerCtx.key);
  queueEpgNow(playerCtx.key, ent => {
    if (ent.now) {
      $("pl-now").textContent = ent.now.title + "  ·  " + fmtHM(ent.now.start) + " – " + fmtHM(ent.now.stop);
      const pct = Math.min(100, Math.max(0, (Date.now() / 1000 - ent.now.start) / (ent.now.stop - ent.now.start) * 100));
      $("pl-prog-fill").style.width = pct + "%";
    } else { $("pl-now").textContent = ""; $("pl-prog-fill").style.width = "0"; }
    $("pl-next").textContent = ent.next ? "Danach: " + ent.next.title + " (" + fmtHM(ent.next.start) + ")" : "";
  });
}

/* ---------------- OSD-Knöpfe ---------------- */
$("pl-back").onclick = closePlayer;
$("pl-pause").onclick = () => video.paused ? video.play().catch(() => {}) : video.pause();
$("pl-rew").onclick = () => { if (isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime - 15); };
$("pl-fwd").onclick = () => { if (isFinite(video.duration)) video.currentTime = Math.min(video.duration - 0.5, video.currentTime + 15); };

// --- Spul-Leiste (Filme, Serien, Aufnahmen)
const seekBar = $("seek-bar");
let seekDrag = false;
function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function updateSeekUI() {
  if (playerMode === "live") { updateLiveSeekUI(); return; }
  const isXv = playerCtx.url && playerCtx.url.startsWith("/xv/");
  const dur = (isXv && playerCtx.knownDur) || playerCtx.knownDur || video.duration;
  if (!isFinite(dur) || dur <= 0) return;
  const cur = (isXv ? (playerCtx.vodSessionBase || 0) : 0) + video.currentTime;
  if (!seekDrag) {
    const v = Math.round(cur / dur * 1000);
    seekBar.value = v;
    seekBar.style.setProperty("--sk", (v / 10) + "%");
  }
  $("sk-cur").textContent = fmtTime(seekDrag ? seekBar.value / 1000 * dur : cur);
  $("sk-dur").textContent = fmtTime(dur);
}
video.addEventListener("timeupdate", updateSeekUI);
video.addEventListener("durationchange", updateSeekUI);
video.addEventListener("loadedmetadata", updateSeekUI);
seekBar.addEventListener("input", () => {
  seekDrag = true;
  seekBar.style.setProperty("--sk", (seekBar.value / 10) + "%");
  showOsd();
  updateSeekUI();
});
seekBar.addEventListener("change", () => {
  if (playerMode === "live") {
    if (!liveTsAvailable()) { seekDrag = false; return; }
    const behindTarget = Math.max(0, tsDepth * (1 - seekBar.value / 1000));
    liveSeekTo(behindTarget);
    seekDrag = false;
    return;
  }
  const dur = playerCtx.knownDur || video.duration;
  if (!isFinite(dur) || dur <= 0) { seekDrag = false; return; }
  const target = seekBar.value / 1000 * dur;
  if (playerCtx.url && playerCtx.url.startsWith("/xv/")) {
    const base = playerCtx.vodSessionBase || 0;
    const local = target - base;
    const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    if (local >= 0 && local < end - 1) video.currentTime = local;
    else { // außerhalb des Erzeugten: Wandlung ab Zielposition neu anwerfen
      api("/api/vodsession", { key: playerCtx.serKey || playerCtx.watchKey, ep: playerCtx.epId || "",
        ext: playerCtx.epExt || "", a: vodSel.a, s: vodSel.s, ss: target }).then(r => {
        playerCtx.vodSessionBase = target;
        playerCtx.url = "/xv/" + r.sid + "/index.m3u8";
        startEngine();
      }).catch(e => toast("Sprung fehlgeschlagen: " + e.message));
    }
  } else {
    video.currentTime = target;
  }
  seekDrag = false;
});
$("pl-full").onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
$("pl-volume").oninput = e => { video.volume = e.target.value / 100; video.muted = e.target.value === "0"; };
$("pl-pip").onclick = async () => {
  try { document.pictureInPictureElement ? await document.exitPictureInPicture() : await video.requestPictureInPicture(); }
  catch { toast("Bild-in-Bild ist hier nicht verfügbar"); }
};
const aspects = [["", "Original"], ["fit-cover", "Formatfüllend"], ["fit-fill", "Strecken"]];
let aspectIdx = 0;
$("pl-aspect").onclick = () => {
  aspectIdx = (aspectIdx + 1) % aspects.length;
  video.classList.remove("fit-cover", "fit-fill");
  if (aspects[aspectIdx][0]) video.classList.add(aspects[aspectIdx][0]);
  toast("Bildformat: " + aspects[aspectIdx][1]);
};
$("pl-enhance").onclick = () => $("enhance-menu").classList.toggle("hidden");
document.querySelectorAll("#enhance-menu button").forEach(b => b.onclick = () => {
  st().enhance = b.dataset.fx;
  applyEnhance(b.dataset.fx);
  saveSettings();
  $("enhance-menu").classList.add("hidden");
  toast("Bildverbesserung: " + b.textContent);
});
$("pl-audio").onclick = () => {
  const on = !(audioGraph && audioGraph.on);
  setupAudioBoost(on);
  st().audioBoost = on;
  saveSettings();
  toast(on ? "Lautstärke-Normalisierung an" : "Lautstärke-Normalisierung aus");
};
$("pl-fav").onclick = async () => {
  if (playerMode !== "live") return;
  const on = !favSet.has(playerCtx.key);
  await toggleFavorite(playerCtx.key, on);
  $("pl-fav").classList.toggle("on", on);
};

function updateRecButton() {
  $("pl-rec").classList.toggle("rec-on", !!(recJob && recJob.active && recJob.key === playerCtx.key));
}
$("pl-rec").onclick = async () => {
  if (playerMode !== "live") return;
  if (recJob && recJob.active && recJob.key === playerCtx.key) {
    await api("/api/record/stop", { id: recJob.id }).catch(() => {});
    recJob = null;
    toast("Aufnahme gestoppt");
  } else {
    try {
      const j = await api("/api/record/start", { key: playerCtx.key, name: playerCtx.title });
      recJob = { ...j, key: playerCtx.key };
      toast("Aufnahme läuft – Datei: " + j.file);
    } catch (e) { toast("Aufnahme fehlgeschlagen: " + e.message); }
  }
  updateRecButton();
};

/* ---------------- Zapping ---------------- */
function zapTo(idx) {
  const list = playerCtx.list;
  if (!list.length) return;
  idx = (idx + list.length) % list.length;
  playLive(list[idx].key, list);
}
$("pl-prev").onclick = () => zapTo(playerCtx.idx - 1);
$("pl-next-ch").onclick = () => zapTo(playerCtx.idx + 1);

/* ============================================================
   Brücke zum nativen Android-Player (ExoPlayer)
   Der native Player meldet sich hier zurück. Die Senderliste und
   die Logik bleiben in der Oberfläche; der native Player ist nur
   die robuste Wiedergabe-Maschine.
   ============================================================ */
window.EXNATIVE = {
  // Nativer Player hat einen Sender nach mehreren Versuchen nicht
  // zum Laufen bekommen -> automatisch den nächsten Sender starten.
  failed: function () {
    try {
      if (playerMode !== "live" || !playerCtx.list || !playerCtx.list.length) return;
      const n = playerCtx.list.length;
      const next = (((playerCtx.idx + 1) % n) + n) % n;
      zapTo(next);
    } catch (e) {}
  },
  // Sender per Fernbedienung wechseln: delta < 0 = vorheriger, > 0 = nächster.
  zap: function (delta) {
    try {
      if (playerMode !== "live" || !playerCtx.list || !playerCtx.list.length) return;
      zapTo(playerCtx.idx + (delta > 0 ? 1 : -1));
    } catch (e) {}
  },
  // Nativer Player wurde geschlossen (Zurück-Taste) -> Oberfläche aufräumen.
  closed: function () {
    try { closePlayer(); } catch (e) {}
  },
  // Aktueller Sendername (für die native Info-Anzeige).
  currentTitle: function () {
    return (playerCtx && playerCtx.title) ? playerCtx.title : "";
  },
  // --- Film/Serie (VOD) im nativen Player ---
  // Laufende Position melden -> „Weiter schauen" speichern.
  vodPos: function (pos, dur) {
    try {
      if (playerMode !== "vod") return;
      playerCtx.nativePos = pos;
      if (dur > 0) playerCtx.nativeDur = dur;
      reportWatchNative(pos, dur, false);
    } catch (e) {}
  },
  // Film zu Ende -> Endstand speichern, ggf. nächste Folge.
  vodEnded: function () {
    try {
      if (playerMode !== "vod") return;
      if (playerCtx.nativeDur) reportWatchNative(playerCtx.nativeDur, playerCtx.nativeDur, true);
      if (st().autoplayNext !== false && nextEpisode()) showAutoplay();
      else closePlayer();
    } catch (e) {}
  },
  // Nativer VOD-Player geschlossen (Zurück) -> Stand sichern, aufräumen.
  vodClosed: function () {
    try {
      if (playerMode === "vod") reportWatchNative(playerCtx.nativePos || 0, playerCtx.nativeDur || 0, true);
      closePlayer();
    } catch (e) {}
  }
};

// Stand des nativen VOD-Players an den Server melden (für „Weiter schauen").
function reportWatchNative(pos, dur, final) {
  if (!playerCtx.watchKey) return;
  if (!isFinite(dur) || dur <= 0 || pos < 5) return;
  fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: playerCtx.watchKey, pos: pos, dur: dur,
      playUrl: playerCtx.baseVodUrl || playerCtx.url, title: playerCtx.title,
      serKey: playerCtx.serKey || "", serName: playerCtx.serName || "",
      epId: playerCtx.epId || "", epExt: playerCtx.epExt || "", logo: playerCtx.logo || "" }),
    keepalive: !!final }).catch(() => {});
}

function showZap() {
  const box = $("zap-items");
  box.innerHTML = "";
  $("zap-group").textContent = "";
  playerCtx.list.forEach((c, i) => {
    const r = channelRow(c, { noEpg: true });
    if (i === playerCtx.idx) r.classList.add("active");
    r.onclick = () => { hideZap(); playLive(c.key, playerCtx.list); };
    box.appendChild(r);
  });
  $("zap-list").classList.remove("hidden");
  const act = box.querySelector(".active");
  if (act) act.scrollIntoView({ block: "center" });
}
function hideZap() { $("zap-list").classList.add("hidden"); }
$("pl-list").onclick = () => $("zap-list").classList.contains("hidden") ? showZap() : hideZap();

let zapBuf = "", zapBufTimer = 0;
function zapDigit(d) {
  if (playerMode !== "live") return;
  zapBuf = (zapBuf + d).slice(0, 4);
  $("zap-num").textContent = zapBuf;
  $("zap-num").classList.remove("hidden");
  clearTimeout(zapBufTimer);
  zapBufTimer = setTimeout(() => {
    const n = parseInt(zapBuf, 10);
    zapBuf = "";
    $("zap-num").classList.add("hidden");
    const i = playerCtx.list.findIndex(c => c.num === n);
    if (i >= 0) zapTo(i); else toast("Kein Kanal mit Nummer " + n);
  }, 1500);
}

/* ---------------- Tastatur ---------------- */
addEventListener("keydown", e => {
  const inPlayer = !$("player").classList.contains("hidden");
  if (e.key === "Escape") {
    if (!$("enhance-menu").classList.contains("hidden")) { $("enhance-menu").classList.add("hidden"); return; }
    if (!$("zap-list").classList.contains("hidden")) { hideZap(); return; }
    for (const id of ["prog-modal", "series-modal", "groups-modal", "setup"]) {
      if (!$(id).classList.contains("hidden")) {
        if (id === "setup" && !state.playlists.length) return;
        closeModal(id); return;
      }
    }
    if (inPlayer) closePlayer();
    return;
  }
  if (!inPlayer || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  showOsd();
  switch (e.key) {
    case " ": e.preventDefault(); $("pl-pause").click(); break;
    case "PageUp": e.preventDefault(); $("pl-prev").click(); break;
    case "PageDown": e.preventDefault(); $("pl-next-ch").click(); break;
    case "ArrowUp": e.preventDefault(); playerMode === "live" ? zapTo(playerCtx.idx - 1) : (video.volume = Math.min(1, video.volume + .05)); break;
    case "ArrowDown": e.preventDefault(); playerMode === "live" ? zapTo(playerCtx.idx + 1) : (video.volume = Math.max(0, video.volume - .05)); break;
    case "PageUp": zapTo(playerCtx.idx - 1); break;
    case "PageDown": zapTo(playerCtx.idx + 1); break;
    case "ArrowLeft": if (playerMode === "vod") video.currentTime -= 15; break;
    case "ArrowRight": if (playerMode === "vod") video.currentTime += 15; break;
    case "f": case "F": $("pl-full").click(); break;
    case "m": case "M": video.muted = !video.muted; break;
    case "Enter": if (playerMode === "live") showZap(); break;
    default:
      if (/^[0-9]$/.test(e.key)) zapDigit(e.key);
  }
});

// VOD: Klick auf Fortschrittsleiste = Spulen
document.querySelector(".pl-prog").addEventListener("click", e => {
  if (playerMode !== "vod" || !video.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  video.currentTime = (e.clientX - r.left) / r.width * video.duration;
});

/* ============================================================
   Einstellungen
   ============================================================ */
function renderSettingsView() {
  const s = st();
  $("set-buffer").value = s.bufferSec || 4;
  $("set-buffer-val").textContent = (s.bufferSec || 4) + " s";
  $("set-enhance").value = s.enhance || "klar";
  $("set-audioboost").checked = !!s.audioBoost;
  $("set-epgoffset").value = String(s.epgOffset || 0);
  $("set-sound").checked = s.startupSound !== false;
  $("set-buffermode").value = s.bufferMode || "ausgewogen";
  $("set-buffertune").checked = s.bufferAutoTune !== false;
  $("set-autoplay").checked = s.autoplayNext !== false;
  $("set-audiodelay").value = s.audioDelayMs || 0;
  $("set-audiodelay-val").textContent = (s.audioDelayMs || 0) + " ms";
  $("set-playbackpref").value = s.playbackPref || "auto";
  $("set-startview").value = s.startView || "home";
  $("set-accent").value = s.accent || "violett";
  $("set-homebg").value = String(s.homeBg || "1");
  $("set-shownums").checked = s.showNums !== false;
  $("set-quality").value = s.quality || "hoch";
  $("set-autofull").checked = s.autoFull !== false;
  $("set-fps").value = s.fps || "max";
  $("about-line").textContent = "EX-IPTV " + (state.version || "") + " · Alle Daten bleiben lokal auf diesem PC. Aufnahmen: Ordner „Videos\\EX-IPTV“.";
  renderPlaylistCards();
  refreshPinUI();
}

function renderPlaylistCards() {
  const box = $("settings-playlists");
  box.innerHTML = "";
  if (!state.playlists.length) {
    box.innerHTML = '<p class="muted" style="margin-bottom:10px">Noch keine Playlist eingerichtet.</p>';
    return;
  }
  state.playlists.forEach(p => {
    const card = document.createElement("div");
    card.className = "pl-card";
    const stTxt = p.status === "ok" ? "Bereit" : p.status === "loading" ? "Lädt …"
      : (p.status || "").startsWith("cache") ? "Cache aktiv" : p.status ? "Fehler" : "–";
    const stCls = p.status === "ok" ? "ok" : p.status === "loading" ? "load"
      : (p.status || "").startsWith("cache") ? "load" : "err";
    const typ = { xtream: "Xtream Codes", m3u: "M3U-Link", "m3u-text": "Lokale M3U" }[p.type] || p.type;
    if (p.enabled === false) card.classList.add("pl-off");
    card.innerHTML =
      `<label class="pl-switch" title="${p.enabled === false ? "Liste aktivieren" : "Liste deaktivieren"}">
         <input type="checkbox" data-a="toggle" ${p.enabled === false ? "" : "checked"}><span></span>
       </label>
       <div class="p-info"><div class="p-name">${esc(p.name)}</div>
       <div class="p-sub">${typ} · ${p.channels || 0} Sender${p.vod ? " · " + p.vod + " VOD" : ""}${p.enabled === false ? " · deaktiviert" : ""}</div></div>
       <span class="p-status ${stCls}">${stTxt}</span>
       <button class="ghost-btn" data-a="refresh" title="Neu laden">⟳</button>
       <button class="ghost-btn" data-a="groups" title="Gruppen verwalten">▤</button>
       <button class="ghost-btn" data-a="epg" title="EPG-Quelle">EPG</button>
       <button class="ghost-btn" data-a="del" title="Entfernen">✕</button>`;
    card.querySelector('[data-a="toggle"]').onchange = async e => {
      await api("/api/playlist/toggle", { id: p.id, enabled: e.target.checked });
      toast(e.target.checked ? "„" + p.name + "“ ist jetzt aktiv" : "„" + p.name + "“ wurde deaktiviert");
      await loadState();
      renderSettingsView();
      // Ansichten frisch aufbauen, damit nur aktive Listen erscheinen
      tvCurrentGroup = null;
      $("guide-group") && ($("guide-group").dataset.filled = "");
      renderHome();
    };
    card.querySelector('[data-a="refresh"]').onclick = async () => {
      await api("/api/playlist/update", { id: p.id, name: p.name, epgUrl: p.epgUrl || "", userAgent: p.userAgent || "", preferHls: !!p.preferHls, refresh: true });
      toast("Playlist wird neu geladen …");
      setTimeout(async () => { await loadState(); renderSettingsView(); }, 2500);
    };
    card.querySelector('[data-a="groups"]').onclick = () => openGroupsModal(p.id);
    card.querySelector('[data-a="epg"]').onclick = async () => {
      const u = prompt("EPG-Adresse (XMLTV-Link) für „" + p.name + "“:", p.epgUrl || "");
      if (u === null) return;
      await api("/api/playlist/update", { id: p.id, name: p.name, epgUrl: u.trim(), userAgent: p.userAgent || "", preferHls: !!p.preferHls });
      toast("EPG-Quelle gespeichert");
      api("/api/epg/refresh").catch(() => {});
      await loadState(); renderSettingsView();
    };
    card.querySelector('[data-a="del"]').onclick = async () => {
      if (!confirm("Playlist „" + p.name + "“ wirklich entfernen?")) return;
      await api("/api/playlist/update", { id: p.id, delete: true });
      await loadState();
      renderSettingsView();
      $("guide-group").dataset.filled = "";
      tvCurrentGroup = null;
      toast("Playlist entfernt");
    };
    box.appendChild(card);
  });
}

$("set-buffer").oninput = e => $("set-buffer-val").textContent = e.target.value + " s";
$("set-buffer").onchange = e => { st().bufferSec = +e.target.value; saveSettings(); toast("Puffer: " + e.target.value + " Sekunden (gilt ab dem nächsten Senderwechsel)"); };
$("set-enhance").onchange = e => { st().enhance = e.target.value; saveSettings(); };
$("set-audioboost").onchange = e => { st().audioBoost = e.target.checked; saveSettings(); };
$("set-buffermode").onchange = e => { st().bufferMode = e.target.value; saveSettings(); toast("Puffer-Modus gilt ab dem nächsten Senderstart"); };
$("set-buffertune").onchange = e => { st().bufferAutoTune = e.target.checked; saveSettings(); };
$("set-autoplay").onchange = e => { st().autoplayNext = e.target.checked; saveSettings(); };
$("set-audiodelay").oninput = e => { $("set-audiodelay-val").textContent = e.target.value + " ms"; };
$("set-audiodelay").onchange = e => { setAudioDelay(+e.target.value); toast("Ton-Versatz: " + e.target.value + " ms"); };

async function refreshPinUI() {
  let st;
  try { st = await api("/api/pin", {}); } catch { return; }
  $("pin-state").textContent = st.active ? (st.unlocked ? "aktiv · entsperrt" : "aktiv · gesperrt") : "nicht gesetzt";
  $("btn-pin-set").textContent = st.active ? "PIN ändern/entfernen" : "PIN festlegen";
  $("btn-pin-lock").classList.toggle("hidden", !st.active || !st.unlocked);
}
$("btn-pin-set").onclick = async () => {
  let st;
  try { st = await api("/api/pin", {}); } catch { return; }
  if (st.active && !st.unlocked) {
    const cur = prompt("Aktuelle PIN eingeben:");
    if (cur === null) return;
    try { await api("/api/pin", { unlock: cur }); } catch { toast("PIN falsch"); return; }
  }
  const np = prompt("Neue PIN (leer lassen = PIN-Schutz entfernen):");
  if (np === null) return;
  await api("/api/pin", { set: np });
  toast(np ? "PIN gespeichert" : "PIN-Schutz entfernt");
  refreshPinUI();
};
$("btn-pin-lock").onclick = async () => {
  await api("/api/pin", { lock: true });
  toast("Gruppen gesperrt");
  refreshPinUI();
  tvCurrentGroup = null;
};
$("set-playbackpref").onchange = e => { st().playbackPref = e.target.value; saveSettings(); };
$("set-startview").onchange = e => { st().startView = e.target.value; saveSettings(); };
$("set-accent").onchange = e => { st().accent = e.target.value; saveSettings(); applyAccent(); };
$("set-homebg").onchange = e => { st().homeBg = e.target.value; saveSettings(); applyHomeBg(); };
$("set-shownums").onchange = e => { st().showNums = e.target.checked; saveSettings(); applyShowNums(); };
$("set-quality").onchange = e => { st().quality = e.target.value; saveSettings(); };
$("set-autofull").onchange = e => { st().autoFull = e.target.checked; saveSettings(); };
$("set-fps").onchange = e => { st().fps = e.target.value; saveSettings(); };
$("btn-cache-clear").onclick = async () => {
  if (!confirm("Listen-Cache leeren und alle Playlists neu laden?")) return;
  try { await api("/api/cache/clear", { method: "POST" }); toast("Cache geleert – Listen werden neu geladen"); }
  catch (e) { toast("Fehler: " + e.message); }
};
$("btn-show-log").onclick = async () => {
  try {
    const lg = await api("/api/log");
    alert((lg.lines || []).slice(-40).join("\n") || "Keine Meldungen.");
  } catch (e) { toast("Fehler: " + e.message); }
};
$("set-sound").onchange = e => { st().startupSound = e.target.checked; saveSettings(); };
$("set-epgoffset").onchange = e => { st().epgOffset = +e.target.value; saveSettings(); api("/api/epg/refresh").catch(() => {}); toast("Zeitversatz gespeichert – EPG wird neu geladen"); };
$("btn-epg-refresh").onclick = () => { api("/api/epg/refresh").catch(() => {}); toast("EPG wird im Hintergrund aktualisiert …"); };

async function openGroupsModal(plID) {
  const box = $("groups-modal-list");
  box.innerHTML = '<p class="muted" style="padding:10px">Lade …</p>';
  $("groups-modal").classList.remove("hidden");
  let groups = [];
  try { groups = await api("/api/groups?pl=" + encodeURIComponent(plID)); } catch {}
  box.innerHTML = groups.length ? "" : '<p class="muted" style="padding:10px">Keine Gruppen vorhanden.</p>';
  groups.forEach(g => {
    const r = document.createElement("label");
    r.className = "row";
    r.style.cursor = "pointer";
    r.innerHTML = `<input type="checkbox" ${g.hidden ? "" : "checked"} style="width:18px;height:18px;accent-color:var(--acc1)">
      <div class="r-main"><div class="r-name">${esc(g.name)}</div></div>
      <button class="ghost-btn" data-a="lock" title="${g.locked ? "Gruppensperre aufheben" : "Gruppe mit PIN sperren"}" style="padding:4px 9px">${g.locked ? "🔒" : "🔓"}</button>
      <span class="r-count">${g.count}</span>`;
    r.querySelector("input").onchange = e =>
      api("/api/groups/hide", { pl: plID, group: g.name, hidden: !e.target.checked }).catch(() => {});
    r.querySelector('[data-a="lock"]').onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      let st;
      try { st = await api("/api/pin", {}); } catch { return; }
      if (!st.active) { toast("Lege zuerst in den Einstellungen unter „Sicherheit“ eine PIN fest."); return; }
      if (!st.unlocked) {
        const p = prompt("PIN eingeben:");
        if (p === null) return;
        try { await api("/api/pin", { unlock: p }); } catch { toast("PIN falsch"); return; }
      }
      const nowLocked = e.target.textContent === "🔓";
      await api("/api/pin", { group: g.name, pl: plID, on: nowLocked });
      e.target.textContent = nowLocked ? "🔒" : "🔓";
      toast(nowLocked ? "Gruppe gesperrt" : "Sperre aufgehoben");
    };
    box.appendChild(r);
  });
  $("groups-modal-close").onclick = () => { closeModal("groups-modal"); tvCurrentGroup = null; $("guide-group").dataset.filled = ""; if (currentView === "tv") loadTvView(); };
}

function closeModal(id) { $(id).classList.add("hidden"); }
$("prog-close").onclick = () => closeModal("prog-modal");
$("series-close").onclick = () => closeModal("series-modal");
document.querySelectorAll(".modal-bg").forEach(m =>
  m.addEventListener("click", e => {
    if (e.target !== m) return;
    if (m.id === "setup" && !state.playlists.length) return;
    closeModal(m.id);
  }));

/* ============================================================
   Setup-Assistent
   ============================================================ */
let setupTab = "xtream", fileContent = "";
function openSetup(first) {
  $("setup-title").textContent = first ? "Willkommen bei EX-IPTV" : "Playlist hinzufügen";
  $("setup-cancel").classList.toggle("hidden", !!first);
  $("setup-error").classList.add("hidden");
  $("setup").classList.remove("hidden");
}
$("btn-add-playlist").onclick = () => openSetup(false);
$("setup-cancel").onclick = () => closeModal("setup");

document.querySelectorAll("#setup .tab").forEach(t => t.onclick = () => {
  setupTab = t.dataset.tab;
  document.querySelectorAll("#setup .tab").forEach(x => x.classList.toggle("active", x === t));
  document.querySelectorAll("#setup .tab-pane").forEach(p => p.classList.add("hidden"));
  $("pane-" + setupTab).classList.remove("hidden");
});

$("file-input").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  $("file-chosen").textContent = f.name + " (" + fmtBytes(f.size) + ")";
  const r = new FileReader();
  r.onload = () => fileContent = String(r.result || "");
  r.readAsText(f);
};

$("setup-save").onclick = async () => {
  const err = $("setup-error");
  err.classList.add("hidden");
  let payload;
  if (setupTab === "xtream") {
    payload = { type: "xtream", name: $("xt-name").value, server: $("xt-server").value, username: $("xt-user").value, password: $("xt-pass").value };
    if (!payload.server || !payload.username) { err.textContent = "Bitte Server, Benutzername und Passwort eingeben."; err.classList.remove("hidden"); return; }
    if (!/^https?:\/\//i.test(payload.server)) payload.server = "http://" + payload.server;
  } else if (setupTab === "m3u") {
    payload = { type: "m3u", name: $("m3u-name").value, url: $("m3u-url").value.trim(), epgUrl: $("m3u-epg").value.trim() };
    if (!/^https?:\/\//i.test(payload.url)) { err.textContent = "Bitte einen gültigen M3U-Link (http/https) eingeben."; err.classList.remove("hidden"); return; }
  } else if (setupTab === "file") {
    if (!fileContent) { err.textContent = "Bitte zuerst eine M3U-Datei auswählen."; err.classList.remove("hidden"); return; }
    payload = { type: "m3u-text", name: $("file-name").value, content: fileContent };
  } else {
    payload = { type: "m3u", name: "Demo Deutschland (frei empfangbar)", url: "https://iptv-org.github.io/iptv/countries/de.m3u" };
  }
  const btn = $("setup-save");
  btn.disabled = true; btn.textContent = "Wird geprüft …";
  try {
    await api("/api/playlist/add", payload);
    await loadState();
    closeModal("setup");
    toast("Playlist hinzugefügt – Senderliste wird geladen");
    tvCurrentGroup = null;
    $("guide-group").dataset.filled = "";
    renderHome();
    showView("tv");
    setTimeout(async () => { await loadState(); if (currentView === "tv") loadTvView(); renderHome(); }, 2500);
  } catch (e) {
    err.textContent = e.message || "Die Playlist konnte nicht geladen werden.";
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Playlist hinzufügen";
  }
};

/* ---------------- Los geht's ---------------- */
boot().catch(e => { splashStatus("Fehler: " + e.message); });

// Diagnose-Brücke (auch für Support nützlich): Einblick in den Spielerzustand
// Schlanke Diagnose-Brücke für den Support: zeigt nur den aktuellen
// Wiedergabezustand, ohne interne Steuerung nach außen zu geben.
window._dbg = {
  get state() {
    return {
      sender: playerCtx ? playerCtx.title : "",
      stufe: playerCtx ? playerCtx.stage : -1,
      spielt: !video.paused,
      bildKam: everPlayed,
      puffer: bufferBoost,
    };
  },
};

})();
