// ============================================================
// VOXEMPIRE — Spiellogik (autoritativ, läuft nur auf dem Server)
//
// Offline-Progression funktioniert über zwei Mechanismen:
//  1. Lazy-Berechnung: Rohstoffe/Bauten/Ausbildung werden nicht
//     getickt, sondern beim nächsten Zugriff aus Zeitstempeln
//     nachgerechnet (touchVillage). Überlebt auch Server-Neustarts.
//  2. Event-Queue: Angriffe & Rückkehr betreffen zwei Parteien und
//     werden vom Sekunden-Tick fällig abgearbeitet — auch wenn
//     beide Spieler offline sind.
// ============================================================
import crypto from 'node:crypto';
import { db, nextId } from './store.js';
import {
  SPEED, WORLD_SIZE, PROTECTION_MS, TOKEN_TTL_MS,
  MAX_BUILD_QUEUE, MAX_TRAIN_QUEUE, MAX_REPORTS, MAX_CHAT,
  RES, BUILDINGS, UNITS,
  buildCost, buildTimeMs, prodPerHour, storageCap, popCap,
  trainTimeMs, travelTimeMs, villagePoints,
  residentsCap, gatherTravelMs, gatherWorkMs, gatherYield, resourceNodeAt,
  QUESTS, xpToNext, levelForXp,
} from './gamedata.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// ---------------- Accounts & Sessions ----------------

export function register(name, pass) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_äöüÄÖÜß-]{3,16}$/.test(name)) fail('Name: 3–16 Zeichen (Buchstaben, Zahlen, _ -).');
  if (String(pass || '').length < 4) fail('Passwort: mindestens 4 Zeichen.');
  const key = name.toLowerCase();
  if (db.users[key]) fail('Dieser Name ist bereits vergeben.');

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pass), salt, 32).toString('hex');
  const village = createVillage(name);
  db.users[key] = {
    name, salt, hash,
    created: Date.now(),
    villageId: village.id,
    allianceId: null,
    reports: [],
    lastSeen: Date.now(),
  };
  return login(name, pass);
}

export function login(name, pass) {
  const user = db.users[String(name || '').trim().toLowerCase()];
  if (!user) fail('Unbekannter Spielername.');
  const hash = crypto.scryptSync(String(pass || ''), user.salt, 32).toString('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.hash))) fail('Falsches Passwort.');
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = { user: user.name.toLowerCase(), exp: Date.now() + TOKEN_TTL_MS };
  return { token, name: user.name };
}

export function logout(token) { delete db.tokens[token]; }

export function authUser(token) {
  const t = db.tokens[token];
  if (!t || t.exp < Date.now()) { if (t) delete db.tokens[token]; return null; }
  const user = db.users[t.user];
  if (user) user.lastSeen = Date.now();
  return user || null;
}

// ---------------- Dorf & Welt ----------------

function createVillage(ownerName) {
  const id = nextId('v');
  const [x, y] = findFreeTile();
  const village = {
    id, owner: ownerName.toLowerCase(),
    name: `${ownerName}s Dorf`,
    x, y,
    res: { holz: 650, stein: 650, eisen: 500 },
    lastUpdate: Date.now(),
    buildings: { rathaus: 1, holz: 1, stein: 1, eisen: 1, lager: 1, farm: 1, kaserne: 0, markt: 0, mauer: 0 },
    units: { speer: 0, bogen: 0, spaeher: 0, schwert: 0, axt: 0, reiter: 0, wache: 0, ramme: 0, paladin: 0 },
    queue: [],       // Bauaufträge: { b, toLevel, done }
    trainQueue: [],  // Ausbildung:  { unit, count, done }
    protectedUntil: Date.now() + PROTECTION_MS,
  };
  db.villages[id] = village;
  db.world[`${x},${y}`] = id;
  return village;
}

// Platziert neue Dörfer in wachsenden Ringen um das Kartenzentrum
function findFreeTile() {
  const c = Math.floor(WORLD_SIZE / 2);
  const count = Object.keys(db.villages).length;
  let radius = 2 + Math.floor(Math.sqrt(count + 1) * 1.8);
  for (let attempt = 0; attempt < 500; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.5 + Math.random() * 0.7);
    const x = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(c + Math.cos(a) * r)));
    const y = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(c + Math.sin(a) * r)));
    if (!db.world[`${x},${y}`]) return [x, y];
    if (attempt % 50 === 49) radius += 2;
  }
  fail('Kein freier Bauplatz gefunden.');
}

// Zentrale Lazy-Simulation: verstrichene Zeit auf ein Dorf anwenden.
// Produziert segmentweise, damit ein zwischenzeitlich fertiggestellter
// Minen-Ausbau ab seinem Fertigstellungszeitpunkt korrekt mitproduziert.
export function touchVillage(v, now = Date.now()) {
  const finishedBuilds = v.queue.filter(q => q.done <= now).sort((a, b) => a.done - b.done);
  let t = v.lastUpdate;
  for (const q of finishedBuilds) {
    produceSpan(v, t, q.done);
    v.buildings[q.b] = q.toLevel;
    t = q.done;
  }
  v.queue = v.queue.filter(q => q.done > now);
  produceSpan(v, t, now);
  v.lastUpdate = now;

  const finishedTrainings = v.trainQueue.filter(q => q.done <= now);
  for (const q of finishedTrainings) v.units[q.unit] = (v.units[q.unit] || 0) + q.count;
  v.trainQueue = v.trainQueue.filter(q => q.done > now);
}

function produceSpan(v, from, to) {
  if (to <= from) return;
  const hours = (to - from) / 3_600_000;
  const cap = storageCap(v.buildings.lager);
  for (const r of RES) {
    v.res[r] = Math.min(cap, v.res[r] + prodPerHour(v.buildings[r]) * hours);
  }
}

function canAfford(v, cost) { return RES.every(r => v.res[r] >= cost[r]); }
function pay(v, cost) { for (const r of RES) v.res[r] -= cost[r]; }
function refund(v, cost) {
  const cap = storageCap(v.buildings.lager);
  for (const r of RES) v.res[r] = Math.min(cap, v.res[r] + cost[r]);
}

