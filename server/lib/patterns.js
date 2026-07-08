// Lightweight regex helpers for follow-up candidate pre-filtering.
// Full classification is done by AI (server/ai/followups.js).

const INTRO = [
  /\bmeet\s+\w+/i,
  /\bconnecting\s+you\s+with\b/i,
  /\bi['']?d\s+like\s+to\s+introduce\b/i,
  /\bintroduc(e|ing)\s+(you|y'all)\b/i,
  /\bputting\s+you\s+(two\s+)?in\s+touch\b/i,
  /\blooping\s+in\b/i,
  /\badding\s+\w+\s+to\s+(this|the)\b/i,
  /\bwanted\s+to\s+connect\s+you\b/i,
  /\byou\s+two\s+should\s+(meet|connect|chat)\b/i,
];

const SCHEDULING = [
  /\bhow\s+about\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bhow\s+about\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
  /\blet['']?s\s+do\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\blet['']?s\s+(do|say)\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  /\bdoes\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(at\s+)?\d{1,2}\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+\d{1,2}\b/i,
  /\btomorrow\s+at\s+\d{1,2}\b/i,
  /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bhow\s+about\s+tomorrow\b/i,
  /\blet['']?s\s+meet\s+(at|on|this|next)\b/i,
  /\bcan\s+you\s+do\s+\d{1,2}\s*(am|pm)\b/i,
  /\bschedule\s+(for|on)\b/i,
  /\bwhen\s+are\s+you\s+(free|available)\b/i,
  /\bwhen\s+works\s+for\s+you\b/i,
];

const CLOSERS = /^(ok|okay|k|thanks|thank you|thx|ty|sounds good|perfect|great|lol|lmao|haha|np|no problem|got it|cool|yep|yeah|yes|👍|🙏|❤️)[\s!.?]*$/i;

export function matchesIntro(text) {
  return INTRO.some((p) => p.test(text));
}

export function matchesScheduling(text) {
  return SCHEDULING.some((p) => p.test(text));
}

export function isConversationCloser(text) {
  const t = (text || '').trim();
  if (!t || t.length > 40) return false;
  return CLOSERS.test(t);
}