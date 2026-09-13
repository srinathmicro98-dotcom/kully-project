// The chat/orchestrator box (starts/stops on demand) — everything else
// (login, connect/disconnect, status, history, skills, push) is served by
// this same page's own origin, since that's the always-on control-plane Lambda.
const CHAT_URL = 'https://kully-cofounder.duckdns.org';
const VAPID_PUBLIC_KEY = 'BLsbygSoKx_UIYEylUFATOeyWJAO35gH6EGYSEsp5s6OK7kTyDTgafb3S5NCXws3_Fcj6g63j1xo4DCmzhG_qOU';

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
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const skillsBtn = document.getElementById('skillsBtn');
const skillsPanel = document.getElementById('skillsPanel');
const skillsList = document.getElementById('skillsList');
const skillsLibraryList = document.getElementById('skillsLibraryList');
const newSkillBtn = document.getElementById('newSkillBtn');
const notifyBtn = document.getElementById('notifyBtn');
const projectInput = document.getElementById('projectInput');

const state = {
  userId: 'default-user',
  project: localStorage.getItem('kully_project') || 'default',
  conversationId: null,
  token: localStorage.getItem('kully_token') || null,
};

projectInput.value = state.project;
projectInput.addEventListener('change', () => {
  state.project = projectInput.value.trim() || 'default';
  localStorage.setItem('kully_project', state.project);
});

let healthPollTimer = null;
let notifiedThisConnect = false;

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

async function notifyReady() {
  if (notifiedThisConnect) return;
  notifiedThisConnect = true;
  try {
    await controlFetch('/push/notify-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: state.userId }),
    });
  } catch {
    // best-effort — not having a notification is not worth surfacing an error for
  }
}

function pollUntilHealthy() {
  clearInterval(healthPollTimer);
  notifiedThisConnect = false;
  setBanner('Connecting… waking up your server, this can take up to a minute.');
  setChatEnabled(false);

  healthPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${CHAT_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        clearInterval(healthPollTimer);
        setBanner(null);
        setChatEnabled(true);
        notifyReady();
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
    refreshNotifyButton();
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
        project: state.project,
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

// ---- History panel ----

function openPanel(panel) {
  historyPanel.hidden = panel !== historyPanel;
  skillsPanel.hidden = panel !== skillsPanel;
  panel.hidden = false;
}

function closePanels() {
  historyPanel.hidden = true;
  skillsPanel.hidden = true;
}

document.querySelectorAll('.closePanelBtn').forEach((btn) => btn.addEventListener('click', closePanels));

function formatRelativeDate(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

async function loadHistory() {
  historyList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/conversations?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const conversations = await res.json();

    historyList.innerHTML = '';
    if (!conversations.length) {
      historyList.textContent = 'No past conversations yet.';
      return;
    }
    for (const convo of conversations) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = convo.title || '(untitled)';
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = formatRelativeDate(convo.updated_at);
      item.appendChild(title);
      item.appendChild(date);
      item.addEventListener('click', () => loadConversation(convo.id));
      historyList.appendChild(item);
    }
  } catch (err) {
    historyList.textContent = `Could not load history: ${err.message}. Is your server connected?`;
  }
}

async function loadConversation(conversationId) {
  try {
    const res = await controlFetch(`${CHAT_URL}/conversations/${conversationId}/messages`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const msgs = await res.json();

    messagesEl.innerHTML = '';
    for (const m of msgs) addMessage(m.role, m.content, m.agent);
    state.conversationId = conversationId;
    closePanels();
  } catch (err) {
    setBanner(`Could not load that conversation: ${err.message}`);
  }
}

historyBtn.addEventListener('click', () => {
  openPanel(historyPanel);
  loadHistory();
});

historyPanel.querySelector('.newChatBtn').addEventListener('click', () => {
  state.conversationId = null;
  messagesEl.innerHTML = '';
  closePanels();
});

// ---- Skills panel ----

async function loadSkills() {
  skillsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/agents`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const configs = await res.json();

    skillsList.innerHTML = '';
    for (const cfg of configs) {
      const item = document.createElement('div');
      item.className = 'skill-item';

      const label = document.createElement('label');
      label.textContent = cfg.name;
      const textarea = document.createElement('textarea');
      textarea.value = cfg.systemPrompt;
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save';
      const savedTag = document.createElement('span');
      savedTag.className = 'saved';
      savedTag.textContent = 'Saved ✓';
      savedTag.hidden = true;

      saveBtn.addEventListener('click', async () => {
        savedTag.hidden = true;
        try {
          const putRes = await controlFetch(`${CHAT_URL}/agents/${cfg.name}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt: textarea.value }),
          });
          if (!putRes.ok) throw new Error(`status ${putRes.status}`);
          savedTag.hidden = false;
          setTimeout(() => (savedTag.hidden = true), 3000);
        } catch (err) {
          alert(`Could not save: ${err.message}`);
        }
      });

      item.appendChild(label);
      item.appendChild(textarea);
      item.appendChild(saveBtn);
      item.appendChild(savedTag);
      skillsList.appendChild(item);
    }
  } catch (err) {
    skillsList.textContent = `Could not load skills: ${err.message}. Is your server connected?`;
  }
}

