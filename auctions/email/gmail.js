/**
 * gmail.js — thin Gmail API wrapper (read-only).
 *
 * Auth artifacts live next to this file and are gitignored:
 *   credentials.json — OAuth "Desktop app" client downloaded from the Google
 *                      Cloud console (APIs & Services → Credentials)
 *   token.json       — issued token, written by auth.js
 *
 * Every consumer (parsers, sample dumper, fetch orchestrator) sees only the
 * normalized message shape returned by getMessage()/decodeMessage():
 *
 *   { id, threadId, from, to, subject, date, text, html, snippet,
 *     attachments: [{ filename, mimeType, size, attachmentId }] }
 *
 * This shape is the parser contract input — do not change it without updating
 * every parser and the committed fixtures.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
export const TOKEN_PATH       = path.join(__dirname, 'token.json');
export const SCOPES           = ['https://www.googleapis.com/auth/gmail.readonly'];

let _gmail;

/** Authorized Gmail client. Throws with a setup hint if auth hasn't run. */
export async function getGmail() {
  if (_gmail) return _gmail;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing ${CREDENTIALS_PATH}.\n` +
      'Create an OAuth "Desktop app" client in the Google Cloud console ' +
      '(enable the Gmail API first) and download it there. See auctions/email/README.md.'
    );
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Missing ${TOKEN_PATH}. Run: npm run email:auth`);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const key   = creds.installed || creds.web;
  const auth  = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris?.[0]);
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  // Persist refreshed access tokens so fetches keep working past the ~1h expiry.
  auth.on('tokens', tokens => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...tokens }, null, 2));
  });

  _gmail = google.gmail({ version: 'v1', auth });
  return _gmail;
}

/** List message ids matching a Gmail search query (e.g. "from:x after:169..."). */
export async function listMessages({ query, maxResults = 100 }) {
  const gmail = await getGmail();
  const ids = [];
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(maxResults - ids.length, 100),
      pageToken,
    });
    ids.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < maxResults);
  return ids; // [{ id, threadId }]
}

/** Fetch one message (format:full) and return the normalized shape. */
export async function getMessage(id) {
  const gmail = await getGmail();
  const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  return decodeMessage(data);
}

const b64 = data => (data ? Buffer.from(data, 'base64url').toString('utf8') : null);

/** Normalize a raw Gmail API message: headers + recursively decoded MIME parts. */
export function decodeMessage(apiMsg) {
  const headers = {};
  for (const h of apiMsg.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;

  let text = null, html = null;
  const attachments = [];

  const walk = part => {
    if (!part) return;
    if (part.parts) { part.parts.forEach(walk); return; }
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename:     part.filename,
        mimeType:     part.mimeType,
        size:         part.body.size,
        attachmentId: part.body.attachmentId,
      });
    } else if (part.mimeType === 'text/plain' && !text) {
      text = b64(part.body?.data);
    } else if (part.mimeType === 'text/html' && !html) {
      html = b64(part.body?.data);
    }
  };
  walk(apiMsg.payload);

  return {
    id:       apiMsg.id,
    threadId: apiMsg.threadId,
    from:     headers.from    || null,
    to:       headers.to      || null,
    subject:  headers.subject || null,
    date:     apiMsg.internalDate
                ? new Date(Number(apiMsg.internalDate)).toISOString()
                : (headers.date ? new Date(headers.date).toISOString() : null),
    text,
    html,
    snippet:  apiMsg.snippet || null,
    attachments,
  };
}
