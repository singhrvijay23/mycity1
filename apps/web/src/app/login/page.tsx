'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setSession } from '@/lib/api';

function Login() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [role, setRole] = useState<'customer' | 'vendor'>('customer');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function request(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { const r = await api('/auth/otp/request', { body: { phone } }); setSent(r.devCode ?? ''); } catch (e: any) { setErr(e.message); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const r = await api('/auth/otp/verify', { body: { phone, code, role, name: name || undefined } });
      setSession(r);
      router.push(next ?? (r.user.role === 'vendor' ? '/vendor' : r.user.role === 'admin' ? '/admin' : '/my-leads'));
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="card stack" style={{ maxWidth: 420, margin: '24px auto' }}>
      <h1>Log in to MyCity</h1>
      <div className="row">
        <button className={role === 'customer' ? 'btn sm' : 'btn ghost sm'} onClick={() => setRole('customer')}>I need a service</button>
        <button className={role === 'vendor' ? 'btn sm' : 'btn ghost sm'} onClick={() => setRole('vendor')}>I run a business</button>
      </div>
      {sent === null ? (
        <form onSubmit={request} className="stack">
          <div><label>Mobile number</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" inputMode="tel" /></div>
          <div><label>Your name (new users)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <button className="btn">Send OTP</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <div><label>Enter OTP sent to {phone}</label><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} /></div>
          {sent && <p className="small muted">Development mode: OTP is {sent}</p>}
          <button className="btn">Verify and continue</button>
        </form>
      )}
      {err && <p className="error">{err}</p>}
      <p className="small muted">Demo: customer 9000000001, vendor 9100000001, admin 9999999999.</p>
    </div>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
