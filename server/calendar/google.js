// Google Calendar read-only + in-app OAuth sign-in.
// Credentials: JOEY_GOOGLE_CLIENT_ID/SECRET env vars (public installs) or ~/.joey/google-credentials.json.
// Tokens: stored in joey.db after user clicks "Sign in with Google".

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { google } from 'googleapis';
import { followupContextDays } from '../lib/followupContext.js';
import { getGoogleAuth, setGoogleAuth, clearGoogleAuth } from '../db/appdb.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const STATE_TTL_MS = 10 * 60_000;
const oauthStates = new Map(); // state -> issuedAt

let cache = null; // { fetchedAt, emails: Set<string>, error: string|null }
let legacyMigrated = false;

function joeyDir() {
  return process.env.JOEY_DATA_DIR || path.join(os.homedir(), '.joey');
}

function legacyCalendarDir() {
  return process.env.JOEY_GOOGLE_CALENDAR_DIR || path.join(os.homedir(), 'calendar');
}

function credentialsFilePath() {
  if (process.env.JOEY_GOOGLE_CREDENTIALS_FILE) return process.env.JOEY_GOOGLE_CREDENTIALS_FILE;
  const inJoey = path.join(joeyDir(), 'google-credentials.json');
  if (fs.existsSync(inJoey)) return inJoey;
  const legacy = path.join(legacyCalendarDir(), 'credentials.json');
  if (fs.existsSync(legacy)) return legacy;
  return inJoey;
}

function redirectUri() {
  const port = Number(process.env.JOEY_PORT || 3456);
  return `http://127.0.0.1:${port}/api/calendar/callback`;
}

function calendarId() {
  return process.env.JOEY_GOOGLE_CALENDAR_ID || 'primary';
}

function cacheTtlMs() {
  const v = Number(process.env.JOEY_GOOGLE_CACHE_MINUTES);
  return (Number.isFinite(v) && v > 0 ? v : 15) * 60_000;
}

function envCredentials() {
  const clientId = (process.env.JOEY_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.JOEY_GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return { client_id: clientId, client_secret: clientSecret };
}

/** OAuth client id/secret available (env vars or saved credentials file). */
export function hasGoogleCredentials() {
  if (envCredentials()) return true;
  const p = credentialsFilePath();
  if (!fs.existsSync(p)) return false;
  try {
    const block = JSON.parse(fs.readFileSync(p, 'utf8')).installed || JSON.parse(fs.readFileSync(p, 'utf8')).web;
    return !!(block?.client_id && block?.client_secret);
  } catch {
    return false;
  }
}

function readCredentialsBlock() {
  const fromEnv = envCredentials();
  if (fromEnv) return fromEnv;

  const p = credentialsFilePath();
  if (!fs.existsSync(p)) {
    throw new Error(
      'Google OAuth not configured — set JOEY_GOOGLE_CLIENT_ID and JOEY_GOOGLE_CLIENT_SECRET, or save credentials in ~/.joey'
    );
  }
  const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
  const block = creds.installed || creds.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error('credentials file missing client_id / client_secret');
  }
  return block;
}

