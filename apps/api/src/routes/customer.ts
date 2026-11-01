import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, setting, tx } from '../lib/db.js';
import { bad, forbidden, notFound } from '../lib/errors.js';
import { distributeLead } from '../lib/matching.js';
import { requireRole } from '../app.js';
import { linkPhotos, photosFor } from '../lib/attachments.js';

const leadInput = z.object({
  categoryId: z.number().int(),
  cityId: z.number().int(),
  localityId: z.number().int().optional(),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(4000),
  details: z.record(z.string(), z.unknown()).default({}),
  address: z.string().max(500).optional(),
  budgetRupees: z.number().positive().optional(),
  neededBy: z.string().date().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  photoIds: z.array(z.string().uuid()).optional(),
});

export default async function (app: FastifyInstance) {
  const customer = { preHandler: requireRole('customer') };

  app.post('/leads', customer, async (req, rep) => {
    const b = leadInput.parse(req.body);
    const me = req.user.sub;

    const cat = (await pool.query('SELECT id, parent_id FROM categories WHERE id = $1 AND active', [b.categoryId])).rows[0];
    if (!cat || cat.parent_id === null) throw bad('Choose a subcategory', 'invalid_category');

    // Location: explicit GPS > locality centre > city centre.
    const loc = (await pool.query(
      `SELECT c.lat AS clat, c.lng AS clng, l.lat AS llat, l.lng AS llng
         FROM cities c LEFT JOIN localities l ON l.id = $2 AND l.city_id = c.id
        WHERE c.id = $1 AND c.active`,
      [b.cityId, b.localityId ?? null],
    )).rows[0];
    if (!loc) throw bad('Unknown city', 'invalid_city');
    const lat = b.lat ?? loc.llat ?? loc.clat;
    const lng = b.lng ?? loc.llng ?? loc.clng;

    // Basic abuse guard: same customer, same category, near-identical text within 24h.
    const dup = (await pool.query(
      `SELECT id FROM leads WHERE customer_id = $1 AND category_id = $2 AND lower(description) = lower($3)
          AND created_at > now() - interval '24 hours' AND status NOT IN ('cancelled','expired') LIMIT 1`,
      [me, b.categoryId, b.description],
    )).rows[0];
    if (dup) throw bad(`You already posted this requirement (Lead #${dup.id})`, 'duplicate_lead');

    const result = await tx(async (c) => {
      const hours = Number(await setting<number>(c, 'lead_expiry_hours'));
      const lead = (await c.query(
        `INSERT INTO leads (customer_id, category_id, city_id, locality_id, lat, lng, title, description, details,
                            address, budget_paise, needed_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(hours => $13))
         RETURNING id`,
        [me, b.categoryId, b.cityId, b.localityId ?? null, lat, lng, b.title, b.description, b.details,
         b.address ?? null, b.budgetRupees ? Math.round(b.budgetRupees * 100) : null, b.neededBy ?? null, hours],
      )).rows[0];
      await linkPhotos(c, 'lead', lead.id, me, b.photoIds);
      const notified = await distributeLead(c, lead.id);
      return { id: lead.id, vendorsNotified: notified };
    });
    return rep.status(201).send(result);
  });

  app.get('/leads', customer, async (req) => {
    return (await pool.query(
      `SELECT l.id, l.title, l.status, l.created_at, k.name AS category,
              (SELECT count(*) FROM lead_vendors lv WHERE lv.lead_id = l.id)::int AS vendors_notified,
              (SELECT count(*) FROM quotations q WHERE q.lead_id = l.id)::int AS quotes
         FROM leads l JOIN categories k ON k.id = l.category_id
        WHERE l.customer_id = $1 ORDER BY l.id DESC LIMIT 100`,
      [req.user.sub],
    )).rows;
  });

  app.get('/leads/:id', customer, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const lead = (await pool.query(
      `SELECT l.*, k.name AS category, ci.name AS city, lo.name AS locality
         FROM leads l JOIN categories k ON k.id = l.category_id JOIN cities ci ON ci.id = l.city_id
         LEFT JOIN localities lo ON lo.id = l.locality_id WHERE l.id = $1`,
      [id],
    )).rows[0];
    if (!lead) throw notFound('Lead not found');
    if (lead.customer_id !== req.user.sub) throw forbidden();

    const mode = await setting<string>(pool, 'contact_reveal_mode');
    const quotes = (await pool.query(
      `SELECT q.id, q.vendor_id, q.amount_paise, q.description, q.items, q.completion_days, q.warranty, q.valid_until,
              q.status, q.revision, q.updated_at, v.business_name, v.rating, lv.distance_km,
              (s.vendor_id IS NOT NULL) AS selected,
              CASE WHEN s.vendor_id IS NOT NULL AND $2 = 'after_selection' THEN u.phone END AS vendor_phone
         FROM quotations q
         JOIN vendors v ON v.user_id = q.vendor_id
         JOIN users u ON u.id = v.user_id
         JOIN lead_vendors lv ON lv.lead_id = q.lead_id AND lv.vendor_id = q.vendor_id
         LEFT JOIN lead_selections s ON s.lead_id = q.lead_id AND s.vendor_id = q.vendor_id
        WHERE q.lead_id = $1 ORDER BY q.amount_paise ASC`,
      [id, mode],
    )).rows;
    lead.photos = (await photosFor(pool, 'lead', [id])).get(id) ?? [];
    const qp = await photosFor(pool, 'quotation', quotes.map((q) => q.id));
    const vp = await photosFor(pool, 'vendor', [...new Set(quotes.map((q) => q.vendor_id))]);
    for (const q of quotes) { q.photos = qp.get(q.id) ?? []; q.vendor_photos = vp.get(q.vendor_id) ?? []; }
    return { lead, quotes };
  });

  app.post('/leads/:id/select', customer, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { quotationId } = z.object({ quotationId: z.number().int() }).parse(req.body);
    return tx(async (c) => {
      const lead = (await c.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!lead) throw notFound('Lead not found');
      if (lead.customer_id !== req.user.sub) throw forbidden();
      if (!['quotes_received', 'vendors_notified'].includes(lead.status)) throw bad(`Lead is ${lead.status}`, 'invalid_state');
      const q = (await c.query('SELECT * FROM quotations WHERE id = $1 AND lead_id = $2', [quotationId, id])).rows[0];
      if (!q || q.status !== 'submitted') throw bad('Quotation not available', 'invalid_quotation');
      await c.query('INSERT INTO lead_selections (lead_id, quotation_id, vendor_id) VALUES ($1,$2,$3)', [id, q.id, q.vendor_id]);
      await c.query(`UPDATE quotations SET status = CASE WHEN id = $2 THEN 'accepted'::quotation_status ELSE 'rejected'::quotation_status END
                      WHERE lead_id = $1 AND status = 'submitted'`, [id, q.id]);
      await c.query(`UPDATE leads SET status = 'vendor_selected' WHERE id = $1`, [id]);
      return { selected: true, vendorId: q.vendor_id };
    });
  });

  // Add or remove photos while the lead is open. Vendors see the updated set.
  app.put('/leads/:id/photos', customer, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { photoIds } = z.object({ photoIds: z.array(z.string().uuid()) }).parse(req.body);
    await tx(async (c) => {
      const lead = (await c.query('SELECT customer_id, status FROM leads WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!lead) throw notFound('Lead not found');
      if (lead.customer_id !== req.user.sub) throw forbidden();
      if (['cancelled', 'expired', 'completed'].includes(lead.status)) throw bad(`Lead is ${lead.status}`, 'invalid_state');
      await linkPhotos(c, 'lead', id, req.user.sub, photoIds, true);
    });
    return { photos: (await photosFor(pool, 'lead', [id])).get(id) ?? [] };
  });

  app.post('/leads/:id/cancel', customer, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const r = await pool.query(
      `UPDATE leads SET status = 'cancelled' WHERE id = $1 AND customer_id = $2
         AND status IN ('submitted','under_review','vendors_notified','quotes_received') RETURNING id`,
      [id, req.user.sub],
    );
    if (!r.rowCount) throw bad('This lead cannot be cancelled', 'invalid_state');
    return { cancelled: true };
  });
}
