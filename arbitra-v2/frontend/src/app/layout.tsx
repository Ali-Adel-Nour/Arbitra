import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arbitra V2 | AI Escrow",
  description: "Hardware-backed AI Escrow on Monad Testnet",
};

import Link from "next/link";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${grotesk.variable} ${jetbrainsMono.variable} antialiased bg-base text-primary`}>
        <nav className="border-b border-rule bg-panel-1 px-8 py-4 flex justify-between items-center">
          <div className="font-bold text-hi text-record">ARBITRA V2</div>
          <div className="flex gap-6">
            <Link href="/buyer" className="text-muted hover:text-hi transition-colors text-caption uppercase tracking-wider">Buyer View</Link>
            <Link href="/oracle" className="text-muted hover:text-hi transition-colors text-caption uppercase tracking-wider">Oracle View</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
