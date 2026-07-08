import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

let client = null;

export function aiAvailable() {
  return (
    !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) ||
    fs.existsSync(path.join(os.homedir(), '.config', 'anthropic'))
  );
}

// Lazily-created zero-arg singleton; null when no credential source exists.
export function getClient() {
  if (!aiAvailable()) return null;
  if (!client) client = new Anthropic();
  return client;
}

export const DRAFT_MODEL = process.env.JOEY_DRAFT_MODEL || 'claude-opus-4-8';
export const TRIAGE_MODEL = process.env.JOEY_TRIAGE_MODEL || 'claude-opus-4-8';
export const FOLLOWUP_MODEL = process.env.JOEY_FOLLOWUP_MODEL || process.env.JOEY_TRIAGE_MODEL || 'claude-opus-4-8';
