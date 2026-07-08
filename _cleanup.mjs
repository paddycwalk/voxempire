// Einmaliges Cleanup-Skript: löscht angegebene Spieler samt Dörfern,
// Welt-Einträgen, Events, Marktangeboten, Allianz-Mitgliedschaften und Tokens.
import fs from 'node:fs';

const DB = new URL('./db.json', import.meta.url);
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));

const targets = [
  'atk_j4nobh', 'def_7wnzo9', 'atk_87gppe', 'def_ycn8zl', 'atk_5yurnu',
  'def_bbx4b6', 'atk_xepo3o', 'def_sn9zvb', 'brtest_40344', 'allytest_6067',
  'kartograf',
].map((n) => n.toLowerCase());

const removedVillageIds = new Set();

for (const key of targets) {
  const user = db.users[key];
  if (!user) { console.log('  ! nicht gefunden:', key); continue; }

  // Dorf + Welt-Eintrag entfernen
  const vid = user.villageId;
  const v = vid ? db.villages[vid] : null;
  if (v) {
    delete db.world[`${v.x},${v.y}`];
    delete db.villages[vid];
    removedVillageIds.add(vid);
  }

  // Aus Allianz entfernen (Mitglied oder Anführer)
  if (user.allianceId && db.alliances[user.allianceId]) {
    const a = db.alliances[user.allianceId];
    a.members = (a.members || []).filter((m) => m !== key);
    if (a.leader === key) {
      if (a.members.length) a.leader = a.members[0];
      else delete db.alliances[user.allianceId];
    }
  }

  delete db.users[key];
  console.log('  - gelöscht:', key, vid ? `(Dorf ${vid})` : '');
}

// Events, die auf gelöschte Dörfer verweisen, entfernen
const evBefore = db.events.length;
db.events = db.events.filter((e) => !removedVillageIds.has(e.from) && !removedVillageIds.has(e.to));

// Marktangebote der gelöschten Spieler entfernen
const mkBefore = db.market.length;
db.market = db.market.filter((m) => !targets.includes((m.seller || '').toLowerCase()));

// Tokens der gelöschten Spieler entfernen
for (const t of Object.keys(db.tokens)) {
  if (targets.includes((db.tokens[t].user || '').toLowerCase())) delete db.tokens[t];
}

fs.writeFileSync(new URL('./db.json.tmp', import.meta.url), JSON.stringify(db));
fs.renameSync(new URL('./db.json.tmp', import.meta.url), DB);

console.log(`\nFertig. Events ${evBefore}->${db.events.length}, Markt ${mkBefore}->${db.market.length}.`);
console.log('Verbleibende Spieler:', Object.keys(db.users).length, '| Dörfer:', Object.keys(db.villages).length);
