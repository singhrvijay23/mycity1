import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, setting, tx } from '../lib/db.js';
import { bad, forbidden, HttpError, notFound } from '../lib/errors.js';
import { quoteFee } from '../lib/pricing.js';
import { requireRole } from '../app.js';
import { linkPhotos, photosFor } from '../lib/attachments.js';

const quoteInput = z.object({
  amountRupees: z.number().nonnegative(),
  description: z.string().min(5).max(4000),
  items: z.array(z.object({ label: z.string().max(120), amountRupees: z.number().nonnegative() })).max(50).default([]),
  completionDays: z.number().int().positive().max(365).optional(),
  warranty: z.string().max(200).optional(),
  validUntil: z.string().date().optional(),
  photoIds: z.array(z.string().uuid()).optional(),
});
const toItems = (items: { label: string; amountRupees: number }[]) =>
  JSON.stringify(items.map((i) => ({ label: i.label, amount_paise: Math.round(i.amountRupees * 100) })));

async function approvedVendor(userId: number) {
  const v = (await pool.query('SELECT * FROM vendors WHERE user_id = $1', [userId])).rows[0];
  if (!v) throw bad('Complete your business profile first', 'no_profile');
  if (v.status !== 'approved') throw forbidden(`Your business is ${v.status}. Leads start after admin approval.`);
  return v;
}

