# VOXEMPIRE — Weg in den Apple App Store & rechtliche Checkliste

> Stand dieser Analyse: 2026-07. Dies ist eine technische/organisatorische
> Einordnung, **keine Rechtsberatung**. Die konkrete Umsetzung (Rechtstexte,
> Steuern, Verträge) unbedingt mit fachkundigen Personen abstimmen.

VOXEMPIRE ist heute ein **Web-Spiel** (Node-Server + Browser-Client). Der Weg in
den App Store hat drei große Baustellen: **(A) Verpackung als native App**,
**(B) Bezahlung**, **(C) Recht & Moderation**. Die Reihenfolge unten ist nach
„blockiert die Einreichung" sortiert.

---

## 🔴 Blocker 1 — Bezahlung: PayPal ist auf iOS nicht erlaubt

**App Store Review Guideline 3.1.1:** Digitale Güter, die **in der App**
verbraucht werden (Rohstoffkisten, Produktionsboosts, Sofort-Baumeister), müssen
über **Apple In-App-Purchase (IAP / StoreKit)** verkauft werden. Der aktuelle
PayPal-Shop (`server/paypal.js`, Shop-Tab) führt **garantiert zur Ablehnung**,
wenn er in der iOS-App aktiv ist. Apple behält 15–30 % ein.

Zusätzlich gilt **Anti-Steering**: In der iOS-App darf man i. d. R. nicht auf
externe Kaufwege (Website/PayPal) hinweisen oder verlinken (in der EU durch den
DMA aufgeweicht, aber heikel).

**Drei Optionen (Entscheidung nötig):**

| | Ansatz | Aufwand | Konsequenz |
|---|---|---|---|
| **A** | Apple IAP zusätzlich einbauen (StoreKit im Wrapper + serverseitige Beleg-Prüfung), PayPal nur im Web | hoch | voll monetarisierbar auf iOS, 15–30 % an Apple |
| **B** | iOS-App **ohne Shop** ausliefern (gratis), Monetarisierung nur im Web | niedrig | schnell reviewbar, aber keine Käufe in der App |
| **C** | Nur Web/PWA bleiben, **nicht** in den App Store | keiner | keine Apple-Regeln, aber keine Store-Präsenz |

> Der Shop lässt sich serverseitig leicht abschaltbar machen (Flag in `getShop`),
> falls Variante B gewählt wird. Für Variante A ist ein neuer Kaufpfad nötig:
> Client → StoreKit → Beleg → `POST /api/shop/verify-apple` → serverseitige
> Validierung bei Apple → `grantShopItem` (analog zum bestehenden PayPal-Capture).

---

## 🔴 Blocker 2 — Verpackung als native App

Reine Websites/PWAs werden **nicht** akzeptiert. Es braucht eine native App, die
den Web-Client einbettet. Empfohlen: **Capacitor** (WKWebView-Wrapper, lädt den
bestehenden `public/`-Client bzw. die Server-URL).

**Achtung Guideline 4.2 (Minimum Functionality):** Ein reiner „Website im
Rahmen"-Wrapper wird abgelehnt. Die App muss nativen Mehrwert bieten. Für
VOXEMPIRE passt hervorragend:

- **Push-Notifications** bei eingehenden Angriffen / fertigen Bauten (ohnehin ein
  echtes Feature-Plus für ein Aufbau-MMO mit Offline-Progression).
- Native IAP (siehe Blocker 1, Variante A).
- Home-Screen-Icon, Splash, Fullscreen — bereits per Meta-Tags vorbereitet.

---

## 🟡 Blocker 3 — Nutzergenerierte Inhalte (Chat) brauchen Moderation

**Guideline 1.2:** Apps mit UGC (hier: der Welt-Chat) müssen bieten:

1. **Melde-Funktion** für anstößige Nachrichten,
2. **Blockieren/Stummschalten** einzelner Spieler,
3. einen **Inhaltsfilter** (mind. simple Wortliste),
4. Betreiber-Reaktion auf Meldungen **innerhalb 24 h** + Möglichkeit, Nutzer zu
   sperren.

Aktuell fehlt das komplett (`postChat`/`getChat` in `server/game.js`). Ohne diese
vier Punkte ist eine Ablehnung sehr wahrscheinlich. → Umsetzbar als: `report`/
`block`-Routen, `db.chat`-Filter pro Nutzer, Wortliste, Admin-Löschen/Bann.

---

