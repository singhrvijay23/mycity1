import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../api';
import { useNav } from '../nav';
import { Btn, Card, Field, H, T } from '../ui';

export default function Home() {
  const nav = useNav();
  const [cats, setCats] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[] | null>(null);
  useEffect(() => { api('/categories').then(setCats).catch(() => {}); }, []);

  async function search() {
    if (q.trim().length < 3) return;
    setHits((await api('/ai/classify', { body: { text: q } })).suggestions);
  }
  return (
    <View>
      <H>What do you need?</H>
      <Field label="Describe it in your words" value={q} onChangeText={setQ} placeholder='e.g. "AC not cooling, need repair"' onSubmitEditing={search} returnKeyType="search" />
      <Btn title="Find service" onPress={search} />
      {hits && (
        <Card style={{ marginTop: 8 }}>
          <T small muted>{hits.length ? 'Did you mean:' : 'No match. Pick a category below.'}</T>
          {hits.map((h) => <Btn key={h.categoryId} ghost title={`${h.parentName} › ${h.name}`} onPress={() => nav.push({ name: 'post', categoryId: h.categoryId, text: q })} />)}
        </Card>
      )}
      <Btn ghost title="My requirements" onPress={() => nav.push({ name: 'myLeads' })} />
      {cats.map((c) => (
        <View key={c.id} style={{ marginTop: 16 }}>
          <T bold style={{ fontSize: 17, marginBottom: 8 }}>{c.name}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {c.children.map((s: any) => (
              <Pressable key={s.id} style={{ width: '48%' }} onPress={() => nav.push({ name: 'post', categoryId: s.id })}>
                <Card style={{ minHeight: 64 }}><T bold>{s.name}</T></Card>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
