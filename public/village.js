// ============================================================
// VOXEMPIRE — Prozedurale Dorf-Szene in ISO-Perspektive (SVG).
// Mittelalterlicher Look (kein Comic): gedeckte, erdige Farben,
// Fachwerk mit Lehmputz, Bruchstein mit Fugen, Holzschindel-,
// Schiefer- und Strohdächer, ein gepflasterter Marktplatz und
// ringsum ein kleiner Wald mit Teich. Die Insel ist größer als
// zuvor (7×7-Kachelring). Jedes Gebäude steht auf einer eigenen
// Kachel, wächst mit der Stufe, ist klickbar und zeigt Baustellen.
// Öffentliche API: renderVillageScene(state, meta, selectedKey)
// ============================================================
"use strict";

// ---------- Farbpalette (gedeckt, mittelalterlich) ----------
const VS = {
  // Boden
  grass: "#6f8a45",
  grassD: "#57703a",
  grassL: "#89a45c",
  grassEdge: "#3e5227",
  soil: "#7c5a38",
  soilD: "#4c3820",
  cobble: "#928c7e",
  cobbleD: "#6d685c",
  cobbleL: "#aca595",
  path: "#8b7350",
  pathD: "#6a563a",
  // Holz / Fachwerk
  wood: "#7d5e3c",
  woodD: "#4f3922",
  woodL: "#9a7a4e",
  plaster: "#d3c6aa",
  plasterD: "#b7a888",
  plasterL: "#e6dcc4",
  // Stein
  stone: "#8b919d",
  stoneD: "#595f6b",
  stoneL: "#aab0bb",
  mortar: "#6b7078",
  // Dächer
  shingle: "#6e4a30",
  shingleD: "#472e1c",
  shingleL: "#8a5f3e",
  slate: "#4f5866",
  slateD: "#343b46",
  slateL: "#6d7684",
  thatch: "#b19a63",
  thatchD: "#897548",
  thatchL: "#cab577",
  // Diverses
  win: "#ffd98a",
  leaf: "#4d7a38",
  leafD: "#2e4b20",
  leafL: "#6f9c4a",
  pine: "#3f6330",
  pineD: "#274018",
  water: "#3f7fa8",
  waterD: "#2a597a",
  waterL: "#7fb4d6",
  dark: "#241d17",
  cloth1: "#9c4a3f",
  cloth1L: "#b5675a",
  cloth2: "#4a6f7c",
  cloth2L: "#628f9c",
};

// ---------- Iso-Geometrie ----------
const HW = 80,
  HH = 40; // halbe Kachel (Vollkachel 160×80, Verhältnis 2:1)
const OX = 800,
  OY = 250; // Bildschirm-Ursprung (Kachel 0,0)
const RIM = 26; // Höhe des Erdrands der Insel
const LO = -2,
  HI = 6; // Kachelbereich der Insel (9×9)
const VBW = 1600,
  VBH = 880; // viewBox-Maße

// Kachel (Spalte c, Reihe r) → Bildschirmkoordinate (Mitte)
const iso = (c, r) => [OX + (c - r) * HW, OY + (c + r) * HH];

// Gebäude-Raster (3×3) auf jeder zweiten Kachel — die Zwischenkacheln
// bleiben freier Pflasterplatz, damit die Gebäude Abstand haben.
// Vorderste Kachel (4,4) = Tor/Mauer.
const GRID = {
  eisen: [0, 0],
  stein: [2, 0],
  kaserne: [4, 0],
  holz: [0, 2],
  rathaus: [2, 2],
  farm: [4, 2],
  markt: [0, 4],
  lager: [2, 4],
  mauer: [4, 4],
};

// ---------- Kachel-Klassifikation ----------
const key2 = (c, r) => `${c},${r}`;
const inGrid = (c, r) => c >= 0 && c <= 4 && r >= 0 && r <= 4; // gepflasterter Hof
const PATH = new Set(["5,5", "6,6"]); // Weg aus dem Tor
const POND = new Set(["-2,4", "-2,5", "-1,5", "-1,4"]); // Teich (Südwesten)
const ROCK = new Set(["-2,-2", "5,-2", "-2,1", "6,5"]);
const FLOWERS = new Set(["0,5", "5,0", "-1,-1", "6,2"]);
// Kacheln direkt vor dem Tor bleiben baumfrei, damit die Sicht offen ist
const NOTREE = new Set(["4,5", "5,4", ...PATH, ...POND, ...ROCK, ...FLOWERS]);

// deterministischer Baum-Bewuchs auf den Ringkacheln
function hasTree(c, r) {
  if (inGrid(c, r) || NOTREE.has(key2(c, r))) return false;
  let s = (((c + 8) * 73856093) ^ ((r + 8) * 19349663)) >>> 0;
  return s % 100 < 66;
}

// ---------- Zeichen-Helfer ----------
const pts = (arr) =>
  arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const P = (arr, f, extra = "") =>
  `<polygon points="${pts(arr)}" fill="${f}"${extra}/>`;
const C = (x, y, r, f, extra = "") =>
  `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${f}"${extra}/>`;
const L = (a, b, col, w = 2) =>
  `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${col}" stroke-width="${w}"/>`;
const up = (p, h) => [p[0], p[1] - h];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Grundflächen-Eckpunkte eines iso-Quaders (relativ zur Kachel-Mitte)
function corners(sc, sr, yb = 0) {
  return {
    front: [(sc - sr) * HW, (sc + sr) * HH + yb],
    right: [(sc + sr) * HW, (sc - sr) * HH + yb],
    back: [-(sc - sr) * HW, -(sc + sr) * HH + yb],
    left: [-(sc + sr) * HW, -(sc - sr) * HH + yb],
  };
}

