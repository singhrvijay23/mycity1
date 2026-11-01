import { fileURLToPath } from 'node:url';
import { pool, tx } from './lib/db.js';
import { migrate } from './migrate.js';

type Sub = [name: string, feeRupees: number, keywords: string[], fields?: object[]];
const catalog: [string, string, Sub[]][] = [
  ['Home Services', 'service', [
    ['Plumbing', 10, ['plumber', 'leak', 'leakage', 'tap', 'pipe', 'bathroom', 'drain']],
    ['Electrical', 10, ['electrician', 'wiring', 'fan', 'switch', 'light', 'mcb'], [{ key: 'work', label: 'Type of work', type: 'select', options: ['Repair', 'New installation', 'Wiring'] }]],
    ['Painting', 15, ['painter', 'paint', 'whitewash', 'wall']],
    ['Carpentry', 12, ['carpenter', 'furniture', 'door', 'wood', 'bed', 'almirah']],
    ['AC Repair & Service', 15, ['ac', 'air conditioner', 'cooling', 'split', 'gas filling'], [
      { key: 'ac_type', label: 'AC type', type: 'select', options: ['Split', 'Window'] },
      { key: 'tonnage', label: 'Tonnage', type: 'select', options: ['1', '1.5', '2'] }]],
    ['Water Purifier Service', 10, ['ro', 'purifier', 'water filter']],
    ['Water Tank Cleaning', 10, ['tank', 'cleaning', 'water tank']],
    ['Sewage Cleaning', 10, ['sewage', 'septic', 'gutter']],
    ['Home Cleaning', 10, ['cleaning', 'deep clean', 'maid']],
    ['Car Cleaning', 10, ['car', 'wash', 'car cleaning']],
    ['Home Parlour', 10, ['parlour', 'beauty', 'makeup', 'salon', 'facial']],
  ]],
  ['Construction & Interiors', 'service', [
    ['Home Contractor', 30, ['contractor', 'construction', 'renovation', 'build', 'house']],
    ['Fabrication', 20, ['fabricator', 'welding', 'grill', 'gate', 'shed']],
    ['Interior Design', 40, ['interior', 'designer', 'decor']],
    ['Modular Kitchen', 40, ['modular', 'kitchen']],
    ['PVC Walls & Ceiling', 20, ['pvc', 'false ceiling', 'wall panel']],
  ]],
  ['Professional Services', 'professional', [
    ['Architect', 50, ['architect', 'map', 'naksha', 'plan', 'building design'], [{ key: 'plot_size', label: 'Plot size (sq ft)', type: 'number' }]],
    ['CA & Tax Consultant', 25, ['ca', 'gst', 'tax', 'itr', 'accountant', 'audit']],
    ['Lawyer', 25, ['lawyer', 'legal', 'advocate', 'court']],
    ['Insurance / LIC Agent', 15, ['lic', 'insurance', 'policy']],
    ['Graphic Design & Printing', 15, ['graphic', 'logo', 'printing', 'flex', 'banner', 'visiting card']],
    ['Tutor & Coaching', 15, ['tutor', 'tuition', 'coaching', 'pcs', 'ssc', 'tgt', 'pgt']],
  ]],
  ['Products & Dealers', 'dealer', [
    ['Doors & Designer Doors', 20, ['door', 'designer door', 'wooden door']],
    ['Marble & Granite', 20, ['marble', 'granite', 'tiles', 'stone']],
    ['Water Tanks', 15, ['water tank', 'tank', 'sintex']],
    ['Electrical Goods (Bulk)', 20, ['electrical', 'bulk', 'wire', 'cable', 'bulb']],
    ['Tyres', 15, ['tyre', 'tire']],
  ]],
  ['Food & Home Delivery', 'manufacturer', [
    ['Bulk Food & Catering', 20, ['catering', 'bulk food', 'party', 'tiffin']],
    ['Homemade Food', 10, ['homemade', 'home food', 'tiffin']],
    ['Pickles & Homemade Products', 10, ['pickle', 'achar', 'papad']],
  ]],
];

