// How far back follow-up detection looks. Older messages are ignored.

const MS_PER_DAY = 86_400_000;

export function followupContextDays() {
  const v = Number(process.env.JOEY_FOLLOWUP_CONTEXT_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 7;
}

/** Keep only messages within the last N days (messages assumed ascending by rowid). */
export function recentMessages(messages, days = followupContextDays()) {
  const cutoff = Date.now() - days * MS_PER_DAY;
  return (messages || []).filter((m) => m.dateMs >= cutoff);
}