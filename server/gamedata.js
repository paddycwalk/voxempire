// ============================================================
// VOXEMPIRE — Spieldaten & Balance
// Alle Formeln leben hier. Der Server rechnet damit autoritativ,
// der Client bekommt nur fertige Zahlen (via /api/meta + /api/state).
// ============================================================

// Welt-Geschwindigkeit: skaliert Produktion und teilt Bau-/Trainings-/Reisezeiten.
// Zum Testen z.B. mit  VOX_SPEED=50 node server.js  starten.
export const SPEED = Math.max(0.1, Number(process.env.VOX_SPEED || 3));

export const WORLD_SIZE = 101; // Karte 0..100, Zentrum 50/50
export const SAVE_INTERVAL_MS = 15_000; // Autosave-Intervall
// Anfängerschutz in Minuten (entfällt nur beim eigenen Angriff). Default: 24 h.
export const PROTECTION_MS =
  Number(process.env.VOX_PROTECTION_MIN ?? 1440) * 60_000;
export const TOKEN_TTL_MS = 30 * 24 * 3_600_000;
export const MAX_BUILD_QUEUE = 2;
export const MAX_TRAIN_QUEUE = 5;
export const MAX_REPORTS = 50;
export const MAX_CHAT = 100; // Anzahl gespeicherter Chat-Nachrichten (Welt-Chat)
// Maximale Mitgliederzahl je Allianz.
export const MAX_ALLIANCE_MEMBERS = 10;
// So oft muss ein Angriff mit überlebendem Paladin ein fremdes Dorf gewinnen,
// bis es „aufgeadelt" ist und den Besitzer wechselt (Travian-Adelung).
export const CONQUEST_ATTACKS = 3;

export const RES = ["holz", "stein", "eisen"];
export const RES_NAMES = { holz: "Holz", stein: "Stein", eisen: "Eisen" };

// ---------- Gebäude ----------
// cost = Basiskosten für Stufe 1, wächst mit 1.6^(stufe-1)
// time = Bauzeit Stufe 1 in Sekunden, wächst mit 1.5^(stufe-1)
export const BUILDINGS = {
  rathaus: {
    name: "Rathaus",
    desc: "Verkürzt alle Bauzeiten um 4 % pro Stufe.",
    cost: { holz: 120, stein: 140, eisen: 100 },
    time: 35,
    max: 20,
  },
  holz: {
    name: "Holzfällerlager",
    desc: "Produziert Holz.",
    cost: { holz: 45, stein: 70, eisen: 30 },
    time: 25,
    max: 25,
  },
  stein: {
    name: "Steinbruch",
    desc: "Produziert Stein.",
    cost: { holz: 70, stein: 45, eisen: 30 },
    time: 25,
    max: 25,
  },
  eisen: {
    name: "Eisenmine",
    desc: "Produziert Eisen.",
    cost: { holz: 60, stein: 60, eisen: 40 },
    time: 28,
    max: 25,
  },
  lager: {
    name: "Lager",
    desc: "Erhöht die Lagerkapazität aller Rohstoffe.",
    cost: { holz: 80, stein: 90, eisen: 50 },
    time: 30,
    max: 20,
  },
  farm: {
    name: "Bauernhof",
    desc: "Erhöht die Versorgung — bestimmt, wie viele Truppen du unterhalten kannst.",
    cost: { holz: 70, stein: 80, eisen: 30 },
    time: 30,
    max: 20,
  },
  kaserne: {
    name: "Kaserne",
    desc: "Ermöglicht Truppenausbildung, ‑10 % Ausbildungszeit pro Stufe.",
    cost: { holz: 150, stein: 160, eisen: 120 },
    time: 50,
    max: 15,
    req: { rathaus: 2 },
  },
  markt: {
    name: "Marktplatz",
    desc: "Schaltet Handel schrittweise frei: Stufe 1 Basar-Tausch (3:1) und Rohstoffversand an eigene Dörfer, Stufe 3 Welthandel, Stufe 5 Allianzhandel. Pro Stufe ein weiteres aktives Angebot.",
    cost: { holz: 130, stein: 110, eisen: 90 },
    time: 45,
    max: 10,
    req: { rathaus: 4 },
  },
  mauer: {
    name: "Stadtmauer",
    desc: "Erhöht die Verteidigung um 6 % pro Stufe.",
    cost: { holz: 50, stein: 140, eisen: 40 },
    time: 40,
    max: 20,
    req: { rathaus: 3 },
  },
};