// Iso-Quader: linke Front, rechte Front und Deckfläche
function prism(sc, sr, h, top, left, right, yb = 0) {
  const b = corners(sc, sr, yb);
  const ft = up(b.front, h),
    rt = up(b.right, h),
    bt = up(b.back, h),
    lt = up(b.left, h);
  return (
    P([b.left, b.front, ft, lt], left) +
    P([b.front, b.right, rt, ft], right) +
    P([bt, rt, ft, lt], top)
  );
}

// Pyramidendach (Walmdach)
function roof(sc, sr, rh, cl, cr, yb = 0) {
  const b = corners(sc, sr, yb);
  const apex = [0, yb - rh];
  return P([b.left, b.front, apex], cl) + P([b.front, b.right, apex], cr);
}

// Schindel-/Schieferdach mit Reihen-Textur und First
function roofSh(sc, sr, rh, cl, cr, yb = 0) {
  const b = corners(sc, sr, yb);
  const apex = [0, yb - rh];
  let s = P([b.left, b.front, apex], cl) + P([b.front, b.right, apex], cr);
  for (let t = 0.2; t < 0.92; t += 0.19) {
    const lp = lerp(b.left, apex, t),
      fp = lerp(b.front, apex, t),
      rp = lerp(b.right, apex, t);
    s += `<polyline points="${pts([lp, fp, rp])}" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="1.2"/>`;
  }
  s += L(b.front, apex, "rgba(0,0,0,0.22)", 1.2);
  return s;
}

// Fachwerk-Balken auf einer Wandfläche (untere Kante a→b, Höhe h)
function frame(a, b, h, col = VS.woodD) {
  const at = up(a, h),
    bt = up(b, h);
  const mb = mid(a, b),
    mt = mid(at, bt);
  const rail = [lerp(a, at, 0.5), lerp(b, bt, 0.5)];
  return (
    L(a, at, col, 2.6) +
    L(b, bt, col, 2.6) + // Eckpfosten
    L(mb, mt, col, 2.2) + // Mittelpfosten
    L(rail[0], rail[1], col, 2.2) + // Querriegel
    L(a, mt, col, 1.8) +
    L(b, mt, col, 1.8) // Andreaskreuz-Streben
  );
}

// Fachwerk auf beiden Frontflächen eines Quaders
function timber(sc, sr, h, yb = 0) {
  const b = corners(sc, sr, yb);
  return frame(b.left, b.front, h) + frame(b.front, b.right, h);
}

// Bruchstein-Fugen auf beiden Frontflächen
function stoneJoints(sc, sr, h, yb = 0, col = VS.mortar) {
  const b = corners(sc, sr, yb);
  let s = "";
  const rows = Math.max(2, Math.round(h / 12));
  for (let i = 1; i < rows; i++) {
    const t = i / rows;
    s += L(
      lerp(b.left, up(b.left, h), t),
      lerp(b.front, up(b.front, h), t),
      col,
      1,
    );
    s += L(
      lerp(b.front, up(b.front, h), t),
      lerp(b.right, up(b.right, h), t),
      col,
      1,
    );
    // versetzte Stoßfugen
    const lp = lerp(b.left, up(b.left, h), t),
      fp = lerp(b.front, up(b.front, h), t);
    s += L(mid(lp, fp), up(mid(lp, fp), h / rows), col, 0.8);
  }
  return s;
}

// Zinnenkranz auf einer Mauerkrone (Höhe yb, Halbmaße sc/sr)
function crenels(sc, sr, yb, col, colD) {
  const b = corners(sc, sr, yb);
  let s = "";
  const merlon = (base, dir) => {
    for (let i = 0; i < 4; i++) {
      if (i % 2) continue;
      const a = lerp(base[0], base[1], i / 4),
        c2 = lerp(base[0], base[1], (i + 1) / 4);
      s += P([a, c2, up(c2, 8), up(a, 8)], dir);
    }
  };
  merlon([b.left, b.front], colD);
  merlon([b.front, b.right], col);
  return s;
}

const blob = (x, y, rx, ry, f) =>
  `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx}" ry="${ry}" fill="${f}"/>`;

// Kleine Fahne an Mast (CSS-Animation vs-flag)
function flag(x, yTop, poleH, col) {
  return (
    `<rect x="${(x - 1).toFixed(1)}" y="${yTop.toFixed(1)}" width="2" height="${poleH}" fill="${VS.woodD}"/>` +
    `<polygon class="vs-flag" points="${x + 1},${yTop + 1} ${x + 22},${yTop + 6} ${x + 1},${yTop + 12}" fill="${col}"/>`
  );
}

function smoke(x, y) {
  return `<g class="vs-smoke">
    <circle cx="${x}" cy="${y}" r="4" fill="#d8d2c4"/>
    <circle cx="${x}" cy="${y}" r="5" fill="#d8d2c4" style="animation-delay:1.3s"/>
    <circle cx="${x}" cy="${y}" r="3.5" fill="#d8d2c4" style="animation-delay:2.6s"/>
  </g>`;
}

