import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import { z } from 'zod';
import { pool } from '../lib/db.js';
import { bad, forbidden, notFound } from '../lib/errors.js';
import { storage, verifyFileLink } from '../lib/storage.js';
import { MAX_PHOTOS } from '../lib/attachments.js';
import { requireRole } from '../app.js';

const MAX_BYTES = 10 * 1024 * 1024; // raw phone photos; we shrink them below
const MAX_EDGE = 1600;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'heif', 'gif', 'tiff']);

export default async function (app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 12, fields: 5 } });

  /**
   * Upload photos (multipart field "file", repeatable). Query: kind=lead|quotation|vendor.
   * Every image is decoded, auto-rotated, resized to max 1600px and re-encoded as JPEG.
   * Re-encoding strips EXIF metadata, so a customer's GPS location inside a photo never reaches vendors,
   * and anything that is not a real image is rejected.
   */
  app.post('/uploads', { preHandler: requireRole('customer', 'vendor') }, async (req, rep) => {
    const { kind } = z.object({ kind: z.enum(['lead', 'quotation', 'vendor']) }).parse(req.query);
    if ((kind === 'lead') !== (req.user.role === 'customer')) throw forbidden(`Your account cannot upload ${kind} photos`);

    const out: { id: string; url: string; width: number; height: number }[] = [];
    for await (const part of req.files()) {
      if (out.length >= MAX_PHOTOS[kind]) throw bad(`At most ${MAX_PHOTOS[kind]} photos at a time`, 'too_many_photos');
      const raw = await part.toBuffer().catch(() => { throw bad('Photo is larger than 10 MB', 'file_too_large'); });
      let img: { data: Buffer; info: OutputInfo };
      try {
        const meta = await sharp(raw).metadata();
        if (!meta.format || !ALLOWED.has(meta.format)) throw new Error('format');
        img = await sharp(raw, { failOn: 'error' })
          .rotate()
          .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw bad(`"${part.filename}" is not a supported photo (use JPG, PNG or WEBP)`, 'invalid_image');
      }
      const id = randomUUID();
      const d = new Date();
      const key = `${kind}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}.jpg`;
      await storage().put(key, img.data, 'image/jpeg');
      await pool.query(
        `INSERT INTO attachments (id, owner_id, kind, storage_key, content_type, bytes, width, height)
         VALUES ($1,$2,$3,$4,'image/jpeg',$5,$6,$7)`,
        [id, req.user.sub, kind, key, img.data.length, img.info.width, img.info.height],
      );
      out.push({ id, url: await storage().url(key, id), width: img.info.width, height: img.info.height });
    }
    if (!out.length) throw bad('No photo received', 'no_file');
    return rep.status(201).send({ photos: out });
  });

  // Serves files for the local storage driver. Access is granted by the signed link the API issued.
  app.get('/files/:id', async (req, rep) => {
    const { id } = req.params as { id: string };
    const q = req.query as { exp?: string; sig?: string };
    if (!z.string().uuid().safeParse(id).success || !verifyFileLink(id, Number(q.exp), q.sig ?? '')) throw forbidden('Link expired');
    const a = (await pool.query('SELECT storage_key, content_type FROM attachments WHERE id = $1', [id])).rows[0];
    if (!a) throw notFound();
    const body = await storage().read(a.storage_key).catch(() => null);
    if (!body) throw notFound();
    return rep.header('content-type', a.content_type).header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff').send(body);
  });
}
