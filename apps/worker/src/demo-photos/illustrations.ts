/**
 * The demonstration tree's illustrations.
 *
 * The Chassagne family is invented, so it has no photographs — and borrowing
 * real ones would put strangers' faces under invented names. These are
 * drawn instead: sepia scenes composed from shapes, rendered to PNG by the
 * same pipeline as an upload, and titled and captioned as illustrations so
 * that nobody takes one for a period photograph.
 *
 * Each scene knows where its figures stand, so the people in it can be
 * identified with a rectangle exactly as a user would draw one. No text is
 * drawn into the images: what they show is said in their title, and a
 * rendered font would depend on what the machine happens to have installed.
 */

export const WIDTH = 1600;
export const HEIGHT = 1100;

/** A figure's box, as fractions of the image — the shape a tag region takes. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Illustration {
  /** Stable identifier, also the idempotency key of the seed. */
  readonly key: string;
  readonly title: string;
  readonly description: string;
  /** When the scene is set, as genealogists write dates. */
  readonly captured: string;
  readonly svg: string;
  /** The people in it, by display name, with where each one stands. */
  readonly figures: readonly { readonly name: string; readonly region: Region }[];
  /** The events it shows: type, the people in them, the date as recorded. */
  readonly events: readonly {
    readonly type: 'MARRIAGE' | 'MIGRATION' | 'CENSUS' | 'MILITARY_SERVICE';
    readonly people: readonly string[];
    readonly date: string;
  }[];
}

const INK = '#2f2116';
const INK_SOFT = '#4a3624';
const PAPER = '#e8d9b8';
const PAPER_DARK = '#b89a6c';

type Kind = 'man' | 'woman' | 'child' | 'bride' | 'soldier' | 'seated';

interface Figure {
  readonly svg: string;
  readonly region: Region;
}

const round = (value: number) => Math.round(value * 10) / 10;
const fraction = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * One person, standing on `baseY`, `height` pixels tall, centred on `x`.
 * Shapes, not faces: a head, shoulders, the cut of a coat or a dress.
 */
