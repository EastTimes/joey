# Joey — Module Contract

Joey is a productivity-first iMessage client for macOS. It reads the local
`~/Library/Messages/chat.db` (read-only), sends via AppleScript through Messages.app,
and adds three features the stock app lacks: **AI autodrafting** (that learns from your
edits), **time-sensitive triage**, and **archiving to reach inbox zero**.

This file is the single source of truth for module boundaries. Every module must match
these signatures exactly — other modules are being written in parallel against them.

Stack: Node 22 ESM (plain JS, no TypeScript on the server), Express, better-sqlite3,
`@anthropic-ai/sdk`. Frontend: React 18 + Vite (JSX, no TS).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `JOEY_PORT` | `3456` | API server port |
| `JOEY_CHATDB` | `~/Library/Messages/chat.db` | Path to Messages database |
| `JOEY_DATA_DIR` | `~/.joey` | App state directory (joey.db lives here) |
| `JOEY_DRY_RUN` | unset | `1` = never invoke osascript; log the send and return `{dryRun:true}` |
| `JOEY_DRAFT_MODEL` | `claude-opus-4-8` | Model for drafting |
| `JOEY_TRIAGE_MODEL` | `claude-opus-4-8` | Model for triage classification |
| `JOEY_FOLLOWUP_MODEL` | `JOEY_TRIAGE_MODEL` | Model for follow-up classification |
| `JOEY_FOLLOWUP_MIN_HOURS` | `24` | Min hours before awaiting_reply candidate |
| `JOEY_GC_INTRO_MIN_HOURS` | `4` | Min hours after GC intro candidate |
| `JOEY_FOLLOWUP_CONTEXT_DAYS` | `7` | Only messages this recent are sent to follow-up AI |
| `JOEY_GOOGLE_CLIENT_ID` | unset | Google OAuth client ID (enables sidebar sign-in) |
| `JOEY_GOOGLE_CLIENT_SECRET` | unset | Google OAuth client secret (server-side only) |
| `JOEY_GOOGLE_CALENDAR_ID` | `primary` | Calendar ID to scan for sent invites |
| `ANTHROPIC_API_KEY` | unset | Standard SDK auth (SDK also resolves `ANTHROPIC_AUTH_TOKEN` / `ant` profiles) |

### Optional: Google Calendar (invite verification)

