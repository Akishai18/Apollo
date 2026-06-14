import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "accent" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium cursor-pointer " +
  "transition-[background-color,transform] duration-200 focusable select-none whitespace-nowrap " +
  "active:translate-y-px";

const variants: Record<Variant, string> = {
  primary: "bg-white text-bg hover:bg-white/90", // the bright pill
  accent: "bg-accent text-accent-ink hover:bg-accent-hi",
  outline: "border border-line-strong bg-white/[0.03] text-text hover:bg-white/[0.08]",
  ghost: "text-text-dim hover:bg-white/[0.06] hover:text-text",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-12 px-6 text-base",
};

type ButtonLinkProps = {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </Link>
  );
}
