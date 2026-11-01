import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Android emulator reaches the host machine at 10.0.2.2; a real phone needs your computer's LAN IP.
export const API: string = (Constants.expoConfig?.extra as { apiUrl?: string })?.apiUrl ?? 'http://localhost:4000';

export type Role = 'customer' | 'vendor' | 'admin';
export type Session = { token: string; user: { id: number; role: Role; name: string; phone: string } };

let session: Session | null = null;
const KEY = 'mycity.session';

export async function loadSession() {
  try {
    const s = await SecureStore.getItemAsync(KEY);
    session = s ? JSON.parse(s) : null;
  } catch {
    session = null;
  }
  return session;
}
export async function saveSession(s: Session | null) {
  session = s;
  try {
    if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
}
export const currentSession = () => session;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.message ?? 'Request failed') as Error & { code?: string; status?: number };
    e.code = data.error;
    e.status = res.status;
    throw e;
  }
  return data as T;
}

export const rupees = (paise?: number | null) =>
  paise == null ? '-' : '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
