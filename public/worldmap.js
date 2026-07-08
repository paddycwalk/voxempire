// ============================================================
// VOXEMPIRE — Prozedurale Weltkarte im mittelalterlichen
// Kartografie-Stil (Pergament, gemalte Wälder/Berge/Meere,
// Burgen & Dörfer, Kompassrose, verzierter Rahmen).
// Kein Bild-Asset: alles wird pro Feld deterministisch aus
// den Koordinaten gezeichnet, damit die Welt bei jedem
// Scrollen gleich aussieht.
// Öffentliche API: renderWorldMap(tiles, center, R, state, selected)
// ============================================================
"use strict";

const WM = {
  parch: "#e7d3a4", // Pergament hell
  parchD: "#d8bd85", // Pergament mittel
  parchDD: "#b8975a", // Pergament dunkel (Alterung)
  ink: "#5a3d22", // Zeichentusche braun
  inkD: "#3a2814", // Tusche dunkel
  leaf: "#5f7338", // Wald
  leafD: "#47562a",
  trunk: "#6b4a2a",
  rock: "#b39c72", // Berg
  rockD: "#8a734d",
  snow: "#f2e7c8",
  sea: "#7ba0a6", // Meer (gedämpftes Türkis)
  seaD: "#5c848c",
  wave: "#3f6a72",
  stone: "#cbb388", // Burgmauer
  roof: "#a04c40", // Dächer
  roofD: "#7c3a31",
  gold: "#e8b64c", // eigenes Dorf
  blue: "#6ea8dc", // Allianz
};

// ---------- Deterministisches Wert-Rauschen (fBm) ----------
function wmHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function wmNoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = wmHash(xi, yi),
    b = wmHash(xi + 1, yi);
  const c = wmHash(xi, yi + 1),
    d = wmHash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function wmFbm(x, y) {
  let t = 0,
    amp = 0.5,
    f = 1;
  for (let i = 0; i < 4; i++) {
    t += amp * wmNoise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return t;
}
// Höhe (0..1) und Waldwert (0..1) pro Weltfeld
const wmElev = (x, y) => wmFbm(x * 0.16 + 4.2, y * 0.16 + 9.7);
const wmForest = (x, y) => wmFbm(x * 0.33 + 21.5, y * 0.33 + 2.1);

// ---------- Terrain-Piktogramme ----------
function wmTree(cx, cy, s) {
  return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${s})">
    <rect x="-1.1" y="2" width="2.2" height="4.5" fill="${WM.trunk}"/>
    <path d="M0,-9 L6,3 L-6,3 Z" fill="${WM.leaf}" stroke="${WM.leafD}" stroke-width="0.6"/>
    <path d="M0,-4.5 L5,4 L-5,4 Z" fill="${WM.leafD}"/>
  </g>`;
}
function wmForestGlyph(cx, cy) {
  return (
    wmTree(cx - 9, cy + 4, 1.05) +
    wmTree(cx + 8, cy + 5, 0.95) +
    wmTree(cx, cy - 3, 1.25)
  );
}
function wmMountainGlyph(cx, cy) {
  return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">
    <path d="M-15,10 L-4,-11 L4,1 L9,-5 L17,10 Z" fill="${WM.rock}" stroke="${WM.ink}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M-4,-11 L-1,-6 L-8,3 Z" fill="${WM.snow}"/>
    <path d="M9,-5 L11.5,-1 L5.5,2 Z" fill="${WM.snow}"/>
    <path d="M-4,-11 L4,1 L-1,3 Z" fill="${WM.rockD}" opacity="0.55"/>
  </g>`;
}
function wmWaveGlyph(cx, cy) {
  let rows = "";
  for (let r = -1; r <= 1; r++) {
    const y = cy + r * 11 + 2;
    const off = r & 1 ? 7 : 0;
    rows += `<path d="M${(cx - 18 + off).toFixed(1)},${y.toFixed(1)} q4,-4 8,0 t8,0 t8,0" fill="none" stroke="${WM.wave}" stroke-width="1" stroke-linecap="round" opacity="0.5"/>`;
  }
  return rows;
}
function wmGrassGlyph(cx, cy) {
  return `<g stroke="${WM.leafD}" stroke-width="0.9" fill="none" opacity="0.5" stroke-linecap="round">
    <path d="M${cx - 5},${cy + 6} q1,-6 2,-8"/>
    <path d="M${cx},${cy + 6} q0,-7 0,-9"/>
    <path d="M${cx + 5},${cy + 6} q-1,-6 -2,-8"/>
  </g>`;
}

