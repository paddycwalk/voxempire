# VOXEMPIRE

Ein Aufbau-Strategie-MMO für den Browser im Stil von Travian / Anno Online:
Rohstoffe produzieren, Dorf ausbauen, Truppen ausbilden, handeln, Allianzen
schmieden — und andere Spieler überfallen. **Die Welt läuft persistent weiter,
auch wenn du ausgeloggt bist**: Minen produzieren, Bauaufträge werden fertig
und Angriffe schlagen ein, egal ob du online bist.

## Starten

Voraussetzung: Node.js ≥ 18. Keine Abhängigkeiten, kein `npm install` nötig.

```bash
cd voxempire
node server.js
```

Dann http://localhost:8090 öffnen (jeder Mitspieler im selben Netz:
`http://<deine-IP>:8090`). Account registrieren — fertig.

Der Spielstand liegt in `db.json` und wird alle 15 Sekunden sowie beim
Beenden (Strg+C) gespeichert. Solange der Server läuft, läuft die Welt.

### Konfiguration (Umgebungsvariablen)

| Variable             | Default     | Bedeutung                                               |
| -------------------- | ----------- | ------------------------------------------------------- |
| `PORT`               | `8090`      | HTTP-Port                                               |
| `VOX_SPEED`          | `3`         | Weltgeschwindigkeit (Produktion ×, Bau-/Reisezeiten ÷)  |
| `VOX_PROTECTION_MIN` | `1440`      | Anfängerschutz in Minuten (0 = aus)                     |
| `VOX_DB`             | `./db.json` | Pfad zur Spielstand-Datei                               |
| `PAYPAL_ENV`         | `sandbox`   | PayPal-Umgebung für den Item-Shop (`sandbox`/`live`)    |
| `PAYPAL_CLIENT_ID`   | –           | Client-ID der PayPal-REST-App (aktiviert echte Zahlung) |
| `PAYPAL_SECRET`      | –           | Secret der PayPal-REST-App                              |

Beispiel für eine schnelle Testrunde: `VOX_SPEED=50 VOX_PROTECTION_MIN=1 node server.js`

