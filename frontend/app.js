/* ═══════════════════════════════════════════════════
   AGENT HUB v2 — SaaS frontend
   Auth · Agents · Leads · Dashboard · Settings
   ═══════════════════════════════════════════════════ */

// ── Agent avatars & status ─────────────────────────────
function avatarHtml(agent, extra) {
  const initials = (agent?.name || '?').slice(0, 2);
  return `<div class="avatar ${extra || ''}" data-avatar="${agent?.id || ''}" style="--ac:${agent?.color || '#7c5cff'}">${initials}</div>`;
}

function setAgentMode(agentId, mode) {
  document.querySelectorAll(`[data-avatar="${agentId}"]`).forEach(el =>
    el.classList.toggle('working', mode === 'work'));
}


// ── UI primitives: toasts, confirm modal, skeletons ────
function toast(msg, type = 'success') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function confirmDialog(message, danger = false) {
  return new Promise(resolve => {
    const backdrop = document.getElementById('modal-backdrop');
    const confirmBtn = document.getElementById('modal-confirm');
    document.getElementById('modal-text').textContent = message;
    confirmBtn.textContent = danger ? 'Delete' : 'Confirm';
    confirmBtn.className = danger ? 'btn btn-sm btn-danger' : 'btn btn-primary btn-sm';
    backdrop.style.display = 'flex';
    const done = val => { backdrop.style.display = 'none'; cleanup(); resolve(val); };
    const onC = () => done(true), onX = () => done(false);
    const onBg = e => { if (e.target === backdrop) done(false); };
    function cleanup() {
      confirmBtn.removeEventListener('click', onC);
      document.getElementById('modal-cancel').removeEventListener('click', onX);
      backdrop.removeEventListener('click', onBg);
    }
    confirmBtn.addEventListener('click', onC);
    document.getElementById('modal-cancel').addEventListener('click', onX);
    backdrop.addEventListener('click', onBg);
  });
}

function skeleton(rows = 4) {
  return `<div class="skeleton-stack">
    <div class="thinking dim">Agenterna tänker<span class="tdots"><i></i><i></i><i></i></span></div>
    ${Array.from({length: rows})
    .map((_, i) => `<div class="skeleton" style="width:${88 - i * 9}%"></div>`).join('')}</div>`;
}

function scoreRing(score, size = 36) {
  if (score == null) return '<span class="dim">--</span>';
  const r = (size / 2) - 3, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(score, 100) / 100);
  return `
    <span class="score-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}">
        <circle class="ring-bg" cx="${size/2}" cy="${size/2}" r="${r}" />
        <circle class="ring-val" cx="${size/2}" cy="${size/2}" r="${r}"
          stroke="${scoreColor(score)}"
          stroke-dasharray="${c.toFixed(1)}"
          style="--ring-c:${c.toFixed(1)}; stroke-dashoffset:${off.toFixed(1)}" />
      </svg>
      <span class="ring-num" style="color:${scoreColor(score)}">${score}</span>
    </span>`;
}

// ── Mobile sidebar ─────────────────────────────────────
function toggleSidebar(force) {
  const open = force !== undefined ? force
    : !document.querySelector('.sidebar').classList.contains('open');
  document.querySelector('.sidebar').classList.toggle('open', open);
  document.getElementById('sidebar-overlay').classList.toggle('show', open);
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 900) toggleSidebar(false);
}

// ── App state ──────────────────────────────────────────
const state = {
  token:     localStorage.getItem('ahub_token') || null,
  me:        null,
  org:       null,
  view:      'agents',
  agents:    [],
  current:   null,
  sessions:  JSON.parse(localStorage.getItem('ahub_sessions') || '{}'),
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
  document.getElementById('auth-submit').textContent     = isReg ? 'Create account' : 'Sign in';
  document.getElementById('auth-sub').textContent        = isReg
    ? 'Create your workspace' : 'Sign in to continue';
  document.getElementById('auth-toggle').innerHTML       = isReg
    ? 'Have an account? <span>Sign in</span>' : 'No account? <span>Create one</span>';
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
      if (!orgName || !name) { showAuthError('All fields are required'); return false; }
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
    showAuthError(err.message);
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

  document.getElementById('footer-org').textContent =
    `${state.org.name.slice(0, 22)} · ${state.org.plan.charAt(0).toUpperCase() + state.org.plan.slice(1)}`;

  state.agents = await api('/api/v1/agents');
  renderSidebar();
  refreshApprovalsBadge();
  showView('agents');
}