// ---------- Marktplatz-Stufen ----------
// Jede Handelsfunktion wird erst ab einer bestimmten Marktplatz-Stufe
// freigeschaltet — so bekommt jeder Ausbau des Marktplatzes eine Bedeutung.
export const MARKET_TIERS = {
  // Ab Stufe 1: Basar-Soforttausch (3:1).
  exchange: 1,
  // Ab Stufe 1: Rohstoffe zwischen Dörfern senden UND empfangen.
  // Ein Dorf ohne Marktplatz kann keine Lieferungen annehmen.
  transfer: 1,
  // Ab Stufe 3: Welthandel — eigene Angebote erstellen und fremde annehmen.
  offers: 3,
  // Ab Stufe 5: Allianz-interne Angebote erstellen.
  alliance: 5,
};

// ---------- Einheiten ----------
// off/def = Kampfkraft, speed = Felder pro Stunde (vor SPEED),
// carry = Beutekapazität, up = Versorgung, time = Ausbildung/Einheit in Sekunden
export const UNITS = {
  speer: {
    name: "Speerträger",
    off: 15,
    def: 45,
    speed: 7,
    carry: 40,
    up: 1,
    cost: { holz: 50, stein: 35, eisen: 20 },
    time: 30,
    req: { kaserne: 1 },
  },
  bogen: {
    name: "Bogenschütze",
    off: 40,
    def: 20,
    speed: 9,
    carry: 30,
    up: 1,
    cost: { holz: 80, stein: 20, eisen: 40 },
    time: 38,
    req: { kaserne: 2 },
  },
  spaeher: {
    name: "Späher",
    off: 0,
    def: 8,
    speed: 20,
    carry: 0,
    up: 1,
    cost: { holz: 40, stein: 30, eisen: 50 },
    time: 40,
    scout: true,
    req: { kaserne: 2 },
  },
  schwert: {
    name: "Schwertkämpfer",
    off: 60,
    def: 25,
    speed: 6,
    carry: 30,
    up: 1,
    cost: { holz: 35, stein: 30, eisen: 75 },
    time: 45,
    req: { kaserne: 3 },
  },
  axt: {
    name: "Axtkämpfer",
    off: 85,
    def: 20,
    speed: 6,
    carry: 45,
    up: 1,
    cost: { holz: 90, stein: 30, eisen: 90 },
    time: 55,
    req: { kaserne: 4 },
  },
  reiter: {
    name: "Reiter",
    off: 100,
    def: 40,
    speed: 14,
    carry: 80,
    up: 3,
    cost: { holz: 120, stein: 90, eisen: 140 },
    time: 75,
    req: { kaserne: 5 },
  },
  wache: {
    name: "Panzerwache",
    off: 20,
    def: 100,
    speed: 5,
    carry: 20,
    up: 2,
    cost: { holz: 60, stein: 110, eisen: 90 },
    time: 65,
    req: { kaserne: 6 },
  },
  ramme: {
    name: "Belagerungsramme",
    off: 160,
    def: 55,
    speed: 4,
    carry: 0,
    up: 5,
    cost: { holz: 260, stein: 130, eisen: 200 },
    time: 120,
    req: { kaserne: 8 },
  },
  paladin: {
    name: "Paladin",
    off: 180,
    def: 120,
    speed: 12,
    carry: 100,
    up: 4,
    cost: { holz: 180, stein: 140, eisen: 260 },
    time: 140,
    conquer: true,
    req: { kaserne: 10 },
  },
};

