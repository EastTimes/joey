import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Thread from './components/Thread.jsx';
import Toasts from './components/Toasts.jsx';

let toastSeq = 0;

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || '');
const POWER_ITEMS_KEY = 'joey.showPowerItems';

function getStoredPowerItems() {
  try {
    return window.localStorage.getItem(POWER_ITEMS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [serverUp, setServerUp] = useState(true);
  const [view, setView] = useState('inbox'); // 'inbox' | 'archived'
  const [chats, setChats] = useState(null); // null = loading
  const [chatsError, setChatsError] = useState(null);
  const [activeGuid, setActiveGuid] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [refreshingTriage, setRefreshingTriage] = useState(false);
  const [changeTick, setChangeTick] = useState(0); // bumped on SSE 'change'
  const [showPowerItems, setShowPowerItems] = useState(getStoredPowerItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const [compose, setCompose] = useState(null);
  const [contactSheet, setContactSheet] = useState(null);
  const lastActiveChat = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const trimmedSearch = searchQuery.trim();
  const searchActive = trimmedSearch.length >= 2;

  useEffect(() => {
    try {
      window.localStorage.setItem(POWER_ITEMS_KEY, showPowerItems ? '1' : '0');
    } catch {
      // best-effort preference only
    }
  }, [showPowerItems]);

  const pushToast = useCallback((text, kind = 'error', action = null) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 6000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const loadChats = useCallback(async (v) => {
    try {
      const data = await api.getChats(v === 'archived' ? 'archived' : 'inbox');
      setChats(data.chats || []);
      setChatsError(null);
    } catch (err) {
      setChatsError(err.message);
    }
  }, []);

  // Chat list: load on view change, then poll every 5s.
  useEffect(() => {
    setChats(null);
    setChatsError(null);
    loadChats(view);
    const t = setInterval(() => {
      if (!document.hidden) loadChats(view);
    }, 5000);
    return () => clearInterval(t);
  }, [view, loadChats]);

  useEffect(() => {
    let gone = false;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return () => {
        gone = true;
      };
    }

    setSearchLoading(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const data = await api.searchMessages(q);
        if (!gone) setSearchResults(data.results || []);
      } catch (err) {
        if (!gone) setSearchError(err.message);
      } finally {
        if (!gone) setSearchLoading(false);
      }
    }, 250);

    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [searchQuery, searchRefresh]);

  const reloadStatus = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setServerUp(true);
      return s;
    } catch {
      setServerUp(false);
      return null;
    }
  }, []);

  // Google Calendar OAuth callback (?calendar=connected|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    if (!cal) return;
    const msg = params.get('message');
    const email = params.get('email');
    window.history.replaceState({}, '', window.location.pathname);
    if (cal === 'connected') {
      pushToast(`Google Calendar connected${email ? ` — ${email}` : ''}`, 'info');
      reloadStatus();
      loadChats(viewRef.current);
    } else if (cal === 'error') {
      pushToast(`Calendar connect failed — ${msg || 'unknown error'}`);
    }
  }, [pushToast, reloadStatus, loadChats]);

  // Server status: on boot, then every 15s.
  useEffect(() => {
    let gone = false;
    const load = async () => {
      const s = await reloadStatus();
      if (gone) return;
      if (!s) gone = true;
    };
    load();
    const t = setInterval(() => {
      if (!document.hidden) reloadStatus();
    }, 15000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [reloadStatus]);

  // Real-time updates: the server watches chat.db and pushes a 'change' event
  // over SSE. Refresh the chat list and nudge the open thread to refetch.
  // The polling above stays as the fallback; EventSource reconnects on its
  // own, so errors are left silent.
  useEffect(() => {
    let es;
    try {
      es = new EventSource('/api/events');
    } catch {
      return; // no EventSource support — polling covers it
    }
    es.addEventListener('change', () => {
      loadChats(viewRef.current);
      setChangeTick((t) => t + 1);
    });
    return () => es.close();
  }, [loadChats]);

  // Keep a snapshot of the open chat so the thread survives list churn
  // (e.g. the chat just got archived out of the current filter).
  const activeChat = useMemo(() => {
    const found =
      (searchResults || []).find((r) => r.chat?.guid === activeGuid)?.chat ||
      (chats || []).find((c) => c.guid === activeGuid);
    if (found) {
      lastActiveChat.current = found;
      return found;
    }
    if (activeGuid && lastActiveChat.current?.guid === activeGuid) {
      return lastActiveChat.current;
    }
    return null;
  }, [chats, searchResults, activeGuid]);

  // Sidebar order: time-sensitive → optional power sections → rest.
  const orderedGuids = useMemo(() => {
    if (searchActive) {
      return [...new Set(searchResults.map((r) => r.chat?.guid).filter(Boolean))];
    }
    if (!chats) return [];
    if (view === 'archived') return chats.map((c) => c.guid);
    const ts = chats.filter((c) => c.triage?.timeSensitive);
    if (!showPowerItems) {
      const rest = chats.filter((c) => !c.triage?.timeSensitive);
      return [...ts, ...rest].map((c) => c.guid);
    }
    const flagged = chats.filter((c) => c.followup && !c.triage?.timeSensitive);
    const actions = flagged.filter((c) => c.followup?.kind === 'calendar_pending');
    const fu = flagged.filter((c) => c.followup?.kind !== 'calendar_pending');
    const rest = chats.filter((c) => !c.triage?.timeSensitive && !c.followup);
    return [...ts, ...actions, ...fu, ...rest].map((c) => c.guid);
  }, [chats, view, showPowerItems, searchActive, searchResults]);

  // Optimistically drop a row from the visible list and advance the
  // selection: the row after it, the previous one if it was last, cleared
  // if the list empties. Selection only moves when the removed chat was
  // the selected one.
  const removeRowAndAdvance = useCallback(
    (guid) => {
      const idx = orderedGuids.indexOf(guid);
      const remaining = orderedGuids.filter((g) => g !== guid);
      const next = idx !== -1 && remaining.length ? remaining[Math.min(idx, remaining.length - 1)] : null;
      setChats((prev) => (prev ? prev.filter((c) => c.guid !== guid) : prev));
      setActiveGuid((cur) => (cur === guid ? next : cur));
    },
    [orderedGuids]
  );

  const handleArchive = useCallback(
    async (guid) => {
      const chat = (chats || []).find((c) => c.guid === guid);
      const name = chat?.name || chat?.chatIdentifier || 'conversation';
      removeRowAndAdvance(guid);
      try {
        await api.archiveChat(guid);
        pushToast(`Archived ${name}`, 'info', {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.unarchiveChat(guid);
              await loadChats(viewRef.current);
              setActiveGuid(guid);
            } catch (err) {
              pushToast(`Couldn't undo — ${err.message}`);
            }
          },
        });
        loadChats(viewRef.current);
      } catch (err) {
        pushToast(`Couldn't archive — ${err.message}`);
        loadChats(viewRef.current);
      }
    },
    [chats, removeRowAndAdvance, loadChats, pushToast]
  );

  const handleUnarchive = useCallback(
    async (guid) => {
      // In the archived view, unarchiving removes the row from the list —
      // same optimistic advance as archiving does in the inbox.
      if (viewRef.current === 'archived') removeRowAndAdvance(guid);
      try {
        await api.unarchiveChat(guid);
        loadChats(viewRef.current);
      } catch (err) {
        pushToast(`Couldn't unarchive — ${err.message}`);
        loadChats(viewRef.current);
      }
    },
    [removeRowAndAdvance, loadChats, pushToast]
  );

  const handleArchiveToggle = useCallback(
    (chat) => (chat.archived ? handleUnarchive(chat.guid) : handleArchive(chat.guid)),
    [handleArchive, handleUnarchive]
  );

  const handleRefreshTriage = useCallback(async () => {
    if (refreshingTriage) return;
    setRefreshingTriage(true);
    try {
      const [triageRes, followupRes] = await Promise.all([
        api.refreshTriage(),
        status?.aiAvailable ? api.refreshFollowups() : Promise.resolve({ updated: 0 }),
      ]);
      await loadChats(view);
      const tn = triageRes?.updated ?? 0;
      const fn = followupRes?.updated ?? 0;
      const parts = [];
      if (tn > 0) parts.push(`${tn} time-sensitive`);
      if (fn > 0) parts.push(`${fn} follow-up${fn === 1 ? '' : 's'}`);
      pushToast(
        parts.length > 0 ? `Classified — ${parts.join(', ')}` : 'Inbox classification is up to date',
        'info'
      );
    } catch (err) {
      pushToast(`Classification failed — ${err.message}`);
    } finally {
      setRefreshingTriage(false);
    }
  }, [refreshingTriage, view, loadChats, pushToast, status?.aiAvailable]);

  const handleDismissFollowup = useCallback(
    async (guid, kind) => {
      try {
        await api.dismissFollowup(guid, kind);
        await loadChats(viewRef.current);
        pushToast('Follow-up dismissed', 'info');
      } catch (err) {
        pushToast(`Couldn't dismiss — ${err.message}`);
      }
    },
    [loadChats, pushToast]
  );

  const handleSent = useCallback(() => loadChats(view), [view, loadChats]);

  const openResolvedChat = useCallback((chat) => {
    if (!chat?.guid) return;
    setChats((prev) => {
      if (!prev) return [chat];
      if (prev.some((c) => c.guid === chat.guid)) return prev;
      return [chat, ...prev];
    });
    lastActiveChat.current = chat;
    setActiveGuid(chat.guid);
  }, []);

  const handleComposeNew = useCallback(() => {
    setCompose({ target: '', name: '' });
  }, []);

  const handleOpenDm = useCallback(
    async (person) => {
      const target = String(person?.id || '').trim();
      if (!target) {
        pushToast("Couldn't open DM — no number or email found");
        return;
      }
      try {
        const res = await api.resolveRecipient(target);
        if (res.chat) {
          openResolvedChat(res.chat);
          return;
        }
        setCompose({ target, name: person?.name || res.name || target });
      } catch (err) {
        pushToast(`Couldn't open DM — ${err.message}`);
      }
    },
    [openResolvedChat, pushToast]
  );

  const handleComposeSent = useCallback(
    async (target) => {
      setCompose(null);
      pushToast('Message sent', 'info');
      await loadChats(viewRef.current);
      setTimeout(async () => {
        try {
          const res = await api.resolveRecipient(target);
          if (res.chat) openResolvedChat(res.chat);
        } catch {
          // The conversation may not be in chat.db yet; polling will catch up.
        }
      }, 1200);
    },
    [loadChats, openResolvedChat, pushToast]
  );

  const handleEditContact = useCallback(({ contact = null, target = '', name = '' } = {}) => {
    setContactSheet({ contact, target, name });
  }, []);

  const handleContactSaved = useCallback(async () => {
    setContactSheet(null);
    pushToast('Contact saved', 'info');
    await reloadStatus();
    await loadChats(viewRef.current);
    setSearchRefresh((n) => n + 1);
  }, [loadChats, pushToast, reloadStatus]);

  // ⌘⇧E (Ctrl+Shift+E off-Mac): archive the selected chat — unarchive when in
  // the archived view. Capture phase so it wins even while the composer has focus.
  useEffect(() => {
    const onKey = (e) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!mod || !e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 'e') return;
      e.preventDefault();
      e.stopPropagation();
      if (!activeGuid) return; // no chat selected — no-op
      if (!orderedGuids.includes(activeGuid)) return; // selection not in the visible list
      if (view === 'archived') handleUnarchive(activeGuid);
      else handleArchive(activeGuid);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeGuid, orderedGuids, view, handleArchive, handleUnarchive]);

  // Bare E (no modifiers): same archive/unarchive as ⌘⇧E, but only while
  // focus is outside text fields — the chord above stays as the
  // works-while-typing fallback.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if ((e.key || '').toLowerCase() !== 'e') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
      e.preventDefault();
      if (!activeGuid) return; // no chat selected — no-op
      if (!orderedGuids.includes(activeGuid)) return; // selection not in the visible list
      if (view === 'archived') handleUnarchive(activeGuid);
      else handleArchive(activeGuid);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGuid, orderedGuids, view, handleArchive, handleUnarchive]);

  // ↑/↓ move the selection through the sidebar (outside text fields).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (!orderedGuids.length) return;
      e.preventDefault();
      const idx = orderedGuids.indexOf(activeGuid);
      const next =
        e.key === 'ArrowDown'
          ? orderedGuids[Math.min(idx + 1, orderedGuids.length - 1)]
          : orderedGuids[Math.max(idx - 1, 0)];
      if (next) setActiveGuid(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderedGuids, activeGuid]);

  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          chats={chats}
          chatsError={chatsError}
          view={view}
          setView={setView}
          activeGuid={activeGuid}
          onSelect={setActiveGuid}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          onRefreshTriage={handleRefreshTriage}
          onDismissFollowup={handleDismissFollowup}
          onComposeNew={handleComposeNew}
          onEditContact={handleEditContact}
          onStatusRefresh={reloadStatus}
          refreshing={refreshingTriage}
          status={status}
          serverUp={serverUp}
          showPowerItems={showPowerItems}
          setShowPowerItems={setShowPowerItems}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={searchResults}
          searchLoading={searchLoading}
          searchError={searchError}
          searchActive={searchActive}
        />
        <main className="thread-pane">
          {activeChat ? (
            <Thread
              key={activeChat.guid}
              chat={activeChat}
              refreshSignal={changeTick}
              aiAvailable={!!status?.aiAvailable}
              onArchiveToggle={handleArchiveToggle}
              onOpenDm={handleOpenDm}
              onEditContact={handleEditContact}
              onSent={handleSent}
              pushToast={pushToast}
            />
          ) : (
            <EmptyThread />
          )}
        </main>
      </div>
      {compose && (
        <ComposeSheet
          initialTarget={compose.target}
          displayName={compose.name}
          onClose={() => setCompose(null)}
          onSent={handleComposeSent}
          onEditContact={handleEditContact}
        />
      )}
      {contactSheet && (
        <ContactSheet
          seed={contactSheet}
          onClose={() => setContactSheet(null)}
          onSaved={handleContactSaved}
        />
      )}
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

