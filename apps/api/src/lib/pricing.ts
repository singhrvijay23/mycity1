import { Db, setting } from './db.js';

/** Resolve the quotation fee for a category in a city. Most specific active rule wins. */
export async function quoteFee(db: Db, categoryId: number, cityId: number): Promise<number> {
  const r = await db.query(
    `WITH cat AS (SELECT id, parent_id FROM categories WHERE id = $1)
     SELECT pr.fee_paise
       FROM pricing_rules pr, cat
      WHERE pr.category_id IN (cat.id, cat.parent_id)
        AND (pr.city_id = $2 OR pr.city_id IS NULL)
        AND pr.effective_from <= now()
        AND (pr.effective_to IS NULL OR pr.effective_to > now())
      ORDER BY (pr.category_id = cat.id) DESC, (pr.city_id IS NOT NULL) DESC, pr.effective_from DESC
      LIMIT 1`,
    [categoryId, cityId],
  );
  if (r.rows[0]) return r.rows[0].fee_paise;
  return Number(await setting<number>(db, 'default_quote_fee_paise'));
}