Der **Item-Shop** läuft ohne `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET` im **Testmodus**
(Käufe werden ohne echte Zahlung simuliert). Sind beide Variablen gesetzt, wird
über PayPal (Orders v2 REST-API) echt bezahlt — Zugangsdaten gibt es im
[PayPal-Developer-Dashboard](https://developer.paypal.com/). Für Echtgeld
zusätzlich `PAYPAL_ENV=live` setzen.

## Spielprinzip

- **Rohstoffe**: Holz 🪵, Stein 🪨, Eisen ⛓️ — produziert von Holzfällerlager,
  Steinbruch und Eisenmine. Das **Lager** begrenzt den Vorrat.
- **Gebäude**: Rathaus (schnelleres Bauen), Bauernhof (Versorgung = Truppenlimit),
  Kaserne (Ausbildung), Marktplatz (Handel), Stadtmauer (Verteidigung).
  Max. 2 Bauaufträge gleichzeitig. Gebäude lassen sich auch wieder **abreißen**
  (eine Stufe pro Klick, sofort) — dabei bekommst du die **Hälfte** der für diese
  Stufe ausgegebenen Rohstoffe zurück. Das Rathaus bleibt mindestens auf Stufe 1.
- **Einheiten**: Speerträger (Verteidiger), Bogenschütze (günstige Offensive),
  Schwertkämpfer (Angreifer), Axtkämpfer (schwere Offensive), Reiter (schnell,
  viel Beute), Panzerwache (starke Verteidigung), Belagerungsramme (durchbricht
  Verteidigung, keine Beute), Paladin (Elite-Kavallerie), Späher (schnell,
  kämpfen nicht — zum Auskundschaften). Höhere Einheiten schaltest du über den
  Ausbau der Kaserne frei.
- **Bewohner**: Jedes Dorf hat Bewohner abhängig von der **Rathausstufe**
  (4 + 4 pro Stufe). Freie Bewohner lassen sich auf **Rohstoffvorkommen** der
  Weltkarte schicken — Wald 🌲 (Holz), Steinbruch ⛏️ (Stein) oder Eisenader ⚒️
  (Eisen). Sie reisen hin, sammeln eine Weile und kehren mit Rohstoffen zurück.
  Die **Ergiebigkeit** (★ 1–3) eines Vorkommens bestimmt die Ausbeute pro Bewohner.
  Freie/gesamte Bewohner stehen in der Kopfleiste (👷); die Vorkommen erscheinen
  direkt auf der Karte und sind anklickbar.
- **Räuberüberfälle & Wachen**: Unterwegs kann eine Sammelmission von Räubern
  überfallen werden (~30 % Chance). Schicke optional **Wachen** (Truppen) mit —
  sind sie stark genug, wehren sie den Überfall ab; sonst **sterben Bewohner**.
  Gefallene Bewohner werden im **Rathaus nachgezogen** (1 alle 5 Minuten, bis
  wieder alle da sind). Auch bei einer verlorenen Verteidigung des Dorfes fallen
  Bewohner. Das Sammel-Formular zeigt eine **Erfolgschance in %** an (Bewohner
  kehren unversehrt heim): 100 %, sobald deine Wachen die geschätzte Räuberstärke
  übertreffen, sonst ~70 %.
- **Verstärkung (Truppen abstellen)**: Klicke auf ein **eigenes weiteres Dorf**
  oder ein **Allianzmitglied** und entsende Truppen zur Unterstützung. Sie
  verteidigen das Zieldorf mit (Späher ausgenommen) und lassen sich jederzeit
  über die Truppenbewegungen **zurückbeordern**. Stationierte Verstärkung zählt
  weiter zum Unterhalt des Herkunftsdorfes.
- **Angriffe**: Auf der Karte ein Dorf anklicken, Truppen wählen, losschicken.
  Truppen reisen in Echtzeit, kämpfen, plündern und kehren mit Beute zurück.
  Beide Seiten erhalten einen Kampfbericht. Die Stadtmauer des Verteidigers
  zählt auch, wenn er offline ist. Der Bericht zeigt Kräftevergleich,
  Verluste beider Seiten und die erbeutete Menge inklusive Tragekapazität.
  Das Angriffs-Formular zeigt zudem eine geschätzte **Erfolgschance in %** —
  berechnet aus deiner Angriffskraft und der zuletzt **erspähten** Verteidigung
  (Truppen + Mauer) des Ziels. Ohne aktuelle Spähdaten bleibt sie unbekannt.
- **Dörfer erobern (Adelung)**: Schicke einen **Paladin** in einen Angriff.
  Übersteht er einen **gewonnenen** Angriff, sinkt die Treue des fremden Dorfes
  um eine Stufe. Nach **3** solcher Paladin-Angriffe wechselt das Dorf den
  Besitzer und gehört fortan dir. Greift ein anderer Angreifer mit Paladin an,
  beginnt die Treue-Zählung von vorn. Dein Adelungs-Fortschritt (👑 x/3) wird
  auf der Weltkarte und in der Dorf-Detailkarte angezeigt.
- **Mehrere Dörfer**: Besitzt du mehr als ein Dorf (durch Eroberung), erscheint
  oben in der Kopfleiste ein **Dropdown** zum Umschalten. Das gewählte Dorf ist
  aktiv für Ausbau, Ausbildung, Angriffe und Sammeln — genau wie dein Startdorf.
  Verliert ein Spieler sein letztes Dorf, bekommt er automatisch ein frisches.
- **Rohstoffe zwischen eigenen Dörfern schicken**: Sobald du mehr als ein Dorf
  besitzt, erscheint im **Marktplatz** eine Karte „Rohstoffe an eigenes Dorf
  schicken". Wähle Zieldorf und Mengen — ein Handelskarren bringt die Ladung
  hin (Reisezeit nach Entfernung), begrenzt durch das Lager des Zieldorfs.
  Voraussetzung: ein Marktplatz im Absender-Dorf.
- **Spähen**: Schicke Späher zu einem fremden Dorf, um dessen Rohstoffe und
  Truppen aufzudecken. Hat das Ziel eigene Späher, werden deine abgefangen —
  bei zu wenigen bekommst du keine Informationen und der Gegner wird gewarnt.
  Kennst du die Späherzahl des Ziels aus einem früheren Bericht, zeigt das
  Späh-Formular eine geschätzte **Erfolgschance in %** an.
- **Truppen auf der Karte**: Bewegungen, die dein Dorf betreffen, werden auf der
  Weltkarte als wandernder Marker samt Route angezeigt — rot (Angriff),
  blau (Spähen), grün (Rückkehr), golden (Bewohner beim Sammeln). Der Marker
  läuft in Echtzeit zum Ziel.
- **Anfängerschutz**: Neue Spieler sind 24 h unangreifbar — endet vorzeitig
  nur, sobald sie selbst angreifen.
- **Markt**: Angebote wie „100 Holz gegen 80 Eisen" einstellen; andere Spieler
  nehmen sie an. Rohstoffe werden beim Einstellen reserviert.
- **Allianzen**: Gründen oder beitreten; Mitglieder können einander nicht
  angreifen. Allianz-Rangliste inklusive.
- **Welt-Chat**: Öffentlicher Kanal, in dem alle Spieler in Echtzeit
  Nachrichten austauschen (letzte 100 Nachrichten bleiben erhalten).
- **Aufträge & Stufe**: Eine feste Auftragskette führt durch den Spielaufbau
  (Gebäude ausbauen, Truppen unterhalten, Rohstoffe sammeln, Angriffe
  gewinnen …). Jeder erfüllte Auftrag bringt Rohstoffe und Erfahrungspunkte
  (XP); gesammelte XP steigern die Spielerstufe, die im Kopfbereich als „Lv"
  angezeigt wird. Höhere Aufträge schalten sich erst ab einer Mindeststufe
  frei. Der Fortschritt wird serverseitig geführt und läuft auch offline
  weiter.
- **Freunde**: Anderen Spielern Freundschaftsanfragen schicken (per Name oder
  direkt aus der Rangliste). Der Empfänger nimmt an oder lehnt ab; in der
  Freundesliste sieht man Punkte, Dorf und Online-Status seiner Freunde.
- **Rangliste**: Punkte aus Gebäudestufen und Truppen.
- **Item-Shop (Echtgeld)** 💎: Bonus-Artikel gegen echtes Geld per **PayPal**
  kaufen — Rohstoffkisten (sofort Rohstoffe bis zur Lagergrenze),
  Produktionsboost (verdoppelt die Rohstoffproduktion für 24 h bzw. 7 Tage,
  Laufzeiten kumulieren) und der Sofort-Baumeister (stellt alle laufenden
  Bauaufträge sofort fertig). Käufe schreibt der Server erst **nach bestätigter
  Zahlung** dem aktiven Dorf gut. Ohne hinterlegte PayPal-App läuft der Shop im
  **Testmodus** (Kauf ohne echte Zahlung, klar gekennzeichnet).
- **Profil & Einstellungen**: Kontoübersicht (Punkte, Statistiken, Mitglied
  seit), Dorf umbenennen, Passwort ändern sowie lokale Einstellungen
  (Benachrichtigungen an/aus, Aktualisierungs-Intervall).

## Technik

- **Server**: Node.js ohne Dependencies (`server.js` + `server/`). REST-API,
  Session-Tokens, scrypt-gehashte Passwörter, JSON-Datei als Datenbank
  (atomares Schreiben).
- **Offline-Progression**: Rohstoffe/Bauten/Ausbildung werden nicht getickt,
  sondern lazy aus Zeitstempeln nachgerechnet — das überlebt auch
  Server-Neustarts. Truppenbewegungen (Angriff/Rückkehr) laufen als
  Event-Queue über einen Sekunden-Tick; nach einem Neustart werden
  überfällige Events nachgeholt.
- **Client**: Vanilla-JS-SPA (`public/`), pollt den Serverstand alle 4 s und
  tickt Countdowns/Rohstoffanzeige lokal.