export async function seed() {
  await migrate();
  await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM cities LIMIT 1')).rowCount) return;
    const city = async (name: string, state: string, lat: number, lng: number) =>
      (await c.query('INSERT INTO cities (name, state, lat, lng) VALUES ($1,$2,$3,$4) RETURNING id', [name, state, lat, lng])).rows[0].id as number;
    const prayagraj = await city('Prayagraj', 'Uttar Pradesh', 25.4358, 81.8463);
    const kaushambi = await city('Kaushambi', 'Uttar Pradesh', 25.5333, 81.3667);
    await city('Pratapgarh', 'Uttar Pradesh', 25.897, 81.945);
    await city('Varanasi', 'Uttar Pradesh', 25.3176, 82.9739);
    await city('Lucknow', 'Uttar Pradesh', 26.8467, 80.9462);
    for (const [n, lat, lng] of [['Civil Lines', 25.4529, 81.835], ['Katra', 25.459, 81.847], ['Naini', 25.387, 81.864],
      ['Jhunsi', 25.438, 81.903], ['George Town', 25.456, 81.853], ['Teliyarganj', 25.497, 81.862]] as const) {
      await c.query('INSERT INTO localities (city_id, name, lat, lng) VALUES ($1,$2,$3,$4)', [prayagraj, n, lat, lng]);
    }

    let order = 0;
    const ids: Record<string, number> = {};
    for (const [parent, type, subs] of catalog) {
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const pid = (await c.query('INSERT INTO categories (name, slug, type, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
        [parent, slug(parent), type, order++])).rows[0].id;
      for (const [name, fee, kw, fields] of subs) {
        const id = (await c.query(
          'INSERT INTO categories (parent_id, name, slug, type, keywords, fields) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [pid, name, slug(name), type, kw, JSON.stringify(fields ?? [])],
        )).rows[0].id;
        ids[name] = id;
        await c.query('INSERT INTO pricing_rules (category_id, fee_paise) VALUES ($1,$2)', [id, fee * 100]);
      }
    }

    // Demo accounts (login with OTP 123456 in dev mode).
    await c.query(`INSERT INTO users (role, name, phone) VALUES ('admin', 'MyCity Admin', '9999999999')`);
    await c.query(`INSERT INTO users (role, name, phone, city_id) VALUES ('customer', 'Demo Customer', '9000000001', $1)`, [prayagraj]);
    const vendors: [string, string, number, number, number, number, string[]][] = [
      ['9100000001', 'Sharma Plumbing Works', prayagraj, 25.452, 81.84, 10, ['Plumbing', 'Water Tank Cleaning']],
      ['9100000002', 'Civil Lines Electricals', prayagraj, 25.455, 81.836, 12, ['Electrical']],
      ['9100000003', 'CoolAir AC Services', prayagraj, 25.44, 81.85, 15, ['AC Repair & Service', 'Electrical']],
      ['9100000004', 'Kaushambi Plumbers', kaushambi, 25.5333, 81.3667, 60, ['Plumbing']],
    ];
    for (const [phone, biz, cityId, lat, lng, radius, cats] of vendors) {
      const uid = (await c.query(`INSERT INTO users (role, name, phone, city_id) VALUES ('vendor', $1, $2, $3) RETURNING id`, [biz, phone, cityId])).rows[0].id;
      await c.query(
        `INSERT INTO vendors (user_id, business_name, city_id, lat, lng, service_radius_km, status, description)
         VALUES ($1,$2,$3,$4,$5,$6,'approved', $7)`,
        [uid, biz, cityId, lat, lng, radius, `${biz} - trusted local business`],
      );
      for (const n of cats) await c.query('INSERT INTO vendor_categories (vendor_id, category_id) VALUES ($1,$2)', [uid, ids[n]]);
      await c.query('INSERT INTO wallets (vendor_id, balance_paise) VALUES ($1, 50000)', [uid]);
      await c.query(
        `INSERT INTO wallet_transactions (vendor_id, type, amount_paise, balance_after_paise, reference, note)
         VALUES ($1, 'promo_credit', 50000, 50000, $2, 'Welcome credit')`,
        [uid, `promo:welcome:${uid}`],
      );
    }
  });
  console.log('seeded');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await seed();
  await pool.end();
}
