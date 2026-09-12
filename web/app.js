const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const serverUrlEl = document.getElementById('serverUrl');
const signOutBtn = document.getElementById('signOut');

const state = {
  userId: 'default-user',
  conversationId: null,
  token: localStorage.getItem('kully_token') || null,
};

serverUrlEl.value = localStorage.getItem('kully_server_url') || '';

function currentServerUrl() {
  return serverUrlEl.value.trim().replace(/\/$/, '');
}

function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = false;
}

function showLogin() {
  state.token = null;
  localStorage.removeItem('kully_token');
  appEl.hidden = true;
  loginScreen.hidden = false;
}

async function authedFetch(path, options = {}) {
  const res = await fetch(`${currentServerUrl()}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${state.token}`,
    },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Session expired, please sign in again.');
  }
  return res;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;

  const serverUrl = currentServerUrl();
  if (!serverUrl) {
    alert('Enter your server URL first.');
    return;
  }
  localStorage.setItem('kully_server_url', serverUrl);

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(`${serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) throw new Error('bad credentials');
    const data = await res.json();
    state.token = data.token;
    localStorage.setItem('kully_token', data.token);
    showApp();
  } catch {
    loginError.hidden = false;
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
    const res = await authedFetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: state.userId,
        conversation_id: state.conversationId,
        message,
      }),
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    state.conversationId = data.conversation_id;
    addMessage('assistant', data.reply, data.agent);
  } catch (err) {
    addMessage('assistant', `Error: ${err.message}`, 'system');
  }
});

// On load: if we have a token, verify it before showing the chat UI.
(async function init() {
  if (!state.token || !currentServerUrl()) {
    showLogin();
    return;
  }
  try {
    const res = await fetch(`${currentServerUrl()}/auth/verify`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (res.ok) {
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
