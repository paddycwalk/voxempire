// ============================================================
// VOXEMPIRE — Push-Benachrichtigungen (Abstraktion)
//
// Speichert Geräte-Tokens (das funktioniert sofort) und versendet
// Benachrichtigungen an iOS (APNs) bzw. Android (FCM). Der Versand ist
// bewusst als konfigurierbarer Platzhalter angelegt: Ohne hinterlegte
// Zugangsdaten passiert nichts (kein Fehler, kein Spam). Die Einrichtung
// (APNs-Key, Team-/Bundle-ID) ist in CAPACITOR.md beschrieben.
//
// Warum kein npm-Paket? Der Rest des Projekts kommt ohne Dependencies aus.
// APNs lässt sich mit dem eingebauten `crypto` (ES256-JWT) + `fetch` über
// HTTP/2 ansprechen — der konkrete Sende-Code gehört hierher, sobald die
// Zugangsdaten stehen (Marker „TODO(APNs)" unten).
// ============================================================

const APNS_KEY_ID = process.env.APNS_KEY_ID || "";
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || "";
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || "";
const APNS_KEY = process.env.APNS_KEY || ""; // Inhalt der .p8-Datei

// Aktiv, sobald alle vier Werte gesetzt sind. Solange false → No-Op-Versand.
export const pushConfigured = Boolean(
  APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE_ID && APNS_KEY,
);

// Eine Benachrichtigung an alle Geräte eines Nutzers schicken.
// Fire-and-forget: wirft nie, blockiert nie den Spielablauf.
export async function sendToUser(user, { title, body, data } = {}) {
  try {
    const tokens = (user?.pushTokens || []).map((t) => t.token).filter(Boolean);
    if (!tokens.length) return;
    if (!pushConfigured) {
      // Noch keine Zugangsdaten → hier landet der Versand später.
      // TODO(APNs): ES256-JWT signieren und je Token an
      // https://api.push.apple.com/3/device/<token> POSTen
      // (bzw. FCM für Android). Siehe CAPACITOR.md.
      return;
    }
    // TODO(APNs): echter Versand.
  } catch {
    /* Push darf den Spielablauf nie stören */
  }
}
