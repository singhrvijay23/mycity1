'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, rupees, statusLabel } from '@/lib/api';
import { useSession } from '@/lib/useSession';
import Chat from '@/components/Chat';

function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const [data, setData] = useState<any>(null);
  const [chatWith, setChatWith] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api(`/leads/${id}`).then(setData).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function select(q: any) {
    if (!confirm(`Select ${q.business_name} for ${rupees(q.amount_paise)}? Your contact will be shared with them only.`)) return;
    try { await api(`/leads/${id}/select`, { body: { quotationId: q.id } }); load(); } catch (e: any) { setErr(e.message); }
  }
  async function cancel() {
    if (!confirm('Cancel this requirement?')) return;
    try { await api(`/leads/${id}/cancel`, { body: {} }); load(); } catch (e: any) { setErr(e.message); }
  }

  if (err) return <p className="error">{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { lead, quotes } = data;
  const open = ['vendors_notified', 'quotes_received'].includes(lead.status);
  return (
    <div className="two">
      <div className="stack">
        <div className="card stack">
          <div className="row between"><h1 style={{ margin: 0 }}>{lead.title}</h1><span className="pill">{statusLabel(lead.status)}</span></div>
          <p className="muted small">#{lead.id} · {lead.category} · {lead.locality ? `${lead.locality}, ` : ''}{lead.city}</p>
          <p>{lead.description}</p>
          {lead.status === 'under_review' && <p className="notice">No matching vendors yet. Our team is finding businesses for you.</p>}
          {open && <button className="link small" onClick={cancel}>Cancel requirement</button>}
        </div>
        <h2>Quotations ({quotes.length})</h2>
        {quotes.length === 0 && <p className="muted">Vendors have been notified. Quotations will appear here.</p>}
        {quotes.map((q: any) => (
          <div key={q.id} className="card stack">
            <div className="row between">
              <div><h3>{q.business_name}</h3><span className="small muted">{q.distance_km} km away · rating {q.rating || 'new'}{q.revision > 1 ? ` · revised ${q.revision - 1}x` : ''}</span></div>
              <div className="stat">{rupees(q.amount_paise)}</div>
            </div>
            <p>{q.description}</p>
            {q.items?.length > 0 && <table className="table"><tbody>{q.items.map((i: any, n: number) => <tr key={n}><td>{i.label}</td><td>{rupees(i.amount_paise)}</td></tr>)}</tbody></table>}
            <p className="small muted">{[q.completion_days && `Completion: ${q.completion_days} days`, q.warranty && `Warranty: ${q.warranty}`, q.valid_until && `Valid until ${q.valid_until.slice(0, 10)}`].filter(Boolean).join(' · ')}</p>
            <div className="row">
              {q.selected ? <span className="pill">Selected{q.vendor_phone ? ` · call ${q.vendor_phone}` : ''}</span>
                : open && <button className="btn sm" onClick={() => select(q)}>Select this vendor</button>}
              <button className="btn ghost sm" onClick={() => setChatWith(q)}>Chat</button>
            </div>
          </div>
        ))}
      </div>
      <div>{chatWith && s && <Chat key={chatWith.vendor_id} leadId={lead.id} vendorId={chatWith.vendor_id} me={s.user.id} title={`Chat with ${chatWith.business_name}`} />}</div>
    </div>
  );
}

export default function Page() { return <Suspense fallback={<p className="muted">Loading…</p>}><LeadDetail /></Suspense>; }
