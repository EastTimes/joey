import { execFile } from 'node:child_process';

const OSA_TIMEOUT_MS = 20000;

const SCRIPT = `
function run(argv) {
  const payload = JSON.parse(argv[0]);
  const Contacts = Application('Contacts');

  function clean(value) {
    return String(value || '').trim();
  }

  function digits(value) {
    return clean(value).replace(/\\D/g, '');
  }

  function comparablePhones(values) {
    const out = [];
    for (const value of values || []) {
      const d = digits(value);
      if (!d) continue;
      out.push(d);
      if (d.length >= 10) out.push(d.slice(-10));
    }
    return out;
  }

  function emails(values) {
    return (values || []).map((value) => clean(value).toLowerCase()).filter(Boolean);
  }

  function fieldValues(person, key) {
    try {
      return person[key]().map((field) => clean(field.properties().value));
    } catch {
      return [];
    }
  }

  function personMatches(person, phones, emailList) {
    const existingPhones = comparablePhones(fieldValues(person, 'phones'));
    const wantedPhones = comparablePhones(phones);
    if (wantedPhones.some((phone) => existingPhones.includes(phone))) return true;

    const existingEmails = emails(fieldValues(person, 'emails'));
    return emails(emailList).some((email) => existingEmails.includes(email));
  }

  function pushMissingPhone(person, value) {
    const phone = clean(value);
    if (!phone) return false;
    const existing = comparablePhones(fieldValues(person, 'phones'));
    const wanted = comparablePhones([phone]);
    if (wanted.some((v) => existing.includes(v))) return false;
    person.phones.push(Contacts.Phone({ label: 'mobile', value: phone }));
    return true;
  }

  function pushMissingEmail(person, value) {
    const email = clean(value).toLowerCase();
    if (!email) return false;
    if (emails(fieldValues(person, 'emails')).includes(email)) return false;
    person.emails.push(Contacts.Email({ label: 'home', value: email }));
    return true;
  }

  const phones = (payload.phones || []).map(clean).filter(Boolean);
  const emailList = emails(payload.emails || []);
  let person = null;
  for (const candidate of Contacts.people()) {
    if (personMatches(candidate, phones, emailList)) {
      person = candidate;
      break;
    }
  }

  const firstName = clean(payload.firstName);
  const lastName = clean(payload.lastName);
  const organization = clean(payload.organization);
  let created = false;

  if (!person) {
    person = Contacts.Person({
      firstName,
      lastName,
      organization,
      company: !!organization && !firstName && !lastName,
    });
    Contacts.people.push(person);
    created = true;
  } else {
    if (firstName) person.firstName = firstName;
    if (lastName) person.lastName = lastName;
    if (organization) person.organization = organization;
  }

  let changed = created;
  for (const phone of phones) changed = pushMissingPhone(person, phone) || changed;
  for (const email of emailList) changed = pushMissingEmail(person, email) || changed;

  if (changed) Contacts.save();
  return JSON.stringify({ ok: true, created, changed, id: person.id(), name: person.name() });
}
`;

function runContactScript(payload) {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', SCRIPT, '--', JSON.stringify(payload)],
      { timeout: OSA_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (!err) return resolve(JSON.parse(stdout || '{}'));
        const detail = err.killed
          ? `timed out after ${OSA_TIMEOUT_MS / 1000}s`
          : (stderr || err.message || 'unknown error').trim();
        reject(new Error(`Contacts update failed: ${detail}`));
      }
    );
  });
}

export async function upsertContact({ firstName, lastName, organization, phones = [], emails = [] }) {
  return await runContactScript({ firstName, lastName, organization, phones, emails });
}