// ---------- Dorfbewohner (kleine Männchen, die über den Hof laufen) ----------
// Gezeichnet um den lokalen Ursprung (Füße bei 0,0, wächst nach oben),
// damit animateMotion die Figur entlang eines Kachelpfads bewegen kann.
function personArt(tunic, hair, skin) {
  return (
    `<ellipse cx="0" cy="1.5" rx="6" ry="2.4" fill="rgba(0,0,0,0.20)"/>` + // Schatten
    `<rect x="-3.4" y="-7" width="2.8" height="7.5" fill="${VS.woodD}"/>` + // Beine
    `<rect x="0.6" y="-7" width="2.8" height="7.5" fill="${VS.woodD}"/>` +
    `<rect x="-5.8" y="-17" width="2.2" height="8" fill="${tunic}"/>` + // Arme
    `<rect x="3.6" y="-17" width="2.2" height="8" fill="${tunic}"/>` +
    P(
      [
        [-4.6, -7.5],
        [4.6, -7.5],
        [3.4, -18],
        [-3.4, -18],
      ],
      tunic,
    ) + // Kittel
    C(0, -21.5, 3.8, skin) + // Kopf
    P(
      [
        [-3.8, -21.5],
        [3.8, -21.5],
        [2.8, -25],
        [-2.8, -25],
      ],
      hair,
    ) // Haar/Kappe
  );
}