// ── Views ──────────────────────────────────────────────
function showView(view) {
  state.view = view;
  closeSidebarOnMobile();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${view}`)?.classList.add('active');

  const showChat = view === 'agents';
  const showHome = showChat && !state.current;
  if (view === 'agents') {
    document.getElementById('nav-home')?.classList.toggle('active', showHome);
    document.getElementById('nav-agents')?.classList.toggle('active', !showHome);
  }
  document.getElementById('welcome-screen').style.display = showHome ? 'flex' : 'none';
  if (showHome) loadHome();
  document.getElementById('chat-area').style.display =
    showChat && state.current ? 'flex' : 'none';
  document.getElementById('office-view').style.display    = view === 'office' ? 'flex' : 'none';
  document.getElementById('customers-view').style.display = view === 'customers' ? 'flex' : 'none';
  document.getElementById('leads-view').style.display     = view === 'leads' ? 'flex' : 'none';
  document.getElementById('approvals-view').style.display  = view === 'approvals' ? 'flex' : 'none';
  document.getElementById('growth-view').style.display    = view === 'growth' ? 'flex' : 'none';
  document.getElementById('dashboard-view').style.display = view === 'dashboard' ? 'flex' : 'none';
  document.getElementById('settings-view').style.display  = view === 'settings' ? 'flex' : 'none';

  if (state.officeTimer) { clearInterval(state.officeTimer); state.officeTimer = null; }
  if (view === 'office') {
    loadOffice();
    state.officeTimer = setInterval(loadOffice, 20000);
  }
  if (view === 'customers') loadCustomers();
  if (view === 'leads') loadLeads();
  if (view === 'approvals') loadApprovals();
  if (view === 'growth') loadGrowth();
  if (view === 'dashboard') loadDashboard();
  if (view === 'settings') loadSettings();
}

function goHome() {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.current = null;
  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
  showView('agents');
}


// ── Home view ──────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Good night';
  if (h < 10) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}


function checklistHtml(orgSettings, icps, runs, ins) {
  const steps = [
    { done: !!(orgSettings && orgSettings.business_profile),
      label: 'Describe your business so every agent adapts to it',
      cta: 'Open settings', view: 'settings' },
    { done: (icps || []).some(i => i.auto_run),
      label: 'Configure your ICP and enable weekly auto-runs',
      cta: 'Open growth', view: 'growth' },
    { done: (runs || []).length > 0,
      label: 'Run your first prospecting harvest',
      cta: 'Run now', view: 'growth' },
    { done: !!(ins && ins.total_leads > 0),
      label: 'Review your first leads in the pipeline',
      cta: 'Open pipeline', view: 'leads' },
  ];
  if (steps.every(s => s.done)) return '';
  const doneCount = steps.filter(s => s.done).length;
  return `
    <div class="checklist">
      <div class="checklist-head">
        <div class="home-section-label">Get set up</div>
        <span class="dim small">${doneCount} of ${steps.length} done</span>
      </div>
      ${steps.map(s => `
        <div class="checklist-item ${s.done ? 'done' : ''}">
          <span class="check-mark">${s.done ? '✓' : ''}</span>
          <span class="check-label">${s.label}</span>
          ${s.done ? '' : `<button class="btn btn-ghost btn-sm" onclick="showView('${s.view}')">${s.cta}</button>`}
        </div>`).join('')}
    </div>`;
}

async function loadHome() {
  const body = document.getElementById('home-body');
  const firstName = (state.me?.name || '').split(' ')[0];

  let ins = null, usage = null, runs = [], icps = [], orgSettings = {};
  let followups = { due: [], stale: [] };
  try {
    [ins, usage, runs, icps, orgSettings, followups] = await Promise.all([
      api('/api/growth/insights'), api('/api/usage'), api('/api/growth/runs'),
      api('/api/growth/icps'), api('/api/org/settings'),
      api('/api/crm/followups').catch(() => ({ due: [], stale: [] })),
    ]);
  } catch (e) { /* stats are decorative — home must still render */ }

  const waitingRows = [
    ...(followups.due || []).map(f => `
      <div class="waiting-item ${f.next_action_due < followups.today ? 'overdue' : ''}" onclick="showView('leads')">
        <span class="waiting-due">${escHtml(f.next_action_due || '')}</span>
        <span class="waiting-co">${escHtml(f.company_name)}</span>
        <span class="waiting-action dim">${escHtml(f.next_action || '')}</span>
      </div>`),
    ...(followups.stale || []).map(f => `
      <div class="waiting-item stale" onclick="showView('leads')">
        <span class="waiting-due">stilla</span>
        <span class="waiting-co">${escHtml(f.company_name)}</span>
        <span class="waiting-action dim">Ingen rörelse sedan ${escHtml((f.updated_at || '').slice(0, 10))} — ny vinkel eller stäng</span>
      </div>`),
  ].join('');

  const open = ins ? (ins.total_leads - (ins.funnel.won || 0) - (ins.funnel.lost || 0)) : 0;
  const lastRun = runs && runs[0];
  const available = state.agents.filter(a => a.available);
  const locked = state.agents.filter(a => !a.available);

  const stat = (label, value, sub) => `
    <div class="home-stat">
      <div class="home-stat-value">${value}</div>
      <div class="home-stat-label">${label}</div>
      ${sub ? `<div class="home-stat-sub">${sub}</div>` : ''}
    </div>`;

  body.innerHTML = `
    <div class="home-hero">
      <h1 class="welcome-title">${greeting()}${firstName ? ', ' + escHtml(firstName) : ''}</h1>
      <p class="welcome-sub">${escHtml(state.org?.name || '')} · ${available.length} of ${state.agents.length} specialists unlocked</p>
    </div>

    <div class="home-stats">
      ${stat('Active leads', open, ins ? `${ins.funnel.new || 0} new this pipeline` : '')}
      ${stat('Meetings booked', ins ? ins.meetings_booked : '–', ins?.outreach?.reply_rate != null ? `${Math.round(ins.outreach.reply_rate * 100)}% reply rate` : '')}
      ${stat('Messages used', usage ? usage.messages : '–', usage && usage.limits.messages > 0 ? `of ${usage.limits.messages} this month` : '')}
      ${stat('Last harvest', lastRun ? `+${lastRun.leads_created}` : '–', lastRun ? `${escHtml((lastRun.created_at || '').slice(0, 10))} · ${lastRun.signals_found} signals` : 'No runs yet')}
    </div>

    <div class="home-actions">
      <button class="btn btn-primary" onclick="selectAgent('vantage')">Talk to Vantage</button>
      <button class="btn btn-ghost" onclick="showView('growth')">Run prospecting</button>
      <button class="btn btn-ghost" onclick="showView('leads')">Open pipeline</button>
      ${ins?.recommendations?.length ? '' : ''}
    </div>

    ${waitingRows ? `
    <div class="home-waiting">
      <div class="home-section-label">Waiting on you <span class="dim">// ${(followups.due || []).length + (followups.stale || []).length} leads</span></div>
      ${waitingRows}
    </div>` : ''}

    ${checklistHtml(orgSettings, icps, runs, ins)}

    ${ins?.recommendations?.length ? `
    <div class="home-reco">
      <div class="home-section-label">Latest insight</div>
      <div class="reco-item">${escHtml(ins.recommendations[0])}</div>
    </div>` : ''}

    <div class="home-section-label">Your specialists</div>
    <div class="home-agent-grid">
      ${state.agents.map(a => `
        <div class="agent-tile ${a.available ? '' : 'locked'}"
             onclick="${a.available ? `selectAgent('${a.id}')` : `showView('settings')`}">
          ${avatarHtml(a)}
          <div class="agent-tile-info">
            <div class="agent-tile-name">${escHtml(a.name)}</div>
            <div class="agent-tile-desc">${escHtml(a.description)}</div>
          </div>
          ${a.available ? (a.has_tools ? '<span class="tool-badge">tools</span>' : '') : '<span class="lock-label">Locked</span>'}
        </div>`).join('')}
    </div>`;
}


// ── Approvals inbox ────────────────────────────────────
async function refreshApprovalsBadge() {
  try {
    const data = await api('/api/approvals');
    const badge = document.getElementById('approvals-badge');
    badge.textContent = data.count;
    badge.style.display = data.count > 0 ? 'inline-flex' : 'none';
    return data;
  } catch (e) { return { count: 0, items: [] }; }
}

async function loadApprovals() {
  const body = document.getElementById('approvals-body');
  body.innerHTML = skeleton(4);
  const data = await refreshApprovalsBadge();
  if (!data.items.length) {
    body.innerHTML = `<div class="dim panel-empty">Inbox zero — nothing awaiting approval.<br><br>
      When <b>Vantage</b> schedules outreach, every email lands here for your review before it sends.</div>`;
    return;
  }
  body.innerHTML = data.items.map(s => `
    <div class="approval-card" id="appr-${s.id}">
      <div class="approval-head">
        <div class="approval-lead">
          <span class="lead-company">${escHtml(s.company_name)}</span>
          ${s.score != null ? `<span class="score-pill">${s.score}</span>` : ''}
          ${s.hook_type ? `<span class="tool-badge">${escHtml(s.hook_type)}</span>` : ''}
        </div>
        <div class="dim small">Step ${s.step} · sends ${escHtml((s.send_at || '').slice(0, 16).replace('T', ' '))}</div>
      </div>
      <div class="email-preview">
        <div class="email-row"><span class="email-label">From</span><div class="dim">${escHtml(state.org?.name || '')} · via Agent Hub</div></div>
        <div class="email-row"><span class="email-label">To</span><div>${escHtml(s.contact_name || '')} <span class="dim">&lt;${escHtml(s.contact_email || '')}&gt;</span></div></div>
        <div class="email-row"><span class="email-label">Subject</span><input class="email-subject" id="appr-subj-${s.id}" value="${escHtml(s.subject)}" /></div>
        <textarea class="email-body" id="appr-body-${s.id}" rows="8">${escHtml(s.body)}</textarea>
        <div class="email-footnote dim small">GDPR footer with unsubscribe link is appended automatically</div>
      </div>
      <div class="approval-actions">
        <button class="btn btn-primary btn-sm" onclick="approveStep(${s.id})">✓ &nbsp;Approve &amp; send</button>
        <button class="btn btn-ghost btn-sm btn-danger-ghost" onclick="rejectStep(${s.id})">Reject</button>
        <span class="dim small approval-edit-hint">Edit the subject or body directly — your version is what sends</span>
      </div>
    </div>`).join('');
}

async function approveStep(id) {
  try {
    await api(`/api/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({
      subject: document.getElementById(`appr-subj-${id}`).value,
      body: document.getElementById(`appr-body-${id}`).value,
    })});
    toast('Approved — sends at the next scheduled window');
    loadApprovals();
  } catch (e) { toast(e.message, 'error'); }
}

