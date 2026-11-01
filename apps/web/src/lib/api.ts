'use client';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type Session = { token: string; user: { id: number; role: 'customer' | 'vendor' | 'admin'; name: string; phone: string } };

export function getSession(): Session | null {
  try {
    const s = localStorage.getItem('mycity.session');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
export function setSession(s: Session | null) {
  try {
    if (s) localStorage.setItem('mycity.session', JSON.stringify(s));
    else localStorage.removeItem('mycity.session');
  } catch {}
  window.dispatchEvent(new Event('mycity-session'));
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const s = getSession();
  const res = await fetch(API + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setSession(null);
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Request failed');
  }
  return data as T;
}

export const rupees = (paise?: number | null) =>
  paise == null ? '-' : '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export type Photo = { id: string; url: string; width: number; height: number };

/** Upload one or more image files. The server resizes them and strips location metadata. */
export async function uploadPhotos(kind: 'lead' | 'quotation' | 'vendor', files: File[]): Promise<Photo[]> {
  const s = getSession();
  const form = new FormData();
  for (const f of files) form.append('file', f, f.name);
  const res = await fetch(`${API}/uploads?kind=${kind}`, {
    method: 'POST', body: form, headers: s ? { authorization: `Bearer ${s.token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Upload failed');
  return data.photos;
}
