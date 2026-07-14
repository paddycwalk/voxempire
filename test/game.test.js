// ============================================================
// VOXEMPIRE — Tests für die Kernlogik (Node-eingebaut: node --test).
// Isolierte Welt: VOX_DB zeigt auf eine nicht existierende Temp-Datei
// (→ leere Welt), Redis/PayPal werden bewusst deaktiviert. Die Env-Variablen
// müssen VOR dem Import von store.js/game.js gesetzt sein, daher dynamic import.
// ============================================================
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.VOX_DB = path.join(os.tmpdir(), `voxempire-test-${process.pid}.json`);
process.env.VOX_SPEED = "1";
process.env.VOX_PROTECTION_MIN = "0";
process.env.VOX_ADMINS = "chefmod"; // für die Moderations-Tests
for (const k of [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_SECRET",
  "PAYPAL_CLIENT_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
])
  delete process.env[k];

const game = await import("../server/game.js");
const { db } = await import("../server/store.js");
const { CONQUEST_ATTACKS } = await import("../server/gamedata.js");

test("Registrierung & Login (async scrypt)", async () => {
  const r = await game.register("Tester", "pw1234");
  assert.ok(r.token, "Registrierung liefert ein Token");

  await assert.rejects(() => game.register("Tester", "pw1234"), /vergeben/);
  await assert.rejects(() => game.register("ab", "pw1234"), /3–16/); // zu kurz
  await assert.rejects(() => game.register("Kurz", "123"), /mindestens 4/);

  const l = await game.login("tester", "pw1234");
  assert.ok(l.token, "Login liefert ein Token");
  await assert.rejects(() => game.login("tester", "falsch"), /Falsches Passwort/);
  await assert.rejects(() => game.login("gibtsnicht", "pw1234"), /Unbekannt/);
});

test("Offline-Progression: touchVillage produziert segmentweise", async () => {
  await game.register("Miner", "pw1234");
  const v = db.villages[db.users["miner"].villageId];
  v.buildings.holz = 5; // ergiebige Mine
  const before = v.res.holz;
  v.lastUpdate = Date.now() - 3_600_000; // eine Stunde „offline"
  game.touchVillage(v);
  assert.ok(v.res.holz > before, "Holz wächst nach einer Offline-Stunde");
  assert.ok(v.res.holz <= v.buildings.lager * 1e9, "bleibt endlich");
});

test("Shop (Testmodus): Kauf wird genau einmal gutgeschrieben", async () => {
  await game.register("Shopper", "pw1234");
  const user = db.users["shopper"];
  const v = db.villages[user.villageId];
  v.buildings.lager = 12; // genug Kapazität, damit die Kiste passt
  game.touchVillage(v);
  const holzVorher = v.res.holz;

  const order = await game.shopCreateOrder(user, "pack_small");
  assert.equal(order.testMode, true);

  const first = await game.shopCaptureOrder(user, order.orderId);
  assert.ok(first.granted, "erste Einlösung schreibt gut");
  assert.ok(v.res.holz > holzVorher);

  const second = await game.shopCaptureOrder(user, order.orderId);
  assert.ok(second.alreadyGranted, "zweite Einlösung ist idempotent");
});

test("Konto-Löschung entfernt alle Daten; falsches Passwort scheitert", async () => {
  await game.register("Deleteme", "pw1234");
  const user = db.users["deleteme"];
  const v = db.villages[user.villageId];
  const coord = `${v.x},${v.y}`;

  await assert.rejects(() => game.deleteAccount(user, "falsch"), /Passwort/);

  await game.deleteAccount(user, "pw1234");
  assert.equal(db.users["deleteme"], undefined, "User weg");
  assert.equal(db.villages[v.id], undefined, "Dorf weg");
  assert.equal(db.world[coord], undefined, "Welt-Feld frei");
});

test("Sweep entfernt abgelaufene und verwaiste Tokens", async () => {
  await game.register("Sweepy", "pw1234");
  db.tokens["abgelaufen"] = { user: "sweepy", exp: Date.now() - 1000 };
  db.tokens["verwaist"] = { user: "geistuser", exp: Date.now() + 1e9 };
  game.sweep();
  assert.equal(db.tokens["abgelaufen"], undefined);
  assert.equal(db.tokens["verwaist"], undefined);
});