export default async function (app: FastifyInstance) {
  app.addHook('preHandler', requireRole('vendor'));

  // Create or update the business profile. Any change to an approved profile keeps approval; new ones start pending.
  app.put('/profile', async (req) => {
    const b = z.object({
      businessName: z.string().min(2).max(120),
      description: z.string().max(2000).default(''),
      businessType: z.enum(['service', 'product', 'professional', 'manufacturer', 'dealer']).default('service'),
      cityId: z.number().int(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      serviceRadiusKm: z.number().int().min(1).max(300).default(15),
      gstNumber: z.string().max(20).optional(),
      categoryIds: z.array(z.number().int()).min(1).max(30),
      photoIds: z.array(z.string().uuid()).optional(),
    }).parse(req.body);
    const me = req.user.sub;
    return tx(async (c) => {
      const city = (await c.query('SELECT lat, lng FROM cities WHERE id = $1', [b.cityId])).rows[0];
      if (!city) throw bad('Unknown city', 'invalid_city');
      await c.query(
        `INSERT INTO vendors (user_id, business_name, description, business_type, city_id, lat, lng, service_radius_km, gst_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (user_id) DO UPDATE SET business_name = $2, description = $3, business_type = $4, city_id = $5,
           lat = $6, lng = $7, service_radius_km = $8, gst_number = $9`,
        [me, b.businessName, b.description, b.businessType, b.cityId, b.lat ?? city.lat, b.lng ?? city.lng, b.serviceRadiusKm, b.gstNumber ?? null],
      );
      await c.query('DELETE FROM vendor_categories WHERE vendor_id = $1', [me]);
      await c.query(
        `INSERT INTO vendor_categories (vendor_id, category_id)
         SELECT $1, id FROM categories WHERE id = ANY($2::int[]) AND active`,
        [me, b.categoryIds],
      );
      await c.query('INSERT INTO wallets (vendor_id) VALUES ($1) ON CONFLICT DO NOTHING', [me]);
      await linkPhotos(c, 'vendor', me, me, b.photoIds, true);
      return (await c.query('SELECT user_id, business_name, status FROM vendors WHERE user_id = $1', [me])).rows[0];
    });
  });

  // Leads assigned to me. Customer identity and precise address are never selected here.
  app.get('/leads', async (req) => {
    await approvedVendor(req.user.sub);
    return (await pool.query(
      `SELECT l.id, l.title, l.status, l.created_at, l.needed_by, l.budget_paise, k.name AS category,
              ci.name AS city, lo.name AS locality, lv.distance_km, lv.status AS my_status,
              q.id AS my_quote_id, q.status AS my_quote_status
         FROM lead_vendors lv
         JOIN leads l ON l.id = lv.lead_id
         JOIN categories k ON k.id = l.category_id
         JOIN cities ci ON ci.id = l.city_id
         LEFT JOIN localities lo ON lo.id = l.locality_id
         LEFT JOIN quotations q ON q.lead_id = l.id AND q.vendor_id = lv.vendor_id
        WHERE lv.vendor_id = $1 ORDER BY lv.notified_at DESC LIMIT 200`,
      [req.user.sub],
    )).rows;
  });

  app.get('/leads/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const me = req.user.sub;
    await approvedVendor(me);
    const lead = (await pool.query(
      `SELECT l.id, l.title, l.description, l.details, l.status, l.created_at, l.needed_by, l.budget_paise,
              l.category_id, l.city_id, k.name AS category, ci.name AS city, lo.name AS locality, lv.distance_km
         FROM lead_vendors lv
         JOIN leads l ON l.id = lv.lead_id
         JOIN categories k ON k.id = l.category_id
         JOIN cities ci ON ci.id = l.city_id
         LEFT JOIN localities lo ON lo.id = l.locality_id
        WHERE lv.lead_id = $1 AND lv.vendor_id = $2`,
      [id, me],
    )).rows[0];
    if (!lead) throw notFound('Lead not found');
    await pool.query(`UPDATE lead_vendors SET status = 'viewed' WHERE lead_id = $1 AND vendor_id = $2 AND status = 'notified'`, [id, me]);

    const fee = await quoteFee(pool, lead.category_id, lead.city_id);
    const myQuote = (await pool.query('SELECT * FROM quotations WHERE lead_id = $1 AND vendor_id = $2', [id, me])).rows[0] ?? null;

    // Contact reveal is enforced here on the server, not in the UI.
    let customerContact = null;
    const mode = await setting<string>(pool, 'contact_reveal_mode');
    if (mode === 'after_selection') {
      customerContact = (await pool.query(
        `SELECT u.name, u.phone, l.address FROM lead_selections s
           JOIN leads l ON l.id = s.lead_id JOIN users u ON u.id = l.customer_id
          WHERE s.lead_id = $1 AND s.vendor_id = $2`,
        [id, me],
      )).rows[0] ?? null;
    }
    lead.photos = (await photosFor(pool, 'lead', [id])).get(id) ?? [];
    if (myQuote) myQuote.photos = (await photosFor(pool, 'quotation', [myQuote.id])).get(myQuote.id) ?? [];
    return { lead, quoteFeePaise: fee, myQuote, customerContact };
  });

  app.post('/leads/:id/decline', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const r = await pool.query(
      `UPDATE lead_vendors SET status = 'declined' WHERE lead_id = $1 AND vendor_id = $2 AND status IN ('notified','viewed')`,
      [id, req.user.sub],
    );
    if (!r.rowCount) throw bad('Cannot decline this lead', 'invalid_state');
    return { declined: true };
  });

  /**
   * Submit a quotation and pay the fee, atomically.
   * Lead check, wallet lock, quotation insert, wallet debit and ledger entry commit together or not at all.
   * The UNIQUE(lead_id, vendor_id) constraint plus the ledger's unique reference prevent double charges.
   */
  app.post('/leads/:id/quote', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const me = req.user.sub;
    const b = quoteInput.extend({ expectedFeePaise: z.number().int().optional() }).parse(req.body);
    await approvedVendor(me);

    const out = await tx(async (c) => {
      const lv = (await c.query(
        `SELECT lv.status, l.status AS lead_status, l.category_id, l.city_id, l.expires_at
           FROM lead_vendors lv JOIN leads l ON l.id = lv.lead_id
          WHERE lv.lead_id = $1 AND lv.vendor_id = $2 FOR UPDATE OF lv`,
        [id, me],
      )).rows[0];
      if (!lv) throw notFound('Lead not found');
      if (lv.status === 'quoted') throw bad('You already quoted. Edit your quotation instead (free).', 'already_quoted');
      if (lv.status === 'declined') throw bad('You declined this lead', 'invalid_state');
      if (!['vendors_notified', 'quotes_received'].includes(lv.lead_status) || new Date(lv.expires_at) < new Date()) {
        throw bad('This lead is no longer accepting quotations', 'lead_closed');
      }

      const fee = await quoteFee(c, lv.category_id, lv.city_id);
      if (b.expectedFeePaise !== undefined && b.expectedFeePaise !== fee) {
        throw new HttpError(409, `The fee changed to Rs ${fee / 100}. Please review and submit again.`, 'fee_changed');
      }
      const wallet = (await c.query('SELECT balance_paise FROM wallets WHERE vendor_id = $1 FOR UPDATE', [me])).rows[0];
      const balance = wallet?.balance_paise ?? 0;
      if (balance < fee) throw new HttpError(402, `Insufficient wallet balance. Fee Rs ${fee / 100}, balance Rs ${balance / 100}.`, 'insufficient_balance');

      const q = (await c.query(
        `INSERT INTO quotations (lead_id, vendor_id, amount_paise, description, items, completion_days, warranty, valid_until, fee_paise)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, me, Math.round(b.amountRupees * 100), b.description, toItems(b.items), b.completionDays ?? null,
         b.warranty ?? null, b.validUntil ?? null, fee],
      )).rows[0];

      await linkPhotos(c, 'quotation', q.id, me, b.photoIds);
      const newBalance = balance - fee;
      if (fee > 0) {
        await c.query('UPDATE wallets SET balance_paise = $2, updated_at = now() WHERE vendor_id = $1', [me, newBalance]);
        await c.query(
          `INSERT INTO wallet_transactions (vendor_id, type, amount_paise, balance_after_paise, reference, lead_id, quotation_id, note)
           VALUES ($1, 'quote_fee', $2, $3, $4, $5, $6, $7)`,
          [me, -fee, newBalance, `quote:${q.id}`, id, q.id, `Quote - Lead #${id}`],
        );
      }
      await c.query(`UPDATE lead_vendors SET status = 'quoted' WHERE lead_id = $1 AND vendor_id = $2`, [id, me]);
      await c.query(`UPDATE leads SET status = 'quotes_received' WHERE id = $1 AND status = 'vendors_notified'`, [id]);
      return { quotation: q, feePaise: fee, balancePaise: newBalance };
    });
    return rep.status(201).send(out);
  });

  // Editing a quotation (revised offer) is free.
  app.put('/quotes/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = quoteInput.parse(req.body);
    return tx(async (c) => {
      const r = await c.query(
        `UPDATE quotations q SET amount_paise = $3, description = $4, items = $5, completion_days = $6, warranty = $7,
                valid_until = $8, revision = revision + 1, updated_at = now()
           FROM leads l
          WHERE q.id = $1 AND q.vendor_id = $2 AND q.status = 'submitted' AND l.id = q.lead_id
            AND l.status IN ('vendors_notified','quotes_received')
          RETURNING q.*`,
        [id, req.user.sub, Math.round(b.amountRupees * 100), b.description, toItems(b.items), b.completionDays ?? null,
         b.warranty ?? null, b.validUntil ?? null],
      );
      if (!r.rowCount) throw bad('Quotation cannot be edited', 'invalid_state');
      await linkPhotos(c, 'quotation', id, req.user.sub, b.photoIds, true);
      return r.rows[0];
    });
  });

  app.get('/wallet', async (req) => {
    const me = req.user.sub;
    const w = (await pool.query('SELECT balance_paise FROM wallets WHERE vendor_id = $1', [me])).rows[0];
    const txs = (await pool.query(
      'SELECT id, type, amount_paise, balance_after_paise, reference, lead_id, note, created_at FROM wallet_transactions WHERE vendor_id = $1 ORDER BY id DESC LIMIT 100',
      [me],
    )).rows;
    return { balancePaise: w?.balance_paise ?? 0, transactions: txs };
  });

  /**
   * Recharge. MVP credits directly (dev). In production: create a Razorpay order here, and credit the wallet
   * only from the verified payment webhook, using the gateway payment id as the ledger reference.
   */
  app.post('/wallet/recharge', async (req) => {
    if (process.env.PAYMENTS_DEV_MODE === 'false') throw bad('Use the payment gateway to recharge', 'use_gateway');
    const { amountRupees, reference } = z.object({
      amountRupees: z.number().int().min(10).max(100000),
      reference: z.string().min(6).max(80),
    }).parse(req.body);
    const me = req.user.sub;
    return tx(async (c) => {
      await c.query('INSERT INTO wallets (vendor_id) VALUES ($1) ON CONFLICT DO NOTHING', [me]);
      const dupe = (await c.query('SELECT balance_after_paise FROM wallet_transactions WHERE reference = $1', [`pay:${reference}`])).rows[0];
      if (dupe) return { balancePaise: dupe.balance_after_paise, duplicate: true };
      const w = (await c.query(
        'UPDATE wallets SET balance_paise = balance_paise + $2, updated_at = now() WHERE vendor_id = $1 RETURNING balance_paise',
        [me, amountRupees * 100],
      )).rows[0];
      await c.query(
        `INSERT INTO wallet_transactions (vendor_id, type, amount_paise, balance_after_paise, reference, note)
         VALUES ($1, 'recharge', $2, $3, $4, 'Wallet recharge')`,
        [me, amountRupees * 100, w.balance_paise, `pay:${reference}`],
      );
      return { balancePaise: w.balance_paise };
    });
  });

  app.get('/stats', async (req) => {
    const me = req.user.sub;
    return (await pool.query(
      `SELECT (SELECT count(*) FROM lead_vendors WHERE vendor_id = $1)::int AS leads_received,
              (SELECT count(*) FROM quotations WHERE vendor_id = $1)::int AS quotes_submitted,
              (SELECT count(*) FROM quotations WHERE vendor_id = $1 AND status = 'accepted')::int AS quotes_won,
              (SELECT coalesce(-sum(amount_paise), 0) FROM wallet_transactions WHERE vendor_id = $1 AND type = 'quote_fee')::int AS spent_paise`,
      [me],
    )).rows[0];
  });
}
