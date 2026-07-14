// ============================================================
// VOXEMPIRE — E-Mail-Versand (Abstraktion)
//
// Versendet Bestätigungs- und Passwort-Reset-Mails. Wie PayPal/Push
// dependency-frei über den eingebauten fetch. Aktiv, sobald MAIL_API_KEY
// und MAIL_FROM gesetzt sind; sonst „Testmodus": die Mail wird nur geloggt
// (der Link kommt im Testmodus in der API-Antwort zurück, damit man ohne
// Mail-Anbieter entwickeln kann).
//
// Umgebungsvariablen:
//   MAIL_PROVIDER   "resend" (Default) — weitere Anbieter hier ergänzbar
//   MAIL_API_KEY    API-Key des Anbieters
//   MAIL_FROM       Absender, z. B. "VOXEMPIRE <no-reply@deine-domain.de>"
//   APP_BASE_URL    Basis-URL für Links, z. B. "https://deine-domain.de"
// ============================================================

const PROVIDER = (process.env.MAIL_PROVIDER || "resend").toLowerCase();
const API_KEY = process.env.MAIL_API_KEY || "";
const FROM = process.env.MAIL_FROM || "";

// Basis-URL für Bestätigungs-/Reset-Links (ohne abschließenden Slash).
export const APP_BASE_URL = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");

// Echter Versand nur mit Key + Absender; sonst Testmodus.
export const mailConfigured = Boolean(API_KEY && FROM);

// Verschickt eine Mail. Liefert { testMode: true } (nur geloggt) oder { sent: true }.
export async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured) {
    console.log(`[MAIL:TESTMODE] → ${to} | ${subject}`);
    return { testMode: true };
  }
  if (PROVIDER === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`E-Mail-Versand fehlgeschlagen (${res.status}). ${detail}`);
    }
    return { sent: true };
  }
  throw new Error(`Unbekannter MAIL_PROVIDER: ${PROVIDER}`);
}
