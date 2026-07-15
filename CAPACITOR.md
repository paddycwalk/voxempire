# VOXEMPIRE — Native iOS-App mit Capacitor + Push

Diese Anleitung verpackt den bestehenden Web-Client als native iOS-App. Der
Ansatz: Die App-Hülle lädt den **laufenden VOXEMPIRE-Server** (Remote-URL), so
bleiben alle `/api`-Aufrufe unverändert. Nativer Mehrwert = **Push-Benachrichtigungen**
(z. B. „Angriff im Anmarsch"), damit die App nicht als reiner Webview
abgelehnt wird (App Store Guideline 4.2).

> **Wichtig:** Die Schritte 2–7 brauchen einen **Mac mit Xcode** und einen
> **Apple-Developer-Account**. In dieser Repo liegt bereits das Scaffold
> (`mobile/`), der Web-Client-Hook (`public/push.js`) und die Server-Seite
> (`server/push.js`, Route `POST /api/push/register`).

---

## Was schon vorbereitet ist

| Teil | Ort | Status |
|------|-----|--------|
| Capacitor-Config | [mobile/capacitor.config.json](mobile/capacitor.config.json) | ✅ (Domain eintragen) |
| Mobile-Dependencies | [mobile/package.json](mobile/package.json) | ✅ |
| Push-Registrierung (Client) | [public/push.js](public/push.js) | ✅ (No-Op im Browser) |
| Token-Anmeldung (Server) | `registerPushToken` + `POST /api/push/register` | ✅ (getestet) |
| Push-Versand | [server/push.js](server/push.js) | ⚠️ Platzhalter — APNs-Zugangsdaten fehlen |
| Angriff → Benachrichtigung | `attack()` ruft `sendToUser(defender, …)` | ✅ (No-Op bis APNs konfiguriert) |

---

## Schritt 1 — Domain eintragen
In [mobile/capacitor.config.json](mobile/capacitor.config.json) `server.url` auf
die **HTTPS**-Adresse deines Servers setzen (ATS verlangt TLS). Optional
`appId` an deine Bundle-ID anpassen.

## Schritt 2 — Capacitor installieren (auf dem Mac)
```bash
cd mobile
npm install
npx cap add ios
npx cap sync ios
```

## Schritt 3 — Xcode-Projekt öffnen
```bash
npx cap open ios
```
- Signing-Team wählen (Apple-Developer-Account).
- Capability **Push Notifications** hinzufügen.
- Capability **Background Modes → Remote notifications** aktivieren.

## Schritt 4 — APNs einrichten (Apple Developer Portal)
1. Unter *Certificates, Identifiers & Profiles → Keys* einen **APNs-Auth-Key**
   (`.p8`) erstellen. Notiere **Key-ID** und **Team-ID**.
2. Die `.p8`-Datei sicher aufbewahren (nur einmal herunterladbar).

## Schritt 5 — Server für den Versand konfigurieren
`server/push.js` schaltet den Versand frei, sobald diese Umgebungsvariablen
gesetzt sind (z. B. in `.env`):
```
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=YYYYYYYYYY
APNS_BUNDLE_ID=de.kittelberger.voxempire
APNS_KEY="-----BEGIN PRIVATE KEY-----\n…Inhalt der .p8…\n-----END PRIVATE KEY-----"
```
Danach den `TODO(APNs)`-Block in [server/push.js](server/push.js) implementieren:
ES256-JWT mit dem `.p8`-Key signieren (geht mit dem eingebauten `crypto`) und je
Geräte-Token an `https://api.push.apple.com/3/device/<token>` per HTTP/2 POSTen.
Kein npm-Paket nötig — passt zur dependency-freien Architektur.

## Schritt 6 — Testen
- App auf einem **echten Gerät** starten (Push geht nicht im Simulator).
- Einloggen → iOS fragt nach Push-Erlaubnis (`public/push.js` löst das aus).
- In App Store Connect prüfen, dass das Token bei `/api/push/register` ankommt
  (Server-Log / DB `user.pushTokens`).
- Von einem zweiten Konto angreifen → Benachrichtigung sollte erscheinen.

## Schritt 7 — Store-Vorbereitung
Siehe [APPSTORE.md](APPSTORE.md): Nutrition Labels, Altersfreigabe, Screenshots,
Privacy Manifest, Konto-Löschung (bereits eingebaut) usw.

---

## Android (optional)
Analog mit `@capacitor/android` und **FCM** statt APNs. `public/push.js` und die
Token-Route funktionieren plattformübergreifend; nur der Versand in
`server/push.js` braucht einen FCM-Zweig.
