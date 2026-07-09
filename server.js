// ============================================================
// VOXEMPIRE — Server: HTTP-API + statische Dateien + Game-Tick.
// Keine Dependencies, nur Node-Built-ins. Start: node server.js
// ============================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, save, dbFile } from "./server/store.js";
import {
  SAVE_INTERVAL_MS,
  SPEED,
  BUILDINGS,
  UNITS,
  WORLD_SIZE,
  WORKER_SPEED,
  CONQUEST_ATTACKS,
  gatherWorkMs,
  residentRegenMs,
  GATHER_AMBUSH_CHANCE,
} from "./server/gamedata.js";
import * as game from "./server/game.js";

const PORT = Number(process.env.PORT || 8090);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ---------------- API-Routen ----------------
// auth: true → Handler bekommt den eingeloggten User, sonst 401.
const routes = {
  "POST /api/register": {
    auth: false,
    fn: (_, body) => game.register(body.name, body.pass),
  },
  "POST /api/login": {
    auth: false,
    fn: (_, body) => game.login(body.name, body.pass),
  },
  "POST /api/logout": {
    auth: false,
    fn: (_, __, token) => {
      game.logout(token);
      return {};
    },
  },

  "GET /api/meta": {
    auth: false,
    fn: () => ({
      BUILDINGS,
      UNITS,
      SPEED,
      WORLD_SIZE,
      CONQUEST_ATTACKS,
      GATHER: {
        workerSpeedEff: WORKER_SPEED * SPEED,
        workMs: gatherWorkMs(),
        yieldPerWorker: 12 * SPEED,
        ambushChance: GATHER_AMBUSH_CHANCE,
      },
      RESIDENT: {
        regenMs: residentRegenMs(),
      },
    }),
  },

  "GET  /api/state": { auth: true, fn: (u) => game.getState(u) },
  "POST /api/build": {
    auth: true,
    fn: (u, b) => {
      game.build(u, b.building);
      return game.getState(u);
    },
  },
  "POST /api/demolish": {
    auth: true,
    fn: (u, b) => {
      game.demolish(u, b.building);
      return game.getState(u);
    },
  },
  "POST /api/train": {
    auth: true,
    fn: (u, b) => {
      game.train(u, b.unit, b.count);
      return game.getState(u);
    },
  },
  "POST /api/attack": {
    auth: true,
    fn: (u, b) => game.attack(u, Number(b.x), Number(b.y), b.units),
  },
  "POST /api/attack/cancel": {
    auth: true,
    fn: (u, b) => game.cancelAttack(u, b.id),
  },
  "POST /api/scout": {
    auth: true,
    fn: (u, b) => game.scout(u, Number(b.x), Number(b.y), b.count),
  },
  "POST /api/gather": {
    auth: true,
    fn: (u, b) => game.gather(u, Number(b.x), Number(b.y), b.workers, b.guards),
  },
  "POST /api/reinforce": {
    auth: true,
    fn: (u, b) => game.reinforce(u, Number(b.x), Number(b.y), b.units),
  },
  "POST /api/reinforce/recall": {
    auth: true,
    fn: (u, b) => game.recallReinforcement(u, b.targetId, b.fromId),
  },
  "POST /api/transport": {
    auth: true,
    fn: (u, b) => game.sendResources(u, b.targetId, b.res),
  },

  "GET  /api/map": {
    auth: true,
    fn: (u, _, __, q) =>
      game.mapView(Number(q.get("x")), Number(q.get("y")), 6, u),
  },
  "POST /api/village/select": {
    auth: true,
    fn: (u, b) => game.selectVillage(u, b.id),
  },
  "GET  /api/ranking": { auth: true, fn: (u) => game.ranking(u) },
  "GET  /api/reports": { auth: true, fn: (u) => game.getReports(u) },

  "GET  /api/profile": { auth: true, fn: (u) => game.getProfile(u) },
  "POST /api/profile/village": {
    auth: true,
    fn: (u, b) => game.renameVillage(u, b.name),
  },
  "POST /api/profile/password": {
    auth: true,
    fn: (u, b) => {
      game.changePassword(u, b.oldPass, b.newPass);
      return {};
    },
  },

  "GET  /api/market": { auth: true, fn: () => game.marketList() },
  "POST /api/market/create": {
    auth: true,
    fn: (u, b) => {
      game.marketCreate(u, b.give, b.want);
      return game.marketList();
    },
  },
  "POST /api/market/accept": {
    auth: true,
    fn: (u, b) => {
      game.marketAccept(u, b.id);
      return game.marketList();
    },
  },
  "POST /api/market/cancel": {
    auth: true,
    fn: (u, b) => {
      game.marketCancel(u, b.id);
      return game.marketList();
    },
  },
  "POST /api/market/exchange": {
    auth: true,
    fn: (u, b) => game.marketExchange(u, b.giveRes, b.wantRes, b.wantAmount),
  },
  "GET  /api/alliance": { auth: true, fn: (u) => game.allianceInfo(u) },
  "GET  /api/alliances": { auth: true, fn: (u) => game.allianceList(u) },
  "POST /api/alliance/create": {
    auth: true,
    fn: (u, b) => {
      game.allianceCreate(u, b.tag, b.name);
      return game.allianceInfo(u);
    },
  },
  "POST /api/alliance/join": {
    auth: true,
    fn: (u, b) => {
      game.allianceRequestJoin(u, b.id);
      return game.allianceList(u);
    },
  },
  "POST /api/alliance/cancel": {
    auth: true,
    fn: (u, b) => {
      game.allianceCancelRequest(u, b.id);
      return game.allianceList(u);
    },
  },
  "POST /api/alliance/accept": {
    auth: true,
    fn: (u, b) => {
      game.allianceAcceptRequest(u, b.id);
      return game.allianceInfo(u);
    },
  },
  "POST /api/alliance/decline": {
    auth: true,
    fn: (u, b) => {
      game.allianceDeclineRequest(u, b.id);
      return game.allianceInfo(u);
    },
  },
  "POST /api/alliance/leave": {
    auth: true,
    fn: (u) => {
      game.allianceLeave(u);
      return {};
    },
  },
  "POST /api/alliance/kick": {
    auth: true,
    fn: (u, b) => {
      game.allianceKick(u, b.member);
      return game.allianceInfo(u);
    },
  },

  "GET  /api/chat": { auth: true, fn: () => game.getChat() },
  "POST /api/chat": {
    auth: true,
    fn: (u, b) => {
      game.postChat(u, b.text);
      return game.getChat();
    },
  },

  "GET  /api/friends": { auth: true, fn: (u) => game.friendData(u) },
  "POST /api/friends/request": {
    auth: true,
    fn: (u, b) => game.sendFriendRequest(u, b.name),
  },
  "POST /api/friends/accept": {
    auth: true,
    fn: (u, b) => game.acceptFriendRequest(u, b.id),
  },
  "POST /api/friends/decline": {
    auth: true,
    fn: (u, b) => game.declineFriendRequest(u, b.id),
  },
  "POST /api/friends/remove": {
    auth: true,
    fn: (u, b) => game.removeFriend(u, b.name),
  },

  "GET  /api/quests": { auth: true, fn: (u) => game.getQuests(u) },
  "POST /api/quests/claim": {
    auth: true,
    fn: (u, b) => game.claimQuest(u, b.id),
  },

  "GET  /api/shop": { auth: true, fn: (u) => game.getShop(u) },
  "POST /api/shop/order": {
    auth: true,
    fn: (u, b) => game.shopCreateOrder(u, b.itemId),
  },
  "POST /api/shop/capture": {
    auth: true,
    fn: (u, b) => game.shopCaptureOrder(u, b.orderId),
  },
};
function findRoute(method, pathname) {
  for (const [key, route] of Object.entries(routes)) {
    const [m, p] = key.split(/\s+/);
    if (m === method && p === pathname) return route;
  }
  return null;
}

