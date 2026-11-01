'use client';
import { useEffect, useState } from 'react';
import { getSession, Session } from './api';

export function useSession() {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setS(getSession());
    read();
    window.addEventListener('mycity-session', read);
    return () => window.removeEventListener('mycity-session', read);
  }, []);
  return s; // undefined while loading
}
