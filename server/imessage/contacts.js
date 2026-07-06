// Best-effort contact name lookup from the local AddressBook (read-only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const byPhone = new Map(); // full normalized digits -> name
const byPhoneLast10 = new Map(); // last 10 digits -> name
const byEmail = new Map(); // lowercase email -> name

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

function loadSource(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const phoneRows = db
      .prepare(
        `SELECT r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZORGANIZATION AS org,
                p.ZFULLNUMBER AS value
         FROM ZABCDRECORD r
         JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
         WHERE p.ZFULLNUMBER IS NOT NULL`
      )
      .all();
    for (const row of phoneRows) {
      const name = displayName(row);
      if (name) addPhone(row.value, name);
    }

    const emailRows = db
      .prepare(
        `SELECT r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZORGANIZATION AS org,
                e.ZADDRESS AS value
         FROM ZABCDRECORD r
         JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
         WHERE e.ZADDRESS IS NOT NULL`
      )
      .all();
    for (const row of emailRows) {
      const name = displayName(row);
      const email = String(row.value).trim().toLowerCase();
      if (name && email && !byEmail.has(email)) byEmail.set(email, name);
    }
  } finally {
    db.close();
  }
}

export function loadContacts() {
  byPhone.clear();
  byPhoneLast10.clear();
  byEmail.clear();
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