function figure(kind: Kind, x: number, baseY: number, height: number, fill = INK): Figure {
  const h = height;
  const headR = h * 0.068;
  const headY = baseY - h + headR;
  const shoulderY = headY + headR * 1.6;
  const half = h * (kind === 'child' ? 0.13 : 0.15);
  const parts: string[] = [];

  if (kind === 'woman' || kind === 'bride') {
    // A long dress widening to the ground.
    parts.push(
      `<path d="M${round(x - half * 0.8)} ${round(shoulderY)} Q${round(x)} ${round(shoulderY - headR * 0.4)} ${round(x + half * 0.8)} ${round(shoulderY)} L${round(x + half * 0.55)} ${round(baseY - h * 0.5)} Q${round(x + half * 1.7)} ${round(baseY - h * 0.15)} ${round(x + half * 1.45)} ${round(baseY)} L${round(x - half * 1.45)} ${round(baseY)} Q${round(x - half * 1.7)} ${round(baseY - h * 0.15)} ${round(x - half * 0.55)} ${round(baseY - h * 0.5)} Z" fill="${fill}"/>`,
    );
    if (kind === 'bride') {
      // The veil, pale against the dark of the group.
      parts.push(
        `<path d="M${round(x - headR * 0.9)} ${round(headY - headR * 0.6)} Q${round(x - half * 1.9)} ${round(baseY - h * 0.45)} ${round(x - half * 1.25)} ${round(baseY - h * 0.08)} L${round(x - half * 0.7)} ${round(baseY - h * 0.1)} Q${round(x - half * 0.9)} ${round(baseY - h * 0.5)} ${round(x + headR * 0.4)} ${round(headY - headR * 0.2)} Z" fill="#f3ead6" opacity="0.82"/>`,
        `<path d="M${round(x - half * 1.45)} ${round(baseY)} L${round(x + half * 1.45)} ${round(baseY)} L${round(x + half * 1.2)} ${round(baseY - h * 0.25)} L${round(x - half * 1.2)} ${round(baseY - h * 0.25)} Z" fill="#efe3c8" opacity="0.55"/>`,
      );
    }
  } else if (kind === 'seated') {
    // Seated on a studio chair: skirt over the knees, the chair's back behind.
    parts.push(
      `<rect x="${round(x - half * 1.6)}" y="${round(shoulderY - h * 0.05)}" width="${round(half * 0.35)}" height="${round(baseY - shoulderY + h * 0.05)}" fill="${INK_SOFT}"/>`,
      `<path d="M${round(x - half * 0.8)} ${round(shoulderY)} Q${round(x)} ${round(shoulderY - headR * 0.4)} ${round(x + half * 0.8)} ${round(shoulderY)} L${round(x + half * 0.7)} ${round(baseY - h * 0.38)} L${round(x + half * 2.1)} ${round(baseY - h * 0.36)} L${round(x + half * 1.9)} ${round(baseY)} L${round(x - half * 1.3)} ${round(baseY)} L${round(x - half * 0.9)} ${round(baseY - h * 0.4)} Z" fill="${fill}"/>`,
    );
  } else {
    // A coat to the knees, then legs.
    const coatBottom = baseY - h * (kind === 'child' ? 0.3 : 0.34);
    const waist = shoulderY + (coatBottom - shoulderY) * 0.45;
    const arm = half * 0.3;
    parts.push(
      // Arms first, a hair apart from the coat, so the figure is not a block.
      `<rect x="${round(x - half - arm * 0.55)}" y="${round(shoulderY + headR * 0.2)}" width="${round(arm)}" height="${round((coatBottom - shoulderY) * 0.86)}" rx="${round(arm / 2)}" fill="${fill}" stroke="${PAPER}" stroke-opacity="0.35" stroke-width="2"/>`,
      `<rect x="${round(x + half - arm * 0.45)}" y="${round(shoulderY + headR * 0.2)}" width="${round(arm)}" height="${round((coatBottom - shoulderY) * 0.86)}" rx="${round(arm / 2)}" fill="${fill}" stroke="${PAPER}" stroke-opacity="0.35" stroke-width="2"/>`,
      `<path d="M${round(x - half)} ${round(shoulderY + headR * 0.3)} Q${round(x - half)} ${round(shoulderY - headR * 0.2)} ${round(x - half * 0.6)} ${round(shoulderY - headR * 0.25)} Q${round(x)} ${round(shoulderY - headR * 0.55)} ${round(x + half * 0.6)} ${round(shoulderY - headR * 0.25)} Q${round(x + half)} ${round(shoulderY - headR * 0.2)} ${round(x + half)} ${round(shoulderY + headR * 0.3)} L${round(x + half * 0.84)} ${round(waist)} L${round(x + half * 0.98)} ${round(coatBottom)} L${round(x - half * 0.98)} ${round(coatBottom)} L${round(x - half * 0.84)} ${round(waist)} Z" fill="${fill}"/>`,
      `<rect x="${round(x - half * 0.62)}" y="${round(coatBottom - 2)}" width="${round(half * 0.5)}" height="${round(baseY - coatBottom + 2)}" fill="${fill}"/>`,
      `<rect x="${round(x + half * 0.12)}" y="${round(coatBottom - 2)}" width="${round(half * 0.5)}" height="${round(baseY - coatBottom + 2)}" fill="${fill}"/>`,
    );
  }

  parts.push(`<circle cx="${round(x)}" cy="${round(headY)}" r="${round(headR)}" fill="${fill}"/>`);
  if (kind === 'man') {
    // A bowler: crown and brim.
    parts.push(
      `<ellipse cx="${round(x)}" cy="${round(headY - headR * 0.75)}" rx="${round(headR * 0.95)}" ry="${round(headR * 0.7)}" fill="${fill}"/>`,
      `<rect x="${round(x - headR * 1.45)}" y="${round(headY - headR * 0.55)}" width="${round(headR * 2.9)}" height="${round(headR * 0.28)}" rx="2" fill="${fill}"/>`,
    );
  } else if (kind === 'soldier') {
    // An Adrian helmet, with its crest.
    parts.push(
      `<path d="M${round(x - headR * 1.5)} ${round(headY - headR * 0.15)} Q${round(x)} ${round(headY - headR * 2.3)} ${round(x + headR * 1.5)} ${round(headY - headR * 0.15)} Z" fill="${fill}"/>`,
      `<rect x="${round(x - headR * 0.18)}" y="${round(headY - headR * 1.55)}" width="${round(headR * 0.36)}" height="${round(headR * 0.5)}" fill="${fill}"/>`,
      // A rifle on the shoulder.
      `<rect x="${round(x + half * 0.7)}" y="${round(shoulderY - h * 0.28)}" width="${round(h * 0.012)}" height="${round(h * 0.62)}" transform="rotate(12 ${round(x + half * 0.7)} ${round(shoulderY)})" fill="${fill}"/>`,
    );
  }

  const width = half * (kind === 'woman' || kind === 'bride' ? 3.1 : kind === 'seated' ? 4 : 2.5);
  const left = kind === 'seated' ? x - half * 1.7 : x - width / 2;
  const top = headY - headR * (kind === 'soldier' || kind === 'man' ? 1.6 : 1.1);
  return {
    svg: parts.join(''),
    region: {
      x: fraction(Math.max(left, 0) / WIDTH),
      y: fraction(Math.max(top, 0) / HEIGHT),
      width: fraction(Math.min(width, WIDTH - left) / WIDTH),
      height: fraction(Math.min(baseY - top, HEIGHT - top) / HEIGHT),
    },
  };
}

