import {
  aiAvailable,
  classificationProvider,
  generateGeminiJson,
  getClient,
  TRIAGE_MODEL,
  GEMINI_MODEL,
} from './client.js';

const CHUNK_SIZE = 25;

const TRIAGE_SYSTEM = [
  'You classify incoming text messages for a productivity inbox.',
  'A message is time-sensitive when it needs a response or action soon:',
  'direct questions awaiting an answer, plans in motion being coordinated,',
  'explicit deadlines, meeting or travel logistics, anything expiring today or tomorrow.',
  'NOT time-sensitive: reactions, FYI chatter, newsletters, marketing blasts, pleasantries.',
  'For each numbered message return one result with its index, time_sensitive (boolean),',
  'reason (8 words or fewer), and deadline — a short human-readable time like',
  '"today 5pm" — or null when there is none.',
].join(' ');

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'time_sensitive', 'reason', 'deadline'],
        properties: {
          index: { type: 'integer' },
          time_sensitive: { type: 'boolean' },
          reason: { type: 'string' },
          deadline: { type: ['string', 'null'] },
        },
      },
    },
  },
};

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
      const lines = [`[${idx}] Chat: ${item.chatName} | Received: ${humanizeAge(item.dateMs)}`];
      if (item.contextText) lines.push(`Context: ${item.contextText}`);
      lines.push(`Message: ${item.text}`);
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
    system: `${TRIAGE_SYSTEM} JSON shape: {"results":[{"index":0,"time_sensitive":false,"reason":"short reason","deadline":null}]}`,
    prompt: formatChunk(chunk),
  });
  return parsed.results || [];
}

async function classifyWithAnthropic(client, chunk) {
  let resp;
  try {
    resp = await client.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: TRIAGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: formatChunk(chunk) }],
      output_config: { format: { type: 'json_schema', schema: TRIAGE_SCHEMA } },
    });
  } catch (err) {
    throw apiError(err);
  }

  if (resp.stop_reason === 'refusal') throw new Error('triage refused');
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('triage returned no text');

  try {
    return JSON.parse(textBlock.text).results || [];
  } catch {
    throw new Error('triage returned invalid JSON');
  }
}

export async function classifyBatch(items) {
  const results = new Map();
  if (!items || items.length === 0) return results;
  if (!aiAvailable()) throw new Error('AI unavailable');
  const provider = classificationProvider('triage');
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
      results.set(item.guid, {
        timeSensitive: r.time_sensitive,
        reason: r.reason,
        deadline: r.deadline ?? null,
      });
    }
  }

  return results;
}