skillsBtn.addEventListener('click', () => {
  openPanel(skillsPanel);
  loadSkills();
  loadSkillsLibrary();
});

// ---- Skills library (invokable skills, not just agent prompts) ----

function renderSkillEntry({ name, description, body }, { isNew = false } = {}) {
  const item = document.createElement('div');
  item.className = 'skill-item';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'skill-name (e.g. api-design)';
  nameInput.value = name || '';
  nameInput.disabled = !isNew; // the name is the primary key — don't let it change once created

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.placeholder = 'When should the dev agent use this?';
  descInput.value = description || '';

  const bodyArea = document.createElement('textarea');
  bodyArea.placeholder = 'Full instructions the agent sees once it invokes this skill.';
  bodyArea.value = body || '';

  const row = document.createElement('div');
  row.className = 'row';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = isNew ? 'Create' : 'Save';
  const savedTag = document.createElement('span');
  savedTag.className = 'saved';
  savedTag.textContent = 'Saved ✓';
  savedTag.hidden = true;
  row.appendChild(saveBtn);
  row.appendChild(savedTag);

  if (!isNew) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'deleteBtn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete skill "${name}"?`)) return;
      try {
        const res = await controlFetch(`${CHAT_URL}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        item.remove();
      } catch (err) {
        alert(`Could not delete: ${err.message}`);
      }
    });
    row.appendChild(deleteBtn);
  }

  saveBtn.addEventListener('click', async () => {
    const skillName = nameInput.value.trim();
    if (!skillName) return alert('Name is required.');
    savedTag.hidden = true;
    try {
      const res = await controlFetch(`${CHAT_URL}/skills/${encodeURIComponent(skillName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descInput.value, body: bodyArea.value }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      savedTag.hidden = false;
      setTimeout(() => (savedTag.hidden = true), 3000);
      if (isNew) loadSkillsLibrary();
    } catch (err) {
      alert(`Could not save: ${err.message}`);
    }
  });

  item.appendChild(nameInput);
  item.appendChild(descInput);
  item.appendChild(bodyArea);
  item.appendChild(row);
  return item;
}

async function loadSkillsLibrary() {
  skillsLibraryList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/skills`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const skills = await res.json();

    skillsLibraryList.innerHTML = '';
    for (const skill of skills) {
      skillsLibraryList.appendChild(renderSkillEntry(skill));
    }
  } catch (err) {
    skillsLibraryList.textContent = `Could not load skills library: ${err.message}. Is your server connected?`;
  }
}

newSkillBtn.addEventListener('click', () => {
  skillsLibraryList.appendChild(renderSkillEntry({}, { isNew: true }));
});

// ---- Push notifications ----

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function refreshNotifyButton() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    notifyBtn.hidden = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  notifyBtn.classList.toggle('active', !!sub);
}

notifyBtn.addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      await existing.unsubscribe();
      notifyBtn.classList.remove('active');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    await controlFetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: state.userId, subscription: sub.toJSON() }),
    });
    notifyBtn.classList.add('active');
  } catch (err) {
    alert(`Could not enable notifications: ${err.message}`);
  }
});

// ---- Service worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // non-fatal — app still works without offline caching
  });
}

if (state.token) {
  showApp();
  refreshStatus();
  refreshNotifyButton();
} else {
  showLogin();
}
