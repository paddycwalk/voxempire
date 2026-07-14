// ============================================================
// VOXEMPIRE — Persistenz: eine JSON-Datei als Datenbank.
// Atomares Schreiben (tmp + rename), Autosave via server.js.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.VOX_DB || path.join(DIR, "..", "db.json");

// Optionales Redis-Backend (Upstash) fuer Gratis-Hosts ohne persistente Platte.
// Aktiv, sobald beide REST-Variablen gesetzt sind — sonst lokale JSON-Datei.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = process.env.VOX_DB_KEY || "voxempire:db";
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

// Ein Redis-Kommando ueber die Upstash-REST-API ausfuehren.
async function redisCmd(cmd) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

function emptyDb() {
  return {
    seq: 0, // laufende ID für Dörfer/Events/Angebote
    users: {}, // nameLower -> { name, hash, salt, created, villageId, allianceId, reports[], lastSeen }
    tokens: {}, // token -> { user, exp }
    villages: {}, // id -> Dorf (siehe game.js createVillage)
    world: {}, // "x,y" -> villageId
    events: [], // Truppenbewegungen: { id, type: 'attack'|'return', at, ... }
    market: [], // { id, seller, give:{res,amount}, want:{res,amount}, created }
    alliances: {}, // id -> { id, tag, name, leader, members[], created }
    allianceRequests: [], // Beitrittsanfragen: { id, allianceId, user, userName, time } (user = nameLower)
    chat: [], // Welt-Chat: { id, from, text, time } (auf MAX_CHAT begrenzt)
    friends: {}, // nameLower -> [nameLower, …] (bestätigte Freundschaften, beidseitig)
    friendRequests: [], // { id, from, to, fromName, toName, time } (from/to = nameLower)
    shopOrders: {}, // orderId -> { user, item, price, status, test, created, ... } (Item-Shop/PayPal)
    chatReports: [], // Chat-Meldungen: { id, msgId, by, time } (by = nameLower)
  };
}

async function load() {
  if (useRedis) {
    try {
      const raw = await redisCmd(["GET", REDIS_KEY]);
      // Fehlende Felder ergänzen (Migrationspfad für spätere Versionen)
      return raw ? Object.assign(emptyDb(), JSON.parse(raw)) : emptyDb();
    } catch (e) {
      console.error(
        "Redis-Load fehlgeschlagen, starte mit leerer Welt:",
        e.message,
      );
      return emptyDb();
    }
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const data = JSON.parse(raw);
    // Fehlende Felder ergänzen (Migrationspfad für spätere Versionen)
    return Object.assign(emptyDb(), data);
  } catch {
    return emptyDb();
  }
}

// Top-Level-await: der Serverstart wartet, bis die DB geladen ist (Datei oder Redis).
export const db = await load();

export function nextId(prefix) {
  db.seq += 1;
  return `${prefix}${db.seq}`;
}

// Speichern ist async, damit derselbe Aufruf fuer Datei und Redis passt.
// Der Datei-Pfad schreibt nicht-blockierend (fs.promises), damit der
// Autosave alle 15 s den Event-Loop nicht anhaelt. Ein In-Flight-Schutz
// verhindert, dass sich zwei Schreibvorgaenge auf der tmp-Datei ueberholen.
let saving = null;
export async function save() {
  if (useRedis) {
    await redisCmd(["SET", REDIS_KEY, JSON.stringify(db)]);
    return;
  }
  if (saving) await saving;
  const tmp = DB_FILE + ".tmp";
  saving = (async () => {
    await fs.promises.writeFile(tmp, JSON.stringify(db));
    await fs.promises.rename(tmp, DB_FILE);
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
}

export function dbFile() {
  return useRedis ? `Upstash Redis (${REDIS_KEY})` : DB_FILE;
}
