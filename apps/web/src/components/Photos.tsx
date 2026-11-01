'use client';
import { useRef, useState } from 'react';
import { Photo, uploadPhotos } from '@/lib/api';

/** Thumbnails; click to view full size. */
export function Gallery({ photos, size = 96 }: { photos?: Photo[]; size?: number }) {
  const [open, setOpen] = useState<Photo | null>(null);
  if (!photos?.length) return null;
  return (
    <>
      <div className="photos">
        {photos.map((p) => (
          <button type="button" key={p.id} className="thumb" style={{ width: size, height: size }} onClick={() => setOpen(p)} aria-label="View photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt="" />
          <span className="small">Tap anywhere to close</span>
        </div>
      )}
    </>
  );
}

/** Choose photos (camera on phones), upload immediately, show thumbnails with remove buttons. */
export function PhotoPicker({ kind, value, onChange, max = 6, label = 'Photos (optional)' }: {
  kind: 'lead' | 'quotation' | 'vendor'; value: Photo[]; onChange: (p: Photo[]) => void; max?: number; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setErr('');
    const room = max - value.length;
    if (files.length > room) setErr(`You can add ${room} more photo${room === 1 ? '' : 's'}.`);
    const take = files.slice(0, room);
    const big = take.find((f) => f.size > 10 * 1024 * 1024);
    if (big) { setErr(`"${big.name}" is larger than 10 MB.`); return; }
    if (!take.length) return;
    setBusy(true);
    try { onChange([...value, ...(await uploadPhotos(kind, take))]); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div>
      <label>{label}</label>
      <div className="photos">
        {value.map((p) => (
          <div key={p.id} className="thumb" style={{ width: 88, height: 88 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" />
            <button type="button" className="remove" onClick={() => onChange(value.filter((x) => x.id !== p.id))} aria-label="Remove photo">×</button>
          </div>
        ))}
        {value.length < max && (
          <button type="button" className="thumb add" style={{ width: 88, height: 88 }} onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : '+ Add photo'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={pick} />
      <p className="small muted" style={{ margin: '4px 0 0' }}>Up to {max} photos. Location data inside photos is removed automatically.</p>
      {err && <p className="error small">{err}</p>}
    </div>
  );
}
