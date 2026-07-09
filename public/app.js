// ============================================================
// VOXEMPIRE — Client. Pollt /api/state, rendert Tabs,
// tickt Countdowns & Rohstoffanzeige lokal zwischen den Polls.
// ============================================================
"use strict";

const $ = (sel) => document.querySelector(sel);

// Clientseitige Einstellungen (nur lokal, pro Browser)
const SETTINGS_KEY = "vox_settings";
const DEFAULT_SETTINGS = { notifications: true, pollMs: 4000 };
let settings = loadSettings();

function loadSettings() {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let token = localStorage.getItem("vox_token") || null;
let meta = null; // Gebäude-/Einheiten-Stammdaten vom Server
let state = null; // letzter /api/state-Stand
let stateAt = 0; // lokaler Zeitpunkt des letzten State-Empfangs
let clockOffset = 0; // serverTime - clientTime
let activeTab = "dorf";
let mapCenter = null; // {x,y}
let selectedTile = null;
let selectedNode = null; // aktuell gewähltes Rohstoffvorkommen auf der Karte
let selectedExplore = null; // {x,y}: angeklicktes Nebelfeld zum Erkunden
let pendingMapSelect = null; // {x,y}: nach dem Kartenwechsel dieses Dorf auswählen
// Zuletzt erspähte Verteidigungsdaten je Zielkoordinate ("x,y") aus eigenen
// Spähberichten – speist die Erfolgsprognose für Angriff & Spähen.
let scoutIntel = {};
let scoutIntelFetchedAt = 0; // Zeitpunkt des letzten Berichte-Abrufs für den Cache
let pollTimer = null;
let chatTimer = null; // eigener Poll-Timer, läuft nur wenn der Chat-Tab offen ist

// ---------------- API ----------------

async function api(path, body) {
  const opts = {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showAuth();
    throw new Error(data.error || "Nicht eingeloggt.");
  }
  if (!res.ok) throw new Error(data.error || "Serverfehler.");
  return data;
}

// ---------------- Format-Helfer ----------------

const fmtNum = (n) => Math.floor(n).toLocaleString("de-DE");

function fmtDur(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

const fmtTime = (ts) =>
  new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const serverNow = () => Date.now() + clockOffset;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const RES_NAMES = { holz: "Holz", stein: "Stein", eisen: "Eisen" };

// Countdown-Element mit sofort korrektem Startwert. Wird das umgebende HTML
// alle paar Sekunden neu aufgebaut, zeigt der Timer direkt die verbleibende
// Zeit statt eines "…"-Platzhalters — so flackert nichts mehr. Der Sekunden-
// Tick unten aktualisiert danach jedes Element anhand von data-done weiter.
function countdown(done, { tag = "span", cls = "" } = {}) {
  const rem = Number(done) - serverNow();
  const klass = "countdown" + (cls ? " " + cls : "");
  return `<${tag} class="${klass}" data-done="${done}">${fmtDur(rem)}</${tag}>`;
}

function costHtml(cost, res) {
  const icons = { holz: "🪵", stein: "🪨", eisen: "⛓️" };
  return Object.entries(cost)
    .map(
      ([r, n]) =>
        `<span class="${res && res[r] < n ? "no" : ""}" title="${RES_NAMES[r]}">${icons[r]} ${fmtNum(n)}</span>`,
    )
    .join(" ");
}

// ---------------- Notifications ----------------
// Animierter Stack oben rechts. Klick auf die Karte wechselt optional den Tab,
// der Fortschrittsbalken (animationend) schließt automatisch, Hover pausiert.

const NOTIFY_ICONS = {
  info: "ℹ️",
  error: "⚠️",
  build: "🏗️",
  train: "🛡️",
  return: "↩️",
  report: "📜",
  danger: "🚨",
};

// Erfolgsmeldungen bekommen einen Konfetti-Regenbogen; Warnungen nicht.
const NOTIFY_CELEBRATE = new Set(["build", "train", "return", "report"]);
const CONFETTI_COLORS = [
  "#e8b64c",
  "#6fc276",
  "#6ea8dc",
  "#e05f5f",
  "#f2c766",
  "#ffffff",
];

// Streut ein paar prozedurale Konfetti-Partikel über die Notification.
function spawnConfetti(el) {
  const layer = document.createElement("div");
  layer.className = "n-confetti";
  for (let i = 0; i < 16; i++) {
    const p = document.createElement("i");
    const dx = (Math.random() * 2 - 1) * 120; // horizontaler Drift
    const dy = 60 + Math.random() * 90; // Fallhöhe
    const rot = (Math.random() * 2 - 1) * 540; // Rotation
    p.style.cssText =
      `left:${8 + Math.random() * 84}%;` +
      `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};` +
      `--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;` +
      `animation-delay:${Math.random() * 0.15}s;` +
      (Math.random() < 0.5 ? "border-radius:50%;" : "");
    layer.appendChild(p);
  }
  el.appendChild(layer);
  layer.addEventListener("animationend", () => layer.remove());
}

function notify({
  type = "info",
  title,
  body = "",
  tab = null,
  ttl = 6000,
  celebrate,
} = {}) {
  const stack = $("#notifyStack");
  const el = document.createElement("div");
  el.className = `notif n-${type}`;
  el.innerHTML = `
    <div class="n-icon"><span class="n-ring"></span><span class="n-glyph">${NOTIFY_ICONS[type] || NOTIFY_ICONS.info}</span></div>
    <div class="n-text"><b>${esc(title)}</b>${body ? `<span>${body}</span>` : ""}</div>
    <button class="n-close" title="Schließen">✕</button>
    <i class="n-progress" style="animation-duration:${ttl}ms"></i>`;
  if (celebrate ?? NOTIFY_CELEBRATE.has(type)) spawnConfetti(el);
  const close = () => {
    if (el._closed) return;
    el._closed = true;
    el.classList.add("out");
    // animationend bubbelt auch von Kind-Elementen — nur auf die Ausblend-Animation reagieren
    el.addEventListener("animationend", (e) => {
      if (e.animationName === "notif-out") el.remove();
    });
  };
  el.querySelector(".n-close").addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  el.querySelector(".n-progress").addEventListener("animationend", close);
  el.addEventListener("click", () => {
    if (tab) switchTab(tab);
    close();
  });
  stack.appendChild(el);
  while (stack.children.length > 5) stack.firstElementChild.remove();
}

function toast(msg, isError = false) {
  notify({
    type: isError ? "error" : "info",
    title: msg,
    ttl: isError ? 5000 : 3500,
  });
}

// Vergleicht alten und neuen State und meldet, was dazwischen passiert ist.
function detectCompletions(prev, next) {
  if (!prev) return;
  const now = next.serverTime;
  const key = (...parts) => parts.join("|");

  // Fertige Bauaufträge
  const nq = new Set(
    next.village.queue.map((q) => key(q.b, q.toLevel, q.done)),
  );
  for (const q of prev.village.queue) {
    if (q.done <= now && !nq.has(key(q.b, q.toLevel, q.done))) {
      notify({
        type: "build",
        title: "Ausbau abgeschlossen",
        body: `${meta.BUILDINGS[q.b].name} ist jetzt <b class="gold">Stufe ${q.toLevel}</b>.`,
        tab: "dorf",
      });
    }
  }

  // Fertige Ausbildung
  const ntq = new Set(
    next.village.trainQueue.map((q) => key(q.unit, q.count, q.done)),
  );
  for (const q of prev.village.trainQueue) {
    if (q.done <= now && !ntq.has(key(q.unit, q.count, q.done))) {
      notify({
        type: "train",
        title: "Ausbildung abgeschlossen",
        body: `${q.count}× ${meta.UNITS[q.unit].name} ${q.count === 1 ? "steht" : "stehen"} bereit.`,
        tab: "militaer",
      });
    }
  }

  // Zurückgekehrte Truppen (Angriffs-Einschlag selbst meldet der neue Bericht)
  const nret = new Set(
    next.movements.outgoing.filter((m) => m.type === "return").map((m) => m.at),
  );
  for (const m of prev.movements.outgoing) {
    if (m.type === "return" && m.at <= now && !nret.has(m.at)) {
      const hasLoot = m.loot && m.loot.holz + m.loot.stein + m.loot.eisen > 0;
      notify({
        type: "return",
        title: "Truppen zurückgekehrt",
        body: hasLoot
          ? `Beute: ${costHtml(m.loot)}`
          : "Deine Truppen sind wieder im Dorf.",
        tab: "militaer",
      });
    }
  }

  // Zurückgekehrte Bewohner von Sammelmissionen
  const ngret = new Set(
    next.movements.outgoing
      .filter((m) => m.type === "gatherReturn")
      .map((m) => m.at),
  );
  for (const m of prev.movements.outgoing) {
    if (m.type === "gatherReturn" && m.at <= now && !ngret.has(m.at)) {
      const resName = RES_NAMES[m.res] || m.res;
      notify({
        type: "return",
        title: "Bewohner zurückgekehrt",
        body: m.yield
          ? `Gesammelt: <b class="gold">+${fmtNum(m.yield)} ${resName}</b>.`
          : "Deine Bewohner sind wieder im Dorf.",
        tab: "karte",
      });
    }
  }

  // Neue Berichte
  if (next.unreadReports > prev.unreadReports) {
    const n = next.unreadReports - prev.unreadReports;
    notify({
      type: "report",
      title: n === 1 ? "Neuer Bericht" : `${n} neue Berichte`,
      body: "Klicken zum Öffnen.",
      tab: "berichte",
    });
  }

  // Neue Freundschaftsanfragen
  if ((next.pendingFriendRequests || 0) > (prev.pendingFriendRequests || 0)) {
    const n = next.pendingFriendRequests - prev.pendingFriendRequests;
    notify({
      type: "info",
      title:
        n === 1
          ? "Neue Freundschaftsanfrage"
          : `${n} neue Freundschaftsanfragen`,
      body: "Klicken zum Öffnen.",
      tab: "freunde",
    });
  }

  // Aufträge: Stufenaufstieg & neu abschließbare Aufträge
  const pQuest = prev.quests || {};
  const nQuest = next.quests || {};
  if ((nQuest.level || 0) > (pQuest.level || 0)) {
    notify({
      type: "report",
      title: `Stufe ${nQuest.level} erreicht!`,
      body: "Neue Aufträge könnten freigeschaltet sein.",
      tab: "auftraege",
      ttl: 9000,
    });
  }
  if ((nQuest.claimable || 0) > (pQuest.claimable || 0)) {
    const n = nQuest.claimable - (pQuest.claimable || 0);
    notify({
      type: "report",
      title: n === 1 ? "Auftrag abschließbar" : `${n} Aufträge abschließbar`,
      body: "Belohnung im Aufträge-Tab abholen.",
      tab: "auftraege",
    });
  }

  // Neue eingehende Angriffe
  const pinc = new Set(
    prev.movements.incoming.map((m) => key(m.at, m.fromOwner)),
  );
  for (const m of next.movements.incoming) {
    if (!pinc.has(key(m.at, m.fromOwner))) {
      notify({
        type: "danger",
        title: "Angriff im Anmarsch!",
        body: `${esc(m.fromOwner)} greift dich an — Ankunft ${fmtTime(m.at)}.`,
        tab: "militaer",
        ttl: 12000,
      });
    }
  }

  // Anfängerschutz abgelaufen
  if (
    prev.village.protectedUntil > prev.serverTime &&
    next.village.protectedUntil <= now
  ) {
    notify({
      type: "info",
      title: "Anfängerschutz beendet",
      body: "Dein Dorf kann jetzt angegriffen werden.",
      ttl: 9000,
    });
  }
}

// ---------------- Auth ----------------

function showAuth() {
  token = null;
  state = null;
  localStorage.removeItem("vox_token");
  clearInterval(pollTimer);
  clearInterval(chatTimer);
  chatTimer = null;
  $("#gameScreen").classList.add("hidden");
  $("#authScreen").classList.remove("hidden");
}

async function doAuth(register) {
  const name = $("#authName").value.trim();
  const pass = $("#authPass").value;
  $("#authError").textContent = "";
  try {
    const r = await api(register ? "/api/register" : "/api/login", {
      name,
      pass,
    });
    token = r.token;
    localStorage.setItem("vox_token", token);
    await enterGame();
  } catch (e) {
    $("#authError").textContent = e.message;
  }
}

async function enterGame() {
  if (!meta) meta = await api("/api/meta");
  await refreshState();
  $("#authScreen").classList.add("hidden");
  $("#gameScreen").classList.remove("hidden");
  $("#userName").textContent = state.user.name;
  if (!mapCenter) mapCenter = { x: state.village.x, y: state.village.y };
  switchTab("dorf");
  startPolling();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      await refreshState();
      renderActiveTabIfCheap();
    } catch {
      /* offline? nächster Poll */
    }
  }, settings.pollMs);
}

// ---------------- State & Header ----------------

// Zentrale Übernahme eines frischen States: erst diffen (Notifications), dann setzen.
function applyState(next) {
  detectCompletions(state, next);
  state = next;
  stateAt = Date.now();
  clockOffset = state.serverTime - stateAt;
  renderHeader();
}

async function refreshState() {
  applyState(await api("/api/state"));
}

// Aktives Dorf wechseln (Startdorf oder erobertes Dorf) und Ansicht neu aufbauen.
async function selectVillage(id) {
  try {
    const next = await api("/api/village/select", { id });
    applyState(next);
    mapCenter = { x: state.village.x, y: state.village.y };
    selectedTile = null;
    selectedNode = null;
    reportVillage = state.village.id; // Berichts-Ansicht folgt dem aktiven Dorf
    renderTab(activeTab);
    toast(`Aktives Dorf: ${state.village.name}`);
  } catch (e) {
    toast(e.message, true);
  }
}

// Rohstoffe zwischen zwei Polls clientseitig hochzählen
function liveRes(r) {
  const v = state.village;
  const elapsed = (Date.now() - stateAt) / 3_600_000;
  return Math.min(v.storage, v.res[r] + v.rates[r] * elapsed);
}

function renderHeader() {
  const v = state.village;
  const cap = fmtNum(v.storage);
  $("#resHolz").textContent = `${fmtNum(liveRes("holz"))}/${cap}`;
  $("#resStein").textContent = `${fmtNum(liveRes("stein"))}/${cap}`;
  $("#resEisen").textContent = `${fmtNum(liveRes("eisen"))}/${cap}`;
  $("#rateHolz").textContent = `+${fmtNum(v.rates.holz)}/h`;
  $("#rateStein").textContent = `+${fmtNum(v.rates.stein)}/h`;
  $("#rateEisen").textContent = `+${fmtNum(v.rates.eisen)}/h`;
  $("#resPop").textContent = `${v.pop}/${v.popCap}`;
  const resEl = $("#resResidents");
  if (resEl && v.residents) {
    resEl.textContent = `${v.residents.idle}/${v.residents.total}`;
    const lost = v.residents.lost || 0;
    resEl.title = lost
      ? `${lost} Bewohner gefallen – wachsen im Rathaus nach (1 je ${fmtDur(v.residents.regenMs)})`
      : "Freie / verfügbare Bewohner";
    resEl.classList.toggle("res-wounded", lost > 0);
  }

  // Dorf-Auswahl: nur einblenden, wenn man mehr als ein Dorf besitzt.
  const vsel = $("#villageSelect");
  if (vsel && state.villages) {
    const many = state.villages.length > 1;
    vsel.classList.toggle("hidden", !many);
    if (many) {
      vsel.innerHTML = state.villages
        .map(
          (vv) =>
            `<option value="${vv.id}" ${vv.active ? "selected" : ""}>🏰 ${esc(vv.name)} (${vv.x}|${vv.y})</option>`,
        )
        .join("");
      vsel.onchange = () => selectVillage(vsel.value);
    }
  }

  const badge = $("#reportBadge");
  badge.classList.toggle("hidden", state.unreadReports === 0);
  badge.textContent = state.unreadReports;

  const fBadge = $("#friendBadge");
  if (fBadge) {
    const pending = state.pendingFriendRequests || 0;
    fBadge.classList.toggle("hidden", pending === 0);
    fBadge.textContent = pending;
  }

  const mBadge = $("#marketBadge");
  if (mBadge) {
    const offers = state.marketOffers || 0;
    mBadge.classList.toggle("hidden", offers === 0);
    mBadge.textContent = offers;
  }

  const cBadge = $("#chatBadge");
  if (cBadge) {
    const unread = state.unreadChat || 0;
    cBadge.classList.toggle("hidden", unread === 0);
    cBadge.textContent = unread;
  }

  const q = state.quests;
  const lvlChip = $("#levelChip");
  if (lvlChip && q) {
    lvlChip.classList.remove("hidden");
    lvlChip.textContent = `Lv ${q.level}`;
    lvlChip.title = `Stufe ${q.level} — ${fmtNum(q.into)}/${fmtNum(q.need)} XP`;
  }
  const qBadge = $("#questBadge");
  if (qBadge && q) {
    qBadge.classList.toggle("hidden", (q.claimable || 0) === 0);
    qBadge.textContent = q.claimable || 0;
  }

  const prot = $("#protectionBanner");
  if (v.protectedUntil > serverNow()) {
    prot.classList.remove("hidden");
    prot.innerHTML = `🛡️ Anfängerschutz aktiv — du kannst nicht angegriffen werden. Endet in ${countdown(v.protectedUntil, { tag: "b" })} (oder mit deinem ersten Angriff).`;
  } else prot.classList.add("hidden");

  const inc = $("#incomingBanner");
  if (state.movements.incoming.length) {
    const next = [...state.movements.incoming].sort((a, b) => a.at - b.at)[0];
    inc.classList.remove("hidden");
    inc.innerHTML = `⚠️ ${state.movements.incoming.length} Angriff(e) im Anmarsch! Nächster von ${esc(next.fromOwner)} in ${countdown(next.at, { tag: "b" })}`;
  } else inc.classList.add("hidden");
}