## ✅ Bereits erledigt (in diesem Durchgang umgesetzt)

- **Konto-Löschung direkt in der App** — Guideline 5.1.1(v) **zwingend** für Apps
  mit Accounts. → `Profil → „Meine Daten & Konto" → Konto löschen`
  (`POST /api/account/delete`, passwortbestätigt).
- **Daten-Export** (DSGVO Art. 20) — Download als JSON (`GET /api/account/export`).
- **Rechtstext-Vorlagen** verlinkt und erreichbar (auch vor dem Login):
  `public/legal/impressum.html`, `datenschutz.html`, `agb.html`
  — **Platzhalter noch ausfüllen** (siehe unten).
- Passwort-Hashing async (kein Server-Freeze), Login/Registrierung rate-limited.

---

## 📋 Organisatorische Checkliste

### Apple Developer Program
- [ ] Mitgliedschaft **99 USD/Jahr**. Als **Organisation** (GmbH) → **D-U-N-S-Nummer**
      erforderlich; als Einzelperson einfacher, aber Klarname sichtbar.
- [ ] **Paid Apps Agreement** akzeptieren + Bank-/Steuerdaten hinterlegen (für IAP).

### App Store Connect — Angaben
- [ ] **Privacy Policy URL** (Pflicht) → auf die veröffentlichte `datenschutz.html`.
- [ ] **App-Datenschutz („Nutrition Labels")**: erhobene Daten deklarieren —
      typischerweise *Identifikatoren (Account), Nutzerinhalte (Chat), Käufe,
      grobe Nutzungsdaten*. Muss zur Datenschutzerklärung passen.
- [ ] **EULA**: Apple-Standard-EULA oder eigene (unsere `agb.html` als Basis).
- [ ] **Altersfreigabe**-Fragebogen: enthält *Gewalt (Kriegsthematik)*, *Chat/UGC*,
      *In-App-Käufe* → voraussichtlich 12+.
- [ ] Screenshots (alle Pflicht-Gerätegrößen), App-Icon, Beschreibung, Keywords,
      Support-URL, Marketing-URL.

### Recht (Betrieb aus DE)
- [ ] **Impressum** mit echten Daten (§ 5 DDG) — Vorlage vorhanden.
- [ ] **Datenschutzerklärung** vervollständigen (Hosting-Anbieter, Region, PayPal
      bzw. Apple, Aufbewahrungsfristen) — Vorlage vorhanden.
- [ ] **AGB/Nutzungsbedingungen** inkl. virtueller Güter & Widerruf — Vorlage vorhanden.
- [ ] **Auftragsverarbeitungs-Verträge (AVV/DPA)** mit allen Dienstleistern
      (Hoster, Upstash/Redis, Zahlungsanbieter).
- [ ] **Verbraucherrecht**: Preisangaben inkl. USt., Widerrufsbelehrung für
      digitale Inhalte, Buttonlösung („zahlungspflichtig bestellen").
- [ ] **Aufbewahrungspflicht** für Rechnungs-/Zahlungsdaten prüfen (z. B. § 147 AO,
      § 257 HGB) — steht im Konflikt mit „alles bei Kontolöschung entfernen";
      ggf. Zahlungsbelege anonymisiert/getrennt aufbewahren statt löschen.

### Technik / Infrastruktur
- [ ] **HTTPS/TLS** durchgängig (App Transport Security verlangt es; PayPal-Live
      sowieso). Der `deploy/Caddyfile` kann das übernehmen.
- [ ] Backend **dauerhaft erreichbar** — Apple-Reviewer testen live gegen den Server.
- [ ] **Privacy Manifest** (`PrivacyInfo.xcprivacy`) im Xcode-Projekt, inkl.
      „Required Reason APIs".
- [ ] Push-Notification-Entitlement (falls Blocker 2 darüber gelöst wird).
- [ ] Keine Debug-/Platzhalter-Features im Build (der „Testmodus" des Shops darf
      im Release nicht aktiv sein).

---

## Empfohlener Weg

1. **Chat-Moderation** nachrüsten (Melden/Blocken/Filter) — nötig, egal welche
   Monetarisierung.
2. **Monetarisierungs-Entscheidung** (A/B/C oben) treffen.
3. **Capacitor-Wrapper** + **Push-Notifications** als nativer Mehrwert.
4. Rechtstexte finalisieren, Developer-Account + App Store Connect einrichten.
5. Einreichen.
