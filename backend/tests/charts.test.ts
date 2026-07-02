import { describe, it, expect } from 'vitest';
import { barChartSVG, lineChartSVG, hBarChartSVG, donutChartSVG, CHANNEL_COLORS } from '../src/lib/charts';

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('charts.ts', () => {
  it('barChartSVG: one <rect> per datum, taller bar for larger value, has viewBox', () => {
    const svg = barChartSVG([{ label: 'a', value: 1 }, { label: 'b', value: 4 }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0');
    expect(count(svg, /<rect\b/g)).toBe(2);
    const heights = [...svg.matchAll(/height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });

  it('lineChartSVG: emits a polyline with one point per datum', () => {
    const svg = lineChartSVG([{ label: 'a', value: 2 }, { label: 'b', value: 5 }, { label: 'c', value: 3 }]);
    const poly = svg.match(/<polyline points="([^"]+)"/);
    expect(poly).toBeTruthy();
    expect(poly![1].trim().split(/\s+/).length).toBe(3);
  });

  it('hBarChartSVG: one bar <rect> per datum and shows the sub label', () => {
    const svg = hBarChartSVG([{ label: 'Bowl', value: 300, sub: '৳300' }, { label: 'Mug', value: 100, sub: '৳100' }]);
    expect(count(svg, /<rect\b/g)).toBe(2);
    expect(svg).toContain('৳300');
  });

  it('donutChartSVG: one arc <path> per nonzero segment', () => {
    const svg = donutChartSVG([
      { label: 'A', value: 3, color: '#111' },
      { label: 'B', value: 1, color: '#222' },
      { label: 'C', value: 0, color: '#333' },
    ]);
    expect(count(svg, /<path\b/g)).toBe(2);
  });

  it('donutChartSVG: a single 100% segment renders a full ring (circle)', () => {
    const svg = donutChartSVG([{ label: 'only', value: 5, color: '#111' }]);
    expect(svg).toContain('<circle');
  });

  it('empty / all-zero data renders a "No data yet" placeholder for every chart', () => {
    for (const svg of [barChartSVG([]), lineChartSVG([{ label: 'x', value: 0 }]), hBarChartSVG([]), donutChartSVG([])]) {
      expect(svg).toContain('No data yet');
    }
  });

  it('escapes markup in labels (no raw < from a malicious label)', () => {
    const svg = hBarChartSVG([{ label: '<script>x</script>', value: 5 }]);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('exposes stable channel colors', () => {
    expect(CHANNEL_COLORS.WEBSITE).toBeTruthy();
    expect(CHANNEL_COLORS.FACEBOOK).toBeTruthy();
    expect(CHANNEL_COLORS.INSTAGRAM).toBeTruthy();
    expect(CHANNEL_COLORS.OTHER).toBeTruthy();
  });
});
