'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Msg = { id: number; sender_id: number; sender_role: string; body: string; redacted: boolean; created_at: string };

/** In-app chat for one lead + vendor. Polls every 4s (MVP); WebSockets can replace polling later. */
export default function Chat({ leadId, vendorId, me, title }: { leadId: number; vendorId?: number; me: number; title: string }) {
  const [convId, setConvId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const last = useRef(0);

  useEffect(() => {
    api('/conversations', { body: { leadId, vendorId } }).then((c) => setConvId(c.id)).catch((e) => setErr(e.message));
  }, [leadId, vendorId]);

  useEffect(() => {
    if (!convId) return;
    const load = () => api<Msg[]>(`/conversations/${convId}/messages?after=${last.current}`).then((m) => {
      if (m.length) { last.current = m[m.length - 1].id; setMsgs((p) => [...p, ...m]); }
    }).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [convId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !convId) return;
    try {
      await api(`/conversations/${convId}/messages`, { body: { body: text } });
      setText('');
      const m = await api<Msg[]>(`/conversations/${convId}/messages?after=${last.current}`);
      if (m.length) { last.current = m[m.length - 1].id; setMsgs((p) => [...p, ...m]); }
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="chat">
      <div className="chat-head">{title}</div>
      <div className="chat-body">
        {msgs.length === 0 && <p className="muted small">No messages yet. Ask questions here. Phone numbers and links are hidden until a vendor is selected.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.sender_id === me ? 'mine' : ''}`}>
            {m.body}
            {m.redacted && <div className="small muted">Contact details were hidden by MyCity</div>}
          </div>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      <form onSubmit={send} className="chat-form">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
        <button className="btn">Send</button>
      </form>
    </div>
  );
}
