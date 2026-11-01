import pg from 'pg';

// bigint/numeric come back as strings by default; ids and paise fit safely in JS numbers here.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://mycity:mycity@localhost:5432/mycity',
  max: Number(process.env.DB_POOL_MAX ?? 20),
});

export type Db = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function setting<T>(db: Db, key: string): Promise<T> {
  const r = await db.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  return r.rows[0]?.value as T;
}
