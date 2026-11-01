import type { Metadata, Viewport } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'MyCity - Get quotes from trusted local businesses',
  description: 'Post your requirement once and receive quotations from verified vendors in your city.',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#0f766e', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="wrap">{children}</main>
        <footer className="wrap footer muted small">MyCity · Your contact details stay private until you choose a vendor.</footer>
      </body>
    </html>
  );
}
