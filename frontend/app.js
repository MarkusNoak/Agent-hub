/* ═══════════════════════════════════════════════════
   AGENT HUB — Frontend Logic
   ═══════════════════════════════════════════════════ */

// ── Pixel art sprite definitions (8×8) ────────────────
// 0 = transparent, 1 = primary, 2 = dark, 3 = light
const SPRITES = {
  nexus: [
    [0,0,1,1,1,1,0,0],
    [0,1,2,1,1,2,1,0],
    [1,2,1,3,3,1,2,1],
    [1,1,3,2,2,3,1,1],
    [1,1,3,2,2,3,1,1],
    [1,2,1,3,3,1,2,1],
    [0,1,2,1,1,2,1,0],
    [0,0,1,1,1,1,0,0],
  ],
  oracle: [
    [0,0,1,1,1,1,0,0],
    [0,1,1,2,2,1,1,0],
    [1,1,2,3,3,2,1,1],
    [1,2,3,1,1,3,2,1],
    [1,2,3,1,1,3,2,1],
    [1,1,2,3,3,2,1,1],
    [0,1,1,2,2,1,1,0],
    [0,0,1,1,1,1,0,0],
  ],
  forge: [
    [0,0,2,2,2,2,0,0],
    [0,2,1,1,1,1,2,0],
    [2,1,1,3,3,1,1,2],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [0,1,1,1,1,1,1,0],
    [0,0,0,1,1,0,0,0],
    [0,0,2,1,1,2,0,0],
  ],
  scroll: [
    [0,1,1,1,1,1,1,0],
    [1,2,1,1,1,1,2,1],
    [1,1,3,1,1,3,1,1],
    [1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1],
    [1,1,3,1,1,3,1,1],
    [1,2,1,1,1,1,2,1],
    [0,1,1,1,1,1,1,0],
  ],
  lens: [
    [0,0,1,1,1,0,0,0],
    [0,1,1,2,1,1,0,0],
    [1,1,2,3,2,1,1,0],
    [1,2,3,2,3,2,1,0],
    [0,1,2,3,2,1,0,0],
    [0,0,1,1,1,0,1,0],
    [0,0,0,0,0,1,1,0],
    [0,0,0,0,0,0,1,1],
  ],
  shield: [
    [0,1,1,1,1,1,1,0],
    [1,1,2,1,1,2,1,1],
    [1,1,1,3,3,1,1,1],
    [1,1,3,1,1,3,1,1],
    [0,1,1,3,3,1,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0],
  ],
  herald: [
    [0,0,0,1,1,0,0,0],
    [0,0,1,1,1,1,0,0],
    [0,1,1,2,2,1,1,0],
    [1,1,2,3,3,2,1,1],
    [1,1,2,3,3,2,1,1],
    [0,1,1,2,2,1,1,0],
    [0,0,1,1,1,1,0,0],
    [0,0,0,1,1,0,0,0],
  ],
};

// ── Colour helpers ─────────────────────────────────────
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : null;
}
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function toHex(r,g,b) {
  return '#' + [r,g,b].map(v => clamp(v).toString(16).padStart(2,'0')).join('');
}
function darken(hex, t)  { const c = hexToRgb(hex); return c ? toHex(c.r*(1-t), c.g*(1-t), c.b*(1-t)) : hex; }
function lighten(hex, t) { const c = hexToRgb(hex); return c ? toHex(c.r+(255-c.r)*t, c.g+(255-c.g)*t, c.b+(255-c.b)*t) : hex; }

// ── Sprite renderer ────────────────────────────────────
function renderSprite(canvas, spriteKey, agentColor, px = 4) {
  const grid = SPRITES[spriteKey];
  if (!grid) return;
  const sz = grid.length;
  canvas.width  = sz * px;
  canvas.height = sz * px;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const palette = {
    1: agentColor,
    2: darken(agentColor, 0.38),
    3: lighten(agentColor, 0.45),
  };
  grid.forEach((row, y) => {
    row.forEach((idx, x) => {
      if (!idx) return;
      ctx.fillStyle = palette[idx];
      ctx.fillRect(x*px, y*px, px, px);
    });
  });
}