// ---------- Siedlungen ----------
function wmHouse(x, y, s, roof) {
  return `<g transform="translate(${x},${y}) scale(${s})">
    <rect x="-6" y="-2" width="12" height="9" fill="${WM.stone}" stroke="${WM.ink}" stroke-width="0.7"/>
    <path d="M-7.5,-2 L0,-9 L7.5,-2 Z" fill="${roof}" stroke="${WM.ink}" stroke-width="0.7" stroke-linejoin="round"/>
  </g>`;
}
function wmCastle(cx, cy, flag) {
  return `<g transform="translate(${cx},${cy})">
    <ellipse cx="0" cy="16" rx="22" ry="4.5" fill="#00000022"/>
    <rect x="-19" y="-4" width="9" height="20" fill="${WM.stone}" stroke="${WM.ink}" stroke-width="1"/>
    <rect x="10" y="-4" width="9" height="20" fill="${WM.stone}" stroke="${WM.ink}" stroke-width="1"/>
    <path d="M-19,-4 L-14.5,-13 L-10,-4 Z" fill="${WM.roof}" stroke="${WM.ink}" stroke-width="0.8"/>
    <path d="M10,-4 L14.5,-13 L19,-4 Z" fill="${WM.roof}" stroke="${WM.ink}" stroke-width="0.8"/>
    <rect x="-12" y="-2" width="24" height="18" fill="${WM.stone}" stroke="${WM.ink}" stroke-width="1"/>
    <g fill="${WM.stone}" stroke="${WM.ink}" stroke-width="0.8">
      <rect x="-12" y="-8" width="5" height="6"/><rect x="-3.5" y="-8" width="5" height="6"/><rect x="5" y="-8" width="5" height="6"/>
    </g>
    <path d="M-5,16 v-8 a5,5 0 0 1 10,0 v8 Z" fill="${WM.inkD}"/>
    <line x1="0" y1="-8" x2="0" y2="-27" stroke="${WM.ink}" stroke-width="1.4"/>
    <path d="M0,-27 L13,-24 L0,-19.5 Z" fill="${flag}" stroke="${WM.ink}" stroke-width="0.6"/>
  </g>`;
}
function wmChurch(x, y) {
  return `<g transform="translate(${x},${y})">
    <rect x="-4" y="-4" width="8" height="11" fill="${WM.stone}" stroke="${WM.ink}" stroke-width="0.7"/>
    <path d="M-4,-4 L0,-11 L4,-4 Z" fill="${WM.roofD}" stroke="${WM.ink}" stroke-width="0.6"/>
    <line x1="0" y1="-11" x2="0" y2="-16" stroke="${WM.ink}" stroke-width="1.1"/>
    <line x1="-2.5" y1="-14" x2="2.5" y2="-14" stroke="${WM.ink}" stroke-width="1.1"/>
  </g>`;
}
function wmTown(cx, cy, banner) {
  const b = banner
    ? `<line x1="0" y1="-9" x2="0" y2="-22" stroke="${WM.ink}" stroke-width="1.2"/>
       <path d="M0,-22 L10,-20 L0,-16 Z" fill="${banner}" stroke="${WM.ink}" stroke-width="0.5"/>`
    : "";
  return `<g transform="translate(${cx},${cy})">
    <ellipse cx="0" cy="14" rx="20" ry="4" fill="#00000020"/>
    ${wmChurch(-2, 7)}
    ${wmHouse(-13, 10, 1, WM.roof)}
    ${wmHouse(12, 9, 1.05, WM.roofD)}
    ${wmHouse(8, 13, 0.85, WM.roof)}
    ${b}
  </g>`;
}

