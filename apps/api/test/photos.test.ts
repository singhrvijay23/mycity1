import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { pool } from '../src/lib/db.js';
import { seed } from '../src/seed.js';
import { sweepUnlinked } from '../src/lib/attachments.js';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
let plumbingId: number;
let cityId: number;

async function login(phone: string, role: 'customer' | 'vendor' = 'customer') {
  await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
  return (await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: '123456', role } })).json().token as string;
}
const call = (who: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${tokens[who]}` } });

function multipart(files: { name: string; type: string; data: Buffer }[]) {
  const boundary = '----mycity' + Math.random().toString(16).slice(2);
  const parts = files.map((f) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`),
    f.data, Buffer.from('\r\n'),
  ]));
  return { body: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}
async function upload(who: string, kind: string, files: { name: string; type: string; data: Buffer }[]) {
  const m = multipart(files);
  return app.inject({ method: 'POST', url: `/uploads?kind=${kind}`, payload: m.body, headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': m.type } });
}
const photo = (w = 3000, h = 2000) => sharp({ create: { width: w, height: h, channels: 3, background: '#3a7' } })
  .jpeg().withExif({ IFD0: { Copyright: 'Customer home GPS 25.45N 81.83E' } }).toBuffer();
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed();
  app = await buildApp();
  tokens.customer = await login('9000000001');
  tokens.other = await login('9000000002');
  tokens.plumber = await login('9100000001', 'vendor');
  tokens.electrician = await login('9100000002', 'vendor');
  plumbingId = (await pool.query(`SELECT id FROM categories WHERE name = 'Plumbing'`)).rows[0].id;
  cityId = (await pool.query(`SELECT id FROM cities WHERE name = 'Prayagraj'`)).rows[0].id;
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('photo uploads', () => {
  let leadPhoto: string;
  let leadId: number;

  it('resizes photos and strips EXIF metadata (e.g. GPS) before storing', async () => {
    const r = await upload('customer', 'lead', [{ name: 'leak.jpg', type: 'image/jpeg', data: await photo() }]);
    expect(r.statusCode).toBe(201);
    const p = r.json().photos[0];
    expect(p.width).toBe(1600);
    expect(p.height).toBe(1067);
    leadPhoto = p.id;
    const file = await app.inject({ method: 'GET', url: pathOf(p.url) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(file.rawPayload.toString('latin1')).not.toContain('GPS');
  });

  it('rejects files that are not images, and wrong roles', async () => {
    const r = await upload('customer', 'lead', [{ name: 'evil.jpg', type: 'image/jpeg', data: Buffer.from('<script>alert(1)</script>') }]);
    expect(r.json().error).toBe('invalid_image');
    const v = await upload('plumber', 'lead', [{ name: 'a.jpg', type: 'image/jpeg', data: await photo(100, 100) }]);
    expect(v.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/uploads?kind=lead' })).statusCode).toBe(401);
  });

  it('accepts PNG and converts to JPEG', async () => {
    const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await upload('customer', 'lead', [{ name: 'a.png', type: 'image/png', data: png }]);
    expect(r.statusCode).toBe(201);
    expect(r.json().photos[0].width).toBe(200);
  });

  it("cannot attach someone else's photo", async () => {
    const r = await call('other', 'POST', '/leads', { categoryId: plumbingId, cityId, title: 'Tap drip', description: 'Kitchen tap is dripping all day', photoIds: [leadPhoto] });
    expect(r.json().error).toBe('invalid_photo');
  });

  it('shows lead photos to the customer and assigned vendors only, via signed links', async () => {
    const r = await call('customer', 'POST', '/leads', { categoryId: plumbingId, cityId, title: 'Leak', description: 'Leak under the wash basin, see photo', photoIds: [leadPhoto] });
    expect(r.statusCode).toBe(201);
    leadId = r.json().id;
    const mine = (await call('customer', 'GET', `/leads/${leadId}`)).json();
    expect(mine.lead.photos).toHaveLength(1);

    const v = (await call('plumber', 'GET', `/vendor/leads/${leadId}`)).json();
    expect(v.lead.photos[0].id).toBe(leadPhoto);
    expect((await app.inject({ method: 'GET', url: pathOf(v.lead.photos[0].url) })).statusCode).toBe(200);

    expect((await call('electrician', 'GET', `/vendor/leads/${leadId}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/files/${leadPhoto}` })).statusCode).toBe(403);
    const forged = pathOf(v.lead.photos[0].url).replace(/sig=[^&]+/, 'sig=AAAA');
    expect((await app.inject({ method: 'GET', url: forged })).statusCode).toBe(403);
  });

  it('a photo already linked to one lead cannot be reused on another', async () => {
    const r = await call('customer', 'POST', '/leads', { categoryId: plumbingId, cityId, title: 'Again', description: 'A different requirement text here', photoIds: [leadPhoto] });
    expect(r.json().error).toBe('invalid_photo');
  });

  it('customer can replace lead photos while open', async () => {
    const up = (await upload('customer', 'lead', [{ name: 'b.jpg', type: 'image/jpeg', data: await photo(800, 600) }])).json().photos[0];
    const r = await call('customer', 'PUT', `/leads/${leadId}/photos`, { photoIds: [up.id, leadPhoto] });
    expect(r.json().photos.map((p: { id: string }) => p.id)).toEqual([up.id, leadPhoto]);
  });

  it('vendor quotation and profile photos reach the customer', async () => {
    const qp = (await upload('plumber', 'quotation', [{ name: 'part.jpg', type: 'image/jpeg', data: await photo(400, 400) }])).json().photos[0];
    const q = await call('plumber', 'POST', `/vendor/leads/${leadId}/quote`, { amountRupees: 500, description: 'Replace basin pipe', photoIds: [qp.id] });
    expect(q.statusCode).toBe(201);
    const vp = (await upload('plumber', 'vendor', [{ name: 'shop.jpg', type: 'image/jpeg', data: await photo(600, 400) }])).json().photos[0];
    const prof = await call('plumber', 'PUT', '/vendor/profile', { businessName: 'Sharma Plumbing Works', cityId, categoryIds: [plumbingId], photoIds: [vp.id] });
    expect(prof.statusCode).toBe(200);

    const quotes = (await call('customer', 'GET', `/leads/${leadId}`)).json().quotes;
    expect(quotes[0].photos[0].id).toBe(qp.id);
    expect(quotes[0].vendor_photos[0].id).toBe(vp.id);
    expect((await call('plumber', 'GET', '/auth/me')).json().vendor.photos).toHaveLength(1);
  });

  it('limits the number of photos', async () => {
    const files = await Promise.all(Array.from({ length: 7 }, async (_, i) => ({ name: `${i}.jpg`, type: 'image/jpeg', data: await photo(50, 50) })));
    expect((await upload('customer', 'lead', files)).json().error).toBe('too_many_photos');
  });

  it('sweeps uploads that were never attached', async () => {
    await pool.query(`UPDATE attachments SET created_at = now() - interval '2 days' WHERE entity_id IS NULL`);
    const n = await sweepUnlinked(pool);
    expect(n).toBeGreaterThan(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM attachments WHERE entity_id IS NULL')).rows[0].n).toBe(0);
  });
});
