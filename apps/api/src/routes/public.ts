import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../lib/db.js';
import { classify } from '../lib/classify.js';
import { quoteFee } from '../lib/pricing.js';

export default async function (app: FastifyInstance) {
  app.get('/cities', async () => {
    const cities = (await pool.query('SELECT id, name, state, lat, lng FROM cities WHERE active ORDER BY name')).rows;
    const localities = (await pool.query('SELECT id, city_id, name FROM localities ORDER BY name')).rows;
    return cities.map((c) => ({ ...c, localities: localities.filter((l) => l.city_id === c.id) }));
  });

  app.get('/categories', async () => {
    const rows = (await pool.query(
      'SELECT id, parent_id, name, slug, type, fields FROM categories WHERE active ORDER BY sort_order, name',
    )).rows;
    return rows.filter((r) => !r.parent_id).map((p) => ({ ...p, children: rows.filter((c) => c.parent_id === p.id) }));
  });

  // Fee shown to vendors (and admins) before quoting.
  app.get('/fees', async (req) => {
    const q = z.object({ categoryId: z.coerce.number(), cityId: z.coerce.number() }).parse(req.query);
    return { fee_paise: await quoteFee(pool, q.categoryId, q.cityId) };
  });

  // Natural-language search: "need someone to fix my AC" -> AC Services > AC Repair
  app.post('/ai/classify', async (req) => {
    const { text } = z.object({ text: z.string().min(3).max(1000) }).parse(req.body);
    return { suggestions: await classify(pool, text) };
  });

  // Public business directory (no contact details).
  app.get('/directory', async (req) => {
    const q = z.object({ cityId: z.coerce.number(), categoryId: z.coerce.number().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT v.user_id AS id, v.business_name, v.description, v.business_type, v.rating, c.name AS city
         FROM vendors v JOIN cities c ON c.id = v.city_id
        WHERE v.status = 'approved' AND v.city_id = $1
          AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM vendor_categories vc JOIN categories k ON k.id = vc.category_id
                WHERE vc.vendor_id = v.user_id AND (k.id = $2 OR k.parent_id = $2)))
        ORDER BY v.rating DESC, v.business_name LIMIT 100`,
      [q.cityId, q.categoryId ?? null],
    )).rows;
  });
}