// Versorgung: stationierte + in Ausbildung + unterwegs befindliche Truppen
function popUsed(v) {
  let pop = 0;
  for (const [k, n] of Object.entries(v.units)) pop += (UNITS[k]?.up || 0) * n;
  for (const q of v.trainQueue) pop += UNITS[q.unit].up * q.count;
  for (const ev of db.events) {
    if ((ev.type === 'attack' && ev.from === v.id) || (ev.type === 'return' && ev.to === v.id)) {
      for (const [k, n] of Object.entries(ev.units)) pop += (UNITS[k]?.up || 0) * n;
    }
  }
  return pop;
}

// Aktuell auf Sammelmissionen (hin, arbeitend oder zurück) gebundene Bewohner.
function residentsBusy(v) {
  let busy = 0;
  for (const ev of db.events) {
    if ((ev.type === 'gather' || ev.type === 'gatherReturn') && ev.village === v.id) {
      busy += ev.workers || 0;
    }
  }
  return busy;
}

// ---------------- Bauen & Ausbilden ----------------

// Prüft die Freischalt-Bedingungen (z. B. { rathaus: 2 }) gegen die Dorfstufen.
// Liefert das erste unerfüllte Kriterium { b, lvl } oder null, wenn alles passt.
function unmetRequirement(v, req) {
  if (!req) return null;
  for (const [b, lvl] of Object.entries(req)) {
    if ((v.buildings[b] || 0) < lvl) return { b, lvl };
  }
  return null;
}

// Menschlich lesbarer Freischalt-Hinweis, z. B. "Rathaus Stufe 2".
function requirementText(req) {
  if (!req) return null;
  return Object.entries(req)
    .map(([b, lvl]) => `${BUILDINGS[b]?.name || b} Stufe ${lvl}`)
    .join(', ');
}

export function build(user, key) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  const def = BUILDINGS[key] || fail('Unbekanntes Gebäude.');
  const req = unmetRequirement(v, def.req);
  if (req) fail(`Benötigt ${BUILDINGS[req.b]?.name || req.b} Stufe ${req.lvl}.`);
  if (v.queue.length >= MAX_BUILD_QUEUE) fail(`Maximal ${MAX_BUILD_QUEUE} Bauaufträge gleichzeitig.`);
  const pending = v.queue.filter(q => q.b === key).length;
  const toLevel = v.buildings[key] + pending + 1;
  if (toLevel > def.max) fail(`${def.name} ist bereits auf Maximalstufe.`);
  const cost = buildCost(key, toLevel);
  if (!canAfford(v, cost)) fail('Nicht genügend Rohstoffe.');
  pay(v, cost);
  const start = v.queue.length ? Math.max(...v.queue.map(q => q.done)) : Date.now();
  v.queue.push({ b: key, toLevel, done: start + buildTimeMs(key, toLevel, v.buildings.rathaus) });
}

// Gebäude eine Stufe zurückbauen und die Hälfte der für diese Stufe
// ausgegebenen Rohstoffe erstatten (sofort, keine Bauzeit).
export function demolish(user, key) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  const def = BUILDINGS[key] || fail('Unbekanntes Gebäude.');
  if (v.queue.some(q => q.b === key)) fail('Für dieses Gebäude läuft bereits ein Bauauftrag.');
  const level = v.buildings[key];
  if (level <= 0) fail(`${def.name} ist bereits abgerissen.`);
  if (key === 'rathaus' && level <= 1) fail('Das Rathaus kann nicht vollständig abgerissen werden.');
  const cost = buildCost(key, level);
  const gain = {};
  for (const r of RES) gain[r] = Math.floor(cost[r] / 2);
  v.buildings[key] = level - 1;
  refund(v, gain);
  return gain;
}

export function train(user, unitKey, count) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  const def = UNITS[unitKey] || fail('Unbekannte Einheit.');
  count = Math.floor(Number(count));
  if (!(count >= 1 && count <= 500)) fail('Anzahl muss zwischen 1 und 500 liegen.');
  if (v.buildings.kaserne < 1) fail('Du brauchst zuerst eine Kaserne.');
  const req = unmetRequirement(v, def.req);
  if (req) fail(`Benötigt ${BUILDINGS[req.b]?.name || req.b} Stufe ${req.lvl}.`);
  if (v.trainQueue.length >= MAX_TRAIN_QUEUE) fail(`Maximal ${MAX_TRAIN_QUEUE} Ausbildungsaufträge.`);
  if (popUsed(v) + def.up * count > popCap(v.buildings.farm)) fail('Zu wenig Versorgung — baue den Bauernhof aus.');
  const cost = {};
  for (const r of RES) cost[r] = def.cost[r] * count;
  if (!canAfford(v, cost)) fail('Nicht genügend Rohstoffe.');
  pay(v, cost);
  const start = v.trainQueue.length ? Math.max(...v.trainQueue.map(q => q.done)) : Date.now();
  v.trainQueue.push({ unit: unitKey, count, done: start + trainTimeMs(unitKey, count, v.buildings.kaserne) });
}

// ---------------- Angriffe & Kampf ----------------

export function attack(user, x, y, unitCounts) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  const targetId = db.world[`${x},${y}`] || fail('Dort liegt kein Dorf.');
  if (targetId === v.id) fail('Du kannst dich nicht selbst angreifen.');
  const target = db.villages[targetId];
  const defender = db.users[target.owner];
  if (user.allianceId && defender.allianceId === user.allianceId) fail('Allianzmitglieder können nicht angegriffen werden.');
  touchVillage(target);
  if (target.protectedUntil > Date.now()) fail('Dieser Spieler steht noch unter Anfängerschutz.');

  const units = {};
  let total = 0;
  for (const [k, def] of Object.entries(UNITS)) {
    if (def.scout) continue; // Späher greifen nicht an – dafür gibt es die Spähen-Mission
    const n = Math.max(0, Math.floor(Number(unitCounts?.[k] || 0)));
    if (n > (v.units[k] || 0)) fail(`Nicht genügend ${def.name}.`);
    if (n > 0) { units[k] = n; total += n; }
  }
  if (total === 0) fail('Wähle mindestens eine Kampfeinheit.');

  for (const [k, n] of Object.entries(units)) v.units[k] -= n;
  v.protectedUntil = 0; // Wer angreift, verliert seinen Anfängerschutz

  const dist = Math.hypot(v.x - target.x, v.y - target.y);
  const start = Date.now();
  const at = start + travelTimeMs(dist, units);
  db.events.push({ id: nextId('e'), type: 'attack', at, start, from: v.id, to: target.id, units });
  return { arrival: at };
}

