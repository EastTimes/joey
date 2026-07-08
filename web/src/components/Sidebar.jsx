import { relTime, compactCount } from '../format.js';
import CalendarConnect from './CalendarConnect.jsx';
import {
  FlagIcon,
  CalendarIcon,
  ReplyArrowIcon,
  DismissIcon,
  ArchiveIcon,
  UnarchiveIcon,
  RefreshIcon,
  ComposeIcon,
  BackIcon,
  PersonIcon,
  PeopleIcon,
  ContactEditIcon,
} from './Icons.jsx';

const IS_DESKTOP = /Electron/i.test(navigator.userAgent || '');

export default function Sidebar({
  chats,
  chatsError,
  view,
  setView,
  activeGuid,
  onSelect,
  onArchive,
  onUnarchive,
  onRefreshTriage,
  onDismissFollowup,
  onComposeNew,
  onEditContact,
  onStatusRefresh,
  refreshing,
  status,
  serverUp,
  showPowerItems,
  setShowPowerItems,
  searchQuery,
  setSearchQuery,
  searchResults,
  searchLoading,
  searchError,
  searchActive,
}) {
  const loading = chats === null;
  const inArchived = view === 'archived';
  const timeSensitive = !inArchived && chats ? chats.filter((c) => c.triage?.timeSensitive) : [];
  const flagged = !inArchived && chats
    ? chats.filter((c) => c.followup && !c.triage?.timeSensitive)
    : [];
  const actionItems = flagged.filter((c) => c.followup?.kind === 'calendar_pending');
  const followups = flagged.filter((c) => c.followup?.kind !== 'calendar_pending');
  const rest = chats
    ? inArchived
      ? chats
      : chats.filter((c) => !c.triage?.timeSensitive && (!showPowerItems || !c.followup))
    : [];

  return (
    <aside className="sidebar">
      {!serverUp && (
        <div className="banner banner-err" role="alert">
          Joey server unreachable — start it with <code>node server/index.js</code>.
        </div>
      )}
      {serverUp && status && !status.chatDbOk && (
        <div className="banner banner-err" role="alert">
          Can't read chat.db — grant {IS_DESKTOP ? 'Joey.app' : 'this terminal'} Full Disk Access, then restart Joey.
          {status.chatDbError ? ` (${status.chatDbError})` : ''}
        </div>
      )}
      {serverUp && status && !status.aiAvailable && (
        <div className="banner">Set <code>ANTHROPIC_API_KEY</code> to enable AI drafting &amp; triage.</div>
      )}
      {serverUp && status?.dryRun && (
        <div className="banner" title="JOEY_DRY_RUN is on">
          Dry run — sends are logged, never delivered.
        </div>
      )}


      <header className="sidebar-head">
        <h1 className="sb-title">{inArchived ? 'Archived' : 'Messages'}</h1>
        <div className="sidebar-actions">
          {!inArchived && (
            <button
              className="icon-btn"
              onClick={onComposeNew}
              title="New message"
              aria-label="New message"
            >
              <ComposeIcon size={15} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onRefreshTriage}
            disabled={refreshing}
            title="Refresh classification — time-sensitive triage + follow-up reminders"
            aria-label="Refresh classification"
          >
            <RefreshIcon size={15} spinning={refreshing} />
          </button>
        </div>
      </header>

      <div className="search-wrap">
        <input
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search messages"
          aria-label="Search messages"
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear search"
            aria-label="Clear search"
          >
            <DismissIcon size={11} />
          </button>
        )}
      </div>

      <div className="chat-list" role="listbox" aria-label="Conversations">
        {chatsError && <div className="list-note list-note-err">{chatsError}</div>}
        {!searchActive && loading && !chatsError && <div className="list-note">Loading conversations…</div>}

        {searchActive ? (
          <>
            {searchError && <div className="list-note list-note-err">{searchError}</div>}
            {searchLoading && <div className="list-note">Searching…</div>}
            {!searchLoading && !searchError && searchResults.length === 0 && (
              <div className="list-note">No matches.</div>
            )}
            {searchResults.map((result) => (
              <SearchResultRow
                key={result.message?.guid || `${result.type}:${result.contact?.source}:${result.contact?.recordId}`}
                result={result}
                query={searchQuery}
                active={result.chat?.guid === activeGuid}
                onSelect={onSelect}
                onEditContact={onEditContact}
              />
            ))}
          </>
        ) : !inArchived ? (
          <>
            {timeSensitive.length > 0 && (
              <>
                <div className="section-label section-ts">
                  <FlagIcon size={10} />
                  <span>Time Sensitive</span>
                  <span className="count">{timeSensitive.length}</span>
                </div>
                {timeSensitive.map((c) => (
                  <ChatRow
                    key={c.guid}
                    chat={c}
                    timeSensitive
                    active={c.guid === activeGuid}
                    onSelect={onSelect}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                  />
                ))}
              </>
            )}
            {showPowerItems && actionItems.length > 0 && (
              <>
                <div className="section-label section-action">
                  <CalendarIcon size={10} />
                  <span>Action Items</span>
                  <span className="count">{actionItems.length}</span>
                </div>
                {actionItems.map((c) => (
                  <ChatRow
                    key={c.guid}
                    chat={c}
                    actionItem
                    active={c.guid === activeGuid}
                    onSelect={onSelect}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                    onDismissFollowup={onDismissFollowup}
                  />
                ))}
              </>
            )}
            {showPowerItems && followups.length > 0 && (
              <>
                <div className="section-label section-fu">
                  <ReplyArrowIcon size={10} />
                  <span>Follow-ups</span>
                  <span className="count">{followups.length}</span>
                </div>
                {followups.map((c) => (
                  <ChatRow
                    key={c.guid}
                    chat={c}
                    followup
                    active={c.guid === activeGuid}
                    onSelect={onSelect}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                    onDismissFollowup={onDismissFollowup}
                  />
                ))}
              </>
            )}
            {chats && chats.length > 0 && (
              <div className="section-label">
                <span>Inbox</span>
                {rest.length > 0 && <span className="count">{rest.length}</span>}
              </div>
            )}
            {rest.map((c) => (
              <ChatRow
                key={c.guid}
                chat={c}
                active={c.guid === activeGuid}
                onSelect={onSelect}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
              />
            ))}
            {!loading && chats && chats.length === 0 && !chatsError && <InboxZero />}
            {!loading && chats && chats.length > 0 && rest.length === 0 && (
              <div className="list-note">
                {timeSensitive.length + (showPowerItems ? actionItems.length + followups.length : 0) > 0
                  ? 'Nothing else in the regular inbox.'
                  : 'Nothing else — just the flagged chats above.'}
              </div>
            )}
          </>
        ) : (
          <>
            {rest.map((c) => (
              <ChatRow
                key={c.guid}
                chat={c}
                archivedView
                active={c.guid === activeGuid}
                onSelect={onSelect}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
              />
            ))}
            {!loading && chats && chats.length === 0 && !chatsError && (
              <div className="inbox-zero">
                <div className="iz-title">No archived conversations.</div>
                <div className="iz-sub">Press E (or ⌘⇧E) to archive the selected chat.</div>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="sidebar-foot">
        <CalendarConnect status={status} onConnected={onStatusRefresh} />
        {!inArchived && (
          <label className="power-toggle">
            <input
              type="checkbox"
              checked={showPowerItems}
              onChange={(e) => setShowPowerItems(e.target.checked)}
            />
            <span className="power-toggle-track" aria-hidden="true" />
            <span className="power-toggle-text">Power items</span>
          </label>
        )}
        <div className="sidebar-foot-row">
          <button className="view-toggle" onClick={() => setView(inArchived ? 'inbox' : 'archived')}>
            {inArchived ? (
              <>
                <BackIcon size={12} /> Back to Inbox
              </>
            ) : (
              <>
                <ArchiveIcon size={13} /> Archived
              </>
            )}
          </button>
          {status?.chatDbOk && <span className="db-stat">{compactCount(status.messageCount)} messages</span>}
        </div>
      </footer>
    </aside>
  );
}

// Deterministic muted hue per chat guid, for initials avatars.
function hueFromGuid(guid) {
  let h = 0;
  for (let i = 0; i < guid.length; i++) h = (h * 31 + guid.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initialsFromName(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => [...w][0]).filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return null;
  return (letters.length === 1 ? letters[0] : letters[0] + letters[letters.length - 1]).toUpperCase();
}

function Avatar({ chat, name }) {
  if (chat.isGroup) {
    return (
      <span className="avatar avatar-glyph" aria-hidden="true">
        <PeopleIcon size={22} />
      </span>
    );
  }
  const initials = initialsFromName(name);
  if (!initials) {
    return (
      <span className="avatar avatar-glyph" aria-hidden="true">
        <PersonIcon size={22} />
      </span>
    );
  }
  const hue = hueFromGuid(chat.guid);
  const style = {
    background: `linear-gradient(180deg, hsl(${hue} 16% 72%), hsl(${hue} 18% 55%))`,
  };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials}
    </span>
  );
}

function searchSnippet(text, query) {
  const source = String(text || '');
  const needle = query.trim().toLowerCase();
  const idx = source.toLowerCase().indexOf(needle);
  if (idx === -1) return source.slice(0, 150);
  const start = Math.max(0, idx - 44);
  const end = Math.min(source.length, idx + needle.length + 90);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

function HighlightedText({ text, query }) {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

function SearchResultRow({ result, query, active, onSelect, onEditContact }) {
  const { chat, message, contact, type } = result;
  const isContact = type === 'contact';
  const name = chat?.name || chat?.chatIdentifier || chat?.guid || '';
  const contactName = contact?.name || name;
  const title = isContact ? contactName : name;
  const sender = message?.isFromMe ? 'You' : message?.senderName || message?.senderId || '';
  const contactDetail = contact
    ? contact.match || contact.phones[0] || contact.emails[0] || contact.organization || ''
    : '';
  const meta = isContact
    ? chat
      ? `Saved Contact${contactDetail ? ` • ${contactDetail}` : ''}`
      : `Saved Contact${contactDetail ? ` • ${contactDetail}` : ''} • No conversation`
    : sender;
  const snippet = isContact
    ? chat?.lastMessage
      ? `${chat.lastMessage.isFromMe ? 'You: ' : ''}${chat.lastMessage.text || (chat.lastMessage.hasAttachments ? 'Attachment' : '')}`
      : contact?.emails[0] || contact?.phones[0] || ''
    : searchSnippet(message.text, query);
  const timeMs = isContact ? chat?.lastMessage?.dateMs : message.dateMs;
  const canOpen = !!chat;

  const handleKey = (e) => {
    if (!canOpen) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(chat.guid);
    }
  };

  return (
    <div
      className={`chat-row search-result ${isContact ? 'contact-result' : ''} ${canOpen ? '' : 'disabled'} ${active ? 'active' : ''}`}
      role="option"
      aria-selected={active}
      aria-disabled={!canOpen}
      tabIndex={0}
      onClick={() => {
        if (canOpen) onSelect(chat.guid);
      }}
      onKeyDown={handleKey}
    >
      <span className="unread-dot off" />
      <Avatar chat={chat || { isGroup: false, guid: contact?.recordId ? String(contact.recordId) : title }} name={title} />
      <div className="row-main">
        <div className="row-top">
          <span className="row-name">
            {isContact ? <HighlightedText text={title} query={query} /> : title}
          </span>
          <span className="row-time">{timeMs ? relTime(timeMs) : ''}</span>
        </div>
        <div className="search-meta">
          <HighlightedText text={meta} query={query} />
        </div>
        <div className="row-snippet search-snippet">
          <HighlightedText text={snippet} query={query} />
        </div>
      </div>
      {isContact && (
        <button
          className="row-contact-edit"
          title="Edit contact"
          aria-label={`Edit contact ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onEditContact({ contact, target: contact?.phones?.[0] || contact?.emails?.[0] || '' });
          }}
        >
          <ContactEditIcon size={13} />
        </button>
      )}
    </div>
  );
}

function ChatRow({
  chat,
  active,
  timeSensitive,
  followup,
  actionItem,
  archivedView,
  onSelect,
  onArchive,
  onUnarchive,
  onDismissFollowup,
}) {
  const lm = chat.lastMessage;
  const snippet = lm
    ? `${lm.isFromMe ? 'You: ' : ''}${lm.text || (lm.hasAttachments ? 'Attachment' : '')}`
    : 'No messages';
  const name = chat.name || chat.chatIdentifier || chat.guid;

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(chat.guid);
    }
  };

  return (
    <div
      className={`chat-row ${active ? 'active' : ''} ${timeSensitive ? 'ts' : ''} ${actionItem ? 'action' : ''} ${followup ? 'fu' : ''}`}
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(chat.guid)}
      onKeyDown={handleKey}
    >
      <span
        className={`unread-dot ${chat.unreadCount > 0 ? '' : 'off'}`}
        title={chat.unreadCount > 0 ? `${chat.unreadCount} unread` : undefined}
      />
      <Avatar chat={chat} name={name} />
      <div className="row-main">
        <div className="row-top">
          <span className="row-name">{name}</span>
          <span className="row-time">{lm ? relTime(lm.dateMs) : ''}</span>
        </div>
        {timeSensitive && chat.triage && (
          <div className="row-reason">
            <FlagIcon size={9} />
            <span>
              {chat.triage.reason}
              {chat.triage.deadline ? <em className="row-deadline"> · {chat.triage.deadline}</em> : null}
            </span>
          </div>
        )}
        {actionItem && chat.followup && (
          <div className="row-reason row-reason-action">
            <CalendarIcon size={9} />
            <span>
              {chat.followup.reason}
              {chat.followup.triggerDateMs ? (
                <em className="row-deadline"> · {relTime(chat.followup.triggerDateMs)}</em>
              ) : null}
            </span>
          </div>
        )}
        {followup && chat.followup && (
          <div className="row-reason row-reason-fu">
            <ReplyArrowIcon size={9} />
            <span>
              {chat.followup.reason}
              {chat.followup.triggerDateMs ? (
                <em className="row-deadline"> · {relTime(chat.followup.triggerDateMs)}</em>
              ) : null}
            </span>
          </div>
        )}
        <div className="row-snippet">{snippet}</div>
      </div>
      {(followup || actionItem) && onDismissFollowup && (
        <button
          className="row-dismiss"
          title="Dismiss follow-up"
          aria-label={`Dismiss follow-up for ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDismissFollowup(chat.guid, chat.followup.kind);
          }}
        >
          <DismissIcon size={12} />
        </button>
      )}
      <button
        className="row-archive"
        title={archivedView ? `Unarchive (E or ⌘⇧E)` : `Archive (E or ⌘⇧E)`}
        aria-label={archivedView ? `Unarchive ${name}` : `Archive ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (archivedView) onUnarchive(chat.guid);
          else onArchive(chat.guid);
        }}
      >
        {archivedView ? <UnarchiveIcon size={13} /> : <ArchiveIcon size={13} />}
      </button>
    </div>
  );
}

function InboxZero() {
  return (
    <div className="inbox-zero">
      <div className="iz-title">No conversations — you're all caught up.</div>
      <div className="iz-sub">New messages will appear here. E (or ⌘⇧E) archives the selected chat.</div>
    </div>
  );
}
