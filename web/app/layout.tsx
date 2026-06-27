import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Space_Grotesk,
} from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

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
});

const appSans = IBM_Plex_Sans({
  variable: "--ff-app-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const appMono = IBM_Plex_Mono({
  variable: "--ff-app-mono",
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
      className={`${display.variable} ${sans.variable} ${mono.variable} ${appSans.variable} ${appMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg text-text-dim font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
