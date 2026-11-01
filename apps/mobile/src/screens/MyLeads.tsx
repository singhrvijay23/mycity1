import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, statusLabel } from '../api';
import { useNav } from '../nav';
import { Btn, Card, Err, H, Pill, T } from '../ui';

export default function MyLeads() {
  const nav = useNav();
  const [leads, setLeads] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/leads').then(setLeads).catch((e) => setErr(e.message)); }, []);
  return (
    <View>
      <H>My requirements</H>
      <Err msg={err} />
      {leads?.length === 0 && <T muted>Nothing posted yet.</T>}
      {leads?.map((l) => (
        <Pressable key={l.id} onPress={() => nav.push({ name: 'lead', id: l.id })}>
          <Card>
            <T bold>{l.title}</T>
            <T small muted>#{l.id} · {l.category} · {l.vendors_notified} vendors · {l.quotes} quotes</T>
            <View style={{ marginTop: 6 }}><Pill text={statusLabel(l.status)} /></View>
          </Card>
        </Pressable>
      ))}
      <Btn title="Post a new requirement" onPress={() => nav.push({ name: 'home' })} ghost />
    </View>
  );
}
