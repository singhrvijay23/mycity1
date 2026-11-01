import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/lib/db.js';
import { seed } from '../src/seed.js';
import { guardContact } from '../src/lib/contact-guard.js';

let app: FastifyInstance;
const tokens: Record<string, string> = {};

async function login(phone: string, role: 'customer' | 'vendor' = 'customer', name?: string) {
  await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });
  const r = await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code: '123456', role, name } });
  expect(r.statusCode).toBe(200);
  return r.json() as { token: string; user: { id: number } };
}
const call = (who: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${tokens[who]}` } });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed();
  app = await buildApp();
  tokens.customer = (await login('9000000001')).token;
  tokens.plumber = (await login('9100000001', 'vendor')).token;
  tokens.electrician = (await login('9100000002', 'vendor')).token;
  tokens.kaushambi = (await login('9100000004', 'vendor')).token;
  tokens.admin = (await login('9999999999')).token;
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('MyCity core flow', () => {
  let leadId: number;
  let plumbingId: number;
  let cityId: number;
  let quoteId: number;

  it('classifies natural language to a category', async () => {
    const r = await app.inject({ method: 'POST', url: '/ai/classify', payload: { text: 'bathroom tap leakage near the shower' } });
    const s = r.json().suggestions;
    expect(s[0].name).toBe('Plumbing');
    plumbingId = s[0].categoryId;
    cityId = (await app.inject({ method: 'GET', url: '/cities' })).json().find((c: { name: string }) => c.name === 'Prayagraj').id;
  });

  it('creates a lead and distributes it to matching vendors only, incl. a nearby-city vendor', async () => {
    const r = await call('customer', 'POST', '/leads', {
      categoryId: plumbingId, cityId, title: 'Bathroom leakage repair',
      description: 'Water leaking near the shower, need repair this week', address: '12 Secret Lane, Civil Lines',
    });
    expect(r.statusCode).toBe(201);
    leadId = r.json().id;
    expect(r.json().vendorsNotified).toBe(2); // Prayagraj plumber + Kaushambi plumber (60 km radius); not the electrician
    expect((await call('electrician', 'GET', `/vendor/leads/${leadId}`)).statusCode).toBe(404);
  });

  it('rejects duplicate leads', async () => {
    const r = await call('customer', 'POST', '/leads', {
      categoryId: plumbingId, cityId, title: 'again', description: 'Water leaking near the shower, need repair this week',
    });
    expect(r.json().error).toBe('duplicate_lead');
  });

  it('hides customer contact from vendors before selection', async () => {
    const r = await call('plumber', 'GET', `/vendor/leads/${leadId}`);
    expect(r.statusCode).toBe(200);
    const body = JSON.stringify(r.json());
    expect(body).not.toContain('9000000001');
    expect(body).not.toContain('Secret Lane');
    expect(r.json().customerContact).toBeNull();
    expect(r.json().quoteFeePaise).toBe(1000);
  });

  it('charges the fee atomically, once, and edits are free', async () => {
    const r = await call('plumber', 'POST', `/vendor/leads/${leadId}/quote`, { amountRupees: 800, description: 'Fix leakage, replace washer', expectedFeePaise: 1000 });
    expect(r.statusCode).toBe(201);
    quoteId = r.json().quotation.id;
    expect(r.json().balancePaise).toBe(49000);

    const again = await call('plumber', 'POST', `/vendor/leads/${leadId}/quote`, { amountRupees: 700, description: 'Second try' });
    expect(again.json().error).toBe('already_quoted');

    const edit = await call('plumber', 'PUT', `/vendor/quotes/${quoteId}`, { amountRupees: 750, description: 'Revised offer' });
    expect(edit.json().revision).toBe(2);
    const w = (await call('plumber', 'GET', '/vendor/wallet')).json();
    expect(w.balancePaise).toBe(49000);
    expect(w.transactions.filter((t: { type: string }) => t.type === 'quote_fee')).toHaveLength(1);
  });

  it('concurrent double-submit only charges once', async () => {
    const rs = await Promise.all([1, 2, 3].map(() =>
      call('kaushambi', 'POST', `/vendor/leads/${leadId}/quote`, { amountRupees: 900, description: 'Will come from Kaushambi' })));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect((await call('kaushambi', 'GET', '/vendor/wallet')).json().balancePaise).toBe(49000);
  });

  it('blocks quoting with insufficient balance and does not create the quote', async () => {
    await pool.query(`UPDATE wallets SET balance_paise = 0 WHERE vendor_id = (SELECT id FROM users WHERE phone = '9100000003')`);
    tokens.ac = (await login('9100000003', 'vendor')).token;
    const lead = await call('customer', 'POST', '/leads', { categoryId: (await app.inject({ method: 'POST', url: '/ai/classify', payload: { text: 'split ac not cooling' } })).json().suggestions[0].categoryId, cityId, title: 'AC not cooling', description: 'Split AC not cooling since yesterday' });
    const r = await call('ac', 'POST', `/vendor/leads/${lead.json().id}/quote`, { amountRupees: 500, description: 'Gas refill' });
    expect(r.statusCode).toBe(402);
    expect((await pool.query('SELECT count(*)::int AS n FROM quotations WHERE lead_id = $1', [lead.json().id])).rows[0].n).toBe(0);
  });

  it('redacts phone numbers in chat before selection', async () => {
    const conv = (await call('plumber', 'POST', '/conversations', { leadId })).json();
    const m = await call('plumber', 'POST', `/conversations/${conv.id}/messages`, { body: 'Call me on 98765 43210 or mail a@b.com' });
    expect(m.json().redacted).toBe(true);
    expect(m.json().body).not.toContain('98765');
    const msgs = await call('customer', 'GET', `/conversations/${conv.id}/messages`);
    expect(msgs.json()).toHaveLength(1);
    expect((await call('electrician', 'GET', `/conversations/${conv.id}/messages`)).statusCode).toBe(403);
  });

  it('reveals contact only to the selected vendor', async () => {
    const r = await call('customer', 'POST', `/leads/${leadId}/select`, { quotationId: quoteId });
    expect(r.statusCode).toBe(200);
    expect((await call('plumber', 'GET', `/vendor/leads/${leadId}`)).json().customerContact.phone).toBe('9000000001');
    expect((await call('kaushambi', 'GET', `/vendor/leads/${leadId}`)).json().customerContact).toBeNull();
    const detail = (await call('customer', 'GET', `/leads/${leadId}`)).json();
    expect(detail.quotes.find((q: { selected: boolean }) => q.selected).vendor_phone).toBe('9100000001');
  });

  it('Phase 2 mode never reveals contact', async () => {
    await call('admin', 'PUT', '/admin/settings', { contact_reveal_mode: 'never' });
    expect((await call('plumber', 'GET', `/vendor/leads/${leadId}`)).json().customerContact).toBeNull();
    await call('admin', 'PUT', '/admin/settings', { contact_reveal_mode: 'after_selection' });
  });

  it('admin pricing changes apply to new quotes only, and stats add up', async () => {
    const p = await call('admin', 'POST', '/admin/pricing', { categoryId: plumbingId, feeRupees: 12 });
    expect(p.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/fees?categoryId=${plumbingId}&cityId=${cityId}` })).json().fee_paise).toBe(1200);
    const stats = (await call('admin', 'GET', '/admin/stats')).json();
    expect(Number(stats.revenue_paise)).toBe(2000);
    expect((await call('customer', 'GET', '/admin/stats')).statusCode).toBe(403);
  });

  it('admin refund is idempotent', async () => {
    const r = await call('admin', 'POST', '/admin/refunds', { quotationId: quoteId, reason: 'test refund' });
    expect(r.json().refundedPaise).toBe(1000);
    expect((await call('admin', 'POST', '/admin/refunds', { quotationId: quoteId, reason: 'again' })).json().error).toBe('already_refunded');
  });

  it('new vendors are pending until approved', async () => {
    tokens.newv = (await login('9100000099', 'vendor', 'New Vendor')).token;
    const r = await call('newv', 'PUT', '/vendor/profile', { businessName: 'New Plumbers', cityId, categoryIds: [plumbingId] });
    expect(r.json().status).toBe('pending');
    expect((await call('newv', 'GET', '/vendor/leads')).statusCode).toBe(403);
  });
});

describe('contact guard', () => {
  it.each([
    ['my number is 9876543210', true],
    ['+91 98765-43210', true],
    ['whatsapp me', true],
    ['visit www.example.com', true],
    ['price is 1500 for 2 taps', false],
  ])('%s', (text, redacted) => expect(guardContact(text).redacted).toBe(redacted));
});
