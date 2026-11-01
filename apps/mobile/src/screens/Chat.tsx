import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api, currentSession } from '../api';
import { Btn, Card, Err, Field, H, T, useTheme } from '../ui';

export default function Chat({ leadId, vendorId, title }: { leadId: number; vendorId?: number; title: string }) {
  const t = useTheme();
  const me = currentSession()?.user.id;
  const [conv, setConv] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const last = useRef(0);

  const pull = async (id: number) => {
    const m = await api<any[]>(`/conversations/${id}/messages?after=${last.current}`);
    if (m.length) { last.current = m[m.length - 1].id; setMsgs((p) => [...p, ...m]); }
  };
  useEffect(() => { api('/conversations', { body: { leadId, vendorId } }).then((c) => setConv(c.id)).catch((e) => setErr(e.message)); }, [leadId, vendorId]);
  useEffect(() => {
    if (!conv) return;
    pull(conv).catch(() => {});
    const i = setInterval(() => pull(conv).catch(() => {}), 4000);
    return () => clearInterval(i);
  }, [conv]);

  async function send() {
    if (!text.trim() || !conv) return;
    try { await api(`/conversations/${conv}/messages`, { body: { body: text } }); setText(''); await pull(conv); } catch (e: any) { setErr(e.message); }
  }
  return (
    <View>
      <H>{title}</H>
      {msgs.length === 0 && <T muted small>No messages yet. Phone numbers and links are hidden until a vendor is selected.</T>}
      {msgs.map((m) => (
        <Card key={m.id} style={{ alignSelf: m.sender_id === me ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: m.sender_id === me ? t.soft : t.card, padding: 10 }}>
          <T>{m.body}</T>
          {m.redacted && <T small muted>Contact details were hidden by MyCity</T>}
        </Card>
      ))}
      <Err msg={err} />
      <Field label="Message" value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" />
      <Btn title="Send" onPress={send} />
    </View>
  );
}
