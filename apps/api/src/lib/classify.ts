import { Db } from './db.js';

export interface Suggestion { categoryId: number; name: string; parentName: string | null; score: number }

/**
 * Maps free text ("I need an electrician to install a ceiling fan") to categories.
 * MVP: keyword scoring against admin-managed category keywords. The interface is the seam where an
 * LLM classifier plugs in later; its answer must still be checked against this category table.
 */
export async function classify(db: Db, text: string, limit = 3): Promise<Suggestion[]> {
  const tokens = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const r = await db.query(
    `SELECT c.id, c.name, c.keywords, p.name AS parent_name
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.active AND c.parent_id IS NOT NULL`,
  );
  const out: Suggestion[] = [];
  for (const row of r.rows) {
    let score = 0;
    for (const kw of [...row.keywords, ...row.name.toLowerCase().split(/\W+/)]) {
      const parts = String(kw).toLowerCase().split(/\s+/);
      if (parts.every((p: string) => [...tokens].some((t) => t.startsWith(p) || p.startsWith(t) && t.length > 3))) {
        score += parts.length;
      }
    }
    if (score > 0) out.push({ categoryId: row.id, name: row.name, parentName: row.parent_name, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
