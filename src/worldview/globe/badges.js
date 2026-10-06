// Worldview Globe: marker images drawn on a canvas. Each marker is a ring split
// by the topics of its stories (so you can see the mix at a glance) with the
// number of stories in the middle. Images are cached, so redrawing is cheap.

const cache = new Map();
const RATIO = Math.min(globalThis.devicePixelRatio || 1, 2);

/**
 * @param {object} o
 * @param {number} o.count            stories in this marker
 * @param {Array<[string, number]>} o.mix  [color, share] pairs, shares summing to 1
 * @param {'place'|'region'|'country'} o.kind
 * @param {boolean} [o.selected]
 * @param {string} [o.text]           override the middle text (e.g. "1" for a route stop)
 * @returns {{image: HTMLCanvasElement, size: number}}
 */
export function badge({ count, mix, kind, selected = false, text }) {
  const label =
    text ?? (count > 1 ? (count > 999 ? '999+' : String(count)) : '');
  const key = `${kind}|${label}|${selected}|${mix.map(([c, s]) => `${c}:${s.toFixed(2)}`).join(',')}`;
  if (cache.has(key)) return cache.get(key);

  const base = kind === 'country' ? 30 : kind === 'region' ? 26 : 18;
  const size = Math.round(
    Math.min(base + Math.sqrt(count) * (kind === 'place' ? 3 : 4), 64),
  );
  const pad = selected ? 10 : 4;
  const full = size + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = full * RATIO;
  const ctx = canvas.getContext('2d');
  ctx.scale(RATIO, RATIO);
  const c = full / 2;
  const r = size / 2;
  const ring = Math.max(4, size * 0.2);

  if (selected) {
    const glow = ctx.createRadialGradient(c, c, r * 0.6, c, c, r + pad);
    glow.addColorStop(0, 'rgba(255, 214, 102, 0.9)');
    glow.addColorStop(1, 'rgba(255, 214, 102, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, r + pad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Centre: dark for places, lighter for provinces/countries (they're summaries).
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle =
    kind === 'place' ? 'rgba(16, 24, 32, 0.88)' : 'rgba(16, 24, 32, 0.62)';
  ctx.fill();

  // Topic ring.
  let start = -Math.PI / 2;
  for (const [color, share] of mix) {
    const end = start + share * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c, c, r - ring / 2, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = ring;
    ctx.stroke();
    start = end;
  }

  // Outline: solid for places, dashed for provinces, double for countries.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  if (kind === 'region') ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (kind === 'country') {
    ctx.beginPath();
    ctx.arc(c, c, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();
  }

  if (label) {
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(10, Math.round(size * 0.36))}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, c, c + 0.5);
  }

  const result = { image: canvas, size: full };
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

/** Colours for event severity: information, minor, moderate, severe. */
export const SEVERITY_COLORS = ['#8ecae6', '#ffd166', '#f8961e', '#ef233c'];
export const SEVERITY_NAMES = ['Information', 'Minor', 'Moderate', 'Severe'];

/**
 * An event marker: the source's emoji on a disc coloured by severity.
 * @returns {{image: HTMLCanvasElement, size: number}}
 */
export function iconBadge(icon, severity = 0, { selected = false } = {}) {
  const key = `icon|${icon}|${severity}|${selected}`;
  if (cache.has(key)) return cache.get(key);
  const size = 22 + severity * 3;
  const pad = selected ? 8 : 3;
  const full = size + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = full * RATIO;
  const ctx = canvas.getContext('2d');
  ctx.scale(RATIO, RATIO);
  const c = full / 2;
  const r = size / 2;
  if (selected) {
    ctx.beginPath();
    ctx.arc(c, c, r + pad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 214, 102, 0.55)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 18, 26, 0.85)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS[0];
  ctx.stroke();
  ctx.font = `${Math.round(size * 0.58)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, c, c + 1);
  const result = { image: canvas, size: full };
  cache.set(key, result);
  return result;
}
