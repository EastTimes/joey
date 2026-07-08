import {
  aiAvailable,
  classificationProvider,
  generateGeminiJson,
  getClient,
  FOLLOWUP_MODEL,
  GEMINI_MODEL,
} from './client.js';
import { followupContextDays } from '../lib/followupContext.js';

const CHUNK_SIZE = 15; // smaller chunks — each item carries a transcript

const FOLLOWUP_SYSTEM = [
  'You classify text message threads for a productivity inbox follow-up queue.',
  'The user is "Me". Flag threads where Me should take action soon.',
  'Three follow-up kinds (use exactly these values, or null when no follow-up):',
  'gc_intro — group chat someone else created: they introduced people and Me never acknowledged.',
  'Never gc_intro when Me created the group (groupStartedByMe is noted in the input).',
  'awaiting_reply — Me asked a question or made a request; the other person never replied and Me may want to nudge.',
  'calendar_pending — a meeting time was agreed but Me never sent a calendar invite, zoom link, or similar.',
  'NOT a follow-up: normal back-and-forth, FYI messages, reactions, closed conversations,',
  'pleasantries already answered, stale threads from older history, or when the ball is',
  `clearly in their court. Each transcript covers only the last ${followupContextDays()} days —`,
  'judge follow-ups from that window alone; ignore anything older that is no longer active.',
  'For each thread return: needs_followup (boolean), kind (one of the three or null),',
  'reason (10 words or fewer, actionable).',
].join(' ');

const FOLLOWUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'needs_followup', 'kind', 'reason'],
        properties: {
          index: { type: 'integer' },
          needs_followup: { type: 'boolean' },
          // No enum here — Anthropic rejects enum + nullable union. Validated below.
          kind: { type: ['string', 'null'] },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const VALID_KINDS = new Set(['gc_intro', 'awaiting_reply', 'calendar_pending']);

function humanizeAge(dateMs) {
  const minutes = Math.round((Date.now() - dateMs) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatChunk(chunk) {
  return chunk
    .map((item, idx) => {
      const lines = [
        `[${idx}] Chat: ${item.chatName}${item.isGroup ? ' (group)' : ''}${item.groupStartedByMe ? ' [Me created group]' : ''}`,
        `Last activity: ${humanizeAge(item.lastDateMs)}`,
      ];
      if (item.transcript) lines.push(`Transcript:\n${item.transcript}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function apiError(err) {
  const status = err?.status ? `${err.status} ` : '';
  return new Error(`Anthropic API error: ${status}${err?.message || err}`);
}

async function classifyWithGemini(chunk) {
  const parsed = await generateGeminiJson({
    model: GEMINI_MODEL,
    system: `${FOLLOWUP_SYSTEM} JSON shape: {"results":[{"index":0,"needs_followup":false,"kind":null,"reason":"short reason"}]}`,
    prompt: formatChunk(chunk),
  });
  return parsed.results || [];
}

async function classifyWithAnthropic(client, chunk) {
  let resp;
  try {
    resp = await client.messages.create({
      model: FOLLOWUP_MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: FOLLOWUP_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: formatChunk(chunk) }],
      output_config: { format: { type: 'json_schema', schema: FOLLOWUP_SCHEMA } },
    });
  } catch (err) {
    throw apiError(err);
  }

  if (resp.stop_reason === 'refusal') throw new Error('followup classification refused');
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('followup classification returned no text');

  try {
    return JSON.parse(textBlock.text).results || [];
  } catch {
    throw new Error('followup classification returned invalid JSON');
  }
}

export async function classifyFollowups(items) {
  const results = new Map();
  if (!items || items.length === 0) return results;
  if (!aiAvailable()) throw new Error('AI unavailable');
  const provider = classificationProvider('followup');
  const client = provider === 'anthropic' ? getClient() : null;
  if (provider === 'anthropic' && !client) throw new Error('Anthropic unavailable');

  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE);
    const classified = provider === 'gemini'
      ? await classifyWithGemini(chunk)
      : await classifyWithAnthropic(client, chunk);

    for (const r of classified) {
      const item = chunk[r.index];
      if (!item) continue;
      const kind = r.needs_followup && VALID_KINDS.has(r.kind) ? r.kind : null;
      results.set(item.chatGuid, {
        needsFollowup: !!r.needs_followup && !!kind,
        kind,
        reason: r.reason || '',
        lastMessageRowid: item.lastMessageRowid,
      });
    }
  }

  return results;
}