function folk() {
  const skins = ["#e2b48c", "#d39a6e", "#c88a5e"];
  // Jede Route läuft über freie Hof-Kacheln (r ≥ 1), damit die Bewohner
  // vor der hinteren Gebäudereihe laufen. calcMode="paced" = konstante Geschw.
  const cfg = [
    {
      r: [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      t: VS.cloth1,
      h: "#4a3524",
      d: 26,
    },
    {
      r: [
        [0, 1],
        [1, 1],
        [1, 2],
        [0, 3],
      ],
      t: VS.cloth2,
      h: "#5a3a1e",
      d: 19,
    },
    {
      r: [
        [4, 1],
        [4, 3],
        [3, 2],
      ],
      t: VS.leaf,
      h: "#2a1c12",
      d: 16,
    },
    {
      r: [
        [1, 3],
        [1, 4],
        [3, 4],
        [3, 3],
      ],
      t: "#8a6d3b",
      h: "#6b4a2a",
      d: 23,
    },
    {
      r: [
        [2, 1],
        [3, 2],
        [2, 3],
        [1, 2],
      ],
      t: VS.plasterD,
      h: "#3a2a1a",
      d: 21,
    },
  ];
  return (
    `<g class="vs-folk">` +
    cfg
      .map((c, i) => {
        const path =
          "M" +
          c.r
            .map(([cc, rr]) => {
              const [x, y] = iso(cc, rr);
              return `${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" L") +
          " Z";
        const skin = skins[i % skins.length];
        return `<g>
      <g class="vs-walk" style="animation-delay:${(i * 0.13).toFixed(2)}s">${personArt(c.t, c.h, skin)}</g>
      <animateMotion dur="${c.d}s" begin="-${i * 3}s" repeatCount="indefinite" rotate="0" calcMode="paced" path="${path}"/>
    </g>`;
      })
      .join("") +
    `</g>`
  );
}

// ---------- Gebäude (Anker: Kachel-Mitte 0,0; Basis y=0, wächst nach oben) ----------

function bRathaus() {
  return (
    prism(0.64, 0.64, 20, VS.stoneL, VS.stoneD, VS.stone) + // Bruchsteinsockel
    stoneJoints(0.64, 0.64, 20) +
    prism(0.52, 0.52, 34, VS.plasterL, VS.plasterD, VS.plaster, -20) + // Lehmputz-Körper
    timber(0.52, 0.52, 34, -20) + // Fachwerk
    roofSh(0.54, 0.54, 40, VS.shingleL, VS.shingle, -54) + // Hauptdach (Schindel)
    prism(0.2, 0.2, 78, VS.stoneL, VS.stoneD, VS.stone, -34) + // Steinturm
    stoneJoints(0.2, 0.2, 78, -34) +
    roofSh(0.22, 0.22, 30, VS.slateL, VS.slate, -112) + // Turmspitze (Schiefer)
    flag(3, -158, 24, VS.win) +
    smoke(-30, -66) +
    // schwere Holztür mit Beschlag
    P(
      [
        [-7, 0],
        [9, -8],
        [9, -28],
        [-7, -20],
      ],
      VS.woodD,
    ) +
    L([-7, -10], [9, -18], VS.woodL, 1.4) +
    L([1, -4], [1, -24], VS.woodL, 1.4) +
    C(18, -36, 3, VS.win, ' filter="url(#vsGlow)"') +
    C(-22, -36, 3, VS.win, ' filter="url(#vsGlow)"')
  );
}

function bHolz() {
  return (
    prism(0.5, 0.42, 24, VS.plasterL, VS.plasterD, VS.plaster) + // Sägewerk-Hütte
    timber(0.5, 0.42, 24) +
    roofSh(0.52, 0.44, 22, VS.thatchL, VS.thatchD, -24) + // Strohdach
    // gestapelte Baumstämme rechts
    C(46, -4, 6, VS.woodD) +
    C(58, -4, 6, VS.woodD) +
    C(52, -13, 6, VS.woodD) +
    C(46, -4, 2.6, VS.woodL) +
    C(58, -4, 2.6, VS.woodL) +
    C(52, -13, 2.6, VS.woodL) +
    // Sägebock
    L([28, 4], [40, -12], VS.woodD, 2.4) +
    L([40, 4], [28, -12], VS.woodD, 2.4) +
    // Tür
    P(
      [
        [-6, 0],
        [6, -6],
        [6, -20],
        [-6, -14],
      ],
      VS.woodD,
    )
  );
}

function bStein() {
  return (
    prism(0.5, 0.5, 10, "#8b929f", "#565c68", "#767d8b") + // Grube
    prism(0.28, 0.28, 22, VS.stoneL, VS.stoneD, VS.stone, -10) + // Felsblock
    stoneJoints(0.28, 0.28, 22, -10) +
    // gehauene, quaderförmige Steinblöcke (Werksteine) — klar rechteckig
    prism(0.2, 0.2, 12, VS.stoneL, VS.stoneD, VS.stone, 6) +
    prism(0.2, 0.2, 12, VS.stoneL, VS.stoneD, VS.stone, -6) +
    prism(0.18, 0.18, 11, VS.stoneL, VS.stoneD, VS.stone, 10) +
    // hölzerner Kran, der einen Block hebt
    `<rect x="-40" y="-58" width="5" height="58" fill="${VS.woodD}"/>` +
    `<rect x="-40" y="-58" width="48" height="5" fill="${VS.wood}"/>` +
    L([4, -53], [4, -30], VS.dark, 1.5) +
    P(
      [
        [-3, -30],
        [11, -30],
        [9, -20],
        [-1, -20],
      ],
      VS.stoneL,
    ) +
    P(
      [
        [9, -20],
        [11, -30],
        [11, -22],
      ],
      VS.stoneD,
    )
  );
}

function bEisen() {
  const oreDark = "#3a2e2a",
    oreMid = "#6b4a3a",
    oreHi = "#a8674a",
    iron = "#7d5b4a";
  return (
    // Felssockel + Bergflanke, in die der Stollen führt
    prism(0.5, 0.5, 12, "#8b929f", "#565c68", "#767d8b") +
    P(
      [
        [-18, -12],
        [0, -48],
        [28, -12],
      ],
      "url(#vsRock)",
    ) + // Bergflanke
    P(
      [
        [0, -48],
        [28, -12],
        [12, -12],
      ],
      VS.stoneD,
    ) +
    `<path d="M0 -48 l-6 36 M14 -30 l-2 18" stroke="${VS.stoneD}" stroke-width="1.4" fill="none" opacity="0.6"/>` +
    // Stolleneingang mit schwerem Holzrahmen (Grubenlampe darin)
    P(
      [
        [-16, -12],
        [4, -24],
        [4, -6],
        [-16, 0],
      ],
      VS.dark,
    ) +
    L([-16, -12], [-16, 0], VS.woodD, 3) +
    L([4, -24], [4, -6], VS.woodD, 3) +
    L([-16, -12], [4, -24], VS.wood, 3) +
    C(-6, -12, 2.4, VS.win, ' filter="url(#vsGlow)"') +
    // Schienen aus dem Stollen nach vorne, mit Schwellen
    L([-8, -2], [-4, 26], VS.stoneD, 2) +
    L([2, -4], [12, 24], VS.stoneD, 2) +
    `<path d="M-8 4 l10 -1 M-6 12 l12 -1 M-5 20 l14 -1" stroke="${VS.woodD}" stroke-width="1.6"/>` +
    // Lore (Minenwagen) voller Eisenerz
    `<g transform="translate(6,22)">` +
    P(
      [
        [-11, -6],
        [11, -6],
        [8, 3],
        [-8, 3],
      ],
      iron,
    ) +
    L([-11, -6], [11, -6], VS.woodL, 1.2) +
    C(-8, -8, 3, oreHi) +
    C(-1, -9, 3.4, oreMid) +
    C(6, -8, 3, oreHi) +
    C(1, -6, 3, oreDark) +
    C(-6, 5, 3, VS.dark) +
    C(6, 5, 3, VS.dark) +
    `</g>` +
    // Erzhaufen daneben (rötlich-metallisch)
    C(-30, 3, 5, oreMid) +
    C(-22, 5, 5, oreDark) +
    C(-26, -2, 5, oreHi) +
    C(-19, 0, 4, oreMid) +
    // Förderturm (Holzgerüst mit Seilrolle)
    `<path d="M6 -6 L13 -58 M22 -6 L15 -58 M8 -24 L20 -24 M11 -42 L17 -42" stroke="${VS.woodD}" stroke-width="2.5" fill="none"/>` +
    C(14, -60, 4, VS.woodL) +
    C(14, -60, 1.6, VS.dark) +
    L([14, -56], [14, -42], VS.dark, 1)
  );
}

function bLager() {
  return (
    prism(0.6, 0.5, 22, VS.stoneL, VS.stoneD, VS.stone) + // Steinsockel
    stoneJoints(0.6, 0.5, 22) +
    prism(0.56, 0.46, 18, VS.plasterL, VS.plasterD, VS.plaster, -22) + // Lager-Aufbau
    timber(0.56, 0.46, 18, -22) +
    roofSh(0.62, 0.52, 26, VS.shingleL, VS.shingle, -40) +
    // großes Holztor
    P(
      [
        [-10, -2],
        [12, -13],
        [12, -32],
        [-10, -21],
      ],
      VS.woodD,
    ) +
    L([-10, -2], [12, -32], VS.woodL, 1.6) +
    L([12, -13], [-10, -21], VS.woodL, 1.6) +
    // Fässer davor
    barrel(-30, 4) +
    barrel(-18, 10) +
    prism(0.11, 0.11, 11, VS.woodL, VS.woodD, VS.wood, 8)
  );
}

// kleines Fass
function barrel(x, y) {
  return (
    `<ellipse cx="${x}" cy="${y}" rx="7" ry="3.5" fill="${VS.woodD}"/>` +
    `<rect x="${x - 7}" y="${y - 12}" width="14" height="12" rx="3" fill="${VS.wood}"/>` +
    `<rect x="${x - 7}" y="${y - 9}" width="14" height="2" fill="${VS.woodD}"/>` +
    `<rect x="${x - 7}" y="${y - 3}" width="14" height="2" fill="${VS.woodD}"/>` +
    `<ellipse cx="${x}" cy="${y - 12}" rx="7" ry="3.5" fill="${VS.woodL}"/>`
  );
}

function bFarm() {
  const b = corners(0.72, 0.72);
  return (
    // Ackerfläche mit Furchen
    P([b.back, b.right, b.front, b.left], "#6f5734") +
    P(
      [
        mid([0, 0], b.left),
        mid([0, 0], b.back),
        mid([0, 0], b.right),
        mid([0, 0], b.front),
      ],
      "#6b7f3a",
    ) +
    `<path d="M-40 -4 L22 27 M-26 -12 L36 19 M-12 -20 L50 11" stroke="#57492c" stroke-width="3"/>` +
    // Windmühle
    `<g transform="translate(30,2)">` +
    prism(0.22, 0.22, 44, VS.stoneL, VS.stoneD, VS.stone) +
    stoneJoints(0.22, 0.22, 44) +
    roofSh(0.24, 0.24, 16, VS.shingleL, VS.shingle, -44) +
    `<g transform="translate(0,-46)"><g class="vs-mill">
      <rect x="2" y="-2" width="26" height="4" rx="1.5" fill="${VS.woodL}"/>
      <rect x="-2" y="2" width="4" height="26" rx="1.5" fill="${VS.woodL}"/>
      <rect x="-28" y="-2" width="26" height="4" rx="1.5" fill="${VS.woodL}"/>
      <rect x="-2" y="-28" width="4" height="26" rx="1.5" fill="${VS.woodL}"/>
     </g><circle r="3" fill="${VS.woodD}"/></g>` +
    `</g>`
  );
}

function bKaserne() {
  return (
    prism(0.52, 0.52, 46, VS.stoneL, VS.stoneD, VS.stone) + // Wehrbau
    stoneJoints(0.52, 0.52, 46) +
    crenels(0.52, 0.52, -46, VS.stoneL, VS.stoneD) + // Zinnen
    flag(-2, -86, 26, VS.cloth1) +
    // Torbogen
    P(
      [
        [-7, 0],
        [9, -8],
        [9, -30],
        [-7, -22],
      ],
      VS.dark,
    ) +
    L([-7, -11], [9, -19], VS.woodD, 2) +
    C(-22, -34, 3, VS.win, ' filter="url(#vsGlow)"') +
    C(24, -34, 3, VS.win, ' filter="url(#vsGlow)"') +
    C(1, -50, 3, VS.win, ' filter="url(#vsGlow)"') +
    // Waffenständer / Speere
    `<path d="M30 4 l4 -22 M37 4 l2 -22 M44 4 l0 -22" stroke="${VS.stoneD}" stroke-width="1.8"/>` +
    C(34, -19, 1.6, VS.stoneL) +
    C(39, -19, 1.6, VS.stoneL) +
    C(44, -19, 1.6, VS.stoneL)
  );
}

function bMarkt() {
  const stall = (dx, awn, awnL) => {
    const b = corners(0.32, 0.28, -18);
    const midPts = [
      [0, b.back[1]],
      mid(b.back, b.right),
      [0, mid(b.front, b.back)[1]],
      mid(b.back, b.left),
    ];
    return (
      `<g transform="translate(${dx},0)">` +
      // Holztheke
      prism(0.24, 0.2, 15, VS.woodL, VS.woodD, VS.wood) +
      // Sonnensegel (Stoff)
      P([b.back, b.right, b.front, b.left], awn) +
      P(midPts, awnL) +
      // Warenauslage
      C(-7, -2, 2.6, VS.cloth1) +
      C(0, -3, 2.6, VS.thatchL) +
      C(7, -2, 2.6, VS.leaf) +
      `</g>`
    );
  };
  return (
    stall(-20, VS.cloth1, VS.cloth1L) +
    stall(22, VS.cloth2, VS.cloth2L) +
    barrel(0, 8)
  );
}

// Tor / Stadtmauer (Bauplatz „mauer"): zwei Türme + Torbogen + Zinnen
function bGate(level) {
  const stone = level >= 4;
  const col = stone ? VS.stone : VS.wood;
  const colD = stone ? VS.stoneD : VS.woodD;
  const colL = stone ? VS.stoneL : VS.woodL;
  const tower = (dx) =>
    `<g transform="translate(${dx},0)">` +
    prism(0.17, 0.17, 46, colL, colD, col) +
    (stone
      ? stoneJoints(0.17, 0.17, 46) + crenels(0.17, 0.17, -46, colL, colD)
      : roofSh(0.19, 0.19, 16, VS.shingleL, VS.shingle, -46)) +
    C(0, -34, 2.4, VS.win, ' filter="url(#vsGlow)"') +
    `</g>`;
  return (
    tower(-30) +
    tower(30) +
    // Torbogen mit Fallgatter
    P(
      [
        [-18, -6],
        [18, 12],
        [18, -22],
        [-18, -40],
      ],
      colD,
    ) +
    P(
      [
        [-14, -10],
        [14, 4],
        [14, -24],
        [-14, -38],
      ],
      VS.dark,
    ) +
    L([-14, -24], [14, -10], VS.woodD, 1.4) +
    L([0, -17], [0, -33], VS.woodD, 1.4)
  );
}

const ART = {
  rathaus: bRathaus,
  holz: bHolz,
  stein: bStein,
  eisen: bEisen,
  lager: bLager,
  farm: bFarm,
  kaserne: bKaserne,
  markt: bMarkt,
};

// ---------- Umgebungs-Objekte ----------

function tree(seed = 0) {
  const pine = seed % 3 === 0;
  const h = 18 + (seed % 3) * 4;
  return (
    `<ellipse cx="0" cy="6" rx="17" ry="6.5" fill="#000" opacity="0.2"/>` +
    `<rect x="-3" y="${-h}" width="6" height="${h}" rx="2" fill="${VS.woodD}"/>` +
    `<rect x="-3" y="${-h}" width="2.2" height="${h}" rx="1" fill="${VS.woodL}" opacity="0.7"/>` +
    (pine
      ? // Nadelbaum: gestapelte Dreiecke
        P(
          [
            [-16, -h + 2],
            [0, -h - 20],
            [16, -h + 2],
          ],
          VS.pineD,
        ) +
        P(
          [
            [-13, -h - 8],
            [0, -h - 28],
            [13, -h - 8],
          ],
          VS.pine,
        ) +
        P(
          [
            [-9, -h - 18],
            [0, -h - 36],
            [9, -h - 18],
          ],
          VS.leafL,
        )
      : // Laubbaum: volle Krone
        blob(0, -h - 2, 19, 15, VS.leafD) +
        `<circle cx="0" cy="${-h - 8}" r="17" fill="url(#vsLeaf)"/>` +
        blob(-6, -h - 14, 10, 9, VS.leafL))
  );
}

function rock() {
  return (
    `<ellipse cx="0" cy="8" rx="30" ry="11" fill="#000" opacity="0.2"/>` +
    P(
      [
        [-4, 8],
        [16, -38],
        [34, 8],
      ],
      "url(#vsRock)",
    ) +
    P(
      [
        [16, -38],
        [34, 8],
        [24, 8],
      ],
      VS.stoneD,
    ) +
    P(
      [
        [-32, 10],
        [-12, -28],
        [10, 10],
      ],
      "url(#vsRock)",
    ) +
    P(
      [
        [-12, -28],
        [10, 10],
        [0, 10],
      ],
      VS.stoneD,
    ) +
    `<path d="M-12 -28 l-6 30 M16 -38 l-3 40" stroke="${VS.stoneD}" stroke-width="1.5" fill="none" opacity="0.6"/>`
  );
}

function flowers() {
  let s = "";
  const spots = [
    [-20, 4],
    [-6, -6],
    [10, 2],
    [24, -4],
    [0, 10],
    [-14, -12],
    [16, 12],
  ];
  const cols = ["#e0b84a", "#c25a52", "#e6e0d2", "#7a97bf"];
  spots.forEach((p, i) => {
    s += C(p[0], p[1], 2.6, cols[i % cols.length]);
    s += C(p[0], p[1] - 2.6, 1.3, "#fff");
  });
  return s;
}

// ---------- Boden / Insel ----------

function islandSlab() {
  const N = [OX, OY + 2 * LO * HH - HH];
  const E = [OX + (HI - LO + 1) * HW, OY + (HI + LO) * HH];
  const S = [OX, OY + 2 * HI * HH + HH];
  const W = [OX - (HI - LO + 1) * HW, OY + (HI + LO) * HH];
  const soilE = [E[0], E[1] + RIM],
    soilS = [S[0], S[1] + RIM],
    soilW = [W[0], W[1] + RIM];
  return (
    `<ellipse cx="${OX}" cy="${S[1] + RIM - 4}" rx="${(HI - LO + 1) * HW + 40}" ry="66" fill="#000" opacity="0.22"/>` +
    P([W, S, soilS, soilW], VS.soilD) +
    P([S, E, soilE, soilS], "url(#vsSoil)") +
    P([N, E, S, W], VS.grassD)
  );
}

// eine Rasenkachel mit Textur-Tupfern
function grassTile(cx, cy, c, r) {
  const n = [cx, cy - HH],
    e = [cx + HW, cy],
    s = [cx, cy + HH],
    w = [cx - HW, cy];
  let out = P(
    [n, e, s, w],
    "url(#vsGrass)",
    ` stroke="${VS.grassEdge}" stroke-width="0.7" stroke-opacity="0.4"`,
  );
  let seed = (c * 928371 + r * 12345 + 555) >>> 0;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 5; i++) {
    const dx = (rnd() - 0.5) * HW * 1.1,
      dy = (rnd() - 0.5) * HH * 1.1;
    if (Math.abs(dx) / HW + Math.abs(dy) / HH > 0.82) continue;
    const dark = rnd() > 0.5;
    out += `<ellipse cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" rx="3.2" ry="1.6" fill="${dark ? VS.grassEdge : VS.grassL}" opacity="0.45"/>`;
  }
  return out;
}

// Kopfsteinpflaster-Kachel (Marktplatz)
function cobbleTile(cx, cy, c, r) {
  const n = [cx, cy - HH],
    e = [cx + HW, cy],
    s = [cx, cy + HH],
    w = [cx - HW, cy];
  let out = P(
    [n, e, s, w],
    "url(#vsCobble)",
    ` stroke="${VS.cobbleD}" stroke-width="0.6" stroke-opacity="0.5"`,
  );
  let seed = (c * 40503 + r * 7919 + 13) >>> 0;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 10; i++) {
    const dx = (rnd() - 0.5) * HW * 1.2,
      dy = (rnd() - 0.5) * HH * 1.2;
    if (Math.abs(dx) / HW + Math.abs(dy) / HH > 0.86) continue;
    const g = rnd();
    out += `<ellipse cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" rx="4.5" ry="2.4" fill="${g > 0.5 ? VS.cobbleL : VS.cobbleD}" opacity="0.5"/>`;
  }
  return out;
}

// Wegkachel (gestampfte Erde mit Radspuren)
function pathTile(cx, cy) {
  const n = [cx, cy - HH],
    e = [cx + HW, cy],
    s = [cx, cy + HH],
    w = [cx - HW, cy];
  return (
    P([n, e, s, w], VS.path, ` stroke="${VS.pathD}" stroke-width="0.6"`) +
    L([cx - 18, cy - HH * 0.5], [cx - 18, cy + HH * 0.5], VS.pathD, 2.4) +
    L([cx + 18, cy - HH * 0.5], [cx + 18, cy + HH * 0.5], VS.pathD, 2.4)
  );
}

function waterTile(cx, cy) {
  const n = [cx, cy - HH],
    e = [cx + HW, cy],
    s = [cx, cy + HH],
    w = [cx - HW, cy];
  return (
    P([n, e, s, w], "url(#vsWater)") +
    `<path d="M${cx - 34} ${cy - 4} q10 -5 20 0 M${cx - 20} ${cy + 8} q10 -5 20 0 M${cx + 4} ${cy - 8} q8 -4 16 0" stroke="${VS.waterL}" stroke-width="1.5" fill="none" opacity="0.6"/>`
  );
}

function groundTiles() {
  let out = "";
  for (let r = LO; r <= HI; r++) {
    for (let c = LO; c <= HI; c++) {
      const [cx, cy] = iso(c, r);
      const k = key2(c, r);
      if (inGrid(c, r)) out += cobbleTile(cx, cy, c, r);
      else if (PATH.has(k)) out += pathTile(cx, cy);
      else if (POND.has(k)) out += waterTile(cx, cy);
      else out += grassTile(cx, cy, c, r);
    }
  }
  return out;
}

// ---------- Mauerring ----------

function wallEdge(g1, g2, level) {
  const stone = level >= 4;
  const h = 16 + Math.min(level, 8) * 1.4;
  const s1 = iso(g1[0], g1[1]),
    s2 = iso(g2[0], g2[1]);
  const face = P([s1, s2, up(s2, h), up(s1, h)], stone ? VS.stoneD : VS.woodD);
  let s = face;
  if (stone) {
    // Fugen
    for (let t = 0.33; t < 1; t += 0.33)
      s += L(lerp(s1, up(s1, h), t), lerp(s2, up(s2, h), t), VS.mortar, 1);
  }
  s += L(up(s1, h), up(s2, h), stone ? VS.stoneL : VS.woodL, 3);
  return s;
}

function walls(level, front) {
  if (level < 1) return "";
  const A = [-0.5, -0.5],
    B = [4.5, -0.5],
    Cc = [4.5, 4.5],
    D = [-0.5, 4.5];
  const back = wallEdge(A, B, level) + wallEdge(D, A, level);
  const frontEdges = wallEdge(B, Cc, level) + wallEdge(Cc, D, level);
  return front
    ? `<g opacity="0.98">${frontEdges}</g>`
    : `<g opacity="0.9">${back}</g>`;
}

// ---------- Himmel ----------

function sky() {
  const cloud = (x, y, s, dur) =>
    `<g transform="translate(${x},${y}) scale(${s})" fill="#eef1ec" opacity="0.8">
       <g class="vs-cloud" style="animation-duration:${dur}s">
         <ellipse rx="46" ry="15"/><ellipse cx="-30" cy="6" rx="28" ry="11"/><ellipse cx="32" cy="5" rx="32" ry="12"/>
       </g></g>`;
  return (
    `<rect width="${VBW}" height="${VBH}" fill="url(#vsSky)"/>` +
    `<circle cx="1300" cy="110" r="42" fill="#f6ead0"/>` +
    `<circle cx="1300" cy="110" r="62" fill="#f6ead0" opacity="0.28"/>` +
    cloud(320, 90, 1, 96) +
    cloud(1080, 150, 0.8, 128) +
    cloud(660, 60, 0.6, 160)
  );
}

// ---------- Bauplatz-Wrapper ----------

function plot(key, state, meta, selected) {
  const [c, r] = GRID[key];
  const [cx, cy] = iso(c, r);
  const def = meta.BUILDINGS[key];
  const b = state.village.buildings[key];
  const q = state.village.queue.find((it) => it.b === key);
  const ghost = b.level < 1 && !q;
  const art = key === "mauer" ? bGate(b.level) : ART[key]();
  const grow = key === "mauer" ? 1 : Math.min(1.32, 1.02 + b.level * 0.026);

  const shadow = `<ellipse cx="0" cy="6" rx="${HW * 0.62}" ry="${HH * 0.5}" fill="#000" opacity="0.22"/>`;
  const selRing =
    selected === key
      ? P(
          [
            [0, -HH],
            [HW, 0],
            [0, HH],
            [-HW, 0],
          ],
          "none",
          ` class="vs-selring"`,
        )
      : "";

  const badge = ghost
    ? `<g transform="translate(0,-14)"><circle r="16" fill="#141c30" opacity="0.9" stroke="#8a93a6" stroke-width="2" stroke-dasharray="3 2"/><text y="7" text-anchor="middle" font-size="22" fill="#8a93a6">+</text></g>`
    : `<g transform="translate(${HW * 0.5},-8)"><circle r="16" fill="#141c30" stroke="#e8b64c" stroke-width="2.4"/><text y="6.5" text-anchor="middle" font-size="19" font-weight="800" fill="#f4d27a">${b.level}</text></g>`;

  const construct = q
    ? `
    <g class="vs-construct">
      <rect x="${-HW * 0.55}" y="-52" width="4" height="52" fill="${VS.woodL}" opacity="0.9"/>
      <rect x="${HW * 0.5}" y="-60" width="4" height="60" fill="${VS.woodL}" opacity="0.9"/>
      <rect x="${-HW * 0.55}" y="-54" width="${HW * 1.05}" height="4" fill="${VS.woodL}" opacity="0.9"/>
      <text y="-74" text-anchor="middle" font-size="14">🔨</text>
      <text class="countdown vs-timer" data-done="${q.done}" y="-90" text-anchor="middle">…</text>
    </g>`
    : "";

  // Ausbau-Symbol: erscheint, sobald genug Rohstoffe für die nächste Stufe da
  // sind (nicht in Bau, nicht gesperrt, nicht auf Maximalstufe).
  const res = state.village.res || {};
  const affordable =
    !q &&
    !b.locked &&
    b.nextCost &&
    Object.entries(b.nextCost).every(([r2, n]) => (res[r2] || 0) >= n);
  const upgrade = affordable
    ? `
    <g class="vs-upgrade" transform="translate(0,-58)">
      <title>Ausbau möglich — genug Rohstoffe vorhanden</title>
      <circle r="15" fill="#1f7a3d" stroke="#8bf0a8" stroke-width="2.4"/>
      <path d="M0,-7 L7.5,3.5 L2.8,3.5 L2.8,8 L-2.8,8 L-2.8,3.5 L-7.5,3.5 Z" fill="#eafff0"/>
    </g>`
    : "";

  // Gebäude selbst (tiefensortiert). Die Marker (Stufen-Badge, Baustelle,
  // Ausbau-Symbol) werden separat in einer eigenen Ebene über allen Gebäuden
  // gerendert, damit sie nie hinter davorstehenden Gebäuden verschwinden.
  const body = `
    <g class="vs-plot${selected === key ? " vs-selected" : ""}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})" onclick="selectBuilding('${key}')">
      <title>${def.name} — ${ghost ? "noch nicht gebaut" : "Stufe " + b.level}</title>
      ${shadow}${selRing}
      <g class="vs-art${ghost ? " vs-ghost" : ""}" transform="scale(${grow.toFixed(3)})">${art}</g>
    </g>`;

  const markers = `
    <g class="vs-plot-markers" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})" onclick="selectBuilding('${key}')">
      ${badge}${construct}${upgrade}
    </g>`;

  return { depth: c + r + 0.5, body, markers };
}

// Umgebungs-Deko als tiefen-sortierbares Objekt
function decorObj(c, r) {
  const k = key2(c, r);
  let art = "";
  if (ROCK.has(k)) art = rock();
  else if (FLOWERS.has(k)) art = flowers();
  else if (hasTree(c, r)) art = tree(c * 3 + r);
  else return null;
  const [cx, cy] = iso(c, r);
  return {
    depth: c + r,
    svg: `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">${art}</g>`,
  };
}

// ---------- Hauptfunktion ----------

function renderVillageScene(state, meta, selected) {
  const mauerLvl = state.village.buildings.mauer.level;

  const objs = [];
  const markers = [];
  Object.keys(GRID).forEach((key) => {
    const p = plot(key, state, meta, selected);
    objs.push({ depth: p.depth, svg: p.body });
    markers.push(p.markers);
  });
  for (let r = LO; r <= HI; r++) {
    for (let c = LO; c <= HI; c++) {
      if (inGrid(c, r)) continue;
      const d = decorObj(c, r);
      if (d) objs.push(d);
    }
  }
  objs.sort((a, b) => a.depth - b.depth);
  const objSvg = objs.map((o) => o.svg).join("");
  const markerSvg = markers.join("");

  return `
  <svg id="villageScene" viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dorfansicht (isometrisch)">
    <defs>
      <linearGradient id="vsSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8fb0c9"/><stop offset="0.55" stop-color="#aec5d4"/><stop offset="1" stop-color="#cdd6c8"/>
      </linearGradient>
      <radialGradient id="vsGrass" cx="0.5" cy="0.4" r="0.75">
        <stop offset="0" stop-color="#7c9850"/><stop offset="0.6" stop-color="#67813f"/><stop offset="1" stop-color="#4e662f"/>
      </radialGradient>
      <linearGradient id="vsSoil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8a6540"/><stop offset="1" stop-color="#513a20"/>
      </linearGradient>
      <radialGradient id="vsCobble" cx="0.5" cy="0.42" r="0.8">
        <stop offset="0" stop-color="#9f9788"/><stop offset="0.7" stop-color="#8b8476"/><stop offset="1" stop-color="#6f695d"/>
      </radialGradient>
      <linearGradient id="vsWater" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6aa6c9"/><stop offset="1" stop-color="#2a597a"/>
      </linearGradient>
      <radialGradient id="vsLeaf" cx="0.38" cy="0.32" r="0.82">
        <stop offset="0" stop-color="#7ba64c"/><stop offset="0.6" stop-color="#4d7a38"/><stop offset="1" stop-color="#2c4a1f"/>
      </radialGradient>
      <linearGradient id="vsRock" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="#aab0bb"/><stop offset="0.5" stop-color="#828997"/><stop offset="1" stop-color="#565c68"/>
      </linearGradient>
      <filter id="vsGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="1.4" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${sky()}
    ${islandSlab()}
    ${groundTiles()}
    ${walls(mauerLvl, false)}
    ${objSvg}
    ${folk()}
    ${walls(mauerLvl, true)}
    <g class="vs-markers">${markerSvg}</g>
  </svg>`;
}
