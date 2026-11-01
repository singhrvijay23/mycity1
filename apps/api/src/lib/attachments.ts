import { Db } from './db.js';
import { bad } from './errors.js';
import { storage } from './storage.js';

export type Kind = 'lead' | 'quotation' | 'vendor';
export const MAX_PHOTOS: Record<Kind, number> = { lead: 6, quotation: 6, vendor: 12 };

export interface Photo { id: string; url: string; width: number; height: number }

/** Signed URLs for the photos of one or many entities. Callers must already have checked access. */
export async function photosFor(db: Db, kind: Kind, entityIds: number[]): Promise<Map<number, Photo[]>> {
  const out = new Map<number, Photo[]>();
  if (!entityIds.length) return out;
  const rows = (await db.query(
    `SELECT id, entity_id, storage_key, width, height FROM attachments
      WHERE kind = $1 AND entity_id = ANY($2::bigint[]) ORDER BY sort_order, created_at`,
    [kind, entityIds],
  )).rows;
  for (const r of rows) {
    const list = out.get(r.entity_id) ?? [];
    list.push({ id: r.id, url: await storage().url(r.storage_key, r.id), width: r.width, height: r.height });
    out.set(r.entity_id, list);
  }
  return out;
}

/**
 * Link previously uploaded photos to an entity. Only the uploader's own photos of the right kind can be linked,
 * and only if they are not attached elsewhere (or already attached to this same entity, for edits).
 * When `replace` is true, photos of this entity not in the list are detached (files are cleaned up by the sweeper).
 */
export async function linkPhotos(db: Db, kind: Kind, entityId: number, ownerId: number, ids: string[] | undefined, replace = false) {
  if (ids === undefined) return;
  const unique = [...new Set(ids)];
  if (unique.length > MAX_PHOTOS[kind]) throw bad(`At most ${MAX_PHOTOS[kind]} photos allowed`, 'too_many_photos');
  if (unique.length) {
    const r = await db.query(
      `UPDATE attachments a SET entity_id = $3, sort_order = x.ord
         FROM unnest($4::uuid[]) WITH ORDINALITY AS x(id, ord)
        WHERE a.id = x.id AND a.kind = $1 AND a.owner_id = $2 AND (a.entity_id IS NULL OR a.entity_id = $3)
        RETURNING a.id`,
      [kind, ownerId, entityId, unique],
    );
    if (r.rowCount !== unique.length) throw bad('One or more photos are invalid. Please upload them again.', 'invalid_photo');
  }
  if (replace) {
    await db.query(
      `UPDATE attachments SET entity_id = NULL WHERE kind = $1 AND entity_id = $2 AND owner_id = $3 AND NOT (id = ANY($4::uuid[]))`,
      [kind, entityId, ownerId, unique],
    );
  }
}

/** Remove uploads never linked to anything after 24h (run from a scheduled worker). */
export async function sweepUnlinked(db: Db) {
  const rows = (await db.query(
    `DELETE FROM attachments WHERE entity_id IS NULL AND created_at < now() - interval '24 hours' RETURNING storage_key`,
  )).rows;
  for (const r of rows) await storage().remove(r.storage_key);
  return rows.length;
}
