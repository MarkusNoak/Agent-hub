/* ═══════════════════════════════════════════════════
   AGENT HUB — Frontend Logic + Pixel Art Animation
   ═══════════════════════════════════════════════════ */

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

// ── Character colour palette ───────────────────────────
// 0 transparent · 1 skin · 2 skin-shadow/mouth · 3 hair
// 4 outfit(primary) · 5 outfit(shadow) · 6 eye/black
// 7 desk-gray · 8 desk-dark · 9 screen-glow
function charPalette(agentColor) {
  return {
    1: '#f5c892',
    2: '#c47832',
    3: '#1e0f00',
    4: agentColor,
    5: darken(agentColor, 0.40),
    6: '#000000',
    7: '#4a5a6a',
    8: '#2a3a4a',
    9: lighten(agentColor, 0.55),
  };
}

// ── Character sprite frames (10 wide × 12 tall) ────────
//   work  : 3 frames – seated at desk, typing
//   idle  : 6 frames – standing, walking, stretching
const CHAR_FRAMES = {
  work: [
    // 0 – seated, reading screen (arms on desk)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,9,0],
      [0,0,3,6,1,6,3,0,9,0],
      [0,0,3,1,1,1,3,0,9,0],
      [0,0,0,3,1,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [1,4,0,5,5,0,4,1,0,0],
      [1,1,7,7,7,7,1,1,0,0],
      [0,0,7,7,7,7,0,0,0,0],
      [0,0,8,8,8,8,0,0,0,0],
      [0,0,0,8,8,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 1 – head leaning forward (engaged)
    [
      [0,0,0,3,3,3,0,0,0,0],
      [0,0,3,1,1,1,3,0,9,0],
      [0,0,3,6,1,6,1,0,9,0],
      [0,0,3,1,1,1,3,0,9,0],
      [0,0,0,0,3,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [1,4,0,5,5,0,4,1,0,0],
      [1,1,7,7,7,7,1,1,0,0],
      [0,0,7,7,7,7,0,0,0,0],
      [0,0,8,8,8,8,0,0,0,0],
      [0,0,0,8,8,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 2 – typing (arms pressing keys)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,9,0],
      [0,0,3,6,1,6,3,0,9,0],
      [0,0,3,1,1,1,3,0,9,0],
      [0,0,0,3,1,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [0,4,5,4,4,5,4,0,0,0],
      [1,1,7,7,7,7,1,1,0,0],
      [0,0,7,7,7,7,0,0,0,0],
      [0,0,8,8,8,8,0,0,0,0],
      [0,0,0,8,8,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
  ],
  idle: [
    // 0 – standing neutral (pause frame)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,1,1,3,0,0,0],
      [0,0,0,3,1,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [1,4,0,5,5,0,4,1,0,0],
      [0,1,0,4,4,0,1,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,5,5,5,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 1 – walk step A (right leg forward)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,1,1,3,0,0,0],
      [0,0,0,3,1,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [0,4,0,5,5,0,4,1,0,0],
      [1,1,0,4,4,0,0,0,0,0],
      [0,0,5,4,0,0,0,0,0,0],
      [0,0,0,4,5,0,0,0,0,0],
      [0,0,0,5,0,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 2 – walk step B (left leg forward)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,1,1,3,0,0,0],
      [0,0,0,3,1,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [1,4,0,5,5,0,4,0,0,0],
      [0,0,0,4,4,0,1,1,0,0],
      [0,0,0,0,4,5,0,0,0,0],
      [0,0,0,5,4,0,0,0,0,0],
      [0,0,5,0,0,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 3 – stretch start (arms rising)
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,0,3,1,1,3,0,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,2,1,3,0,0,0],
      [0,0,0,3,3,3,0,0,0,0],
      [1,4,4,4,4,4,4,1,0,0],
      [0,1,0,5,5,0,1,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,5,5,5,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 4 – fully stretched / yawn
    [
      [1,0,3,3,3,3,0,1,0,0],
      [0,0,3,1,1,3,0,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,2,1,3,0,0,0],
      [0,0,0,3,3,3,0,0,0,0],
      [0,4,4,4,4,4,4,0,0,0],
      [0,0,0,5,5,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,5,5,5,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // 5 – arms coming down, relaxing
    [
      [0,0,3,3,3,3,0,0,0,0],
      [0,1,3,1,1,3,1,0,0,0],
      [0,0,3,6,1,6,3,0,0,0],
      [0,0,3,1,1,1,3,0,0,0],
      [0,0,0,3,1,3,0,0,0,0],
      [1,4,4,4,4,4,4,1,0,0],
      [0,1,0,5,5,0,1,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,0,4,4,0,0,0,0,0],
      [0,0,5,5,5,5,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
  ],
};

// ── Animation engine ───────────────────────────────────
// Registry: { key → { canvas, agentId, px, mode, frameIdx,
//                      lastTick, cycleCount, flipX, paused, pauseUntil } }
const animReg = {};

const WORK_SPEED  = 300;   // ms per work frame
const IDLE_SPEED  = 480;   // ms per idle frame
const IDLE_PAUSE  = 2800;  // ms to stand still between cycles

function registerAnim(key, canvas, agentId, px) {
  animReg[key] = {
    canvas, agentId, px,
    mode: 'idle', frameIdx: 0, lastTick: 0,
    cycleCount: 0, flipX: false,
    paused: true, pauseUntil: 0,
  };
}

function setAgentMode(agentId, mode) {
  for (const key of Object.keys(animReg)) {
    const a = animReg[key];
    if (a.agentId !== agentId) continue;
    a.mode      = mode;
    a.frameIdx  = 0;
    a.lastTick  = 0;
    a.paused    = mode === 'idle';
    a.pauseUntil = mode === 'idle' ? performance.now() + IDLE_PAUSE : 0;
    a.flipX     = false;
    a.cycleCount = 0;
    const agent = state.agents.find(ag => ag.id === agentId);
    if (agent) renderChar(a.canvas, mode, 0, agent.color, a.px, false);
  }
}

function renderChar(canvas, mode, frameIdx, agentColor, px, flipX) {
  const frame = CHAR_FRAMES[mode][frameIdx % CHAR_FRAMES[mode].length];
  const COLS = frame[0].length;
  const ROWS = frame.length;
  canvas.width  = COLS * px;
  canvas.height = ROWS * px;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (flipX) {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  const pal = charPalette(agentColor);
  frame.forEach((row, y) => {
    row.forEach((v, x) => {
      if (!v) return;
      ctx.fillStyle = pal[v];
      ctx.fillRect(x * px, y * px, px, px);
    });
  });

  if (flipX) ctx.restore();
}

let animLoopStarted = false;
function startAnimLoop() {
  if (animLoopStarted) return;
  animLoopStarted = true;

  function loop(ts) {
    for (const a of Object.values(animReg)) {
      const agent = state.agents.find(ag => ag.id === a.agentId);
      if (!agent) continue;

      // Idle pause — stand still until pauseUntil
      if (a.mode === 'idle' && a.paused) {
        if (ts >= a.pauseUntil) {
          a.paused = false;
          a.frameIdx = 1; // skip neutral frame, start walk
          a.lastTick = ts;
          renderChar(a.canvas, 'idle', a.frameIdx, agent.color, a.px, a.flipX);
        }
        continue;
      }

      const speed = a.mode === 'work' ? WORK_SPEED : IDLE_SPEED;
      if (ts - a.lastTick < speed) continue;

      a.frameIdx++;
      const total = CHAR_FRAMES[a.mode].length;

      if (a.frameIdx >= total) {
        a.frameIdx  = 0;
        a.cycleCount++;
        if (a.mode === 'idle') {
          // Return to standing pause
          a.paused     = true;
          a.pauseUntil = ts + IDLE_PAUSE;
          // Flip direction every 2 cycles so agent paces back and forth
          if (a.cycleCount % 2 === 0) a.flipX = !a.flipX;
        }
      }

      a.lastTick = ts;
      renderChar(a.canvas, a.mode, a.frameIdx, agent.color, a.px, a.flipX);
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ── Welcome animation ──────────────────────────────────
function startWelcomeAnimation(canvas, agentColors) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const cx = W/2, cy = H/2, r = 52;
    agentColors.forEach((col, i) => {
      const angle = (i / agentColors.length) * Math.PI * 2 + frame * 0.008;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      ctx.strokeStyle = col + '30';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    const pulse = Math.sin(frame * 0.04) * 3 + 5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - pulse, cy - pulse, pulse * 2, pulse * 2);
    frame++;
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Sidebar logo ───────────────────────────────────────
function drawLogo(canvas) {
  const px = 3;
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
      ctx.fillRect(x * px, y * px, px, px);
    });
  });
}

// ── App state ──────────────────────────────────────────
const state = {
  agents:    [],
  current:   null,
  sessions:  {},
  messages:  {},
  ws:        null,
  streaming: false,
  streamBuf: '',
  streamEl:  null,
};

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
  startAnimLoop();

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
    card.onclick = () => selectAgent(agent.id);
    card.onkeydown = e => { if (e.key === 'Enter') selectAgent(agent.id); };

    // Animated character canvas (4 px/logical-px → 40×48)
    const anim = document.createElement('canvas');
    anim.className = 'anim-canvas';

    card.innerHTML = `
      <div class="anim-wrap"></div>
      <div class="agent-card-info">
        <div class="agent-card-name">${agent.name}</div>
        <div class="agent-card-desc">${agent.description}</div>
        <div class="agent-status-row">
          <span class="status-dot"></span>
          <span class="status-label" id="slabel-${agent.id}">IDLE</span>
        </div>
      </div>
    `;
    card.querySelector('.anim-wrap').appendChild(anim);
    list.appendChild(card);

    // Register & draw initial frame
    registerAnim(agent.id, anim, agent.id, 4);
    renderChar(anim, 'idle', 0, agent.color, 4, false);
  });
}

// ── Select agent ───────────────────────────────────────
function selectAgent(id) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.current = id;

  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`card-${id}`)?.classList.add('active');

  const agent = state.agents.find(a => a.id === id);
  if (!agent) return;

  document.getElementById('welcome-screen').style.display = 'none';
  const chatArea = document.getElementById('chat-area');
  chatArea.style.display = 'flex';
  chatArea.style.setProperty('--agent-color', agent.color);

  // Header animated character (5 px → 50×60)
  const headerCanvas = document.getElementById('header-anim');
  registerAnim('header', headerCanvas, id, 5);
  renderChar(headerCanvas, 'idle', 0, agent.color, 5, false);

  document.getElementById('header-name').textContent = agent.name;
  document.getElementById('header-desc').textContent = agent.description;

  const sendBtn = document.getElementById('send-btn');
  sendBtn.style.borderColor = agent.color;
  sendBtn.style.color       = agent.color;
  sendBtn.style.boxShadow   = `3px 3px 0 0 ${agent.color}`;

  if (!state.messages[id]) state.messages[id] = [];
  renderMessages(id);
  if (!state.sessions[id]) state.sessions[id] = genSessionId();
  connectWebSocket(id, state.sessions[id]);
}

function genSessionId() {
  return 'sess_' + Math.random().toString(36).substring(2, 15);
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

  ws.onopen  = () => setConnStatus('online');
  ws.onerror = () => setConnStatus('offline');

  ws.onmessage = e => {
    try { handleWsMsg(JSON.parse(e.data), agentId); }
    catch(err) { console.error('WS parse error', err); }
  };

  ws.onclose = () => {
    setConnStatus('offline');
    if (state.current === agentId) {
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
      // Agent goes to work!
      setAgentMode(agentId, 'work');
      setStatusLabel(agentId, 'WORKING');
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
      // Agent takes a break
      setAgentMode(agentId, 'idle');
      setStatusLabel(agentId, 'IDLE');
      enableInput();
      break;

    case 'error':
      state.streaming = false;
      appendErrorBubble(agentId, data.content);
      setAgentMode(agentId, 'idle');
      setStatusLabel(agentId, 'IDLE');
      enableInput();
      break;

    case 'cleared':
      state.messages[agentId] = [];
      renderMessages(agentId);
      break;
  }
}

function setStatusLabel(agentId, text) {
  const el = document.getElementById(`slabel-${agentId}`);
  if (el) {
    el.textContent = text;
    el.style.color = text === 'WORKING'
      ? `var(--agent-color)`
      : 'var(--dim)';
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

// ── Streaming ──────────────────────────────────────────
function appendStreamingBubble(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  const container = document.getElementById('messages');
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

// ── Send ───────────────────────────────────────────────
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

  const container = document.getElementById('messages');
  container.querySelector('.chat-empty')?.remove();
  const agent = state.agents.find(a => a.id === agentId);
  appendMessageEl(container, { role: 'user', content: text }, agent);
  scrollToBottom();

  disableInput();
  state.ws.send(JSON.stringify({
    type: 'message', content: text, session_id: state.sessions[agentId],
  }));
  input.value = '';
  autoResize(input);
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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

function clearChat() {
  if (!state.current || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: 'clear', session_id: state.sessions[state.current] }));
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
