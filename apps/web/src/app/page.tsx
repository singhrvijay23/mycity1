'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Cat = { id: number; name: string; children: { id: number; name: string }[] };

export default function Home() {
  const router = useRouter();
  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ categoryId: number; name: string; parentName: string }[] | null>(null);

  useEffect(() => { api('/categories').then(setCats).catch(() => {}); }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    const r = await api('/ai/classify', { body: { text: q } });
    setHits(r.suggestions);
  }
  const go = (categoryId: number) => router.push(`/post?category=${categoryId}&text=${encodeURIComponent(q)}`);

  return (
    <>
      <section className="hero">
        <h1>Tell us what you need.<br />Get quotes from businesses in your city.</h1>
        <p className="muted">Post once, compare quotations, chat inside MyCity, and share your number only with the vendor you choose.</p>
        <form className="search" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. "Need an electrician to install a ceiling fan"' />
          <button className="btn">Find</button>
        </form>
        {hits && (
          <div className="card stack">
            {hits.length === 0 ? <p className="muted">No match yet. Pick a category below.</p> : <p className="small muted">Did you mean:</p>}
            <div className="row">
              {hits.map((h) => <button key={h.categoryId} className="btn ghost sm" onClick={() => go(h.categoryId)}>{h.parentName} › {h.name}</button>)}
            </div>
          </div>
        )}
      </section>
      {cats.map((c) => (
        <section key={c.id}>
          <h2>{c.name}</h2>
          <div className="grid">
            {c.children.map((s) => (
              <div key={s.id} className="card cat" onClick={() => go(s.id)}><h3>{s.name}</h3><span className="small muted">Get quotes</span></div>
            ))}
          </div>
        </section>
      ))}
      {cats.length === 0 && <p className="muted">Loading categories… (is the API running on port 4000?)</p>}
    </>
  );
}
