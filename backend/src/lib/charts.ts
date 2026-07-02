// Pure server-side SVG chart generators. No deps, no DOM. Each returns an SVG
// string sized by viewBox so it scales to its container on any device. All
// user-authored labels/values are HTML-escaped via esc() before embedding, so
// the SVG can be emitted with eta's raw tag (<%~ %>) safely.

export interface Datum { label: string; value: number; sub?: string; }
export interface Segment { label: string; value: number; color: string; }

const C = {
  ink: '#1d1c17', clay: '#875134', celadon: '#3f4a3d', muted: '#4d4540',
  line: 'rgba(140,131,120,.3)', bar: '#875134', clayFill: '#875134',
};

export const CHANNEL_COLORS: Record<string, string> = {
  WEBSITE: '#875134', FACEBOOK: '#3b5998', INSTAGRAM: '#c13584', OTHER: '#7a736b',
};

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const FONT = 'font-family:Inter,system-ui,sans-serif';
function open(w: number, h: number, extra = ''): string {
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" style="width:100%;height:auto;${extra}${FONT}">`;
}
function empty(w: number, h: number): string {
  return open(w, h) + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${C.muted}" font-size="13">No data yet</text></svg>`;
}

export function barChartSVG(data: Datum[], opts: { width?: number; height?: number; color?: string; labelEvery?: number } = {}): string {
  const W = opts.width ?? 640, H = opts.height ?? 240;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, H);
  const color = opts.color ?? C.bar;
  const padL = 8, padR = 8, padT = 12, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length, slot = chartW / n, barW = Math.max(2, slot * 0.62);
  const every = opts.labelEvery ?? (n > 16 ? Math.ceil(n / 12) : 1);
  const baseY = padT + chartH;
  let body = `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="${C.line}"/>`;
  data.forEach((d, i) => {
    const bh = (d.value / max) * chartH;
    const x = padL + i * slot + (slot - barW) / 2, y = baseY - bh;
    body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="1"><title>${esc(d.label)}: ${esc(d.value)}</title></rect>`;
    if (i % every === 0) body += `<text x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${C.muted}">${esc(d.label)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function lineChartSVG(data: Datum[], opts: { width?: number; height?: number; color?: string } = {}): string {
  const W = opts.width ?? 640, H = opts.height ?? 240;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, H);
  const color = opts.color ?? C.clay;
  const padL = 10, padR = 10, padT = 14, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1), n = data.length;
  const xAt = (i: number) => (n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW);
  const yAt = (v: number) => padT + chartH - (v / max) * chartH;
  const pts = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.value).toFixed(1)}`).join(' ');
  const baseY = padT + chartH;
  const area = `${padL},${baseY} ${pts} ${(padL + chartW).toFixed(1)},${baseY}`;
  const every = n > 12 ? Math.ceil(n / 8) : 1;
  let body = `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="${C.line}"/>`;
  body += `<polygon points="${area}" fill="${color}" opacity="0.08"/>`;
  body += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`;
  data.forEach((d, i) => {
    body += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.value).toFixed(1)}" r="2.5" fill="${color}"><title>${esc(d.label)}: ${esc(d.value)}</title></circle>`;
    if (i % every === 0) body += `<text x="${xAt(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${C.muted}">${esc(d.label)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function hBarChartSVG(data: Datum[], opts: { width?: number; rowHeight?: number; color?: string } = {}): string {
  const W = opts.width ?? 640, rowH = opts.rowHeight ?? 30;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, 120);
  const color = opts.color ?? C.celadon;
  const H = data.length * rowH + 10;
  const labelW = 150, padR = 74, gap = 8, barMaxW = W - labelW - padR;
  const max = Math.max(...data.map((d) => d.value), 1);
  let body = '';
  data.forEach((d, i) => {
    const y = 6 + i * rowH;
    const bw = Math.max(1, (d.value / max) * barMaxW);
    const label = d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label;
    body += `<text x="${labelW - gap}" y="${y + rowH / 2 - 3}" text-anchor="end" font-size="11" fill="${C.ink}">${esc(label)}</text>`;
    body += `<rect x="${labelW}" y="${y}" width="${bw.toFixed(1)}" height="${rowH - 12}" fill="${color}" rx="1"/>`;
    body += `<text x="${(labelW + bw + gap).toFixed(1)}" y="${y + rowH / 2 - 3}" font-size="11" fill="${C.muted}">${esc(d.sub ?? d.value)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function donutChartSVG(segments: Segment[], opts: { size?: number } = {}): string {
  const size = opts.size ?? 240;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return empty(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 10, inner = r * 0.58;
  let a0 = -Math.PI / 2, body = '';
  for (const seg of segments) {
    if (seg.value <= 0) continue;
    const frac = seg.value / total;
    if (frac >= 0.999999) {
      body += `<circle cx="${cx}" cy="${cy}" r="${((r + inner) / 2).toFixed(2)}" fill="none" stroke="${seg.color}" stroke-width="${(r - inner).toFixed(2)}"><title>${esc(seg.label)}: ${esc(seg.value)} (100%)</title></circle>`;
      continue;
    }
    const a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0);
    body += `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${seg.color}"><title>${esc(seg.label)}: ${esc(seg.value)} (${Math.round(frac * 100)}%)</title></path>`;
    a0 = a1;
  }
  return open(size, size, `max-width:${size}px;`) + body + '</svg>';
}