async function rejectStep(id) {
  if (!await confirmDialog('Reject this email? It will never send.', true)) return;
  try {
    await api(`/api/approvals/${id}/reject`, { method: 'POST' });
    toast('Rejected');
    loadApprovals();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Suggested prompts ──────────────────────────────────
const AGENT_PROMPTS = {
  vantage: ['Hitta 10 bolag i Stockholm som rekryterar utvecklare just nu',
            'Djup-enricha mina tre hetaste leads och föreslå outreach',
            'Hur presterar pipelinen — vad ska jag prioritera idag?'],
  forge:   ['Förbered en teknisk brief inför mötet med vårt hetaste lead',
            'Gör en teknisk analys av en kunds webbplats',
            'Hjälp mig estimera ett webbprojekt utifrån lösa krav'],
  beacon:  ['Finns det aktiva IT-upphandlingar i Sverige just nu?',
            'Gör en bid/no-bid-bedömning av en upphandling',
            'Strukturera ett anbudssvar enligt utvärderingskriterierna'],
  scroll:  ['Skriv en offert baserad på våra referenscase',
            'Gör om vårt senaste projekt till en case study',
            'Skriv ett LinkedIn-inlägg om något vi levererat'],
  nexus:   ['Hur går affären just nu? Ge mig en överblick',
            'Vilken agent ska jag använda för vad?',
            'Vad borde jag fokusera på den här veckan?'],
  haven:   ['Skriv en uppföljning till en kund vi levererade till i våras',
            'Föreslå merförsäljning för våra vunna kunder',
            'Utkast: be vår nöjdaste kund om en referens'],
  mentor:  ['Skapa en onboarding-plan för en ny konsult',
            'Lär mig hur vi skriver statusuppdateringar till kund',
            'Gör en övning av ett verkligt projektscenario'],
};
const DEFAULT_PROMPTS = ['Vad kan du hjälpa mig med?',
                         'Vad behöver du veta om oss för att göra ett bra jobb?'];

function promptChips(agentId) {
  const prompts = AGENT_PROMPTS[agentId] || DEFAULT_PROMPTS;
  return `<div class="prompt-chips">${prompts.map(p =>
    `<button class="prompt-chip" onclick="usePrompt(this)">${escHtml(p)}</button>`).join('')}</div>`;
}

function usePrompt(btn) {
  const input = document.getElementById('message-input');
  input.value = btn.textContent;
  autoResize(input);
  sendMessage();
}

// ── Office view ────────────────────────────────────────
function agoLabel(iso) {
  if (!iso) return null;
  const t = new Date(iso.replace(' ', 'T') + (/[Z+]/.test(iso) ? '' : 'Z')).getTime();
  if (isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function officeStatus(iso) {
  if (!iso) return ['standby', 'Standby'];
  const t = new Date(iso.replace(' ', 'T') + (/[Z+]/.test(iso) ? '' : 'Z')).getTime();
  const mins = (Date.now() - t) / 60000;
  if (mins < 10) return ['working', 'Working now'];
  if (mins < 24 * 60) return ['recent', 'Active today'];
  return ['standby', 'Standby'];
}

const OFFICE_ZONES = [
  ['Revenue floor', ['revenue']],
  ['Operations', ['operations']],
  ['Engineering & data', ['engineering', 'data', 'security']],
  ['Strategy & content', ['strategy', 'content', 'knowledge', 'general']],
];

const IDLE_QUIPS = [
  'Redo för uppdrag.', 'Väntar vid kaffemaskinen ☕', 'Skärper pennan…',
  'Läser på om branschen.', 'Håller skrivbordet varmt.', 'Stretchar inför nästa körning.',
];

function deskBubble(a, st, cls) {
  if (cls === 'working') {
    const task = st.last_task ? `“${escHtml(st.last_task)}”` : 'Arbetar';
    return `<div class="desk-bubble live">${task}<span class="tdots"><i></i><i></i><i></i></span></div>`;
  }
  if (st.last_task) {
    return `<div class="desk-bubble">“${escHtml(st.last_task)}”</div>`;
  }
  const idx = ([...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)
               + new Date().getHours()) % IDLE_QUIPS.length;
  return `<div class="desk-bubble idle">${IDLE_QUIPS[idx]}</div>`;
}

function deskHtml(a, st) {
  const [cls, label] = officeStatus(st.last_at);
  const ago = agoLabel(st.last_at);
  return `
    <div class="desk ${cls}" onclick="selectAgent('${a.id}')" role="button" title="Open ${escHtml(a.name)}">
      ${deskBubble(a, st, cls)}
      <div class="desk-avatar">${avatarHtml(a, 'lg')}</div>
      <div class="desk-name">${escHtml(a.name)}</div>
      <div class="desk-cat dim">${escHtml(a.category || '')}</div>
      <div class="desk-status">
        <span class="desk-dot"></span>${label}
      </div>
      <div class="desk-meta dim small">
        ${st.messages ? `${st.messages} messages` : 'No conversations yet'}${ago ? ` · ${ago}` : ''}
      </div>
    </div>`;
}

async function loadOffice() {
  const body = document.getElementById('office-body');
  if (!body.dataset.loaded) body.innerHTML = skeleton(4);
  try {
    const data = await api('/api/office');
    const byId = {};
    (data.agents || []).forEach(a => { byId[a.agent_id] = a; });

    const placed = new Set();
    const zones = OFFICE_ZONES.map(([zone, cats]) => {
      const members = (state.agents || []).filter(a => cats.includes(a.category));
      members.forEach(a => placed.add(a.id));
      if (!members.length) return '';
      const working = members.filter(a => officeStatus((byId[a.id] || {}).last_at)[0] === 'working').length;
      return `
        <div class="office-zone">
          <div class="office-zone-head">
            <span class="office-zone-name">${escHtml(zone)}</span>
            <span class="dim small">${members.length} agents${working ? ` · <span class="zone-live">${working} working</span>` : ''}</span>
          </div>
          <div class="office-grid">${members.map(a => deskHtml(a, byId[a.id] || {})).join('')}</div>
        </div>`;
    }).join('');
    const rest = (state.agents || []).filter(a => !placed.has(a.id));
    const restHtml = rest.length
      ? `<div class="office-zone">
           <div class="office-zone-head"><span class="office-zone-name">Floaters</span></div>
           <div class="office-grid">${rest.map(a => deskHtml(a, byId[a.id] || {})).join('')}</div>
         </div>`
      : '';
    const desks = zones + restHtml;

    const feedRows = (data.feed || []).map(f => `
      <div class="office-event">
        <span class="office-event-dot kind-${escHtml(f.kind)}"></span>
        <div>
          <div class="office-event-text">${escHtml(f.text)}</div>
          <div class="dim small">${agoLabel(f.at) || escHtml((f.at || '').slice(0, 16))}</div>
        </div>
      </div>`).join('') ||
      '<div class="dim">Quiet so far — run a harvest or talk to an agent and the activity shows up here.</div>';

    body.innerHTML = `
      <div class="office-layout">
        <div>
          <div class="dash-label">THE FLOOR <span class="dim">// CLICK A DESK TO TALK TO THE AGENT</span></div>
          ${desks}
        </div>
        <div class="office-feed">
          <div class="dash-label">LIVE WIRE <span class="dim">// LATEST ACTIVITY</span></div>
          ${feedRows}
        </div>
      </div>`;
    body.dataset.loaded = '1';
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

async function showDossier(id, btn) {
  const out = document.getElementById(`dossier-${id}`);
  btn.disabled = true; btn.textContent = 'Bygger…';
  try {
    const d = await api(`/api/leads/${id}/dossier`, { method: 'POST' });
    out.style.display = '';
    out.innerHTML = `<div class="dossier">${DOMPurify.sanitize(marked.parse(d.markdown || ''))}</div>`;
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Dossier';
}

async function convertLead(id) {
  if (!await confirmDialog('Gör detta lead till kund? Bolaget utesluts då permanent ur skörd och outreach.')) return;
  try {
    await api(`/api/crm/convert/${id}`, { method: 'POST' });
    toast('Konverterad till kund — skyddad från outreach');
    loadLeads();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Customers (CRM) ────────────────────────────────────
async function loadCustomers() {
  const body = document.getElementById('customers-body');
  body.innerHTML = skeleton(4);
  try {
    const data = await api('/api/crm/accounts');
    const rows = (data.accounts || []).map(a => `
      <tr>
        <td>
          <div class="lead-company">${escHtml(a.company_name)}</div>
          <div class="dim">${escHtml(a.domain || a.org_number || '')}</div>
        </td>
        <td>
          <div>${escHtml(a.contact_name || '–')}</div>
          <div class="dim">${escHtml(a.contact_email || '')}</div>
        </td>
        <td>
          <select class="pixel-select" onchange="updateAccount('${a.id}', { status: this.value })">
            ${data.statuses.map(s => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
          </select>
        </td>
        <td>${a.monthly_value ? a.monthly_value.toLocaleString() + ' kr/mån' : '<span class="dim">–</span>'}</td>
        <td class="dim">${escHtml((a.notes || '').slice(0, 60))}</td>
        <td><button class="pixel-btn small danger" onclick="removeAccount('${a.id}')">DEL</button></td>
      </tr>`).join('') ||
      '<tr><td colspan="6" class="dim">INGA KUNDER ÄN — LÄGG TILL ERA BEFINTLIGA KUNDER SÅ SKYDDAS DE FRÅN ALL OUTREACH, ELLER KONVERTERA VUNNA LEADS.</td></tr>';

    const mrr = (data.accounts || []).reduce((s, a) => s + (a.monthly_value || 0), 0);
    body.innerHTML = `
      <div class="dash-section">
        <div class="dash-label">CUSTOMER REGISTER <span class="dim">// ${(data.accounts || []).length} RELATIONER${mrr ? ' · ' + mrr.toLocaleString() + ' KR/MÅN' : ''} — PERMANENT UTESLUTNA UR SKÖRD & OUTREACH</span></div>
        <table class="leads-table">
          <thead><tr><th>COMPANY</th><th>CONTACT</th><th>STATUS</th><th>VALUE</th><th>NOTES</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="settings-row" style="margin-top:14px">
          <input type="text" id="acc-name" class="pixel-input" placeholder="FÖRETAGSNAMN" />
          <input type="text" id="acc-orgnr" class="pixel-input" style="max-width:140px" placeholder="ORGNR" />
          <input type="text" id="acc-domain" class="pixel-input" style="max-width:160px" placeholder="DOMÄN" />
        </div>
        <div class="settings-row">
          <input type="text" id="acc-contact" class="pixel-input" placeholder="KONTAKTPERSON" />
          <input type="email" id="acc-email" class="pixel-input" placeholder="E-POST" />
          <input type="number" id="acc-value" class="pixel-input" style="max-width:140px" placeholder="KR/MÅN" />
          <button class="pixel-btn small" onclick="addAccount()">ADD CUSTOMER</button>
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="dim panel-empty">ERROR: ${escHtml(e.message)}</div>`;
  }
}

async function addAccount() {
  const name = document.getElementById('acc-name').value.trim();
  if (!name) { toast('Företagsnamn krävs', 'error'); return; }
  try {
    await api('/api/crm/accounts', { method: 'POST', body: JSON.stringify({
      company_name: name,
      org_number: document.getElementById('acc-orgnr').value.trim() || null,
      domain: document.getElementById('acc-domain').value.trim() || null,
      contact_name: document.getElementById('acc-contact').value.trim() || null,
      contact_email: document.getElementById('acc-email').value.trim() || null,
      monthly_value: parseInt(document.getElementById('acc-value').value) || null,
    })});
    toast('Kund tillagd — skyddad från outreach');
    loadCustomers();
  } catch (e) { toast(e.message, 'error'); }
}

async function updateAccount(id, fields) {
  try { await api(`/api/crm/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }); toast('Sparat'); }
  catch (e) { toast(e.message, 'error'); }
}

async function removeAccount(id) {
  if (!await confirmDialog('Ta bort från kundregistret? Bolaget kan då skördas igen.', true)) return;
  try { await api(`/api/crm/accounts/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
  loadCustomers();
}

// ── Growth view ────────────────────────────────────────
async function loadGrowth() {
  const body = document.getElementById('growth-body');
  body.innerHTML = skeleton(5);
  try {
    const [icps, runs, presets] = await Promise.all([
      api('/api/growth/icps'), api('/api/growth/runs'),
      api('/api/growth/icp-presets').catch(() => []),
    ]);
    state.icpCache = icps;
    const haveNames = new Set(icps.map(i => i.name));
    const presetCards = (presets || []).filter(p => !haveNames.has(p.label)).map(p => `
      <div class="preset-card">
        <div class="preset-label">${escHtml(p.label)}</div>
        <div class="preset-desc dim">${escHtml(p.description)}</div>
        <div class="preset-foot">
          <span class="dim small">${p.signals.join(' · ')}</span>
          <button class="pixel-btn small" onclick="addPreset('${p.id}', this)">ADD</button>
        </div>
      </div>`).join('');

    const icpRows = icps.map(icp => `
      <tr>
        <td>
          <div class="lead-company">${escHtml(icp.name)}</div>
          <div class="dim">${escHtml((icp.target_roles || []).join(', ') || 'standardroller')}
            ${icp.regions?.length ? ' // ' + escHtml(icp.regions.join(', ')) : ''}</div>
        </td>
        <td>${icp.auto_run ? '<span style="color:#44ff88">WEEKLY</span>' : '<span class="dim">MANUAL</span>'}${icp.autopilot ? ' <span title="Autopilot: sekvenser schemaläggs till Approvals" style="color:var(--accent)">⚡</span>' : ''}</td>
        <td>${[(icp.target_roles || []).length ? 'Hiring' : null, icp.include_new_companies && 'Newco', icp.include_funding && 'Funding', icp.include_expansion && 'Expansion', icp.include_leadership && 'Leadership', icp.include_tenders && 'Tenders'].filter(Boolean).join(' · ') || 'Hiring (standardroller)'}</td>
        <td>
          <button class="pixel-btn small" onclick="runIcp('${icp.id}', this)">RUN NOW</button>
          <button class="pixel-btn small" onclick="editIcp('${icp.id}')">EDIT</button>
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
      ${presetCards ? `
      <div class="dash-section">
        <div class="dash-label">QUICK START <span class="dim">// FÄRDIGA PROFILER FÖR VÅRT ERBJUDANDE — ETT KLICK, SEDAN RUN NOW</span></div>
        <div class="preset-grid">${presetCards}</div>
      </div>` : ''}

      <div class="dash-section">
        <div class="dash-label">ICP PROFILES <span class="dim">// WHAT SIGNALS TO HARVEST</span></div>
        ${icps.length ? `
        <table class="leads-table">
          <thead><tr><th>PROFILE</th><th>SCHEDULE</th><th>SIGNALS</th><th></th></tr></thead>
          <tbody>${icpRows}</tbody>
        </table>` : '<div class="dim" style="line-height:2">NO ICP YET — CREATE ONE BELOW. LEADS WILL BE HARVESTED FROM COMPANIES HIRING THESE ROLES.</div>'}
        <div class="dash-label" id="icp-form-label" style="margin-top:18px">NEW PROFILE</div>
        <div class="settings-row" style="margin-top:8px">
          <input type="text" id="icp-name" class="pixel-input" placeholder="PROFILE NAME (E.G. WEBB STHLM)" />
          <input type="text" id="icp-roles" class="pixel-input" placeholder="ROLES, COMMA-SEP (frontendutvecklare, ...)" />
          <input type="text" id="icp-regions" class="pixel-input" placeholder="REGIONS (Stockholm, ...)" />
        </div>
        <div class="settings-row">
          <input type="text" id="icp-sell" class="pixel-input" placeholder="WHAT WE SELL (USED IN OUTREACH)" />
          <label class="dim small"><input type="checkbox" id="icp-newco" /> Newly registered</label>
          <label class="dim small"><input type="checkbox" id="icp-funding" /> Funding rounds</label>
          <label class="dim small"><input type="checkbox" id="icp-expansion" /> Expansion news</label>
          <label class="dim small"><input type="checkbox" id="icp-leadership" /> New executives</label>
          <label class="dim small"><input type="checkbox" id="icp-tenders" /> Public tenders</label>
          <label class="dim small"><input type="checkbox" id="icp-autopilot" /> Autopilot (sekvens → Approvals)</label>
          <label class="dim small"><input type="checkbox" id="icp-auto" checked /> Weekly auto-run</label>
          <button class="pixel-btn small" id="icp-submit" onclick="createIcp()">CREATE</button>
          <button class="pixel-btn small" id="icp-cancel-edit" style="display:none" onclick="cancelIcpEdit()">CANCEL</button>
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

function icpFormData() {
  const split = v => v.split(',').map(s => s.trim()).filter(Boolean);
  return {
    name: document.getElementById('icp-name').value.trim(),
    what_we_sell: document.getElementById('icp-sell').value.trim() || null,
    target_roles: split(document.getElementById('icp-roles').value),
    regions: split(document.getElementById('icp-regions').value),
    include_new_companies: document.getElementById('icp-newco').checked,
    include_funding: document.getElementById('icp-funding').checked,
    include_expansion: document.getElementById('icp-expansion').checked,
    include_leadership: document.getElementById('icp-leadership').checked,
    include_tenders: document.getElementById('icp-tenders').checked,
    autopilot: document.getElementById('icp-autopilot').checked,
    auto_run: document.getElementById('icp-auto').checked,
  };
}

function editIcp(id) {
  const icp = (state.icpCache || []).find(i => i.id === id);
  if (!icp) return;
  state.editingIcp = id;
  document.getElementById('icp-form-label').textContent = `EDITING: ${icp.name.toUpperCase()}`;
  document.getElementById('icp-name').value = icp.name || '';
  document.getElementById('icp-sell').value = icp.what_we_sell || '';
  document.getElementById('icp-roles').value = (icp.target_roles || []).join(', ');
  document.getElementById('icp-regions').value = (icp.regions || []).join(', ');
  document.getElementById('icp-newco').checked = !!icp.include_new_companies;
  document.getElementById('icp-funding').checked = !!icp.include_funding;
  document.getElementById('icp-expansion').checked = !!icp.include_expansion;
  document.getElementById('icp-leadership').checked = !!icp.include_leadership;
  document.getElementById('icp-tenders').checked = !!icp.include_tenders;
  document.getElementById('icp-autopilot').checked = !!icp.autopilot;
  document.getElementById('icp-auto').checked = !!icp.auto_run;
  document.getElementById('icp-submit').textContent = 'SAVE CHANGES';
  document.getElementById('icp-cancel-edit').style.display = '';
  document.getElementById('icp-name').focus();
}

function cancelIcpEdit() {
  state.editingIcp = null;
  loadGrowth();
}

async function addPreset(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    await api(`/api/growth/icps/from-preset/${id}`, { method: 'POST' });
    toast('Profile added — press RUN NOW to harvest');
    loadGrowth();
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'ADD'; }
}

async function createIcp() {
  const data = icpFormData();
  if (!data.name) { toast('Profile name required', 'error'); return; }
  try {
    if (state.editingIcp) {
      await api(`/api/growth/icps/${state.editingIcp}`, { method: 'PATCH', body: JSON.stringify(data) });
      state.editingIcp = null;
      toast('Profile updated');
    } else {
      await api('/api/growth/icps', { method: 'POST', body: JSON.stringify(data) });
    }
    loadGrowth();
  } catch (e) { toast(e.message, 'error'); }
}

async function runIcp(id, btn) {
  btn.disabled = true; btn.textContent = 'RUNNING...';
  try {
    const r = await api(`/api/growth/icps/${id}/run`, { method: 'POST' });
    toast(`Run complete: ${r.leads_created} new leads, ${r.duplicates_skipped} duplicates skipped`);
    loadGrowth();
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Run now'; }
}

async function toggleIcpAuto(id, enable) {
  try {
    await api(`/api/growth/icps/${id}`, { method: 'PATCH',
      body: JSON.stringify({ auto_run: enable }) });
    loadGrowth();
  } catch (e) { toast(e.message, 'error'); }
}

async function removeIcp(id) {
  if (!await confirmDialog('Delete this ICP profile?', true)) return;
  try { await api(`/api/growth/icps/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
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
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.onclick = () => agent.available ? selectAgent(agent.id) : showView('settings');
    card.onkeydown = e => { if (e.key === 'Enter') card.onclick(); };

    const statusHtml = agent.available
      ? `<span class="status-dot"></span>
         <span class="status-label" id="slabel-${agent.id}">Idle</span>`
      : `<span class="lock-label">Upgrade to unlock</span>`;

    card.innerHTML = `
      ${avatarHtml(agent)}
      <div class="agent-card-info">
        <div class="agent-card-name">${agent.name}${agent.has_tools ? ' <span class="tool-badge" title="Has live tools">tools</span>' : ''}</div>
        <div class="agent-card-desc">${agent.description}</div>
        <div class="agent-status-row">${statusHtml}</div>
      </div>
    `;
    list.appendChild(card);
  });
}

// ── Select agent ───────────────────────────────────────
function selectAgent(id) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.current = id;
  closeSidebarOnMobile();
  showView('agents');

  document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`card-${id}`)?.classList.add('active');

  const agent = state.agents.find(a => a.id === id);
  if (!agent) return;

  document.getElementById('welcome-screen').style.display = 'none';
  const chatArea = document.getElementById('chat-area');
  chatArea.style.display = 'flex';

  document.getElementById('header-avatar').innerHTML = avatarHtml(agent, 'lg');

  document.getElementById('header-name').textContent = agent.name;
  document.getElementById('header-desc').textContent = agent.description;

  if (!state.sessions[id]) { state.sessions[id] = genSessionId(); persistSessions(); }
  if (!state.messages[id]) state.messages[id] = [];
  if (state.messages[id].length === 0) {
    // Restore the persisted conversation from the server (fire and forget)
    api(`/api/conversations/${id}/${state.sessions[id]}`).then(data => {
      if (data.messages?.length && state.current === id) {
        state.messages[id] = data.messages;
        renderMessages(id);
      }
    }).catch(() => {});
  }
  renderMessages(id);
  connectWebSocket(id, state.sessions[id]);
}

function genSessionId() {
  return 'sess_' + Math.random().toString(36).substring(2, 15);
}

function persistSessions() {
  localStorage.setItem('ahub_sessions', JSON.stringify(state.sessions));
}

// ── Conversation history ───────────────────────────────
async function toggleHistory() {
  const pop = document.getElementById('history-pop');
  if (pop.style.display !== 'none') { pop.style.display = 'none'; return; }
  pop.style.display = 'block';
  pop.innerHTML = '<div class="history-item dim">Loading…</div>';
  try {
    const sessions = await api(`/api/conversations/${state.current}`);
    if (!sessions.length) {
      pop.innerHTML = '<div class="history-item dim">No earlier conversations</div>';
      return;
    }
    pop.innerHTML = sessions.map(s => `
      <div class="history-item ${s.session_id === state.sessions[state.current] ? 'active' : ''}"
           onclick="openSession('${s.session_id}')">
        <div class="history-snippet">${escHtml(s.snippet || 'New conversation')}</div>
        <div class="dim small">${escHtml((s.last_at || '').slice(0, 16).replace('T', ' '))} · ${s.messages} messages</div>
      </div>`).join('');
  } catch (e) {
    pop.innerHTML = `<div class="history-item dim">${escHtml(e.message)}</div>`;
  }
}

async function openSession(sessionId) {
  document.getElementById('history-pop').style.display = 'none';
  const agentId = state.current;
  state.sessions[agentId] = sessionId;
  persistSessions();
  try {
    const data = await api(`/api/conversations/${agentId}/${sessionId}`);
    state.messages[agentId] = data.messages;
  } catch (e) { state.messages[agentId] = []; }
  renderMessages(agentId);
  if (state.ws) { state.ws.close(); state.ws = null; }
  connectWebSocket(agentId, sessionId);
}

function newChat() {
  document.getElementById('history-pop').style.display = 'none';
  const agentId = state.current;
  state.sessions[agentId] = genSessionId();
  persistSessions();
  state.messages[agentId] = [];
  renderMessages(agentId);
  if (state.ws) { state.ws.close(); state.ws = null; }
  connectWebSocket(agentId, state.sessions[agentId]);
  toast('New conversation started');
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
  find_public_tenders:     'SCANNING PUBLIC TENDERS',
  start_email_sequence:    'SCHEDULING OUTREACH SEQUENCE',
  cancel_email_sequence:   'STOPPING SEQUENCE',
  get_sequence_status:     'CHECKING SEQUENCE',
  check_sending_domain:    'AUDITING EMAIL DELIVERABILITY',
  analyze_pipeline_performance: 'ANALYZING WIN/LOSS DATA',
  search_knowledge:        'SEARCHING KNOWLEDGE BASE',
  save_knowledge:          'SAVING TO KNOWLEDGE BASE',
};

function handleWsMsg(data, agentId) {
  if (agentId !== state.current) return;

  switch (data.type) {
    case 'session':
      state.sessions[agentId] = data.session_id;
      persistSessions();
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
      persistSessions();
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
    el.textContent = text === 'WORKING' ? 'Working' : 'Idle';
    el.style.color = text === 'WORKING' ? 'var(--accent-2)' : 'var(--dim)';
  }
  const dot = el?.closest('.agent-status-row')?.querySelector('.status-dot');
  if (dot) dot.style.background = text === 'WORKING' ? 'var(--accent-2)' : 'var(--dim)';
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
      <div class="chat-empty-name">${agent?.name ?? 'Agent'} is ready</div>
      <div class="chat-empty-hint">Try one of these to get started</div>
      ${promptChips(agentId)}
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

function leadsViewMode() {
  try { return localStorage.getItem('ahub_leads_view') || 'table'; }
  catch (e) { return 'table'; }
}

function setLeadsView(mode) {
  try { localStorage.setItem('ahub_leads_view', mode); } catch (e) { /* private mode */ }
  syncViewToggle(mode);
  loadLeads();
}

function syncViewToggle(mode) {
  const t = document.getElementById('vt-table'), b = document.getElementById('vt-board');
  if (!t || !b) return;
  t.classList.toggle('active', mode !== 'board');
  b.classList.toggle('active', mode === 'board');
}

function renderBoard(body, leads, statuses) {
  const cols = statuses.map(status => {
    const cards = leads.filter(l => l.status === status).map(l => `
      <div class="kanban-card" draggable="true" id="kcard-${l.id}"
           ondragstart="event.dataTransfer.setData('text/plain','${l.id}'); this.classList.add('dragging')"
           ondragend="this.classList.remove('dragging')"
           onclick="setLeadsView('table')">
        <div class="kanban-card-top">
          <div class="lead-company">${escHtml(l.company_name)}</div>
          ${scoreRing(l.score, 30)}
        </div>
        <div class="dim small">${escHtml(l.contact_name || l.domain || l.source || '')}</div>
        <div class="dim small kanban-card-meta">${escHtml(l.location || '')}</div>
      </div>`).join('');
    return `
      <div class="kanban-col" data-status="${status}"
           ondragover="event.preventDefault(); this.classList.add('drop')"
           ondragleave="this.classList.remove('drop')"
           ondrop="this.classList.remove('drop'); dropLead(event, '${status}')">
        <div class="kanban-col-head">
          <span class="kanban-col-title">${status.toUpperCase()}</span>
          <span class="kanban-count">${leads.filter(l => l.status === status).length}</span>
        </div>
        <div class="kanban-cards">${cards}</div>
      </div>`;
  }).join('');
  body.innerHTML = `<div class="kanban">${cols}</div>`;
}

async function dropLead(ev, status) {
  const id = ev.dataTransfer.getData('text/plain');
  if (!id) return;
  try {
    await api(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(`Moved to ${status}`);
  } catch (e) { toast(e.message, 'error'); }
  loadLeads();
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
    syncViewToggle(leadsViewMode());
    if (leadsViewMode() === 'board' && data.leads.length) {
      renderBoard(body, data.leads, data.statuses);
      return;
    }
    if (!data.leads.length) {
      body.innerHTML = `<div class="panel-empty empty-state">
        <div class="empty-mark">«</div>
        <div class="empty-title">Tomt på golvet.</div>
        <div class="dim">Släpp loss VANTAGE — eller tryck RUN NOW under Growth så skördar maskinen åt dig.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="selectAgent('vantage')">Väck VANTAGE</button>
      </div>`;
      return;
    }

    const rows = data.leads.map(l => `
      <tr class="lead-row" onclick="toggleLeadDetail('${l.id}')">
        <td>${scoreRing(l.score)}</td>
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
          ${l.next_action ? `<div class="lead-section next-action ${l.next_action_due && l.next_action_due < new Date().toISOString().slice(0,10) ? 'overdue' : ''}">
            <span class="dim">NEXT ACTION</span> ${escHtml(l.next_action)} <span class="dim">· senast ${escHtml(l.next_action_due || '')}</span>
          </div>` : ''}
          <div class="lead-section lead-actions-row">
            ${!l.contact_email ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); findContact('${l.id}', this)">Find contact</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); showDossier('${l.id}', this)">Dossier</button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); convertLead('${l.id}')">Gör till kund</button>
          </div>
          <div class="lead-section dossier-out" id="dossier-${l.id}" style="display:none"></div>
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
  if (!await confirmDialog('Stop the remaining sequence steps?', true)) return;
  try { await api(`/api/leads/${leadId}/sequence/cancel`, { method: 'POST' }); }
  catch (e) { toast(e.message, 'error'); }
  loadLeads();
}

async function findContact(id, btn) {
  btn.disabled = true; btn.textContent = 'Searching…';
  try {
    const r = await api(`/api/leads/${id}/find-contact`, { method: 'POST' });
    if (r.found) {
      toast(`Contact found via ${r.source}${r.note ? ' — ' + r.note : ''}`);
      loadLeads();
    } else {
      toast(r.note || 'No contact found', 'error');
      btn.disabled = false; btn.textContent = 'Find contact';
    }
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.textContent = 'Find contact';
  }
}

async function setLeadStatus(id, status) {
  try { await api(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); }
  catch (e) { toast(e.message, 'error'); }
  loadLeads();
}

async function removeLead(id) {
  if (!await confirmDialog('Delete this lead? The company is blocked from re-harvest for 45 days.', true)) return;
  try { await api(`/api/leads/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
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
  body.innerHTML = skeleton(5);
  try {
    const [org, usage, ins] = await Promise.all([
      api('/api/org'), api('/api/usage'), api('/api/growth/insights'),
    ]);
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
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-label">MEETINGS BOOKED</div>
          <div class="dash-value">${ins.meetings_booked}</div>
          <div class="dim">THE METRIC THAT MATTERS</div>
        </div>
        <div class="dash-card">
          <div class="dash-label">FUNNEL</div>
          <div class="dim" style="line-height:2">
            ${['new','qualified','contacted','meeting','won','lost']
              .map(s => `${s.toUpperCase()}: ${ins.funnel[s] || 0}`).join('<br>')}
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-label">OUTREACH</div>
          <div class="dash-value small">${ins.outreach.emails_sent} SENT</div>
          <div class="dim">${ins.outreach.replies} REPLIES${ins.outreach.reply_rate != null ? ' (' + Math.round(ins.outreach.reply_rate * 100) + '%)' : ''} // ${ins.outreach.unsubscribes} OPT-OUT</div>
        </div>
        <div class="dash-card">
          <div class="dash-label">SCORE CALIBRATION</div>
          <div class="dim" style="line-height:2">
            WON AVG: ${ins.score_calibration.avg_score_won ?? '--'}<br>
            LOST AVG: ${ins.score_calibration.avg_score_lost ?? '--'}<br>
            OUTCOMES: ${ins.score_calibration.outcomes}
          </div>
        </div>
      </div>

      ${ins.recommendations.length ? `
      <div class="dash-section">
        <div class="dash-label">SYSTEM RECOMMENDATIONS <span class="dim">// LEARNED FROM YOUR OUTCOMES</span></div>
        <div class="reco-list">
          ${ins.recommendations.map(r => `<div class="reco-item">> ${escHtml(r)}</div>`).join('')}
        </div>
      </div>` : ''}

      ${ins.by_source.length ? `
      <div class="dash-section">
        <div class="dash-label">WIN RATE BY LEAD SOURCE</div>
        <table class="leads-table slim">
          <thead><tr><th>SOURCE</th><th>WON</th><th>LOST</th><th>OPEN</th><th>WIN RATE</th></tr></thead>
          <tbody>${ins.by_source.map(s => `
            <tr><td>${escHtml(s.segment)}</td><td>${s.won}</td><td>${s.lost}</td>
            <td>${s.open}</td><td>${s.win_rate != null ? Math.round(s.win_rate * 100) + '%' : '--'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

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
    const [org, plans, orgSettings, knowledge, integrations] = await Promise.all([
      api('/api/org'), api('/api/billing/plans'), api('/api/org/settings'),
      api('/api/knowledge'),
      api('/api/integrations').catch(() => ({ connectors: [] })),
    ]);
    const keys = isAdmin ? await api('/api/keys') : [];

    const knowledgeRows = knowledge.entries.map(k => `
      <tr>
        <td><span class="dim">${escHtml(k.kind.toUpperCase())}</span></td>
        <td>${escHtml(k.title)}</td>
        <td><button class="pixel-btn small danger" onclick="removeKnowledge('${k.id}')">DEL</button></td>
      </tr>`).join('') || '<tr><td colspan="3" class="dim">EMPTY — ADD REFERENCE CASES & STANDARDS SO AGENTS CAN USE THEM</td></tr>';

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

    const connectorCards = (integrations.connectors || []).map(c => `
      <div class="conn-card ${c.connected ? 'on' : ''} ${c.available === false ? 'soon' : ''}">
        <div class="conn-card-top">
          <div class="conn-card-name">${escHtml(c.name)}</div>
          <span class="conn-pill ${c.available === false ? 'pill-soon' : c.connected ? 'pill-on' : 'pill-off'}">
            ${c.available === false ? 'Coming soon' : c.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div class="conn-card-cat dim">${escHtml(c.category || '')}</div>
        <div class="conn-card-detail">${escHtml(c.detail || '')}</div>
      </div>`).join('');

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
        <div class="dash-label">BUSINESS PROFILE <span class="dim">// TELLS EVERY AGENT WHAT *YOUR* COMPANY DOES</span></div>
        <div class="settings-row">
          <textarea id="biz-profile-input" class="pixel-input" rows="3"
            style="width:100%; resize:vertical; font-family:var(--font); font-size:7px"
            placeholder="E.G. 'VI ÄR ETT UTVECKLINGSKONSULTBOLAG SOM BYGGER WEBB & APPAR FÖR SMB I SVERIGE...'"
            ${isAdmin ? '' : 'disabled'}>${escHtml(orgSettings.business_profile || '')}</textarea>
        </div>
        ${isAdmin ? '<div class="settings-row"><button class="pixel-btn small" onclick="saveBizProfile()">SAVE</button></div>' : ''}
      </div>

      <div class="dash-section">
        <div class="dash-label">OUTREACH <span class="dim">// USED BY EMAIL SEQUENCES</span></div>
        <div class="settings-row">
          <input type="text" id="booking-url-input" class="pixel-input"
                 placeholder="BOOKING URL (E.G. CALENDLY)" value="${escHtml(orgSettings.booking_url || '')}" ${isAdmin ? '' : 'disabled'} />
          <input type="number" id="send-limit-input" class="pixel-input" style="max-width:120px"
                 placeholder="Sends/day" value="${orgSettings.daily_send_limit || 20}" ${isAdmin ? '' : 'disabled'} />
          <label class="dim small" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="require-approval-input" ${orgSettings.require_approval === false ? '' : 'checked'} ${isAdmin ? '' : 'disabled'} />
            Require approval before sending
          </label>
          ${isAdmin ? '<button class="pixel-btn small" onclick="saveOutreachSettings()">SAVE</button>' : ''}
        </div>
        <div class="dim" style="font-size:6px; margin-top:8px; line-height:1.8">
          EMAIL SENDING: CONFIGURED VIA SMTP_* ENV VARS. WITHOUT EMAIL_ENABLED=TRUE ALL SENDS ARE SIMULATED (DRY-RUN).
        </div>
      </div>

      ${connectorCards ? `
      <div class="dash-section">
        <div class="dash-label">CONNECTORS <span class="dim">// CONFIGURED VIA ENV VARS ON THE SERVER — NO CREDENTIALS STORED IN THE DATABASE</span></div>
        <div class="conn-grid">${connectorCards}</div>
      </div>` : ''}

      <div class="dash-section">
        <div class="dash-label">KNOWLEDGE BASE <span class="dim">// REFERENCE CASES, TECH STANDARDS, OFFERINGS — USED BY FORGE, VANTAGE, SCROLL, MENTOR M.FL.</span></div>
        <table class="leads-table slim">
          <thead><tr><th>KIND</th><th>TITLE</th><th></th></tr></thead>
          <tbody>${knowledgeRows}</tbody>
        </table>
        <div class="settings-row">
          <select id="kb-kind" class="pixel-select">
            ${knowledge.kinds.map(k => `<option value="${k}">${k.toUpperCase()}</option>`).join('')}
          </select>
          <input type="text" id="kb-title" class="pixel-input" placeholder="TITLE (E.G. 'E-COMMERCE FOR ACME AB')" />
        </div>
        <div class="settings-row">
          <textarea id="kb-content" class="pixel-input" rows="3" style="width:100%; resize:vertical; font-family:var(--font); font-size:7px"
            placeholder="CONTENT — WHAT WAS BUILT, TECH, RESULT / THE STANDARD / THE OFFERING..."></textarea>
        </div>
        <div class="settings-row">
          <button class="pixel-btn small" onclick="addKnowledge()">ADD ENTRY</button>
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

async function saveBizProfile() {
  try {
    await api('/api/org/settings', { method: 'PATCH', body: JSON.stringify({
      business_profile: document.getElementById('biz-profile-input').value.trim() || null,
    })});
    toast('Saved — every agent now adapts to your business');
  } catch (e) { toast(e.message, 'error'); }
}

async function addKnowledge() {
  const title = document.getElementById('kb-title').value.trim();
  const content = document.getElementById('kb-content').value.trim();
  if (!title || !content) { toast('Title and content required', 'error'); return; }
  try {
    await api('/api/knowledge', { method: 'POST', body: JSON.stringify({
      kind: document.getElementById('kb-kind').value, title, content,
    })});
    loadSettings();
  } catch (e) { toast(e.message, 'error'); }
}

async function removeKnowledge(id) {
  if (!await confirmDialog('Delete this knowledge entry?', true)) return;
  try { await api(`/api/knowledge/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
  loadSettings();
}

async function saveOutreachSettings() {
  try {
    await api('/api/org/settings', { method: 'PATCH', body: JSON.stringify({
      booking_url: document.getElementById('booking-url-input').value.trim() || null,
      daily_send_limit: parseInt(document.getElementById('send-limit-input').value) || null,
      require_approval: document.getElementById('require-approval-input').checked,
    })});
    toast('Saved');
  } catch (e) { toast(e.message, 'error'); }
}

async function saveOrgName() {
  const name = document.getElementById('org-name-input').value.trim();
  if (!name) return;
  try {
    await api('/api/org', { method: 'PATCH', body: JSON.stringify({ name }) });
    state.org.name = name;
    document.getElementById('footer-org').textContent =
      `${name.slice(0, 22)} · ${state.org.plan.charAt(0).toUpperCase() + state.org.plan.slice(1)}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function switchPlan(planId) {
  if (!await confirmDialog(`Switch to the ${planId.charAt(0).toUpperCase() + planId.slice(1)} plan?`)) return;
  try {
    await api('/api/billing/plan', { method: 'POST', body: JSON.stringify({ plan: planId }) });
    state.org.plan = planId;
    // Re-fetch agents: availability may have changed
    state.agents = await api('/api/v1/agents');
    renderSidebar();
    loadSettings();
    document.getElementById('footer-org').textContent =
      `${state.org.name.slice(0, 22)} · ${planId.charAt(0).toUpperCase() + planId.slice(1)}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function inviteMember() {
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const password = document.getElementById('invite-password').value;
  if (!name || !email || password.length < 8) {
    toast('Name, email and a password of at least 8 characters are required', 'error');
    return;
  }
  try {
    await api('/api/auth/invite', {
      method: 'POST', body: JSON.stringify({ name, email, password }),
    });
    loadSettings();
  } catch (e) { toast(e.message, 'error'); }
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
  } catch (e) { toast(e.message, 'error'); }
}

async function revokeKey(id) {
  if (!await confirmDialog('Revoke this API key? Integrations using it stop working.', true)) return;
  try { await api(`/api/keys/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
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
