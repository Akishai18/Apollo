/*
  Apollo mark: an ascending double-peak with a gem at the apex. Same craft as a
  fine emblem — clean angular strokes, gem-tipped vertex, luminous gradient — but
  its own symbol: an upward peak (ascent / launch / Apollo), not a crown.
*/

export function ApolloMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ filter: "drop-shadow(0 0 6px rgba(95,110,255,0.35))" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="apollo-grad" x1="12" y1="19" x2="12" y2="3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5161ff" />
          <stop offset="1" stopColor="#6fe6dd" />
        </linearGradient>
      </defs>

      {/* outer peak */}
      <path
        d="M3.4 18 L12 5 L20.6 18"
        stroke="url(#apollo-grad)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* inner echo peak */}
      <path
        d="M8 18 L12 11.4 L16 18"
        stroke="url(#apollo-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      {/* apex gem */}
      <path d="M12 2.6 L13.7 5 L12 7.4 L10.3 5 Z" fill="url(#apollo-grad)" />
      {/* base gem tips */}
      <circle cx="3.4" cy="18" r="1.05" fill="url(#apollo-grad)" />
      <circle cx="20.6" cy="18" r="1.05" fill="url(#apollo-grad)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`group inline-flex items-center gap-2 text-text ${className}`}>
      <ApolloMark className="h-7 w-7 transition-transform duration-300 group-hover:-translate-y-0.5" />
      <span className="font-display text-[1.35rem] font-semibold tracking-[-0.02em]">Apollo</span>
    </span>
  );
}
