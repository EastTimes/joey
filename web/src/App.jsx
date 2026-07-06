import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Thread from './components/Thread.jsx';
import Toasts from './components/Toasts.jsx';

let toastSeq = 0;

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || '');

export default function App() {
  const [status, setStatus] = useState(null);
  const [serverUp, setServerUp] = useState(true);
  const [view, setView] = useState('inbox'); // 'inbox' | 'archived'
  const [chats, setChats] = useState(null); // null = loading
  const [chatsError, setChatsError] = useState(null);
  const [activeGuid, setActiveGuid] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [refreshingTriage, setRefreshingTriage] = useState(false);
  const lastActiveChat = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

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

  // Server status: on boot, then every 15s.
  useEffect(() => {
    let gone = false;
    const load = async () => {
      try {
        const s = await api.getStatus();
        if (!gone) {
          setStatus(s);
          setServerUp(true);
        }
      } catch {
        if (!gone) setServerUp(false);
      }
    };
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, []);

  // Keep a snapshot of the open chat so the thread survives list churn
  // (e.g. the chat just got archived out of the current filter).
  const activeChat = useMemo(() => {
    const found = (chats || []).find((c) => c.guid === activeGuid);
    if (found) {
      lastActiveChat.current = found;
      return found;
    }
    if (activeGuid && lastActiveChat.current?.guid === activeGuid) {
      return lastActiveChat.current;
    }
    return null;
  }, [chats, activeGuid]);

  // Sidebar order (also used by keyboard nav & ⌘E next-selection):
  // time-sensitive first, then the rest.
  const orderedGuids = useMemo(() => {
    if (!chats) return [];
    if (view === 'archived') return chats.map((c) => c.guid);
    const ts = chats.filter((c) => c.triage?.timeSensitive);
    const rest = chats.filter((c) => !c.triage?.timeSensitive);
    return [...ts, ...rest].map((c) => c.guid);
  }, [chats, view]);

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
      const res = await api.refreshTriage();
      await loadChats(view);
      const n = res?.updated ?? 0;
      pushToast(n > 0 ? `Triage refreshed — ${n} chat${n === 1 ? '' : 's'} classified` : 'Triage is up to date', 'info');
    } catch (err) {
      pushToast(`Triage failed — ${err.message}`);
    } finally {
      setRefreshingTriage(false);
    }
  }, [refreshingTriage, view, loadChats, pushToast]);

  const handleSent = useCallback(() => loadChats(view), [view, loadChats]);

  // ⌘E (Ctrl+E off-Mac): archive the selected chat — unarchive when in the
  // archived view. Capture phase so it wins even while the composer has focus.
  useEffect(() => {
    const onKey = (e) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
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
          refreshing={refreshingTriage}
          status={status}
          serverUp={serverUp}
        />
        <main className="thread-pane">
          {activeChat ? (
            <Thread
              key={activeChat.guid}
              chat={activeChat}
              aiAvailable={!!status?.aiAvailable}
              onArchiveToggle={handleArchiveToggle}
              onSent={handleSent}
              pushToast={pushToast}
            />
          ) : (
            <EmptyThread />
          )}
        </main>
      </div>
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="thread-empty">
      <div className="te-title">No Conversation Selected</div>
      <p className="te-line">Choose a conversation from the sidebar to read and reply.</p>
      <p className="te-hint">↑↓ move · ⌘E archive · Enter send · ⇧Enter newline</p>
    </div>
  );
}
