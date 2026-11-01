import { Db, setting } from './db.js';
import { distanceSql } from './geo.js';

/**
 * Deterministic, explainable vendor matching:
 * approved vendor + serves the category (or its parent) + lead inside the vendor's service radius
 * (this is how vendors from nearby cities qualify) + below their active-lead cap.
 * Ranked by distance then rating, capped at max_vendors_per_lead.
 * Runs inline for the MVP; in production this moves to a queue worker (BullMQ/Redis).
 */
export async function distributeLead(db: Db, leadId: number): Promise<number> {
  const max = Number(await setting<number>(db, 'max_vendors_per_lead'));
  const d = distanceSql('l.lat', 'l.lng', 'v.lat', 'v.lng');
  const r = await db.query(
    `WITH l AS (
       SELECT le.*, c.parent_id FROM leads le JOIN categories c ON c.id = le.category_id WHERE le.id = $1
     ), cand AS (
       SELECT v.user_id, v.rating, ${d} AS km, v.service_radius_km, v.max_active_leads
         FROM vendors v
         JOIN users u ON u.id = v.user_id
         CROSS JOIN l
        WHERE u.status = 'active'
          AND v.status = 'approved'
          AND v.user_id <> l.customer_id
          -- cheap bounding-box prefilter (1 deg lat ~ 111 km) before exact distance
          AND v.lat BETWEEN l.lat - 3 AND l.lat + 3
          AND v.lng BETWEEN l.lng - 3 AND l.lng + 3
          AND EXISTS (SELECT 1 FROM vendor_categories vc
                       WHERE vc.vendor_id = v.user_id AND vc.category_id IN (l.category_id, l.parent_id))
     )
     INSERT INTO lead_vendors (lead_id, vendor_id, distance_km)
     SELECT $1, cand.user_id, round(cand.km::numeric, 2)
       FROM cand
      WHERE cand.km <= cand.service_radius_km
        AND (SELECT count(*) FROM lead_vendors lv JOIN leads x ON x.id = lv.lead_id
              WHERE lv.vendor_id = cand.user_id
                AND x.status IN ('vendors_notified', 'quotes_received')) < cand.max_active_leads
      ORDER BY cand.km ASC, cand.rating DESC
      LIMIT $2
     ON CONFLICT DO NOTHING`,
    [leadId, max],
  );
  const n = r.rowCount ?? 0;
  await db.query(
    `UPDATE leads SET status = CASE WHEN $2 > 0 THEN 'vendors_notified'::lead_status ELSE 'under_review'::lead_status END
      WHERE id = $1`,
    [leadId, n],
  );
  return n;
}
