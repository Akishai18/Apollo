import { TICKER } from "@/lib/mock";

/*
  A live band of recent verdicts scrolling past — proof the engine is busy and
  honest (plenty of REJECTEDs in the mix). On-brand personality, not decoration.
*/
export function VerdictTicker() {
  const items = [...TICKER, ...TICKER]; // duplicated for a seamless loop

  return (
    <div className="marquee-pause relative overflow-hidden border-y border-line bg-bg-soft/70 py-3.5 backdrop-blur-sm">
      <div className="marquee-track flex w-max gap-3">
        {items.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-1.5 font-mono text-xs"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${v.passed ? "bg-pass" : "bg-reject"}`} />
            <span className="text-text-dim">{v.name}</span>
            <span className={v.passed ? "text-pass" : "text-reject"}>
              {v.passed ? "PASS" : "REJECTED"}
            </span>
            <span className="text-faint">· {v.note}</span>
          </span>
        ))}
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-bg-soft to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-bg-soft to-transparent" />
    </div>
  );
}
