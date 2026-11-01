import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Photo, uploadPhotos } from './api';
import { Err, T, useTheme } from './ui';

export function Gallery({ photos, size = 88 }: { photos?: Photo[]; size?: number }) {
  const t = useTheme();
  const [open, setOpen] = useState<Photo | null>(null);
  if (!photos?.length) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        {photos.map((p) => (
          <Pressable key={p.id} onPress={() => setOpen(p)} style={{ marginRight: 8 }}>
            <Image source={{ uri: p.url }} style={{ width: size, height: size, borderRadius: 10, borderWidth: 1, borderColor: t.line }} />
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable onPress={() => setOpen(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 12 }}>
          {open && <Image source={{ uri: open.url }} style={{ width: '100%', aspectRatio: open.width / open.height, borderRadius: 8 }} resizeMode="contain" />}
          <Text style={{ color: '#ccc', textAlign: 'center', marginTop: 12 }}>Tap to close</Text>
        </Pressable>
      </Modal>
    </>
  );
}

/** Take a photo or choose from the gallery; uploads right away and shows removable thumbnails. */
export function PhotoPicker({ kind, value, onChange, max = 6, label = 'Photos (optional)' }: {
  kind: 'lead' | 'quotation' | 'vendor'; value: Photo[]; onChange: (p: Photo[]) => void; max?: number; label?: string;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const room = max - value.length;

  async function pick(source: 'camera' | 'library') {
    setErr('');
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr(`Please allow ${source === 'camera' ? 'camera' : 'photo'} access in Settings.`); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: source === 'library', selectionLimit: room };
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets.length) return;
    setBusy(true);
    try { onChange([...value, ...(await uploadPhotos(kind, r.assets.slice(0, room)))]); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const tile = { width: 80, height: 80, borderRadius: 10, marginRight: 8, marginBottom: 8 } as const;
  return (
    <View style={{ marginBottom: 12 }}>
      <T small bold style={{ marginBottom: 4 }}>{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {value.map((p) => (
          <View key={p.id}>
            <Image source={{ uri: p.url }} style={tile} />
            <Pressable onPress={() => onChange(value.filter((x) => x.id !== p.id))} hitSlop={8}
              style={{ position: 'absolute', top: 4, right: 12, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14 }}>×</Text>
            </Pressable>
          </View>
        ))}
        {busy && <View style={[tile, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.line }]}><ActivityIndicator color={t.brand} /></View>}
        {!busy && room > 0 && (['camera', 'library'] as const).map((s) => (
          <Pressable key={s} onPress={() => pick(s)} style={[tile, { borderWidth: 1, borderStyle: 'dashed', borderColor: t.brand, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: t.brand, fontWeight: '700', fontSize: 12, textAlign: 'center' }}>{s === 'camera' ? 'Take\nphoto' : 'Choose\nphotos'}</Text>
          </Pressable>
        ))}
      </View>
      <T small muted>Up to {max} photos. Location data inside photos is removed.</T>
      <Err msg={err} />
    </View>
  );
}