// Späher losschicken, um Rohstoffe und Truppen des Ziels auszukundschaften
export function scout(user, x, y, count) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  const targetId = db.world[`${x},${y}`] || fail('Dort liegt kein Dorf.');
  if (targetId === v.id) fail('Du kannst dein eigenes Dorf nicht ausspähen.');
  const target = db.villages[targetId];
  const defender = db.users[target.owner];
  if (user.allianceId && defender.allianceId === user.allianceId) fail('Allianzmitglieder können nicht ausgespäht werden.');
  touchVillage(target);
  if (target.protectedUntil > Date.now()) fail('Dieser Spieler steht noch unter Anfängerschutz.');

  const n = Math.max(0, Math.floor(Number(count || 0)));
  if (n === 0) fail('Wähle mindestens einen Späher.');
  if (n > (v.units.spaeher || 0)) fail('Nicht genügend Späher.');

  v.units.spaeher -= n;
  const units = { spaeher: n };
  const dist = Math.hypot(v.x - target.x, v.y - target.y);
  const start = Date.now();
  const at = start + travelTimeMs(dist, units);
  db.events.push({ id: nextId('e'), type: 'scout', at, start, from: v.id, to: target.id, units });
  return { arrival: at };
}

// Bewohner auf ein Rohstoffvorkommen der Weltkarte schicken.
// Sie reisen hin, sammeln (gatherWorkMs) und kehren mit Rohstoffen zurück.
export function gather(user, x, y, workers) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  x = Math.floor(Number(x)); y = Math.floor(Number(y));
  const node = resourceNodeAt(x, y);
  if (!node || db.world[`${x},${y}`]) fail('Dort gibt es kein Rohstoffvorkommen.');
  workers = Math.floor(Number(workers));
  if (!(workers >= 1)) fail('Wähle mindestens einen Bewohner.');
  const idle = residentsCap(v.buildings.rathaus) - residentsBusy(v);
  if (workers > idle) fail(`Nur ${Math.max(0, idle)} Bewohner verfügbar.`);

  const dist = Math.hypot(v.x - x, v.y - y);
  const travel = gatherTravelMs(dist);
  const start = Date.now();
  const at = start + travel + gatherWorkMs();
  db.events.push({
    id: nextId('e'), type: 'gather', at, start, village: v.id,
    x, y, res: node.res, richness: node.richness, workers, travel,
  });
  return { arrival: at };
}

// Vom Sekunden-Tick aufgerufen: fällige Events abarbeiten (auch Nachholbedarf nach Neustart)
export function processEvents(now = Date.now()) {
  const due = db.events.filter(e => e.at <= now).sort((a, b) => a.at - b.at);
  if (!due.length) return;
  db.events = db.events.filter(e => e.at > now);
  for (const ev of due) {
    if (ev.type === 'attack') resolveAttack(ev, now);
    else if (ev.type === 'scout') resolveScout(ev, now);
    else if (ev.type === 'return') resolveReturn(ev);
    else if (ev.type === 'gather') resolveGather(ev, now);
    else if (ev.type === 'gatherReturn') resolveGatherReturn(ev);
  }
}

function resolveAttack(ev, now) {
  const av = db.villages[ev.from];
  const dv = db.villages[ev.to];
  if (!av || !dv) return;
  touchVillage(av, now); touchVillage(dv, now);

  let atk = 0;
  for (const [k, n] of Object.entries(ev.units)) atk += UNITS[k].off * n;
  let defPower = 20; // Grundverteidigung des Dorfes
  for (const [k, n] of Object.entries(dv.units)) defPower += UNITS[k].def * n;
  defPower *= 1 + 0.06 * dv.buildings.mauer;

  const ratio = atk / defPower;
  const atkLossFrac = Math.min(1, Math.pow(1 / ratio, 1.5));
  const defLossFrac = Math.min(1, Math.pow(ratio, 1.5));

  const atkLost = {}, defLost = {}, survivors = {};
  for (const [k, n] of Object.entries(ev.units)) {
    atkLost[k] = Math.min(n, Math.round(n * atkLossFrac));
    if (n - atkLost[k] > 0) survivors[k] = n - atkLost[k];
  }
  for (const [k, n] of Object.entries(dv.units)) {
    defLost[k] = Math.min(n, Math.round(n * defLossFrac));
    dv.units[k] -= defLost[k];
  }

  // Beute: Überlebende plündern, begrenzt durch Tragekapazität
  const loot = { holz: 0, stein: 0, eisen: 0 };
  const won = ratio > 1;
  let capacity = 0;
  for (const [k, n] of Object.entries(survivors)) capacity += UNITS[k].carry * n;
  if (won) {
    const avail = RES.map(r => Math.floor(dv.res[r]));
    const totalAvail = avail.reduce((a, b) => a + b, 0);
    const take = Math.min(capacity, totalAvail);
    if (take > 0 && totalAvail > 0) {
      RES.forEach((r, i) => {
        loot[r] = Math.floor(take * (avail[i] / totalAvail));
        dv.res[r] -= loot[r];
      });
    }
  }

  const report = {
    time: now, kind: 'Kampf',
    attacker: { name: db.users[av.owner].name, village: av.name, x: av.x, y: av.y, sent: ev.units, lost: atkLost, power: Math.round(atk) },
    defender: { name: db.users[dv.owner].name, village: dv.name, x: dv.x, y: dv.y, had: unitsSnapshotBefore(dv, defLost), lost: defLost, power: Math.round(defPower), wall: dv.buildings.mauer },
    won, loot, capacity,
  };
  addReport(db.users[av.owner], { ...report, title: won ? `Sieg gegen ${dv.name}` : `Niederlage gegen ${dv.name}` });
  addReport(db.users[dv.owner], { ...report, title: won ? `${av.name} hat dich geplündert!` : `Angriff von ${av.name} abgewehrt` });

  if (won) questStat(db.users[av.owner], 'attacksWon', 1);

  if (Object.keys(survivors).length) {
    const back = travelTimeMs(Math.hypot(av.x - dv.x, av.y - dv.y), survivors);
    db.events.push({ id: nextId('e'), type: 'return', at: now + back, start: now, from: dv.id, to: av.id, units: survivors, loot });
  }
}

