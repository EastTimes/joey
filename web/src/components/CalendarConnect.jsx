import { useCallback, useState } from 'react';
import * as api from '../api.js';

export default function CalendarConnect({ status, onConnected }) {
  const cal = status?.calendar;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const saveCredentials = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveCalendarCredentials(clientId.trim(), clientSecret.trim());
      setClientId('');
      setClientSecret('');
      onConnected?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [clientId, clientSecret, onConnected]);

  if (!cal) return null;

  if (cal.connected) {
    return (
      <div className="cal-foot cal-foot-ok">
        <span className="cal-foot-label">Google Calendar</span>
        <span className="cal-foot-email" title={cal.email}>{cal.email}</span>
      </div>
    );
  }

  if (cal.oauthReady) {
    return (
      <div className="cal-foot">
        <p className="cal-foot-step">Link Google Calendar to verify sent invites.</p>
        <a className="cal-foot-btn cal-foot-btn-primary" href="/api/calendar/connect">
          Sign in with Google
        </a>
      </div>
    );
  }

  return (
    <div className="cal-foot">
      <p className="cal-foot-step">Calendar sign-in needs a one-time OAuth setup on this machine.</p>
      <button type="button" className="cal-foot-toggle" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? '▾' : '▸'} Set up Google OAuth
      </button>
      {showAdvanced && (
        <div className="cal-foot-panel">
          <p className="cal-foot-step">
            <strong>Option A</strong> — env vars (recommended for sharing):
          </p>
          <code className="cal-foot-uri block">JOEY_GOOGLE_CLIENT_ID=…{'\n'}JOEY_GOOGLE_CLIENT_SECRET=…</code>
          <p className="cal-foot-step">
            <strong>Option B</strong> — paste OAuth client below (Web app, redirect URI):
          </p>
          <code className="cal-foot-uri">{status?.calendar?.redirectUri || 'http://127.0.0.1:3456/api/calendar/callback'}</code>
          <input
            className="cal-foot-input"
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
          <input
            className="cal-foot-input"
            placeholder="Client Secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
          {error && <div className="cal-foot-err">{error}</div>}
          <button type="button" className="cal-foot-btn" disabled={saving} onClick={saveCredentials}>
            {saving ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
      )}
    </div>
  );
}