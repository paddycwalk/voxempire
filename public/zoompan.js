// ============================================================
// VOXEMPIRE — Zoom & Verschieben NUR für Dorf- und Karten-SVG.
// Mobile: Pinch zum Zoomen, ein Finger zum Verschieben (bei Zoom > 1).
// Desktop: Mausrad zum Zoomen, Ziehen zum Verschieben.
// Doppeltipp/Doppelklick setzt den Zoom zurück.
// Der Rest der Oberfläche bleibt unberührt (kein Seiten-Zoom).
// Zustand wird pro Container gemerkt, damit ein Neuzeichnen
// (z. B. Ausbau, Kartenwechsel) den Zoom nicht zurücksetzt.
// Öffentliche API: enableZoomPan(container, key)
// ============================================================
"use strict";

(function () {
  const MIN = 1; // nicht kleiner als Originalgröße
  const MAX = 4; // maximale Vergrößerung
  const TAP = 6; // Bewegungsschwelle (px), darunter zählt es als Klick/Tipp

  // key -> { s, tx, ty } — überlebt das Neuzeichnen des Containers
  const store = Object.create(null);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // onWorldPan(dxCells, dyCells): optional. Wird beim Loslassen aufgerufen,
  // wenn bei Zoom = 1 gezogen wurde, um das Weltzentrum zu verschieben.
  // cellSize: Kantenlänge eines Feldes in Pixeln (zur Umrechnung Zug → Felder).
  function enableZoomPan(container, key, onWorldPan, cellSize) {
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;
    const CELL = cellSize || 58;

    const st = store[key] || (store[key] = { s: 1, tx: 0, ty: 0 });

    svg.style.transformOrigin = "0 0";
    svg.style.willChange = "transform";
    container.style.touchAction = "none"; // Browser-Gesten (Seiten-Zoom/Scroll) hier unterdrücken

    // Transform anwenden + Verschiebung so begrenzen, dass der Inhalt den Container füllt.
    function apply() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight ||| onWorldPan | 1;
      st.tx = clamp(st.tx, w * (1 - st.s), 0);
      st.ty = clamp(st.ty, h * (1 - st.s), 0);
      svg.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.s})`;
      container.style.cursor = st.s > 1 ? "grab" : "";
    }

    // Zoomen um einen festen Punkt (fx, fy) in Container-Koordinaten.
    function zoomAt(fx, fy, nextS) {
      nextS = clamp(nextS, MIN, MAX);
      const f = nextS / st.s;
      st.tx = fx - f * (fx - st.tx);
      st.ty = fy - f * (fy - st.ty);
      st.s = nextS;
      apply();
    }

    // Bereits verdrahtet (derselbe DOM-Knoten, z. B. günstiges Refresh)? Nur neu anwenden.
    if (container.dataset.zoomPan === "1") {
      apply();
      return;
    }
    container.dataset.zoomPan = "1";

    apply();

    const pointers = new Map(); // pointerId -> {x, y} in Container-Koordinaten
    let panStart = null; // { x, y, tx, ty } für Ein-Finger/Maus-Verschieben
    let pinch = null; // { dist, mid, s, tx, ty } Ausgangslage der Pinch-Geste
    let moved = false; // wurde nennenswert bewegt? (unterdrückt Klick)
    let lastTap = 0;
    let worldDX = 0,
      worldDY = 0; // laufender Zug in Pixeln beim Welt-Verschieben (Zoom = 1)

    const local = (e) => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    container.addEventListener("pointerdown", (e) => {
      const p = local(e);
      pointers.set(e.pointerId, p);
      // Wichtig: hier NICHT sofort setPointerCapture aufrufen — sonst wird der
      // folgende click auf den Container statt auf das angeklickte SVG-Element
      // umgeleitet und die onclick-Handler (Dorf/Vorkommen) feuern nie.
      // Der Pointer wird erst bei einer echten Geste (Ziehen/Pinch) eingefangen.

      if (pointers.size === 1) {
        panStart = { x: p.x, y: p.y, tx: st.tx, ty: st.ty };
        moved = false;
        // Doppeltipp/-klick → Zoom zurücksetzen
        const now = Date.now();
        if (now - lastTap < 300) {
          st.s = 1;
          st.tx = 0;
          st.ty = 0;
          apply();
          lastTap = 0;
        } else {
          lastTap = now;
        }
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinch = {
          dist: dist(pts[0], pts[1]),
          mid: mid(pts[0], pts[1]),
          s: st.s,
          tx: st.tx,
          ty: st.ty,
        };
        moved = true; // Zwei Finger sind nie ein Klick
        // Zwei Finger = Geste (nie ein Klick): Pointer jetzt einfangen, damit
        // Bewegungen ausserhalb des SVG weiter ankommen.
        for (const id of pointers.keys()) {
          try {
            container.setPointerCapture(id);
          } catch {
            /* egal */
          }
        }
      }
    });

    container.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size >= 2 && pinch) {
        const pts = [...pointers.values()];
        const d = dist(pts[0], pts[1]);
        const m = mid(pts[0], pts[1]);
        const factor = d / (pinch.dist || 1);
        const nextS = clamp(pinch.s * factor, MIN, MAX);
        const f = nextS / pinch.s;
        // Um den ursprünglichen Mittelpunkt zoomen …
        st.tx = pinch.mid.x - f * (pinch.mid.x - pinch.tx);
        st.ty = pinch.mid.y - f * (pinch.mid.y - pinch.ty);
        // … und zusätzlich mit den Fingern verschieben.
        st.tx += m.x - pinch.mid.x;
        st.ty += m.y - pinch.mid.y;
        st.s = nextS;
        apply();
        e.preventDefault();
      } else if (pointers.size === 1 && panStart && st.s > 1) {
        const dx = p.x - panStart.x;
        const dy = p.y - panStart.y;
        if (!moved && Math.hypot(dx, dy) > TAP) {
          moved = true;
          // Echtes Ziehen erkannt (kein Klick): Pointer jetzt einfangen, damit
          // das Verschieben auch ausserhalb des SVG weiterläuft.
          try {
            container.setPointerCapture(e.pointerId);
          } catch {
            /* egal */
          }
        }
        if (moved) {
          st.tx = panStart.tx + dx;
          st.ty = panStart.ty + dy;
          apply();
          container.style.cursor = "grabbing";
          e.preventDefault();
        }
      } else if (pointers.size === 1 && panStart && onWorldPan) {
        // Zoom = 1: die ganze Weltkarte verschieben. Live-Vorschau per Transform,
        // beim Loslassen wird der Zug in Felder umgerechnet (siehe endPointer).
        const dx = p.x - panStart.x;
        const dy = p.y - panStart.y;
        if (!moved && Math.hypot(dx, dy) > TAP) {
          moved = true;
          try {
            container.setPointerCapture(e.pointerId);
          } catch {
            /* egal */
          }
        }
        if (moved) {
          worldDX = dx;
          worldDY = dy;
          svg.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
          container.style.cursor = "grabbing";
          e.preventDefault();
        }
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        panStart = null;
        // Welt-Zug abschließen: Pixel → Felder umrechnen und Zentrum verschieben.
        if (worldDX !== 0 || worldDY !== 0) {
          const cx = Math.round(-worldDX / CELL);
          const cy = Math.round(-worldDY / CELL);
          worldDX = 0;
          worldDY = 0;
          if ((cx || cy) && onWorldPan) {
            onWorldPan(cx, cy); // löst Neuzeichnen mit neuem Zentrum aus
          } else {
            // Zu kleiner Zug: Vorschau zurücksetzen.
            svg.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.s})`;
          }
        }
        if (st.s > 1 || onWorldPan) container.style.cursor = "grab";
      }
    }
    container.addEventListener("pointerup", endPointer);
    container.addEventListener("pointercancel", endPointer);

    // Nach einer Verschiebung/Pinch den folgenden Klick schlucken,
    // damit nicht versehentlich ein Gebäude/Feld ausgewählt wird.
    container.addEventListener(
      "click",
      (e) => {
        if (moved) {
          moved = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );

    // Mausrad-Zoom (Desktop) um den Cursor herum.
    container.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = local(e);
        const step = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAt(p.x, p.y, st.s * step);
      },
      { passive: false },
    );
  }

  window.enableZoomPan = enableZoomPan;
})();