function resolveScout(ev, now) {
  const av = db.villages[ev.from];
  const dv = db.villages[ev.to];
  if (!av || !dv) return;
  touchVillage(av, now); touchVillage(dv, now);

  const sent = ev.units.spaeher || 0;
  const defScouts = dv.units.spaeher || 0;

  // Verteidiger-Späher fangen einfallende Späher ab (im Vorteil).
  let lost = 0, success = true, detected = false;
  if (defScouts > 0) {
    detected = true;
    const ratio = sent / (defScouts * 1.5);
    success = ratio >= 1; // Nur bei Übermacht dringen Späher durch und liefern Infos
    const lossFrac = Math.min(1, Math.pow(1 / Math.max(ratio, 0.05), 1.2));
    lost = Math.min(sent, Math.round(sent * lossFrac));
    // Der Verteidiger verliert beim Abfangen selbst ein paar Späher
    const defLoss = Math.min(defScouts, Math.round(defScouts * Math.min(1, Math.pow(ratio, 1.2)) * 0.5));
    dv.units.spaeher -= defLoss;
  }
  const survivors = sent - lost;

  const intel = success
    ? {
        res: Object.fromEntries(RES.map(r => [r, Math.floor(dv.res[r])])),
        units: unitsSnapshotBefore(dv, {}),
        wall: dv.buildings.mauer,
        storage: storageCap(dv.buildings.lager),
      }
    : null;

  const report = {
    time: now, kind: 'Spionage',
    attacker: { name: db.users[av.owner].name, village: av.name, x: av.x, y: av.y, sent: { spaeher: sent }, lost: { spaeher: lost } },
    defender: { name: db.users[dv.owner].name, village: dv.name, x: dv.x, y: dv.y },
    success, detected, intel,
  };
  addReport(db.users[av.owner], {
    ...report,
    title: success ? `Spähbericht: ${dv.name}` : `Späher bei ${dv.name} abgefangen`,
  });
  if (detected) {
    addReport(db.users[dv.owner], {
      ...report,
      title: success ? `${av.name} hat dich ausspioniert!` : `Feindliche Späher abgewehrt`,
    });
  }

  if (survivors > 0) {
    const back = travelTimeMs(Math.hypot(av.x - dv.x, av.y - dv.y), { spaeher: survivors });
    db.events.push({ id: nextId('e'), type: 'return', at: now + back, start: now, from: dv.id, to: av.id, units: { spaeher: survivors } });
  }
}

function unitsSnapshotBefore(dv, defLost) {
  const had = {};
  for (const [k, n] of Object.entries(dv.units)) {
    const before = n + (defLost[k] || 0);
    if (before > 0) had[k] = before;
  }
  return had;
}

function resolveReturn(ev) {
  const v = db.villages[ev.to];
  if (!v) return;
  touchVillage(v);
  for (const [k, n] of Object.entries(ev.units)) v.units[k] = (v.units[k] || 0) + n;
  if (ev.loot) {
    const cap = storageCap(v.buildings.lager);
    for (const r of RES) v.res[r] = Math.min(cap, v.res[r] + (ev.loot[r] || 0));
  }
}

// Bewohner sind am Vorkommen fertig: Ausbeute berechnen und Rückreise starten.
function resolveGather(ev, now) {
  const v = db.villages[ev.village];
  if (!v) return;
  touchVillage(v, now);
  const amount = gatherYield(ev.workers, ev.richness);
  const back = ev.travel || gatherTravelMs(Math.hypot(v.x - ev.x, v.y - ev.y));
  db.events.push({
    id: nextId('e'), type: 'gatherReturn', at: now + back, start: now, village: v.id,
    x: ev.x, y: ev.y, res: ev.res, workers: ev.workers, yield: amount,
  });
}

// Bewohner kehren heim: Rohstoffe ins Lager (durch Kapazität begrenzt), Arbeiter wieder frei.
function resolveGatherReturn(ev) {
  const v = db.villages[ev.village];
  if (!v) return;
  touchVillage(v);
  const cap = storageCap(v.buildings.lager);
  v.res[ev.res] = Math.min(cap, v.res[ev.res] + (ev.yield || 0));
  questStat(db.users[v.owner], 'gathered', ev.yield || 0);
}

function addReport(user, report) {
  user.reports.unshift({ id: nextId('r'), read: false, ...report });
  if (user.reports.length > MAX_REPORTS) user.reports.length = MAX_REPORTS;
}

// Momentaufnahme der Rohstoffe eines Dorfes (gerundet) für Berichte
function resSnapshot(v) {
  return Object.fromEntries(RES.map(r => [r, Math.floor(v.res[r])]));
}

// ---------------- Markt ----------------

export function marketCreate(user, give, want) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  if (v.buildings.markt < 1) fail('Du brauchst zuerst einen Marktplatz.');
  const mine = db.market.filter(o => o.seller === user.name.toLowerCase()).length;
  if (mine >= v.buildings.markt) fail(`Marktplatz Stufe ${v.buildings.markt}: max. ${v.buildings.markt} aktive Angebote.`);
  const g = { res: String(give?.res), amount: Math.floor(Number(give?.amount)) };
  const w = { res: String(want?.res), amount: Math.floor(Number(want?.amount)) };
  if (!RES.includes(g.res) || !RES.includes(w.res)) fail('Ungültiger Rohstoff.');
  if (g.res === w.res) fail('Biete und suche unterschiedliche Rohstoffe.');
  if (!(g.amount >= 1 && g.amount <= 100000) || !(w.amount >= 1 && w.amount <= 100000)) fail('Ungültige Menge.');
  if (v.res[g.res] < g.amount) fail('Nicht genügend Rohstoffe für dieses Angebot.');
  v.res[g.res] -= g.amount;
  db.market.push({ id: nextId('m'), seller: user.name.toLowerCase(), give: g, want: w, created: Date.now() });
}

