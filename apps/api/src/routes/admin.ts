import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../lib/db.js';
import { bad, notFound } from '../lib/errors.js';
import { requireRole } from '../app.js';

async function audit(actor: number, action: string, entity: string, entityId: unknown, data: object = {}) {
  await pool.query('INSERT INTO audit_logs (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
    [actor, action, entity, String(entityId), data]);
}

export default async function (app: FastifyInstance) {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/stats', async () => (await pool.query(
    `SELECT (SELECT count(*) FROM users WHERE role = 'customer')::int AS customers,
            (SELECT count(*) FROM vendors)::int AS vendors,
            (SELECT count(*) FROM vendors WHERE status = 'pending')::int AS pending_vendors,
            (SELECT count(*) FROM leads)::int AS leads,
            (SELECT count(*) FROM leads WHERE status IN ('vendors_notified','quotes_received'))::int AS active_leads,
            (SELECT count(*) FROM quotations)::int AS quotations,
            (SELECT coalesce(-sum(amount_paise),0) FROM wallet_transactions WHERE type = 'quote_fee')::bigint
              - (SELECT coalesce(sum(amount_paise),0) FROM wallet_transactions WHERE type = 'refund')::bigint AS revenue_paise,
            (SELECT coalesce(sum(balance_paise),0) FROM wallets)::bigint AS wallet_liability_paise`,
  )).rows[0]);

  app.get('/revenue/by-category', async () => (await pool.query(
    `SELECT p.name AS category, count(*)::int AS quotes, -sum(t.amount_paise)::bigint AS revenue_paise
       FROM wallet_transactions t JOIN leads l ON l.id = t.lead_id JOIN categories c ON c.id = l.category_id
       JOIN categories p ON p.id = coalesce(c.parent_id, c.id)
      WHERE t.type = 'quote_fee' GROUP BY p.name ORDER BY revenue_paise DESC`,
  )).rows);

  app.get('/vendors', async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT v.user_id AS id, v.business_name, v.status, v.service_radius_km, c.name AS city, u.phone, u.name AS owner,
              coalesce(w.balance_paise,0) AS balance_paise,
              array(SELECT k.name FROM vendor_categories vc JOIN categories k ON k.id = vc.category_id WHERE vc.vendor_id = v.user_id) AS categories
         FROM vendors v JOIN users u ON u.id = v.user_id JOIN cities c ON c.id = v.city_id
         LEFT JOIN wallets w ON w.vendor_id = v.user_id
        WHERE ($1::text IS NULL OR v.status::text = $1) ORDER BY v.created_at DESC LIMIT 500`,
      [status ?? null],
    )).rows;
  });

  app.post('/vendors/:id/status', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { status } = z.object({ status: z.enum(['approved', 'rejected', 'suspended', 'pending']) }).parse(req.body);
    const r = await pool.query('UPDATE vendors SET status = $2 WHERE user_id = $1 RETURNING user_id', [id, status]);
    if (!r.rowCount) throw notFound('Vendor not found');
    await audit(req.user.sub, `vendor.${status}`, 'vendor', id);
    return { id, status };
  });

  app.get('/leads', async (req) => {
    const q = z.object({ cityId: z.coerce.number().optional(), status: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT l.id, l.title, l.status, l.created_at, l.flagged, k.name AS category, c.name AS city, u.name AS customer,
              (SELECT count(*) FROM lead_vendors lv WHERE lv.lead_id = l.id)::int AS vendors,
              (SELECT count(*) FROM quotations q WHERE q.lead_id = l.id)::int AS quotes
         FROM leads l JOIN categories k ON k.id = l.category_id JOIN cities c ON c.id = l.city_id JOIN users u ON u.id = l.customer_id
        WHERE ($1::int IS NULL OR l.city_id = $1) AND ($2::text IS NULL OR l.status::text = $2)
        ORDER BY l.id DESC LIMIT 200`,
      [q.cityId ?? null, q.status ?? null],
    )).rows;
  });

  // Category + subcategory management (dynamic, never hardcoded).
  app.post('/categories', async (req) => {
    const b = z.object({
      parentId: z.number().int().nullable().default(null),
      name: z.string().min(2).max(80),
      type: z.enum(['service', 'product', 'professional', 'manufacturer', 'dealer']).default('service'),
      keywords: z.array(z.string()).default([]),
      fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(['text', 'number', 'select']), options: z.array(z.string()).optional() })).default([]),
      feeRupees: z.number().nonnegative().optional(),
    }).parse(req.body);
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return tx(async (c) => {
      const cat = (await c.query(
        'INSERT INTO categories (parent_id, name, slug, type, keywords, fields) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.parentId, b.name, slug, b.type, b.keywords, JSON.stringify(b.fields)],
      )).rows[0];
      if (b.feeRupees !== undefined) {
        await c.query('INSERT INTO pricing_rules (category_id, fee_paise, created_by) VALUES ($1,$2,$3)', [cat.id, Math.round(b.feeRupees * 100), req.user.sub]);
      }
      return cat;
    });
  });

  app.patch('/categories/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = z.object({ name: z.string().optional(), active: z.boolean().optional(), keywords: z.array(z.string()).optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE categories SET name = coalesce($2, name), active = coalesce($3, active), keywords = coalesce($4, keywords)
        WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.active ?? null, b.keywords ?? null],
    );
    if (!r.rowCount) throw notFound();
    return r.rows[0];
  });

  // Pricing: new rules apply to new quotations only; past fees are stored on each quotation and ledger row.
  app.get('/pricing', async () => (await pool.query(
    `SELECT k.id AS category_id, k.name, p.name AS parent, k.parent_id,
            (SELECT pr.fee_paise FROM pricing_rules pr WHERE pr.category_id = k.id AND pr.city_id IS NULL
               AND pr.effective_from <= now() AND (pr.effective_to IS NULL OR pr.effective_to > now())
             ORDER BY pr.effective_from DESC LIMIT 1) AS fee_paise
       FROM categories k LEFT JOIN categories p ON p.id = k.parent_id ORDER BY coalesce(p.name, k.name), k.parent_id NULLS FIRST, k.name`,
  )).rows);

  app.post('/pricing', async (req) => {
    const b = z.object({
      categoryId: z.number().int(),
      cityId: z.number().int().nullable().default(null),
      feeRupees: z.number().nonnegative().max(10000),
      effectiveFrom: z.string().datetime().optional(),
    }).parse(req.body);
    const r = await tx(async (c) => {
      const from = b.effectiveFrom ?? new Date().toISOString();
      await c.query(
        `UPDATE pricing_rules SET effective_to = $3 WHERE category_id = $1 AND city_id IS NOT DISTINCT FROM $2
           AND effective_to IS NULL AND effective_from <= $3`,
        [b.categoryId, b.cityId, from],
      );
      return (await c.query(
        'INSERT INTO pricing_rules (category_id, city_id, fee_paise, effective_from, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [b.categoryId, b.cityId, Math.round(b.feeRupees * 100), from, req.user.sub],
      )).rows[0];
    });
    await audit(req.user.sub, 'pricing.set', 'category', b.categoryId, b);
    return r;
  });

  app.get('/settings', async () => Object.fromEntries((await pool.query('SELECT key, value FROM admin_settings')).rows.map((r) => [r.key, r.value])));

  app.put('/settings', async (req) => {
    const b = z.object({
      default_quote_fee_paise: z.number().int().nonnegative().optional(),
      max_vendors_per_lead: z.number().int().min(1).max(100).optional(),
      lead_expiry_hours: z.number().int().min(1).max(24 * 60).optional(),
      contact_reveal_mode: z.enum(['after_selection', 'never']).optional(),
    }).parse(req.body);
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      await pool.query('UPDATE admin_settings SET value = $2 WHERE key = $1', [k, JSON.stringify(v)]);
    }
    await audit(req.user.sub, 'settings.update', 'settings', null, b);
    return { ok: true };
  });

  // Refund a quotation fee (e.g. fake lead confirmed). Idempotent via ledger reference.
  app.post('/refunds', async (req) => {
    const { quotationId, reason } = z.object({ quotationId: z.number().int(), reason: z.string().min(3) }).parse(req.body);
    const out = await tx(async (c) => {
      const fee = (await c.query(`SELECT * FROM wallet_transactions WHERE reference = $1`, [`quote:${quotationId}`])).rows[0];
      if (!fee) throw notFound('No fee found for this quotation');
      const exists = (await c.query('SELECT 1 FROM wallet_transactions WHERE reference = $1', [`refund:${quotationId}`])).rowCount;
      if (exists) throw bad('Already refunded', 'already_refunded');
      const w = (await c.query(
        'UPDATE wallets SET balance_paise = balance_paise + $2, updated_at = now() WHERE vendor_id = $1 RETURNING balance_paise',
        [fee.vendor_id, -fee.amount_paise],
      )).rows[0];
      await c.query(
        `INSERT INTO wallet_transactions (vendor_id, type, amount_paise, balance_after_paise, reference, lead_id, quotation_id, note)
         VALUES ($1,'refund',$2,$3,$4,$5,$6,$7)`,
        [fee.vendor_id, -fee.amount_paise, w.balance_paise, `refund:${quotationId}`, fee.lead_id, quotationId, reason],
      );
      return { refundedPaise: -fee.amount_paise, balancePaise: w.balance_paise };
    });
    await audit(req.user.sub, 'wallet.refund', 'quotation', quotationId, { reason });
    return out;
  });

  app.get('/cities', async () => (await pool.query('SELECT * FROM cities ORDER BY name')).rows);
  app.post('/cities', async (req) => {
    const b = z.object({ name: z.string(), state: z.string(), lat: z.number(), lng: z.number() }).parse(req.body);
    return (await pool.query('INSERT INTO cities (name, state, lat, lng) VALUES ($1,$2,$3,$4) RETURNING *', [b.name, b.state, b.lat, b.lng])).rows[0];
  });
}
