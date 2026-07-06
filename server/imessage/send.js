// Sends messages via AppleScript through Messages.app.
// Injection-safe: target and text always arrive via argv, never interpolated
// into the script source.
import { execFile } from 'node:child_process';

const OSA_TIMEOUT_MS = 15000;

const SCRIPT_CHAT_ID = `on run argv
  set targetId to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    send msgText to chat id targetId
  end tell
end run`;

const SCRIPT_IMESSAGE = `on run argv
  set targetId to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set theAccount to 1st account whose service type = iMessage
    send msgText to participant targetId of theAccount
  end tell
end run`;

const SCRIPT_SMS = `on run argv
  set targetId to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set theAccount to 1st account whose service type = SMS
    send msgText to participant targetId of theAccount
  end tell
end run`;

function runOsascript(script, target, text) {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', script, '--', target, text],
      { timeout: OSA_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const detail = err.killed
          ? `timed out after ${OSA_TIMEOUT_MS / 1000}s`
          : (stderr || err.message || 'unknown error').trim();
        reject(new Error(`osascript failed: ${detail}`));
      }
    );
  });
}

export async function sendMessage({ chatGuid, chatIdentifier, isGroup, service, text }) {
  if (!text || !String(text).trim()) throw new Error('sendMessage: text is required');
  text = String(text);

  if (process.env.JOEY_DRY_RUN === '1') {
    console.log(`[dry-run] would send to ${chatGuid}: ${text}`);
    return { ok: true, dryRun: true };
  }

  if (isGroup) {
    if (!chatGuid) throw new Error('sendMessage: chatGuid required for group send');
    await runOsascript(SCRIPT_CHAT_ID, chatGuid, text);
    return { ok: true, dryRun: false };
  }

  const participant = chatIdentifier || chatGuid;
  if (!participant) throw new Error('sendMessage: no target (chatIdentifier/chatGuid)');

  if (String(service || '').toLowerCase() === 'imessage') {
    await runOsascript(SCRIPT_IMESSAGE, participant, text);
  } else {
    // SMS (and RCS) route through the SMS account; fall back to the chat id.
    try {
      await runOsascript(SCRIPT_SMS, participant, text);
    } catch (err) {
      if (!chatGuid) throw err;
      await runOsascript(SCRIPT_CHAT_ID, chatGuid, text);
    }
  }
  return { ok: true, dryRun: false };
}
