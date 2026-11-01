import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, rupees, statusLabel } from '../api';
import { useNav } from '../nav';
import { Btn, Card, Err, H, Pill, T } from '../ui';

export default function VendorLeads() {
  const nav = useNav();
  const [leads, setLeads] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/vendor/leads').then(setLeads).catch((e) => setErr(e.code === 'no_profile' ? 'Set up your business profile on the MyCity website to start receiving leads.' : e.message));
    api('/vendor/stats').then(setStats).catch(() => {});
  }, []);
  return (
    <View>
      <H>Leads for you</H>
      {stats && <T muted small style={{ marginBottom: 10 }}>{stats.leads_received} leads · {stats.quotes_submitted} quotes · {stats.quotes_won} won · {rupees(stats.spent_paise)} spent</T>}
      <Btn ghost title="Wallet" onPress={() => nav.push({ name: 'wallet' })} />
      <Err msg={err} />
      {leads?.length === 0 && <T muted>No leads yet. New requirements in your categories and area will appear here.</T>}
      {leads?.map((l) => (
        <Pressable key={l.id} onPress={() => nav.push({ name: 'vendorLead', id: l.id })}>
          <Card>
            <T bold>{l.title}</T>
            <T small muted>#{l.id} · {l.category} · {l.locality ? `${l.locality}, ` : ''}{l.city} · {l.distance_km} km</T>
            <View style={{ marginTop: 6 }}><Pill text={l.my_quote_status ? statusLabel(l.my_quote_status) : l.my_status === 'declined' ? 'Declined' : 'New'} /></View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