test("Eroberung leitet Truppen des Vorbesitzers in Transit um", async () => {
  await game.register("Angreifer", "pw1234");
  await game.register("Verlierer", "pw1234");
  const atk = db.users["angreifer"];
  const def = db.users["verlierer"];
  const av = db.villages[atk.villageId];
  const dv = db.villages[def.villageId];
  av.protectedUntil = 0;
  dv.protectedUntil = 0;
  dv.conquest = { by: "angreifer", progress: CONQUEST_ATTACKS - 1 };

  const now = Date.now();
  // Überwältigender Paladin-Angriff (löst die letzte Adelung aus).
  db.events.push({
    id: "e_atk",
    type: "attack",
    at: now - 1,
    start: now - 1000,
    from: av.id,
    to: dv.id,
    units: { paladin: 50 },
  });
  // Truppe des Verteidigers, die gerade heim ins (gleich verlorene) Dorf läuft.
  db.events.push({
    id: "e_ret",
    type: "return",
    at: now + 9_999_999,
    start: now,
    from: "irgendwo",
    to: dv.id,
    units: { speer: 5 },
  });

  game.processEvents(now);

  assert.equal(dv.owner, "angreifer", "Dorf wechselt den Besitzer");
  const ret = db.events.find((e) => e.id === "e_ret");
  assert.ok(ret, "Rückkehr-Event existiert noch");
  assert.notEqual(ret.to, dv.id, "Rückkehr landet nicht im verlorenen Dorf");
  assert.equal(ret.to, def.villageId, "sondern im neuen Heimatdorf");
});

test("Chat: Wortfilter maskiert Schimpfwörter", async () => {
  await game.register("Flucher", "pw1234");
  const msg = game.postChat(db.users["flucher"], "you fuck man");
  assert.equal(msg.text, "you **** man");
});

test("Chat: Melden über Schwelle blendet Nachricht aus", async () => {
  await game.register("Autor", "pw1234");
  await game.register("Melder1", "pw1234");
  await game.register("Melder2", "pw1234");
  await game.register("Melder3", "pw1234");
  const msg = game.postChat(db.users["autor"], "harmloser Text zum Melden");

  game.reportChat(db.users["melder1"], msg.id);
  game.reportChat(db.users["melder2"], msg.id);
  assert.throws(
    () => game.reportChat(db.users["melder1"], msg.id),
    /bereits gemeldet/,
  );
  const r3 = game.reportChat(db.users["melder3"], msg.id);
  assert.equal(r3.hidden, true, "3. Meldung blendet aus");

  const seenByOther = game
    .getChat(db.users["melder1"])
    .messages.some((m) => m.id === msg.id);
  assert.equal(seenByOther, false, "normaler Nutzer sieht sie nicht mehr");
});

test("Chat: Blockieren verbirgt Nachrichten eines Absenders", async () => {
  await game.register("Sender", "pw1234");
  await game.register("Leser", "pw1234");
  const msg = game.postChat(db.users["sender"], "Nachricht vom Sender");
  game.blockChatUser(db.users["leser"], "Sender");
  const visible = game
    .getChat(db.users["leser"])
    .messages.some((m) => m.id === msg.id);
  assert.equal(visible, false, "blockierter Absender ist unsichtbar");
});

test("Moderation: Admin sperrt Spieler; Login & Auth verweigert", async () => {
  await game.register("ChefMod", "pw1234"); // in VOX_ADMINS
  const bad = await game.register("Stoerer", "pw1234"); // liefert Token
  assert.ok(game.isAdmin(db.users["chefmod"]));
  assert.equal(game.isAdmin(db.users["stoerer"]), false);

  game.adminBanUser(db.users["chefmod"], "Stoerer");
  assert.equal(db.users["stoerer"].banned, true);
  assert.equal(game.authUser(bad.token), null, "Token des Gesperrten ungültig");
  await assert.rejects(() => game.login("stoerer", "pw1234"), /gesperrt/);

  assert.throws(
    () => game.adminBanUser(db.users["stoerer"], "ChefMod"),
    /Nur Moderatoren/,
  );
});

test("Push: Geräte-Token wird angemeldet und dedupliziert", async () => {
  await game.register("Pusher", "pw1234");
  const user = db.users["pusher"];
  game.registerPushToken(user, "tok-abc", "ios");
  game.registerPushToken(user, "tok-abc", "ios"); // dieselbe → kein Duplikat
  game.registerPushToken(user, "tok-def", "ios");
  assert.equal(user.pushTokens.length, 2);
  assert.throws(() => game.registerPushToken(user, "", "ios"), /Kein Push-Token/);
});
