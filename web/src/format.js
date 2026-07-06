// Time & text formatting helpers.

// Sidebar timestamps, Messages-style: time today, "Yesterday", weekday
// within the week, then a short numeric date.
export function relTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (ms >= startOfToday.getTime()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (ms >= startOfToday.getTime() - 86_400_000) return 'Yesterday';
  if (ms >= startOfToday.getTime() - 6 * 86_400_000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function timeOfDay(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function dayLabel(ms) {
  const d = new Date(ms);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const that = new Date(ms);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((midnight - that) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function compactCount(n) {
  if (n == null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
