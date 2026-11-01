'use client';
import Link from 'next/link';
import { setSession } from '@/lib/api';
import { useSession } from '@/lib/useSession';

export default function Nav() {
  const s = useSession();
  const role = s?.user.role;
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand">My<span>City</span></Link>
        <nav>
          {role === 'customer' && <><Link href="/post">Post requirement</Link><Link href="/my-leads">My requirements</Link></>}
          {role === 'vendor' && <><Link href="/vendor">Leads</Link><Link href="/vendor/wallet">Wallet</Link><Link href="/vendor/profile">Profile</Link></>}
          {role === 'admin' && <Link href="/admin">Admin</Link>}
          {s ? <button className="link" onClick={() => { setSession(null); location.href = '/'; }}>Log out</button>
             : s === null && <Link href="/login" className="btn sm">Log in</Link>}
        </nav>
      </div>
    </header>
  );
}
