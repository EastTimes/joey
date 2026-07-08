# Joey

**iMessage, but built for productivity.** The Mac Messages app isn't designed for people
answering 100+ texts a day — messages get lost, nothing can be archived, and every reply
is typed from scratch. Joey is a local web app that fixes that:

- **AI autodrafting** — one click drafts your reply in *your* texting voice, and it
  continually learns from the edits you make before hitting send.
- **Time-sensitive triage** — incoming messages that actually need action (questions,
  plans, deadlines) are pulled into their own section so they can't get buried.
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
3. **Claude API key** (optional, enables AI features):
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

## Desktop app

```sh
npm run desktop   # build the frontend and open Joey in a Mac app window
npm run pack:mac  # create dist/mac-arm64/Joey.app for local testing
npm run dist:mac  # create distributable DMG/ZIP artifacts
```

The desktop app still needs the same macOS permissions as the local web app.

## More

Optional features (follow-up reminders, Google Calendar invite checks) and all env vars
are documented in [CONTRACT.md](./CONTRACT.md).