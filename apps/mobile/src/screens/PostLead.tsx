import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api, Photo } from '../api';
import { PhotoPicker } from '../photos';
import { useNav } from '../nav';
import { Btn, Card, Err, Field, H, T } from '../ui';

function Choice({ label, options, value, onChange }: { label: string; options: { id: number | string; name: string }[]; value: any; onChange: (v: any) => void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <T small bold style={{ marginBottom: 4 }}>{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => <View key={o.id}><Btn ghost={value !== o.id} title={o.name} onPress={() => onChange(o.id)} /></View>)}
      </View>
    </View>
  );
}

export default function PostLead({ categoryId, text }: { categoryId?: number; text?: string }) {
  const nav = useNav();
  const [cats, setCats] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [cat, setCat] = useState(categoryId ?? 0);
  const [cityId, setCityId] = useState(0);
  const [localityId, setLocalityId] = useState(0);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState(text ?? '');
  const [budget, setBudget] = useState('');
  const [address, setAddress] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/categories').then(setCats);
    api('/cities').then((c) => { setCities(c); setCityId(c.find((x: any) => x.name === 'Prayagraj')?.id ?? c[0]?.id); });
  }, []);
  const sub = useMemo(() => cats.flatMap((c) => c.children).find((s: any) => s.id === cat), [cats, cat]);
  const city = cities.find((c) => c.id === cityId);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const r = await api('/leads', { body: {
        categoryId: cat, cityId, localityId: localityId || undefined, title: title || `${sub?.name ?? 'Service'} required`,
        description: desc, details, address: address || undefined, photoIds: photos.map((p) => p.id), budgetRupees: budget ? Number(budget) : undefined,
      } });
      nav.reset({ name: 'home' });
      nav.push({ name: 'lead', id: r.id });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <View>
      <H>Post a requirement</H>
      <Card>
        <T bold>{sub ? sub.name : 'Choose a category from Home'}</T>
        <Field label="Describe what you need" value={desc} onChangeText={setDesc} multiline />
        {sub?.fields?.map((f: any) => f.type === 'select'
          ? <Choice key={f.key} label={f.label} options={f.options.map((o: string) => ({ id: o, name: o }))} value={details[f.key]} onChange={(v) => setDetails({ ...details, [f.key]: v })} />
          : <Field key={f.key} label={f.label} value={details[f.key] ?? ''} onChangeText={(v) => setDetails({ ...details, [f.key]: v })} keyboardType={f.type === 'number' ? 'numeric' : 'default'} />)}
        <PhotoPicker kind="lead" value={photos} onChange={setPhotos} label="Photos of the problem or item (optional)" />
        <Field label="Short title" value={title} onChangeText={setTitle} placeholder={sub ? `${sub.name} required` : ''} />
        <Choice label="City" options={cities} value={cityId} onChange={(v) => { setCityId(v); setLocalityId(0); }} />
        {city?.localities?.length > 0 && <Choice label="Locality" options={city.localities} value={localityId} onChange={setLocalityId} />}
        <Field label="Budget ₹ (optional)" value={budget} onChangeText={setBudget} keyboardType="numeric" />
        <Field label="Full address (shared only with the vendor you select)" value={address} onChangeText={setAddress} />
        <Err msg={err} />
        <Btn title="Get quotations" onPress={submit} loading={busy} disabled={!cat || desc.length < 10} />
      </Card>
    </View>
  );
}