export function marketAccept(user, offerId) {
  const idx = db.market.findIndex(o => o.id === offerId);
  if (idx === -1) fail('Angebot existiert nicht mehr.');
  const offer = db.market[idx];
  if (offer.seller === user.name.toLowerCase()) fail('Eigene Angebote kannst du nur zurückziehen.');
  const sellerUser = db.users[offer.seller];
  const buyer = db.villages[user.villageId];
  const seller = db.villages[sellerUser.villageId];
  touchVillage(buyer); touchVillage(seller);
  if (buyer.res[offer.want.res] < offer.want.amount) fail('Nicht genügend Rohstoffe zum Kauf.');
  buyer.res[offer.want.res] -= offer.want.amount;
  const capB = storageCap(buyer.buildings.lager);
  const capS = storageCap(seller.buildings.lager);
  // Tatsächlich gutgeschriebene Menge (Lager-Limit) für einen ehrlichen Bericht festhalten
  const buyerBefore = buyer.res[offer.give.res];
  const sellerBefore = seller.res[offer.want.res];
  buyer.res[offer.give.res] = Math.min(capB, buyer.res[offer.give.res] + offer.give.amount);
  seller.res[offer.want.res] = Math.min(capS, seller.res[offer.want.res] + offer.want.amount);
  const buyerGot = buyer.res[offer.give.res] - buyerBefore;
  const sellerGot = seller.res[offer.want.res] - sellerBefore;
  db.market.splice(idx, 1);

  // Handelsberichte für beide Seiten mit dem jeweils aktuellen Lagerbestand
  const now = Date.now();
  addReport(user, {
    time: now, kind: 'Handel', role: 'buyer',
    title: `Handel mit ${sellerUser.name}`,
    partner: { name: sellerUser.name, village: seller.name, x: seller.x, y: seller.y },
    received: { res: offer.give.res, amount: buyerGot, offered: offer.give.amount },
    paid: { res: offer.want.res, amount: offer.want.amount },
    stock: resSnapshot(buyer),
  });
  addReport(sellerUser, {
    time: now, kind: 'Handel', role: 'seller',
    title: `${user.name} nahm dein Angebot an`,
    partner: { name: user.name, village: buyer.name, x: buyer.x, y: buyer.y },
    received: { res: offer.want.res, amount: sellerGot, offered: offer.want.amount },
    paid: { res: offer.give.res, amount: offer.give.amount },
    stock: resSnapshot(seller),
  });
}

export function marketCancel(user, offerId) {
  const idx = db.market.findIndex(o => o.id === offerId && o.seller === user.name.toLowerCase());
  if (idx === -1) fail('Angebot nicht gefunden.');
  const offer = db.market[idx];
  const v = db.villages[user.villageId];
  touchVillage(v);
  refund(v, { holz: 0, stein: 0, eisen: 0, [offer.give.res]: offer.give.amount });
  db.market.splice(idx, 1);
}

export function marketList() {
  return db.market.map(o => ({
    id: o.id, seller: db.users[o.seller].name, give: o.give, want: o.want,
  }));
}

// ---------------- Allianzen ----------------

export function allianceCreate(user, tag, name) {
  if (user.allianceId) fail('Du bist bereits in einer Allianz.');
  tag = String(tag || '').trim(); name = String(name || '').trim();
  if (!/^[A-Za-z0-9]{2,5}$/.test(tag)) fail('Kürzel: 2–5 Buchstaben/Zahlen.');
  if (name.length < 3 || name.length > 30) fail('Name: 3–30 Zeichen.');
  if (Object.values(db.alliances).some(a => a.tag.toLowerCase() === tag.toLowerCase())) fail('Kürzel bereits vergeben.');
  const id = nextId('a');
  db.alliances[id] = { id, tag, name, leader: user.name.toLowerCase(), members: [user.name.toLowerCase()], created: Date.now() };
  user.allianceId = id;
}

export function allianceJoin(user, id) {
  if (user.allianceId) fail('Du bist bereits in einer Allianz.');
  const a = db.alliances[id] || fail('Allianz nicht gefunden.');
  a.members.push(user.name.toLowerCase());
  user.allianceId = id;
}

export function allianceLeave(user) {
  const a = db.alliances[user.allianceId] || fail('Du bist in keiner Allianz.');
  a.members = a.members.filter(m => m !== user.name.toLowerCase());
  user.allianceId = null;
  if (a.members.length === 0) delete db.alliances[a.id];
  else if (a.leader === user.name.toLowerCase()) a.leader = a.members[0];
}

export function allianceKick(user, memberName) {
  const a = db.alliances[user.allianceId] || fail('Du bist in keiner Allianz.');
  if (a.leader !== user.name.toLowerCase()) fail('Nur der Anführer kann Mitglieder entfernen.');
  const key = String(memberName || '').toLowerCase();
  if (key === a.leader) fail('Der Anführer kann sich nicht selbst entfernen — verlasse die Allianz.');
  if (!a.members.includes(key)) fail('Kein Mitglied dieser Allianz.');
  a.members = a.members.filter(m => m !== key);
  db.users[key].allianceId = null;
}

export function allianceInfo(user) {
  if (!user.allianceId) return null;
  const a = db.alliances[user.allianceId];
  return {
    id: a.id, tag: a.tag, name: a.name, leader: db.users[a.leader].name,
    members: a.members.map(m => {
      const u = db.users[m];
      const v = db.villages[u.villageId];
      touchVillage(v);
      return { name: u.name, points: villagePoints(v), x: v.x, y: v.y, online: Date.now() - u.lastSeen < 5 * 60_000 };
    }).sort((x, y) => y.points - x.points),
  };
}

export function allianceList() {
  return Object.values(db.alliances).map(a => ({
    id: a.id, tag: a.tag, name: a.name, memberCount: a.members.length,
    points: a.members.reduce((sum, m) => {
      const v = db.villages[db.users[m].villageId];
      touchVillage(v);
      return sum + villagePoints(v);
    }, 0),
  })).sort((x, y) => y.points - x.points);
}

