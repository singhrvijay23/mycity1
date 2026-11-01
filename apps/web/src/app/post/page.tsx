'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/useSession';

type Field = { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[] };
type Sub = { id: number; name: string; fields: Field[] };
type Cat = { id: number; name: string; children: Sub[] };
type City = { id: number; name: string; localities: { id: number; name: string }[] };

function PostForm() {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [cats, setCats] = useState<Cat[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [f, setF] = useState({
    categoryId: Number(params.get('category')) || 0, cityId: 0, localityId: 0, title: '',
    description: params.get('text') ?? '', address: '', budget: '', neededBy: '',
  });
  const [details, setDetails] = useState<Record<string, string>>({});
  const [suggest, setSuggest] = useState<{ categoryId: number; name: string }[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s === null) router.replace('/login?next=' + encodeURIComponent('/post?' + params.toString()));
  }, [s, router, params]);
  useEffect(() => {
    api('/categories').then(setCats);
    api<City[]>('/cities').then((c) => { setCities(c); setF((p) => ({ ...p, cityId: p.cityId || c.find((x) => x.name === 'Prayagraj')?.id || c[0]?.id })); });
  }, []);

  const subs = useMemo(() => cats.flatMap((c) => c.children.map((s) => ({ ...s, parent: c.name }))), [cats]);
  const sub = subs.find((x) => x.id === f.categoryId);
  const city = cities.find((c) => c.id === f.cityId);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: ['categoryId', 'cityId', 'localityId'].includes(k) ? Number(e.target.value) : e.target.value });

  async function detect() {
    if (f.description.length < 8) return;
    const r = await api('/ai/classify', { body: { text: f.description } });
    setSuggest(r.suggestions.filter((x: { categoryId: number }) => x.categoryId !== f.categoryId));
    if (!f.categoryId && r.suggestions[0]) setF((p) => ({ ...p, categoryId: r.suggestions[0].categoryId }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api('/leads', { body: {
        categoryId: f.categoryId, cityId: f.cityId, localityId: f.localityId || undefined,
        title: f.title || (sub ? `${sub.name} required` : 'Requirement'), description: f.description, details,
        address: f.address || undefined, budgetRupees: f.budget ? Number(f.budget) : undefined, neededBy: f.neededBy || undefined,
      } });
      router.push(`/my-leads/${r.id}?notified=${r.vendorsNotified}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card stack" style={{ maxWidth: 680 }}>
      <h1>Post a requirement</h1>
      <div><label>Describe what you need</label>
        <textarea value={f.description} onChange={set('description')} onBlur={detect} placeholder="e.g. Water leaking near the shower, need repair this week" /></div>
      {suggest.length > 0 && <div className="row small">Also matches: {suggest.map((x) => <button type="button" key={x.categoryId} className="link" onClick={() => setF({ ...f, categoryId: x.categoryId })}>{x.name}</button>)}</div>}
      <div><label>Category</label>
        <select value={f.categoryId} onChange={set('categoryId')} required>
          <option value={0} disabled>Choose a service</option>
          {cats.map((c) => <optgroup key={c.id} label={c.name}>{c.children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
        </select></div>
      {sub?.fields.map((fl) => (
        <div key={fl.key}><label>{fl.label}</label>
          {fl.type === 'select'
            ? <select value={details[fl.key] ?? ''} onChange={(e) => setDetails({ ...details, [fl.key]: e.target.value })}><option value="">-</option>{fl.options?.map((o) => <option key={o}>{o}</option>)}</select>
            : <input type={fl.type} value={details[fl.key] ?? ''} onChange={(e) => setDetails({ ...details, [fl.key]: e.target.value })} />}
        </div>
      ))}
      <div><label>Short title</label><input value={f.title} onChange={set('title')} placeholder={sub ? `${sub.name} required` : ''} /></div>
      <div className="row">
        <div style={{ flex: 1 }}><label>City</label><select value={f.cityId} onChange={set('cityId')}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div style={{ flex: 1 }}><label>Locality</label><select value={f.localityId} onChange={set('localityId')}><option value={0}>Any / not listed</option>{city?.localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Budget (₹, optional)</label><input type="number" value={f.budget} onChange={set('budget')} /></div>
        <div style={{ flex: 1 }}><label>Needed by</label><input type="date" value={f.neededBy} onChange={set('neededBy')} /></div>
      </div>
      <div><label>Full address (private, shared only with the vendor you select)</label><input value={f.address} onChange={set('address')} /></div>
      <p className="notice">Vendors see your requirement and locality only. Your name, number and address stay hidden until you select a vendor.</p>
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={busy || !f.categoryId || f.description.length < 10}>Get quotations</button>
    </form>
  );
}
export default function Page() { return <Suspense><PostForm /></Suspense>; }