// ---------- Rohstoffvorkommen (Sammelplätze auf der Karte) ----------
// Klickbare Felder, auf die Bewohner zum Sammeln geschickt werden.
function wmResourceGlyph(cx, cy, res) {
  if (res === "holz") {
    return (
      wmTree(cx - 8, cy + 5, 0.9) +
      wmTree(cx + 8, cy + 6, 0.8) +
      wmTree(cx, cy - 1, 1.1)
    );
  }
  if (res === "stein") {
    return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">
      <path d="M-13,9 L-6,-6 L2,3 L7,-8 L15,9 Z" fill="${WM.rock}" stroke="${WM.ink}" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M-6,-6 L-3,-1 L-9,5 Z" fill="${WM.rockD}" opacity="0.6"/>
      <path d="M7,-8 L9,-3 L4,0 Z" fill="${WM.rockD}" opacity="0.6"/>
    </g>`;
  }
  // eisen: dunkles Gestein mit metallischen Adern
  return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">
    <path d="M-12,9 L-5,-6 L3,3 L8,-8 L14,9 Z" fill="#6b6f78" stroke="${WM.inkD}" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M-5,-6 L-2,-1 L-8,5 Z" fill="#4a4e57" opacity="0.7"/>
    <circle cx="-3" cy="2" r="1.6" fill="#d0a94e"/><circle cx="5" cy="-1" r="1.3" fill="#d0a94e"/><circle cx="0" cy="6" r="1.1" fill="#d0a94e"/>
  </g>`;
}

// Kleine Punkte zeigen die Ergiebigkeit (1..3) eines Vorkommens.
function wmRichnessPips(cx, cy, richness, col) {
  let s = "";
  for (let i = 0; i < richness; i++) {
    const x = cx - (richness - 1) * 3.5 + i * 7;
    s += `<circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.9" fill="${col}" stroke="${WM.inkD}" stroke-width="0.5"/>`;
  }
  return s;
}

// ---------- Truppenbewegungen ----------
// Zeichnet einen sich bewegenden Marker samt Route für eine Bewegung.
// x1/y1 = Start (Pixel), x2/y2 = Ziel (Pixel), col = Farbe,
// frac = bereits zurückgelegter Anteil (0..1), remSec = Restzeit in Sekunden.
function wmMoveGlyph(x1, y1, x2, y2, col, frac, remSec, label) {
  // aktuelle Position aus dem Fortschritt interpolieren
  const cx = x1 + (x2 - x1) * frac;
  const cy = y1 + (y2 - y1) * frac;
  // gestrichelte Route (bereits gelaufen blass, Rest kräftiger)
  const line = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
      stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-dasharray="6 6" opacity="0.55">
      <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.7s" repeatCount="indefinite"/>
    </line>`;
  // Zielmarkierung (kleines Fadenkreuz)
  const goal = `<g transform="translate(${x2.toFixed(1)},${y2.toFixed(1)})" opacity="0.8">
      <circle r="5" fill="none" stroke="${col}" stroke-width="1.4"/>
      <line x1="-8" y1="0" x2="8" y2="0" stroke="${col}" stroke-width="1"/>
      <line x1="0" y1="-8" x2="0" y2="8" stroke="${col}" stroke-width="1"/>
    </g>`;
  // Marker: farbiger Kreis + Pfeil in Laufrichtung (+x), per animateMotion bewegt.
  // Der Marker startet an der aktuellen Position und läuft in der Restzeit zum Ziel.
  const dur = Math.max(0.5, remSec).toFixed(1);
  const cap = label
    ? `<text x="0" y="-12" text-anchor="middle" font-size="9" font-family="Georgia,serif" font-weight="700" fill="${col}" stroke="#fff" stroke-width="2.4" paint-order="stroke" opacity="0.95">${label}</text>`
    : "";
  const marker = `<g>
      <animateMotion dur="${dur}s" fill="freeze" rotate="auto"
        path="M ${cx.toFixed(1)},${cy.toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)}"/>
      <circle r="8.5" fill="${col}" stroke="#3a2814" stroke-width="1.3"/>
      <path d="M-3.5,-4.5 L4.5,0 L-3.5,4.5 L-1,0 Z" fill="#fff"/>
    </g>`;
  // Beschriftung soll nicht mitrotieren → separater Marker ohne rotate für den Text.
  const capMarker = cap
    ? `<g>
        <animateMotion dur="${dur}s" fill="freeze"
          path="M ${cx.toFixed(1)},${cy.toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)}"/>
        ${cap}
      </g>`
    : "";
  return `<g class="wm-move">${line}${goal}${marker}${capMarker}</g>`;
}

// ---------- Kompassrose ----------
function wmCompass(cx, cy, r) {
  const pt = (ang, rad) => {
    const a = ((ang - 90) * Math.PI) / 180;
    return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
  };
  let star = "";
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    const long = i % 2 === 0;
    const rad = long ? r : r * 0.5;
    const w = long ? 6 : 4;
    const fill = i % 4 === 0 ? WM.ink : WM.parchDD;
    star += `<polygon points="${pt(a, rad)} ${pt(a + w, rad * 0.34)} ${pt(a - w, rad * 0.34)}" fill="${fill}" stroke="${WM.inkD}" stroke-width="0.4"/>`;
  }
  return `<g opacity="0.92">
    <circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="${WM.parch}" opacity="0.55"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${WM.ink}" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${WM.ink}" stroke-width="0.5"/>
    ${star}
    <circle cx="${cx}" cy="${cy}" r="2.4" fill="${WM.ink}"/>
    <text x="${cx}" y="${(cy - r - 9).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${WM.inkD}" font-family="Georgia,serif">N</text>
  </g>`;
}

// ---------- Hauptfunktion ----------
function renderWorldMap(tiles, nodes, center, R, state, selected, selNode) {
  const CELL = 58,
    M = 46;
  const N = 2 * R + 1;
  const inner = N * CELL;
  const W = inner + 2 * M;
  const px = (d) => M + (d + R + 0.5) * CELL;
  const edge = (d) => M + (d + R) * CELL;

  const byPos = {};
  for (const t of tiles) byPos[`${t.x},${t.y}`] = t;

  const myName = state.user.name;
  const myTag = state.user.allianceTag;

  let sea = "",
    land = "",
    vills = "",
    ruler = "";

  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const wx = center.x + dx,
        wy = center.y + dy;
      const cx = px(dx),
        cy = px(dy);
      const t = byPos[`${wx},${wy}`];

      if (t) {
        // Feld mit Dorf: immer Land + Grasbüschel
        land += wmGrassGlyph(cx, cy);
      } else {
        const e = wmElev(wx, wy);
        if (e < 0.4) {
          sea += `<rect x="${(edge(dx) - 1).toFixed(1)}" y="${(edge(dy) - 1).toFixed(1)}" width="${CELL + 2}" height="${CELL + 2}" fill="url(#wmSea)"/>`;
          sea += wmWaveGlyph(cx, cy);
        } else if (e > 0.7) {
          land += wmMountainGlyph(cx, cy);
        } else if (wmForest(wx, wy) > 0.58) {
          land += wmForestGlyph(cx, cy);
        } else if (wmHash(wx * 7.3, wy * 3.1) > 0.72) {
          land += wmGrassGlyph(cx, cy);
        }
      }
    }
  }

  // Dörfer + Beschriftung (über dem Terrain)
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const wx = center.x + dx,
        wy = center.y + dy;
      const t = byPos[`${wx},${wy}`];
      if (!t) continue;
      const cx = px(dx),
        cy = px(dy);
      const own = t.owner === myName;
      const ally = !own && myTag && t.alliance === myTag;
      const isSel = selected && selected.x === t.x && selected.y === t.y;

      let glyph, col;
      if (own) {
        glyph = wmCastle(cx, cy - 2, WM.gold);
        col = WM.gold;
      } else if (ally) {
        glyph = wmTown(cx, cy, WM.blue);
        col = WM.blue;
      } else {
        glyph = wmTown(cx, cy, t.protected ? "#9fb0c4" : WM.roof);
        col = WM.inkD;
      }

      const shield = t.protected
        ? `<path d="M${cx},${cy - 20} l9,3 v6 q0,7 -9,11 q-9,-4 -9,-11 v-6 Z" fill="#cfd8e6" stroke="${WM.ink}" stroke-width="1" opacity="0.9"/>
           <path d="M${cx},${cy - 20} l9,3 v6 q0,7 -9,11 Z" fill="#aab8cc" opacity="0.9"/>`
        : "";
      const ring = isSel
        ? `<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="${WM.gold}" stroke-width="2.2"/>`
        : "";

      // Adelungs-Fortschritt (eigene Paladin-Angriffe): kleines Krönchen-Banner
      const conq = t.conquest
        ? `<g transform="translate(${cx},${(cy - 30).toFixed(1)})">
             <rect x="-15" y="-9" width="30" height="15" rx="4" fill="#3a2626" stroke="${WM.gold}" stroke-width="1"/>
             <text x="0" y="2.5" text-anchor="middle" font-size="10" font-family="Georgia,serif" font-weight="700" fill="${WM.gold}">👑${t.conquest.progress}/${t.conquest.needed}</text>
           </g>`
        : "";

      const name = esc(t.owner);
      vills += `<g class="wm-village" onclick='selectTile(${JSON.stringify(t)})'>
        <rect class="wm-hit" x="${(cx - CELL / 2).toFixed(1)}" y="${(cy - CELL / 2).toFixed(1)}" width="${CELL}" height="${CELL}" rx="4" fill="transparent"/>
        ${ring}${glyph}${shield}${conq}
        <g class="wm-label">
          <text x="${cx}" y="${(cy + 27).toFixed(1)}" text-anchor="middle" font-size="10.5" font-family="Georgia,'Times New Roman',serif" font-style="italic" fill="#fff" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" opacity="0.7">${name}</text>
          <text x="${cx}" y="${(cy + 27).toFixed(1)}" text-anchor="middle" font-size="10.5" font-family="Georgia,'Times New Roman',serif" font-style="italic" fill="${col}" font-weight="600">${name}</text>
        </g>
      </g>`;
    }
  }

  // Rohstoffvorkommen (klickbare Sammelplätze) über dem Terrain, unter den Bewegungen
  const NODE_COL = { holz: "#4d7a2e", stein: "#7d848f", eisen: "#c9962f" };
  const NODE_LABEL = { holz: "Wald", stein: "Steinbruch", eisen: "Eisenader" };
  let nodesLayer = "";
  for (const n of nodes || []) {
    const dx = n.x - center.x,
      dy = n.y - center.y;
    if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
    const cx = px(dx),
      cy = px(dy);
    const col = NODE_COL[n.res] || WM.inkD;
    const isSel = selNode && selNode.x === n.x && selNode.y === n.y;
    const ring = isSel
      ? `<circle cx="${cx}" cy="${cy}" r="24" fill="none" stroke="${col}" stroke-width="2.4"/>`
      : "";
    const label = NODE_LABEL[n.res] || "Vorkommen";
    nodesLayer += `<g class="wm-node" onclick='selectNode(${JSON.stringify(n)})'>
      <rect class="wm-hit" x="${(cx - CELL / 2).toFixed(1)}" y="${(cy - CELL / 2).toFixed(1)}" width="${CELL}" height="${CELL}" rx="4" fill="transparent"/>
      ${ring}${wmResourceGlyph(cx, cy, n.res)}
      ${wmRichnessPips(cx, cy + 15, n.richness, col)}
      <g class="wm-label">
        <text x="${cx}" y="${(cy + 28).toFixed(1)}" text-anchor="middle" font-size="9.5" font-family="Georgia,'Times New Roman',serif" font-style="italic" fill="#fff" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" opacity="0.7">${label}</text>
        <text x="${cx}" y="${(cy + 28).toFixed(1)}" text-anchor="middle" font-size="9.5" font-family="Georgia,'Times New Roman',serif" font-style="italic" fill="${col}" font-weight="600">${label}</text>
      </g>
    </g>`;
  }

  // Truppenbewegungen (nur Bewegungen, die das eigene Dorf betreffen)
  // Weltkoordinate → Pixel (Feldmitte); Ziele außerhalb des Fensters werden
  // vom SVG-Viewport abgeschnitten, die Route zeigt trotzdem die Richtung.
  const wxp = (wx) => M + (wx - center.x + R + 0.5) * CELL;
  const wyp = (wy) => M + (wy - center.y + R + 0.5) * CELL;
  const now = (state && state.serverTime) || Date.now();
  const moveCol = {
    attack: "#c0392b",
    scout: "#3b6ea5",
    return: "#4b7a3a",
    gather: "#b8860b",
    gatherReturn: "#4b7a3a",
  };
  const unitTotal = (u) =>
    u ? Object.values(u).reduce((a, b) => a + (b || 0), 0) : 0;
  let moves = "";
  const mv = (state && state.movements) || { incoming: [], outgoing: [] };
  const drawMove = (m, incoming) => {
    if (m.fromX == null || m.toX == null || m.toX === undefined) return;
    const x1 = wxp(m.fromX),
      y1 = wyp(m.fromY);
    const x2 = wxp(m.toX),
      y2 = wyp(m.toY);
    const total = m.start ? m.at - m.start : 0;
    const frac =
      total > 0 ? Math.min(1, Math.max(0, (now - m.start) / total)) : 0;
    const remSec = Math.max(0, (m.at - now) / 1000);
    const col = incoming ? moveCol.attack : moveCol[m.type] || moveCol.attack;
    const label = incoming
      ? ""
      : m.type === "gather"
        ? String(m.workers || "")
        : m.type === "return" || m.type === "gatherReturn"
          ? ""
          : String(unitTotal(m.units) || "");
    moves += wmMoveGlyph(x1, y1, x2, y2, col, frac, remSec, label);
  };
  for (const m of mv.incoming || []) drawMove(m, true);
  for (const m of mv.outgoing || []) drawMove(m, false);

  // Koordinaten-Lineal am Rand
  for (let d = -R; d <= R; d++) {
    const wx = center.x + d,
      wy = center.y + d,
      p = px(d);
    ruler += `<text x="${p}" y="${M - 6}" text-anchor="middle" font-size="10" fill="${WM.ink}" font-family="Georgia,serif" opacity="0.75">${wx}</text>`;
    ruler += `<text x="${M - 8}" y="${(p + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${WM.ink}" font-family="Georgia,serif" opacity="0.75">${wy}</text>`;
  }

  // feines Kartografengitter
  let grid = `<g stroke="${WM.ink}" stroke-width="0.5" opacity="0.16">`;
  for (let i = 0; i <= N; i++) {
    grid += `<line x1="${M + i * CELL}" y1="${M}" x2="${M + i * CELL}" y2="${M + inner}"/>`;
    grid += `<line x1="${M}" y1="${M + i * CELL}" x2="${M + inner}" y2="${M + i * CELL}"/>`;
  }
  grid += "</g>";

  const compass = wmCompass(M + inner - 40, M + inner - 40, 20);

  // verzierter Rahmen
  const frame = `
    <rect x="4" y="4" width="${W - 8}" height="${W - 8}" fill="none" stroke="${WM.inkD}" stroke-width="4"/>
    <rect x="10" y="10" width="${W - 20}" height="${W - 20}" fill="none" stroke="${WM.ink}" stroke-width="1.2"/>
    ${[
      [10, 10],
      [W - 10, 10],
      [10, W - 10],
      [W - 10, W - 10],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="5.5" fill="${WM.parchDD}" stroke="${WM.inkD}" stroke-width="1.2"/>`,
      )
      .join("")}`;

  return `
  <svg id="worldMap" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weltkarte">
    <defs>
      <radialGradient id="wmParch" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0" stop-color="${WM.parch}"/>
        <stop offset="0.7" stop-color="${WM.parchD}"/>
        <stop offset="1" stop-color="${WM.parchDD}"/>
      </radialGradient>
      <radialGradient id="wmSea" cx="0.5" cy="0.4" r="0.7">
        <stop offset="0" stop-color="${WM.sea}"/>
        <stop offset="1" stop-color="${WM.seaD}"/>
      </radialGradient>
      <filter id="wmPaper" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.06 0"/>
        <feComposite operator="over" in2="SourceGraphic"/>
      </filter>
      <radialGradient id="wmVignette" cx="0.5" cy="0.5" r="0.72">
        <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="${WM.inkD}" stop-opacity="0.32"/>
      </radialGradient>
    </defs>

    <rect x="0" y="0" width="${W}" height="${W}" fill="url(#wmParch)"/>
    <rect x="0" y="0" width="${W}" height="${W}" filter="url(#wmPaper)" opacity="0.6"/>
    ${sea}
    ${land}
    ${nodesLayer}
    ${grid}
    ${vills}
    ${moves}
    ${compass}
    <rect x="0" y="0" width="${W}" height="${W}" fill="url(#wmVignette)" pointer-events="none"/>
    ${ruler}
    ${frame}
  </svg>`;
}
