"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Lock, User, ArrowRight, ShieldCheck, Eye, GitBranch } from "lucide-react";
import { ApolloMark, Wordmark } from "@/components/logo";
import { FadeUp } from "@/components/app/page-frame";

type Mode = "login" | "signup";

const PROOFS = [
  { icon: Eye, label: "Lookahead-proof by construction" },
  { icon: ShieldCheck, label: "Walk-forward overfit gate" },
  { icon: GitBranch, label: "Every strategy sandboxed" },
];

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isLogin = mode === "login";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (isLogin || name.trim().length > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Auth lands later — for now a valid-looking submit drops into the workspace.
    router.push("/app");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-bg-soft lg:block">
        <div className="aurora absolute inset-0 opacity-90" aria-hidden="true">
          <span />
        </div>
        <div className="grain absolute inset-0" aria-hidden="true" />
        <div className="vignette absolute inset-0" aria-hidden="true" />

        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="focusable w-fit rounded-sm" aria-label="Apollo home">
            <Wordmark />
          </Link>

          <div className="max-w-md">
            <ApolloMark className="mb-6 h-10 w-10" />
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight text-text">
              The validation layer
              <br />
              for trading strategies.
            </h2>
            <p className="mt-4 leading-relaxed text-muted">
              Describe a strategy in plain English. Apollo writes it, backtests it without
              lookahead bias, and tells you — honestly — whether it holds up.
            </p>

            <ul className="mt-8 flex flex-col gap-3">
              {PROOFS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm text-text-dim">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <Icon className="h-3.5 w-3.5 text-accent" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="font-mono text-[11px] text-faint">
            Trusted validation, not just generated code.
          </p>
        </div>
      </aside>

      {/* form panel */}
      <main className="relative flex items-center justify-center px-6 py-12">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden lg:hidden" aria-hidden="true">
          <div className="aurora absolute inset-0 opacity-60">
            <span />
          </div>
        </div>

        <FadeUp className="w-full max-w-sm">
          {/* compact brand for mobile */}
          <Link href="/" className="focusable mb-8 inline-flex lg:hidden" aria-label="Apollo home">
            <Wordmark />
          </Link>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            {isLogin ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {isLogin ? "Pick up where you left off." : "Start validating strategies in minutes."}
          </p>

          <button
            type="button"
            onClick={() => router.push("/app")}
            className="focusable mt-7 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line-strong bg-white/[0.03] text-sm font-medium text-text transition-colors hover:bg-white/[0.07]"
          >
            <GoogleMark /> Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            {!isLogin && (
              <AuthInput
                icon={User}
                type="text"
                placeholder="Full name"
                value={name}
                onChange={setName}
                autoFocus
              />
            )}
            <AuthInput
              icon={Mail}
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={setEmail}
              autoFocus={isLogin}
            />
            <AuthInput
              icon={Lock}
              type="password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
            />

            {isLogin && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="focusable rounded-sm text-xs text-muted transition-colors hover:text-text"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="accent-gradient focusable mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium text-accent-ink shadow-lg shadow-accent/25 transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLogin ? "Log in" : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {!isLogin && (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
              By continuing you agree to our Terms and Privacy Policy.
            </p>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            {isLogin ? "New to Apollo? " : "Already have an account? "}
            <Link
              href={isLogin ? "/signup" : "/login"}
              className="focusable rounded-sm font-medium text-accent transition-colors hover:text-accent-hi"
            >
              {isLogin ? "Create an account" : "Log in"}
            </Link>
          </p>

          <p className="mt-6 text-center font-mono text-[10px] text-faint/70">
            Auth isn&rsquo;t live yet — this drops you into the workspace.
          </p>
        </FadeUp>
      </main>
    </div>
  );
}

function AuthInput({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  icon: typeof Mail;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-bg/60 px-3.5 transition-colors focus-within:border-accent/50">
      <Icon className="h-4 w-4 shrink-0 text-faint" />
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}

/* Google "G" — inline so we don't pull in a brand-icon dependency. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
