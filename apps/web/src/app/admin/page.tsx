'use client';
import { useEffect, useState } from 'react';
import { api, rupees, statusLabel } from '@/lib/api';

const tabs = ['Overview', 'Vendors', 'Leads', 'Pricing', 'Settings'] as const;

export default function Admin() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview');
  return (
    <>
      <h1>Admin</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        {tabs.map((t) => <button key={t} className={t === tab ? 'btn sm' : 'btn ghost sm'} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Overview' && <Overview />}
      {tab === 'Vendors' && <Vendors />}
      {tab === 'Leads' && <Leads />}
      {tab === 'Pricing' && <Pricing />}
      {tab === 'Settings' && <Settings />}
    </>
  );
}

function useLoad<T>(path: string) {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<T>(path).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [path]); // eslint-disable-line
  return { d, err, load };
}

function Overview() {
  const { d, err } = useLoad<any>('/admin/stats');
  const { d: rev } = useLoad<any[]>('/admin/revenue/by-category');
  if (err) return <p className="error">{err}</p>;
  if (!d) return null;
  const tiles: [string, string | number][] = [
    ['Customers', d.customers], ['Vendors', d.vendors], ['Pending approvals', d.pending_vendors], ['Leads', d.leads],
    ['Active leads', d.active_leads], ['Quotations', d.quotations], ['Quote revenue', rupees(Number(d.revenue_paise))], ['Wallet liability', rupees(Number(d.wallet_liability_paise))],
  ];
  return (
    <>
      <div className="grid">{tiles.map(([k, v]) => <div key={k} className="card"><div className="stat">{v}</div><span className="muted small">{k}</span></div>)}</div>
      <h2>Revenue by category</h2>
      <div className="card table-wrap"><table className="table"><thead><tr><th>Category</th><th>Quotes</th><th>Revenue</th></tr></thead>
        <tbody>{rev?.map((r) => <tr key={r.category}><td>{r.category}</td><td>{r.quotes}</td><td>{rupees(Number(r.revenue_paise))}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Vendors() {
  const [filter, setFilter] = useState('pending');
  const { d, load } = useLoad<any[]>(`/admin/vendors${filter ? `?status=${filter}` : ''}`);
  const setStatus = async (id: number, status: string) => { await api(`/admin/vendors/${id}/status`, { body: { status } }); load(); };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }}>
          <option value="">All</option>{['pending', 'approved', 'suspended', 'rejected'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Business</th><th>City / radius</th><th>Services</th><th>Wallet</th><th>Status</th><th></th></tr></thead>
        <tbody>{d?.map((v) => (
          <tr key={v.id}><td>{v.business_name}<div className="small muted">{v.owner} · {v.phone}</div></td><td>{v.city} · {v.service_radius_km} km</td>
            <td className="small">{v.categories.join(', ')}</td><td>{rupees(Number(v.balance_paise))}</td><td><span className="pill">{v.status}</span></td>
            <td className="row">{v.status !== 'approved' && <button className="btn sm" onClick={() => setStatus(v.id, 'approved')}>Approve</button>}
              {v.status === 'pending' && <button className="btn ghost sm" onClick={() => setStatus(v.id, 'rejected')}>Reject</button>}
              {v.status === 'approved' && <button className="btn ghost sm" onClick={() => setStatus(v.id, 'suspended')}>Suspend</button>}</td></tr>
        ))}</tbody></table>
        {d?.length === 0 && <p className="muted">No vendors in this state.</p>}
      </div>
    </>
  );
}

function Leads() {
  const { d } = useLoad<any[]>('/admin/leads');
  return (
    <div className="card table-wrap"><table className="table">
      <thead><tr><th>#</th><th>Requirement</th><th>Category</th><th>City</th><th>Customer</th><th>Vendors / quotes</th><th>Status</th></tr></thead>
      <tbody>{d?.map((l) => <tr key={l.id}><td>{l.id}</td><td>{l.title}</td><td>{l.category}</td><td>{l.city}</td><td>{l.customer}</td><td>{l.vendors} / {l.quotes}</td><td>{statusLabel(l.status)}</td></tr>)}</tbody>
    </table></div>
  );
}

function Pricing() {
  const { d, load } = useLoad<any[]>('/admin/pricing');
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  async function save(categoryId: number) {
    await api('/admin/pricing', { body: { categoryId, feeRupees: Number(edit[categoryId]) } });
    setMsg('Saved. New fee applies to new quotations only.'); setEdit({ ...edit, [categoryId]: '' }); load();
  }
  return (
    <>
      <p className="muted small">Fee per quotation. A subcategory fee overrides its category; categories without a fee use the default in Settings.</p>
      {msg && <p className="ok">{msg}</p>}
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Category</th><th>Current fee</th><th>New fee (₹)</th><th></th></tr></thead>
        <tbody>{d?.map((c) => (
          <tr key={c.category_id}><td style={{ paddingLeft: c.parent_id ? 24 : 8, fontWeight: c.parent_id ? 400 : 700 }}>{c.name}</td>
            <td>{c.fee_paise == null ? <span className="muted">inherit</span> : rupees(c.fee_paise)}</td>
            <td><input type="number" min={0} value={edit[c.category_id] ?? ''} onChange={(e) => setEdit({ ...edit, [c.category_id]: e.target.value })} style={{ width: 100 }} /></td>
            <td>{edit[c.category_id] && <button className="btn sm" onClick={() => save(c.category_id)}>Save</button>}</td></tr>
        ))}</tbody></table></div>
    </>
  );
}

function Settings() {
  const { d, load } = useLoad<any>('/admin/settings');
  const [f, setF] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (d) setF({ ...d, default_fee_rupees: d.default_quote_fee_paise / 100 }); }, [d]);
  if (!f) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await api('/admin/settings', { method: 'PUT', body: {
      default_quote_fee_paise: Math.round(Number(f.default_fee_rupees) * 100), max_vendors_per_lead: Number(f.max_vendors_per_lead),
      lead_expiry_hours: Number(f.lead_expiry_hours), contact_reveal_mode: f.contact_reveal_mode,
    } });
    setMsg('Settings saved.'); load();
  }
  return (
    <form onSubmit={save} className="card stack" style={{ maxWidth: 560 }}>
      <div><label>Default fee per quotation (₹)</label><input type="number" value={f.default_fee_rupees} onChange={(e) => setF({ ...f, default_fee_rupees: e.target.value })} /></div>
      <div><label>Max vendors per lead</label><input type="number" value={f.max_vendors_per_lead} onChange={(e) => setF({ ...f, max_vendors_per_lead: e.target.value })} /></div>
      <div><label>Lead expiry (hours)</label><input type="number" value={f.lead_expiry_hours} onChange={(e) => setF({ ...f, lead_expiry_hours: e.target.value })} /></div>
      <div><label>Customer contact sharing</label>
        <select value={f.contact_reveal_mode} onChange={(e) => setF({ ...f, contact_reveal_mode: e.target.value })}>
          <option value="after_selection">Share with the selected vendor (Phase 1)</option>
          <option value="never">Never share, MyCity chat only (Phase 2)</option>
        </select></div>
      {msg && <p className="ok">{msg}</p>}
      <button className="btn">Save settings</button>
    </form>
  );
}