// ---------- Formeln ----------
export function buildCost(key, toLevel) {
  const base = BUILDINGS[key].cost;
  const f = Math.pow(1.6, toLevel - 1);
  const out = {};
  for (const r of RES) out[r] = Math.round(base[r] * f);
  return out;
}

export function buildTimeMs(key, toLevel, rathausLevel) {
  const base = BUILDINGS[key].time * Math.pow(1.5, toLevel - 1);
  const bonus = 1 + 0.04 * (rathausLevel || 0);
  return Math.max(1000, Math.round((base / bonus / SPEED) * 1000));
}

// Produktion pro Stunde für eine Minen-Stufe
export function prodPerHour(level) {
  if (level <= 0) return 8 * SPEED;
  return Math.round(30 * level * Math.pow(1.16, level)) * SPEED;
}

export function storageCap(lagerLevel) {
  if (lagerLevel <= 0) return 600;
  return Math.round(1000 * Math.pow(1.55, lagerLevel - 1));
}

// Versorgung: wie viel Truppen-Unterhalt der Bauernhof trägt
export function popCap(farmLevel) {
  return 20 + 24 * farmLevel;
}

// ---------- Bewohner & Sammeln ----------
// Jedes Dorf hat Bewohner (Arbeiter) abhängig von der Rathausstufe.
// Freie Bewohner können auf Rohstoffvorkommen der Weltkarte geschickt
// werden (Wald → Holz, Steinbruch → Stein, Eisenader → Eisen). Sie
// reisen hin, sammeln eine Weile und kehren mit Rohstoffen zurück.
export const WORKER_SPEED = 6; // Felder/h (vor SPEED) – gemächlicher als Truppen
export const GATHER_WORK_MS = 15 * 60_000; // reine Sammelzeit am Vorkommen (vor SPEED)

// Gesamtzahl der Bewohner eines Dorfes nach Rathausstufe.
export function residentsCap(rathausLevel) {
  return 4 + 4 * (rathausLevel || 0);
}

// Gefallene Bewohner werden im Rathaus nachgezogen: 1 Stück je Intervall,
// bis wieder alle da sind. 5 Min vor SPEED (skaliert wie alle anderen Zeiten).
export const RESIDENT_REGEN_MS = 5 * 60_000;
export function residentRegenMs() {
  return Math.max(1000, Math.round(RESIDENT_REGEN_MS / SPEED));
}

// ---------- Räuberüberfälle am Vorkommen ----------
// Sammelmissionen können unterwegs von Räubern überfallen werden. Mitgeschickte
// Wachen (Truppen) verteidigen die Bewohner; sind sie zu schwach, sterben
// Bewohner (die dann im Rathaus regenerieren) und Wachen fallen.
export const GATHER_AMBUSH_CHANCE = 0.3; // Wahrscheinlichkeit eines Überfalls pro Mission
// Basis-/Ergiebigkeitsfaktor der Räuberstärke. Als Konstanten exportiert, damit
// der Client dieselbe Prognose (Erfolgschance im Sammel-Formular) rechnen kann.
export const BANDIT_BASE = 6;
export const BANDIT_PER_RICH = 5;
// Kampfkraft der Räuberbande – wächst mit Ergiebigkeit und Gruppengröße.
export function banditPower(richness, workers) {
  return Math.round(
    (BANDIT_BASE + BANDIT_PER_RICH * (richness || 1)) *
      Math.sqrt(Math.max(1, workers)),
  );
}

// Reisezeit der Arbeiter für eine Strecke (eine Richtung).
export function gatherTravelMs(dist) {
  return Math.max(
    1000,
    Math.round((dist / (WORKER_SPEED * SPEED)) * 3_600_000),
  );
}

// Reine Arbeitszeit am Vorkommen (unabhängig von der Entfernung).
export function gatherWorkMs() {
  return Math.max(1000, Math.round(GATHER_WORK_MS / SPEED));
}

// Ausbeute einer Sammelrunde: pro Arbeiter und Ergiebigkeit des Vorkommens.
export function gatherYield(workers, richness) {
  return Math.max(0, Math.round(workers * (richness || 1) * 12 * SPEED));
}

