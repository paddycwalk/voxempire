// ============================================================
// VOXEMPIRE — Push-Registrierung (Client)
//
// Läuft NUR in der nativen App (Capacitor). Im normalen Browser ist alles
// ein No-Op, weil window.Capacitor fehlt. Beim ersten Spielstart wird um die
// Push-Erlaubnis gebeten; das Geräte-Token geht an /api/push/register.
//
// Voraussetzung im nativen Build: Plugin @capacitor/push-notifications
// (siehe CAPACITOR.md). Wir sprechen es über die globale Plugin-Registry an,
// damit dieselbe Datei unverändert im Web ausgeliefert werden kann.
// ============================================================
window.initPush = async function initPush(apiFn) {
  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform())
    return; // Browser → nichts tun
  const Push = Cap.Plugins && Cap.Plugins.PushNotifications;
  if (!Push) return;
  try {
    const perm = await Push.requestPermissions();
    if (perm.receive !== "granted") return;
    await Push.register();
    Push.addListener("registration", (t) => {
      apiFn("/api/push/register", {
        token: t.value,
        platform: (Cap.getPlatform && Cap.getPlatform()) || "ios",
      }).catch(() => {});
    });
    Push.addListener("registrationError", (e) =>
      console.warn("Push-Registrierung fehlgeschlagen:", e),
    );
  } catch (e) {
    console.warn("Push nicht verfügbar:", e);
  }
};
