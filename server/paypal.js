// ============================================================
// VOXEMPIRE — PayPal-Anbindung (Orders v2 REST-API)
//
// Bezahlung mit Echtgeld im Item-Shop. Nutzt ausschließlich den
// in Node 18+ eingebauten fetch — keine npm-Pakete. Aktiv, sobald
// PAYPAL_CLIENT_ID und PAYPAL_SECRET gesetzt sind; sonst läuft der
// Shop im „Testmodus" (Käufe werden ohne echte Zahlung simuliert).
//
// Umgebungsvariablen:
//   PAYPAL_ENV     "sandbox" (Default) oder "live"
//   PAYPAL_CLIENT_ID   Client-ID der PayPal-REST-App
//   PAYPAL_SECRET      Secret der PayPal-REST-App
// ============================================================

const ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE =
  ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const SECRET =
  process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET || "";

// Shop läuft mit echter Bezahlung nur, wenn beide Zugangsdaten vorliegen.
export const paypalConfigured = Boolean(CLIENT_ID && SECRET);
export const paypalClientId = () => CLIENT_ID;
export const paypalEnv = () => ENV;

// OAuth2-Access-Token per Client-Credentials holen.
async function accessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok)
    throw new Error(`PayPal-Authentifizierung fehlgeschlagen (${res.status}).`);
  return (await res.json()).access_token;
}

// Neue Bestellung anlegen (intent CAPTURE). Liefert das PayPal-Order-Objekt.
export async function createOrder({
  value,
  currency = "EUR",
  description,
  reference,
}) {
  const token = await accessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: Number(value).toFixed(2),
          },
          description: description
            ? String(description).slice(0, 127)
            : undefined,
          custom_id: reference ? String(reference).slice(0, 127) : undefined,
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data?.message || `PayPal-Bestellung fehlgeschlagen (${res.status}).`,
    );
  return data;
}

// Bestellung einziehen (Geld tatsächlich buchen). Liefert das Capture-Objekt.
export async function captureOrder(orderId) {
  const token = await accessToken();
  const res = await fetch(
    `${BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data?.message || `PayPal-Zahlungseinzug fehlgeschlagen (${res.status}).`,
    );
  return data;
}
