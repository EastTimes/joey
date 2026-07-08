// Match iMessage chats to Google Calendar invites already sent.

import { emailsForHandle } from '../imessage/contacts.js';
import { getInvitedAttendeeEmails, hasInvitedEmail } from '../calendar/google.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function isEmail(s) {
  return typeof s === 'string' && s.includes('@');
}

/** Collect email addresses that might identify this chat's counterpart. */
export function candidateEmailsForChat(chat, messages = []) {
  const out = new Set();

  const add = (v) => {
    if (isEmail(v)) out.add(v.trim().toLowerCase());
  };

  add(chat.chatIdentifier);
  for (const p of chat.participants || []) {
    add(p);
    for (const e of emailsForHandle(p)) out.add(e);
  }

  for (const m of messages) {
    if (!m.text) continue;
    for (const match of m.text.match(EMAIL_RE) || []) add(match);
    if (m.senderId) {
      add(m.senderId);
      for (const e of emailsForHandle(m.senderId)) out.add(e);
    }
  }

  return [...out];
}

export async function chatHasCalendarInvite(chat, messages = []) {
  const invited = await getInvitedAttendeeEmails();
  if (!invited) return false;

  const candidates = candidateEmailsForChat(chat, messages);
  return candidates.some((e) => hasInvitedEmail(invited, e));
}