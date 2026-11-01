import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { api, Photo, rupees, statusLabel } from '../api';
import { Gallery, PhotoPicker } from '../photos';
import { useNav } from '../nav';
import { Btn, Card, Err, Field, H, Pill, T } from '../ui';

export default function VendorLead({ id }: { id: number }) {
  const nav = useNav();
  const [d, setD] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [days, setDays] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => api(`/vendor/leads/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  function submit() {
    Alert.alert('Send quotation', `${rupees(d.quoteFeePaise)} will be deducted from your wallet.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay and send', onPress: async () => {
        try {
          const r = await api(`/vendor/leads/${id}/quote`, { body: { amountRupees: Number(amount), description: desc, completionDays: days ? Number(days) : undefined, photoIds: photos.map((p) => p.id), expectedFeePaise: d.quoteFeePaise } });
          setMsg(`Sent. ${rupees(r.feePaise)} deducted, balance ${rupees(r.balancePaise)}.`); load();
        } catch (e: any) { setErr(e.message); }
      } },
    ]);
  }
  if (!d) return <View><Err msg={err} /><T muted>Loading…</T></View>;
  const { lead, myQuote, customerContact } = d;
  const open = ['vendors_notified', 'quotes_received'].includes(lead.status);
  return (
    <View>
      <H>{lead.title}</H>
      <Card>
        <Pill text={statusLabel(lead.status)} />
        <T small muted style={{ marginVertical: 6 }}>#{lead.id} · {lead.category} · {lead.locality ? `${lead.locality}, ` : ''}{lead.city} · {lead.distance_km} km</T>
        <T>{lead.description}</T>
        <Gallery photos={lead.photos} />
        {Object.entries(lead.details ?? {}).map(([k, v]) => <T key={k} small muted>{k}: {String(v)}</T>)}
        {lead.budget_paise ? <T small>Budget {rupees(lead.budget_paise)}</T> : null}
        <T small muted style={{ marginTop: 8 }}>
          {customerContact ? `Selected! Customer: ${customerContact.name}, ${customerContact.phone}${customerContact.address ? ', ' + customerContact.address : ''}` : 'Customer contact is hidden until they select your quotation.'}
        </T>
      </Card>
      {myQuote ? (
        <Card><T bold>Your quotation: {rupees(myQuote.amount_paise)} · {statusLabel(myQuote.status)}</T><T>{myQuote.description}</T><Gallery photos={myQuote.photos} /><T small muted>Fee paid {rupees(myQuote.fee_paise)}</T></Card>
      ) : open && (
        <Card>
          <Field label="Total price ₹" value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <Field label="Work / product description" value={desc} onChangeText={setDesc} multiline />
          <Field label="Completion (days)" value={days} onChangeText={setDays} keyboardType="numeric" />
          <PhotoPicker kind="quotation" value={photos} onChange={setPhotos} label="Photos of your work or product (optional)" />
          <T small muted>Quotation fee: {rupees(d.quoteFeePaise)}, charged once. Revisions are free.</T>
          <Btn title={`Pay ${rupees(d.quoteFeePaise)} and send`} onPress={submit} disabled={!amount || desc.length < 5} />
        </Card>
      )}
      {!!msg && <T style={{ color: '#15803d' }}>{msg}</T>}
      <Err msg={err} />
      <Btn ghost title="Chat with customer" onPress={() => nav.push({ name: 'chat', leadId: lead.id, title: 'Chat with customer' })} />
    </View>
  );
}
