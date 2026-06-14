import { Check, X } from "lucide-react";

/*
  The verdict artifact — Apollo's soul object. Every run ends in a plain PASS or
  REJECTED, always with a legible reason. Recurs across the product.
*/
export function VerdictStamp({
  passed,
  className = "",
}: {
  passed: boolean;
  className?: string;
}) {
  const tone = passed
    ? "text-pass bg-pass/10 border-pass/30"
    : "text-reject bg-reject/10 border-reject/30";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider ${tone} ${className}`}
    >
      {passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {passed ? "Pass" : "Rejected"}
    </span>
  );
}

type Tone = "text" | "accent" | "pass" | "reject" | "muted";

export function Metric({
  label,
  value,
  tone = "text",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  const valueColor: Record<Tone, string> = {
    text: "text-text",
    accent: "text-accent",
    pass: "text-pass",
    reject: "text-reject",
    muted: "text-muted",
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`nums text-lg font-semibold ${valueColor[tone]}`}>{value}</span>
    </div>
  );
}
