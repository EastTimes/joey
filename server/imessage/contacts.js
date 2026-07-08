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

export function loadContacts() {
  byPhone.clear();
  byPhoneLast10.clear();
  byEmail.clear();
  emailsByPhone.clear();
  emailsByPhoneLast10.clear();
  try {
    const sourcesDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'AddressBook',
      'Sources'
    );
    for (const entry of fs.readdirSync(sourcesDir)) {
      const dbPath = path.join(sourcesDir, entry, 'AddressBook-v22.abcddb');
      if (!fs.existsSync(dbPath)) continue;
      try {
        loadSource(dbPath);
      } catch (err) {
        console.warn(`[contacts] skipping source ${entry}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[contacts] AddressBook unavailable: ${err.message}`);
  }
  return { phones: byPhone.size, emails: byEmail.size };
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