/**
 * Paper, light and age: a toned ground, grain, a vignette, and a mount.
 * `seed` changes the grain, so two prints are not the same sheet.
 */
function frame(scene: string, seed: number, tone = PAPER): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <radialGradient id="vignette" cx="50%" cy="46%" r="70%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#1b120a" stop-opacity="0.62"/>
  </radialGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${tone}"/>
    <stop offset="100%" stop-color="${PAPER_DARK}"/>
  </linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0.18  0 0 0 0 0.13  0 0 0 0 0.08  0 0 0 0.22 0"/>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="haze"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
${scene}
<rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>
<rect x="34" y="34" width="${WIDTH - 68}" height="${HEIGHT - 68}" rx="18" fill="none" stroke="#f1e6cc" stroke-opacity="0.55" stroke-width="5"/>
<rect x="52" y="52" width="${WIDTH - 104}" height="${HEIGHT - 104}" rx="12" fill="none" stroke="#2a1d12" stroke-opacity="0.35" stroke-width="2"/>
</svg>`;
}

function weddingOutside(): Illustration {
  const ground = 930;
  // The church of Azay: nave, pediment, a round-arched door, the steeple.
  const church = `
  <rect x="430" y="300" width="740" height="${ground - 300}" fill="${PAPER_DARK}" opacity="0.75"/>
  <path d="M410 310 L800 120 L1190 310 Z" fill="#a88a5e" opacity="0.8"/>
  <rect x="740" y="20" width="120" height="290" fill="#9c7f55" opacity="0.85"/>
  <path d="M730 30 L800 -60 L870 30 Z" fill="#8d714a"/>
  <path d="M690 ${ground} L690 600 Q800 470 910 600 L910 ${ground} Z" fill="#5b4430" opacity="0.85"/>
  <circle cx="800" cy="390" r="56" fill="none" stroke="#6b5238" stroke-width="10" opacity="0.7"/>
  <rect x="0" y="${ground}" width="${WIDTH}" height="${HEIGHT - ground}" fill="#8f7450" opacity="0.7"/>
  <path d="M0 ${ground} L${WIDTH} ${ground}" stroke="#4d3a27" stroke-width="3" opacity="0.6"/>`;
  const guests = [
    figure('man', 250, ground + 10, 470, INK_SOFT),
    figure('woman', 400, ground + 14, 440, INK_SOFT),
    figure('child', 520, ground + 18, 300, INK_SOFT),
    figure('woman', 1110, ground + 14, 445, INK_SOFT),
    figure('man', 1260, ground + 10, 480, INK_SOFT),
    figure('man', 1400, ground + 12, 455, INK_SOFT),
  ];
  const groom = figure('man', 860, ground + 30, 540);
  const bride = figure('bride', 700, ground + 34, 510);
  return {
    key: 'demo-illustration-noce-1877',
    title: 'Illustration — La noce de Gustave et Eugénie, 1877',
    description:
      'Image de démonstration composée par Chronolignée : ce n’est pas une photographie d’époque. Devant l’église d’Azay-le-Rideau, le 8 septembre 1877.',
    captured: '8 septembre 1877',
    svg: frame(church + guests.map((g) => g.svg).join('') + bride.svg + groom.svg, 7),
    figures: [
      { name: 'Eugénie CHASSAGNE', region: bride.region },
      { name: 'Gustave CHASSAGNE', region: groom.region },
    ],
    events: [
      { type: 'MARRIAGE', people: ['Gustave CHASSAGNE', 'Eugénie CHASSAGNE'], date: '8 SEP 1877' },
    ],
  };
}

function departure(): Illustration {
  const quay = 900;
  const sea = 640;
  const scene = `
  <rect x="0" y="${sea}" width="${WIDTH}" height="${quay - sea}" fill="#8b7a5f" opacity="0.8"/>
  ${[0, 1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<path d="M0 ${sea + 30 + i * 40} Q400 ${sea + 18 + i * 40} 800 ${sea + 30 + i * 40} T${WIDTH} ${sea + 30 + i * 40}" stroke="#d9c7a3" stroke-opacity="${0.35 - i * 0.04}" stroke-width="3" fill="none"/>`,
    )
    .join('')}
  <g opacity="0.9">
    <ellipse cx="760" cy="230" rx="160" ry="70" fill="#6d5a42" filter="url(#soft)" opacity="0.65"/>
    <ellipse cx="930" cy="170" rx="210" ry="80" fill="#7a6650" filter="url(#soft)" opacity="0.55"/>
    <rect x="700" y="290" width="60" height="230" fill="${INK_SOFT}"/>
    <rect x="880" y="270" width="64" height="250" fill="${INK_SOFT}"/>
    <rect x="692" y="300" width="76" height="22" fill="#d8c39c" opacity="0.6"/>
    <rect x="872" y="282" width="80" height="22" fill="#d8c39c" opacity="0.6"/>
    <path d="M300 ${sea - 10} L1350 ${sea - 10} L1260 ${sea + 70} L380 ${sea + 70} Z" fill="${INK}"/>
    <rect x="420" y="${sea - 130}" width="820" height="120" fill="#3a2a1c"/>
    ${Array.from({ length: 16 }, (_, i) => `<circle cx="${470 + i * 48}" cy="${sea - 70}" r="9" fill="#d9c49a" opacity="0.7"/>`).join('')}
    <rect x="540" y="160" width="10" height="${sea - 290}" fill="${INK}"/>
    <rect x="1120" y="140" width="10" height="${sea - 270}" fill="${INK}"/>
    <path d="M545 170 L1125 150" stroke="${INK}" stroke-width="3"/>
  </g>
  <rect x="0" y="${quay}" width="${WIDTH}" height="${HEIGHT - quay}" fill="#5e4a33"/>
  <path d="M0 ${quay} L${WIDTH} ${quay}" stroke="#2c1f14" stroke-width="6"/>
  ${[160, 1440].map((x) => `<rect x="${x - 22}" y="${quay - 60}" width="44" height="64" rx="10" fill="#2c1f14"/>`).join('')}
  <rect x="1180" y="${quay - 70}" width="150" height="74" fill="#4a3826"/>
  <rect x="1200" y="${quay - 120}" width="110" height="54" fill="#5a4530"/>`;
  const gustave = figure('man', 560, quay + 70, 470);
  const eugenie = figure('woman', 720, quay + 74, 440);
  const gustavo = figure('child', 850, quay + 78, 290);
  return {
    key: 'demo-illustration-depart-1889',
    title: 'Illustration — Le départ du Havre pour Buenos Aires, 1889',
    description:
      'Image de démonstration composée par Chronolignée : ce n’est pas une photographie d’époque. Gustave, Eugénie et leur fils Gustavo sur le quai, avant l’embarquement d’avril 1889.',
    captured: 'avril 1889',
    svg: frame(scene + gustave.svg + eugenie.svg + gustavo.svg, 19, '#e3d6bb'),
    figures: [
      { name: 'Gustave CHASSAGNE', region: gustave.region },
      { name: 'Eugénie CHASSAGNE', region: eugenie.region },
      { name: 'Gustavo CHASSAGNE', region: gustavo.region },
    ],
    events: [
      { type: 'MIGRATION', people: ['Gustave CHASSAGNE'], date: 'APR 1889' },
      { type: 'MIGRATION', people: ['Eugénie CHASSAGNE'], date: 'APR 1889' },
      { type: 'MIGRATION', people: ['Gustavo CHASSAGNE'], date: 'APR 1889' },
    ],
  };
}

function street(): Illustration {
  const ground = 960;
  const facades = [
    { x: 80, w: 330, top: 140, tone: '#a3875f' },
    { x: 410, w: 300, top: 90, tone: '#b29670' },
    { x: 710, w: 360, top: 160, tone: '#9a7e58' },
    { x: 1070, w: 450, top: 110, tone: '#ab8f68' },
  ];
  const windows = facades
    .map((f) =>
      Array.from({ length: 3 }, (_, row) =>
        Array.from({ length: Math.floor(f.w / 110) }, (_, col) => {
          const wx = f.x + 34 + col * 110;
          const wy = f.top + 70 + row * 180;
          return `<rect x="${wx}" y="${wy}" width="58" height="110" fill="#4f3b28" opacity="0.8"/><rect x="${wx - 6}" y="${wy + 108}" width="70" height="10" fill="#d8c7a4" opacity="0.5"/>`;
        }).join(''),
      ).join(''),
    )
    .join('');
  const scene = `
  ${facades.map((f) => `<rect x="${f.x}" y="${f.top}" width="${f.w}" height="${ground - f.top}" fill="${f.tone}" opacity="0.92"/><path d="M${f.x - 8} ${f.top} L${f.x + f.w + 8} ${f.top} L${f.x + f.w} ${f.top - 26} L${f.x} ${f.top - 26} Z" fill="#6f583c"/>`).join('')}
  ${windows}
  <path d="M760 ${ground} L760 760 Q820 700 880 760 L880 ${ground} Z" fill="#3d2c1d"/>
  <rect x="0" y="${ground}" width="${WIDTH}" height="${HEIGHT - ground}" fill="#7d6547"/>
  ${Array.from({ length: 22 }, (_, i) => `<path d="M${i * 80} ${ground + 6} L${i * 80 - 40} ${HEIGHT}" stroke="#5a462f" stroke-opacity="0.5" stroke-width="3"/>`).join('')}
  <rect x="1300" y="560" width="16" height="400" fill="${INK_SOFT}"/>
  <path d="M1270 560 L1346 560 L1330 500 L1286 500 Z" fill="#e7d7b2" opacity="0.75" stroke="${INK_SOFT}" stroke-width="5"/>`;
  const jb = figure('man', 640, ground + 40, 500);
  return {
    key: 'demo-illustration-scellerie-1872',
    title: 'Illustration — Rue de la Scellerie, Tours, 1872',
    description:
      'Image de démonstration composée par Chronolignée : ce n’est pas une photographie d’époque. Jean-Baptiste devant chez lui, l’année du recensement qui lui donne 50 ans.',
    captured: '1872',
    svg: frame(scene + jb.svg, 31),
    figures: [{ name: 'Jean-Baptiste CHASSAGNE', region: jb.region }],
    events: [{ type: 'CENSUS', people: ['Jean-Baptiste CHASSAGNE'], date: '1872' }],
  };
}

function trench(): Illustration {
  const parapet = 820;
  const stumps = [140, 330, 470, 1080, 1250, 1460]
    .map((x, i) => {
      const h = 260 + ((i * 97) % 180);
      return `<path d="M${x} ${parapet - 40} L${x + 8} ${parapet - 40 - h} L${x + 22} ${parapet - 40 - h + 60} L${x + 30} ${parapet - 40 - h * 0.6} L${x + 40} ${parapet - 40}" fill="#3a2b1d" opacity="0.85"/>`;
    })
    .join('');
  const wire = Array.from({ length: 9 }, (_, i) => {
    const x = 100 + i * 180;
    return `<rect x="${x}" y="${parapet - 140}" width="10" height="110" fill="#2b1f14" transform="rotate(${i % 2 ? 8 : -6} ${x} ${parapet - 30})"/>`;
  }).join('');
  const scene = `
  <rect x="0" y="0" width="${WIDTH}" height="${parapet}" fill="#c9b08a" opacity="0.5"/>
  <ellipse cx="1180" cy="300" rx="110" ry="110" fill="#f2e3c2" opacity="0.55" filter="url(#soft)"/>
  ${stumps}
  ${wire}
  <path d="M60 ${parapet - 90} Q400 ${parapet - 130} 800 ${parapet - 92} T1540 ${parapet - 96}" stroke="#2b1f14" stroke-width="2.5" fill="none"/>
  <path d="M60 ${parapet - 60} Q400 ${parapet - 100} 800 ${parapet - 62} T1540 ${parapet - 66}" stroke="#2b1f14" stroke-width="2.5" fill="none"/>
  <path d="M0 ${parapet - 30} Q300 ${parapet - 70} 700 ${parapet - 34} T${WIDTH} ${parapet - 40} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z" fill="#4e3b28"/>
  ${Array.from({ length: 14 }, (_, i) => `<rect x="${40 + i * 112}" y="${parapet + 30}" width="96" height="48" rx="12" fill="#6a5338" opacity="0.8"/>`).join('')}
  <rect x="0" y="${parapet + 120}" width="${WIDTH}" height="${HEIGHT - parapet - 120}" fill="#3a2b1d"/>`;
  const emile = figure('soldier', 760, parapet + 200, 520);
  return {
    key: 'demo-illustration-verdun-1916',
    title: 'Illustration — Verdun, 1916',
    description:
      'Image de démonstration composée par Chronolignée : ce n’est pas une photographie d’époque. Émile Moreau, du 66e régiment d’infanterie, au front de Verdun.',
    captured: '1916',
    svg: frame(scene + emile.svg, 43, '#ddc9a3'),
    figures: [{ name: 'Émile MOREAU', region: emile.region }],
    events: [{ type: 'MILITARY_SERVICE', people: ['Émile MOREAU'], date: 'FROM 1914 TO 1916' }],
  };
}

function studio(): Illustration {
  const floor = 960;
  const scene = `
  <rect x="120" y="80" width="1360" height="${floor - 80}" fill="#9c8462" opacity="0.65"/>
  ${Array.from({ length: 9 }, (_, i) => `<path d="M${180 + i * 150} 80 Q${230 + i * 150} 500 ${170 + i * 150} ${floor}" stroke="#7d6646" stroke-opacity="0.45" stroke-width="22" fill="none"/>`).join('')}
  <path d="M120 80 Q300 260 160 ${floor}" fill="#6e5639" opacity="0.7"/>
  <path d="M1480 80 Q1300 260 1440 ${floor}" fill="#6e5639" opacity="0.7"/>
  <rect x="0" y="${floor}" width="${WIDTH}" height="${HEIGHT - floor}" fill="#6a5236"/>
  <path d="M1170 ${floor} L1210 820 L1290 820 L1330 ${floor} Z" fill="#4a3826"/>
  ${[-60, -25, 10, 45, 80].map((a) => `<path d="M1250 820 Q${1250 + a * 1.6} ${700 + Math.abs(a) * 0.9} ${1250 + a * 2.4} ${740 + Math.abs(a) * 1.3}" stroke="#3b2c1d" stroke-width="14" fill="none" stroke-linecap="round"/>`).join('')}
  <rect x="380" y="840" width="300" height="120" rx="8" fill="#4e3a27" opacity="0.8"/>`;
  const leonie = figure('seated', 700, floor + 10, 430);
  const emile = figure('man', 920, floor + 20, 560);
  return {
    key: 'demo-illustration-noce-1910',
    title: 'Illustration — Portrait de mariage de Léonie et Émile, 1910',
    description:
      'Image de démonstration composée par Chronolignée : ce n’est pas une photographie d’époque. Un portrait d’atelier, comme on en faisait faire le jour de la noce, le 2 août 1910.',
    captured: '2 août 1910',
    svg: frame(scene + leonie.svg + emile.svg, 57, '#e6d5b3'),
    figures: [
      { name: 'Léonie MOREAU', region: leonie.region },
      { name: 'Émile MOREAU', region: emile.region },
    ],
    events: [{ type: 'MARRIAGE', people: ['Léonie MOREAU', 'Émile MOREAU'], date: '2 AUG 1910' }],
  };
}

export function demoIllustrations(): readonly Illustration[] {
  return [weddingOutside(), street(), departure(), studio(), trench()];
}
