import './globals.css';
import type { Metadata } from 'next';

// This description ships on every page, including a client's. It used to name the
// Atelier, which meant every client's own Window quietly announced that a staff room
// exists. The door was never open to them, so this was only a whisper rather than a
// hole, but a whisper is still more than they need to hear.
export const metadata: Metadata = {
  title: 'Pentinian, Studio',
  description: 'Watch your build take shape.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* IBM Plex Mono carries every label, count and timestamp in here, the same as
            it does on the Foyer. The app referenced it in 38 rules and never loaded it,
            so the two rooms of one studio were set in different faces. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