// ---------------- Welt-Chat ----------------
// Ein globaler Kanal für alle Spieler. Nachrichten liegen in db.chat und
// werden auf MAX_CHAT begrenzt (älteste fallen raus).

export function postChat(user, text) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) fail('Leere Nachricht.');
  if (text.length > 240) fail('Nachricht: höchstens 240 Zeichen.');
  const msg = { id: nextId('c'), from: user.name, text, time: Date.now() };
  db.chat.push(msg);
  if (db.chat.length > MAX_CHAT) db.chat.splice(0, db.chat.length - MAX_CHAT);
  return msg;
}

export function getChat() {
  return { messages: db.chat, serverTime: Date.now() };
}

// ---------------- Freunde & Freundschaftsanfragen ----------------
// db.friends: nameLower -> [nameLower] (beidseitig gepflegt).
// db.friendRequests: offene Anfragen { id, from, to, fromName, toName, time }.
const ONLINE_MS = 5 * 60 * 1000;   // als „online" gilt, wer < 5 min aktiv war
const MAX_FRIEND_REQUESTS = 50;    // Spam-Schutz je Absender

function addFriendPair(a, b) {
  db.friends[a] = db.friends[a] || [];
  db.friends[b] = db.friends[b] || [];
  if (!db.friends[a].includes(b)) db.friends[a].push(b);
  if (!db.friends[b].includes(a)) db.friends[b].push(a);
}

export function sendFriendRequest(user, targetName) {
  const key = user.name.toLowerCase();
  const tKey = String(targetName || '').trim().toLowerCase();
  if (!tKey) fail('Kein Spieler angegeben.');
  if (tKey === key) fail('Du kannst dir nicht selbst eine Anfrage schicken.');
  const target = db.users[tKey];
  if (!target) fail('Unbekannter Spielername.');
  if ((db.friends[key] || []).includes(tKey)) fail('Ihr seid bereits Freunde.');
  if (db.friendRequests.some(r => r.from === key && r.to === tKey)) fail('Deine Anfrage läuft bereits.');
  // Gegenseitige Anfrage? Dann direkt als angenommen behandeln.
  const incoming = db.friendRequests.find(r => r.from === tKey && r.to === key);
  if (incoming) return acceptFriendRequest(user, incoming.id);
  if (db.friendRequests.filter(r => r.from === key).length >= MAX_FRIEND_REQUESTS) {
    fail('Zu viele offene Anfragen.');
  }
  db.friendRequests.push({
    id: nextId('fr'), from: key, to: tKey,
    fromName: user.name, toName: target.name, time: Date.now(),
  });
  return friendData(user);
}

export function acceptFriendRequest(user, id) {
  const key = user.name.toLowerCase();
  const idx = db.friendRequests.findIndex(r => r.id === id && r.to === key);
  if (idx < 0) fail('Anfrage nicht gefunden.');
  const req = db.friendRequests[idx];
  db.friendRequests.splice(idx, 1);
  addFriendPair(req.from, req.to);
  return friendData(user);
}

export function declineFriendRequest(user, id) {
  const key = user.name.toLowerCase();
  // Empfänger lehnt ab oder Absender zieht die Anfrage zurück.
  const idx = db.friendRequests.findIndex(r => r.id === id && (r.to === key || r.from === key));
  if (idx < 0) fail('Anfrage nicht gefunden.');
  db.friendRequests.splice(idx, 1);
  return friendData(user);
}

export function removeFriend(user, targetName) {
  const key = user.name.toLowerCase();
  const tKey = String(targetName || '').trim().toLowerCase();
  db.friends[key] = (db.friends[key] || []).filter(f => f !== tKey);
  db.friends[tKey] = (db.friends[tKey] || []).filter(f => f !== key);
  return friendData(user);
}

export function friendData(user) {
  const key = user.name.toLowerCase();
  const now = Date.now();
  const friends = (db.friends[key] || []).map(fk => {
    const u = db.users[fk];
    if (!u) return null;
    const v = db.villages[u.villageId];
    if (v) touchVillage(v, now);
    const a = u.allianceId ? db.alliances[u.allianceId] : null;
    return {
      name: u.name,
      alliance: a ? a.tag : null,
      points: v ? villagePoints(v) : 0,
      x: v ? v.x : null, y: v ? v.y : null,
      online: now - (u.lastSeen || 0) < ONLINE_MS,
      lastSeen: u.lastSeen || 0,
    };
  }).filter(Boolean).sort((x, y) => y.points - x.points);
  const incoming = db.friendRequests
    .filter(r => r.to === key)
    .map(r => ({ id: r.id, name: r.fromName, time: r.time }));
  const outgoing = db.friendRequests
    .filter(r => r.from === key)
    .map(r => ({ id: r.id, name: r.toName, time: r.time }));
  return { friends, incoming, outgoing, serverTime: now };
}

// ---------------- Aufträge (Quests) & Spielerstufe ----------------
// Fortschritt wird größtenteils aus dem aktuellen Dorfzustand abgeleitet
// (Gebäudestufen, Truppen, Punkte). Kumulative Ziele (gewonnene Angriffe,
// gesammelte Rohstoffe) zählen wir in user.stats über die Event-Auflösung.

// Fehlende Felder für Alt-Accounts ergänzen (keine DB-Migration nötig).
function ensureQuestFields(user) {
  if (!user) return null;
  if (typeof user.xp !== 'number') user.xp = 0;
  if (!Array.isArray(user.questsClaimed)) user.questsClaimed = [];
  if (!user.stats || typeof user.stats !== 'object') user.stats = {};
  if (typeof user.stats.attacksWon !== 'number') user.stats.attacksWon = 0;
  if (typeof user.stats.gathered !== 'number') user.stats.gathered = 0;
  return user;
}

// Kumulative Kennzahl erhöhen (aus resolveAttack/resolveGatherReturn).
function questStat(user, key, amount) {
  if (!user || !amount) return;
  ensureQuestFields(user);
  user.stats[key] = (user.stats[key] || 0) + amount;
}

