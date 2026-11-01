import { useState } from 'react';
import { View } from 'react-native';
import { api, saveSession } from '../api';
import { useNav } from '../nav';
import { Btn, Card, Err, Field, H, T } from '../ui';

export default function Login() {
  const nav = useNav();
  const [role, setRole] = useState<'customer' | 'vendor'>('customer');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function request() {
    setErr(''); setBusy(true);
    try { const r = await api('/auth/otp/request', { body: { phone } }); setSent(r.devCode ?? ''); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function verify() {
    setErr(''); setBusy(true);
    try {
      const r = await api('/auth/otp/verify', { body: { phone, code, role, name: name || undefined } });
      await saveSession(r);
      nav.reset(r.user.role === 'vendor' ? { name: 'vendorLeads' } : { name: 'home' });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <View>
      <H>Welcome to MyCity</H>
      <T muted style={{ marginBottom: 16 }}>Get quotations from trusted businesses in your city. Your number stays private until you choose a vendor.</T>
      <Card>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <View style={{ flex: 1 }}><Btn title="Need a service" ghost={role !== 'customer'} onPress={() => setRole('customer')} /></View>
          <View style={{ flex: 1 }}><Btn title="I run a business" ghost={role !== 'vendor'} onPress={() => setRole('vendor')} /></View>
        </View>
        {sent === null ? (
          <>
            <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10-digit mobile" />
            <Field label="Your name (new users)" value={name} onChangeText={setName} />
            <Btn title="Send OTP" onPress={request} loading={busy} />
          </>
        ) : (
          <>
            <Field label={`OTP sent to ${phone}`} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            {!!sent && <T small muted>Development mode: OTP is {sent}</T>}
            <Btn title="Verify and continue" onPress={verify} loading={busy} />
          </>
        )}
        <Err msg={err} />
      </Card>
    </View>
  );
}
