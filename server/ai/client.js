import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import '../lib/env.js';

let client = null;

export function anthropicAvailable() {
  return (
    !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) ||
    fs.existsSync(path.join(os.homedir(), '.config', 'anthropic'))
  );
}

export function geminiAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

export function aiAvailable() {
  return anthropicAvailable() || geminiAvailable();
}

// Lazily-created zero-arg singleton; null when no credential source exists.
export function getClient() {
  if (!anthropicAvailable()) return null;
  if (!client) client = new Anthropic();
  return client;
}

export function classificationProvider(kind = 'triage') {
  const key = kind === 'followup' ? 'JOEY_FOLLOWUP_PROVIDER' : 'JOEY_TRIAGE_PROVIDER';
  const configured = (process.env[key] || '').trim().toLowerCase();
  if (configured) return configured;
  return geminiAvailable() ? 'gemini' : 'anthropic';
}

async function callGeminiJson({ model, system, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${system}\n\nReturn only valid JSON.\n\n${prompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const body = await resp.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = await resp.text().catch(() => '');
    }
    throw new Error(`Gemini API error (${model}): ${resp.status} ${detail || resp.statusText}`);
  }

  return await resp.json();
}

export async function generateGeminiJson({ model = GEMINI_MODEL, fallbackModel = GEMINI_FALLBACK_MODEL, system, prompt }) {
  if (!geminiAvailable()) throw new Error('Gemini unavailable');

  let data;
  try {
    data = await callGeminiJson({ model, system, prompt });
  } catch (err) {
    if (!fallbackModel || fallbackModel === model) throw err;
    console.warn(`[ai] ${err.message}; retrying with ${fallbackModel}`);
    data = await callGeminiJson({ model: fallbackModel, system, prompt });
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned no text');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

export const DRAFT_MODEL = process.env.JOEY_DRAFT_MODEL || 'claude-opus-4-8';
export const TRIAGE_MODEL = process.env.JOEY_TRIAGE_MODEL || 'claude-opus-4-8';
export const FOLLOWUP_MODEL = process.env.JOEY_FOLLOWUP_MODEL || process.env.JOEY_TRIAGE_MODEL || 'claude-opus-4-8';
export const GEMINI_MODEL = process.env.JOEY_GEMINI_MODEL || 'gemini-2.5-flash-lite';
export const GEMINI_FALLBACK_MODEL = process.env.JOEY_GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';
