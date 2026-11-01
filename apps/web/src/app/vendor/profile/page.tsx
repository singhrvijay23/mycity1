'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function Profile() {
  const [cats, setCats] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [f, setF] = useState({ businessName: '', description: '', businessType: 'service', cityId: 0, serviceRadiusKm: 15, gstNumber: '' });
  const [sel, setSel] = useState<number[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/categories').then(setCats);
    api('/cities').then((c) => { setCities(c); setF((p) => ({ ...p, cityId: p.cityId || c[0]?.id })); });
    api('/auth/me').then((m) => { if (m.vendor) { setStatus(m.vendor.status); setSel(m.vendor.category_ids); setF({ businessName: m.vendor.business_name, description: m.vendor.description, businessType: m.vendor.business_type, cityId: m.vendor.city_id, serviceRadiusKm: m.vendor.service_radius_km, gstNumber: m.vendor.gst_number ?? '' }); } });
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const r = await api('/vendor/profile', { method: 'PUT', body: { ...f, gstNumber: f.gstNumber || undefined, categoryIds: sel } });
      setStatus(r.status);
    } catch (e: any) { setErr(e.message); }
  }
  const toggle = (id: number) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <form onSubmit={save} className="card stack" style={{ maxWidth: 720 }}>
      <h1>Business profile</h1>
      {status && <p className="notice">Status: <b>{status}</b>{status === 'pending' && '. You will start receiving leads once MyCity approves your business.'}</p>}
      <div><label>Business name</label><input required value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></div>
      <div><label>About your business</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Business type</label><select value={f.businessType} onChange={(e) => setF({ ...f, businessType: e.target.value })}>{['service', 'product', 'professional', 'manufacturer', 'dealer'].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div style={{ flex: 1 }}><label>City</label><select value={f.cityId} onChange={(e) => setF({ ...f, cityId: Number(e.target.value) })}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Service radius (km), include nearby cities</label><input type="number" min={1} max={300} value={f.serviceRadiusKm} onChange={(e) => setF({ ...f, serviceRadiusKm: Number(e.target.value) })} /></div>
        <div style={{ flex: 1 }}><label>GST number (optional)</label><input value={f.gstNumber} onChange={(e) => setF({ ...f, gstNumber: e.target.value })} /></div>
      </div>
      <div><label>Services you offer</label>
        {cats.map((c) => (
          <div key={c.id} style={{ marginBottom: 8 }}><div className="small muted">{c.name}</div>
            <div className="row">{c.children.map((s: any) => <button type="button" key={s.id} className={sel.includes(s.id) ? 'btn sm' : 'btn ghost sm'} onClick={() => toggle(s.id)}>{s.name}</button>)}</div>
          </div>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={!sel.length}>Save profile</button>
    </form>
  );
}