// ── Welcome screen animation ───────────────────────────
function startWelcomeAnimation(canvas, agentColors) {
  const ctx  = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const cx = W/2, cy = H/2, r = 52;

    // Orbiting agent dots
    agentColors.forEach((col, i) => {
      const angle = (i / agentColors.length) * Math.PI*2 + frame * 0.008;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      // Connecting line
      ctx.strokeStyle = col + '30';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();

      // Pixel dot (6×6)
      ctx.fillStyle = col;
      ctx.fillRect(x-3, y-3, 6, 6);
    });

    // Pulsing centre square
    const pulse = Math.sin(frame * 0.04) * 3 + 5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - pulse, cy - pulse, pulse*2, pulse*2);

    frame++;
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Logo canvas (sidebar) ──────────────────────────────
function drawLogo(canvas) {
  // Simple pixel art "hub" icon: a 16×16 grid
  const px = 4;
  canvas.width  = 16 * px;
  canvas.height = 16 * px;
  const ctx = canvas.getContext('2d');
  // prettier-ignore
  const logo = [
    [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,1,2,1,1,1,1,2,1,0,0,0,0],
    [0,0,0,0,1,1,1,3,3,1,1,1,0,0,0,0],
    [0,0,0,0,1,1,3,1,1,3,1,1,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [1,2,1,1,1,1,1,1,1,1,1,1,1,1,2,1],
    [1,1,1,1,1,1,3,1,1,3,1,1,1,1,1,1],
    [1,1,1,1,1,1,3,1,1,3,1,1,1,1,1,1],
    [1,2,1,1,1,1,1,1,1,1,1,1,1,1,2,1],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,0,0,1,1,3,1,1,3,1,1,0,0,0,0],
    [0,0,0,0,1,1,1,3,3,1,1,1,0,0,0,0],
    [0,0,0,0,1,2,1,1,1,1,2,1,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
  ];
  const pal = { 1:'#ffffff', 2:'#888899', 3:'#ccccdd' };
  logo.forEach((row, y) => {
    row.forEach((v, x) => {
      if (!v) return;
      ctx.fillStyle = pal[v];
      ctx.fillRect(x*px, y*px, px, px);
    });
  });
}

// ── App state ──────────────────────────────────────────
const state = {
  agents:    [],           // [{id, name, description, color, sprite_key}]
  current:   null,         // current agent id
  sessions:  {},           // { agentId: sessionId }
  messages:  {},           // { agentId: [{role, content}] }
  ws:        null,
  streaming: false,
  streamBuf: '',
  streamEl:  null,         // live bubble element
};

// ── marked.js config ───────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

// ── Init ───────────────────────────────────────────────
async function init() {
  drawLogo(document.getElementById('logo-canvas'));

  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error('Failed to load agents');
    state.agents = await res.json();
  } catch (e) {
    console.error(e);
    return;
  }

  renderSidebar();

  // Welcome animation
  startWelcomeAnimation(
    document.getElementById('welcome-canvas'),
    state.agents.map(a => a.color),
  );
}