// Deterministisches Rauschen für die Platzierung der Vorkommen –
// gleiche Koordinate ergibt immer dasselbe Vorkommen (Server & Client
// sehen dieselbe Welt, da der Client die Knoten über /api/map bezieht).
function nodeHash(x, y) {
  const n = Math.sin((x + 1) * 91.73 + (y + 1) * 47.19) * 24634.6345;
  return n - Math.floor(n);
}

// Liefert das Rohstoffvorkommen auf Feld (x,y) oder null.
// { res: 'holz'|'stein'|'eisen', richness: 1..3 }
export function resourceNodeAt(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return null;
  if (nodeHash(x, y) > 0.16) return null; // ~16 % der Felder tragen ein Vorkommen
  const pick = nodeHash(x * 2.7 + 13, y * 1.3 + 41);
  const res = pick < 0.4 ? "holz" : pick < 0.72 ? "stein" : "eisen";
  const richness = 1 + Math.floor(nodeHash(x * 0.7 + 5, y * 3.9 + 8) * 3); // 1..3
  return { res, richness };
}

export function trainTimeMs(unitKey, count, kaserneLevel) {
  const per =
    UNITS[unitKey].time / (1 + 0.1 * Math.max(0, (kaserneLevel || 1) - 1));
  return Math.max(1000, Math.round(((per * count) / SPEED) * 1000));
}

// Reisezeit: Distanz / Geschwindigkeit der langsamsten Einheit
export function travelTimeMs(dist, unitCounts) {
  let slowest = Infinity;
  for (const [k, n] of Object.entries(unitCounts)) {
    if (n > 0 && UNITS[k]) slowest = Math.min(slowest, UNITS[k].speed);
  }
  if (!Number.isFinite(slowest)) slowest = 1;
  return Math.max(2000, Math.round((dist / (slowest * SPEED)) * 3_600_000));
}

// Geschwindigkeit der Handelskarren beim Rohstofftransport zwischen eigenen
// Dörfern (Felder pro Stunde, wie UNITS.speed).
export const MERCHANT_SPEED = 8;

export function transportTimeMs(dist) {
  return Math.max(
    2000,
    Math.round((dist / (MERCHANT_SPEED * SPEED)) * 3_600_000),
  );
}

export function villagePoints(village) {
  let p = 0;
  for (const lvl of Object.values(village.buildings)) {
    p += Math.round(10 * Math.pow(lvl, 1.4));
  }
  for (const n of Object.values(village.units)) p += n;
  return p;
}

