// Tiny inline icons — SF-Symbols-flavored, one visual voice, no icon library.

function Base({ size = 14, className = '', children, filled = false, strokeWidth = 1.5 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CalendarIcon({ size = 12 }) {
  return (
    <Base size={size}>
      <rect x="2.5" y="3.5" width="11" height="10.5" rx="1.25" />
      <path d="M2.5 6.75h11" />
      <path d="M5.25 2.25v2.5M10.75 2.25v2.5" />
    </Base>
  );
}

export function ReplyArrowIcon({ size = 12 }) {
  return (
    <Base size={size}>
      <path d="M4.5 4.25 1.75 8l2.75 3.75" />
      <path d="M1.75 8h8.5a3.25 3.25 0 0 1 0 6.5H8.5" />
    </Base>
  );
}

export function DismissIcon({ size = 12 }) {
  return (
    <Base size={size} strokeWidth={1.8}>
      <path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5" />
    </Base>
  );
}

export function FlagIcon({ size = 12 }) {
  return (
    <Base size={size} filled>
      <path d="M3.2 1.2c.44 0 .8.36.8.8v.4c2.6-1.3 4.4 1.3 8 .2.4-.12.8.18.8.6v6c0 .34-.2.64-.53.74-3.6 1.1-5.5-1.5-8.27-.3v4.54a.8.8 0 0 1-1.6 0V2c0-.44.36-.8.8-.8z" />
    </Base>
  );
}

export function ArchiveIcon({ size = 14 }) {
  return (
    <Base size={size}>
      <rect x="1.75" y="2.5" width="12.5" height="3.25" rx="0.75" />
      <path d="M3 6.25v6.5A1.25 1.25 0 0 0 4.25 14h7.5A1.25 1.25 0 0 0 13 12.75v-6.5" />
      <path d="M6.25 9h3.5" />
    </Base>
  );
}

export function UnarchiveIcon({ size = 14 }) {
  return (
    <Base size={size}>
      <rect x="1.75" y="2.5" width="12.5" height="3.25" rx="0.75" />
      <path d="M3 6.25v6.5A1.25 1.25 0 0 0 4.25 14h7.5A1.25 1.25 0 0 0 13 12.75v-6.5" />
      <path d="M8 12.25V8.25" />
      <path d="M6.25 10 8 8.25 9.75 10" />
    </Base>
  );
}

export function RefreshIcon({ size = 13, spinning = false }) {
  return (
    <Base size={size} className={spinning ? 'spin' : ''}>
      <path d="M13.25 8A5.25 5.25 0 1 1 11.6 4.2" />
      <path d="M11.9 1.6v2.9h-2.9" />
    </Base>
  );
}

export function SparkIcon({ size = 13 }) {
  return (
    <Base size={size} filled>
      <path d="M8 1.2c.5 3.1 1.9 4.5 5 5-3.1.5-4.5 1.9-5 5-.5-3.1-1.9-4.5-5-5 3.1-.5 4.5-1.9 5-5z" />
      <path d="M13 10.6c.24 1.5.9 2.16 2.4 2.4-1.5.24-2.16.9-2.4 2.4-.24-1.5-.9-2.16-2.4-2.4 1.5-.24 2.16-.9 2.4-2.4z" transform="translate(-1.4 -1.2) scale(0.9)" />
    </Base>
  );
}

export function BackIcon({ size = 13 }) {
  return (
    <Base size={size}>
      <path d="M9.75 3.5 5.25 8l4.5 4.5" />
    </Base>
  );
}

export function ChevronUpIcon({ size = 12 }) {
  return (
    <Base size={size}>
      <path d="M3.5 10 8 5.5 12.5 10" />
    </Base>
  );
}

// Send arrow — white ↑ inside the blue circle button.
export function ArrowUpIcon({ size = 14 }) {
  return (
    <Base size={size} strokeWidth={2.2}>
      <path d="M8 12.75V3.75" />
      <path d="M4.25 7.25 8 3.5l3.75 3.75" />
    </Base>
  );
}

// Single-person silhouette (avatar fallback when the name has no letters).
export function PersonIcon({ size = 20 }) {
  return (
    <Base size={size} filled>
      <circle cx="8" cy="5.4" r="2.8" />
      <path d="M8 9.2c-3.1 0-5.2 1.9-5.2 4.2 0 .5.4.9.9.9h8.6c.5 0 .9-.4.9-.9 0-2.3-2.1-4.2-5.2-4.2z" />
    </Base>
  );
}

// Two-person silhouette for group chats.
export function PeopleIcon({ size = 20 }) {
  return (
    <Base size={size} filled>
      <circle cx="5.8" cy="5.8" r="2.5" />
      <path d="M5.8 9.1c-2.8 0-4.7 1.7-4.7 3.8 0 .4.3.8.8.8h7.8c.5 0 .8-.4.8-.8 0-2.1-1.9-3.8-4.7-3.8z" />
      <circle cx="11.3" cy="5.4" r="2.1" opacity="0.75" />
      <path d="M11.3 8.4c-.6 0-1.2.1-1.7.3 1.5.9 2.5 2.3 2.5 4.1v.1h2.2c.4 0 .8-.3.8-.8 0-1.9-1.6-3.7-3.8-3.7z" opacity="0.75" />
    </Base>
  );
}

// Indeterminate spinner (drafting state).
export function SpinnerIcon({ size = 14 }) {
  return (
    <Base size={size} className="spin" strokeWidth={1.8}>
      <path d="M13.25 8A5.25 5.25 0 1 1 8 2.75" />
    </Base>
  );
}
