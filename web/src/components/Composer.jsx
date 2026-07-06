import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { SparkIcon, SpinnerIcon, ArrowUpIcon } from './Icons.jsx';

// Per-chat composer memory survives switching threads (module scope, not server state).
const memory = new Map();

export default function Composer({ guid, chatName, aiAvailable, onSend }) {
  const saved = memory.get(guid);
  const [text, setText] = useState(saved?.text ?? '');
  const [draftId, setDraftId] = useState(saved?.draftId ?? null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState(null);
  const taRef = useRef(null);

  useEffect(() => {
    memory.set(guid, { text, draftId });
  }, [guid, text, draftId]);

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const doDraft = async () => {
    if (drafting || !aiAvailable) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await api.requestDraft(guid);
      setText(res?.text ?? '');
      setDraftId(res?.draftId ?? null);
      taRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  };

  const doSend = () => {
    const t = text.trim();
    if (!t) return;
    const keep = { text, draftId };
    setText('');
    setDraftId(null);
    setError(null);
    onSend(t, keep.draftId).catch((err) => {
      setText(keep.text);
      setDraftId(keep.draftId);
      setError(err.message || 'Send failed');
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend();
    }
  };

  const hasText = !!text.trim();

  return (
    <div className="composer">
      {error && (
        <div className="composer-error" role="alert">
          <span>{error}</span>
          <button className="dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {draftId != null && !error && (
        <div className="draft-tag">
          <SparkIcon size={11} /> AI draft — edit freely, Joey learns from your changes.
        </div>
      )}
      <div className="composer-row">
        <button
          className="ai-btn"
          onClick={doDraft}
          disabled={!aiAvailable || drafting}
          title={aiAvailable ? 'Draft with AI' : 'Set ANTHROPIC_API_KEY to enable drafting'}
          aria-label="Draft with AI"
        >
          {drafting ? <SpinnerIcon size={16} /> : <SparkIcon size={16} />}
        </button>
        <div className="pill">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder="iMessage"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={`Message ${chatName}`}
          />
          <button
            className={`send-btn ${hasText ? 'show' : ''}`}
            onClick={doSend}
            disabled={!hasText}
            tabIndex={hasText ? 0 : -1}
            aria-label="Send"
            title="Send (Enter)"
          >
            <ArrowUpIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
