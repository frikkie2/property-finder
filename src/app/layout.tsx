import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Property Finder — field dossier",
  description: "Identify the real address behind a property listing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-card/70 backdrop-blur-sm sticky top-0 z-30">
          <div className="mx-auto max-w-5xl px-5 py-3 flex items-center justify-between gap-3">
            <a href="/" className="flex items-baseline gap-2.5 group">
              <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-clay text-card text-sm font-bold shadow-sm">P</span>
              <span className="font-display text-xl text-ink tracking-tight group-hover:text-clay transition-colors">
                Property Finder
              </span>
            </a>
            <span className="data-label hidden sm:block">Pretoria · address identification</span>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-5xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
