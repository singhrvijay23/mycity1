import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, setting } from '../lib/db.js';
import { bad, forbidden, notFound } from '../lib/errors.js';
import { guardContact } from '../lib/contact-guard.js';
import { requireRole } from '../app.js';

/**
 * In-app chat between a customer and a vendor on one lead. MyCity is the only channel:
 * contact details are redacted before selection (Phase 1) and always (Phase 2, contact_reveal_mode = 'never').
 * MVP clients poll with ?after=<lastId>; swap to WebSockets/Redis pub-sub without changing storage.
 */
export default async function (app: FastifyInstance) {
  const auth = { preHandler: requireRole('customer', 'vendor') };

  async function access(userId: number, role: string, leadId: number, vendorId: number) {
    const r = (await pool.query(
      `SELECT l.customer_id, s.vendor_id AS selected_vendor
         FROM lead_vendors lv JOIN leads l ON l.id = lv.lead_id
         LEFT JOIN lead_selections s ON s.lead_id = l.id
        WHERE lv.lead_id = $1 AND lv.vendor_id = $2`,
      [leadId, vendorId],
    )).rows[0];
    if (!r) throw notFound('Conversation not found');
    if (role === 'customer' ? r.customer_id !== userId : vendorId !== userId) throw forbidden();
    return r;
  }

  // Open (or get) the conversation for a lead + vendor pair.
  app.post('/conversations', auth, async (req) => {
    const b = z.object({ leadId: z.number().int(), vendorId: z.number().int().optional() }).parse(req.body);
    const vendorId = req.user.role === 'vendor' ? req.user.sub : b.vendorId;
    if (!vendorId) throw bad('vendorId required');
    await access(req.user.sub, req.user.role, b.leadId, vendorId);
    const c = (await pool.query(
      `INSERT INTO conversations (lead_id, vendor_id) VALUES ($1,$2)
       ON CONFLICT (lead_id, vendor_id) DO UPDATE SET lead_id = EXCLUDED.lead_id RETURNING id, lead_id, vendor_id`,
      [b.leadId, vendorId],
    )).rows[0];
    return c;
  });

  async function conv(id: number, userId: number, role: string) {
    const c = (await pool.query('SELECT * FROM conversations WHERE id = $1', [id])).rows[0];
    if (!c) throw notFound('Conversation not found');
    const a = await access(userId, role, c.lead_id, c.vendor_id);
    return { ...c, ...a };
  }

  app.get('/conversations/:id/messages', auth, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const after = Number((req.query as { after?: string }).after ?? 0);
    await conv(id, req.user.sub, req.user.role);
    return (await pool.query(
      `SELECT m.id, m.sender_id, m.body, m.redacted, m.created_at, u.role AS sender_role
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 200`,
      [id, after],
    )).rows;
  });

  app.post('/conversations/:id/messages', auth, async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const c = await conv(id, req.user.sub, req.user.role);
    const mode = await setting<string>(pool, 'contact_reveal_mode');
    const contactAllowed = mode === 'after_selection' && c.selected_vendor === c.vendor_id;
    const g = contactAllowed ? { text: body, redacted: false } : guardContact(body);
    const m = (await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, body, redacted) VALUES ($1,$2,$3,$4) RETURNING id, body, redacted, created_at',
      [id, req.user.sub, g.text, g.redacted],
    )).rows[0];
    return rep.status(201).send(m);
  });
}
