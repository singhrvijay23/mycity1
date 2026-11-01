'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, statusLabel } from '@/lib/api';

export default function MyLeads() {
  const [leads, setLeads] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/leads').then(setLeads).catch((e) => setErr(e.message)); }, []);
  return (
    <>
      <div className="row between"><h1>My requirements</h1><Link className="btn" href="/post">Post requirement</Link></div>
      {err && <p className="error">{err} <Link href="/login?next=/my-leads">Log in</Link></p>}
      {leads?.length === 0 && <p className="muted">Nothing posted yet.</p>}
      <div className="stack">
        {leads?.map((l) => (
          <Link key={l.id} href={`/my-leads/${l.id}`} className="card row between" style={{ color: 'inherit' }}>
            <div><h3>{l.title}</h3><span className="small muted">#{l.id} · {l.category} · {new Date(l.created_at).toLocaleDateString('en-IN')}</span></div>
            <div className="row"><span className="small">{l.vendors_notified} vendors · {l.quotes} quotes</span><span className="pill">{statusLabel(l.status)}</span></div>
          </Link>
        ))}
      </div>
    </>
  );
}