// ── Sidebar ────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('agent-list');
  list.innerHTML = '';

  state.agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = `card-${agent.id}`;
    card.style.setProperty('--agent-color', agent.color);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${agent.name}: ${agent.description}`);
    card.onclick = () => selectAgent(agent.id);
    card.onkeydown = e => { if (e.key === 'Enter') selectAgent(agent.id); };

    const canvas = document.createElement('canvas');

    card.innerHTML = `
      <div class="sprite-slot"></div>
      <div class="agent-card-info">
        <div class="agent-card-name">${agent.name}</div>
        <div class="agent-card-desc">${agent.description}</div>
      </div>
      <div class="status-dot"></div>
    `;
    card.querySelector('.sprite-slot').replaceWith(canvas);

    list.appendChild(card);
    renderSprite(canvas, agent.sprite_key, agent.color, 4);
  });
}

// ── Select agent ───────────────────────────────────────
function selectAgent(id) {
  if (state.ws) { state.ws.close(); state.ws = null; }

  state.current = id;

  // Update sidebar active state
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`card-${id}`)?.classList.add('active');

  const agent = state.agents.find(a => a.id === id);
  if (!agent) return;

  // Show chat area
  document.getElementById('welcome-screen').style.display = 'none';
  const chatArea = document.getElementById('chat-area');
  chatArea.style.display = 'flex';
  chatArea.style.setProperty('--agent-color', agent.color);

  // Header
  renderSprite(document.getElementById('header-sprite'), agent.sprite_key, agent.color, 6);
  const nameEl = document.getElementById('header-name');
  nameEl.textContent = agent.name;

  document.getElementById('header-desc').textContent = agent.description;

  // Send button colour
  const sendBtn = document.getElementById('send-btn');
  sendBtn.style.borderColor = agent.color;
  sendBtn.style.color       = agent.color;
  sendBtn.style.boxShadow   = `3px 3px 0 0 ${agent.color}`;

  // Messages
  if (!state.messages[id]) state.messages[id] = [];
  renderMessages(id);

  // Session
  const existingSession = state.sessions[id];
  connectWebSocket(id, existingSession);
}

// ── WebSocket ──────────────────────────────────────────
function connectWebSocket(agentId, sessionId) {
  setConnStatus('connecting');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = sessionId
    ? `${proto}//${location.host}/ws/${agentId}?session_id=${sessionId}`
    : `${proto}//${location.host}/ws/${agentId}`;

  const ws = new WebSocket(url);
  state.ws = ws;

  ws.onopen = () => setConnStatus('online');

  ws.onmessage = e => {
    try { handleWsMsg(JSON.parse(e.data), agentId); }
    catch (err) { console.error('WS parse error', err); }
  };

  ws.onerror = () => setConnStatus('offline');

  ws.onclose = () => {
    setConnStatus('offline');
    if (state.current === agentId) {
      // Reconnect after 2 s
      setTimeout(() => {
        if (state.current === agentId) connectWebSocket(agentId, state.sessions[agentId]);
      }, 2000);
    }
  };
}

