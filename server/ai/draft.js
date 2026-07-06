import { aiAvailable, getClient, DRAFT_MODEL } from './client.js';

const STABLE_INSTRUCTIONS = [
  "You draft the user's next text message reply in an iMessage conversation.",
  'Output ONLY the message text — no quotes, no preamble, no explanations.',
  "Mirror the user's authentic texting voice: match their typical message",
  'length, capitalization, punctuation, slang, and emoji frequency exactly as',
  'evidenced by the style examples. Keep it natural and brief, like a real text.',
].join(' ');

function buildStyleAndEditBlock(styleExamples = [], editPairs = []) {
  const parts = ['Recent messages the user actually sent (style reference):'];
  parts.push(
    styleExamples.length
      ? styleExamples.map((s) => `- ${s}`).join('\n')
      : '(none available)'
  );
  parts.push('');
  parts.push('Past AI drafts and what the user changed them to — learn from these deltas:');
  parts.push(
    editPairs.length
      ? editPairs.map((p) => `DRAFT: ${p.draft}\nUSER SENT: ${p.final}`).join('\n\n')
      : '(none yet)'
  );
  return parts.join('\n');
}

function buildTranscriptPrompt({ chatName, isGroup, messages = [] }) {
  const lines = [`Chat: ${chatName || 'Unknown'}${isGroup ? ' (group chat)' : ''}`, ''];
  lines.push('Conversation (oldest first):');
  for (const m of messages) {
    const sender = m.isFromMe ? 'Me' : m.senderName || m.senderId || 'Them';
    lines.push(`[${sender}]: ${m.text}`);
  }
  lines.push('');
  lines.push("Draft the user's next reply to this conversation.");
  return lines.join('\n');
}

function stripSurroundingQuotes(text) {
  const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function apiError(err) {
  const status = err?.status ? `${err.status} ` : '';
  return new Error(`Anthropic API error: ${status}${err?.message || err}`);
}

// Adaptive thinking exists on Opus 4.6+/Sonnet 4.6+/Sonnet 5/Fable 5 — not Haiku.
const ADAPTIVE_THINKING_MODELS = /^claude-(opus-4-[6-9]|sonnet-4-[6-9]|sonnet-5|fable-5|mythos-5)/;

function thinkingConfig(model) {
  return ADAPTIVE_THINKING_MODELS.test(model) ? { thinking: { type: 'adaptive' } } : {};
}

export async function generateDraft({ chatName, isGroup, messages, styleExamples, editPairs }) {
  if (!aiAvailable()) throw new Error('AI unavailable');
  const client = getClient();

  let resp;
  try {
    resp = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      ...thinkingConfig(DRAFT_MODEL),
      system: [
        { type: 'text', text: STABLE_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: buildStyleAndEditBlock(styleExamples, editPairs),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: buildTranscriptPrompt({ chatName, isGroup, messages }) },
      ],
    });
  } catch (err) {
    throw apiError(err);
  }

  if (resp.stop_reason === 'refusal') throw new Error('draft refused');

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return stripSurroundingQuotes(text);
}
