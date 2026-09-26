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
const projectsBtn = document.getElementById('projectsBtn');
const projectsPanel = document.getElementById('projectsPanel');
const projectsList = document.getElementById('projectsList');
const memoryProjectName = document.getElementById('memoryProjectName');
const projectFactsList = document.getElementById('projectFactsList');
const addFactBtn = document.getElementById('addFactBtn');
const artifactsBtn = document.getElementById('artifactsBtn');
const artifactsPanel = document.getElementById('artifactsPanel');
const artifactsList = document.getElementById('artifactsList');
const artifactViewer = document.getElementById('artifactViewer');
const backToArtifactsBtn = document.getElementById('backToArtifactsBtn');
const artifactTitle = document.getElementById('artifactTitle');
const copyArtifactBtn = document.getElementById('copyArtifactBtn');
const downloadArtifactBtn = document.getElementById('downloadArtifactBtn');
const artifactContent = document.getElementById('artifactContent');
const toolsList = document.getElementById('toolsList');
const connectorsList = document.getElementById('connectorsList');
const responseStyleToggle = document.getElementById('responseStyleToggle');
const usageSummary = document.getElementById('usageSummary');
const scheduledTasksList = document.getElementById('scheduledTasksList');
const trashList = document.getElementById('trashList');
const marketAlertsList = document.getElementById('marketAlertsList');
const newAlertSymbol = document.getElementById('newAlertSymbol');
const newAlertIndicator = document.getElementById('newAlertIndicator');
const newAlertComparator = document.getElementById('newAlertComparator');
const newAlertThreshold = document.getElementById('newAlertThreshold');
const addAlertBtn = document.getElementById('addAlertBtn');
const newTaskPrompt = document.getElementById('newTaskPrompt');
const newTaskType = document.getElementById('newTaskType');
const newTaskTime = document.getElementById('newTaskTime');
const newTaskDatetime = document.getElementById('newTaskDatetime');
const addTaskBtn = document.getElementById('addTaskBtn');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const micBtn = document.getElementById('micBtn');
const pendingAttachmentEl = document.getElementById('pendingAttachment');
const pendingAttachmentNameEl = document.getElementById('pendingAttachmentName');
const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');
const backgroundModeBtn = document.getElementById('backgroundModeBtn');

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
  attachBtn.disabled = !enabled;
  micBtn.disabled = !enabled;
  backgroundModeBtn.disabled = !enabled;
  connectBtn.hidden = enabled;
  disconnectBtn.hidden = !enabled;
}

function updateHeaderHeight() {
  const header = document.querySelector('header');
  if (!header) return;
  document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
}

if (typeof ResizeObserver !== 'undefined') {
  const headerObserver = new ResizeObserver(updateHeaderHeight);
  const headerEl = document.querySelector('header');
  if (headerEl) headerObserver.observe(headerEl);
} else {
  window.addEventListener('resize', updateHeaderHeight);
}

function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = false;
  updateHeaderHeight();
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

async function playText(text, btn) {
  const original = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const res = await fetch(`${CHAT_URL}/voice/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Could not play audio: ${err.message}`);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function addMessage(role, text, agent, images) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (agent) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = agent;
    div.appendChild(tag);
  }
  div.appendChild(document.createTextNode(text));
  if (images?.length) {
    for (const src of images) {
      const img = document.createElement('img');
      img.src = src;
      div.appendChild(img);
    }
  }
  if (role === 'assistant') {
    const speakBtn = document.createElement('button');
    speakBtn.type = 'button';
    speakBtn.className = 'icon-btn speak-btn';
    speakBtn.title = 'Play as speech';
    speakBtn.textContent = '🔊';
    speakBtn.addEventListener('click', () => playText(text, speakBtn));
    div.appendChild(speakBtn);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

let pendingAttachment = null;

function clearPendingAttachment() {
  pendingAttachment = null;
  pendingAttachmentEl.hidden = true;
  fileInput.value = '';
}

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) {
    alert('That file is too large (max 6MB).');
    fileInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    pendingAttachment = { filename: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 };
    pendingAttachmentNameEl.textContent = `📎 ${file.name}`;
    pendingAttachmentEl.hidden = false;
  };
  reader.readAsDataURL(file);
});