async function handleApi(req, res, url) {
  const route = findRoute(req.method, url.pathname);
  if (!route) return sendJson(res, 404, { error: "Unbekannte API-Route." });

  let body = {};
  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: "Ungültiger Request-Body." });
    }
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let user = null;
  if (route.auth) {
    user = game.authUser(token);
    if (!user) return sendJson(res, 401, { error: "Nicht eingeloggt." });
  }

  try {
    // Vor jeder Aktion fällige Kampf-Events abarbeiten, damit niemand
    // mit veralteten Truppenständen agiert.
    game.processEvents();
    const result = await route.fn(user, body, token, url.searchParams);
    // null ist eine gültige Antwort (z. B. /api/alliance ohne Allianz) — nur undefined ersetzen.
    sendJson(res, 200, result === undefined ? {} : result);
  } catch (e) {
    if (e instanceof game.GameError)
      return sendJson(res, 400, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: "Interner Serverfehler." });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(req, res, url) {
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Nicht gefunden");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full)] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) handleApi(req, res, url);
  else serveStatic(req, res, url);
});

// ---------------- Game-Tick & Persistenz ----------------
// Der Tick löst Angriffe/Rückkehr aus, auch wenn niemand online ist.
// Nach einem Neustart holt der erste Tick alle überfälligen Events nach.
setInterval(() => {
  try {
    game.processEvents();
  } catch (e) {
    console.error("Tick-Fehler:", e);
  }
}, 1000);

setInterval(() => {
  save().catch((e) => console.error("Speichern fehlgeschlagen:", e));
}, SAVE_INTERVAL_MS);

async function shutdown() {
  console.log("\nSpeichere Spielstand …");
  try {
    await save();
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  console.log(`VOXEMPIRE läuft auf  http://localhost:${PORT}`);
  console.log(`Weltgeschwindigkeit: ${SPEED}x  |  Datenbank: ${dbFile()}`);
  console.log(
    `Spieler: ${Object.keys(db.users).length}, Dörfer: ${Object.keys(db.villages).length}`,
  );
});