// ---------- Aufträge (Quests) & Spielerstufe ----------
// Aufträge sind eine feste Kette. Jeder Auftrag prüft eine Kennzahl gegen
// einen Zielwert (metric.kind / key / target). Ist das Ziel erreicht, kann
// die Belohnung (Rohstoffe + XP) abgeholt werden. Gesammelte XP bestimmen
// die Spielerstufe; höhere Aufträge schalten sich erst ab einer Mindeststufe
// frei (metric-unabhängig über `reqLevel`).
//
// metric.kind:
//   'building'   Gebäudestufe von key   ≥ target
//   'units'      Gesamtzahl aller Truppen ≥ target
//   'unit'       Anzahl der Einheit key   ≥ target
//   'points'     Dorfpunkte               ≥ target
//   'pop'        belegte Versorgung       ≥ target
//   'residents'  Bewohner-Kapazität       ≥ target
//   'attacksWon' gewonnene Angriffe (Stat)≥ target
//   'gathered'   gesammelte Rohstoffe (Stat) ≥ target
export const QUESTS = [
  {
    id: "rathaus2",
    reqLevel: 1,
    name: "Sitz der Macht",
    desc: "Baue das Rathaus auf Stufe 2 aus.",
    metric: { kind: "building", key: "rathaus", target: 2 },
    xp: 15,
    reward: { holz: 150, stein: 150, eisen: 90 },
  },
  {
    id: "holz3",
    reqLevel: 1,
    name: "Holzwirtschaft",
    desc: "Bringe das Holzfällerlager auf Stufe 3.",
    metric: { kind: "building", key: "holz", target: 3 },
    xp: 20,
    reward: { holz: 250, stein: 120, eisen: 60 },
  },
  {
    id: "stein3",
    reqLevel: 1,
    name: "Fester Grund",
    desc: "Bringe den Steinbruch auf Stufe 3.",
    metric: { kind: "building", key: "stein", target: 3 },
    xp: 20,
    reward: { holz: 120, stein: 250, eisen: 60 },
  },
  {
    id: "eisen3",
    reqLevel: 1,
    name: "Erz in Strömen",
    desc: "Bringe die Eisenmine auf Stufe 3.",
    metric: { kind: "building", key: "eisen", target: 3 },
    xp: 20,
    reward: { holz: 120, stein: 120, eisen: 180 },
  },
  {
    id: "farm2",
    reqLevel: 1,
    name: "Volle Kornkammern",
    desc: "Baue den Bauernhof auf Stufe 2 aus.",
    metric: { kind: "building", key: "farm", target: 2 },
    xp: 15,
    reward: { holz: 150, stein: 120, eisen: 60 },
  },

  {
    id: "lager3",
    reqLevel: 2,
    name: "Volle Lager",
    desc: "Baue das Lager auf Stufe 3 aus.",
    metric: { kind: "building", key: "lager", target: 3 },
    xp: 25,
    reward: { holz: 300, stein: 300, eisen: 150 },
  },
  {
    id: "kaserne1",
    reqLevel: 2,
    name: "Zu den Waffen",
    desc: "Errichte eine Kaserne.",
    metric: { kind: "building", key: "kaserne", target: 1 },
    xp: 30,
    reward: { holz: 300, stein: 300, eisen: 250 },
  },
  {
    id: "army10",
    reqLevel: 2,
    name: "Erste Streitmacht",
    desc: "Unterhalte insgesamt 10 Truppen.",
    metric: { kind: "units", target: 10 },
    xp: 35,
    reward: { holz: 350, stein: 250, eisen: 300 },
  },
  {
    id: "gather400",
    reqLevel: 2,
    name: "Fleißige Hände",
    desc: "Sammle insgesamt 400 Rohstoffe mit Bewohnern.",
    metric: { kind: "gathered", target: 400 },
    xp: 30,
    reward: { holz: 250, stein: 250, eisen: 200 },
  },
  {
    id: "farm4",
    reqLevel: 2,
    name: "Ernährer des Dorfes",
    desc: "Baue den Bauernhof auf Stufe 4 aus.",
    metric: { kind: "building", key: "farm", target: 4 },
    xp: 30,
    reward: { holz: 300, stein: 250, eisen: 150 },
  },
  {
    id: "speer10",
    reqLevel: 2,
    name: "Speerspitze",
    desc: "Bilde 10 Speerträger aus.",
    metric: { kind: "unit", key: "speer", target: 10 },
    xp: 30,
    reward: { holz: 300, stein: 200, eisen: 250 },
  },

  {
    id: "mauer3",
    reqLevel: 3,
    name: "Trutzige Mauern",
    desc: "Baue die Stadtmauer auf Stufe 3.",
    metric: { kind: "building", key: "mauer", target: 3 },
    xp: 40,
    reward: { holz: 300, stein: 500, eisen: 200 },
  },
  {
    id: "attack1",
    reqLevel: 3,
    name: "Feuertaufe",
    desc: "Gewinne einen Angriff auf ein Dorf.",
    metric: { kind: "attacksWon", target: 1 },
    xp: 45,
    reward: { holz: 400, stein: 400, eisen: 400 },
  },
  {
    id: "points400",
    reqLevel: 3,
    name: "Aufstrebendes Dorf",
    desc: "Erreiche 400 Dorfpunkte.",
    metric: { kind: "points", target: 400 },
    xp: 40,
    reward: { holz: 400, stein: 400, eisen: 300 },
  },
  {
    id: "bogen10",
    reqLevel: 3,
    name: "Pfeilhagel",
    desc: "Bilde 10 Bogenschützen aus.",
    metric: { kind: "unit", key: "bogen", target: 10 },
    xp: 40,
    reward: { holz: 350, stein: 300, eisen: 350 },
  },
  {
    id: "gather1500",
    reqLevel: 3,
    name: "Reiche Ernte",
    desc: "Sammle insgesamt 1500 Rohstoffe mit Bewohnern.",
    metric: { kind: "gathered", target: 1500 },
    xp: 45,
    reward: { holz: 450, stein: 450, eisen: 350 },
  },

  {
    id: "markt1",
    reqLevel: 4,
    name: "Freier Handel",
    desc: "Errichte einen Marktplatz.",
    metric: { kind: "building", key: "markt", target: 1 },
    xp: 45,
    reward: { holz: 450, stein: 400, eisen: 350 },
  },
  {
    id: "army50",
    reqLevel: 4,
    name: "Stehendes Heer",
    desc: "Unterhalte insgesamt 50 Truppen.",
    metric: { kind: "units", target: 50 },
    xp: 60,
    reward: { holz: 600, stein: 500, eisen: 600 },
  },
  {
    id: "attack5",
    reqLevel: 4,
    name: "Kriegsherr",
    desc: "Gewinne 5 Angriffe.",
    metric: { kind: "attacksWon", target: 5 },
    xp: 70,
    reward: { holz: 700, stein: 700, eisen: 700 },
  },
  {
    id: "mauer6",
    reqLevel: 4,
    name: "Bollwerk",
    desc: "Baue die Stadtmauer auf Stufe 6.",
    metric: { kind: "building", key: "mauer", target: 6 },
    xp: 60,
    reward: { holz: 500, stein: 800, eisen: 350 },
  },
  {
    id: "reiter10",
    reqLevel: 4,
    name: "Berittene Elite",
    desc: "Bilde 10 Reiter aus.",
    metric: { kind: "unit", key: "reiter", target: 10 },
    xp: 65,
    reward: { holz: 600, stein: 500, eisen: 700 },
  },

  {
    id: "rathaus10",
    reqLevel: 5,
    name: "Metropole",
    desc: "Baue das Rathaus auf Stufe 10 aus.",
    metric: { kind: "building", key: "rathaus", target: 10 },
    xp: 100,
    reward: { holz: 1200, stein: 1200, eisen: 900 },
  },
  {
    id: "points1500",
    reqLevel: 5,
    name: "Regionalmacht",
    desc: "Erreiche 1500 Dorfpunkte.",
    metric: { kind: "points", target: 1500 },
    xp: 120,
    reward: { holz: 1500, stein: 1500, eisen: 1200 },
  },
  {
    id: "army100",
    reqLevel: 5,
    name: "Große Streitmacht",
    desc: "Unterhalte insgesamt 100 Truppen.",
    metric: { kind: "units", target: 100 },
    xp: 110,
    reward: { holz: 1200, stein: 1000, eisen: 1300 },
  },
  {
    id: "attack15",
    reqLevel: 5,
    name: "Gefürchteter Feldherr",
    desc: "Gewinne 15 Angriffe.",
    metric: { kind: "attacksWon", target: 15 },
    xp: 130,
    reward: { holz: 1400, stein: 1400, eisen: 1400 },
  },

  {
    id: "markt5",
    reqLevel: 6,
    name: "Handelszentrum",
    desc: "Baue den Marktplatz auf Stufe 5 aus.",
    metric: { kind: "building", key: "markt", target: 5 },
    xp: 140,
    reward: { holz: 1600, stein: 1500, eisen: 1300 },
  },
  {
    id: "paladin5",
    reqLevel: 6,
    name: "Heilige Ritter",
    desc: "Bilde 5 Paladine aus.",
    metric: { kind: "unit", key: "paladin", target: 5 },
    xp: 160,
    reward: { holz: 1500, stein: 1500, eisen: 2000 },
  },
  {
    id: "gather10000",
    reqLevel: 6,
    name: "Schatzmeister",
    desc: "Sammle insgesamt 10.000 Rohstoffe mit Bewohnern.",
    metric: { kind: "gathered", target: 10000 },
    xp: 150,
    reward: { holz: 1800, stein: 1800, eisen: 1500 },
  },

  {
    id: "rathaus15",
    reqLevel: 7,
    name: "Prunkvolle Residenz",
    desc: "Baue das Rathaus auf Stufe 15 aus.",
    metric: { kind: "building", key: "rathaus", target: 15 },
    xp: 200,
    reward: { holz: 2500, stein: 2500, eisen: 2000 },
  },
  {
    id: "army200",
    reqLevel: 7,
    name: "Heerführer",
    desc: "Unterhalte insgesamt 200 Truppen.",
    metric: { kind: "units", target: 200 },
    xp: 210,
    reward: { holz: 2400, stein: 2000, eisen: 2600 },
  },
  {
    id: "points3000",
    reqLevel: 7,
    name: "Großmacht",
    desc: "Erreiche 3000 Dorfpunkte.",
    metric: { kind: "points", target: 3000 },
    xp: 220,
    reward: { holz: 2800, stein: 2800, eisen: 2400 },
  },

  {
    id: "attack40",
    reqLevel: 8,
    name: "Eroberer",
    desc: "Gewinne 40 Angriffe.",
    metric: { kind: "attacksWon", target: 40 },
    xp: 280,
    reward: { holz: 3500, stein: 3500, eisen: 3500 },
  },
  {
    id: "points6000",
    reqLevel: 8,
    name: "Legende der Welt",
    desc: "Erreiche 6000 Dorfpunkte.",
    metric: { kind: "points", target: 6000 },
    xp: 320,
    reward: { holz: 4000, stein: 4000, eisen: 3500 },
  },
  {
    id: "mauer10",
    reqLevel: 8,
    name: "Uneinnehmbar",
    desc: "Baue die Stadtmauer auf Stufe 10.",
    metric: { kind: "building", key: "mauer", target: 10 },
    xp: 260,
    reward: { holz: 3000, stein: 4500, eisen: 2500 },
  },
  {
    id: "paladin20",
    reqLevel: 8,
    name: "Orden der Paladine",
    desc: "Bilde 20 Paladine aus.",
    metric: { kind: "unit", key: "paladin", target: 20 },
    xp: 300,
    reward: { holz: 3200, stein: 3200, eisen: 4500 },
  },

  {
    id: "rathaus20",
    reqLevel: 9,
    name: "Kaiserpfalz",
    desc: "Baue das Rathaus auf Stufe 20 aus.",
    metric: { kind: "building", key: "rathaus", target: 20 },
    xp: 400,
    reward: { holz: 5000, stein: 5000, eisen: 4000 },
  },
  {
    id: "army400",
    reqLevel: 9,
    name: "Gewaltiges Heer",
    desc: "Unterhalte insgesamt 400 Truppen.",
    metric: { kind: "units", target: 400 },
    xp: 420,
    reward: { holz: 4800, stein: 4000, eisen: 5200 },
  },
  {
    id: "gather50000",
    reqLevel: 9,
    name: "Reichtum ohne Grenzen",
    desc: "Sammle insgesamt 50.000 Rohstoffe mit Bewohnern.",
    metric: { kind: "gathered", target: 50000 },
    xp: 380,
    reward: { holz: 5000, stein: 5000, eisen: 4500 },
  },

  {
    id: "attack80",
    reqLevel: 10,
    name: "Schrecken der Nachbarn",
    desc: "Gewinne 80 Angriffe.",
    metric: { kind: "attacksWon", target: 80 },
    xp: 500,
    reward: { holz: 6500, stein: 6500, eisen: 6500 },
  },
  {
    id: "points12000",
    reqLevel: 10,
    name: "Herrscher der Welt",
    desc: "Erreiche 12000 Dorfpunkte.",
    metric: { kind: "points", target: 12000 },
    xp: 600,
    reward: { holz: 8000, stein: 8000, eisen: 7000 },
  },
];

