'use client';
import { useEffect, useState } from 'react';
import { api, rupees, statusLabel } from '@/lib/api';

export default function Wallet() {
  const [w, setW] = useState<any>(null);
  const [amt, setAmt] = useState('500');
  const [err, setErr] = useState('');
  const load = () => api('/vendor/wallet').then(setW).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function recharge(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    // Dev: direct credit. Production: open Razorpay checkout, wallet is credited by the verified webhook.
    try { await api('/vendor/wallet/recharge', { body: { amountRupees: Number(amt), reference: `dev-${Date.now()}` } }); load(); } catch (e: any) { setErr(e.message); }
  }
  return (
    <>
      <h1>Wallet</h1>
      <div className="card row between">
        <div><div className="stat">{rupees(w?.balancePaise)}</div><span className="muted small">Available balance</span></div>
        <form onSubmit={recharge} className="row"><input type="number" min={10} value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 120 }} /><button className="btn">Recharge</button></form>
      </div>
      {err && <p className="error">{err}</p>}
      <h2>Transactions</h2>
      <div className="table-wrap card">
        <table className="table">
          <thead><tr><th>Date</th><th>Details</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead>
          <tbody>
            {w?.transactions.map((t: any) => (
              <tr key={t.id}><td>{new Date(t.created_at).toLocaleString('en-IN')}</td><td>{t.note}</td><td>{statusLabel(t.type)}</td>
                <td className={t.amount_paise > 0 ? 'ok' : ''}>{t.amount_paise > 0 ? '+' : ''}{rupees(t.amount_paise)}</td><td>{rupees(t.balance_after_paise)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