function migrateLegacyTokenFiles() {
  if (legacyMigrated) return;
  legacyMigrated = true;
  if (getGoogleAuth()) return;

  const tokenPath = path.join(joeyDir(), 'google-token.json');
  const accountPath = path.join(joeyDir(), 'google-account.json');
  if (!fs.existsSync(tokenPath)) return;

  try {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    let email = (process.env.JOEY_GOOGLE_USER_EMAIL || '').trim().toLowerCase();
    if (fs.existsSync(accountPath)) {
      const acc = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
      if (acc.email) email = String(acc.email).trim().toLowerCase();
    }
    if (email && tokens) {
      setGoogleAuth({ email, tokens });
      for (const p of [tokenPath, accountPath]) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore corrupt legacy files
  }
}

function userEmail() {
  migrateLegacyTokenFiles();
  return getGoogleAuth()?.email ?? null;
}

export function calendarConfigured() {
  migrateLegacyTokenFiles();
  return hasGoogleCredentials() && !!getGoogleAuth()?.tokens;
}

export function calendarStatus() {
  migrateLegacyTokenFiles();
  const auth = getGoogleAuth();
  const credsFromEnv = !!envCredentials();
  return {
    oauthReady: hasGoogleCredentials(),
    credentialsFromEnv: credsFromEnv,
    connected: !!(auth?.tokens && auth?.email),
    configured: calendarConfigured(),
    email: auth?.email ?? null,
    attendeeCount: cache?.emails?.size ?? 0,
    lastFetchedAt: cache?.fetchedAt ?? null,
    error: cache?.error ?? null,
  };
}

function persistTokens(email, tokens) {
  const existing = getGoogleAuth();
  setGoogleAuth({
    email: email || existing?.email,
    tokens: { ...(existing?.tokens || {}), ...tokens },
  });
}

export function createOAuthClient() {
  const block = readCredentialsBlock();
  const client = new google.auth.OAuth2(block.client_id, block.client_secret, redirectUri());

  migrateLegacyTokenFiles();
  const auth = getGoogleAuth();
  if (auth?.tokens) client.setCredentials(auth.tokens);

  client.on('tokens', (tokens) => {
    const email = userEmail();
    if (email) persistTokens(email, tokens);
  });

  return client;
}

function issueOAuthState() {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());
  // prune stale
  for (const [s, t] of oauthStates) {
    if (Date.now() - t > STATE_TTL_MS) oauthStates.delete(s);
  }
  return state;
}

export function validateOAuthState(state) {
  if (!state || typeof state !== 'string') throw new Error('missing OAuth state');
  const issued = oauthStates.get(state);
  oauthStates.delete(state);
  if (!issued || Date.now() - issued > STATE_TTL_MS) {
    throw new Error('OAuth state expired — try signing in again');
  }
}

export function getCalendarAuthUrl() {
  if (!hasGoogleCredentials()) {
    throw new Error('Google OAuth not configured on this Joey install');
  }
  const client = createOAuthClient();
  const state = issueOAuthState();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: true,
    state,
  });
}

export async function completeCalendarOAuth(code, state) {
  validateOAuthState(state);
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error('Google did not return an email address');

  setGoogleAuth({ email: data.email, tokens });
  cache = null;
  return data.email;
}

export function disconnectCalendar() {
  clearGoogleAuth();
  cache = null;
}

async function fetchInvitedEmails() {
  const me = userEmail();
  if (!me) throw new Error('Google account not connected');

  const auth = createOAuthClient();
  const cal = google.calendar({ version: 'v3', auth });

  const lookbackDays = Math.max(followupContextDays(), 14);
  const aheadDays = Number(process.env.JOEY_GOOGLE_LOOKAHEAD_DAYS) || 30;

  const timeMin = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + aheadDays * 86_400_000).toISOString();

  const emails = new Set();
  let pageToken;

  do {
    const res = await cal.events.list({
      calendarId: calendarId(),
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });

    for (const event of res.data.items || []) {
      const organizer = (event.organizer?.email || '').toLowerCase();
      const iOrganized = event.organizer?.self || organizer === me;
      if (!iOrganized) continue;

      for (const att of event.attendees || []) {
        const email = (att.email || '').toLowerCase();
        if (!email || email === me) continue;
        if (att.resource) continue;
        if (att.responseStatus === 'declined') continue;
        emails.add(email);
      }
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return emails;
}

/** Cached set of attendee emails Me has invited on recent/future events. */
export async function getInvitedAttendeeEmails({ force = false } = {}) {
  if (!calendarConfigured()) return null;

  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < cacheTtlMs() && !cache.error) {
    return cache.emails;
  }

  try {
    const emails = await fetchInvitedEmails();
    cache = { fetchedAt: now, emails, error: null };
    return emails;
  } catch (err) {
    cache = { fetchedAt: now, emails: cache?.emails ?? null, error: err?.message || String(err) };
    console.warn(`[calendar] ${cache.error}`);
    return cache.emails;
  }
}

export function hasInvitedEmail(emails, candidate) {
  if (!emails || !candidate) return false;
  return emails.has(String(candidate).trim().toLowerCase());
}