removeAttachmentBtn.addEventListener('click', clearPendingAttachment);

let backgroundMode = false;

backgroundModeBtn.addEventListener('click', () => {
  backgroundMode = !backgroundMode;
  backgroundModeBtn.classList.toggle('active', backgroundMode);
  backgroundModeBtn.title = backgroundMode
    ? 'Background mode ON — next message runs as a long task, notifies you when done'
    : 'Run next message as a background task (for big multi-step builds)';
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  const attachment = pendingAttachment;
  clearPendingAttachment();
  const useBackground = backgroundMode;
  if (useBackground) {
    backgroundMode = false;
    backgroundModeBtn.classList.remove('active');
  }

  try {
    const res = await fetch(`${CHAT_URL}/chat${useBackground ? '/background' : ''}`, {
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
        attachments: attachment ? [attachment] : undefined,
      }),
    });

    if (res.status === 401) return showLogin();
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    state.conversationId = data.conversation_id;
    if (useBackground) {
      addMessage('assistant', "Working on this in the background — I'll send a notification when it's done. You can keep using Kully in the meantime.", 'system');
    } else {
      addMessage('assistant', data.reply, data.agent, data.images);
    }
  } catch (err) {
    addMessage('assistant', `Error: ${err.message}`, 'system');
  }
});

// ---- Voice input ----

let mediaRecorder = null;
let recordedChunks = [];

micBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      micBtn.classList.remove('recording');
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        const audioBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        micBtn.disabled = true;
        try {
          const res = await controlFetch(`${CHAT_URL}/voice/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: audioBase64, mime_type: mediaRecorder.mimeType }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const data = await res.json();
          input.value = data.text || '';
          input.focus();
        } catch (err) {
          alert(`Could not transcribe: ${err.message}`);
        } finally {
          micBtn.disabled = false;
        }
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    micBtn.classList.add('recording');
  } catch (err) {
    alert(`Microphone access failed: ${err.message}`);
  }
});

// ---- History panel ----

const ALL_PANELS = [historyPanel, skillsPanel, projectsPanel, artifactsPanel];

function openPanel(panel) {
  for (const p of ALL_PANELS) p.hidden = p !== panel;
}

function closePanels() {
  for (const p of ALL_PANELS) p.hidden = true;
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
  loadTools();
  loadConnectors();
  loadResponseStyle();
  loadUsage();
  loadScheduledTasks();
  loadMarketAlerts();
  loadTrash();
});

// ---- Market alerts ----

async function loadMarketAlerts() {
  marketAlertsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/market-alerts?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const alerts = await res.json();

    marketAlertsList.innerHTML = '';
    if (!alerts.length) {
      marketAlertsList.textContent = 'No market alerts set.';
      return;
    }
    for (const a of alerts) {
      const row = document.createElement('div');
      row.className = 'toggle-row';

      const info = document.createElement('span');
      info.className = 'tool-name';
      const status = a.triggered_at ? ' (triggered)' : a.enabled ? '' : ' (off)';
      info.textContent = `${a.symbol} ${a.indicator} ${a.comparator} ${a.threshold}${status}`;
      row.appendChild(info);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '✕';
      deleteBtn.className = 'ghost-btn';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete alert for ${a.symbol}?`)) return;
        try {
          const delRes = await controlFetch(`${CHAT_URL}/market-alerts/${a.id}?user_id=${encodeURIComponent(state.userId)}`, { method: 'DELETE' });
          if (!delRes.ok) throw new Error(`status ${delRes.status}`);
          loadMarketAlerts();
        } catch (err) {
          alert(`Could not delete: ${err.message}`);
        }
      });
      row.appendChild(deleteBtn);

      marketAlertsList.appendChild(row);
    }
  } catch (err) {
    marketAlertsList.textContent = `Could not load market alerts: ${err.message}. Is your server connected?`;
  }
}