Suppresses false `calendar_pending` follow-ups once an invite is already on your calendar.
One-time host setup: create a [Google OAuth client](https://console.cloud.google.com/apis/credentials),
enable Calendar API, add redirect URI `http://127.0.0.1:3456/api/calendar/callback`, set
`JOEY_GOOGLE_CLIENT_ID` / `JOEY_GOOGLE_CLIENT_SECRET`, then sign in via the Joey sidebar.

## Shared data shapes

```js
// Msg — one message
{
  rowid: number,
  guid: string,
  text: string,            // decoded: message.text ?? decodeAttributedBody(attributedBody) ?? ''
  dateMs: number,          // unix epoch ms. Apple stores ns since 2001-01-01: dateMs = apple/1e6 + 978307200000
  isFromMe: boolean,
  senderId: string|null,   // handle.id (phone/email) of sender; null when isFromMe
  service: string,         // 'iMessage' | 'SMS' | 'RCS'
  hasAttachments: boolean,
}

// Chat — one conversation
{
  guid: string,            // e.g. "iMessage;-;+15551234567" or "iMessage;+;chat123..." (contains ; and +)
  chatIdentifier: string,  // phone/email for 1:1, chatXXX for groups
  serviceName: string,
  displayName: string,     // group name; '' if unset
  isGroup: boolean,        // chat.style == 43
  participants: string[],  // handle ids
  lastMessage: Msg|null,
  unreadCount: number,     // incoming messages with is_read=0
}

// Triage — classification of a chat's latest incoming message
{ timeSensitive: boolean, reason: string, deadline: string|null }  // deadline: human-readable like "today 5pm", or null

// Followup — outbound accountability reminder (AI-classified, cached per chat)
{ kind: 'gc_intro'|'awaiting_reply'|'calendar_pending', reason: string, triggerDateMs: number }
```

Message filtering (applies in chatdb.js): exclude tapbacks/reactions
(`associated_message_type >= 2000`), exclude `item_type != 0` (group renames, etc.),
exclude rows where decoded text is empty AND `cache_has_attachments = 0`.

## Server modules

### `server/lib/typedstream.js` — owner: chatdb agent
```js
export function decodeAttributedBody(buf) // Buffer|null -> string|null
```
Parses Apple's `streamtyped` NSArchiver blob. Heuristic: locate `NSString` marker,
skip the `\x01\x94\x84\x01\x2b` ("+") sequence, read length (1 byte; `0x81` = uint16 LE
follows; `0x82` = uint32 LE follows), then that many bytes of UTF-8. Must never throw —
return null on any parse failure. Verify against the real chat.db (≥99% of the last 2000
messages with NULL `text` must decode to non-empty strings).

### `server/db/chatdb.js` — owner: chatdb agent
Opens chat.db strictly read-only (`new Database(path, { readonly: true, fileMustExist: true })`).
```js
export function chatDbOk()                                  // -> boolean
export function messageCount()                              // -> number
export function listChats({ limit = 300 } = {})             // -> Chat[] sorted by last activity desc
export function getMessages(chatGuid, { limit = 60, beforeRowid = null } = {}) // -> Msg[] ascending by rowid
export function getLastIncomingMessage(chatGuid)            // -> Msg|null (most recent isFromMe=false)
export function getRecentSentTexts({ limit = 30 } = {})     // -> string[] my recent sent texts across all chats,
                                                            //    3..300 chars, deduped, for AI style profile
export function isGroupStartedByMe(chatGuid)                // -> boolean (first visible msg is from me)
```
Joins: `chat` ⟷ `chat_message_join` ⟷ `message`; `chat_handle_join` ⟷ `handle` for
participants; `message.handle_id` → `handle.id` for senderId. Use prepared statements.
Performance matters (568k rows): listChats must use `chat_message_join.message_date`
with proper indexes, not scan all messages; target < 500ms.

### `server/db/appdb.js` — owner: appdb agent
App state in `${JOEY_DATA_DIR}/joey.db` (create dir + tables on first open).
```js
export function openAppDb()                                  // singleton
// Archiving. A chat is *effectively archived* iff archived_chats has its guid AND
// currentLastRowid <= stored last_message_rowid (new arrivals auto-surface it).
export function archiveChat(chatGuid, lastMessageRowid)
export function unarchiveChat(chatGuid)
export function getArchivedMap()                             // -> Map<chatGuid, {archivedAt, lastMessageRowid}>
// Triage cache (keyed by message guid so a chat re-classifies only on new messages)
export function getTriage(messageGuid)                       // -> {timeSensitive, reason, deadline}|null
export function setTriage(messageGuid, triage)
// Drafts + edit-pair learning
export function createDraft(chatGuid, text)                  // -> draftId (integer)
export function getDraft(draftId)                            // -> {id, chatGuid, text, createdAt}|null
export function addEditPair({ chatGuid, draft, final })
export function getEditPairs(limit = 12)                     // -> [{draft, final}] newest first
// Follow-up cache (keyed by chat guid; stale when lastMessage.rowid changes)
export function getFollowup(chatGuid)                        // -> {lastMessageRowid, needsFollowup, kind, reason}|null
export function setFollowup(chatGuid, followup)
export function getDismissedMap()                            // -> Map<chatGuid, {kind, dismissedAt, snoozeUntil}>
export function dismissFollowup(chatGuid, kind, { snoozeHours })
export function isFollowupDismissed(chatGuid, kind, dismissedMap) // -> boolean
```

### `server/imessage/send.js` — owner: send/contacts agent
```js
export async function sendMessage({ chatGuid, chatIdentifier, isGroup, service, text })
// -> { ok: true, dryRun: boolean } ; throws Error with .message on failure
```
- `JOEY_DRY_RUN=1` → log `[dry-run] would send to <chatGuid>: <text>` and return without osascript.
- **Injection-safe**: pass text and target as argv — `osascript -e '...on run argv...' -- <target> <text>`,
  never interpolate user text into the script source.
- Groups (`isGroup`): `send ... to chat id "<chatGuid>"`. 1:1 iMessage: `participant "<id>"
  of (1st account whose service type = iMessage)`. 1:1 SMS: same with `service type = SMS`,
  falling back to chat id.
- 15s timeout on osascript; surface stderr in the thrown Error.

### `server/imessage/contacts.js` — owner: send/contacts agent
```js
export function loadContacts()      // sync or async; builds map at startup; best-effort, NEVER throws
export function resolveName(handleId) // -> string|null e.g. "Jane Doe"
```
Reads `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`
(read-only sqlite; tables ZABCDRECORD ZFIRSTNAME/ZLASTNAME, ZABCDPHONENUMBER.ZFULLNUMBER,
ZABCDEMAILADDRESS.ZADDRESS). Match phones by normalized last-10-digits, emails lowercase.
If unreadable, resolveName returns null and the app shows raw handles.

### `server/ai/client.js` — owner: AI agent
```js
export function aiAvailable()   // -> boolean (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set,
                                //    or ~/.config/anthropic/ exists)
export function getClient()     // -> Anthropic singleton (zero-arg constructor) or null
export const DRAFT_MODEL        // from JOEY_DRAFT_MODEL
export const TRIAGE_MODEL       // from JOEY_TRIAGE_MODEL
export const FOLLOWUP_MODEL     // from JOEY_FOLLOWUP_MODEL (defaults to TRIAGE_MODEL)
```

### `server/ai/draft.js` — owner: AI agent
```js
export async function generateDraft({ chatName, isGroup, messages, styleExamples, editPairs })
// messages: Msg[]+senderName (last ~25, ascending); styleExamples: string[]; editPairs: [{draft,final}]
// -> string (the draft text only — no quotes, no preamble)
```
Claude API usage (per current API — do not use stale patterns):
- model `DRAFT_MODEL`, `thinking: { type: 'adaptive' }`, NO temperature/top_p (400 on Opus 4.8)
- `max_tokens: 1024`
- system as array of text blocks: block 1 = stable instructions with
  `cache_control: {type:'ephemeral'}`; block 2 = style examples + edit pairs ("when you
  drafted X, the user changed it to Y — learn from the delta") with `cache_control`
- final user turn = transcript + "draft the user's next reply"
- Draft must match the user's real texting style (length, capitalization, punctuation, emoji)

### `server/ai/triage.js` — owner: AI agent
```js
export async function classifyBatch(items)
// items: [{ guid, chatName, text, dateMs, contextText }] (≤ 25 per call; chunk if more)
// -> Map<guid, Triage>
```
- model `TRIAGE_MODEL`, no thinking config needed, `max_tokens: 2048`
- Structured outputs: `output_config: { format: { type: 'json_schema', schema } }` with
  `{ results: [{ index, time_sensitive, reason, deadline }] }`, `additionalProperties: false`,
  all fields required (deadline nullable via type ["string","null"])
- time-sensitive = needs response/action soon: direct questions, plans being made,
  deadlines, meeting logistics, anything expiring today/tomorrow. NOT newsletters,
  reactions, FYI chatter.
- Stable system prompt with `cache_control: {type:'ephemeral'}`

### `server/ai/followups.js` — owner: AI agent
```js
export async function classifyFollowups(items)
// items: [{ chatGuid, chatName, isGroup, lastDateMs, lastMessageRowid, transcript }] (≤ 15 per call)
// -> Map<chatGuid, { needsFollowup, kind, reason, lastMessageRowid }>
```
- model `FOLLOWUP_MODEL`, structured JSON output
- kinds: `gc_intro` (silent group intro), `awaiting_reply` (they ghosted you), `calendar_pending` (time agreed, no invite)
- Pre-filtered by `server/lib/candidates.js` before API call

## HTTP API — owner: server agent (`server/index.js`, `server/routes/api.js`)

All under `/api`. Chat guids in paths are URL-encoded by the client.

| Route | Response |
|---|---|
| `GET /api/status` | `{ ok, aiAvailable, dryRun, chatDbOk, messageCount, draftModel }` |
| `GET /api/chats?filter=inbox\|archived\|all` (default inbox) | `{ chats: ChatSummary[] }` |
| `GET /api/chats/:guid/messages?limit&before` | `{ messages: (Msg & {senderName})[] }` |
| `POST /api/chats/:guid/send` `{text, draftId?}` | `{ ok, dryRun }` — if draftId given and text differs from stored draft, record edit pair first |
| `POST /api/chats/:guid/archive` | `{ ok }` (uses current lastMessage.rowid) |
| `POST /api/chats/:guid/unarchive` | `{ ok }` |
| `POST /api/chats/:guid/draft` | `{ draftId, text }` — 503 `{error}` when !aiAvailable |
| `POST /api/triage/refresh` | `{ updated }` — classify last incoming msg of each inbox chat missing cached triage; 503 when !aiAvailable |
| `POST /api/followups/refresh` | `{ updated, scanned }` — AI-classify follow-up candidates; 503 when !aiAvailable |
| `POST /api/chats/:guid/dismiss-followup` | `{ kind, snoozeHours? }` → `{ ok }` |

`ChatSummary = Chat & { name, archived, triage, followup }` where `name` = displayName ||
contact names of participants (via resolveName) || chatIdentifier; `archived` uses the
effective-archive rule; `triage` = cached triage of lastMessage when it's incoming, else null;
`followup` = cached follow-up when fresh and not dismissed, else null.

Server also serves `web/dist` statically when present (SPA fallback to index.html).
Errors: JSON `{ error: string }` with appropriate status; the server must not crash on a
bad guid. express.json() body limit 1mb. Bind to 127.0.0.1 only (local data!).

## Frontend — owner: frontend agent (`web/src/**`)

React SPA, files: `main.jsx`, `App.jsx`, `api.js` (fetch helpers), components as needed,
`styles.css`. Already scaffolded: `web/index.html` (mount point `#root`), vite config
(proxy `/api` → 3456).

Layout: left sidebar + main thread pane.
- Sidebar sections: **Time Sensitive** (inbox chats whose `triage.timeSensitive`, with the
  reason shown), **Follow-ups** (outbound accountability: GC intros, ghosted replies,
  calendar invites owed), **Inbox** (the rest), and an **Archived** view toggle at the bottom.
  Chat rows: name, snippet, relative time, unread dot, hover archive/unarchive button.
  Inbox-zero state: friendly empty message when Inbox is empty.
- Thread pane: header (name, triage badge with reason/deadline, archive button), message
  bubbles (mine right, theirs left with senderName in groups), date separators,
  "load older" at top. Auto-scroll to bottom on new messages.
- Composer: textarea (Enter=send, Shift+Enter=newline), **Draft with AI** button →
  `POST draft`, fills textarea and remembers draftId (edits keep the draftId — the server
  learns from the delta), Send button. Sending clears draftId. Show errors inline.
- Status strip when `!aiAvailable`: "Set ANTHROPIC_API_KEY to enable AI drafting & triage."
- A "Refresh classification" button in the sidebar header (POST /api/triage/refresh +
  /api/followups/refresh, then reload chats). Follow-up rows have a dismiss control.
- Poll `/api/chats` every 5s, active thread every 3s. Optimistic send (append bubble immediately).
- `encodeURIComponent` every chat guid in URLs.
- Design: polished and distinctive, NOT generic-AI-slop (no Inter-on-white with purple
  gradients). Pick a concrete palette + type pairing and carry it through. Dense
  productivity layout, keyboard-friendly, subtle animations.

## Hard safety rules for all agents

1. chat.db and AddressBook are opened **read-only**. Never write to them.
2. **Never actually send an iMessage** during development/testing. All send-path testing
   uses `JOEY_DRY_RUN=1`. Do not invoke osascript against Messages.app at all.
3. No telemetry, no external calls except api.anthropic.com via the SDK.