// Aktueller Ist-Wert einer Auftragskennzahl für Dorf v / Spieler user.
function questCurrent(user, v, metric) {
  switch (metric.kind) {
    case 'building':   return v.buildings[metric.key] || 0;
    case 'unit':       return v.units[metric.key] || 0;
    case 'units':      return Object.values(v.units).reduce((a, b) => a + b, 0);
    case 'points':     return villagePoints(v);
    case 'pop':        return popUsed(v);
    case 'residents':  return residentsCap(v.buildings.rathaus);
    case 'attacksWon': return user.stats.attacksWon || 0;
    case 'gathered':   return user.stats.gathered || 0;
    default:           return 0;
  }
}

// Kurzfassung für /api/state (Header-Stufe + Badge für abholbare Aufträge).
function questSummary(user, v) {
  ensureQuestFields(user);
  const { level, into, need } = levelForXp(user.xp);
  let claimable = 0;
  for (const q of QUESTS) {
    if (user.questsClaimed.includes(q.id)) continue;
    if (level < q.reqLevel) continue;
    if (questCurrent(user, v, q.metric) >= q.metric.target) claimable++;
  }
  return { level, xp: user.xp, into, need, claimable };
}

// Vollständige Auftragsliste inkl. Fortschritt (für den Aufträge-Tab).
export function getQuests(user) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  ensureQuestFields(user);
  const { level, into, need } = levelForXp(user.xp);

  const quests = QUESTS.map(q => {
    const claimed = user.questsClaimed.includes(q.id);
    const locked = level < q.reqLevel;
    const cur = Math.min(questCurrent(user, v, q.metric), q.metric.target);
    const done = cur >= q.metric.target;
    return {
      id: q.id, name: q.name, desc: q.desc,
      reqLevel: q.reqLevel, xp: q.xp, reward: q.reward,
      current: cur, target: q.metric.target,
      claimed, locked,
      claimable: done && !claimed && !locked,
    };
  });

  return {
    level, xp: user.xp, into, need, nextLevelXp: xpToNext(level),
    claimed: user.questsClaimed.length, total: QUESTS.length,
    quests,
  };
}

// Belohnung eines erfüllten Auftrags abholen: Rohstoffe gutschreiben, XP addieren.
export function claimQuest(user, id) {
  const v = db.villages[user.villageId];
  touchVillage(v);
  ensureQuestFields(user);
  const q = QUESTS.find(x => x.id === id) || fail('Unbekannter Auftrag.');
  if (user.questsClaimed.includes(q.id)) fail('Dieser Auftrag wurde bereits abgeschlossen.');
  const { level } = levelForXp(user.xp);
  if (level < q.reqLevel) fail(`Erst ab Stufe ${q.reqLevel} verfügbar.`);
  if (questCurrent(user, v, q.metric) < q.metric.target) fail('Das Ziel ist noch nicht erreicht.');

  const before = levelForXp(user.xp).level;
  user.questsClaimed.push(q.id);
  user.xp += q.xp;
  const after = levelForXp(user.xp).level;

  const cap = storageCap(v.buildings.lager);
  const gained = {};
  for (const r of RES) {
    const add = q.reward[r] || 0;
    const room = Math.max(0, cap - v.res[r]);
    gained[r] = Math.min(add, room);
    v.res[r] = Math.min(cap, v.res[r] + add);
  }
  return { ...getQuests(user), gained, xpGained: q.xp, leveledUp: after > before, newLevel: after };
}

// ---------------- Karte, Rangliste, State ----------------

export function mapView(cx, cy, radius = 6) {  const tiles = [];
  for (const [key, vid] of Object.entries(db.world)) {
    const [x, y] = key.split(',').map(Number);
    if (Math.abs(x - cx) > radius || Math.abs(y - cy) > radius) continue;
    const v = db.villages[vid];
    const owner = db.users[v.owner];
    const alliance = owner.allianceId ? db.alliances[owner.allianceId] : null;
    touchVillage(v);
    tiles.push({
      x, y, village: v.name, owner: owner.name,
      alliance: alliance ? alliance.tag : null,
      points: villagePoints(v),
      protected: v.protectedUntil > Date.now(),
    });
  }
  // Rohstoffvorkommen im Sichtfenster (nur auf freien Feldern) mitliefern.
  const nodes = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (db.world[`${x},${y}`]) continue;
      const node = resourceNodeAt(x, y);
      if (node) nodes.push({ x, y, res: node.res, richness: node.richness });
    }
  }
  return { villages: tiles, nodes };
}

export function ranking() {
  return Object.values(db.users).map(u => {
    const v = db.villages[u.villageId];
    touchVillage(v);
    const a = u.allianceId ? db.alliances[u.allianceId] : null;
    return { name: u.name, alliance: a ? a.tag : null, points: villagePoints(v), x: v.x, y: v.y };
  }).sort((x, y) => y.points - x.points).slice(0, 100);
}

// Menschlich lesbare Wirkung einer Gebäudestufe (fürs UI, Formeln bleiben serverseitig)
function buildingEffect(key, level) {
  switch (key) {
    case 'holz': case 'stein': case 'eisen': return `${prodPerHour(level)}/h`;
    case 'lager': return `${storageCap(level)} Kapazität`;
    case 'farm': return `${popCap(level)} Versorgung`;
    case 'rathaus': return `−${Math.round((1 - 1 / (1 + 0.04 * level)) * 100)} % Bauzeit · ${residentsCap(level)} Bewohner`;
    case 'kaserne': return level < 1 ? 'schaltet Ausbildung frei' : `−${Math.round((1 - 1 / (1 + 0.10 * (level - 1))) * 100)} % Ausbildungszeit`;
    case 'markt': return level < 1 ? 'schaltet Handel frei' : `${level} aktive Angebote`;
    case 'mauer': return `+${6 * level} % Verteidigung`;
    default: return '';
  }
}

