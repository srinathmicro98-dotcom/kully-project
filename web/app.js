// The chat/orchestrator box (starts/stops on demand) — everything else
// (login, connect/disconnect, status) is served by this same page's own
// origin, since that's the always-on control-plane Lambda.
const CHAT_URL = 'https://kully-cofounder.duckdns.org';

const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = composer.querySelector('button[type="submit"]');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const signOutBtn = document.getElementById('signOutBtn');
const bannerEl = document.getElementById('banner');

const state = {
  userId: 'default-user',
  conversationId: null,
  token: localStorage.getItem('kully_token') || null,
};

let healthPollTimer = null;

function setBanner(text) {
  bannerEl.hidden = !text;
  bannerEl.textContent = text || '';
}

function setChatEnabled(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  connectBtn.hidden = enabled;
  disconnectBtn.hidden = !enabled;
}

function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = false;
}

function showLogin() {
  clearInterval(healthPollTimer);
  state.token = null;
  localStorage.removeItem('kully_token');
  appEl.hidden = true;
  loginScreen.hidden = false;
}

async function controlFetch(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${state.token}`,
    },
  });
}

function pollUntilHealthy() {
  clearInterval(healthPollTimer);
  setBanner('Connecting… waking up your server, this can take up to a minute.');
  setChatEnabled(false);

  healthPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${CHAT_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        clearInterval(healthPollTimer);
        setBanner(null);
        setChatEnabled(true);
      }
    } catch {
      // still booting — keep polling
    }
  }, 3000);
}

async function refreshStatus() {
  try {
    const res = await controlFetch('/status');
    if (res.status === 401) return showLogin();
    const { state: ec2State } = await res.json();

    if (ec2State === 'running' || ec2State === 'pending') {
      pollUntilHealthy();
    } else {
      clearInterval(healthPollTimer);
      setBanner(null);
      setChatEnabled(false);
    }
  } catch {
    setBanner('Could not reach the control server. Try again shortly.');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) throw new Error('bad credentials');
    const data = await res.json();
    state.token = data.token;
    localStorage.setItem('kully_token', data.token);
    showApp();
    refreshStatus();
  } catch {
    loginError.hidden = false;
  }
});

connectBtn.addEventListener('click', async () => {
  setBanner('Starting your server…');
  try {
    await controlFetch('/connect', { method: 'POST' });
    pollUntilHealthy();
  } catch {
    setBanner('Could not start the server. Try again shortly.');
  }
});

disconnectBtn.addEventListener('click', async () => {
  clearInterval(healthPollTimer);
  setChatEnabled(false);
  try {
    await controlFetch('/disconnect', { method: 'POST' });
    setBanner('Disconnected.');
  } catch {
    setBanner('Could not stop the server — it may still be running.');
  }
});

signOutBtn.addEventListener('click', showLogin);

function addMessage(role, text, agent) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (agent) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = agent;
    div.appendChild(tag);
  }
  div.appendChild(document.createTextNode(text));
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';

  try {
    const res = await fetch(`${CHAT_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        user_id: state.userId,
        conversation_id: state.conversationId,
        message,
      }),
    });

    if (res.status === 401) return showLogin();
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    state.conversationId = data.conversation_id;
    addMessage('assistant', data.reply, data.agent);
  } catch (err) {
    addMessage('assistant', `Error: ${err.message}`, 'system');
  }
});

if (state.token) {
  showApp();
  refreshStatus();
} else {
  showLogin();
}
