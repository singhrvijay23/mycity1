'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, rupees, statusLabel } from '@/lib/api';
import { useSession } from '@/lib/useSession';
import Chat from '@/components/Chat';
import { Gallery, PhotoPicker } from '@/components/Photos';

type Item = { label: string; amountRupees: string };

function VendorLead() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ amount: '', description: '', completionDays: '', warranty: '', validUntil: '' });
  const [items, setItems] = useState<Item[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => api(`/vendor/leads/${id}`).then((r) => {
    setD(r);
    if (r.myQuote) {
      setF({ amount: String(r.myQuote.amount_paise / 100), description: r.myQuote.description, completionDays: r.myQuote.completion_days ?? '',
        warranty: r.myQuote.warranty ?? '', validUntil: r.myQuote.valid_until?.slice(0, 10) ?? '' });
      setItems(r.myQuote.items.map((i: any) => ({ label: i.label, amountRupees: String(i.amount_paise / 100) })));
      setPhotos(r.myQuote.photos ?? []);
    }
  }).catch((e) => setMsg({ err: e.message })), [id]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const payload = () => ({
    amountRupees: Number(f.amount), description: f.description,
    items: items.filter((i) => i.label).map((i) => ({ label: i.label, amountRupees: Number(i.amountRupees) || 0 })),
    completionDays: f.completionDays ? Number(f.completionDays) : undefined, warranty: f.warranty || undefined, validUntil: f.validUntil || undefined,
    photoIds: photos.map((p) => p.id),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg({});
    try {
      if (d.myQuote) {
        await api(`/vendor/quotes/${d.myQuote.id}`, { method: 'PUT', body: payload() });
        setMsg({ ok: 'Quotation updated (no charge).' }); setEditing(false);
      } else {
        if (!confirm(`Submitting this quotation will deduct ${rupees(d.quoteFeePaise)} from your wallet. Continue?`)) return;
        const r = await api(`/vendor/leads/${id}/quote`, { body: { ...payload(), expectedFeePaise: d.quoteFeePaise } });
        setMsg({ ok: `Quotation sent. ${rupees(r.feePaise)} deducted, balance ${rupees(r.balancePaise)}.` });
      }
      load();
    } catch (e: any) { setMsg({ err: e.message }); }
  }
  async function decline() {
    try { await api(`/vendor/leads/${id}/decline`, { body: {} }); load(); } catch (e: any) { setMsg({ err: e.message }); }
  }

  if (!d) return msg.err ? <p className="error">{msg.err}</p> : <p className="muted">Loading…</p>;
  const { lead, myQuote, customerContact } = d;
  const canQuote = ['vendors_notified', 'quotes_received'].includes(lead.status);
  const showForm = canQuote && (!myQuote || (editing && myQuote.status === 'submitted'));
  return (
    <div className="two">
      <div className="stack">
        <div className="card stack">
          <div className="row between"><h1 style={{ margin: 0 }}>{lead.title}</h1><span className="pill">{statusLabel(lead.status)}</span></div>
          <p className="small muted">#{lead.id} · {lead.category} · {lead.locality ? `${lead.locality}, ` : ''}{lead.city} · {lead.distance_km} km from you</p>
          <p>{lead.description}</p>
          <Gallery photos={lead.photos} />
          {Object.keys(lead.details ?? {}).length > 0 && <table className="table"><tbody>{Object.entries(lead.details).map(([k, v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table>}
          <p className="small">{[lead.budget_paise && `Budget ${rupees(lead.budget_paise)}`, lead.needed_by && `Needed by ${lead.needed_by.slice(0, 10)}`].filter(Boolean).join(' · ')}</p>
          {customerContact
            ? <div className="notice"><b>You were selected.</b> Customer: {customerContact.name}, {customerContact.phone}{customerContact.address ? `, ${customerContact.address}` : ''}</div>
            : <p className="small muted">Customer contact is hidden until they select your quotation. Use chat for questions.</p>}
        </div>
        {myQuote && !editing && (
          <div className="card stack">
            <div className="row between"><h3>Your quotation · {statusLabel(myQuote.status)}</h3><div className="stat">{rupees(myQuote.amount_paise)}</div></div>
            <p>{myQuote.description}</p>
            <Gallery photos={myQuote.photos} />
            <p className="small muted">Fee paid: {rupees(myQuote.fee_paise)}</p>
            {canQuote && myQuote.status === 'submitted' && <button className="btn ghost sm" onClick={() => setEditing(true)}>Revise quotation (free)</button>}
          </div>
        )}
        {showForm && (
          <form onSubmit={submit} className="card stack">
            <h3>{myQuote ? 'Revise quotation' : 'Send quotation'}</h3>
            <div><label>Total price (₹)</label><input type="number" required value={f.amount} onChange={set('amount')} /></div>
            <div><label>Work / product description</label><textarea required value={f.description} onChange={set('description')} /></div>
            <div className="stack">
              <label>Price breakup (optional)</label>
              {items.map((it, n) => (
                <div className="row" key={n}>
                  <input style={{ flex: 2 }} placeholder="Material / labour / tax" value={it.label} onChange={(e) => setItems(items.map((x, i) => i === n ? { ...x, label: e.target.value } : x))} />
                  <input style={{ flex: 1 }} type="number" placeholder="₹" value={it.amountRupees} onChange={(e) => setItems(items.map((x, i) => i === n ? { ...x, amountRupees: e.target.value } : x))} />
                </div>
              ))}
              <button type="button" className="link small" onClick={() => setItems([...items, { label: '', amountRupees: '' }])}>+ Add line</button>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}><label>Completion (days)</label><input type="number" value={f.completionDays} onChange={set('completionDays')} /></div>
              <div style={{ flex: 1 }}><label>Valid until</label><input type="date" value={f.validUntil} onChange={set('validUntil')} /></div>
            </div>
            <div><label>Warranty</label><input value={f.warranty} onChange={set('warranty')} /></div>
            <PhotoPicker kind="quotation" value={photos} onChange={setPhotos} label="Photos of your work or product (optional)" />
            {!myQuote && <p className="notice">Quotation fee for this category: <b>{rupees(d.quoteFeePaise)}</b>, charged once when you submit. Revisions are free.</p>}
            <div className="row">
              <button className="btn">{myQuote ? 'Save revision' : `Pay ${rupees(d.quoteFeePaise)} and send`}</button>
              {!myQuote && <button type="button" className="link small" onClick={decline}>Not interested</button>}
            </div>
          </form>
        )}
        {msg.ok && <p className="ok">{msg.ok}</p>}
        {msg.err && <p className="error">{msg.err} {msg.err.includes('balance') && <Link href="/vendor/wallet">Recharge wallet</Link>}</p>}
      </div>
      <div>{s && <Chat leadId={lead.id} me={s.user.id} title="Chat with customer" />}</div>
    </div>
  );
}

export default function Page() { return <Suspense fallback={<p className="muted">Loading…</p>}><VendorLead /></Suspense>; }
