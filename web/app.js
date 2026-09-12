const messagesEl = document.getElementById('messages');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const serverUrlEl = document.getElementById('serverUrl');

const state = {
  userId: 'default-user',
  conversationId: null,
};

serverUrlEl.value = localStorage.getItem('kully_server_url') || '';

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  const serverUrl = serverUrlEl.value.trim().replace(/\/$/, '');
  if (!serverUrl) {
    alert('Enter your server URL first.');
    return;
  }
  localStorage.setItem('kully_server_url', serverUrl);

  addMessage('user', message);
  input.value = '';

  try {
    const res = await fetch(`${serverUrl}/chat`, {
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
