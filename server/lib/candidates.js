// Pre-filter inbox chats before sending them to the follow-up AI classifier.
// Keeps API cost down by skipping threads that can't match any follow-up kind.

import { matchesIntro, matchesScheduling, isConversationCloser } from './patterns.js';
import { recentMessages } from './followupContext.js';

const MS_PER_HOUR = 3_600_000;

function hoursSince(dateMs) {
  return (Date.now() - dateMs) / MS_PER_HOUR;
}

function minHours(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const MIN_AWAITING = () => minHours('JOEY_FOLLOWUP_MIN_HOURS', 24);
const MIN_GC_INTRO = () => minHours('JOEY_GC_INTRO_MIN_HOURS', 4);

export function isFollowupCandidate(chat, messages, { groupStartedByMe = false } = {}) {
  const recent = recentMessages(messages);
  if (recent.length === 0) return false;

  // GCs I created are my intros — never follow-up accountability.
  if (chat.isGroup && groupStartedByMe) return false;

  const lastRecent = recent[recent.length - 1];

  // Case 2: within the window, I spoke last and they haven't replied.
  if (lastRecent.isFromMe) {
    if (hoursSince(lastRecent.dateMs) < MIN_AWAITING()) return false;
    if (isConversationCloser(lastRecent.text)) return false;
    return true;
  }

  // Case 1: group intro — someone else spoke last in a group chat.
  if (chat.isGroup) {
    const hasIntro = recent.some((m) => !m.isFromMe && matchesIntro(m.text));
    const iReplied = recent.some((m) => m.isFromMe);
    if (hasIntro && !iReplied && hoursSince(lastRecent.dateMs) >= MIN_GC_INTRO()) return true;
    if (!iReplied && hoursSince(lastRecent.dateMs) >= MIN_GC_INTRO()) {
      const othersOnly = recent.filter((m) => !m.isFromMe);
      if (othersOnly.length >= 1 && recent.length <= 6) return true;
    }
  }

  // Case 3: scheduling thread in the recent window only.
  if (recent.some((m) => matchesScheduling(m.text))) return true;

  return false;
}