function setConnStatus(status) {
  const dot   = document.querySelector('.conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;
  dot.className = `conn-dot ${status}`;
  label.textContent = status.toUpperCase();
}

// ── WebSocket message handler ──────────────────────────
function handleWsMsg(data, agentId) {
  if (agentId !== state.current) return;

  switch (data.type) {
    case 'session':
      state.sessions[agentId] = data.session_id;
      break;

    case 'start':
      state.streaming = true;
      state.streamBuf = '';
      appendStreamingBubble(agentId);
      break;

    case 'chunk':
      state.streamBuf += data.content;
      updateStreamingBubble(state.streamBuf);
      break;

    case 'end':
      state.streaming = false;
      finaliseStreamingBubble(agentId, state.streamBuf);
      state.streamBuf = '';
      enableInput();
      break;

    case 'error':
      state.streaming = false;
      appendErrorBubble(agentId, data.content);
      enableInput();
      break;

    case 'cleared':
      state.messages[agentId] = [];
      renderMessages(agentId);
      break;
  }
}

// ── Message rendering ──────────────────────────────────
function renderMessages(agentId) {
  const container = document.getElementById('messages');
  container.innerHTML = '';

  const msgs  = state.messages[agentId] || [];
  const agent = state.agents.find(a => a.id === agentId);

  if (msgs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = `
      <div class="chat-empty-name">>> ${agent?.name ?? 'AGENT'} ONLINE <<</div>
      <div class="chat-empty-hint">TYPE A MESSAGE TO BEGIN</div>
    `;
    container.appendChild(empty);
    return;
  }

  msgs.forEach(msg => appendMessageEl(container, msg, agent));
  scrollToBottom();
}

function appendMessageEl(container, msg, agent) {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;

  const label = msg.role === 'user' ? 'YOU' : (agent?.name ?? 'AGENT');

  let html;
  if (msg.role === 'assistant') {
    html = DOMPurify.sanitize(marked.parse(msg.content));
  } else {
    html = escHtml(msg.content).replace(/\n/g, '<br>');
  }

  div.innerHTML = `
    <div class="message-label">${label}</div>
    <div class="message-bubble">${html}</div>
  `;

  if (msg.role === 'assistant') {
    div.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
  }

  container.appendChild(div);
}

// ── Streaming helpers ──────────────────────────────────
function appendStreamingBubble(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  const container = document.getElementById('messages');

  // Remove empty state placeholder
  container.querySelector('.chat-empty')?.remove();

  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'streaming-msg';
  div.innerHTML = `
    <div class="message-label">${agent?.name ?? 'AGENT'}</div>
    <div class="message-bubble" id="streaming-bubble"><span class="stream-cursor"></span></div>
  `;
  container.appendChild(div);
  state.streamEl = div.querySelector('#streaming-bubble');
  scrollToBottom();
}

function updateStreamingBubble(text) {
  if (!state.streamEl) return;
  state.streamEl.textContent = text;
  const cur = document.createElement('span');
  cur.className = 'stream-cursor';
  state.streamEl.appendChild(cur);
  scrollToBottom();
}

function finaliseStreamingBubble(agentId, text) {
  const msgEl = document.getElementById('streaming-msg');
  if (msgEl) {
    msgEl.removeAttribute('id');
    const bubble = msgEl.querySelector('.message-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.innerHTML = DOMPurify.sanitize(marked.parse(text));
      bubble.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    }
  }

  if (!state.messages[agentId]) state.messages[agentId] = [];
  state.messages[agentId].push({ role: 'assistant', content: text });

  state.streamEl = null;
  scrollToBottom();
}

function appendErrorBubble(agentId, errText) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="message-label" style="color:#ff3366">ERROR</div>
    <div class="message-bubble error-bubble">${escHtml(errText)}</div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

// ── Send message ───────────────────────────────────────
function sendMessage() {
  if (state.streaming) return;

  const input = document.getElementById('message-input');
  const text  = input.value.trim();
  if (!text) return;

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    if (state.current) connectWebSocket(state.current, state.sessions[state.current]);
    return;
  }

  const agentId = state.current;
  if (!state.messages[agentId]) state.messages[agentId] = [];
  state.messages[agentId].push({ role: 'user', content: text });

  // Add to DOM
  const container = document.getElementById('messages');
  container.querySelector('.chat-empty')?.remove();

  const agent = state.agents.find(a => a.id === agentId);
  appendMessageEl(container, { role: 'user', content: text }, agent);
  scrollToBottom();

  disableInput();

  state.ws.send(JSON.stringify({
    type:       'message',
    content:    text,
    session_id: state.sessions[agentId],
  }));

  input.value = '';
  autoResize(input);
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function disableInput() {
  document.getElementById('message-input').disabled = true;
  document.getElementById('send-btn').disabled       = true;
}

function enableInput() {
  const inp = document.getElementById('message-input');
  inp.disabled = false;
  document.getElementById('send-btn').disabled = false;
  inp.focus();
}

// ── Clear chat ─────────────────────────────────────────
function clearChat() {
  if (!state.current || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  state.ws.send(JSON.stringify({
    type:       'clear',
    session_id: state.sessions[state.current],
  }));

  // Generate fresh session for next conversation
  delete state.sessions[state.current];
}

// ── Utilities ──────────────────────────────────────────
function scrollToBottom() {
  const c = document.getElementById('messages');
  if (c) c.scrollTop = c.scrollHeight;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

// ── Bootstrap ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('message-input')
    .addEventListener('input', e => autoResize(e.target));
  init();
});