function splitName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function ContactSheet({ seed, onClose, onSaved }) {
  const contact = seed.contact;
  const nameParts = splitName(contact?.name || seed.name || '');
  const initialTarget = String(seed.target || '').trim();
  const [firstName, setFirstName] = useState(nameParts.firstName);
  const [lastName, setLastName] = useState(nameParts.lastName);
  const [organization, setOrganization] = useState(contact?.organization || '');
  const [phone, setPhone] = useState(
    contact?.phones?.[0] || (!initialTarget.includes('@') ? initialTarget : '')
  );
  const [email, setEmail] = useState(
    contact?.emails?.[0] || (initialTarget.includes('@') ? initialTarget : '')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave = !!(firstName.trim() || lastName.trim() || organization.trim()) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveContact({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        organization: organization.trim(),
        phones: phone.trim() ? [phone.trim()] : [],
        emails: email.trim() ? [email.trim()] : [],
      });
      onSaved();
    } catch (err) {
      setError(err.message || 'Contact save failed');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="compose-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="compose-sheet contact-sheet" role="dialog" aria-modal="true" aria-label="Edit contact" onMouseDown={(e) => e.stopPropagation()}>
        <div className="compose-head">
          <h2>{contact ? 'Edit Contact' : 'Add Contact'}</h2>
          <button className="compose-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="contact-grid">
          <label>
            <span>First</span>
            <input ref={firstRef} value={firstName} onChange={(e) => setFirstName(e.target.value)} onKeyDown={onKeyDown} />
          </label>
          <label>
            <span>Last</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} onKeyDown={onKeyDown} />
          </label>
          <label className="wide">
            <span>Company</span>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} onKeyDown={onKeyDown} />
          </label>
          <label className="wide">
            <span>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={onKeyDown} placeholder="+1 555 123 4567" />
          </label>
          <label className="wide">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKeyDown} placeholder="name@example.com" />
          </label>
        </div>
        {error && <div className="compose-error">{error}</div>}
        <div className="compose-actions">
          <button className="compose-secondary" onClick={onClose}>Cancel</button>
          <button className="compose-primary" onClick={save} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeSheet({ initialTarget, displayName, onClose, onSent, onEditContact }) {
  const [target, setTarget] = useState(initialTarget || '');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const targetRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (initialTarget) textRef.current?.focus();
    else targetRef.current?.focus();
  }, [initialTarget]);

  const canSend = target.trim().length > 0 && text.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const recipient = target.trim();
      await api.sendDirectMessage(recipient, text.trim());
      onSent(recipient);
    } catch (err) {
      setError(err.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="compose-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="compose-sheet" role="dialog" aria-modal="true" aria-label="New message" onMouseDown={(e) => e.stopPropagation()}>
        <div className="compose-head">
          <h2>New Message</h2>
          <button className="compose-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <label className="compose-field">
          <span>To</span>
          <input
            ref={targetRef}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="+1 555 123 4567 or name@email.com"
          />
        </label>
        {displayName && <div className="compose-recipient">{displayName}</div>}
        {target.trim() && (
          <button
            className="compose-contact-link"
            onClick={() => onEditContact({ target: target.trim(), name: displayName || target.trim() })}
            type="button"
          >
            Add or edit contact
          </button>
        )}
        <textarea
          ref={textRef}
          className="compose-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="iMessage"
          rows={5}
        />
        {error && <div className="compose-error">{error}</div>}
        <div className="compose-actions">
          <button className="compose-secondary" onClick={onClose}>Cancel</button>
          <button className="compose-primary" onClick={send} disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="thread-empty">
      <div className="te-title">No Conversation Selected</div>
      <p className="te-line">Choose a conversation from the sidebar to read and reply.</p>
      <p className="te-hint">↑↓ move · E archive · Enter send · ⇧Enter newline</p>
    </div>
  );
}