export function getState(user) {
  const v = db.villages[user.villageId];
  const now = Date.now();
  touchVillage(v, now);

  const buildings = {};
  for (const [k, def] of Object.entries(BUILDINGS)) {
    const pending = v.queue.filter(q => q.b === k).length;
    const toLevel = v.buildings[k] + pending + 1;
    const canDemo = v.buildings[k] > 0 && !(k === 'rathaus' && v.buildings[k] <= 1) && pending === 0;
    const demoCost = canDemo ? buildCost(k, v.buildings[k]) : null;
    buildings[k] = {
      level: v.buildings[k],
      max: def.max,
      nextCost: toLevel <= def.max ? buildCost(k, toLevel) : null,
      nextTime: toLevel <= def.max ? buildTimeMs(k, toLevel, v.buildings.rathaus) : null,
      demoRefund: demoCost ? Object.fromEntries(RES.map(r => [r, Math.floor(demoCost[r] / 2)])) : null,
      effectNow: buildingEffect(k, v.buildings[k]),
      effectNext: toLevel <= def.max ? buildingEffect(k, toLevel) : null,
      req: def.req || null,
      locked: v.buildings[k] === 0 && !!unmetRequirement(v, def.req),
      reqText: requirementText(def.req),
    };
  }
  const unitsMeta = {};
  for (const [k, def] of Object.entries(UNITS)) {
    unitsMeta[k] = {
      count: v.units[k] || 0,
      cost: def.cost,
      time: trainTimeMs(k, 1, v.buildings.kaserne),
      req: def.req || null,
      locked: !!unmetRequirement(v, def.req),
      reqText: requirementText(def.req),
    };
  }

  const incoming = db.events
    .filter(e => e.type === 'attack' && e.to === v.id)
    .map(e => {
      const from = db.villages[e.from];
      // fromX/Y = Startdorf des Gegners, toX/Y = eigenes Dorf; start für die Karten-Interpolation
      return {
        type: 'attack', at: e.at, start: e.start || null,
        fromVillage: from.name, fromOwner: db.users[from.owner].name,
        x: from.x, y: from.y,
        fromX: from.x, fromY: from.y, toX: v.x, toY: v.y,
      };
    });
  const outgoing = db.events
    .filter(e => ((e.type === 'attack' || e.type === 'scout') && e.from === v.id) || (e.type === 'return' && e.to === v.id) || ((e.type === 'gather' || e.type === 'gatherReturn') && e.village === v.id))
    .map(e => {
      // Sammelmissionen laufen zwischen eigenem Dorf und einem Rohstoffvorkommen.
      if (e.type === 'gather' || e.type === 'gatherReturn') {
        const outbound = e.type === 'gather';
        return {
          type: e.type, at: e.at, start: e.start || null,
          workers: e.workers, res: e.res, yield: e.yield || null,
          target: e.res === 'holz' ? 'Wald' : e.res === 'stein' ? 'Steinbruch' : 'Eisenader',
          x: e.x, y: e.y,
          fromX: outbound ? v.x : e.x, fromY: outbound ? v.y : e.y,
          toX: outbound ? e.x : v.x, toY: outbound ? e.y : v.y,
        };
      }
      const other = db.villages[e.type === 'return' ? e.from : e.to];
      // Rückkehr läuft zum eigenen Dorf, Angriff/Spähen vom eigenen Dorf weg
      const fromX = e.type === 'return' ? other?.x : v.x;
      const fromY = e.type === 'return' ? other?.y : v.y;
      const toX = e.type === 'return' ? v.x : other?.x;
      const toY = e.type === 'return' ? v.y : other?.y;
      return {
        type: e.type, at: e.at, start: e.start || null, units: e.units, loot: e.loot || null,
        target: other ? other.name : '?', x: other?.x, y: other?.y,
        fromX, fromY, toX, toY,
      };
    });

  const alliance = user.allianceId ? db.alliances[user.allianceId] : null;
  return {
    serverTime: now,
    speed: SPEED,
    user: { name: user.name, allianceId: user.allianceId, allianceTag: alliance ? alliance.tag : null },
    village: {
      id: v.id, name: v.name, x: v.x, y: v.y,
      res: Object.fromEntries(RES.map(r => [r, Math.floor(v.res[r])])),
      rates: Object.fromEntries(RES.map(r => [r, prodPerHour(v.buildings[r])])),
      storage: storageCap(v.buildings.lager),
      pop: popUsed(v), popCap: popCap(v.buildings.farm),
      residents: (() => {
        const total = residentsCap(v.buildings.rathaus);
        const busy = residentsBusy(v);
        return { total, busy, idle: Math.max(0, total - busy) };
      })(),
      buildings, units: unitsMeta,
      queue: v.queue, trainQueue: v.trainQueue,
      protectedUntil: v.protectedUntil,
      points: villagePoints(v),
    },
    movements: { incoming, outgoing },
    unreadReports: user.reports.filter(r => !r.read).length,
    pendingFriendRequests: db.friendRequests.filter(r => r.to === user.name.toLowerCase()).length,
    quests: questSummary(user, v),
  };
}

export function getReports(user) {
  const out = user.reports.map(r => ({ ...r }));
  user.reports.forEach(r => { r.read = true; });
  return out;
}

// ---------------- Profil & Konto ----------------

export function getProfile(user) {
  const v = db.villages[user.villageId];
  const alliance = user.allianceId ? db.alliances[user.allianceId] : null;
  const wins = user.reports.filter(r => r.attacker?.name === user.name && r.won).length;
  return {
    name: user.name,
    created: user.created,
    lastSeen: user.lastSeen,
    reportCount: user.reports.length,
    attackWins: wins,
    village: { name: v.name, x: v.x, y: v.y, points: villagePoints(v) },
    alliance: alliance ? { tag: alliance.tag, name: alliance.name } : null,
  };
}

export function renameVillage(user, name) {
  name = String(name || '').trim();
  if (name.length < 3 || name.length > 30) fail('Dorfname: 3–30 Zeichen.');
  db.villages[user.villageId].name = name;
  return getProfile(user);
}

export function changePassword(user, oldPass, newPass) {
  const oldHash = crypto.scryptSync(String(oldPass || ''), user.salt, 32).toString('hex');
  if (!crypto.timingSafeEqual(Buffer.from(oldHash), Buffer.from(user.hash))) fail('Aktuelles Passwort ist falsch.');
  if (String(newPass || '').length < 4) fail('Neues Passwort: mindestens 4 Zeichen.');
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.hash = crypto.scryptSync(String(newPass), salt, 32).toString('hex');
  // Alle bestehenden Sessions dieses Kontos invalidieren
  for (const [tok, t] of Object.entries(db.tokens)) {
    if (t.user === user.name.toLowerCase()) delete db.tokens[tok];
  }
}