// ---------------- Tabs ----------------

function switchTab(tab) {
  activeTab = tab;
  document
    .querySelectorAll(".tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + tab));
  renderTab(tab);
  updateChatPolling();
}

// Chat separat pollen (eigene API-Route), aber nur solange der Tab sichtbar ist.
function updateChatPolling() {
  clearInterval(chatTimer);
  chatTimer = null;
  if (activeTab === "chat" && token) {
    chatTimer = setInterval(pollChat, settings.pollMs);
  }
}

const renderers = {};

function renderTab(tab) {
  (renderers[tab] || (() => {}))();
}

// Nach jedem Poll nur die günstigen (rein lokalen) Tabs neu zeichnen
function renderActiveTabIfCheap() {
  if (activeTab === "dorf") refreshDorfCheap();
  else if (activeTab === "militaer") renderTab("militaer");
}

// ---------------- Tab: Dorf ----------------

let selectedBuilding = "rathaus"; // aktuell in der Szene angeklicktes Gebäude

const BUILDING_ICONS = {
  rathaus: "🏛️",
  holz: "🌲",
  stein: "⛏️",
  eisen: "⚒️",
  lager: "📦",
  farm: "🌾",
  kaserne: "🛡️",
  markt: "⚖️",
  mauer: "🧱",
};

// Beschriftung für die Wirkungszeile (effectNow/effectNext vom Server)
const EFFECT_LABELS = {
  rathaus: "Bauzeit",
  holz: "Produktion",
  stein: "Produktion",
  eisen: "Produktion",
  lager: "Lager",
  farm: "Versorgung",
  kaserne: "Ausbildung",
  markt: "Handel",
  mauer: "Verteidigung",
};

// Prozedurale Einheiten-Portraits (Inline-SVG, gleiche Palette wie die Dorf-Szene).
// Keine Binärdateien — passend zum asset-freien Stil des Projekts.
const UNIT_ICONS = {
  // Speerträger — defensiv: Speer, Rundschild, blaue Tunika
  speer: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <line x1="41" y1="7" x2="15" y2="49" stroke="#a07a4c" stroke-width="2.6" stroke-linecap="round"/>
    <polygon points="41,7 37,13 44,12" fill="#c2c8d2"/>
    <rect x="23" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="29" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="21" y="25" width="14" height="18" rx="4" fill="#3f6fb0"/>
    <circle cx="28" cy="19" r="6" fill="#e0a878"/>
    <path d="M22 19a6 6 0 0 1 12 0z" fill="#c2c8d2"/>
    <rect x="26" y="8" width="4" height="5" rx="2" fill="#b85647"/>
    <ellipse cx="18" cy="34" rx="6.5" ry="8.5" fill="#b85647" stroke="#8a3f34" stroke-width="1.6"/>
    <path d="M18 26v16M11 34h14" stroke="#e8b64c" stroke-width="1.3"/>
  </svg>`,
  // Schwertkämpfer — offensiv: erhobenes Schwert, rote Tunika
  schwert: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="23" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="29" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="21" y="25" width="14" height="18" rx="4" fill="#b85647"/>
    <circle cx="28" cy="19" r="6" fill="#e0a878"/>
    <path d="M22 19a6 6 0 0 1 12 0z" fill="#c2c8d2"/>
    <path d="M33 30 L42 20" stroke="#e0a878" stroke-width="3" stroke-linecap="round"/>
    <line x1="42" y1="20" x2="49" y2="8" stroke="#c2c8d2" stroke-width="3" stroke-linecap="round"/>
    <polygon points="50,6 46,11 52,10" fill="#dfe4ec"/>
    <line x1="39" y1="19" x2="45" y2="23" stroke="#e8b64c" stroke-width="2.4"/>
    <ellipse cx="17" cy="35" rx="5" ry="6.5" fill="#8a6239" stroke="#654824" stroke-width="1.3"/>
  </svg>`,
  // Reiter — Kavallerie: berittener Lanzenträger
  reiter: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 33 q-6 3 -5 11" stroke="#654824" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="28" cy="36" rx="16" ry="7" fill="#8a6239"/>
    <rect x="16" y="40" width="3.5" height="10" fill="#654824"/>
    <rect x="23" y="41" width="3.5" height="9" fill="#654824"/>
    <rect x="32" y="41" width="3.5" height="9" fill="#654824"/>
    <rect x="39" y="40" width="3.5" height="10" fill="#654824"/>
    <path d="M40 34 q6 -4 6 -12 l4 1 q-1 9 -6 14 z" fill="#8a6239"/>
    <polygon points="49,21 54,20 50,26" fill="#8a6239"/>
    <path d="M41 22 q3 -3 6 -1" stroke="#654824" stroke-width="3" fill="none"/>
    <rect x="24" y="20" width="9" height="12" rx="3" fill="#b85647"/>
    <circle cx="28.5" cy="16" r="4.5" fill="#e0a878"/>
    <path d="M24 16a4.5 4.5 0 0 1 9 0z" fill="#c2c8d2"/>
    <line x1="34" y1="10" x2="34" y2="40" stroke="#a07a4c" stroke-width="2"/>
    <polygon points="34,8 31,13 37,13" fill="#c2c8d2"/>
  </svg>`,
  // Späher — schnelle Aufklärung: Kapuzenläufer mit Fernrohr
  spaeher: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <line x1="26" y1="42" x2="21" y2="50" stroke="#654824" stroke-width="4" stroke-linecap="round"/>
    <line x1="30" y1="42" x2="35" y2="49" stroke="#654824" stroke-width="4" stroke-linecap="round"/>
    <path d="M20 24 q8 -6 16 0 l3 20 q-11 4 -22 0 z" fill="#4a9440"/>
    <path d="M20 22 q8 -12 16 0 q-2 6 -8 6 q-6 0 -8 -6z" fill="#316328"/>
    <circle cx="28" cy="20" r="4.5" fill="#e0a878"/>
    <rect x="30" y="16" width="16" height="4" rx="2" fill="#8a6239" transform="rotate(-18 30 18)"/>
    <circle cx="45" cy="11" r="2.4" fill="#93cbec"/>
  </svg>`,
  // Bogenschütze — offensiv: gespannter Bogen, grün-brauner Waldläufer
  bogen: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="23" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="29" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="21" y="25" width="14" height="18" rx="4" fill="#4a7a3a"/>
    <circle cx="28" cy="19" r="6" fill="#e0a878"/>
    <path d="M22 19a6 6 0 0 1 12 0z" fill="#316328"/>
    <path d="M42 6 Q52 28 42 50" stroke="#8a6239" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <line x1="42" y1="6" x2="42" y2="50" stroke="#dfe4ec" stroke-width="1.2"/>
    <line x1="42" y1="28" x2="20" y2="28" stroke="#c2c8d2" stroke-width="1.8"/>
    <polygon points="20,28 25,25.5 25,30.5" fill="#c2c8d2"/>
  </svg>`,
  // Axtkämpfer — schwere Offensive: erhobene Streitaxt, brauner Panzer
  axt: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="23" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="29" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="20" y="25" width="16" height="18" rx="4" fill="#6d5433"/>
    <path d="M20 30h16" stroke="#4f3922" stroke-width="1.6"/>
    <circle cx="28" cy="19" r="6" fill="#e0a878"/>
    <path d="M22 19a6 6 0 0 1 12 0z" fill="#8a6239"/>
    <line x1="38" y1="46" x2="44" y2="10" stroke="#8a6239" stroke-width="3" stroke-linecap="round"/>
    <path d="M44 8 q10 2 9 12 q-9 -2 -13 -3 z" fill="#c2c8d2" stroke="#8b919d" stroke-width="1.2"/>
  </svg>`,
  // Panzerwache — schwere Defensive: Turmschild, Vollhelm, Stahlpanzer
  wache: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="22" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="30" y="41" width="4" height="9" rx="1.5" fill="#654824"/>
    <rect x="20" y="24" width="16" height="19" rx="4" fill="#8b919d"/>
    <path d="M20 30h16M20 36h16" stroke="#595f6b" stroke-width="1.4"/>
    <rect x="22" y="12" width="12" height="13" rx="5" fill="#aab0bb"/>
    <rect x="24" y="17" width="8" height="2.6" fill="#343b46"/>
    <rect x="8" y="18" width="15" height="26" rx="4" fill="#6ea8dc" stroke="#3f6fb0" stroke-width="1.6"/>
    <path d="M15.5 18v26M8 31h15" stroke="#e8b64c" stroke-width="1.4"/>
  </svg>`,
  // Belagerungsramme — Sturmbock: Baumstamm mit Eisenkopf auf Rädern
  ramme: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 16 L44 16 L40 22 L12 22 Z" fill="#654824"/>
    <line x1="12" y1="22" x2="16" y2="34" stroke="#4f3922" stroke-width="3"/>
    <line x1="40" y1="22" x2="36" y2="34" stroke="#4f3922" stroke-width="3"/>
    <rect x="10" y="33" width="34" height="7" rx="3.5" fill="#8a6239"/>
    <rect x="8" y="34" width="12" height="5" rx="2.5" fill="#a07a4c"/>
    <path d="M44 32 q10 3.5 10 4 q0 0.5 -10 4 z" fill="#8b919d" stroke="#595f6b" stroke-width="1.2"/>
    <circle cx="16" cy="45" r="5" fill="#654824" stroke="#4f3922" stroke-width="1.6"/>
    <circle cx="38" cy="45" r="5" fill="#654824" stroke="#4f3922" stroke-width="1.6"/>
    <circle cx="16" cy="45" r="1.6" fill="#a07a4c"/><circle cx="38" cy="45" r="1.6" fill="#a07a4c"/>
  </svg>`,
  // Paladin — Elite-Kavallerie: gepanzerter Ritter mit Banner
  paladin: `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 33 q-6 3 -5 11" stroke="#595f6b" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="28" cy="36" rx="16" ry="7" fill="#6d7684"/>
    <rect x="16" y="40" width="3.5" height="10" fill="#595f6b"/>
    <rect x="23" y="41" width="3.5" height="9" fill="#595f6b"/>
    <rect x="32" y="41" width="3.5" height="9" fill="#595f6b"/>
    <rect x="39" y="40" width="3.5" height="10" fill="#595f6b"/>
    <path d="M40 34 q6 -4 6 -12 l4 1 q-1 9 -6 14 z" fill="#6d7684"/>
    <polygon points="49,21 54,20 50,26" fill="#6d7684"/>
    <rect x="24" y="19" width="9" height="13" rx="3" fill="#aab0bb"/>
    <path d="M24 25h9" stroke="#595f6b" stroke-width="1.3"/>
    <rect x="24" y="13" width="9" height="8" rx="3.5" fill="#c2c8d2"/>
    <rect x="26" y="16" width="5" height="2" fill="#343b46"/>
    <line x1="35" y1="8" x2="35" y2="40" stroke="#8a6239" stroke-width="2"/>
    <path d="M35 9 l11 3 l-11 4 z" fill="#b85647" stroke="#8a3f34" stroke-width="1"/>
  </svg>`,
};

// Gebäude-Raster (linke Spalte im Dorf-Tab): zeigt alle Gebäude als Karten —
// gebaute Gebäude mit Stufe, noch nicht gebaute mit „Neu", sowie ausgegraute
// Vorschauen für Gebäude, die erst mit höherem Rathaus freigeschaltet werden.
function buildingGridHtml() {
  const v = state.village;
  const cards = Object.keys(meta.BUILDINGS)
    .map((key) => {
      const def = meta.BUILDINGS[key];
      const b = v.buildings[key];
      const sel = key === selectedBuilding ? " selected" : "";
      const locked = b.locked ? " locked" : "";
      const inProgress = v.queue.some((q) => q.b === key);
      let badge;
      if (b.locked) {
        badge = `<span class="bld-lock">🔒 ${esc(b.reqText || "gesperrt")}</span>`;
      } else if (b.level > 0) {
        badge = `<span class="bld-lvl">Stufe ${b.level}</span>`;
      } else {
        badge = `<span class="bld-new">✦ Neu</span>`;
      }
      return `
      <button type="button" class="bld-card${sel}${locked}" onclick="selectBuilding('${key}')" title="${esc(def.name)}">
        <span class="bld-ic">${BUILDING_ICONS[key] || "🏛️"}</span>
        <span class="bld-name">${esc(def.name)}</span>
        ${badge}
        ${inProgress ? '<span class="bld-progress-dot" title="Ausbau läuft">🔨</span>' : ""}
      </button>`;
    })
    .join("");
  return `<div class="bld-grid" id="bldGrid">${cards}</div>`;
}

// Detail-Panel für das ausgewählte Gebäude (rechte Spalte)
function buildingPanelHtml() {
  const v = state.village;
  const key = selectedBuilding;
  const def = meta.BUILDINGS[key];
  const b = v.buildings[key];
  const maxed = !b.nextCost;
  const q = v.queue.find((it) => it.b === key);
  const afford =
    !maxed && Object.entries(b.nextCost).every(([r, n]) => liveRes(r) >= n);
  const live = Object.fromEntries(
    ["holz", "stein", "eisen"].map((r) => [r, liveRes(r)]),
  );

  let action;
  if (q) {
    action = `<div class="bp-progress"><span class="dot"></span>Ausbau auf Stufe ${q.toLevel} läuft — ${countdown(q.done)}</div>`;
  } else if (b.locked) {
    action = `
      <div class="bp-locked">
        <div class="bp-locked-head">🔒 Noch nicht verfügbar</div>
        <p class="muted">Benötigt <b class="gold">${esc(b.reqText || "höheres Rathaus")}</b>, um dieses Gebäude zu bauen.</p>
      </div>`;
  } else if (maxed) {
    action = `<div class="bp-maxed">✦ Maximalstufe erreicht</div>`;
  } else {
    action = `
      <div class="bp-next">
        <div class="bp-next-head"><span>Ausbau auf Stufe ${b.level + 1}</span><span class="duration">⏱ ${fmtDur(b.nextTime)}</span></div>
        <div class="cost big">${costHtml(b.nextCost, live)}</div>
        <button class="btn ${afford ? "primary" : ""} bp-build" ${afford ? "" : "disabled"} onclick="actionBuild('${key}')">
          ${afford ? `🔨 Ausbauen · ⏱ ${fmtDur(b.nextTime)}` : "Nicht genug Rohstoffe"}
        </button>
      </div>`;
  }

  // Abreißen: eine Stufe zurück, Hälfte der ausgegebenen Rohstoffe zurück
  let demo = "";
  if (b.demoRefund) {
    demo = `
      <div class="bp-demo">
        <div class="bp-next-head"><span>Abreißen auf Stufe ${b.level - 1}</span><span class="muted">+50 % zurück</span></div>
        <div class="cost">${costHtml(b.demoRefund)}</div>
        <button class="btn danger bp-demolish" onclick="actionDemolish('${key}')">🧨 Abreißen</button>
      </div>`;
  }

  // Wirkung: aktueller Wert und (falls ausbaubar) der Wert der nächsten Stufe
  let effect = "";
  if (b.effectNow || b.effectNext) {
    const nowVal = b.level > 0 && b.effectNow ? esc(b.effectNow) : "—";
    const nextVal =
      b.effectNext && !maxed
        ? ` <span class="bp-effect-arrow">→</span> <b class="gold">${esc(b.effectNext)}</b>`
        : "";
    effect = `
      <div class="bp-effect">
        <span class="bp-effect-label">${EFFECT_LABELS[key] || "Wirkung"}</span>
        <span class="bp-effect-val">${nowVal}${nextVal}</span>
      </div>`;
  }

  return `
    <div class="bp-head">
      <span class="bp-icon">${BUILDING_ICONS[key] || "🏛️"}</span>
      <div>
        <b>${esc(def.name)}</b>
        <div class="bp-level">Stufe ${b.level}${b.level ? "" : " · noch nicht gebaut"}</div>
      </div>
    </div>
    <p class="bp-desc">${def.desc}</p>
    ${effect}${action}${demo}`;
}

renderers.dorf = () => {
  const v = state.village;
  if (!meta.BUILDINGS[selectedBuilding]) selectedBuilding = "rathaus";

  $("#tab-dorf").innerHTML = `
    <div class="village-head">
      <h2>${esc(v.name)} <small class="muted">(${v.x}|${v.y}) · ${fmtNum(v.points)} Punkte</small></h2>
    </div>
    <div class="village-layout">
      <div class="village-scene-wrap">${renderVillageScene(state, meta, selectedBuilding)}</div>
      <aside class="village-side">
        <div class="card building-panel" id="buildingPanel">${buildingPanelHtml()}</div>
        <div class="card"><h3 class="card-title">🏗️ Bauschleife</h3><div id="buildQueue">${queueHtml()}</div></div>
        <div class="card"><h3 class="card-title">🛡️ Militär im Dorf</h3><div id="villageGarrison">${garrisonHtml()}</div></div>
        <div class="card"><h3 class="card-title">🚩 Truppenbewegungen</h3><div id="villageMoves">${movementsHtml()}</div></div>
      </aside>
    </div>`;
  enableZoomPan($(".village-scene-wrap"), "village");
  lastSceneSig = sceneSignature();
};

// Baut das HTML der im Dorf stationierten Truppen — kompakte Übersicht in der Dorf-Seitenleiste
function garrisonHtml() {
  const v = state.village;
  const rows = Object.entries(meta.UNITS)
    .filter(([key]) => (v.units[key]?.count || 0) > 0)
    .map(([key, def]) => {
      const cnt = v.units[key].count;
      return `<div class="garrison-item" title="${esc(def.name)}">
        <span class="garrison-portrait">${UNIT_ICONS[key] || ""}</span>
        <span class="garrison-name">${esc(def.name)}</span>
        <span class="garrison-count">${fmtNum(cnt)}</span>
      </div>`;
    })
    .join("");
  if (!rows) return '<p class="muted">Keine Truppen im Dorf.</p>';
  const total = Object.values(v.units).reduce((s, u) => s + (u.count || 0), 0);
  return `<div class="garrison-grid">${rows}</div>
    <div class="garrison-total">Gesamt: <b>${fmtNum(total)}</b> Einheiten · Versorgung ${fmtNum(v.pop)}/${fmtNum(v.popCap)}</div>`;
}

// Baut das HTML der Truppenbewegungen (ein- und ausgehend) — wird im Dorf- und Militär-Tab genutzt
function movementsHtml() {
  // Bewegungen werden nach Richtung gruppiert: "Auf dem Weg" (Hinweg) und "Kehren heim" (Rückweg).
  // Jedes Element behält seine Ankunftszeit (at) für die spätere Sortierung.
  const outgoing = []; // Auf dem Weg
  const returning = []; // Kehren heim

  // Eingehende Angriffe sind immer auf dem Weg zu uns.
  for (const m of state.movements.incoming) {
    outgoing.push({
      at: m.at,
      html: `<div class="queue-item"><span class="red">⚠️ Angriff von ${esc(m.fromOwner)} (${esc(m.fromVillage)}, ${m.x}|${m.y})</span>${countdown(m.at)}</div>`,
    });
  }

  for (const m of state.movements.outgoing) {
    // Sammelmissionen der Bewohner (kein Truppen-, sondern Arbeiter-Einsatz)
    if (m.type === "gather" || m.type === "gatherReturn") {
      const resName = RES_NAMES[m.res] || m.res;
      const what =
        m.type === "gather"
          ? `👷 Sammeln: ${m.workers}× Bewohner → ${esc(m.target)} (${m.x}|${m.y})`
          : `↩️ Bewohner kehren heim${m.yield ? ` · +${fmtNum(m.yield)} ${resName}` : ""}`;
      // Immer die Ankunft im Dorf anzeigen (auch während des Sammelns), damit
      // nur eine durchgehende Zeit bis zur Heimkehr zu sehen ist.
      const homeAt = m.homeAt || m.at;
      // Laufende Hinweg-/Sammelmissionen lassen sich zurückholen.
      const recall =
        m.type === "gather" && m.id
          ? ` <button class="btn small danger" onclick="recallGather('${m.id}')" title="Bewohner zurückholen">✖</button>`
          : "";
      const item = {
        at: homeAt,
        html: `<div class="queue-item"><span>${what}</span>${countdown(homeAt)}${recall}</div>`,
      };
      (m.type === "gatherReturn" ? returning : outgoing).push(item);
      continue;
    }
    // Rohstofftransport zwischen eigenen Dörfern (trägt Rohstoffe statt Truppen)
    if (m.type === "transport") {
      const load = costHtml(m.res || {});
      const what =
        m.dir === "in"
          ? `🛒 Rohstoffe von ${esc(m.target)} (${m.x}|${m.y})`
          : `🛒 Rohstoffe nach ${esc(m.target)} (${m.x}|${m.y})`;
      outgoing.push({
        at: m.at,
        html: `<div class="queue-item"><span>${what} — ${load}</span>${countdown(m.at)}</div>`,
      });
      continue;
    }
    const units = Object.entries(m.units)
      .map(([k, n]) => `${n}× ${meta.UNITS[k].name}`)
      .join(", ");
    const what =
      m.type === "attack"
        ? `⚔️ Angriff auf ${esc(m.target)} (${m.x}|${m.y})`
        : m.type === "scout"
          ? `🔍 Spähen von ${esc(m.target)} (${m.x}|${m.y})`
          : m.type === "explore"
            ? `🧭 Erkundung (${m.x}|${m.y})`
            : m.type === "reinforce"
              ? `🤝 Verstärkung nach ${esc(m.target)} (${m.x}|${m.y})`
              : `↩️ Rückkehr von ${esc(m.target)}`;
    const loot = m.loot ? ` · Beute: ${costHtml(m.loot)}` : "";
    const cancel =
      (m.type === "attack" || m.type === "scout") && m.id
        ? ` <button class="btn small danger" onclick="cancelMove('${m.id}')" title="Zurückbeordern">✖</button>`
        : "";
    const item = {
      at: m.at,
      html: `<div class="queue-item"><span>${what} — ${units}${loot}</span>${countdown(m.at)}${cancel}</div>`,
    };
    // "return" ist der Rückweg, alles andere (attack/scout/reinforce) ist der Hinweg.
    (m.type === "return" ? returning : outgoing).push(item);
  }

  // Nach Ankunftszeit absteigend sortieren (späteste Ankunft zuerst).
  const bySoonestDesc = (a, b) => b.at - a.at;
  const section = (title, items) =>
    items.length
      ? `<div class="muted" style="margin:8px 0 4px;font-weight:600">${title}</div>` +
        items
          .sort(bySoonestDesc)
          .map((i) => i.html)
          .join("")
      : "";
  const outHtml = section("🏃 Auf dem Weg", outgoing);
  const retHtml = section("🏠 Kehren heim", returning);

  // Eigene Truppen, die in fremden Dörfern stationiert sind (mit Rückruf).
  const stationed = (state.village.stationed || [])
    .map((s) => {
      const units = Object.entries(s.units)
        .map(([k, n]) => `${n}× ${meta.UNITS[k].name}`)
        .join(", ");
      return `<div class="queue-item"><span>🤝 Verstärkt ${esc(s.target)} (${s.x}|${s.y}, ${esc(s.owner)}) — ${units}</span>
        <button class="btn small" onclick="recallReinforce('${s.targetId}','${s.fromId}')" title="Zurückbeordern">↩️ Rückruf</button></div>`;
    })
    .join("");

  // Fremde Verstärkung, die aktuell in diesem Dorf steht.
  const present = (state.village.reinforcements || [])
    .map((r) => {
      const units = Object.entries(r.units)
        .map(([k, n]) => `${n}× ${meta.UNITS[k].name}`)
        .join(", ");
      return `<div class="queue-item"><span>🛡️ Verstärkung von ${esc(r.owner)} (${esc(r.fromVillage)}) — ${units}</span></div>`;
    })
    .join("");

  return (
    outHtml + retHtml + stationed + present ||
    '<p class="muted">Keine Bewegungen.</p>'
  );
}

// Baut nur die Bauschleife (rechte Spalte)
function queueHtml() {
  const v = state.village;
  return v.queue.length
    ? v.queue
        .map(
          (q) =>
            `<div class="queue-item"><span>${meta.BUILDINGS[q.b].name} → Stufe ${q.toLevel} <small class="muted">/ max ${meta.BUILDINGS[q.b].max}</small></span>${countdown(q.done)}</div>`,
        )
        .join("")
    : '<p class="muted">Keine laufenden Bauaufträge.</p>';
}

// Signatur der szenenrelevanten Daten (Stufen + Bauschleife + Auswahl).
// Ändert sie sich nicht, bleibt die SVG erhalten → Animationen laufen weiter.
function sceneSignature() {
  const v = state.village;
  const levels = Object.entries(v.buildings)
    .map(([k, b]) => `${k}${b.level}`)
    .join("");
  const queue = v.queue.map((q) => `${q.b}${q.toLevel}`).join("");
  return `${selectedBuilding}|${levels}|${queue}`;
}
let lastSceneSig = "";

// Günstiges Update während der Polls: Szene nur bei echter Änderung neu zeichnen,
// sonst nur Panel (Rohstoff-Verfügbarkeit) und Bauschleife aktualisieren.
function refreshDorfCheap() {
  if (!$("#bldGrid") || sceneSignature() !== lastSceneSig) {
    renderers.dorf();
    return;
  }
  const panel = $("#buildingPanel");
  if (panel) panel.innerHTML = buildingPanelHtml();
  const queue = $("#buildQueue");
  if (queue) queue.innerHTML = queueHtml();
  const garrison = $("#villageGarrison");
  if (garrison) garrison.innerHTML = garrisonHtml();
  const moves = $("#villageMoves");
  if (moves) moves.innerHTML = movementsHtml();
}

// Wird aus der SVG-Szene (village.js) per onclick aufgerufen
window.selectBuilding = (key) => {
  if (!meta.BUILDINGS[key]) return;
  selectedBuilding = key;
  renderers.dorf();
};

window.actionBuild = async (key) => {
  try {
    applyState(await api("/api/build", { building: key }));
    renderers.dorf();
    toast(`${meta.BUILDINGS[key].name} wird ausgebaut.`);
  } catch (e) {
    toast(e.message, true);
  }
};

window.actionDemolish = async (key) => {
  const b = state.village.buildings[key];
  if (
    !confirm(
      `${meta.BUILDINGS[key].name} von Stufe ${b.level} auf ${b.level - 1} abreißen? Du bekommst die Hälfte der ausgegebenen Rohstoffe zurück.`,
    )
  )
    return;
  try {
    applyState(await api("/api/demolish", { building: key }));
    renderers.dorf();
    toast(`${meta.BUILDINGS[key].name} wurde abgerissen.`);
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Militär ----------------

// Gemerkte Ausbildungs-Mengen je Einheit, damit sie ein Poll-Neuzeichnen überleben
const trainCounts = {};
// Vorauswahl-Schaltflächen für die Ausbildungsmenge
const TRAIN_PRESETS = [1, 10, 25, 50, 100];
window.setTrainCount = (key, val) => {
  trainCounts[key] = val;
  const el = document.getElementById("train-sum-" + key);
  if (el) el.innerHTML = trainSummaryHtml(key, val);
};
// Klick auf einen Vorauswahl-Button: setzt das Eingabefeld und aktualisiert die Zusammenfassung
window.pickTrainCount = (key, n) => {
  const input = document.getElementById("train-" + key);
  if (input) input.value = n;
  window.setTrainCount(key, n);
};

// Kosten, ‑Zeit und ‑Versorgung für die gewählte Anzahl — aktualisiert sich live in der Kosten-Spalte.
// Ohne Auswahl werden die Werte pro Einheit angezeigt.
function trainSummaryHtml(key, val) {
  const def = meta.UNITS[key];
  const u = state.village.units[key];
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n) || n < 1) {
    return `<span class="cost">${costHtml(def.cost, state.village.res)}</span>
      <br><small class="muted">⏱ ${fmtDur(u.time)}/Einheit · Versorgung ${def.up}</small>`;
  }
  const clamped = Math.min(500, n);
  const cost = {};
  for (const r of Object.keys(def.cost)) cost[r] = def.cost[r] * clamped;
  const supply = def.up * clamped;
  const free = state.village.popCap - state.village.pop;
  const supplyClass = supply > free ? "no" : "";
  return `<span class="cost">${costHtml(cost, state.village.res)}</span>
    <br><small class="muted">⏱ ${fmtDur(u.time * clamped)} · <span class="${supplyClass}">Versorgung ${supply}</span> (frei ${Math.max(0, free)})</small>`;
}

renderers.militaer = () => {
  const v = state.village;
  const unitRows = Object.entries(meta.UNITS)
    .map(([key, def]) => {
      const u = v.units[key];
      // Ausgegraute Vorschau für Einheiten, die erst mit höherer Kaserne freigeschaltet werden
      if (u.locked) {
        return `
      <tr class="unit-locked">
        <td class="unit-cell"><span class="unit-portrait">${UNIT_ICONS[key] || ""}</span></td>
        <td><b>${def.name}</b><br><small class="muted">Off ${def.off} · Def ${def.def} · Tempo ${def.speed} · trägt ${def.carry}</small></td>
        <td class="num" data-label="Im Dorf">${fmtNum(u.count)}</td>
        <td data-label="Kosten"><span class="cost">${costHtml(def.cost)}</span><br><small class="muted">Versorgung ${def.up}</small></td>
        <td data-label="Ausbilden"><div class="unit-lockmsg">🔒 ${esc(u.reqText || "gesperrt")}</div></td>
      </tr>`;
      }
      const cnt = trainCounts[key] ?? "";
      const presetBtns = TRAIN_PRESETS.map(
        (n) =>
          `<button type="button" class="btn small" onclick="pickTrainCount('${key}', ${n})">${n}</button>`,
      ).join("");
      return `
      <tr>
        <td class="unit-cell"><span class="unit-portrait">${UNIT_ICONS[key] || ""}</span></td>
        <td><b>${def.name}</b><br><small class="muted">Off ${def.off} · Def ${def.def} · Tempo ${def.speed} · trägt ${def.carry}</small></td>
        <td class="num" data-label="Im Dorf">${fmtNum(u.count)}</td>
        <td data-label="Kosten"><div class="train-sum" id="train-sum-${key}">${trainSummaryHtml(key, cnt)}</div></td>
        <td data-label="Ausbilden">
          <div class="train-presets">${presetBtns}</div>
          <div class="train-input">
            <input type="number" min="1" max="500" value="${cnt}" placeholder="Anzahl" id="train-${key}" style="width:80px" oninput="setTrainCount('${key}', this.value)">
            <button class="btn small primary" onclick="actionTrain('${key}')">Ausbilden</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  const tq = v.trainQueue.length
    ? v.trainQueue
        .map(
          (q) =>
            `<div class="queue-item"><span>${q.count}× ${meta.UNITS[q.unit].name}</span>${countdown(q.done)}</div>`,
        )
        .join("")
    : '<p class="muted">Keine laufende Ausbildung.</p>';

  $("#tab-militaer").innerHTML = `
    <h2>Militär</h2>
    ${v.buildings.kaserne.level < 1 ? '<div class="card"><p class="muted">⚠️ Baue zuerst eine <b>Kaserne</b>, um Truppen auszubilden.</p></div>' : ""}
    <div class="grid2">
      <div class="card"><h3 style="margin-top:0">Truppenbewegungen</h3>${movementsHtml()}</div>
      <div class="card"><h3 style="margin-top:0">Ausbildung</h3>${tq}</div>
    </div>
    <div class="card">
      <table class="unit-table">
        <thead><tr><th></th><th>Einheit</th><th class="num">Im Dorf</th><th>Kosten</th><th>Ausbilden</th></tr></thead>
        <tbody>${unitRows}</tbody>
      </table>
      <p class="muted" style="margin-top:8px">Zum Angreifen: Karte öffnen und ein feindliches Dorf anklicken.</p>
    </div>`;
};

window.actionTrain = async (key) => {
  const count = Math.floor(Number($("#train-" + key).value));
  if (!Number.isFinite(count) || count < 1) {
    toast("Bitte eine Anzahl wählen.", true);
    return;
  }
  try {
    applyState(await api("/api/train", { unit: key, count }));
    renderers.militaer();
    toast(`${count}× ${meta.UNITS[key].name} in Ausbildung.`);
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Karte ----------------

renderers.karte = async () => {
  const el = $("#tab-karte");
  // Beim Verschieben/Springen die vorhandene Karte stehen lassen, bis die neuen
  // Daten da sind — sonst blitzt zwischen "Lade …" und Neuzeichnung Schwarz auf.
  if (!el.querySelector(".world-map")) {
    el.innerHTML = '<h2>Weltkarte</h2><p class="muted">Lade …</p>';
  }
  let data;
  try {
    data = await api(`/api/map?x=${mapCenter.x}&y=${mapCenter.y}`);
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
    return;
  }

  const R = 6;
  // Erkundete Felder (Nebel des Krieges): Server liefert sichtbare "x,y"-Schlüssel.
  const explored = Array.isArray(data.explored) ? new Set(data.explored) : null;
  const mapSvg = renderWorldMap(
    data.villages || [],
    data.nodes || [],
    mapCenter,
    R,
    state,
    selectedTile,
    selectedNode,
    explored,
    selectedExplore,
  );

  const res = state.village.residents || { idle: 0, total: 0 };
  el.innerHTML = `
    <h2>Weltkarte <small class="muted">Zentrum (${mapCenter.x}|${mapCenter.y}) · 👷 ${res.idle}/${res.total} Bewohner frei</small></h2>
    <div class="map-controls">
      <button class="btn small" onclick="moveMap(-5,0)">←</button>
      <button class="btn small" onclick="moveMap(5,0)">→</button>
      <button class="btn small" onclick="moveMap(0,-5)">↑</button>
      <button class="btn small" onclick="moveMap(0,5)">↓</button>
      <input id="gotoX" type="number" min="0" max="${meta.WORLD_SIZE - 1}" value="${mapCenter.x}">
      <input id="gotoY" type="number" min="0" max="${meta.WORLD_SIZE - 1}" value="${mapCenter.y}">
      <button class="btn small" onclick="gotoCoords()">Springen</button>
      <button class="btn small" onclick="centerHome()">🏰 Mein Dorf</button>
    </div>
    <div class="map-legend">
      <span><i class="lg-castle">🏰</i> Dein Dorf</span>
      <span><i class="lg-ally"></i> Allianz</span>
      <span><i class="lg-shield">🛡️</i> Anfängerschutz</span>
      <span><i>👑</i> Adelung läuft</span>
      <span><i class="lg-town"></i> Andere</span>
      <span><i class="lg-node-holz"></i> Wald</span>
      <span><i class="lg-node-stein"></i> Steinbruch</span>
      <span><i class="lg-node-eisen"></i> Eisenader</span>
      <span><i class="lg-move-atk"></i> Angriff</span>
      <span><i class="lg-move-scout"></i> Spähen</span>
      <span><i class="lg-move-return"></i> Rückkehr</span>
      <span><i class="lg-fog"></i> Nebel — anklicken & mit Spähern erkunden</span>
    </div>
    <div class="world-map">${mapSvg}</div>
    <div id="villageDetail" class="village-detail"></div>`;
  // panLimit = PAD(5) * CELL(58): so weit reicht der um das Fenster gerenderte
  // Puffer, so weit darf die Karten-Inhaltsebene beim Ziehen verschoben werden.
  enableZoomPan(
    $(".world-map"),
    "map",
    (dx, dy) => moveMap(dx, dy),
    58,
    5 * 58,
  );

  // Aus der Rangliste angesprungenes Dorf jetzt automatisch auswählen.
  if (pendingMapSelect) {
    const target = (data.villages || []).find(
      (v) => v.x === pendingMapSelect.x && v.y === pendingMapSelect.y,
    );
    pendingMapSelect = null;
    if (target) {
      selectedTile = target;
      selectedNode = null;
      selectedExplore = null;
    }
  }

  if (selectedNode) renderNodeDetail();
  else if (selectedTile) renderVillageDetail();
  else if (selectedExplore) renderExploreDetail();
};

// Aus der Rangliste heraus auf die Karte springen und das Dorf markieren.
window.showOnMap = (x, y) => {
  mapCenter = { x, y };
  selectedTile = null;
  selectedNode = null;
  selectedExplore = null;
  pendingMapSelect = { x, y };
  switchTab("karte");
};

window.moveMap = (dx, dy) => {
  mapCenter.x = Math.max(0, Math.min(meta.WORLD_SIZE - 1, mapCenter.x + dx));
  mapCenter.y = Math.max(0, Math.min(meta.WORLD_SIZE - 1, mapCenter.y + dy));
  renderers.karte();
};
window.gotoCoords = () => {
  mapCenter = {
    x: Number($("#gotoX").value) || 0,
    y: Number($("#gotoY").value) || 0,
  };
  renderers.karte();
};
window.centerHome = () => {
  mapCenter = { x: state.village.x, y: state.village.y };
  renderers.karte();
};
window.selectTile = (t) => {
  selectedTile = t;
  selectedNode = null;
  selectedExplore = null;
  renderVillageDetail();
};

window.selectNode = (n) => {
  selectedNode = n;
  selectedTile = null;
  selectedExplore = null;
  renderNodeDetail();
};

// Nebelfeld angeklickt: Späher zur Erkundung dorthin schicken.
window.exploreTile = (x, y) => {
  selectedExplore = { x, y };
  selectedTile = null;
  selectedNode = null;
  // Karte neu zeichnen, damit das angeklickte Feld sofort hervorgehoben wird
  // (die alte Karte bleibt dank Zwischenspeicher bis zum Nachladen stehen).
  renderers.karte();
};

// ---- Erfolgsprognose (Angriff / Spähen) auf Basis eigener Spähberichte ----

// Spähberichte in den Koordinaten-Cache übernehmen (jeweils der neueste je Ziel).
function indexScoutIntel(reports) {
  scoutIntelFetchedAt = serverNow();
  for (const r of reports || []) {
    if (r.kind !== "Spionage" || !r.success || !r.intel) continue;
    if (r.attacker?.name !== state.user.name) continue; // nur eigene Aufklärung
    const d = r.defender || {};
    if (typeof d.x !== "number" || typeof d.y !== "number") continue;
    const key = `${d.x},${d.y}`;
    const prev = scoutIntel[key];
    if (!prev || r.time > prev.time) {
      scoutIntel[key] = {
        time: r.time,
        wall: r.intel.wall || 0,
        units: r.intel.units || {},
        spaeher: r.intel.units?.spaeher || 0,
      };
    }
  }
}

// Berichte bei Bedarf im Hintergrund laden, damit die Prognose auch ohne
// Öffnen des Berichte-Tabs verfügbar ist. Läuft höchstens alle 20 s.
async function ensureScoutIntel() {
  if (serverNow() - scoutIntelFetchedAt < 20_000) return;
  scoutIntelFetchedAt = serverNow();
  try {
    const reports = await api("/api/reports");
    indexScoutIntel(reports);
    if (selectedTile) {
      window.updateTravelPreview?.();
      window.updateScoutPreview?.();
    }
  } catch {
    /* Prognose ist optional – Fehler still ignorieren */
  }
}

// Effektive Verteidigung aus Spähdaten schätzen (Grundwert 20 + Einheiten-Def,
// Mauer +6 %/Stufe) — spiegelt die Formel aus resolveAttack.
function estimateDefense(intel) {
  if (!intel) return null;
  let def = 20;
  for (const [k, n] of Object.entries(intel.units || {}))
    def += (meta.UNITS[k]?.def || 0) * n;
  return def * (1 + 0.06 * (intel.wall || 0));
}

// Erfolgs-Prozentwert aus einem Kräfteverhältnis (weiche Kurve um ratio = 1).
function oddsPct(ratio, exp = 1.5) {
  if (!(ratio > 0)) return 0;
  const r = Math.pow(ratio, exp);
  return Math.max(1, Math.min(99, Math.round((r / (r + 1)) * 100)));
}

// Farbklasse je nach Erfolgschance (rot < 40 % < gelb < 70 % < grün).
function chanceClass(pct) {
  return pct >= 70 ? "green" : pct >= 40 ? "gold" : "red";
}

function renderVillageDetail() {
  const t = selectedTile;
  const el = $("#villageDetail");
  if (!el || !t) return;
  const own = t.owner === state.user.name;
  const isActive = t.x === state.village.x && t.y === state.village.y;
  const ally = !own && !!t.alliance && t.alliance === state.user.allianceTag;
  const canReinforce = (own && !isActive) || ally;
  const dist = Math.hypot(state.village.x - t.x, state.village.y - t.y);

  let attackForm = "";
  if (own) {
    attackForm = isActive
      ? '<p class="muted">Das ist dein aktives Dorf.</p>'
      : '<p class="muted">Das ist eines deiner Dörfer. Du kannst es verstärken.</p>';
  } else if (t.protected) {
    attackForm =
      '<p class="muted">🛡️ Dieser Spieler steht unter Anfängerschutz und kann nicht angegriffen werden.</p>';
  } else {
    const inputs = Object.entries(meta.UNITS)
      .filter(([, def]) => !def.scout)
      .map(([k, def]) => {
        const max = state.village.units[k].count;
        const empty = max <= 0 ? " is-empty" : "";
        return `
      <label class="atk-unit${empty}" for="atk-${k}" title="${def.name}">
        <span class="atk-portrait">${UNIT_ICONS[k] || ""}</span>
        <span class="atk-info">
          <b>${def.name}</b>
          <small class="atk-stats">⚔️${def.off} · 🛡️${def.def} · 🐎${def.speed} · 🎒${def.carry}</small>
          <small class="atk-avail">verfügbar: <b>${fmtNum(max)}</b></small>
        </span>
        <span class="atk-controls">
          <input type="number" min="0" max="${max}" value="0" id="atk-${k}" ${max ? "" : "disabled"} oninput="updateTravelPreview()">
          <button type="button" class="btn small" onclick="setAtkMax('${k}', ${max})" ${max ? "" : "disabled"}>Max</button>
        </span>
      </label>`;
      })
      .join("");
    const scoutMax = state.village.units.spaeher?.count || 0;
    const scoutForm = `
      <div class="scout-box">
        <h4>🔍 Spähen</h4>
        <p class="muted small">Schicke Späher, um Rohstoffe und Truppen des Ziels auszukundschaften. Späher kämpfen nicht.</p>
        <div class="scout-row">
          <label>Späher (max. ${scoutMax})
            <input type="number" min="0" max="${scoutMax}" value="0" id="scout-count" oninput="updateScoutPreview()">
          </label>
          <button class="btn" ${scoutMax ? "" : "disabled"} onclick="actionScout()">🔍 Späher losschicken</button>
        </div>
        <div class="chance-line"><span class="muted">Erfolgschance</span> <b id="scoutChance">—</b></div>
        ${scoutMax ? "" : '<p class="muted small">Du hast keine Späher. Bilde sie in der Kaserne aus.</p>'}
      </div>`;
    attackForm = `
      <h4 class="picker-title">⚔️ Truppen auswählen</h4>
      <div class="unit-picker">${inputs}</div>
      <div class="attack-preview">
        <div><span class="muted">Entfernung</span><b>${dist.toFixed(1)} Felder</b></div>
        <div><span class="muted">Reisezeit</span><b id="travelPreview" class="gold">—</b></div>
        <div><span class="muted">Angriffskraft</span><b id="atkPowerPreview" class="red">0</b></div>
        <div><span class="muted">Max. Beute</span><b id="lootPreview" class="green">0</b></div>
        <div><span class="muted">Erfolgschance</span><b id="winChancePreview">—</b></div>
      </div>
      <p class="muted small" id="winChanceHint">🔍 Erfolgschance unbekannt — spähe das Dorf zuerst aus.</p>
      <p class="muted small">Beute = Tragekapazität deiner Truppen. Wie viele Rohstoffe wirklich im Ziel liegen, siehst du erst im Kampfbericht — oder vorab per Spähen.</p>
      <button class="btn primary" onclick="actionAttack()">⚔️ Angriff starten</button>
      <p class="muted small">👑 <b>Adelung:</b> Schicke einen <b>Paladin</b> mit. Übersteht er einen gewonnenen Angriff, sinkt die Treue des Dorfes. Nach ${meta.CONQUEST_ATTACKS || 3} solcher Angriffe gehört das Dorf dir.</p>
      ${scoutForm}`;
  }

  // Adelungs-Fortschritt (nur sichtbar, wenn du selbst schon einen Paladin geschickt hast)
  let conquestBanner = "";
  if (t.conquest) {
    const { progress, needed } = t.conquest;
    conquestBanner = `<div class="conquest-bar" title="Adelungs-Fortschritt">👑 Treue gebrochen: <b>${progress}/${needed}</b> — noch ${Math.max(0, needed - progress)} Paladin-Angriff(e) bis zur Eroberung.</div>`;
  }

  // Verstärkungs-Formular für eigene weitere Dörfer und Allianzmitglieder.
  let reinforceForm = "";
  if (canReinforce) {
    const rows = Object.entries(meta.UNITS)
      .filter(([, def]) => !def.scout)
      .map(([k, def]) => {
        const max = state.village.units[k]?.count || 0;
        const empty = max <= 0 ? " is-empty" : "";
        return `
          <label class="guard-unit${empty}" title="${esc(def.name)}">
            <span>${UNIT_ICONS[k] || ""} ${esc(def.name)} <small class="muted">🛡️${def.def}</small></span>
            <input type="number" min="0" max="${max}" value="0" id="reinf-${k}">
          </label>`;
      })
      .join("");
    reinforceForm = `
      <div class="reinforce-box">
        <h4>🤝 Verstärkung entsenden</h4>
        <p class="muted small">Schicke Truppen nach ${esc(t.village)} (${dist.toFixed(1)} Felder). Sie verteidigen das Dorf mit und lassen sich jederzeit zurückbeordern. Späher können nicht verstärken.</p>
        <div class="guard-grid">${rows}</div>
        <button class="btn primary" onclick="actionReinforce()">🤝 Verstärkung schicken</button>
      </div>`;
  }

  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t.village)} <small class="muted">(${t.x}|${t.y})</small></h3>
      <p>Besitzer: <b class="gold">${esc(t.owner)}</b>${t.alliance ? ` · Allianz: [${esc(t.alliance)}]` : ""} · ${fmtNum(t.points)} Punkte</p>
      ${conquestBanner}
      ${attackForm}
      ${reinforceForm}
    </div>`;
  window.updateTravelPreview();
  window.updateScoutPreview();
  if (!own && !t.protected) ensureScoutIntel();
}

window.setAtkMax = (k, max) => {
  const el = $("#atk-" + k);
  if (el) {
    el.value = max;
    window.updateTravelPreview();
  }
};

window.updateTravelPreview = () => {
  const el = $("#travelPreview");
  if (!el || !selectedTile) return;
  let slowest = Infinity;
  let power = 0;
  let capacity = 0;
  for (const k of Object.keys(meta.UNITS)) {
    const n = Number($("#atk-" + k)?.value || 0);
    if (n > 0) {
      const u = meta.UNITS[k];
      slowest = Math.min(slowest, u.speed);
      power += u.off * n;
      capacity += u.carry * n;
    }
  }
  const powerEl = $("#atkPowerPreview");
  const lootEl = $("#lootPreview");
  if (powerEl) powerEl.textContent = fmtNum(power);
  if (lootEl) lootEl.textContent = fmtNum(capacity) + " 🪵🪨⛓️";

  // Erfolgschance aus den zuletzt erspähten Verteidigungsdaten schätzen.
  const chanceEl = $("#winChancePreview");
  const hintEl = $("#winChanceHint");
  if (chanceEl) {
    const intel = scoutIntel[`${selectedTile.x},${selectedTile.y}`];
    const def = estimateDefense(intel);
    if (def == null) {
      chanceEl.textContent = "—";
      chanceEl.className = "muted";
      if (hintEl) {
        hintEl.textContent =
          "🔍 Erfolgschance unbekannt — spähe das Dorf zuerst aus.";
        hintEl.classList.remove("hidden");
      }
    } else if (power <= 0) {
      chanceEl.textContent = "—";
      chanceEl.className = "muted";
      if (hintEl) hintEl.classList.add("hidden");
    } else {
      const pct = oddsPct(power / def);
      chanceEl.textContent = pct + " %";
      chanceEl.className = chanceClass(pct);
      if (hintEl) {
        const age = fmtDur(Math.max(0, serverNow() - intel.time));
        hintEl.textContent = `Schätzung auf Basis deiner Spähdaten (vor ${age}). Ohne aktuelle Aufklärung kann sich die Verteidigung geändert haben.`;
        hintEl.classList.remove("hidden");
      }
    }
  }

  if (!Number.isFinite(slowest)) {
    el.textContent = "—";
    return;
  }
  const dist = Math.hypot(
    state.village.x - selectedTile.x,
    state.village.y - selectedTile.y,
  );
  el.textContent = fmtDur((dist / (slowest * meta.SPEED)) * 3_600_000);
};

// Erfolgschance des Spähzugs: Verteidiger-Späher haben 1,5× Vorteil.
window.updateScoutPreview = () => {
  const el = $("#scoutChance");
  if (!el || !selectedTile) return;
  const sent = Math.max(0, Number($("#scout-count")?.value || 0));
  if (sent <= 0) {
    el.textContent = "—";
    el.className = "";
    return;
  }
  const intel = scoutIntel[`${selectedTile.x},${selectedTile.y}`];
  if (!intel) {
    el.textContent = "🔍 unbekannt — erst spähen";
    el.className = "muted small";
    return;
  }
  const defScouts = intel.spaeher || 0;
  const pct = defScouts <= 0 ? 99 : oddsPct(sent / (defScouts * 1.5), 1.2);
  el.textContent = pct + " %";
  el.className = chanceClass(pct);
};

window.actionAttack = async () => {
  const units = {};
  for (const k of Object.keys(meta.UNITS))
    units[k] = Number($("#atk-" + k)?.value || 0);
  try {
    const r = await api("/api/attack", {
      x: selectedTile.x,
      y: selectedTile.y,
      units,
    });
    toast(`Angriff läuft! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderVillageDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

window.actionScout = async () => {
  const count = Number($("#scout-count")?.value || 0);
  try {
    const r = await api("/api/scout", {
      x: selectedTile.x,
      y: selectedTile.y,
      count,
    });
    toast(`Späher unterwegs! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderVillageDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

window.actionReinforce = async () => {
  const units = {};
  for (const k of Object.keys(meta.UNITS)) {
    const n = Math.floor(Number($("#reinf-" + k)?.value || 0));
    if (n > 0) units[k] = n;
  }
  if (!Object.keys(units).length) {
    toast("Wähle mindestens eine Einheit.", true);
    return;
  }
  try {
    const r = await api("/api/reinforce", {
      x: selectedTile.x,
      y: selectedTile.y,
      units,
    });
    toast(`Verstärkung unterwegs! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderVillageDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

window.recallReinforce = async (targetId, fromId) => {
  try {
    const r = await api("/api/reinforce/recall", { targetId, fromId });
    toast(`Truppen kehren zurück! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
  } catch (e) {
    toast(e.message, true);
  }
};

// Laufenden Angriff/Spähzug abbrechen — Truppen kehren um und marschieren zurück
window.cancelMove = async (id) => {
  if (!confirm("Diese Bewegung abbrechen? Die Truppen kehren sofort um."))
    return;
  try {
    const r = await api("/api/attack/cancel", { id });
    toast(`Truppen kehren um! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderVillageDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

// Laufende Sammelmission abbrechen — Bewohner kehren ohne Rohstoffe zurück
window.recallGather = async (id) => {
  if (
    !confirm(
      "Sammelmission abbrechen? Die Bewohner kehren ohne Rohstoffe zurück.",
    )
  )
    return;
  try {
    const r = await api("/api/gather/recall", { id });
    toast(`Bewohner kehren zurück! Ankunft: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderVillageDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

// Detailkarte für ein Rohstoffvorkommen: Bewohner zum Sammeln losschicken.
const NODE_META = {
  holz: { icon: "🌲", label: "Wald", res: "Holz" },
  stein: { icon: "⛏️", label: "Steinbruch", res: "Stein" },
  eisen: { icon: "⚒️", label: "Eisenader", res: "Eisen" },
};

// Angeklicktes Nebelfeld: Späher zur Erkundung dorthin schicken.
function renderExploreDetail() {
  const p = selectedExplore;
  const el = $("#villageDetail");
  if (!el || !p) return;
  const dist = Math.hypot(state.village.x - p.x, state.village.y - p.y);
  const scoutMax = state.village.units.spaeher?.count || 0;
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">🧭 Unerkundetes Gebiet <small class="muted">(${p.x}|${p.y})</small></h3>
      <p class="muted small">Dieses Feld liegt im Nebel des Krieges. Schicke Späher hierher, um die Umgebung dauerhaft aufzudecken. Die Späher kehren anschließend heim.</p>
      <div class="scout-row">
        <label>Späher (max. ${scoutMax})
          <input type="number" min="1" max="${scoutMax}" value="${Math.min(scoutMax, 1) || 1}" id="explore-count">
        </label>
        <button class="btn primary" ${scoutMax ? "" : "disabled"} onclick="actionExplore()">🧭 Erkunden</button>
      </div>
      <div class="attack-preview">
        <div><span class="muted">Entfernung</span><b>${dist.toFixed(1)} Felder</b></div>
      </div>
      ${scoutMax ? "" : '<p class="muted small">Du hast keine Späher. Bilde sie in der Kaserne aus.</p>'}
    </div>`;
}

window.actionExplore = async () => {
  if (!selectedExplore) return;
  const count = Number($("#explore-count")?.value || 0);
  try {
    const r = await api("/api/explore", {
      x: selectedExplore.x,
      y: selectedExplore.y,
      count,
    });
    toast(`Späher erkunden das Gebiet! Ankunft: ${fmtTime(r.arrival)}`);
    selectedExplore = null;
    await refreshState();
    renderers.karte();
  } catch (e) {
    toast(e.message, true);
  }
};

function renderNodeDetail() {
  const n = selectedNode;
  const el = $("#villageDetail");
  if (!el || !n) return;
  const info = NODE_META[n.res] || {
    icon: "⛰️",
    label: "Vorkommen",
    res: n.res,
  };
  const dist = Math.hypot(state.village.x - n.x, state.village.y - n.y);
  const idle = state.village.residents ? state.village.residents.idle : 0;
  const ambushPct = Math.round((meta.GATHER?.ambushChance ?? 0.3) * 100);

  // Wachen-Auswahl: alle Kampfeinheiten (keine Späher), die im Dorf stehen.
  const guardInputs = Object.entries(meta.UNITS)
    .filter(([, def]) => !def.scout)
    .map(([k, def]) => {
      const max = state.village.units[k]?.count || 0;
      const empty = max <= 0 ? " is-empty" : "";
      return `
        <label class="guard-unit${empty}" title="${esc(def.name)}">
          <span>${UNIT_ICONS[k] || ""} ${esc(def.name)} <small class="muted">🛡️${def.def}</small></span>
          <input type="number" min="0" max="${max}" value="0" id="guard-${k}" ${max ? "" : "disabled"} oninput="updateGatherPreview()">
        </label>`;
    })
    .join("");

  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${info.icon} ${info.label} <small class="muted">(${n.x}|${n.y})</small></h3>
      <p>Ergiebigkeit: <b class="gold">${"★".repeat(n.richness)}${"☆".repeat(3 - n.richness)}</b> · liefert <b>${info.res}</b></p>
      <p class="muted small">Schicke freie Bewohner hierher. Sie reisen hin, sammeln und kehren mit Rohstoffen zurück.</p>
      <div class="gather-row">
        <label>Bewohner (frei: ${idle})
          <input type="number" min="1" max="${Math.max(1, idle)}" value="${Math.min(idle, 5) || 1}" id="gather-count" oninput="updateGatherPreview()">
        </label>
        <button class="btn primary" ${idle ? "" : "disabled"} onclick="actionGather()">👷 Bewohner losschicken</button>
      </div>
      <div class="guard-box">
        <h4 style="margin:.4rem 0">🛡️ Wachen mitschicken <small class="muted">(optional)</small></h4>
        <p class="muted small">Unterwegs droht mit ~${ambushPct}% ein Räuberüberfall. Ohne ausreichende Wachen sterben Bewohner (sie wachsen danach im Rathaus nach). Wachen kehren mit den Bewohnern heim.</p>
        <div class="guard-grid">${guardInputs}</div>
      </div>
      <div class="attack-preview">
        <div><span class="muted">Entfernung</span><b>${dist.toFixed(1)} Felder</b></div>
        <div><span class="muted">Dauer (hin+sammeln+zurück)</span><b id="gatherTime" class="gold">—</b></div>
        <div><span class="muted">Erwartete Beute</span><b id="gatherYield" class="green">0</b></div>
        <div><span class="muted">Wach-Verteidigung</span><b id="guardDef" class="blue">0</b></div>
        <div><span class="muted">Erfolgschance</span><b id="gatherChance">—</b></div>
      </div>
      <p class="muted small" id="gatherChanceHint"></p>
      ${idle ? "" : '<p class="muted small">Alle Bewohner sind unterwegs. Baue das Rathaus aus, um mehr Bewohner zu bekommen.</p>'}
    </div>`;
  window.updateGatherPreview();
}

window.updateGatherPreview = () => {
  if (!selectedNode) return;
  const g = meta.GATHER || {
    workerSpeedEff: 18,
    workMs: 300000,
    yieldPerWorker: 36,
  };
  const n = Math.max(0, Number($("#gather-count")?.value || 0));
  const dist = Math.hypot(
    state.village.x - selectedNode.x,
    state.village.y - selectedNode.y,
  );
  const travel = (dist / g.workerSpeedEff) * 3_600_000;
  const total = travel * 2 + g.workMs;
  const yieldAmt = Math.round(
    n * (selectedNode.richness || 1) * g.yieldPerWorker,
  );
  const tEl = $("#gatherTime");
  const yEl = $("#gatherYield");
  if (tEl) tEl.textContent = n >= 1 ? fmtDur(total) : "—";
  if (yEl) {
    const info = NODE_META[selectedNode.res];
    yEl.textContent = `${fmtNum(yieldAmt)} ${info ? info.res : selectedNode.res}`;
  }
  // Wach-Verteidigung aus den ausgewählten Truppen summieren.
  const gEl = $("#guardDef");
  let guardDef = 0;
  for (const k of Object.keys(meta.UNITS)) {
    const cnt = Number($("#guard-" + k)?.value || 0);
    if (cnt > 0) guardDef += (meta.UNITS[k].def || 0) * cnt;
  }
  if (gEl) gEl.textContent = fmtNum(guardDef);

  // Erfolgschance = Bewohner kehren unversehrt heim. Ein Überfall droht mit
  // ambushChance; reichen die Wachen gegen die Räuberstärke, wird er abgewehrt.
  const cEl = $("#gatherChance");
  const hintEl = $("#gatherChanceHint");
  if (cEl) {
    const ambush = g.ambushChance ?? 0.3;
    const base = g.banditBase ?? 6;
    const perRich = g.banditPerRich ?? 5;
    const bandit = Math.round(
      (base + perRich * (selectedNode.richness || 1)) *
        Math.sqrt(Math.max(1, n)),
    );
    const repelled = guardDef >= bandit;
    const pct = n < 1 ? 0 : repelled ? 100 : Math.round((1 - ambush) * 100);
    if (n < 1) {
      cEl.textContent = "—";
      cEl.className = "muted";
      if (hintEl) hintEl.textContent = "";
    } else {
      cEl.textContent = pct + " %";
      cEl.className = chanceClass(pct);
      if (hintEl) {
        hintEl.textContent = repelled
          ? `🛡️ Deine Wachen (${fmtNum(guardDef)}) wehren die Räuber (Stärke ~${fmtNum(bandit)}) ab — Bewohner sicher.`
          : `⚠️ Räuberstärke ~${fmtNum(bandit)} übersteigt deine Wachen (${fmtNum(guardDef)}). Bei einem Überfall (${Math.round(ambush * 100)} %) fallen Bewohner.`;
      }
    }
  }
};

window.actionGather = async () => {
  const workers = Math.floor(Number($("#gather-count")?.value || 0));
  if (!Number.isFinite(workers) || workers < 1) {
    toast("Bitte eine Anzahl Bewohner wählen.", true);
    return;
  }
  const guards = {};
  for (const k of Object.keys(meta.UNITS)) {
    const cnt = Math.floor(Number($("#guard-" + k)?.value || 0));
    if (cnt > 0) guards[k] = cnt;
  }
  try {
    const r = await api("/api/gather", {
      x: selectedNode.x,
      y: selectedNode.y,
      workers,
      guards,
    });
    toast(`Bewohner unterwegs! Rückkehr: ${fmtTime(r.arrival)}`);
    await refreshState();
    renderNodeDetail();
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Markt ----------------

renderers.markt = async () => {
  const el = $("#tab-markt");
  el.innerHTML = '<h2>Marktplatz</h2><p class="muted">Lade …</p>';
  let offers;
  try {
    offers = await api("/api/market");
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
    return;
  }
  renderMarket(offers);
};

function renderMarket(offers) {
  const el = $("#tab-markt");
  const resOpts = ["holz", "stein", "eisen"]
    .map((r) => `<option value="${r}">${RES_NAMES[r]}</option>`)
    .join("");
  const rows = offers.length
    ? offers
        .map((o) => {
          const mine = o.seller === state.user.name;
          return `
      <tr>
        <td>${esc(o.seller)}${mine ? ' <span class="gold">(du)</span>' : ""}</td>
        <td>${costHtml({ [o.give.res]: o.give.amount })}</td>
        <td>${costHtml({ [o.want.res]: o.want.amount })}</td>
        <td>${
          mine
            ? `<button class="btn small danger" onclick="marketAction('cancel','${o.id}')">Zurückziehen</button>`
            : `<button class="btn small primary" onclick="marketAction('accept','${o.id}')">Annehmen</button>`
        }</td>
      </tr>`;
        })
        .join("")
    : '<tr><td colspan="4" class="muted">Keine Angebote. Erstelle das erste!</td></tr>';

  el.innerHTML = `
    <h2>Marktplatz</h2>
    ${state.village.buildings.markt.level < 1 ? '<div class="card"><p class="muted">⚠️ Baue zuerst einen <b>Marktplatz</b>, um eigene Angebote zu erstellen. Annehmen geht immer.</p></div>' : ""}
    ${transportCardHtml()}
    <div class="card">
      <h3 style="margin-top:0">Sofort-Tausch</h3>
      <p class="muted">Tausch beim Basar — geht immer, aber zum Kurs <b>3:1</b> (du zahlst das Dreifache).</p>
      <div class="formrow">
        <label>Ich gebe <select id="exGiveRes">${resOpts}</select></label>
        <label>Ich möchte <select id="exWantRes">${resOpts}</select></label>
        <label>Menge <input id="exWantAmt" type="number" min="1" value="100" style="width:90px"></label>
        <button class="btn" onclick="marketAction('exchange')">Tauschen</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Neues Angebot</h3>
      <div class="formrow">
        <label>Ich biete <select id="giveRes">${resOpts}</select></label>
        <label>Menge <input id="giveAmt" type="number" min="1" value="100" style="width:90px"></label>
        <label>Ich möchte <select id="wantRes">${resOpts}</select></label>
        <label>Menge <input id="wantAmt" type="number" min="1" value="100" style="width:90px"></label>
        <button class="btn primary" onclick="marketAction('create')">Anbieten</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Anbieter</th><th>Bietet</th><th>Möchte</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  $("#wantRes").value = "stein";
  $("#exWantRes").value = "stein";
}

// Karte zum Verschicken von Rohstoffen an ein eigenes weiteres Dorf.
// Nur sichtbar, wenn der Spieler mehr als ein Dorf besitzt.
function transportCardHtml() {
  const others = (state.villages || []).filter((v) => !v.active);
  if (others.length < 1) return "";
  const opts = others
    .map(
      (v) => `<option value="${v.id}">${esc(v.name)} (${v.x}|${v.y})</option>`,
    )
    .join("");
  const canSend = state.village.buildings.markt.level >= 1;
  return `
    <div class="card">
      <h3 style="margin-top:0">Rohstoffe an eigenes Dorf schicken</h3>
      ${canSend ? '<p class="muted">Ein Handelskarren bringt die Rohstoffe zu einem deiner anderen Dörfer. Reisezeit hängt von der Entfernung ab.</p>' : '<p class="muted">⚠️ Baue zuerst einen <b>Marktplatz</b>, um Rohstoffe verschicken zu können.</p>'}
      <div class="formrow">
        <label>Zieldorf <select id="trTarget">${opts}</select></label>
        <label>${RES_NAMES.holz} <input id="trHolz" type="number" min="0" value="0" style="width:80px"></label>
        <label>${RES_NAMES.stein} <input id="trStein" type="number" min="0" value="0" style="width:80px"></label>
        <label>${RES_NAMES.eisen} <input id="trEisen" type="number" min="0" value="0" style="width:80px"></label>
        <button class="btn primary" onclick="transportRes()" ${canSend ? "" : "disabled"}>Senden</button>
      </div>
    </div>`;
}

window.transportRes = async () => {
  try {
    const r = await api("/api/transport", {
      targetId: $("#trTarget").value,
      res: {
        holz: Number($("#trHolz").value) || 0,
        stein: Number($("#trStein").value) || 0,
        eisen: Number($("#trEisen").value) || 0,
      },
    });
    const min = Math.max(0, Math.round((r.arrival - Date.now()) / 60000));
    toast(`Karren unterwegs — Ankunft in ~${min} Min.`);
    await refreshState();
    renderMarket(await api("/api/market"));
  } catch (e) {
    toast(e.message, true);
  }
};

window.marketAction = async (what, id) => {
  try {
    let offers;
    if (what === "create") {
      offers = await api("/api/market/create", {
        give: { res: $("#giveRes").value, amount: Number($("#giveAmt").value) },
        want: { res: $("#wantRes").value, amount: Number($("#wantAmt").value) },
      });
      toast("Angebot erstellt — Rohstoffe sind reserviert.");
    } else if (what === "exchange") {
      const r = await api("/api/market/exchange", {
        giveRes: $("#exGiveRes").value,
        wantRes: $("#exWantRes").value,
        wantAmount: Number($("#exWantAmt").value),
      });
      toast(
        `Getauscht: ${r.give.amount} ${RES_NAMES[r.give.res]} → ${r.want.amount} ${RES_NAMES[r.want.res]}.`,
      );
      offers = await api("/api/market");
    } else {
      offers = await api("/api/market/" + what, { id });
      toast(
        what === "accept" ? "Handel abgeschlossen!" : "Angebot zurückgezogen.",
      );
    }
    await refreshState();
    renderMarket(offers);
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Allianz ----------------

renderers.allianz = async () => {
  const el = $("#tab-allianz");
  el.innerHTML = '<h2>Allianz</h2><p class="muted">Lade …</p>';
  try {
    const info = await api("/api/alliance");
    if (info && info.tag) return renderOwnAlliance(info);
    const list = await api("/api/alliances");
    renderAllianceLobby(list);
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
  }
};

function renderOwnAlliance(a) {
  state.user.allianceTag = a.tag;
  const members = a.members
    .map(
      (m) => `
    <tr>
      <td>${m.online ? "🟢" : "⚫"} <b>${esc(m.name)}</b>${m.name === a.leader ? " 👑" : ""}</td>
      <td class="num">${fmtNum(m.points)}</td>
      <td>(${m.x}|${m.y})</td>
      <td>${
        state.user.name === a.leader && m.name !== a.leader
          ? `<button class="btn small danger" onclick="allianceAction('kick','${esc(m.name)}')">Entfernen</button>`
          : ""
      }</td>
    </tr>`,
    )
    .join("");

  $("#tab-allianz").innerHTML = `
    <h2>[${esc(a.tag)}] ${esc(a.name)}</h2>
    <div class="card">
      <p class="muted">Anführer: <b class="gold">${esc(a.leader)}</b> · ${a.members.length} Mitglieder · Allianzmitglieder können einander nicht angreifen.</p>
      <table style="margin-top:10px">
        <thead><tr><th>Mitglied</th><th class="num">Punkte</th><th>Dorf</th><th></th></tr></thead>
        <tbody>${members}</tbody>
      </table>
      <div style="margin-top:14px"><button class="btn danger" onclick="allianceAction('leave')">Allianz verlassen</button></div>
    </div>`;
}

function renderAllianceLobby(list) {
  const rows = list.length
    ? list
        .map(
          (a) => `
    <tr>
      <td><b>[${esc(a.tag)}]</b> ${esc(a.name)}</td>
      <td class="num">${a.memberCount}</td>
      <td class="num">${fmtNum(a.points)}</td>
      <td><button class="btn small primary" onclick="allianceAction('join','${a.id}')">Beitreten</button></td>
    </tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">Noch keine Allianzen — gründe die erste!</td></tr>';

  $("#tab-allianz").innerHTML = `
    <h2>Allianz</h2>
    <div class="card">
      <h3 style="margin-top:0">Allianz gründen</h3>
      <div class="formrow">
        <label>Kürzel (2–5) <input id="allyTag" maxlength="5" style="width:90px"></label>
        <label>Name <input id="allyName" maxlength="30"></label>
        <button class="btn primary" onclick="allianceAction('create')">Gründen</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Allianz</th><th class="num">Mitglieder</th><th class="num">Punkte</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

window.allianceAction = async (what, arg) => {
  try {
    if (what === "create")
      await api("/api/alliance/create", {
        tag: $("#allyTag").value,
        name: $("#allyName").value,
      });
    else if (what === "join") await api("/api/alliance/join", { id: arg });
    else if (what === "leave") {
      await api("/api/alliance/leave", {});
      state.user.allianceTag = null;
    } else if (what === "kick")
      await api("/api/alliance/kick", { member: arg });
    toast("Erledigt.");
    renderers.allianz();
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Chat ----------------
// Globaler Welt-Chat. Wird beim ersten Öffnen einmal aufgebaut, danach nur
// noch die Nachrichtenliste (#chatLog) aktualisiert — so bleibt der Eingabe-
// text erhalten. Gepollt wird via updateChatPolling(), solange der Tab offen ist.

const chatTime = (ts) =>
  new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

renderers.chat = async () => {
  const el = $("#tab-chat");
  if (!el.querySelector("#chatLog")) {
    el.innerHTML = `
      <h2>Welt-Chat</h2>
      <div class="card chat-card">
        <div id="chatLog" class="chat-log"><p class="muted">Lade …</p></div>
        <div class="chat-input">
          <input id="chatText" maxlength="240" placeholder="Nachricht an alle Spieler …" autocomplete="off">
          <button id="chatSend" class="btn primary">Senden</button>
        </div>
      </div>`;
    $("#chatSend").addEventListener("click", sendChat);
    $("#chatText").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }
  // Chat geöffnet: Störer sofort entfernen (Server markiert als gelesen).
  const cBadge = $("#chatBadge");
  if (cBadge) cBadge.classList.add("hidden");
  await pollChat();
};

function renderChatLog(messages) {
  const log = $("#chatLog");
  if (!log) return;
  // Nur automatisch nach unten scrollen, wenn der Nutzer ohnehin unten steht.
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.innerHTML = messages.length
    ? messages
        .map((m) => {
          const mine = m.from === state.user.name;
          return `<div class="chat-msg${mine ? " mine" : ""}">
            <span class="chat-meta"><b>${esc(m.from)}</b><time>${chatTime(m.time)}</time></span>
            <span class="chat-text">${esc(m.text)}</span>
          </div>`;
        })
        .join("")
    : '<p class="muted">Noch keine Nachrichten. Schreib die erste!</p>';
  if (atBottom) log.scrollTop = log.scrollHeight;
}

async function pollChat() {
  try {
    const r = await api("/api/chat");
    renderChatLog(r.messages || []);
  } catch {
    /* offline? nächster Poll */
  }
}

async function sendChat() {
  const input = $("#chatText");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const r = await api("/api/chat", { text });
    renderChatLog(r.messages || []);
    input.focus();
  } catch (e) {
    toast(e.message, true);
    input.value = text;
  }
}

// ---------------- Tab: Freunde ----------------
// Freundesliste + ein- und ausgehende Freundschaftsanfragen.

renderers.freunde = async () => {
  const el = $("#tab-freunde");
  if (!el.dataset.built) {
    el.innerHTML = `
      <h2>Freunde</h2>
      <div class="card">
        <h3 style="margin-top:0">Freund hinzufügen</h3>
        <div class="formrow">
          <label>Spielername <input id="friendName" maxlength="16" placeholder="Name" autocomplete="off"></label>
          <button class="btn primary" onclick="friendRequest()">Anfrage senden</button>
        </div>
        <p class="muted" style="margin-top:8px">Schickt eine Freundschaftsanfrage. Der andere Spieler muss sie bestätigen.</p>
      </div>
      <div id="friendReqIn" class="card"></div>
      <div id="friendReqOut" class="card"></div>
      <div id="friendList" class="card"></div>`;
    el.querySelector("#friendName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") window.friendRequest();
    });
    el.dataset.built = "1";
  }
  await pollFriends();
};

async function pollFriends() {
  let d;
  try {
    d = await api("/api/friends");
  } catch {
    return;
  }
  renderFriendData(d);
}

function relTime(ts) {
  if (!ts) return "";
  const mins = Math.floor((serverNow() - ts) / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} d`;
}

function renderFriendData(d) {
  const inEl = $("#friendReqIn");
  const outEl = $("#friendReqOut");
  const listEl = $("#friendList");
  if (!inEl || !outEl || !listEl) return;

  // Eingehende Anfragen
  if (d.incoming.length) {
    const rows = d.incoming
      .map(
        (r) => `
      <tr>
        <td><b>${esc(r.name)}</b></td>
        <td class="muted">${esc(relTime(r.time))}</td>
        <td>
          <button class="btn small primary" onclick="friendRespond('accept','${r.id}')">Annehmen</button>
          <button class="btn small danger" onclick="friendRespond('decline','${r.id}')">Ablehnen</button>
        </td>
      </tr>`,
      )
      .join("");
    inEl.innerHTML = `<h3 style="margin-top:0">Eingehende Anfragen <span class="muted">(${d.incoming.length})</span></h3>
      <table><tbody>${rows}</tbody></table>`;
    inEl.classList.remove("hidden");
  } else {
    inEl.innerHTML = "";
    inEl.classList.add("hidden");
  }

  // Ausgehende Anfragen
  if (d.outgoing.length) {
    const rows = d.outgoing
      .map(
        (r) => `
      <tr>
        <td><b>${esc(r.name)}</b></td>
        <td class="muted">${esc(relTime(r.time))}</td>
        <td><button class="btn small" onclick="friendRespond('decline','${r.id}')">Zurückziehen</button></td>
      </tr>`,
      )
      .join("");
    outEl.innerHTML = `<h3 style="margin-top:0">Gesendete Anfragen <span class="muted">(${d.outgoing.length})</span></h3>
      <table><tbody>${rows}</tbody></table>`;
    outEl.classList.remove("hidden");
  } else {
    outEl.innerHTML = "";
    outEl.classList.add("hidden");
  }

  // Freundesliste
  const rows = d.friends.length
    ? d.friends
        .map(
          (f) => `
      <tr>
        <td>${f.online ? "🟢" : "⚫"} <b>${esc(f.name)}</b>${f.alliance ? ` <span class="muted">[${esc(f.alliance)}]</span>` : ""}</td>
        <td class="num">${fmtNum(f.points)}</td>
        <td>${f.x != null ? `(${f.x}|${f.y})` : "—"}</td>
        <td class="muted">${f.online ? "online" : esc(relTime(f.lastSeen))}</td>
        <td><button class="btn small danger" onclick="friendRemove('${esc(f.name)}')">Entfernen</button></td>
      </tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="muted">Noch keine Freunde — schick jemandem eine Anfrage!</td></tr>';
  listEl.innerHTML = `<h3 style="margin-top:0">Meine Freunde <span class="muted">(${d.friends.length})</span></h3>
    <table>
      <thead><tr><th>Spieler</th><th class="num">Punkte</th><th>Dorf</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

window.friendRequest = async () => {
  const input = $("#friendName");
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  try {
    const d = await api("/api/friends/request", { name });
    input.value = "";
    renderFriendData(d);
    toast("Anfrage gesendet.");
  } catch (e) {
    toast(e.message, true);
  }
};

window.friendRespond = async (what, id) => {
  try {
    const d = await api("/api/friends/" + what, { id });
    renderFriendData(d);
    toast(what === "accept" ? "Freund hinzugefügt." : "Erledigt.");
  } catch (e) {
    toast(e.message, true);
  }
};

window.friendRemove = async (name) => {
  if (!confirm(`${name} wirklich aus deiner Freundesliste entfernen?`)) return;
  try {
    const d = await api("/api/friends/remove", { name });
    renderFriendData(d);
    toast("Freund entfernt.");
  } catch (e) {
    toast(e.message, true);
  }
};

// Aus anderen Ansichten (z. B. Rangliste) direkt eine Anfrage senden.
window.friendRequestFor = async (name) => {
  try {
    await api("/api/friends/request", { name });
    toast(`Anfrage an ${name} gesendet.`);
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Aufträge ----------------
// Feste Auftragskette mit Spielerstufe. Erfüllte Aufträge liefern Rohstoffe
// und XP; gesammelte XP steigern die Stufe und schalten neue Aufträge frei.

const RES_ICONS = { holz: "🪵", stein: "🪨", eisen: "⛓️" };

function rewardHtml(reward) {
  return Object.entries(reward)
    .filter(([, n]) => n > 0)
    .map(
      ([r, n]) =>
        `<span title="${RES_NAMES[r]}">${RES_ICONS[r]} ${fmtNum(n)}</span>`,
    )
    .join(" ");
}

renderers.auftraege = async () => {
  const el = $("#tab-auftraege");
  if (!el.dataset.built) {
    el.innerHTML = `
      <h2>Aufträge</h2>
      <div id="questLevel" class="card"></div>
      <div id="questList"></div>`;
    el.dataset.built = "1";
  }
  await pollQuests();
};

async function pollQuests() {
  let d;
  try {
    d = await api("/api/quests");
  } catch {
    return;
  }
  renderQuestData(d);
}

function renderQuestData(d) {
  const lvlEl = $("#questLevel");
  const listEl = $("#questList");
  if (!lvlEl || !listEl) return;

  const pct =
    d.need > 0 ? Math.min(100, Math.round((d.into / d.need) * 100)) : 100;
  lvlEl.innerHTML = `
    <div class="quest-level">
      <div class="quest-level-badge">${d.level}</div>
      <div class="quest-level-info">
        <div class="quest-level-top"><b>Stufe ${d.level}</b><span class="muted">${fmtNum(d.into)} / ${fmtNum(d.need)} XP</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="muted small">Abgeschlossen: ${d.claimed}/${d.total} Aufträge</div>
      </div>
    </div>`;

  // Sortierung: abholbar zuerst, dann offene, dann gesperrte, dann erledigte.
  const rank = (q) => {
    if (q.claimable) return 0;
    if (q.claimed) return 3;
    if (q.locked) return 2;
    return 1;
  };
  const quests = [...d.quests].sort(
    (a, b) => rank(a) - rank(b) || a.reqLevel - b.reqLevel,
  );

  listEl.innerHTML = quests
    .map((q) => {
      const pc =
        q.target > 0
          ? Math.min(100, Math.round((q.current / q.target) * 100))
          : 0;
      let cls = "quest";
      let action;
      if (q.claimed) {
        cls += " done";
        action = '<span class="quest-state ok">✓ Abgeschlossen</span>';
      } else if (q.locked) {
        cls += " locked";
        action = `<span class="quest-state">🔒 Ab Stufe ${q.reqLevel}</span>`;
      } else if (q.claimable) {
        cls += " ready";
        action = `<button class="btn small primary" onclick="claimQuest('${q.id}')">Belohnung abholen</button>`;
      } else {
        action = `<span class="quest-state muted">${fmtNum(q.current)} / ${fmtNum(q.target)}</span>`;
      }
      return `
      <div class="${cls} card">
        <div class="quest-head">
          <div>
            <b>${esc(q.name)}</b>
            <span class="quest-xp">+${q.xp} XP</span>
          </div>
          ${action}
        </div>
        <p class="muted quest-desc">${esc(q.desc)}</p>
        <div class="bar slim"><span style="width:${pc}%"></span></div>
        <div class="quest-foot">
          <span class="muted small">${fmtNum(q.current)} / ${fmtNum(q.target)}</span>
          <span class="quest-reward">Belohnung: ${rewardHtml(q.reward)}</span>
        </div>
      </div>`;
    })
    .join("");
}

window.claimQuest = async (id) => {
  try {
    const d = await api("/api/quests/claim", { id });
    renderQuestData(d);
    // Frischer State: Header-Stufe, Badge und Rohstoffe aktualisieren.
    await refreshState();
    const parts = Object.entries(d.gained || {})
      .filter(([, n]) => n > 0)
      .map(([r, n]) => `${RES_ICONS[r]} +${fmtNum(n)}`)
      .join("  ");
    if (d.leveledUp) {
      notify({
        type: "report",
        title: `Stufe ${d.newLevel} erreicht!`,
        body: "Neue Aufträge freigeschaltet.",
        ttl: 9000,
      });
    }
    toast(
      `Auftrag abgeschlossen — +${d.xpGained} XP${parts ? ", " + parts : ""}.`,
    );
  } catch (e) {
    toast(e.message, true);
  }
};

// Aktive Berichts-Kategorie (Tab-Filter). "Alle" = kein Filter.
let reportFilter = "Alle";
// Aktives Dorf für die Berichts-Ansicht. null = folgt dem aktiven Dorf,
// "all" = Berichte aller Dörfer, sonst eine Dorf-ID.
let reportVillage = null;

// Nur Berichte der gewählten Kategorie zeigen, ohne neu vom Server zu laden.
window.filterReports = (kind) => {
  reportFilter = kind;
  document.querySelectorAll("#tab-berichte .report-wrap").forEach((w) => {
    w.classList.toggle("hidden", kind !== "Alle" && w.dataset.kind !== kind);
  });
  document.querySelectorAll("#tab-berichte .rfilter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.kind === kind);
  });
};

// Dorf-Ansicht der Berichte wechseln: Kategorie zurücksetzen und neu rendern.
window.filterReportVillage = (vid) => {
  reportVillage = vid;
  reportFilter = "Alle";
  renderTab("berichte");
};

renderers.berichte = async () => {
  const el = $("#tab-berichte");
  el.innerHTML = '<h2>Berichte</h2><p class="muted">Lade …</p>';
  let reports;
  try {
    reports = await api("/api/reports");
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
    return;
  }
  indexScoutIntel(reports);
  state.unreadReports = 0;
  $("#reportBadge").classList.add("hidden");

  const sum = (obj) =>
    Object.values(obj || {}).reduce((a, b) => a + Number(b || 0), 0);

  const unitTable = (label, sent, lost) => {
    const rows = Object.entries(sent)
      .map(([k, n]) => {
        const l = lost[k] || 0;
        const left = n - l;
        return `<tr><td>${meta.UNITS[k].name}</td><td class="num">${fmtNum(n)}</td><td class="num red">${l ? "−" + fmtNum(l) : "—"}</td><td class="num ${left ? "green" : "red"}">${fmtNum(left)}</td></tr>`;
      })
      .join("");
    const totSent = sum(sent);
    const totLost = sum(lost);
    return `<h3>${label}</h3><table><thead><tr><th>Einheit</th><th class="num">Anzahl</th><th class="num">Verluste</th><th class="num">Übrig</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">keine Truppen</td></tr>'}</tbody>${totSent ? `<tfoot><tr><td>Summe</td><td class="num">${fmtNum(totSent)}</td><td class="num red">${totLost ? "−" + fmtNum(totLost) : "—"}</td><td class="num">${fmtNum(totSent - totLost)}</td></tr></tfoot>` : ""}</table>`;
  };

  // Kräftevergleich als Balken (Angriffskraft vs. effektive Verteidigung)
  const powerBar = (atk, def) => {
    if (!atk && !def) return "";
    const total = atk + def || 1;
    const aPct = Math.round((atk / total) * 100);
    return `
      <div class="rpower">
        <div class="rpower-labels">
          <span class="red">⚔️ Angriff ${fmtNum(atk)}</span>
          <span class="green">🛡️ Verteidigung ${fmtNum(def)}</span>
        </div>
        <div class="rpower-bar"><span style="width:${aPct}%"></span></div>
      </div>`;
  };

  // Spionage-Bericht: aufgedeckte Rohstoffe & Truppen des Ziels
  const spyReport = (r) => {
    const iAmAttacker = r.attacker.name === state.user.name;
    const success = iAmAttacker ? r.success : !r.success;
    let body;
    if (iAmAttacker) {
      if (r.success && r.intel) {
        const resHtml = costHtml(r.intel.res);
        const troops = Object.entries(r.intel.units || {});
        const troopRows = troops.length
          ? troops
              .map(
                ([k, n]) =>
                  `<tr><td>${meta.UNITS[k]?.name || k}</td><td class="num">${fmtNum(n)}</td></tr>`,
              )
              .join("")
          : '<tr><td colspan="2" class="muted">keine Truppen im Dorf</td></tr>';
        const wallNote =
          r.intel.wall > 0
            ? `<p class="muted small">Stadtmauer Stufe ${r.intel.wall} (+${r.intel.wall * 6} % Verteidigung) · Lager fasst ${fmtNum(r.intel.storage)}</p>`
            : `<p class="muted small">Keine Stadtmauer · Lager fasst ${fmtNum(r.intel.storage)}</p>`;
        body = `
          <div class="rloot"><b>💰 Rohstoffe im Dorf</b> ${resHtml}</div>
          <table><thead><tr><th>Einheit</th><th class="num">Anzahl</th></tr></thead><tbody>${troopRows}</tbody></table>
          ${wallNote}
          <p class="muted small">Verlorene Späher: ${fmtNum(r.attacker.lost.spaeher || 0)} von ${fmtNum(r.attacker.sent.spaeher || 0)}</p>`;
      } else {
        body = `<p class="red">Deine Späher wurden abgefangen — keine Informationen. Verluste: ${fmtNum(r.attacker.lost.spaeher || 0)} von ${fmtNum(r.attacker.sent.spaeher || 0)} Spähern.</p>`;
      }
    } else {
      // Ich bin der Ausgespähte
      body = r.success
        ? `<p class="red">${esc(r.attacker.name)} (${esc(r.attacker.village)}, ${r.attacker.x}|${r.attacker.y}) hat dein Dorf erfolgreich ausgespäht — er kennt jetzt deine Rohstoffe und Truppen!</p>`
        : `<p class="green">Du hast feindliche Späher von ${esc(r.attacker.name)} (${esc(r.attacker.village)}, ${r.attacker.x}|${r.attacker.y}) abgefangen. Keine Informationen preisgegeben.</p>`;
    }
    return `
      <div class="card report ${success ? "won" : "lost"}" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>🔍 ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">${body}</div>
      </div>`;
  };

  // Handelsbericht: erhaltene/abgegebene Rohstoffe + aktueller Lagerbestand
  const tradeReport = (r) => {
    const iAmSeller = r.role === "seller";
    const shortfall =
      r.received.offered != null && r.received.amount < r.received.offered;
    const gotHtml = costHtml({ [r.received.res]: r.received.amount });
    const paidHtml = costHtml({ [r.paid.res]: r.paid.amount });
    const partner = r.partner || {};
    const partnerLine =
      partner.name != null
        ? `<p class="muted">${iAmSeller ? "Käufer" : "Verkäufer"}: ${esc(partner.name)}${partner.village != null ? ` (${esc(partner.village)}, ${partner.x}|${partner.y})` : ""}</p>`
        : "";
    const shortNote = shortfall
      ? `<p class="muted small red">⚠️ Nur ${fmtNum(r.received.amount)} von ${fmtNum(r.received.offered)} gutgeschrieben — dein Lager war voll.</p>`
      : "";
    const stockHtml = r.stock ? costHtml(r.stock) : "";
    return `
      <div class="card report won" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>⚖️ ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          ${partnerLine}
          <div class="rloot"><b>📥 Erhalten</b> ${gotHtml}</div>
          <div class="rloot"><b>📤 Abgegeben</b> ${paidHtml}</div>
          ${shortNote}
          ${stockHtml ? `<div class="rloot"><b>📦 Lager jetzt</b> ${stockHtml}</div>` : ""}
        </div>
      </div>`;
  };

  // Sammelbericht: heimgekehrte Bewohner + Ertrag vom Rohstoffvorkommen
  const gatherReport = (r) => {
    const resName = RES_NAMES[r.res] || r.res;
    const gotHtml = costHtml({ [r.res]: r.stored });
    const wasteNote = r.wasted
      ? `<p class="muted small red">⚠️ ${fmtNum(r.wasted)} ${resName} gingen verloren — dein Lager war voll.</p>`
      : "";
    const stockHtml = r.stock ? costHtml(r.stock) : "";
    return `
      <div class="card report won" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>👷 ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          <p class="muted">${fmtNum(r.workers)}× Bewohner am Vorkommen (${r.x}|${r.y})</p>
          <div class="rloot"><b>📥 Gesammelt</b> ${gotHtml}</div>
          ${wasteNote}
          ${stockHtml ? `<div class="rloot"><b>📦 Lager jetzt</b> ${stockHtml}</div>` : ""}
        </div>
      </div>`;
  };

  const unitList = (u) =>
    u && Object.keys(u).length
      ? Object.entries(u)
          .map(([k, n]) => `${fmtNum(n)}× ${meta.UNITS[k]?.name || k}`)
          .join(", ")
      : "keine";

  // Räuberüberfall auf eine Sammelmission
  const raidReport = (r) => {
    const cls = r.repelled ? "won" : "lost";
    return `
      <div class="card report ${cls}" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          <p class="muted">Vorkommen (${r.x}|${r.y}) · Räuberstärke ${fmtNum(r.banditPower)} vs. Wach-Verteidigung ${fmtNum(r.guardDef)}</p>
          ${r.residentsKilled ? `<p class="red">🪦 Gefallene Bewohner: <b>${fmtNum(r.residentsKilled)}</b> — sie wachsen im Rathaus nach.</p>` : '<p class="green">Alle Bewohner sind unversehrt.</p>'}
          <p class="muted small">Verlorene Wachen: ${unitList(r.guardLost)}</p>
        </div>
      </div>`;
  };

  // Verstärkung entsandt oder erhalten
  const reinforceReport = (r) => {
    return `
      <div class="card report won" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          ${r.x != null ? `<p class="muted">Ziel: (${r.x}|${r.y})</p>` : ""}
          <p><b>🤝 Truppen:</b> ${unitList(r.units)}</p>
        </div>
      </div>`;
  };

  const friendReport = (r) => {
    return `
      <div class="card report won" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>🤝 ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          <p class="muted">Du bist jetzt mit ${esc(r.partner)} befreundet.</p>
        </div>
      </div>`;
  };

  // Sammelbericht ohne bekannten Renderer (z. B. Transport): schlichte Karte
  const genericReport = (r) => `
      <div class="card report won" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>${esc(r.title || r.kind || "Bericht")}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          ${r.from ? `<p class="muted">Von: ${esc(r.from)}</p>` : ""}
          ${r.res ? `<div class="rloot"><b>📦 Rohstoffe</b> ${costHtml(r.res)}</div>` : ""}
          ${r.stock ? `<div class="rloot"><b>📦 Lager jetzt</b> ${costHtml(r.stock)}</div>` : ""}
          ${r.x != null ? `<p class="muted small">Ziel: (${r.x}|${r.y})</p>` : ""}
        </div>
      </div>`;

  // Kampfbericht (Standard-Kategorie ohne eigenes kind-Feld)
  const battleReport = (r) => {
    const iAmAttacker = r.attacker.name === state.user.name;
    const success = iAmAttacker ? r.won : !r.won;
    const lootTotal = r.loot ? r.loot.holz + r.loot.stein + r.loot.eisen : 0;
    let lootBlock = "";
    if (r.won) {
      const capNote =
        r.capacity != null
          ? ` <span class="muted">(${fmtNum(lootTotal)} von ${fmtNum(r.capacity)} Tragekapazität)</span>`
          : "";
      lootBlock = `<div class="rloot"><b>💰 Beute</b> ${lootTotal ? costHtml(r.loot) : '<span class="muted">nichts erbeutet</span>'}${capNote}</div>`;
    } else {
      lootBlock = `<div class="rloot"><b>💰 Beute</b> <span class="muted">Angriff abgewehrt — keine Beute</span></div>`;
    }
    const wallNote =
      r.defender.wall != null && r.defender.wall > 0
        ? ` · Stadtmauer Stufe ${r.defender.wall} (+${r.defender.wall * 6} % Verteidigung)`
        : "";
    const outcome = r.won
      ? `<span class="green">Angreifer siegreich</span>`
      : `<span class="red">Verteidiger siegreich</span>`;
    let conquestBlock = "";
    if (r.conquest) {
      conquestBlock = r.conquest.conquered
        ? `<div class="rloot"><b>👑 Adelung</b> <span class="green">Dorf erobert — es wechselt den Besitzer!</span></div>`
        : `<div class="rloot"><b>👑 Adelung</b> Treue ${r.conquest.progress}/${r.conquest.needed} — noch ${Math.max(0, r.conquest.needed - r.conquest.progress)} Paladin-Angriff(e) bis zur Eroberung.</div>`;
    }
    return `
      <div class="card report ${success ? "won" : "lost"}" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>${success ? "✅" : "❌"} ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          <p class="muted">⚔️ ${esc(r.attacker.name)} (${esc(r.attacker.village)}, ${r.attacker.x}|${r.attacker.y}) → 🛡️ ${esc(r.defender.name)} (${esc(r.defender.village)}, ${r.defender.x}|${r.defender.y})<br>Ergebnis: ${outcome}${wallNote}</p>
          ${powerBar(r.attacker.power || 0, r.defender.power || 0)}
          ${lootBlock}
          ${conquestBlock}
          ${r.defender.residentsLost ? `<p class="red">🪦 Gefallene Bewohner beim Verteidiger: <b>${fmtNum(r.defender.residentsLost)}</b> — wachsen im Rathaus nach.</p>` : ""}
          ${
            r.defender.garrisonLost
              ? `<p class="muted small">Verlorene Verstärkung: ${Object.entries(
                  r.defender.garrisonLost,
                )
                  .map(([k, n]) => `${fmtNum(n)}× ${meta.UNITS[k]?.name || k}`)
                  .join(", ")}</p>`
              : ""
          }
          <div class="grid2">
            <div>${unitTable("Angreifer", r.attacker.sent, r.attacker.lost)}</div>
            <div>${unitTable("Verteidiger", r.defender.had, r.defender.lost)}</div>
          </div>
        </div>
      </div>`;
  };

  // Eroberungsbericht: eigenständige Meldung nach erfolgreicher Adelung.
  const conquestReport = (r) => {
    const mine = r.mine;
    return `
      <div class="card report ${mine ? "won" : "lost"}" onclick="this.querySelector('.rbody').classList.toggle('hidden')">
        <div class="rhead"><b>${mine ? "👑" : "🏳️"} ${esc(r.title)}</b><span class="rtime">${fmtTime(r.time)}</span></div>
        <div class="rbody hidden">
          ${
            mine
              ? `<p class="green">Dein Paladin hat <b>${esc(r.village.name)}</b> (${r.village.x}|${r.village.y}) erobert — es gehört jetzt zu deinem Reich!</p>
                 <p class="muted">Bisheriger Besitzer: ${esc(r.formerOwner)}</p>`
              : `<p class="red">Du hast <b>${esc(r.village.name)}</b> (${r.village.x}|${r.village.y}) verloren.</p>
                 <p class="muted">Neuer Besitzer: ${esc(r.conqueror.name)} (${esc(r.conqueror.village)}, ${r.conqueror.x}|${r.conqueror.y})</p>`
          }
        </div>
      </div>`;
  };

  // Bericht in die passende Kategorie einordnen und rendern.
  const renderReport = (r) => {
    const kind = r.kind || "Kampf";
    if (kind === "Spionage") return spyReport(r);
    if (kind === "Handel") return tradeReport(r);
    if (kind === "Sammeln") return gatherReport(r);
    if (kind === "Überfall") return raidReport(r);
    if (kind === "Verstärkung") return reinforceReport(r);
    if (kind === "Freundschaft") return friendReport(r);
    if (kind === "Eroberung") return conquestReport(r);
    if (kind === "Kampf" && r.attacker) return battleReport(r);
    return genericReport(r);
  };

  // ----- Dorf-Ansicht: Berichte nach Dorf trennen -----
  const villages = state.villages || [];
  // Ungültige/erste Auswahl auf das aktive Dorf zurücksetzen.
  if (
    reportVillage === null ||
    (reportVillage !== "all" && !villages.some((vv) => vv.id === reportVillage))
  ) {
    reportVillage = state.village.id;
  }
  // Berichte eines Dorfes: dorfbezogene + kontobezogene (villageId == null).
  const inVillage = (r) =>
    reportVillage === "all" ||
    r.villageId == null ||
    r.villageId === reportVillage;
  const scoped = reports.filter(inVillage);

  const villageCount = (vid) =>
    vid === "all"
      ? reports.length
      : reports.filter((r) => r.villageId === vid).length;
  const vChip = (vid, label, count) =>
    `<button class="rvfilter-chip${reportVillage === vid ? " active" : ""}" onclick="filterReportVillage('${vid}')">${label}<span class="rfilter-count">${count}</span></button>`;
  const villageRow =
    villages.length > 1
      ? `<div class="rvfilter">${vChip("all", "🌍 Alle Dörfer", reports.length)}${villages
          .map((vv) => vChip(vv.id, `🏰 ${esc(vv.name)}`, villageCount(vv.id)))
          .join("")}</div>`
      : "";

  // Wie viele Berichte je Kategorie? Bestimmt die verfügbaren Filter-Tabs.
  const counts = {};
  for (const r of scoped) {
    const k = r.kind || "Kampf";
    counts[k] = (counts[k] || 0) + 1;
  }
  // Gewählte Kategorie zurücksetzen, wenn sie nicht mehr vorkommt.
  if (reportFilter !== "Alle" && !counts[reportFilter]) reportFilter = "Alle";

  const KIND_ICON = {
    Kampf: "⚔️",
    Eroberung: "👑",
    Spionage: "🔍",
    Sammeln: "👷",
    Überfall: "🗡️",
    Handel: "⚖️",
    Transport: "🛒",
    Verstärkung: "🤝",
    Freundschaft: "🫱",
  };
  const KIND_ORDER = [
    "Kampf",
    "Eroberung",
    "Spionage",
    "Sammeln",
    "Überfall",
    "Handel",
    "Transport",
    "Verstärkung",
    "Freundschaft",
  ];
  const presentKinds = KIND_ORDER.filter((k) => counts[k]).concat(
    Object.keys(counts).filter((k) => !KIND_ORDER.includes(k)),
  );

  const chip = (k, label, count) =>
    `<button class="rfilter-chip${reportFilter === k ? " active" : ""}" data-kind="${esc(k)}" onclick="filterReports(this.dataset.kind)">${label}<span class="rfilter-count">${count}</span></button>`;
  const chipsHtml = scoped.length
    ? `<div class="rfilter">${chip("Alle", "📋 Alle", scoped.length)}${presentKinds
        .map((k) => chip(k, `${KIND_ICON[k] || "📜"} ${k}`, counts[k]))
        .join("")}</div>`
    : "";

  const items = scoped.length
    ? scoped
        .map((r) => {
          const kind = r.kind || "Kampf";
          const hidden =
            reportFilter !== "Alle" && reportFilter !== kind ? " hidden" : "";
          return `<div class="report-wrap${hidden}" data-kind="${esc(kind)}">${renderReport(r)}</div>`;
        })
        .join("")
    : '<p class="muted">Noch keine Berichte für dieses Dorf.</p>';

  el.innerHTML = `<h2>Berichte</h2>${villageRow}${chipsHtml}${items}`;
};

// ---------------- Tab: Rangliste ----------------

renderers.rangliste = async () => {
  const el = $("#tab-rangliste");
  el.innerHTML = '<h2>Rangliste</h2><p class="muted">Lade …</p>';
  let list;
  try {
    list = await api("/api/ranking");
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
    return;
  }
  const rows = list
    .map(
      (p, i) => `
    <tr ${p.name === state.user.name ? 'style="color:var(--gold)"' : ""}>
      <td class="num">${i + 1}.</td>
      <td><b>${esc(p.name)}</b>${p.alliance ? ` <span class="muted">[${esc(p.alliance)}]</span>` : ""}</td>
      <td><a href="#" class="coord-link" title="Auf der Karte anzeigen" onclick="showOnMap(${p.x}, ${p.y}); return false;">(${p.x}|${p.y})</a></td>
      <td class="num">${fmtNum(p.points)}</td>
      <td>${p.name === state.user.name || p.friend ? "" : `<button class="btn small" onclick="friendRequestFor('${esc(p.name)}')">🤝 Freund</button>`}</td>
    </tr>`,
    )
    .join("");
  el.innerHTML = `
    <h2>Rangliste</h2>
    <div class="card">
      <table>
        <thead><tr><th class="num">#</th><th>Spieler</th><th>Dorf</th><th class="num">Punkte</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
};

// ---------------- Tab: Shop (Echtgeld / PayPal) ----------------

// PayPal-SDK genau einmal laden (nur wenn echte Zahlung konfiguriert ist).
let paypalSdkPromise = null;
function loadPayPalSdk(clientId) {
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://www.paypal.com/sdk/js?client-id=" +
      encodeURIComponent(clientId) +
      "&currency=EUR&intent=capture";
    s.onload = () => resolve(window.paypal);
    s.onerror = () =>
      reject(new Error("PayPal-SDK konnte nicht geladen werden."));
    document.head.appendChild(s);
  });
  return paypalSdkPromise;
}

// Käufe schreibt der Server erst nach bestätigter Zahlung gut; wir übernehmen
// den zurückgelieferten frischen State und zeichnen den Shop neu.
function applyShopResult(r) {
  if (r.state) applyState(r.state);
  notify({
    type: "report",
    title: "Kauf erfolgreich",
    body: `${esc(r.name || "Artikel")} wurde deinem Dorf gutgeschrieben.`,
    ttl: 8000,
  });
  renderTab("shop");
}

renderers.shop = async () => {
  const el = $("#tab-shop");
  el.innerHTML = '<h2>💎 Shop</h2><p class="muted">Lade …</p>';
  let shop;
  try {
    shop = await api("/api/shop");
  } catch (e) {
    el.innerHTML = `<p class="red">${esc(e.message)}</p>`;
    return;
  }

  const boost =
    shop.boosts && shop.boosts.production ? shop.boosts.production : null;
  const boostBanner = boost
    ? `<div class="card shop-boost">⚡ <b>Produktionsboost aktiv</b> (×${boost.mult}) — endet in ${countdown(boost.until, { tag: "b" })}</div>`
    : "";

  const testBadge = shop.testMode
    ? `<div class="card shop-test">🧪 <b>Testmodus</b> — es ist keine PayPal-App hinterlegt. Käufe werden <b>ohne echte Zahlung</b> simuliert. Für echte Zahlungen <code>PAYPAL_CLIENT_ID</code> und <code>PAYPAL_SECRET</code> als Umgebungsvariablen setzen.</div>`
    : `<p class="muted">Sichere Bezahlung über PayPal${shop.paypalEnv === "sandbox" ? " <b>(Sandbox)</b>" : ""}. Artikel werden dem <b>aktiven Dorf</b> gutgeschrieben.</p>`;

  const cards = shop.items
    .map(
      (it) => `
    <div class="card shop-item">
      <div class="shop-icon">${it.icon || "💎"}</div>
      <div class="shop-body">
        <h3>${esc(it.name)}</h3>
        <p class="muted">${esc(it.desc)}</p>
      </div>
      <div class="shop-buy">
        <div class="shop-price">${it.price.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</div>
        ${
          shop.testMode
            ? `<button class="btn primary" disabled title="Nur mit hinterlegter PayPal-App verfügbar">Testkauf</button>`
            : `<div class="pp-buttons" id="pp-${it.id}" data-item="${it.id}" data-price="${it.price}"></div>`
        }
      </div>
    </div>`,
    )
    .join("");

  const history = shop.purchases.length
    ? `<div class="card">
        <h3 style="margin-top:0">Deine Käufe</h3>
        <table><tbody>${shop.purchases
          .map(
            (p) =>
              `<tr><td>${fmtTime(p.at)}</td><td><b>${esc(p.name)}</b>${p.test ? ' <span class="muted">(Test)</span>' : ""}</td><td class="num">${Number(p.price).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</td></tr>`,
          )
          .join("")}</tbody></table>
      </div>`
    : "";

  el.innerHTML = `
    <h2>💎 Shop <small class="muted">— Boosts &amp; Rohstoffe</small></h2>
    ${testBadge}
    ${boostBanner}
    <div class="shop-grid">${cards}</div>
    ${history}`;

  // Im Live-Modus die PayPal-Buttons in jede Artikelkarte einhängen.
  if (!shop.testMode && shop.paypalClientId) {
    try {
      const paypal = await loadPayPalSdk(shop.paypalClientId);
      el.querySelectorAll(".pp-buttons").forEach((container) => {
        const itemId = container.dataset.item;
        paypal
          .Buttons({
            style: { layout: "horizontal", height: 38, tagline: false },
            createOrder: async () => {
              const o = await api("/api/shop/order", { itemId });
              return o.orderId;
            },
            onApprove: async (data) => {
              try {
                const r = await api("/api/shop/capture", {
                  orderId: data.orderID,
                });
                applyShopResult(r);
              } catch (e) {
                toast(e.message, true);
              }
            },
            onError: () => toast("PayPal-Zahlung fehlgeschlagen.", true),
          })
          .render(container);
      });
    } catch (e) {
      el.insertAdjacentHTML(
        "beforeend",
        `<p class="red">${esc(e.message)}</p>`,
      );
    }
  }
};

// Testmodus: Bestellung anlegen und sofort „einziehen" (ohne echte Zahlung).
window.shopBuyTest = async (itemId) => {
  try {
    const o = await api("/api/shop/order", { itemId });
    const r = await api("/api/shop/capture", { orderId: o.orderId });
    applyShopResult(r);
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------- Tab: Changelog ----------------
// Neue Einträge oben ergänzen. Typen: "feature", "fix", "balance", "improvement".
const CHANGELOG = [
  {
    version: "0.5.0",
    date: "2026-07-09",
    title: "Nebel des Krieges",
    changes: [
      {
        type: "feature",
        text: "Nebel des Krieges: Die Weltkarte ist verhüllt – nur erkundete Gebiete sind sichtbar.",
      },
      {
        type: "feature",
        text: "Erkundung: Klicke ein Nebelfeld an und schicke Späher, um die Umgebung dauerhaft aufzudecken.",
      },
      {
        type: "feature",
        text: "Spähzüge auf Dörfer decken jetzt zusätzlich deren Umgebung auf.",
      },
      {
        type: "improvement",
        text: "Schönere Nebel-Grafik mit weichen Wolkenschwaden und Hervorhebung des angeklickten Feldes.",
      },
      {
        type: "fix",
        text: "Karte verschieben (Ziehen bei Standard-Zoom) funktioniert wieder korrekt.",
      },
      {
        type: "fix",
        text: "Kein schwarzes Aufblitzen mehr beim Verschieben der Karte.",
      },
    ],
  },
];

const CHANGE_TYPES = {
  feature: { icon: "✨", label: "Neu", cls: "cl-feature" },
  fix: { icon: "🐛", label: "Fix", cls: "cl-fix" },
  balance: { icon: "⚖️", label: "Balance", cls: "cl-balance" },
  improvement: { icon: "🔧", label: "Verbessert", cls: "cl-improve" },
};

renderers.changelog = () => {
  const el = $("#tab-changelog");
  if (!el) return;
  const releases = CHANGELOG.map((rel, i) => {
    const items = rel.changes
      .map((c) => {
        const t = CHANGE_TYPES[c.type] || CHANGE_TYPES.improvement;
        return `<li class="cl-item">
          <span class="cl-tag ${t.cls}">${t.icon} ${t.label}</span>
          <span class="cl-text">${esc(c.text)}</span>
        </li>`;
      })
      .join("");
    const latest = i === 0 ? '<span class="cl-latest">Aktuell</span>' : "";
    return `<div class="card cl-release">
      <div class="cl-head">
        <h3>Version ${esc(rel.version)}${rel.title ? ` — ${esc(rel.title)}` : ""} ${latest}</h3>
        <span class="muted cl-date">${esc(rel.date)}</span>
      </div>
      <ul class="cl-list">${items}</ul>
    </div>`;
  }).join("");
  el.innerHTML = `
    <h2>🆕 Changelog</h2>
    <p class="muted">Alle neuen Funktionen, Verbesserungen und Fehlerbehebungen von VOXEMPIRE.</p>
    ${releases}`;
};

// ---------------- Tab: Profil ----------------

renderers.profil = async () => {
  const el = $("#tab-profil");
  el.innerHTML = '<h2>Profil</h2><p class="muted">Lade …</p>';
  let p;
  try {
    p = await api("/api/profile");
  } catch (e) {
    el.innerHTML = `<p class="red">${e.message}</p>`;
    return;
  }

  const pollOpts = [2000, 4000, 8000]
    .map(
      (ms) =>
        `<option value="${ms}" ${settings.pollMs === ms ? "selected" : ""}>${ms / 1000} Sekunden</option>`,
    )
    .join("");

  el.innerHTML = `
    <h2>Profil &amp; Einstellungen</h2>

    <div class="card">
      <h3 style="margin-top:0">Konto</h3>
      <table>
        <tbody>
          <tr><td>Spielername</td><td><b class="gold">${esc(p.name)}</b></td></tr>
          <tr><td>Dorf</td><td>${esc(p.village.name)} <span class="muted">(${p.village.x}|${p.village.y})</span></td></tr>
          <tr><td>Punkte</td><td>${fmtNum(p.village.points)}</td></tr>
          <tr><td>Allianz</td><td>${p.alliance ? `[${esc(p.alliance.tag)}] ${esc(p.alliance.name)}` : '<span class="muted">keine</span>'}</td></tr>
          <tr><td>Gefochtene Berichte</td><td>${fmtNum(p.reportCount)} · davon ${fmtNum(p.attackWins)} gewonnene Angriffe</td></tr>
          <tr><td>Mitglied seit</td><td>${fmtTime(p.created)}</td></tr>
          <tr><td>Zuletzt online</td><td>${fmtTime(p.lastSeen)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="grid2">
      <div class="card">
        <h3 style="margin-top:0">Dorf umbenennen</h3>
        <div class="formrow">
          <label>Name <input id="profVillage" maxlength="30" value="${esc(p.village.name)}"></label>
          <button class="btn primary" onclick="profileRename()">Speichern</button>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Passwort ändern</h3>
        <div class="formrow">
          <label>Aktuelles Passwort <input id="profOldPass" type="password" autocomplete="current-password"></label>
          <label>Neues Passwort <input id="profNewPass" type="password" autocomplete="new-password"></label>
          <button class="btn primary" onclick="profileChangePass()">Ändern</button>
        </div>
        <p class="muted" style="margin-top:8px">Nach dem Ändern musst du dich neu einloggen.</p>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Einstellungen <small class="muted">(nur in diesem Browser)</small></h3>
      <div class="formrow">
        <label><input type="checkbox" id="setNotify" ${settings.notifications ? "checked" : ""} onchange="setSetting('notifications', this.checked)"> Benachrichtigungen anzeigen</label>
        <label>Aktualisierungs-Intervall <select id="setPoll" onchange="setSetting('pollMs', Number(this.value))">${pollOpts}</select></label>
      </div>
    </div>`;
};

window.profileRename = async () => {
  const name = $("#profVillage").value.trim();
  try {
    await api("/api/profile/village", { name });
    await refreshState();
    renderHeader();
    toast("Dorf umbenannt.");
    renderers.profil();
  } catch (e) {
    toast(e.message, true);
  }
};

window.profileChangePass = async () => {
  const oldPass = $("#profOldPass").value;
  const newPass = $("#profNewPass").value;
  try {
    await api("/api/profile/password", { oldPass, newPass });
    toast("Passwort geändert — bitte neu einloggen.");
    showAuth();
  } catch (e) {
    toast(e.message, true);
  }
};

window.setSetting = (key, value) => {
  settings[key] = value;
  persistSettings();
  if (key === "pollMs") {
    startPolling();
    updateChatPolling();
  }
  toast("Einstellung gespeichert.");
};

// ---------------- Lokaler Sekunden-Tick ----------------
// Countdowns runterzählen und Rohstoffe hochzählen, ohne Server-Roundtrip.

setInterval(() => {
  if (!state) return;
  let expired = false;
  document.querySelectorAll(".countdown").forEach((el) => {
    const remaining = Number(el.dataset.done) - serverNow();
    el.textContent = fmtDur(remaining);
    if (remaining <= 0) expired = true;
  });
  renderHeaderResourcesOnly();
  if (expired) {
    // Etwas ist fertig geworden → sofort frischen Stand holen
    refreshState()
      .then(renderActiveTabIfCheap)
      .catch(() => {});
  }
}, 1000);

function renderHeaderResourcesOnly() {
  const cap = fmtNum(state.village.storage);
  $("#resHolz").textContent = `${fmtNum(liveRes("holz"))}/${cap}`;
  $("#resStein").textContent = `${fmtNum(liveRes("stein"))}/${cap}`;
  $("#resEisen").textContent = `${fmtNum(liveRes("eisen"))}/${cap}`;
}

// ---------------- Verdrahtung ----------------

$("#btnLogin").addEventListener("click", () => doAuth(false));
$("#btnRegister").addEventListener("click", () => doAuth(true));
$("#authPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doAuth(false);
});
$("#btnLogout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
  } catch {
    /* egal */
  }
  showAuth();
});
document
  .querySelectorAll(".tab")
  .forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// Auto-Login mit gespeichertem Token
if (token) enterGame().catch(showAuth);
