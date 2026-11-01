import { FastifyInstance } from 'fastify';
import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../lib/db.js';
import { bad, HttpError } from '../lib/errors.js';
import { requireRole } from '../app.js';

const phone = z.string().regex(/^\+?\d{10,13}$/, 'Enter a valid mobile number');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const devMode = () => process.env.OTP_DEV_MODE !== 'false';

export default async function (app: FastifyInstance) {
  app.post('/otp/request', async (req) => {
    const body = z.object({ phone }).parse(req.body);
    const code = devMode() ? '123456' : String(randomInt(100000, 999999));
    await pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
       ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at`,
      [body.phone, hash(code)],
    );
    // Production: enqueue SMS via provider (MSG91 / Twilio). Never log the code outside dev.
    return { sent: true, devCode: devMode() ? code : undefined };
  });

  app.post('/otp/verify', async (req) => {
    const body = z.object({
      phone,
      code: z.string().length(6),
      role: z.enum(['customer', 'vendor']).default('customer'),
      name: z.string().min(2).max(80).optional(),
    }).parse(req.body);

    const otp = (await pool.query('SELECT * FROM otp_codes WHERE phone = $1', [body.phone])).rows[0];
    if (!otp || new Date(otp.expires_at) < new Date() || otp.attempts >= 5) throw bad('OTP expired, request a new one', 'otp_expired');
    if (otp.code_hash !== hash(body.code)) {
      await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1', [body.phone]);
      throw bad('Incorrect OTP', 'otp_invalid');
    }
    await pool.query('DELETE FROM otp_codes WHERE phone = $1', [body.phone]);

    // Admins are created by seed/ops, never by self sign-up; an admin logging in uses role=customer form + existing admin row.
    let user = (await pool.query(
      `SELECT * FROM users WHERE phone = $1 AND (role = $2 OR role = 'admin') ORDER BY role = 'admin' DESC LIMIT 1`,
      [body.phone, body.role],
    )).rows[0];
    if (!user) {
      user = (await pool.query(
        'INSERT INTO users (role, name, phone) VALUES ($1, $2, $3) RETURNING *',
        [body.role, body.name ?? 'MyCity user', body.phone],
      )).rows[0];
    }
    if (user.status === 'blocked') throw new HttpError(403, 'Account blocked. Contact support.', 'blocked');
    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return { token, user: { id: user.id, role: user.role, name: user.name, phone: user.phone } };
  });

  app.get('/me', { preHandler: requireRole() }, async (req) => {
    const u = (await pool.query('SELECT id, role, name, phone, email, city_id FROM users WHERE id = $1', [req.user.sub])).rows[0];
    const vendor = u.role === 'vendor'
      ? (await pool.query(`SELECT business_name, description, business_type, status, city_id, service_radius_km, gst_number,
                array(SELECT category_id FROM vendor_categories WHERE vendor_id = user_id) AS category_ids
           FROM vendors WHERE user_id = $1`, [u.id])).rows[0] ?? null
      : null;
    return { user: u, vendor };
  });
}
