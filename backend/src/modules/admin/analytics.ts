import type { FastifyInstance } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import type { Period } from '../analytics/service';
import {
  getSummary, getSalesOverTime, getPeakHours, getPeakWeekdays,
  getTopProducts, getTopCategories, getTopCollections, getOrdersByChannel,
} from '../analytics/service';
import { barChartSVG, lineChartSVG, hBarChartSVG, donutChartSVG, CHANNEL_COLORS } from '../../lib/charts';

const PERIODS: readonly string[] = ['daily', 'weekly', 'monthly'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const taka = (n: number) => '৳' + Math.round(n).toLocaleString('en-US');

export function registerAdminAnalytics(app: FastifyInstance) {
  app.get('/admin/analytics', { preHandler: requireAdminSession }, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const raw = (req.query as { period?: string }).period ?? 'daily';
    const period: Period = (PERIODS.includes(raw) ? raw : 'daily') as Period;

    const [summary, sales, hours, weekdays, products, categories, collections, channels] = await Promise.all([
      getSummary(app.prisma, period),
      getSalesOverTime(app.prisma, period),
      getPeakHours(app.prisma, period),
      getPeakWeekdays(app.prisma, period),
      getTopProducts(app.prisma, period),
      getTopCategories(app.prisma, period),
      getTopCollections(app.prisma, period),
      getOrdersByChannel(app.prisma, period),
    ]);

    const charts = {
      sales: lineChartSVG(sales.map((s) => ({ label: s.label, value: s.revenue }))),
      hours: barChartSVG(hours.map((h) => ({ label: String(h.hour), value: h.orders })), { labelEvery: 3 }),
      weekdays: barChartSVG(weekdays.map((w) => ({ label: WEEKDAYS[w.weekday - 1], value: w.orders }))),
      products: hBarChartSVG(products.map((p) => ({ label: p.name, value: p.revenue, sub: `${taka(p.revenue)} · ${p.units}u` }))),
      categories: hBarChartSVG(categories.map((c) => ({ label: c.name, value: c.revenue, sub: taka(c.revenue) }))),
      collections: hBarChartSVG(collections.map((c) => ({ label: c.name, value: c.revenue, sub: taka(c.revenue) }))),
      channels: donutChartSVG(channels.map((c) => ({ label: c.source, value: c.orders, color: CHANNEL_COLORS[c.source] ?? '#7a736b' }))),
    };

    const totalCh = channels.reduce((s, c) => s + c.orders, 0);
    const channelLegend = channels.map((c) => ({
      source: c.source, orders: c.orders, revenue: taka(c.revenue),
      pct: totalCh ? Math.round((c.orders / totalCh) * 100) : 0,
      color: CHANNEL_COLORS[c.source] ?? '#7a736b',
    }));

    return renderPage(reply, {
      template: 'analytics', title: 'Analytics', user, active: 'analytics', csrf,
      data: {
        period,
        summary: { orders: summary.orders, revenue: taka(summary.revenue), aov: taka(summary.aov) },
        charts, channelLegend,
      },
    });
  });
}
