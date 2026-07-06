import { relTime, compactCount } from '../format.js';
import {
  FlagIcon,
  ArchiveIcon,
  UnarchiveIcon,
  RefreshIcon,
  BackIcon,
  PersonIcon,
  PeopleIcon,
} from './Icons.jsx';

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
  refreshing,
  status,
  serverUp,
}) {
  const loading = chats === null;
  const inArchived = view === 'archived';
  const timeSensitive = !inArchived && chats ? chats.filter((c) => c.triage?.timeSensitive) : [];
  const rest = chats ? (inArchived ? chats : chats.filter((c) => !c.triage?.timeSensitive)) : [];

  return (
    <aside className="sidebar">
      {!serverUp && (
        <div className="banner banner-err" role="alert">
          Joey server unreachable — start it with <code>node server/index.js</code>.
        </div>
      )}
      {serverUp && status && !status.chatDbOk && (
        <div className="banner banner-err" role="alert">
          Can't read chat.db — grant this terminal Full Disk Access, then restart the server.
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
        <button
          className="icon-btn"
          onClick={onRefreshTriage}
          disabled={refreshing}
          title="Refresh triage — re-classify inbox chats for time sensitivity"
          aria-label="Refresh triage"
        >
          <RefreshIcon size={15} spinning={refreshing} />
        </button>
      </header>

      <div className="chat-list" role="listbox" aria-label="Conversations">
        {chatsError && <div className="list-note list-note-err">{chatsError}</div>}
        {loading && !chatsError && <div className="list-note">Loading conversations…</div>}

        {!inArchived && (
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
              <div className="list-note">Nothing else — just the time-sensitive chats above.</div>
            )}
          </>
        )}

        {inArchived && (
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
                <div className="iz-sub">Press ⌘E to archive the selected chat.</div>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="sidebar-foot">
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

function ChatRow({ chat, active, timeSensitive, archivedView, onSelect, onArchive, onUnarchive }) {
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
      className={`chat-row ${active ? 'active' : ''} ${timeSensitive ? 'ts' : ''}`}
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
        <div className="row-snippet">{snippet}</div>
      </div>
      <button
        className="row-archive"
        title={archivedView ? `Unarchive (⌘E)` : `Archive (⌘E)`}
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
      <div className="iz-sub">New messages will appear here. ⌘E archives the selected chat.</div>
    </div>
  );
}
