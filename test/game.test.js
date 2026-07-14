// ============================================================
// VOXEMPIRE — Tests für die Kernlogik (Node-eingebaut: node --test).
// Isolierte Welt: VOX_DB zeigt auf eine nicht existierende Temp-Datei
// (→ leere Welt), Redis/PayPal/Mail werden bewusst deaktiviert. Die Env-Variablen
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
  "MAIL_API_KEY",
  "MAIL_FROM",
])
  delete process.env[k];

const game = await import("../server/game.js");
const { db } = await import("../server/store.js");
const { CONQUEST_ATTACKS } = await import("../server/gamedata.js");

// Registrierungs-Helfer: E-Mail ist Pflicht → aus dem Namen abgeleitet.
const reg = (name) =>
  game.register(name, "pw1234", `${name.toLowerCase()}@test.de`);

test("Registrierung & Login (async scrypt, E-Mail-Pflicht)", async () => {
  const r = await reg("Tester");
  assert.ok(r.token, "Registrierung liefert ein Token");
  assert.equal(r.emailVerified, false);

  await assert.rejects(
    () => game.register("Tester", "pw1234", "anders@test.de"),
    /vergeben/,
  );
  await assert.rejects(() => game.register("ab", "pw1234", "x@test.de"), /3–16/);
  await assert.rejects(
    () => game.register("Kurz", "123", "y@test.de"),
    /mindestens 4/,
  );
  await assert.rejects(() => game.register("NoMail", "pw1234", ""), /E-Mail/);
  await assert.rejects(
    () => game.register("BadMail", "pw1234", "keine-mail"),
    /gültige E-Mail/,
  );
  await assert.rejects(
    () => game.register("DupMail", "pw1234", "tester@test.de"),
    /bereits registriert/,
  );

  const l = await game.login("tester", "pw1234");
  assert.ok(l.token, "Login liefert ein Token");
  await assert.rejects(() => game.login("tester", "falsch"), /Falsches Passwort/);
  await assert.rejects(() => game.login("gibtsnicht", "pw1234"), /Unbekannt/);
});

test("E-Mail-Verifizierung per Bestätigungs-Token", async () => {
  const r = await reg("Verifier");
  assert.equal(r.emailVerified, false);
  const token = Object.keys(db.verifyTokens).find(
    (t) => db.verifyTokens[t].user === "verifier",
  );
  assert.ok(token, "Verify-Token wurde angelegt");
  const res = game.verifyEmail(token);
  assert.equal(res.verified, true);
  assert.equal(db.users["verifier"].emailVerified, true);
  assert.throws(() => game.verifyEmail(token), /ungültig|abgelaufen/);
});

test("Passwort-Reset per Token", async () => {
  await reg("Resetter");
  // Unbekannte E-Mail → generisch ok, kein Token.
  const unknown = await game.requestPasswordReset("gibtsnicht@test.de");
  assert.equal(unknown.ok, true);

  await game.requestPasswordReset("resetter@test.de");
  const token = Object.keys(db.resetTokens).find(
    (t) => db.resetTokens[t].user === "resetter",
  );
  assert.ok(token, "Reset-Token wurde angelegt");
  await game.resetPassword(token, "neuespw");
  await assert.rejects(() => game.login("resetter", "pw1234"), /Falsches Passwort/);
  const l = await game.login("resetter", "neuespw");
  assert.ok(l.token, "Login mit neuem Passwort funktioniert");
});

test("Offline-Progression: touchVillage produziert segmentweise", async () => {
  await reg("Miner");
  const v = db.villages[db.users["miner"].villageId];
  v.buildings.holz = 5; // ergiebige Mine
  const before = v.res.holz;
  v.lastUpdate = Date.now() - 3_600_000; // eine Stunde „offline"
  game.touchVillage(v);
  assert.ok(v.res.holz > before, "Holz wächst nach einer Offline-Stunde");
});

test("Shop (Testmodus): Kauf wird genau einmal gutgeschrieben", async () => {
  await reg("Shopper");
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
  await reg("Deleteme");
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
  await reg("Sweepy");
  db.tokens["abgelaufen"] = { user: "sweepy", exp: Date.now() - 1000 };
  db.tokens["verwaist"] = { user: "geistuser", exp: Date.now() + 1e9 };
  game.sweep();
  assert.equal(db.tokens["abgelaufen"], undefined);
  assert.equal(db.tokens["verwaist"], undefined);
});

test("Eroberung leitet Truppen des Vorbesitzers in Transit um", async () => {
  await reg("Angreifer");
  await reg("Verlierer");
  const atk = db.users["angreifer"];
  const def = db.users["verlierer"];
  const av = db.villages[atk.villageId];
  const dv = db.villages[def.villageId];
  av.protectedUntil = 0;
  dv.protectedUntil = 0;
  dv.conquest = { by: "angreifer", progress: CONQUEST_ATTACKS - 1 };

  const now = Date.now();
  db.events.push({
    id: "e_atk",
    type: "attack",
    at: now - 1,
    start: now - 1000,
    from: av.id,
    to: dv.id,
    units: { paladin: 50 },
  });
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
  await reg("Flucher");
  const msg = game.postChat(db.users["flucher"], "you fuck man");
  assert.equal(msg.text, "you **** man");
});

test("Chat: Melden über Schwelle blendet Nachricht aus", async () => {
  await reg("Autor");
  await reg("Melder1");
  await reg("Melder2");
  await reg("Melder3");
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
  await reg("Sender");
  await reg("Leser");
  const msg = game.postChat(db.users["sender"], "Nachricht vom Sender");
  game.blockChatUser(db.users["leser"], "Sender");
  const visible = game
    .getChat(db.users["leser"])
    .messages.some((m) => m.id === msg.id);
  assert.equal(visible, false, "blockierter Absender ist unsichtbar");
});

test("Moderation: Admin sperrt Spieler; Login & Auth verweigert", async () => {
  await reg("ChefMod"); // in VOX_ADMINS
  const bad = await reg("Stoerer"); // liefert Token
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
  await reg("Pusher");
  const user = db.users["pusher"];
  game.registerPushToken(user, "tok-abc", "ios");
  game.registerPushToken(user, "tok-abc", "ios"); // dieselbe → kein Duplikat
  game.registerPushToken(user, "tok-def", "ios");
  assert.equal(user.pushTokens.length, 2);
  assert.throws(() => game.registerPushToken(user, "", "ios"), /Kein Push-Token/);
});
