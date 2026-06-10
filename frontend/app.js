/* ═══════════════════════════════════════════════════
   AGENT HUB v2 — SaaS frontend
   Auth · Agents · Leads · Dashboard · Settings
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
const CHAR_FRAMES = {
  work: [
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
const animReg = {};

const WORK_SPEED  = 300;
const IDLE_SPEED  = 480;
const IDLE_PAUSE  = 2800;

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

      if (a.mode === 'idle' && a.paused) {
        if (ts >= a.pauseUntil) {
          a.paused = false;
          a.frameIdx = 1;
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
          a.paused     = true;
          a.pauseUntil = ts + IDLE_PAUSE;
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
  token:     localStorage.getItem('ahub_token') || null,
  me:        null,
  org:       null,
  view:      'agents',
  agents:    [],
  current:   null,
  sessions:  {},
  messages:  {},
  ws:        null,
  streaming: false,
  streamBuf: '',
  streamEl:  null,
  authMode:  'login',
  leadStatuses: ['new','qualified','contacted','meeting','won','lost'],
};

marked.setOptions({ breaks: true, gfm: true });

// ── API helper ─────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && state.token) {
    logout();
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

// ── Auth ───────────────────────────────────────────────
function toggleAuthMode() {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  const isReg = state.authMode === 'register';
  document.getElementById('field-orgname').style.display = isReg ? 'block' : 'none';
  document.getElementById('field-name').style.display    = isReg ? 'block' : 'none';
  document.getElementById('auth-submit').textContent     = isReg ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.getElementById('auth-sub').textContent        = isReg
    ? 'YOUR AI WORKFORCE // CREATE ACCOUNT' : 'YOUR AI WORKFORCE // SIGN IN';
  document.getElementById('auth-toggle').textContent     = isReg
    ? 'HAVE AN ACCOUNT? > SIGN IN' : 'NO ACCOUNT? > CREATE ONE';
  showAuthError('');
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function submitAuth(e) {
  e.preventDefault();
  showAuthError('');
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  try {
    let data;
    if (state.authMode === 'register') {
      const orgName = document.getElementById('auth-orgname').value.trim();
      const name    = document.getElementById('auth-name').value.trim();
      if (!orgName || !name) { showAuthError('ALL FIELDS REQUIRED'); return false; }
      data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ organization_name: orgName, name, email, password }),
      });
    } else {
      data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    }
    state.token = data.token;
    localStorage.setItem('ahub_token', data.token);
    await enterApp();
  } catch (err) {
    showAuthError(err.message.toUpperCase());
  }
  return false;
}

function logout() {
  state.token = null;
  state.me = null;
  localStorage.removeItem('ahub_token');
  if (state.ws) { state.ws.close(); state.ws = null; }
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

// ── Init ───────────────────────────────────────────────
async function init() {
  drawLogo(document.getElementById('auth-logo'));

  if (state.token) {
    try {
      await enterApp();
      return;
    } catch (e) {
      localStorage.removeItem('ahub_token');
      state.token = null;
    }
  }
  document.getElementById('auth-screen').style.display = 'flex';
}

async function enterApp() {
  const me = await api('/api/auth/me');
  state.me  = me.user;
  state.org = me.organization;

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  drawLogo(document.getElementById('logo-canvas'));
  document.getElementById('footer-org') .textContent =
    `${state.org.name.toUpperCase().slice(0, 18)} // ${state.org.plan.toUpperCase()}`;

  state.agents = await api('/api/v1/agents');
  const available = state.agents.filter(a => a.available).length;
  document.getElementById('welcome-count').textContent =
    `${available}/${state.agents.length} SPECIALISTS UNLOCKED`;

  renderSidebar();
  startAnimLoop();
  startWelcomeAnimation(
    document.getElementById('welcome-canvas'),
    state.agents.map(a => a.color),
  );
  showView('agents');
}

// ── Views ──────────────────────────────────────────────
function showView(view) {
  state.view = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${view}`)?.classList.add('active');

  const showChat = view === 'agents';
  document.getElementById('welcome-screen').style.display =
    showChat && !state.current ? 'flex' : 'none';
  document.getElementById('chat-area').style.display =
    showChat && state.current ? 'flex' : 'none';
  document.getElementById('leads-view').style.display     = view === 'leads' ? 'flex' : 'none';
  document.getElementById('growth-view').style.display    = view === 'growth' ? 'flex' : 'none';
  document.getElementById('dashboard-view').style.display = view === 'dashboard' ? 'flex' : 'none';
  document.getElementById('settings-view').style.display  = view === 'settings' ? 'flex' : 'none';

  if (view === 'leads') loadLeads();
  if (view === 'growth') loadGrowth();
  if (view === 'dashboard') loadDashboard();
  if (view === 'settings') loadSettings();
}

// ── Growth view ────────────────────────────────────────
async function loadGrowth() {
  const body = document.getElementById('growth-body');
  try {
    const [icps, runs] = await Promise.all([
      api('/api/growth/icps'), api('/api/growth/runs'),
    ]);

    const icpRows = icps.map(icp => `
      <tr>
        <td>
          <div class="lead-company">${escHtml(icp.name)}</div>
          <div class="dim">${escHtml((icp.target_roles || []).join(', ') || 'standardroller')}
            ${icp.regions?.length ? ' // ' + escHtml(icp.regions.join(', ')) : ''}</div>
        </td>
        <td>${icp.auto_run ? '<span style="color:#44ff88">WEEKLY</span>' : '<span class="dim">MANUAL</span>'}</td>
        <td>${icp.include_new_companies ? 'HIRING+NEWCO' : 'HIRING'}</td>
        <td>
          <button class="pixel-btn small" onclick="runIcp('${icp.id}', this)">RUN NOW</button>
          <button class="pixel-btn small" onclick="toggleIcpAuto('${icp.id}', ${icp.auto_run ? 'false' : 'true'})">${icp.auto_run ? 'PAUSE' : 'AUTO'}</button>
          <button class="pixel-btn small danger" onclick="removeIcp('${icp.id}')">DEL</button>
        </td>
      </tr>`).join('');

    const runRows = runs.map(r => `
      <tr class="lead-row" onclick="toggleRunDigest('${r.id}')">
        <td>${escHtml((r.created_at || '').slice(0, 16))}</td>
        <td>${escHtml(r.trigger.toUpperCase())}</td>
        <td>${r.signals_found}</td>
        <td style="color:#44ff88">${r.leads_created}</td>
        <td class="dim">${r.duplicates_skipped}</td>
      </tr>
      <tr class="lead-detail" id="digest-${r.id}" style="display:none">
        <td colspan="5"><pre class="outreach-draft">${escHtml(r.digest || '')}</pre></td>
      </tr>`).join('') || '<tr><td colspan="5" class="dim">NO RUNS YET</td></tr>';

    body.innerHTML = `
      <div class="dash-section">
        <div class="dash-label">ICP PROFILES <span class="dim">// WHAT SIGNALS TO HARVEST</span></div>
        ${icps.length ? `
        <table class="leads-table">
          <thead><tr><th>PROFILE</th><th>SCHEDULE</th><th>SIGNALS</th><th></th></tr></thead>
          <tbody>${icpRows}</tbody>
        </table>` : '<div class="dim" style="line-height:2">NO ICP YET — CREATE ONE BELOW. LEADS WILL BE HARVESTED FROM COMPANIES HIRING THESE ROLES.</div>'}
        <div class="settings-row" style="margin-top:14px">
          <input type="text" id="icp-name" class="pixel-input" placeholder="PROFILE NAME (E.G. WEBB STHLM)" />
          <input type="text" id="icp-roles" class="pixel-input" placeholder="ROLES, COMMA-SEP (frontendutvecklare, ...)" />
          <input type="text" id="icp-regions" class="pixel-input" placeholder="REGIONS (Stockholm, ...)" />
        </div>
        <div class="settings-row">
          <input type="text" id="icp-sell" class="pixel-input" placeholder="WHAT WE SELL (USED IN OUTREACH)" />
          <label class="dim" style="font-size:7px"><input type="checkbox" id="icp-newco" /> +NEWLY REGISTERED</label>
          <label class="dim" style="font-size:7px"><input type="checkbox" id="icp-auto" checked /> WEEKLY AUTO-RUN</label>
          <button class="pixel-btn small" onclick="createIcp()">CREATE</button>
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-label">PROSPECTING RUNS <span class="dim">// CLICK A ROW FOR THE DIGEST</span></div>
        <table class="leads-table">
          <thead><tr><th>WHEN (UTC)</th><th>TRIGGER</th><th>SIGNALS</th><th>NEW LEADS</th><th>DUPES SKIPPED</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

function toggleRunDigest(id) {
  const row = document.getElementById(`digest-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

async function createIcp() {
  const name = document.getElementById('icp-name').value.trim();
  if (!name) { alert('Profile name required'); return; }
  const split = v => v.split(',').map(s => s.trim()).filter(Boolean);
  try {
    await api('/api/growth/icps', { method: 'POST', body: JSON.stringify({
      name,
      what_we_sell: document.getElementById('icp-sell').value.trim() || null,
      target_roles: split(document.getElementById('icp-roles').value),
      regions: split(document.getElementById('icp-regions').value),
      include_new_companies: document.getElementById('icp-newco').checked,
      auto_run: document.getElementById('icp-auto').checked,
    })});
    loadGrowth();
  } catch (e) { alert(e.message); }
}

async function runIcp(id, btn) {
  btn.disabled = true; btn.textContent = 'RUNNING...';
  try {
    const r = await api(`/api/growth/icps/${id}/run`, { method: 'POST' });
    alert(`Run complete: ${r.leads_created} new leads, ${r.duplicates_skipped} duplicates skipped.`);
    loadGrowth();
  } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = 'RUN NOW'; }
}

async function toggleIcpAuto(id, enable) {
  try {
    await api(`/api/growth/icps/${id}`, { method: 'PATCH',
      body: JSON.stringify({ auto_run: enable }) });
    loadGrowth();
  } catch (e) { alert(e.message); }
}

async function removeIcp(id) {
  if (!confirm('Delete this ICP profile?')) return;
  try { await api(`/api/growth/icps/${id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
  loadGrowth();
}

// ── Sidebar ────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('agent-list');
  list.innerHTML = '';

  state.agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card' + (agent.available ? '' : ' locked');
    card.id = `card-${agent.id}`;
    card.style.setProperty('--agent-color', agent.color);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.onclick = () => agent.available ? selectAgent(agent.id) : showView('settings');
    card.onkeydown = e => { if (e.key === 'Enter') card.onclick(); };

    const anim = document.createElement('canvas');
    anim.className = 'anim-canvas';

    const statusHtml = agent.available
      ? `<span class="status-dot"></span>
         <span class="status-label" id="slabel-${agent.id}">IDLE</span>`
      : `<span class="lock-label">LOCKED // UPGRADE</span>`;

    card.innerHTML = `
      <div class="anim-wrap"></div>
      <div class="agent-card-info">
        <div class="agent-card-name">${agent.name}${agent.has_tools ? ' <span class="tool-badge" title="Has live tools">T</span>' : ''}</div>
        <div class="agent-card-desc">${agent.description}</div>
        <div class="agent-status-row">${statusHtml}</div>
      </div>
    `;
    card.querySelector('.anim-wrap').appendChild(anim);
    list.appendChild(card);

    registerAnim(agent.id, anim, agent.id, 4);
    renderChar(anim, 'idle', 0, agent.color, 4, false);
  });
}

// ── Select agent ───────────────────────────────────────
function selectAgent(id) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.current = id;
  showView('agents');

  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`card-${id}`)?.classList.add('active');

  const agent = state.agents.find(a => a.id === id);
  if (!agent) return;

  document.getElementById('welcome-screen').style.display = 'none';
  const chatArea = document.getElementById('chat-area');
  chatArea.style.display = 'flex';
  chatArea.style.setProperty('--agent-color', agent.color);

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
  const params = new URLSearchParams();
  if (sessionId) params.set('session_id', sessionId);
  params.set('token', state.token);
  const url = `${proto}//${location.host}/ws/${agentId}?${params}`;

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
    if (state.current === agentId && state.view === 'agents') {
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
const TOOL_LABELS = {
  search_companies:        'SEARCHING COMPANIES',
  search_people:           'FINDING DECISION-MAKERS',
  enrich_company:          'ENRICHING COMPANY DATA',
  lookup_company_registry: 'CHECKING OFFICIAL REGISTRY',
  analyze_website:         'ANALYZING WEBSITE',
  find_company_news:       'SCANNING NEWS SIGNALS',
  find_job_postings:       'CHECKING HIRING SIGNALS',
  check_email_domain:      'VERIFYING EMAIL DOMAIN',
  save_lead:               'SAVING LEAD TO PIPELINE',
  list_leads:              'READING PIPELINE',
  update_lead:             'UPDATING LEAD',
};

function handleWsMsg(data, agentId) {
  if (agentId !== state.current) return;

  switch (data.type) {
    case 'session':
      state.sessions[agentId] = data.session_id;
      break;

    case 'start':
      state.streaming = true;
      state.streamBuf = '';
      setAgentMode(agentId, 'work');
      setStatusLabel(agentId, 'WORKING');
      appendStreamingBubble(agentId);
      break;

    case 'chunk':
      state.streamBuf += data.content;
      updateStreamingBubble(state.streamBuf);
      break;

    case 'tool_start': {
      // Flush streamed text into a finished bubble (empty bubbles are removed)
      if (state.streamEl) {
        finaliseStreamingBubble(agentId, state.streamBuf);
        state.streamBuf = '';
      }
      appendToolChip(data.name);
      break;
    }

    case 'tool_end': {
      completeToolChip(data.name, data.ok);
      appendStreamingBubble(agentId);
      break;
    }

    case 'end':
      state.streaming = false;
      if (state.streamEl) finaliseStreamingBubble(agentId, state.streamBuf);
      state.streamBuf = '';
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
      if (data.code === 'auth') logout();
      break;

    case 'cleared':
      state.messages[agentId] = [];
      renderMessages(agentId);
      break;
  }
}

function appendToolChip(name) {
  const container = document.getElementById('messages');
  const chip = document.createElement('div');
  chip.className = 'tool-chip running';
  chip.dataset.tool = name;
  chip.innerHTML = `<span class="tool-spinner"></span> ${TOOL_LABELS[name] || name.toUpperCase()}...`;
  container.appendChild(chip);
  scrollToBottom();
}

function completeToolChip(name, ok) {
  const chips = document.querySelectorAll(`.tool-chip.running[data-tool="${name}"]`);
  const chip = chips[chips.length - 1];
  if (!chip) return;
  chip.classList.remove('running');
  chip.classList.add(ok ? 'done' : 'failed');
  chip.innerHTML = `${ok ? '✓' : '✗'} ${TOOL_LABELS[name] || name.toUpperCase()}`;
}

function setStatusLabel(agentId, text) {
  const el = document.getElementById(`slabel-${agentId}`);
  if (el) {
    el.textContent = text;
    el.style.color = text === 'WORKING' ? `var(--agent-color)` : 'var(--dim)';
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
    if (!text) { msgEl.remove(); state.streamEl = null; return; }
    msgEl.removeAttribute('id');
    const bubble = msgEl.querySelector('.message-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.innerHTML = DOMPurify.sanitize(marked.parse(text));
      bubble.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    }
  }
  if (text) {
    if (!state.messages[agentId]) state.messages[agentId] = [];
    state.messages[agentId].push({ role: 'assistant', content: text });
  }
  state.streamEl = null;
  scrollToBottom();
}

function appendErrorBubble(agentId, errText) {
  const container = document.getElementById('messages');
  document.getElementById('streaming-msg')?.remove();
  state.streamEl = null;
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

// ── Leads view ─────────────────────────────────────────
const SCORE_COLORS = [[80,'#44ff88'],[60,'#e8d44f'],[40,'#ff9500'],[0,'#ff3366']];
function scoreColor(score) {
  if (score == null) return 'var(--dim)';
  for (const [min, col] of SCORE_COLORS) if (score >= min) return col;
  return 'var(--dim)';
}

async function loadLeads() {
  const body = document.getElementById('leads-body');
  const filter = document.getElementById('leads-filter');

  if (filter.options.length <= 1) {
    state.leadStatuses.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s.toUpperCase();
      filter.appendChild(opt);
    });
  }

  try {
    const data = await api('/api/leads' + (filter.value ? `?status=${filter.value}` : ''));
    state.leadStatuses = data.statuses;
    if (!data.leads.length) {
      body.innerHTML = `<div class="dim panel-empty">NO LEADS YET.<br><br>
        ASK <span style="color:#ff9500">VANTAGE</span> TO PROSPECT FOR YOU —<br>
        E.G. "FIND 5 LOGISTICS COMPANIES IN SWEDEN AND SAVE THE BEST LEADS"</div>`;
      return;
    }

    const rows = data.leads.map(l => `
      <tr class="lead-row" onclick="toggleLeadDetail('${l.id}')">
        <td><span class="lead-score" style="color:${scoreColor(l.score)}">${l.score ?? '--'}</span></td>
        <td>
          <div class="lead-company">${escHtml(l.company_name)}</div>
          <div class="dim">${escHtml(l.domain || '')}</div>
        </td>
        <td>
          <div>${escHtml(l.contact_name || '--')}</div>
          <div class="dim">${escHtml(l.contact_title || '')}</div>
        </td>
        <td class="lead-email">${escHtml(l.contact_email || '--')}</td>
        <td>
          <select class="pixel-select status-select status-${l.status}"
                  onclick="event.stopPropagation()"
                  onchange="setLeadStatus('${l.id}', this.value)">
            ${state.leadStatuses.map(s =>
              `<option value="${s}" ${s===l.status?'selected':''}>${s.toUpperCase()}</option>`).join('')}
          </select>
        </td>
        <td><button class="pixel-btn small danger" onclick="event.stopPropagation(); removeLead('${l.id}')">DEL</button></td>
      </tr>
      <tr class="lead-detail" id="detail-${l.id}" style="display:none">
        <td colspan="6">
          <div class="lead-detail-grid">
            <div><span class="dim">INDUSTRY</span><br>${escHtml(l.industry || '--')}</div>
            <div><span class="dim">SIZE</span><br>${escHtml(l.company_size || '--')}</div>
            <div><span class="dim">LOCATION</span><br>${escHtml(l.location || '--')}</div>
            <div><span class="dim">SOURCE</span><br>${escHtml(l.source || '--')}</div>
          </div>
          ${l.score_reason ? `<div class="lead-section"><span class="dim">SCORE RATIONALE</span><br>${escHtml(l.score_reason)}</div>` : ''}
          ${l.notes ? `<div class="lead-section"><span class="dim">NOTES</span><br>${escHtml(l.notes)}</div>` : ''}
          ${l.outreach_draft ? `
            <div class="lead-section">
              <span class="dim">OUTREACH DRAFT</span>
              <button class="pixel-btn small" onclick="event.stopPropagation(); copyText(this, ${JSON.stringify(l.outreach_draft).replace(/"/g,'&quot;')})">COPY</button>
              <pre class="outreach-draft">${escHtml(l.outreach_draft)}</pre>
            </div>` : ''}
        </td>
      </tr>
    `).join('');

    body.innerHTML = `
      <table class="leads-table">
        <thead><tr>
          <th>SCORE</th><th>COMPANY</th><th>CONTACT</th><th>EMAIL</th><th>STATUS</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

async function toggleLeadDetail(id) {
  const row = document.getElementById(`detail-${id}`);
  if (!row) return;
  const show = row.style.display === 'none';
  row.style.display = show ? 'table-row' : 'none';
  if (!show || row.dataset.seqLoaded) return;
  row.dataset.seqLoaded = '1';
  try {
    const lead = await api(`/api/leads/${id}`);
    if (lead.sequence && lead.sequence.length) {
      const steps = lead.sequence.map(s =>
        `<tr><td>STEP ${s.step}</td><td>${escHtml(s.subject)}</td>
         <td class="seq-${s.status}">${s.status.toUpperCase()}</td>
         <td class="dim">${escHtml((s.sent_at || s.send_at || '').slice(0, 16))}</td></tr>`
      ).join('');
      const hasPending = lead.sequence.some(s => s.status === 'pending');
      const div = document.createElement('div');
      div.className = 'lead-section';
      div.innerHTML = `
        <span class="dim">OUTREACH SEQUENCE</span>
        ${hasPending ? `<button class="pixel-btn small danger" onclick="event.stopPropagation(); cancelSeq('${id}')">STOP</button>` : ''}
        <table class="leads-table slim" style="margin-top:6px"><tbody>${steps}</tbody></table>`;
      row.querySelector('td').appendChild(div);
    }
  } catch (e) { /* sequence info is optional */ }
}

