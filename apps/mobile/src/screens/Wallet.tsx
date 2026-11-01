import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, rupees, statusLabel } from '../api';
import { Btn, Card, Err, Field, H, T } from '../ui';

export default function Wallet() {
  const [w, setW] = useState<any>(null);
  const [amt, setAmt] = useState('500');
  const [err, setErr] = useState('');
  const load = () => api('/vendor/wallet').then(setW).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  // Dev: direct credit. Production: Razorpay checkout, wallet credited by the verified payment webhook.
  const recharge = () => api('/vendor/wallet/recharge', { body: { amountRupees: Number(amt), reference: `app-${Date.now()}` } }).then(load).catch((e) => setErr(e.message));
  return (
    <View>
      <H>Wallet</H>
      <Card><T bold style={{ fontSize: 26 }}>{rupees(w?.balancePaise)}</T><T small muted>Available balance</T></Card>
      <Field label="Recharge amount ₹" value={amt} onChangeText={setAmt} keyboardType="numeric" />
      <Btn title="Recharge" onPress={recharge} />
      <Err msg={err} />
      {w?.transactions.map((t: any) => (
        <Card key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><T>{t.note}</T><T small muted>{statusLabel(t.type)} · {new Date(t.created_at).toLocaleDateString('en-IN')}</T></View>
          <T bold>{t.amount_paise > 0 ? '+' : ''}{rupees(t.amount_paise)}</T>
        </Card>
      ))}
    </View>
  );
}
