# VOXEMPIRE — Hinweise für Claude Code

Aufbau-Strategie-MMO im Travian-Stil mit Accounts, persistenter Welt und Offline-Progression. Vanilla JS, UI-Texte und Kommentare Deutsch, keine Tests, kein Linter. Spielerorientierte Doku in `README.md`.

## Ausführen

```bash
cd voxempire && node server.js   # Node ≥ 18, keine Dependencies
```

http://localhost:8090. Schnelle Testrunde: `VOX_SPEED=50 VOX_PROTECTION_MIN=1 node server.js`. Spielstand: `db.json` — löschen = frische Welt.

Umgebungsvariablen: `PORT` (8090), `VOX_SPEED` (3, Produktion × / Bau- und Reisezeiten ÷), `VOX_PROTECTION_MIN` (1440, Anfängerschutz in Minuten, 0 = aus), `VOX_DB` (`./db.json`).

## Architektur

Autoritativer Node-Server ohne npm-Pakete, REST-API + Polling-Client (kein WebSocket). Kernidee **Offline-Progression**: Rohstoffe/Bauqueue/Ausbildung werden nicht getickt, sondern **lazy aus Zeitstempeln nachgerechnet** (`touchVillage()` in `server/game.js` — segmentweise, damit ein mittendrin fertiggestellter Minen-Ausbau korrekt produziert). Nur Truppenbewegungen (Angriff/Rückkehr) sind Events in `db.events`, die ein Sekunden-Tick in `server.js` abarbeitet (`processEvents()` — läuft zusätzlich vor jedem API-Aufruf, damit niemand mit veralteten Truppenständen agiert); nach Neustart holt der erste Tick Überfälliges nach. Beides überlebt Server-Neustarts.

### Module

- `server/gamedata.js` — **Alle Balance-Daten und Formeln** (`BUILDINGS`, `UNITS`, Kosten-/Zeit-/Produktionsformeln, `SPEED`, `SAVE_INTERVAL_MS`, `WORLD_SIZE`). Neue Gebäude/Einheiten: fast immer nur hier.
- `server/game.js` — Spiellogik: Accounts (scrypt), Session-Tokens, `touchVillage`, Bauen/Ausbilden, Kampf (`resolveAttack`: Off/Def-Verhältnis^1.5 = Verlustquoten, Mauer +6 %/Stufe, Beute nach Tragekapazität), Kampfberichte, Markt, Allianzen, Rangliste, `getState`. Wirft `GameError` für 400er. **Mehrere Dörfer**: Ein Spieler kann mehrere Dörfer besitzen (`owner` je Dorf); `user.villageId` = aktuell _aktives_ Dorf für alle Aktionen. `ownedVillages(user)`/`userPoints(user)` aggregieren; `selectVillage(user, id)` wechselt das aktive Dorf. **Adelung**: Überlebt ein Paladin (`UNITS.paladin.conquer`) einen gewonnenen Angriff, erhöht `advanceConquest` die Treue (`village.conquest = { by, progress }`); nach `CONQUEST_ATTACKS` (gamedata) wechselt `conquerVillage` den Besitzer und gibt dem Verteidiger nötigenfalls ein Ersatzdorf.
- `server/store.js` — JSON-DB (`db`-Singleton, atomares `save()`). Autosave alle `SAVE_INTERVAL_MS` + bei SIGINT/SIGTERM.
- `server.js` — HTTP-Server, `routes`-Tabelle (`'METHOD /pfad' → { auth, fn }`), statische Dateien aus `public/`, Sekunden-Tick + Autosave. `auth: true` → Handler bekommt den eingeloggten User (Bearer-Token), sonst 401.
- `public/app.js` — SPA-Client: pollt `/api/state` alle 4 s, `renderers`-Objekt pro Tab, lokaler Sekunden-Tick für Countdowns/Rohstoff-Hochzählen (`liveRes`).

### API-Routen (Stand: siehe `routes` in `server.js`)

- Ohne Auth: `POST /api/register|login|logout`, `GET /api/meta` (Stammdaten: `BUILDINGS`, `UNITS`, `SPEED`, `WORLD_SIZE`).
- Mit Auth: `GET /api/state|map|ranking|reports|market|alliance|alliances`, `POST /api/build|train|attack`, `POST /api/market/create|accept|cancel`, `POST /api/alliance/create|join|leave|kick`, `GET /api/profile`, `POST /api/profile/village|password`, `GET /api/quests`, `POST /api/quests/claim`.
- **Bewohner & Sammeln**: Jedes Dorf hat Bewohner = `residentsCap(rathausLevel)` (in `gamedata.js`, sofort verfügbar, keine DB-Migration nötig — abgeleitet aus der Rathausstufe). Freie Bewohner können via `POST /api/gather` auf Rohstoffvorkommen der Karte geschickt werden. Vorkommen sind deterministisch aus den Koordinaten (`resourceNodeAt`) und werden über `/api/map` (jetzt `{ villages, nodes }`) mitgeliefert. Sammeln läuft als Event-Paar `gather`→`gatherReturn` (analog `attack`→`return`); belegte Bewohner zählt `residentsBusy` über die Events.

## Typische Änderungsorte

- **Neues Gebäude / neue Einheit**: Eintrag in `gamedata.js` (`BUILDINGS`/`UNITS`); Client rendert aus `/api/meta` + `/api/state` automatisch mit.
- **Neue API-Route**: Eintrag in `routes` (`server.js`) + Funktion in `game.js` + Aufruf im Client.
- **Balance-Tuning**: Formeln und Werte in `gamedata.js`.
- Der Client bezieht Stammdaten aus `/api/meta`, berechnete Werte (Kosten, Zeiten) liefert der Server in `/api/state` mit — **Formeln nicht im Client duplizieren** (Ausnahme: Reisezeit-Vorschau nutzt `UNITS.speed` × `SPEED` aus meta).
- Bei sichtbaren Gameplay-Änderungen (Gebäude, Einheiten, Regeln): Tabellen/Abschnitte in `README.md` mitpflegen.
