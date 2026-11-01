import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { api, rupees, statusLabel } from '../api';
import { useNav } from '../nav';
import { Btn, Card, Err, H, Pill, T } from '../ui';
import { Gallery } from '../photos';

export default function LeadDetail({ id }: { id: number }) {
  const nav = useNav();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api(`/leads/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  function select(q: any) {
    Alert.alert('Select vendor', `Select ${q.business_name} for ${rupees(q.amount_paise)}? Your contact will be shared with them only.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Select', onPress: () => api(`/leads/${id}/select`, { body: { quotationId: q.id } }).then(load).catch((e) => setErr(e.message)) },
    ]);
  }
  if (!d) return <View><Err msg={err} /><T muted>Loading…</T></View>;
  const { lead, quotes } = d;
  const open = ['vendors_notified', 'quotes_received'].includes(lead.status);
  return (
    <View>
      <H>{lead.title}</H>
      <Card>
        <Pill text={statusLabel(lead.status)} />
        <T small muted style={{ marginVertical: 6 }}>#{lead.id} · {lead.category} · {lead.locality ? `${lead.locality}, ` : ''}{lead.city}</T>
        <T>{lead.description}</T>
        <Gallery photos={lead.photos} />
      </Card>
      <Err msg={err} />
      <T bold style={{ fontSize: 17, marginVertical: 8 }}>Quotations ({quotes.length})</T>
      {quotes.length === 0 && <T muted>Vendors have been notified. Quotations will appear here.</T>}
      {quotes.map((q: any) => (
        <Card key={q.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}><T bold>{q.business_name}</T><T small muted>{q.distance_km} km away</T></View>
            <T bold style={{ fontSize: 20 }}>{rupees(q.amount_paise)}</T>
          </View>
          <Gallery photos={q.vendor_photos?.slice(0, 4)} size={44} />
          <T style={{ marginVertical: 6 }}>{q.description}</T>
          <Gallery photos={q.photos} />
          {q.items?.map((i: any, n: number) => <T key={n} small muted>{i.label}: {rupees(i.amount_paise)}</T>)}
          {q.selected ? <Pill text={`Selected${q.vendor_phone ? ` · ${q.vendor_phone}` : ''}`} /> : open && <Btn title="Select this vendor" onPress={() => select(q)} />}
          <Btn ghost title="Chat" onPress={() => nav.push({ name: 'chat', leadId: lead.id, vendorId: q.vendor_id, title: q.business_name })} />
        </Card>
      ))}
    </View>
  );
}
