import type { FastifyInstance } from 'fastify';
import { registerAdminAuth } from './auth';
import { registerAdminDashboard } from './dashboard';
import { registerAdminCategories } from './categories';
import { registerAdminProducts } from './products';
import { registerAdminOrders } from './orders';
import { registerAdminTeam } from './team';

// Server-rendered admin panel.
export async function registerAdmin(app: FastifyInstance) {
  registerAdminAuth(app);
  registerAdminDashboard(app);
  registerAdminCategories(app);
  registerAdminProducts(app);
  registerAdminOrders(app);
  registerAdminTeam(app);
}
