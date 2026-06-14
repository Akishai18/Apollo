"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "./logo";
import { ButtonLink } from "./button";

const NAV = [
  { label: "How it works", href: "#how" },
  { label: "Validation", href: "#validation" },
  { label: "Examples", href: "#examples" },
];

export function SiteHeader() {
  // Transparent over the hero, then solidifies once you scroll.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled
          ? "border-b border-line/60 bg-bg/70 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="focusable rounded-sm" aria-label="Apollo home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group relative focusable rounded-sm py-1 text-sm text-muted transition-colors hover:text-text"
            >
              {item.label}
              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-accent transition-all duration-300 group-hover:w-full" />
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" variant="primary" size="sm">
            Start building
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
