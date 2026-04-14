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
  title: "Property Finder",
  description: "Find the real address behind a Property24 listing",
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
      <body className="min-h-full flex flex-col bg-gray-50">
        <header className="bg-blue-700 shadow-sm">
          <div className="mx-auto max-w-4xl px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <h1 className="text-xl font-bold text-white tracking-tight">Property Finder</h1>
            <p className="text-sm text-blue-200">Pretoria East &middot; 12 suburbs</p>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