async function cancelSeq(leadId) {
  if (!confirm('Stop the remaining sequence steps?')) return;
  try { await api(`/api/leads/${leadId}/sequence/cancel`, { method: 'POST' }); }
  catch (e) { alert(e.message); }
  loadLeads();
}

async function setLeadStatus(id, status) {
  try { await api(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); }
  catch (e) { alert(e.message); }
  loadLeads();
}

async function removeLead(id) {
  if (!confirm('Delete this lead?')) return;
  try { await api(`/api/leads/${id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
  loadLeads();
}

async function exportLeads() {
  const res = await fetch('/api/leads/export.csv', {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leads.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function copyText(btn, text) {
  navigator.clipboard.writeText(text);
  btn.textContent = 'COPIED';
  setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
}

// ── Dashboard view ─────────────────────────────────────
function quotaBar(used, limit, color) {
  if (limit < 0) return `<div class="quota-text">${used} / UNLIMITED</div>`;
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return `
    <div class="quota-text">${used} / ${limit}</div>
    <div class="quota-bar"><div class="quota-fill" style="width:${pct}%; background:${pct >= 90 ? '#ff3366' : color}"></div></div>`;
}

async function loadDashboard() {
  const body = document.getElementById('dashboard-body');
  try {
    const [org, usage] = await Promise.all([api('/api/org'), api('/api/usage')]);
    const agentRows = usage.by_agent.map(a => {
      const agent = state.agents.find(x => x.id === a.agent_id);
      return `<tr>
        <td style="color:${agent?.color || 'var(--text)'}">${agent?.name || a.agent_id.toUpperCase()}</td>
        <td>${a.messages}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="2" class="dim">NO ACTIVITY YET</td></tr>';

    body.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-label">PLAN</div>
          <div class="dash-value">${org.plan.name.toUpperCase()}</div>
          <div class="dim">€${org.plan.price_monthly_eur}/MO</div>
        </div>
        <div class="dash-card">
          <div class="dash-label">MESSAGES // ${usage.month}</div>
          ${quotaBar(usage.messages, usage.limits.messages, '#44ff88')}
        </div>
        <div class="dash-card">
          <div class="dash-label">LEADS // ${usage.month}</div>
          ${quotaBar(usage.leads, usage.limits.leads, '#ff9500')}
        </div>
        <div class="dash-card">
          <div class="dash-label">TOKENS // ${usage.month}</div>
          <div class="dash-value small">${(usage.input_tokens + usage.output_tokens).toLocaleString()}</div>
          <div class="dim">IN ${usage.input_tokens.toLocaleString()} / OUT ${usage.output_tokens.toLocaleString()}</div>
        </div>
      </div>
      <div class="dash-section">
        <div class="dash-label">ACTIVITY BY AGENT</div>
        <table class="leads-table slim">
          <thead><tr><th>AGENT</th><th>MESSAGES</th></tr></thead>
          <tbody>${agentRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

// ── Settings view ──────────────────────────────────────
async function loadSettings() {
  const body = document.getElementById('settings-body');
  const isAdmin = state.me && ['owner','admin'].includes(state.me.role);
  try {
    const [org, plans, orgSettings] = await Promise.all([
      api('/api/org'), api('/api/billing/plans'), api('/api/org/settings'),
    ]);
    const keys = isAdmin ? await api('/api/keys') : [];

    const planCards = plans.map(p => `
      <div class="plan-card ${p.id === org.plan.id ? 'current' : ''}">
        <div class="plan-name">${p.name.toUpperCase()}</div>
        <div class="plan-price">€${p.price_monthly_eur}<span class="dim">/MO</span></div>
        <ul class="plan-features">${p.features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>
        ${p.id === org.plan.id
          ? '<div class="plan-current-label">CURRENT PLAN</div>'
          : (isAdmin ? `<button class="pixel-btn small" onclick="switchPlan('${p.id}')">SWITCH</button>` : '')}
      </div>`).join('');

    const memberRows = org.members.map(m => `
      <tr><td>${escHtml(m.name)}</td><td>${escHtml(m.email)}</td><td>${m.role.toUpperCase()}</td></tr>`).join('');

    const keyRows = keys.map(k => `
      <tr>
        <td>${escHtml(k.name)}</td>
        <td class="dim">${escHtml(k.prefix)}...</td>
        <td><button class="pixel-btn small danger" onclick="revokeKey('${k.id}')">REVOKE</button></td>
      </tr>`).join('') || '<tr><td colspan="3" class="dim">NO API KEYS</td></tr>';

    body.innerHTML = `
      <div class="dash-section">
        <div class="dash-label">ORGANIZATION</div>
        <div class="settings-row">
          <input type="text" id="org-name-input" class="pixel-input" value="${escHtml(org.name)}" ${isAdmin ? '' : 'disabled'} />
          ${isAdmin ? '<button class="pixel-btn small" onclick="saveOrgName()">SAVE</button>' : ''}
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-label">OUTREACH <span class="dim">// USED BY EMAIL SEQUENCES</span></div>
        <div class="settings-row">
          <input type="text" id="booking-url-input" class="pixel-input"
                 placeholder="BOOKING URL (E.G. CALENDLY)" value="${escHtml(orgSettings.booking_url || '')}" ${isAdmin ? '' : 'disabled'} />
          <input type="number" id="send-limit-input" class="pixel-input" style="max-width:120px"
                 placeholder="SENDS/DAY" value="${orgSettings.daily_send_limit || 20}" ${isAdmin ? '' : 'disabled'} />
          ${isAdmin ? '<button class="pixel-btn small" onclick="saveOutreachSettings()">SAVE</button>' : ''}
        </div>
        <div class="dim" style="font-size:6px; margin-top:8px; line-height:1.8">
          EMAIL SENDING: CONFIGURED VIA SMTP_* ENV VARS. WITHOUT EMAIL_ENABLED=TRUE ALL SENDS ARE SIMULATED (DRY-RUN).
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-label">PLANS</div>
        <div class="plans-grid">${planCards}</div>
      </div>

      <div class="dash-section">
        <div class="dash-label">TEAM (${org.members.length})</div>
        <table class="leads-table slim">
          <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th></tr></thead>
          <tbody>${memberRows}</tbody>
        </table>
        ${isAdmin ? `
        <div class="settings-row invite-row">
          <input type="text" id="invite-name" class="pixel-input" placeholder="NAME" />
          <input type="email" id="invite-email" class="pixel-input" placeholder="EMAIL" />
          <input type="password" id="invite-password" class="pixel-input" placeholder="TEMP PASSWORD" />
          <button class="pixel-btn small" onclick="inviteMember()">INVITE</button>
        </div>` : ''}
      </div>

      ${isAdmin ? `
      <div class="dash-section">
        <div class="dash-label">API KEYS <span class="dim">// PROGRAMMATIC ACCESS VIA POST /api/v1/chat</span></div>
        <table class="leads-table slim">
          <thead><tr><th>NAME</th><th>KEY</th><th></th></tr></thead>
          <tbody>${keyRows}</tbody>
        </table>
        <div class="settings-row">
          <input type="text" id="key-name" class="pixel-input" placeholder="KEY NAME" />
          <button class="pixel-btn small" onclick="createKey()">CREATE KEY</button>
        </div>
        <div id="new-key-box" style="display:none" class="new-key-box"></div>
      </div>` : ''}
    `;
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

async function saveOutreachSettings() {
  try {
    await api('/api/org/settings', { method: 'PATCH', body: JSON.stringify({
      booking_url: document.getElementById('booking-url-input').value.trim() || null,
      daily_send_limit: parseInt(document.getElementById('send-limit-input').value) || null,
    })});
    alert('Saved.');
  } catch (e) { alert(e.message); }
}

async function saveOrgName() {
  const name = document.getElementById('org-name-input').value.trim();
  if (!name) return;
  try {
    await api('/api/org', { method: 'PATCH', body: JSON.stringify({ name }) });
    state.org.name = name;
    document.getElementById('footer-org').textContent =
      `${name.toUpperCase().slice(0, 18)} // ${state.org.plan.toUpperCase()}`;
  } catch (e) { alert(e.message); }
}

async function switchPlan(planId) {
  if (!confirm(`Switch to the ${planId.toUpperCase()} plan?`)) return;
  try {
    await api('/api/billing/plan', { method: 'POST', body: JSON.stringify({ plan: planId }) });
    state.org.plan = planId;
    // Re-fetch agents: availability may have changed
    state.agents = await api('/api/v1/agents');
    renderSidebar();
    loadSettings();
    document.getElementById('footer-org').textContent =
      `${state.org.name.toUpperCase().slice(0, 18)} // ${planId.toUpperCase()}`;
  } catch (e) { alert(e.message); }
}

async function inviteMember() {
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const password = document.getElementById('invite-password').value;
  if (!name || !email || password.length < 8) {
    alert('Name, email and a password of at least 8 characters are required.');
    return;
  }
  try {
    await api('/api/auth/invite', {
      method: 'POST', body: JSON.stringify({ name, email, password }),
    });
    loadSettings();
  } catch (e) { alert(e.message); }
}

async function createKey() {
  const name = document.getElementById('key-name').value.trim();
  if (!name) return;
  try {
    const data = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name }) });
    await loadSettings();
    const box = document.getElementById('new-key-box');
    box.style.display = 'block';
    box.innerHTML = `NEW KEY (SHOWN ONCE — STORE IT NOW):<br><code>${escHtml(data.key)}</code>`;
  } catch (e) { alert(e.message); }
}

async function revokeKey(id) {
  if (!confirm('Revoke this API key?')) return;
  try { await api(`/api/keys/${id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
  loadSettings();
}

// ── Utilities ──────────────────────────────────────────
function scrollToBottom() {
  const c = document.getElementById('messages');
  if (c) c.scrollTop = c.scrollHeight;
}
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
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