addAlertBtn.addEventListener('click', async () => {
  const symbol = newAlertSymbol.value.trim();
  const threshold = Number(newAlertThreshold.value);
  if (!symbol) return alert('Enter a symbol.');
  if (!newAlertThreshold.value || Number.isNaN(threshold)) return alert('Enter a numeric threshold.');

  try {
    const res = await controlFetch(`${CHAT_URL}/market-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: state.userId,
        project: state.project,
        symbol,
        indicator: newAlertIndicator.value,
        comparator: newAlertComparator.value,
        threshold,
      }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    newAlertSymbol.value = '';
    newAlertThreshold.value = '';
    loadMarketAlerts();
  } catch (err) {
    alert(`Could not set alert: ${err.message}`);
  }
});

// ---- Recently deleted (soft-delete restore) ----

async function loadTrash() {
  trashList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/trash?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const items = await res.json();

    trashList.innerHTML = '';
    if (!items.length) {
      trashList.textContent = 'Nothing deleted recently.';
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'toggle-row';

      const info = document.createElement('span');
      info.className = 'tool-name';
      info.textContent = `[${item.type}] ${item.label.slice(0, 60)}${item.label.length > 60 ? '…' : ''}`;
      row.appendChild(info);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.textContent = 'Restore';
      restoreBtn.className = 'ghost-btn';
      restoreBtn.addEventListener('click', async () => {
        try {
          const res2 = await controlFetch(`${CHAT_URL}/trash/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: state.userId, type: item.type, id: item.id }),
          });
          if (!res2.ok) throw new Error(`status ${res2.status}`);
          loadTrash();
        } catch (err) {
          alert(`Could not restore: ${err.message}`);
        }
      });
      row.appendChild(restoreBtn);

      trashList.appendChild(row);
    }
  } catch (err) {
    trashList.textContent = `Could not load recently deleted items: ${err.message}. Is your server connected?`;
  }
}

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

// ---- Projects panel ----

function switchProject(project) {
  state.project = project;
  projectInput.value = project;
  localStorage.setItem('kully_project', project);
  loadProjectFacts(project);
  // Re-render the active state without a full reload.
  projectsList.querySelectorAll('.project-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.project === project);
  });
}

const FACT_TYPES = ['decision', 'todo', 'architecture', 'preference', 'other'];

