// Fetch helpers for the Joey API. Every chat guid is URL-encoded here, once.

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('network error — is the Joey server running?');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body (or empty); fall through to status handling
  }
  if (!res.ok) {
    if (body && body.error) throw new Error(body.error);
    if (res.status === 502 || res.status === 504) throw new Error('Joey server unreachable');
    throw new Error(`${res.status} ${res.statusText || 'request failed'}`);
  }
  return body;
}

function post(path, payload) {
  const options = { method: 'POST' };
  if (payload !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(payload);
  }
  return request(path, options);
}

export function getStatus() {
  return request('/api/status');
}

export function getChats(filter = 'inbox') {
  return request(`/api/chats?filter=${encodeURIComponent(filter)}`);
}

export function searchMessages(query, { limit = 50 } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return request(`/api/search?${params}`);
}

export function getMessages(guid, { limit = 60, before = null } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before != null) params.set('before', String(before));
  return request(`/api/chats/${encodeURIComponent(guid)}/messages?${params}`);
}

export function sendMessage(guid, text, draftId = null) {
  const payload = draftId != null ? { text, draftId } : { text };
  return post(`/api/chats/${encodeURIComponent(guid)}/send`, payload);
}

export function sendDirectMessage(target, text) {
  return post('/api/compose/send', { target, text });
}

export function resolveRecipient(target) {
  const params = new URLSearchParams({ target });
  return request(`/api/recipient/resolve?${params}`);
}

export function saveContact(contact) {
  return post('/api/contacts/upsert', contact);
}

export function archiveChat(guid) {
  return post(`/api/chats/${encodeURIComponent(guid)}/archive`);
}

export function unarchiveChat(guid) {
  return post(`/api/chats/${encodeURIComponent(guid)}/unarchive`);
}

export function requestDraft(guid) {
  return post(`/api/chats/${encodeURIComponent(guid)}/draft`);
}

export function refreshTriage() {
  return post('/api/triage/refresh');
}

export function refreshFollowups() {
  return post('/api/followups/refresh');
}

export function dismissFollowup(guid, kind, snoozeHours = null) {
  const payload = { kind };
  if (snoozeHours != null) payload.snoozeHours = snoozeHours;
  return post(`/api/chats/${encodeURIComponent(guid)}/dismiss-followup`, payload);
}

export function disconnectCalendar() {
  return post('/api/calendar/disconnect');
}

export function getCalendarSetup() {
  return request('/api/calendar/setup');
}

export function saveCalendarCredentials(clientId, clientSecret) {
  return post('/api/calendar/credentials', { clientId, clientSecret });
}
