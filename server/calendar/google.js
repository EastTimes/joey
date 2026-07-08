// Google Calendar read-only: which attendees Me has already invited recently.
// Reuses OAuth token from the calendar/ project when present.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { google } from 'googleapis';
import { followupContextDays } from '../lib/followupContext.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

let cache = null; // { fetchedAt, emails: Set<string>, error: string|null }

function calendarDir() {
  return process.env.JOEY_GOOGLE_CALENDAR_DIR || path.join(os.homedir(), 'calendar');
}

function tokenPath() {
  return process.env.JOEY_GOOGLE_TOKEN_FILE || path.join(calendarDir(), 'token.json');
}

function credentialsPath() {
  return process.env.JOEY_GOOGLE_CREDENTIALS_FILE || path.join(calendarDir(), 'credentials.json');
}

function userEmail() {
  return (process.env.JOEY_GOOGLE_USER_EMAIL || '').trim().toLowerCase();
}

function calendarId() {
  return process.env.JOEY_GOOGLE_CALENDAR_ID || 'primary';
}

function cacheTtlMs() {
  const v = Number(process.env.JOEY_GOOGLE_CACHE_MINUTES);
  return (Number.isFinite(v) && v > 0 ? v : 15) * 60_000;
}

export function calendarConfigured() {
  return !!(userEmail() && fs.existsSync(tokenPath()) && fs.existsSync(credentialsPath()));
}

export function calendarStatus() {
  return {
    configured: calendarConfigured(),
    connected: !!(cache && !cache.error && cache.emails),
    attendeeCount: cache?.emails?.size ?? 0,
    lastFetchedAt: cache?.fetchedAt ?? null,
    error: cache?.error ?? null,
  };
}

function loadOAuthClient() {
  const creds = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  const block = creds.installed || creds.web;
  if (!block) throw new Error('credentials.json missing installed/web block');
  const client = new google.auth.OAuth2(block.client_id, block.client_secret, block.redirect_uris?.[0]);
  const token = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'));
  client.setCredentials(token);
  return client;
}

async function fetchInvitedEmails() {
  const me = userEmail();
  if (!me) throw new Error('JOEY_GOOGLE_USER_EMAIL not set');

  const auth = loadOAuthClient();
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