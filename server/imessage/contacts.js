// Best-effort contact name lookup from the local AddressBook (read-only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const byPhone = new Map(); // full normalized digits -> name
const byPhoneLast10 = new Map(); // last 10 digits -> name
const byEmail = new Map(); // lowercase email -> name
const emailsByPhone = new Map(); // normalized digits -> Set<lowercase email>
const emailsByPhoneLast10 = new Map();
let lastStats = { phones: 0, emails: 0, sources: 0, error: null };

function addressBookPaths() {
  const addressBookDir = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'AddressBook'
  );
  const paths = [];
  const rootDb = path.join(addressBookDir, 'AddressBook-v22.abcddb');
  if (fs.existsSync(rootDb)) paths.push({ label: 'AddressBook', dbPath: rootDb });

  const sourcesDir = path.join(addressBookDir, 'Sources');
  for (const entry of fs.readdirSync(sourcesDir)) {
    const dbPath = path.join(sourcesDir, entry, 'AddressBook-v22.abcddb');
    if (fs.existsSync(dbPath)) paths.push({ label: entry, dbPath });
  }
  return paths;
}

function displayName(row) {
  const name = [row.first, row.last]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ');
  return name || (row.org || '').trim() || null;
}

function addPhone(number, name) {
  const digits = String(number).replace(/\D/g, '');
  if (!digits) return;
  if (!byPhone.has(digits)) byPhone.set(digits, name);
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    if (!byPhoneLast10.has(last10)) byPhoneLast10.set(last10, name);
  }
}

function linkPhoneEmail(phone, email) {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || !email) return;
  if (!emailsByPhone.has(digits)) emailsByPhone.set(digits, new Set());
  emailsByPhone.get(digits).add(email);
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    if (!emailsByPhoneLast10.has(last10)) emailsByPhoneLast10.set(last10, new Set());
    emailsByPhoneLast10.get(last10).add(email);
  }
}

function loadSource(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const records = db
      .prepare(
        `SELECT r.Z_PK AS pk, r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZORGANIZATION AS org
         FROM ZABCDRECORD r`
      )
      .all();

    const phonesByPk = new Map();
    for (const row of db
      .prepare(
        `SELECT p.ZOWNER AS pk, p.ZFULLNUMBER AS value
         FROM ZABCDPHONENUMBER p WHERE p.ZFULLNUMBER IS NOT NULL`
      )
      .all()) {
      if (!phonesByPk.has(row.pk)) phonesByPk.set(row.pk, []);
      phonesByPk.get(row.pk).push(row.value);
    }

    const emailsByPk = new Map();
    for (const row of db
      .prepare(
        `SELECT e.ZOWNER AS pk, e.ZADDRESS AS value
         FROM ZABCDEMAILADDRESS e WHERE e.ZADDRESS IS NOT NULL`
      )
      .all()) {
      const email = String(row.value).trim().toLowerCase();
      if (!email) continue;
      if (!emailsByPk.has(row.pk)) emailsByPk.set(row.pk, []);
      emailsByPk.get(row.pk).push(email);
    }

    for (const rec of records) {
      const name = displayName(rec);
      const emails = emailsByPk.get(rec.pk) || [];
      const phones = phonesByPk.get(rec.pk) || [];

      for (const phone of phones) {
        if (name) addPhone(phone, name);
        for (const email of emails) linkPhoneEmail(phone, email);
      }
      for (const email of emails) {
        if (name && !byEmail.has(email)) byEmail.set(email, name);
      }
    }
  } finally {
    db.close();
  }
}

function contactsFromSource(source, dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const records = db
      .prepare(
        `SELECT r.Z_PK AS pk, r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZORGANIZATION AS org
         FROM ZABCDRECORD r`
      )
      .all();

    const phonesByPk = new Map();
    for (const row of db
      .prepare(
        `SELECT p.ZOWNER AS pk, p.ZFULLNUMBER AS value
         FROM ZABCDPHONENUMBER p WHERE p.ZFULLNUMBER IS NOT NULL`
      )
      .all()) {
      if (!phonesByPk.has(row.pk)) phonesByPk.set(row.pk, []);
      phonesByPk.get(row.pk).push(row.value);
    }

    const emailsByPk = new Map();
    for (const row of db
      .prepare(
        `SELECT e.ZOWNER AS pk, e.ZADDRESS AS value
         FROM ZABCDEMAILADDRESS e WHERE e.ZADDRESS IS NOT NULL`
      )
      .all()) {
      if (!emailsByPk.has(row.pk)) emailsByPk.set(row.pk, []);
      emailsByPk.get(row.pk).push(row.value);
    }

    return records.map((rec) => ({
      source,
      recordId: rec.pk,
      first: rec.first || '',
      last: rec.last || '',
      organization: rec.org || '',
      phones: phonesByPk.get(rec.pk) || [],
      emails: emailsByPk.get(rec.pk) || [],
    }));
  } finally {
    db.close();
  }
}

function csvCell(value) {
  const s = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function exportContactsCsv() {
  const rows = [];
  const errors = [];
  for (const { label, dbPath } of addressBookPaths()) {
    try {
      rows.push(...contactsFromSource(label, dbPath));
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  }

  const header = ['source', 'record_id', 'first_name', 'last_name', 'organization', 'phones', 'emails'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      row.source,
      row.recordId,
      row.first,
      row.last,
      row.organization,
      row.phones,
      row.emails,
    ].map(csvCell).join(','));
  }
  if (errors.length > 0) {
    console.warn(`[contacts] export skipped sources: ${errors.join('; ')}`);
  }
  return { csv: `${lines.join('\n')}\n`, count: rows.length, errors };
}

export function loadContacts() {
  byPhone.clear();
  byPhoneLast10.clear();
  byEmail.clear();
  emailsByPhone.clear();
  emailsByPhoneLast10.clear();
  let sources = 0;
  let error = null;

  try {
    for (const { label, dbPath } of addressBookPaths()) {
      try {
        loadSource(dbPath);
        sources += 1;
      } catch (err) {
        error = err.message;
        console.warn(`[contacts] skipping source ${label}: ${err.message}`);
      }
    }
  } catch (err) {
    error = err.message;
    console.warn(`[contacts] AddressBook unavailable: ${err.message}`);
  }

  lastStats = { phones: byPhone.size, emails: byEmail.size, sources, error };
  return lastStats;
}

export function contactsStatus() {
  return lastStats;
}

/** Emails from AddressBook linked to this phone handle (empty for email handles). */
export function emailsForHandle(handleId) {
  if (!handleId) return [];
  const id = String(handleId).trim();
  if (!id || id.includes('@')) return id.includes('@') ? [id.toLowerCase()] : [];
  const digits = id.replace(/\D/g, '');
  if (!digits) return [];
  const set =
    emailsByPhone.get(digits) ??
    (digits.length >= 10 ? emailsByPhoneLast10.get(digits.slice(-10)) : null);
  return set ? [...set] : [];
}

export function resolveName(handleId) {
  if (!handleId) return null;
  const id = String(handleId).trim();
  if (!id) return null;
  if (id.includes('@')) return byEmail.get(id.toLowerCase()) ?? null;
  const digits = id.replace(/\D/g, '');
  if (!digits) return null;
  return (
    byPhone.get(digits) ??
    (digits.length >= 10 ? byPhoneLast10.get(digits.slice(-10)) : undefined) ??
    null
  );
}
