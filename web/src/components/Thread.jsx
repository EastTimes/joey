import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';
import Composer from './Composer.jsx';
import { dayLabel, sameDay, timeOfDay } from '../format.js';
import {
  FlagIcon,
  CalendarIcon,
  ReplyArrowIcon,
  ChevronUpIcon,
  ArchiveIcon,
  UnarchiveIcon,
  ContactEditIcon,
} from './Icons.jsx';

const PAGE = 60;

function mergeMessages(prev, incoming) {
  const map = new Map();
  for (const m of prev || []) map.set(m.rowid, m);
  for (const m of incoming || []) map.set(m.rowid, m);
  return [...map.values()].sort((a, b) => a.rowid - b.rowid);
}

export default function Thread({
  chat,
  refreshSignal,
  aiAvailable,
  onArchiveToggle,
  onOpenDm,
  onEditContact,
  onSent,
  pushToast,
}) {
  const guid = chat.guid;
  const [messages, setMessages] = useState(null); // null = loading
  const [pending, setPending] = useState([]); // optimistic sends
  const [loadError, setLoadError] = useState(null);
  const [olderState, setOlderState] = useState('idle'); // idle | loading | done
  const scrollerRef = useRef(null);
  const stickRef = useRef(true); // pinned to bottom?
  const preserveRef = useRef(null); // scroll anchor while prepending older
  const firstLoadRef = useRef(false);

  const pollLatest = useCallback(async () => {
    try {
      const data = await api.getMessages(guid, { limit: PAGE });
      const incoming = data.messages || [];
      setMessages((prev) => mergeMessages(prev, incoming));
      // A pending bubble is confirmed once its text shows up as a real from-me row.
      setPending((p) =>
        p.filter(
          (item) =>
            item.state === 'dryrun' ||
            !incoming.some(
              (m) => m.isFromMe && (m.text || '').trim() === item.text && m.dateMs >= item.sentAt - 120_000
            )
        )
      );
      setLoadError(null);
      if (!firstLoadRef.current) {
        firstLoadRef.current = true;
        if (incoming.length < PAGE) setOlderState('done');
      }
    } catch (err) {
      setLoadError(err.message);
    }
  }, [guid]);

  useEffect(() => {
    pollLatest();
    const t = setInterval(() => {
      if (!document.hidden) pollLatest();
    }, 3000);
    return () => clearInterval(t);
  }, [pollLatest]);

  // SSE said chat.db changed — refetch right away instead of waiting for the poll.
  useEffect(() => {
    if (refreshSignal) pollLatest();
  }, [refreshSignal, pollLatest]);

  const loadOlder = useCallback(async () => {
    if (!messages || messages.length === 0 || olderState !== 'idle') return;
    setOlderState('loading');
    const el = scrollerRef.current;
    preserveRef.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    try {
      const data = await api.getMessages(guid, { limit: PAGE, before: messages[0].rowid });
      const older = data.messages || [];
      setMessages((prev) => mergeMessages(prev, older));
      setOlderState(older.length < PAGE ? 'done' : 'idle');
    } catch (err) {
      preserveRef.current = null;
      setOlderState('idle');
      pushToast(`Couldn't load older messages — ${err.message}`);
    }
  }, [guid, messages, olderState, pushToast]);

  // Scroll management: keep anchored when prepending, stick to bottom otherwise.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (preserveRef.current) {
      el.scrollTop = preserveRef.current.top + (el.scrollHeight - preserveRef.current.height);
      preserveRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSend = useCallback(
    async (text, draftId) => {
      const item = {
        key: `p${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        sentAt: Date.now(),
        state: 'sending',
      };
      setPending((p) => [...p, item]);
      stickRef.current = true;
      try {
        const res = await api.sendMessage(guid, text, draftId);
        setPending((p) =>
          p.map((x) => (x.key === item.key ? { ...x, state: res?.dryRun ? 'dryrun' : 'sent' } : x))
        );
        onSent();
        pollLatest();
      } catch (err) {
        setPending((p) => p.filter((x) => x.key !== item.key));
        throw err;
      }
    },
    [guid, onSent, pollLatest]
  );

  const rows = useMemo(() => {
    const out = [];
    let prev = null;
    for (const m of messages || []) {
      if (!prev || !sameDay(prev.dateMs, m.dateMs)) {
        out.push({
          type: 'day',
          key: `day-${m.rowid}`,
          label: dayLabel(m.dateMs),
          time: timeOfDay(m.dateMs),
        });
        prev = null;
      }
      const showSender =
        chat.isGroup && !m.isFromMe && (!prev || prev.isFromMe !== m.isFromMe || prev.senderId !== m.senderId);
      const cont =
        !!prev &&
        prev.isFromMe === m.isFromMe &&
        prev.senderId === m.senderId &&
        m.dateMs - prev.dateMs < 5 * 60_000;
      out.push({ type: 'msg', key: m.guid || `r${m.rowid}`, msg: m, showSender, cont });
      prev = m;
    }
    for (const p of pending) out.push({ type: 'pending', key: p.key, item: p });
    return out;
  }, [messages, pending, chat.isGroup]);

  const name = chat.name || chat.chatIdentifier || chat.guid;
  const triage = chat.triage;
  const followup = chat.followup;
  const participants = chat.participantDetails || (chat.participants || []).map((id) => ({ id, name: id }));
  const sub = chat.isGroup
    ? `To: ${participants.map((p) => p.name || p.id).join(', ')}`
    : [chat.chatIdentifier, chat.serviceName].filter(Boolean).join(' · ');

  return (
    <div className="thread">
      <header className="thread-head">
        <div className="th-side th-left" />
        <div className="th-center">
          <h2 className="th-name">{name}</h2>
          {!chat.isGroup && sub && (
            <div className="th-sub" title={sub}>
              {sub}
            </div>
          )}
          {chat.isGroup && participants.length > 0 && (
            <div className="th-people" title={sub}>
              {participants.map((p) => (
                <span className="th-person-wrap" key={p.id}>
                  <button
                    className="th-person"
                    onClick={() => onOpenDm(p)}
                    title={`Message ${p.name || p.id}`}
                  >
                    {p.name || p.id}
                  </button>
                  <button
                    className="th-person-edit"
                    onClick={() => onEditContact({ target: p.id, name: p.name })}
                    title={`Edit contact ${p.name || p.id}`}
                    aria-label={`Edit contact ${p.name || p.id}`}
                  >
                    <ContactEditIcon size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="th-side th-right">
          {triage?.timeSensitive && (
            <div className="th-triage" title={triage.reason}>
              <FlagIcon size={9} />
              <span className="th-reason">{triage.reason}</span>
              {triage.deadline && <span className="th-deadline">{triage.deadline}</span>}
            </div>
          )}
          {!triage?.timeSensitive && followup?.kind === 'calendar_pending' && followup.action?.calendarUrl && (
            <a
              className="th-action-btn"
              href={followup.action.calendarUrl}
              target="_blank"
              rel="noreferrer"
              title="Create Google Calendar invite"
            >
              <CalendarIcon size={11} />
              <span>Send invite</span>
            </a>
          )}
          {!triage?.timeSensitive && followup && followup.kind !== 'calendar_pending' && (
            <div className="th-triage th-followup" title={followup.reason}>
              <ReplyArrowIcon size={9} />
              <span className="th-reason">{followup.reason}</span>
            </div>
          )}
          {!triage?.timeSensitive && followup?.kind === 'calendar_pending' && (
            <div className="th-triage th-action" title={followup.reason}>
              <CalendarIcon size={9} />
              <span className="th-reason">{followup.reason}</span>
            </div>
          )}
          <button
            className="icon-btn"
            onClick={() => onArchiveToggle(chat)}
            title={chat.archived ? 'Unarchive (E or ⌘⇧E)' : 'Archive (E or ⌘⇧E)'}
            aria-label={chat.archived ? 'Unarchive' : 'Archive'}
          >
            {chat.archived ? <UnarchiveIcon size={15} /> : <ArchiveIcon size={15} />}
          </button>
        </div>
      </header>

      {loadError && messages && <div className="thread-warn">Connection hiccup — retrying. ({loadError})</div>}

      <div className="scroller" ref={scrollerRef} onScroll={onScroll}>
        {messages === null && !loadError && <div className="scroller-note">Loading…</div>}
        {messages === null && loadError && (
          <div className="scroller-note err">
            Couldn't load messages — {loadError}{' '}
            <button className="retry-btn" onClick={pollLatest}>
              Retry
            </button>
          </div>
        )}
        {messages && messages.length > 0 && olderState !== 'done' && (
          <div className="load-older-wrap">
            <button className="load-older" onClick={loadOlder} disabled={olderState === 'loading'}>
              <ChevronUpIcon /> {olderState === 'loading' ? 'Loading…' : 'Load Older Messages'}
            </button>
          </div>
        )}
        {messages && messages.length === 0 && <div className="scroller-note">No messages yet.</div>}
        {rows.map((row) => {
          if (row.type === 'day') {
            return (
              <div className="day-sep" key={row.key}>
                <span>
                  <strong>{row.label}</strong> {row.time}
                </span>
              </div>
            );
          }
          if (row.type === 'pending') {
            return <PendingBubble key={row.key} item={row.item} />;
          }
          return (
            <Bubble
              key={row.key}
              msg={row.msg}
              showSender={row.showSender}
              cont={row.cont}
              onOpenDm={onOpenDm}
              onEditContact={onEditContact}
            />
          );
        })}
      </div>

      <Composer key={guid} guid={guid} chatName={name} aiAvailable={aiAvailable} onSend={handleSend} />
    </div>
  );
}

function Bubble({ msg, showSender, cont, onOpenDm, onEditContact }) {
  const mine = msg.isFromMe;
  const sms = msg.service !== 'iMessage';
  const reactions = msg.reactions || [];
  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'} ${cont ? 'cont' : ''} ${reactions.length ? 'has-rx' : ''}`}>
      <div className="msg-stack">
        {showSender && (
          <div className="msg-sender-row">
            <button
              className="msg-sender"
              onClick={() => onOpenDm({ id: msg.senderId, name: msg.senderName || msg.senderId || 'Unknown' })}
              title={`Message ${msg.senderName || msg.senderId || 'Unknown'}`}
            >
              {msg.senderName || msg.senderId || 'Unknown'}
            </button>
            <button
              className="msg-sender-edit"
              onClick={() => onEditContact({ target: msg.senderId, name: msg.senderName || msg.senderId })}
              title={`Edit contact ${msg.senderName || msg.senderId || 'Unknown'}`}
              aria-label={`Edit contact ${msg.senderName || msg.senderId || 'Unknown'}`}
            >
              <ContactEditIcon size={10} />
            </button>
          </div>
        )}
        <div className="bubble-wrap">
          <div className={`bubble ${mine ? (sms ? 'b-sms' : 'b-mine') : 'b-theirs'}`}>
            {msg.text || (msg.hasAttachments ? <span className="attach-note">Attachment</span> : ' ')}
          </div>
          {reactions.length > 0 && <Reactions reactions={reactions} />}
        </div>
      </div>
      <span className="msg-time">{timeOfDay(msg.dateMs)}</span>
    </div>
  );
}

// Tapbacks as a small pill overlapping the bubble's top corner, on the side
// opposite the one the bubble hugs. Same emoji is deduped with a ×N count.
function Reactions({ reactions }) {
  const counts = new Map();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  return (
    <span className="rx-pill" aria-label="Reactions">
      {[...counts.entries()].map(([emoji, n]) => (
        <span className="rx-item" key={emoji}>
          {emoji}
          {n > 1 && <span className="rx-count">{n}</span>}
        </span>
      ))}
    </span>
  );
}

function PendingBubble({ item }) {
  const label =
    item.state === 'sending' ? 'Sending…' : item.state === 'dryrun' ? 'Dry run — not delivered' : 'Delivered';
  return (
    <div className={`msg-row mine pending pending-${item.state}`}>
      <div className="msg-stack">
        <div className="bubble b-mine">{item.text}</div>
        <div className="pending-label">{label}</div>
      </div>
    </div>
  );
}