// XP, um von `level` auf die nächste Stufe zu steigen (wächst je Stufe).
export function xpToNext(level) {
  return Math.round(60 * Math.pow(1.35, Math.max(1, level) - 1));
}

// Gesamte gesammelte XP → aktuelle Stufe + Fortschritt in die nächste.
// Liefert { level, into (XP in aktueller Stufe), need (XP für nächste Stufe) }.
export function levelForXp(xp) {
  xp = Math.max(0, Math.floor(xp || 0));
  let level = 1;
  let acc = 0;
  while (xp >= acc + xpToNext(level)) {
    acc += xpToNext(level);
    level++;
  }
  return { level, into: xp - acc, need: xpToNext(level) };
}

// ---------- Item-Shop (Echtgeld / PayPal) ----------
// Preise in EUR. Käufe werden serverseitig nach bestätigter PayPal-Zahlung
// gutgeschrieben (siehe server/game.js grantShopItem). Neue Artikel: hier
// eintragen — der Shop-Tab rendert automatisch aus dieser Tabelle.
//   type "resources": amount wird sofort gutgeschrieben (bis Lagerkapazität)
//   type "boost":     mult × Produktion für durationMs (Echtzeit, kumuliert)
//   type "finish":    stellt alle laufenden Bauaufträge sofort fertig
export const SHOP_CURRENCY = "EUR";
export const SHOP_ITEMS = {
  pack_small: {
    name: "Rohstoffkiste (klein)",
    desc: "Sofort +1.500 Holz, Stein und Eisen (bis zur Lagerkapazität).",
    icon: "📦",
    price: 0.99,
    type: "resources",
    amount: { holz: 1500, stein: 1500, eisen: 1500 },
  },
  pack_big: {
    name: "Rohstoffkiste (groß)",
    desc: "Sofort +8.000 Holz, Stein und Eisen (bis zur Lagerkapazität).",
    icon: "🎁",
    price: 3.99,
    type: "resources",
    amount: { holz: 8000, stein: 8000, eisen: 8000 },
  },
  boost_1d: {
    name: "Produktionsboost — 24 Stunden",
    desc: "Verdoppelt die Rohstoffproduktion aller Minen für 24 Stunden.",
    icon: "⚡",
    price: 1.99,
    type: "boost",
    mult: 2,
    durationMs: 24 * 3_600_000,
  },
  boost_7d: {
    name: "Produktionsboost — 7 Tage",
    desc: "Verdoppelt die Rohstoffproduktion aller Minen für 7 Tage.",
    icon: "🔥",
    price: 7.99,
    type: "boost",
    mult: 2,
    durationMs: 7 * 24 * 3_600_000,
  },
  finish_builds: {
    name: "Sofort-Baumeister",
    desc: "Stellt alle laufenden Bauaufträge im aktiven Dorf sofort fertig.",
    icon: "🛠️",
    price: 0.99,
    type: "finish",
  },
};

// ---------- Chat-Moderation ----------
// Für App-Store-Konformität (Guideline 1.2, nutzergenerierte Inhalte): Wortfilter,
// Melden, Blockieren. Diese Liste ist bewusst klein gehalten — bei Bedarf erweitern.
// Der Filter maskiert Treffer (auch als Wortbestandteil), Groß/Klein egal.
export const BADWORDS = [
  "arschloch",
  "hurensohn",
  "wichser",
  "fotze",
  "schlampe",
  "nutte",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "nigger",
  "nigga",
  "fag",
  "faggot",
  "retard",
];
// So viele unabhängige Meldungen blenden eine Nachricht automatisch aus (Sicherheitsnetz,
// damit anstößige Inhalte auch ohne manuelles Eingreifen binnen Minuten verschwinden).
export const CHAT_REPORT_HIDE_THRESHOLD = 3;
