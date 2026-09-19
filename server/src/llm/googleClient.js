import { config } from '../config.js';
import { getConnector, updateConnectorToken } from '../memory/connectorStore.js';

function assertConfigured() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error('Google integration is not configured (no GOOGLE_CLIENT_ID/SECRET set).');
  }
}

async function refreshAccessToken(userId, connector) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: connector.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await updateConnectorToken(userId, 'google', { accessToken: data.access_token, expiresAt });
  return data.access_token;
}

async function getValidAccessToken(userId) {
  assertConfigured();
  const connector = await getConnector(userId, 'google');
  if (!connector) throw new Error('Google isn\'t connected yet — connect it from Settings first.');

  const expiresAt = connector.expires_at ? new Date(connector.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return connector.access_token;
  return refreshAccessToken(userId, connector);
}

async function googleFetch(userId, url, options = {}) {
  const token = await getValidAccessToken(userId);
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  if (!res.ok) throw new Error(`Google API ${options.method || 'GET'} ${url} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

const MAX_OUTPUT = 4000;
const truncate = (s) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (truncated)` : s);

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function encodeBase64Url(data) {
  return Buffer.from(data, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractPlainTextBody(payload) {
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = extractPlainTextBody(part);
    if (found) return found;
  }
  return '';
}

export async function gmailSearch(userId, query, maxResults = 10) {
  const res = await googleFetch(
    userId,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
  );
  const data = await res.json();
  return { messages: (data.messages ?? []).map((m) => ({ id: m.id })) };
}

export async function gmailRead(userId, messageId) {
  const res = await googleFetch(
    userId,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
  );
  const data = await res.json();
  const headers = Object.fromEntries((data.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  return {
    id: data.id,
    from: headers.from,
    to: headers.to,
    subject: headers.subject,
    date: headers.date,
    snippet: data.snippet,
    body: truncate(extractPlainTextBody(data.payload) || data.snippet || ''),
  };
}

// Deliberately creates a DRAFT, never sends — actually sending email on the
// user's behalf without a per-instance confirmation isn't something to
// automate silently.
export async function gmailCreateDraft(userId, { to, subject, body }) {
  const raw = encodeBase64Url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`);
  const res = await googleFetch(userId, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } }),
  });
  const data = await res.json();
  return { draftId: data.id, note: 'Draft created — go to Gmail to review and send it yourself.' };
}

export async function driveListFiles(userId, query, pageSize = 20) {
  const q = query ? `&q=${encodeURIComponent(query)}` : '';
  const res = await googleFetch(
    userId,
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&fields=files(id,name,mimeType,modifiedTime)${q}`,
  );
  const data = await res.json();
  return { files: data.files ?? [] };
}

export async function driveReadFile(userId, fileId) {
  const meta = await (await googleFetch(userId, `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`)).json();

  if (meta.mimeType === 'application/vnd.google-apps.document') {
    const res = await googleFetch(userId, `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`);
    return { name: meta.name, mimeType: meta.mimeType, content: truncate(await res.text()) };
  }
  if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await googleFetch(userId, `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`);
    return { name: meta.name, mimeType: meta.mimeType, content: truncate(await res.text()) };
  }
  if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
    return { name: meta.name, mimeType: meta.mimeType, error: 'unsupported Google file type for reading (only Docs/Sheets export supported)' };
  }

  const res = await googleFetch(userId, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return { name: meta.name, mimeType: meta.mimeType, content: truncate(await res.text()) };
}

export async function driveWriteFile(userId, { fileId, name, content, mimeType = 'text/plain' }) {
  if (fileId) {
    await googleFetch(userId, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: content,
    });
    return { fileId, ok: true };
  }

  const created = await (
    await googleFetch(userId, 'https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  ).json();

  await googleFetch(userId, `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': mimeType },
    body: content,
  });

  return { fileId: created.id, ok: true };
}
