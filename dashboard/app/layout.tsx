import type { Metadata, Viewport } from 'next'
import { archivo, mono } from './fonts'
import { site } from '@/lib/marketing'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: 'Legends Assistant | War, race and maze tracking for Monster Legends alliances',
    template: '%s | Legends Assistant',
  },
  description: site.description,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: 'Legends Assistant | Wars, races and mazes without spreadsheets',
    description: site.description,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Legends Assistant alliance board' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Legends Assistant | Wars, races and mazes without spreadsheets',
    description: site.description,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0c0d0a',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
}

/**
 * Applies the stored appearance before first paint so a light-mode user never sees a dark
 * flash. Kept inline (and tiny) because it must run before the browser paints; the Settings
 * page takes over once React hydrates.
 */
const themeScript = `(function(){try{var p=localStorage.getItem('legends-theme')||'system';var s=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';var t=(p==='light'||p==='dark')?p:s;var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content',t==='light'?'#f5efe2':'#0c0d0a');}}catch(_){}})();`

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: site.name,
  url: site.url,
  applicationCategory: 'GameApplication',
  operatingSystem: 'Web',
  description: site.description,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: '7-day free trial, no card required.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${archivo.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink-950 font-sans text-slate-200 antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      </body>
    </html>
  )
}