function renderFactItem(fact) {
  const item = document.createElement('div');
  item.className = 'fact-item';

  const content = document.createElement('div');
  content.className = 'fact-content';
  const typeTag = document.createElement('span');
  typeTag.className = 'fact-type';
  typeTag.textContent = fact.fact_type;
  const text = document.createElement('span');
  text.textContent = fact.content;
  content.appendChild(typeTag);
  content.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'fact-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = 'Edit';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';

  editBtn.addEventListener('click', () => {
    const textarea = document.createElement('textarea');
    textarea.value = fact.content;
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      try {
        const res = await controlFetch(`${CHAT_URL}/facts/${fact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: state.userId, content: textarea.value }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        fact.content = textarea.value;
        text.textContent = fact.content;
        content.replaceChildren(typeTag, text);
      } catch (err) {
        alert(`Could not save: ${err.message}`);
      }
    });
    content.replaceChildren(textarea, saveBtn);
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this memory?')) return;
    try {
      const res = await controlFetch(`${CHAT_URL}/facts/${fact.id}?user_id=${encodeURIComponent(state.userId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      item.remove();
    } catch (err) {
      alert(`Could not delete: ${err.message}`);
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  item.appendChild(content);
  item.appendChild(actions);
  return item;
}

async function loadProjectFacts(project) {
  memoryProjectName.textContent = project;
  projectFactsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/projects/${encodeURIComponent(project)}/facts?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const facts = await res.json();

    projectFactsList.innerHTML = '';
    if (!facts.length) {
      projectFactsList.textContent = 'Nothing remembered for this project yet.';
      return;
    }
    for (const fact of facts) {
      projectFactsList.appendChild(renderFactItem(fact));
    }
  } catch (err) {
    projectFactsList.textContent = `Could not load memory: ${err.message}. Is your server connected?`;
  }
}

addFactBtn.addEventListener('click', () => {
  const form = document.createElement('div');
  form.className = 'add-fact-form';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Something worth remembering for this project…';

  const row = document.createElement('div');
  row.className = 'row';
  const select = document.createElement('select');
  for (const t of FACT_TYPES) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Add';

  saveBtn.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) return;
    try {
      const res = await controlFetch(`${CHAT_URL}/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: state.userId, project: state.project, content, fact_type: select.value }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const fact = await res.json();
      form.replaceWith(renderFactItem(fact));
      if (projectFactsList.textContent === 'Nothing remembered for this project yet.') projectFactsList.textContent = '';
    } catch (err) {
      alert(`Could not add: ${err.message}`);
    }
  });

  row.appendChild(select);
  row.appendChild(saveBtn);
  form.appendChild(textarea);
  form.appendChild(row);
  projectFactsList.prepend(form);
  textarea.focus();
});

async function loadProjects() {
  projectsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/projects?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const projects = await res.json();

    projectsList.innerHTML = '';
    if (!projects.some((p) => p.project === state.project)) {
      // The current project (e.g. freshly typed, no conversations yet) still
      // deserves a row so it's obvious it'll be the one used.
      projects.unshift({ project: state.project, conversationCount: 0, lastUsed: null });
    }
    for (const p of projects) {
      const item = document.createElement('div');
      item.className = 'project-item';
      if (p.project === state.project) item.classList.add('active');
      item.dataset.project = p.project;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.project;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = p.lastUsed
        ? `${p.conversationCount} chat${p.conversationCount === 1 ? '' : 's'} · ${formatRelativeDate(p.lastUsed)}`
        : 'new';

      item.appendChild(name);
      item.appendChild(meta);
      item.addEventListener('click', () => switchProject(p.project));
      projectsList.appendChild(item);
    }
  } catch (err) {
    projectsList.textContent = `Could not load projects: ${err.message}. Is your server connected?`;
  }
}

projectsBtn.addEventListener('click', () => {
  openPanel(projectsPanel);
  loadProjects();
  loadProjectFacts(state.project);
});

// ---- Plugins (tool toggles) ----

async function loadTools() {
  toolsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/tools`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const tools = await res.json();

    toolsList.innerHTML = '';
    for (const tool of tools) {
      const row = document.createElement('div');
      row.className = 'toggle-row';
      const name = document.createElement('span');
      name.className = 'tool-name';
      name.textContent = tool.name;

      const label = document.createElement('label');
      label.className = 'toggle-switch';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = tool.enabled;
      const slider = document.createElement('span');
      slider.className = 'slider';

      checkbox.addEventListener('change', async () => {
        try {
          const putRes = await controlFetch(`${CHAT_URL}/tools/${encodeURIComponent(tool.name)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: checkbox.checked }),
          });
          if (!putRes.ok) throw new Error(`status ${putRes.status}`);
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          alert(`Could not save: ${err.message}`);
        }
      });

      label.appendChild(checkbox);
      label.appendChild(slider);
      row.appendChild(name);
      row.appendChild(label);
      toolsList.appendChild(row);
    }
  } catch (err) {
    toolsList.textContent = `Could not load plugins: ${err.message}. Is your server connected?`;
  }
}

// ---- Response style ----

async function loadResponseStyle() {
  try {
    const res = await controlFetch(`${CHAT_URL}/settings/response_style`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { value } = await res.json();
    responseStyleToggle.checked = value === 'detailed';
  } catch {
    // best-effort; leave the toggle at its current state
  }
}

responseStyleToggle.addEventListener('change', async () => {
  const value = responseStyleToggle.checked ? 'detailed' : 'concise';
  try {
    const res = await controlFetch(`${CHAT_URL}/settings/response_style`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    responseStyleToggle.checked = !responseStyleToggle.checked;
    alert(`Could not save: ${err.message}`);
  }
});

// ---- Usage ----

async function loadUsage() {
  usageSummary.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/usage/summary?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const u = await res.json();
    usageSummary.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'connector-row';
    row.style.display = 'block';
    row.innerHTML =
      `<div>${u.totalTokens.toLocaleString()} tokens &middot; ~$${u.estimatedCostUsd.toFixed(4)} &middot; ${u.imageGenCount} image${u.imageGenCount === 1 ? '' : 's'} generated</div>` +
      `<div style="color:var(--muted);font-size:11px;margin-top:4px;">Last ${u.sinceDays} days &middot; Groq token cost only (image gen is free)</div>`;
    usageSummary.appendChild(row);
  } catch (err) {
    usageSummary.textContent = `Could not load usage: ${err.message}. Is your server connected?`;
  }
}

// ---- Scheduled check-ins ----

newTaskType.addEventListener('change', () => {
  const isOnce = newTaskType.value === 'once';
  newTaskTime.hidden = isOnce;
  newTaskDatetime.hidden = !isOnce;
});

async function loadScheduledTasks() {
  scheduledTasksList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/scheduled-tasks?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const tasks = await res.json();

    scheduledTasksList.innerHTML = '';
    if (!tasks.length) {
      scheduledTasksList.textContent = 'No scheduled check-ins yet.';
      return;
    }
    for (const t of tasks) {
      const row = document.createElement('div');
      row.className = 'toggle-row';

      const info = document.createElement('span');
      info.className = 'tool-name';
      const when = t.schedule_type === 'daily' ? `daily at ${t.time_of_day} UTC` : new Date(t.run_at).toLocaleString();
      info.textContent = `${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '…' : ''} — ${when}`;
      row.appendChild(info);

      const label = document.createElement('label');
      label.className = 'toggle-switch';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = t.enabled;
      checkbox.addEventListener('change', async () => {
        try {
          const putRes = await controlFetch(`${CHAT_URL}/scheduled-tasks/${t.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: state.userId, enabled: checkbox.checked }),
          });
          if (!putRes.ok) throw new Error(`status ${putRes.status}`);
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          alert(`Could not save: ${err.message}`);
        }
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.appendChild(checkbox);
      label.appendChild(slider);
      row.appendChild(label);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '✕';
      deleteBtn.className = 'ghost-btn';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete this scheduled check-in?\n\n"${t.prompt.slice(0, 80)}"`)) return;
        try {
          const delRes = await controlFetch(`${CHAT_URL}/scheduled-tasks/${t.id}?user_id=${encodeURIComponent(state.userId)}`, { method: 'DELETE' });
          if (!delRes.ok) throw new Error(`status ${delRes.status}`);
          loadScheduledTasks();
        } catch (err) {
          alert(`Could not delete: ${err.message}`);
        }
      });
      row.appendChild(deleteBtn);

      scheduledTasksList.appendChild(row);
    }
  } catch (err) {
    scheduledTasksList.textContent = `Could not load scheduled check-ins: ${err.message}. Is your server connected?`;
  }
}

addTaskBtn.addEventListener('click', async () => {
  const prompt = newTaskPrompt.value.trim();
  if (!prompt) return alert('Enter what Kully should do.');

  const body = { user_id: state.userId, project: state.project, prompt, schedule_type: newTaskType.value };
  if (newTaskType.value === 'daily') {
    if (!newTaskTime.value) return alert('Pick a time.');
    body.time_of_day = newTaskTime.value;
  } else {
    if (!newTaskDatetime.value) return alert('Pick a date and time.');
    body.run_at = new Date(newTaskDatetime.value).toISOString();
  }

  try {
    const res = await controlFetch(`${CHAT_URL}/scheduled-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    newTaskPrompt.value = '';
    loadScheduledTasks();
  } catch (err) {
    alert(`Could not schedule: ${err.message}`);
  }
});

// ---- Connectors ----

function renderConnectorRow(displayName, providerKey, connectors) {
  const connected = connectors.find((c) => c.provider === providerKey);
  const row = document.createElement('div');
  row.className = 'connector-row';
  const label = document.createElement('span');
  label.textContent = connected ? `${displayName} — connected` : `${displayName} — not connected`;
  row.appendChild(label);

  if (connected) {
    const disconnectBtn2 = document.createElement('button');
    disconnectBtn2.type = 'button';
    disconnectBtn2.textContent = 'Disconnect';
    disconnectBtn2.addEventListener('click', async () => {
      try {
        const res2 = await controlFetch(`/connectors/${providerKey}`, { method: 'DELETE' });
        if (!res2.ok) throw new Error(`status ${res2.status}`);
        loadConnectors();
      } catch (err) {
        alert(`Could not disconnect: ${err.message}`);
      }
    });
    row.appendChild(disconnectBtn2);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Connect';
    btn.addEventListener('click', () => {
      window.location.href = `/connectors/${providerKey}/start?token=${encodeURIComponent(state.token)}`;
    });
    row.appendChild(btn);
  }
  return row;
}

async function loadConnectors() {
  connectorsList.textContent = 'Loading…';
  try {
    const res = await controlFetch('/connectors');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const connectors = await res.json();

    connectorsList.innerHTML = '';
    connectorsList.appendChild(renderConnectorRow('Google', 'google', connectors));
    connectorsList.appendChild(renderConnectorRow('Telegram', 'telegram', connectors));
  } catch (err) {
    connectorsList.textContent = `Could not load connectors: ${err.message}. Is your server connected?`;
  }
}

// ---- Artifacts ----

function renderArtifactContent(artifact) {
  artifactContent.innerHTML = '';
  if (artifact.kind === 'html') {
    const iframe = document.createElement('iframe');
    iframe.sandbox = '';
    iframe.srcdoc = artifact.content;
    artifactContent.appendChild(iframe);
  } else if (artifact.kind === 'image') {
    const img = document.createElement('img');
    img.src = artifact.content;
    artifactContent.appendChild(img);
  } else if (artifact.kind === 'video') {
    const video = document.createElement('video');
    video.src = artifact.content;
    video.controls = true;
    artifactContent.appendChild(video);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = artifact.content;
    artifactContent.appendChild(pre);
  }
}

function dataUriToBlob(dataUri) {
  const [header, base64] = dataUri.split(',');
  const mimeType = header.match(/data:(.*);base64/)?.[1] || 'application/octet-stream';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

async function openArtifact(id) {
  try {
    const res = await controlFetch(`${CHAT_URL}/artifacts/${id}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const artifact = await res.json();

    artifactTitle.textContent = artifact.title;
    renderArtifactContent(artifact);
    artifactsList.hidden = true;
    artifactViewer.hidden = false;

    const isBinary = artifact.kind === 'image' || artifact.kind === 'video';
    copyArtifactBtn.hidden = isBinary;
    copyArtifactBtn.onclick = async () => {
      await navigator.clipboard.writeText(artifact.content);
      copyArtifactBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyArtifactBtn.textContent = 'Copy'), 2000);
    };
    downloadArtifactBtn.onclick = () => {
      const ext = { code: artifact.language || 'txt', markdown: 'md', html: 'html', text: 'txt', image: 'png', video: 'mp4' }[artifact.kind] || 'txt';
      const blob = isBinary ? dataUriToBlob(artifact.content) : new Blob([artifact.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact.title.replace(/[^\w.-]+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    alert(`Could not open artifact: ${err.message}`);
  }
}

backToArtifactsBtn.addEventListener('click', () => {
  artifactViewer.hidden = true;
  artifactsList.hidden = false;
});

async function loadArtifacts() {
  artifactsList.hidden = false;
  artifactViewer.hidden = true;
  artifactsList.textContent = 'Loading…';
  try {
    const res = await controlFetch(`${CHAT_URL}/artifacts?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const artifacts = await res.json();

    artifactsList.innerHTML = '';
    if (!artifacts.length) {
      artifactsList.textContent = 'No artifacts yet — ask the dev or general agent to create one.';
      return;
    }
    for (const a of artifacts) {
      const item = document.createElement('div');
      item.className = 'artifact-item';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = a.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${a.kind} · ${a.project} · ${formatRelativeDate(a.created_at)}`;
      item.appendChild(title);
      item.appendChild(meta);
      item.addEventListener('click', () => openArtifact(a.id));
      artifactsList.appendChild(item);
    }
  } catch (err) {
    artifactsList.textContent = `Could not load artifacts: ${err.message}. Is your server connected?`;
  }
}

artifactsBtn.addEventListener('click', () => {
  openPanel(artifactsPanel);
  loadArtifacts();
});

// ---- Connector OAuth redirect feedback ----

(function handleConnectorRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('connected')) {
    setBanner(`${params.get('connected')} connected.`);
    setTimeout(() => setBanner(null), 4000);
    window.history.replaceState({}, '', window.location.pathname);
  } else if (params.has('connector_error')) {
    setBanner(`Connector error: ${params.get('connector_error')}`);
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

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
