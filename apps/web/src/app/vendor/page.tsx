'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, rupees, statusLabel } from '@/lib/api';

export default function VendorHome() {
  const [leads, setLeads] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  useEffect(() => {
    api('/vendor/leads').then(setLeads).catch((e) => setErr(e));
    api('/vendor/stats').then(setStats).catch(() => {});
  }, []);

  if (err) return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <h1>Business account</h1>
      <p>{err.message}</p>
      {err.code === 'no_profile' && <Link className="btn" href="/vendor/profile">Set up business profile</Link>}
      {err.code === 'unauthorized' && <Link className="btn" href="/login?next=/vendor">Log in</Link>}
    </div>
  );
  return (
    <>
      <h1>Leads for you</h1>
      {stats && (
        <div className="grid" style={{ marginBottom: 16 }}>
          <div className="card"><div className="stat">{stats.leads_received}</div><span className="muted small">Leads received</span></div>
          <div className="card"><div className="stat">{stats.quotes_submitted}</div><span className="muted small">Quotes sent</span></div>
          <div className="card"><div className="stat">{stats.quotes_won}</div><span className="muted small">Won</span></div>
          <div className="card"><div className="stat">{rupees(stats.spent_paise)}</div><span className="muted small">Spent on quotes</span></div>
        </div>
      )}
      {leads?.length === 0 && <p className="muted">No leads yet. New requirements in your categories and service area will appear here.</p>}
      <div className="stack">
        {leads?.map((l) => (
          <Link key={l.id} href={`/vendor/leads/${l.id}`} className="card row between" style={{ color: 'inherit' }}>
            <div><h3>{l.title}</h3><span className="small muted">#{l.id} · {l.category} · {l.locality ? `${l.locality}, ` : ''}{l.city} · {l.distance_km} km{l.budget_paise ? ` · budget ${rupees(l.budget_paise)}` : ''}</span></div>
            <span className={`pill ${l.my_quote_id ? '' : 'warn'}`}>{l.my_quote_status ? statusLabel(l.my_quote_status) : l.my_status === 'declined' ? 'Declined' : 'New'}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
