import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display: geometric, a little character. Body: neutral workhorse.
// Mono: every number, param, and verdict — the instrument texture.
const display = Space_Grotesk({
  variable: "--ff-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sans = Inter({
  variable: "--ff-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Apollo — trading strategies, written in plain English",
  description:
    "Describe a trading strategy in plain English. Apollo builds it, backtests it without lookahead bias, and tells you the truth about whether it holds up.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg text-text-dim font-sans">{children}</body>
    </html>
  );
}
