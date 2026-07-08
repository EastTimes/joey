# Joey

**iMessage, but built for productivity.** The Mac Messages app isn't designed for people
answering 100+ texts a day — messages get lost, nothing can be archived, and every reply
is typed from scratch. Joey is a local web app that fixes that:

- **AI autodrafting** — one click drafts your reply in *your* texting voice, and it
  continually learns from the edits you make before hitting send.
- **Time-sensitive triage** — incoming messages that actually need action (questions,
  plans, deadlines) are pulled into their own section so they can't get buried.
- **Follow-up reminders** — AI spots threads where you owe a reply: silent group intros,
  messages you sent that went unanswered, or agreed meeting times missing a calendar invite.
- **Archive to inbox zero** — archive conversations out of your inbox; they come back
  automatically the moment a new message arrives.

## How it works (and why it's private)

Joey reads directly from the local `~/Library/Messages/chat.db` (**read-only**) and sends
through AppleScript → Messages.app, so everything rides the real iMessage protocol on
your own machine. Your message history never leaves your Mac; the only network calls are
to the Claude API for drafting/triage (and those are optional — everything else works
without a key).

## Setup

1. **Full Disk Access** — grant it to your terminal (System Settings → Privacy & Security
   → Full Disk Access) so Joey can read `chat.db`.
2. **Automation permission** — the first send will prompt to allow your terminal to
   control Messages.app. Approve it.
3. **Google Calendar** (optional, suppresses false "calendar invite" follow-ups):
   set up [`~/calendar`](/Users/richzou/calendar) (`credentials.json` + run `python sync.py` once for `token.json`),
   then `export JOEY_GOOGLE_USER_EMAIL=you@gmail.com`.
4. **Claude API key** (optional, enables AI features):
   ```sh
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

## Run

```sh
npm run build     # build the frontend once (rebuild after UI changes)
npm start         # serves the app at http://localhost:3456
```

For frontend development: `npm start` in one terminal, `npm run dev:web` in another
(Vite dev server on :5173 with API proxy).

## Configuration

| Env var | Default | |
|---|---|---|
| `JOEY_PORT` | `3456` | server port (binds 127.0.0.1 only) |
| `JOEY_DRY_RUN` | unset | `1` = log sends instead of sending (for development) |
| `JOEY_DRAFT_MODEL` | `claude-opus-4-8` | drafting model |
| `JOEY_TRIAGE_MODEL` | `claude-opus-4-8` | triage model (`claude-haiku-4-5` is a cheap alternative) |
| `JOEY_FOLLOWUP_MODEL` | same as triage | follow-up classification model |
| `JOEY_GOOGLE_USER_EMAIL` | unset | your Google account email (for calendar invite checks) |
| `JOEY_GOOGLE_CALENDAR_DIR` | `~/calendar` | dir with `credentials.json` + `token.json` |
| `JOEY_GOOGLE_CALENDAR_ID` | `primary` | calendar to scan for sent invites |
| `JOEY_DATA_DIR` | `~/.joey` | where Joey keeps its own state (archives, drafts, learning) |
| `JOEY_CHATDB` | `~/Library/Messages/chat.db` | Messages database path |

## Architecture

```
server/            Express API (Node 22, ESM)
  lib/typedstream.js    decodes Apple's attributedBody blobs (modern macOS stores
                        message text there, not in the text column)
  db/chatdb.js          read-only chat.db queries
  db/appdb.js           Joey's own state: archives, triage cache, drafts, edit pairs
  imessage/send.js      AppleScript sender (argv-passing, injection-safe)
  imessage/contacts.js  best-effort name resolution from the AddressBook db
  ai/draft.js           Claude drafting with cached style profile + edit-pair learning
  ai/triage.js          batched time-sensitive classification (structured outputs)
  ai/followups.js       AI follow-up reminders (GC intros, ghosted replies, calendar pending)
  lib/candidates.js     pre-filter before follow-up API calls (keeps cost down)
web/               React + Vite frontend
```
