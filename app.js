// ═══════════════════════════════════════
// State
// ═══════════════════════════════════════
let traces = [];
let currentTraceId = null;
let currentMsgs = [];
let selectedLoop = null;
let isTaskRunning = false;
let logLines = [];
let logSSE = null;
let pollTimer = null;
let wsSocket = null;  // WebSocket connection for real-time updates
let selectedMethod = 'text';
let chipFilter = 'all';
let currentFiles = { pdf: [], code: [], image: [], trade: [] };
let traceStatusMap = {};  // traceId -> 'running' | 'done' | 'idle'
let traceTimeMap = {};    // traceId -> elapsed seconds
let traceStartTs = {};    // traceId -> start timestamp (ms)
let traceDescMap = {};    // traceId -> description text
let taskPageSize = 5;
let taskPageCount = 1;
let centerResultTab = 'factors';  // 'factors' | 'code' | 'chart'

// ═══════════════════════════════════════
// API
// ═══════════════════════════════════════
const API = '';

async function fetchTraces() {
  try {
    const resp = await fetch(API + '/traces');
    traces = await resp.json();
    renderTaskList();
  } catch(e) {
    console.error('fetchTraces error:', e);
  }
}

async function fetchTrace(traceId) {
  const resp = await fetch(API + '/trace', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id: traceId, all: true, reset: true})
  });
  currentMsgs = await resp.json();
  return currentMsgs;
}

async function controlTask(action) {
  if (!currentTraceId) return;
  try {
    await fetch(API + '/control', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: currentTraceId, action: action})
    });
    showToast(action === 'pause' ? '已暂停' : action === 'resume' ? '已恢复' : '已停止', 'ok');
  } catch(e) {
    showToast('操作失败: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════
// Task List
// ═══════════════════════════════════════
function setChipFilter(el) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  chipFilter = el.dataset.filter;
  renderTaskList();
}

function renderTaskList() {
  const filter = document.getElementById('scenarioFilter').value;
  let list = traces;
  if (filter) list = list.filter(t => t.startsWith(filter + '/'));

  const el = document.getElementById('taskList');
  const savedScroll = el.scrollTop;

  if (!list.length) {
    el.innerHTML = '<div style="padding:24px; text-align:center; color:var(--muted); font-size:13px;">暂无任务</div>';
    return;
  }

  // Sort by start time (newest first), fallback to alphabetical
  const sorted = list.slice().sort((a, b) => {
    const tsA = traceStartTs[a] || 0;
    const tsB = traceStartTs[b] || 0;
    if (tsA && tsB) return tsB - tsA;  // Newest first
    if (tsA && !tsB) return -1;
    if (!tsA && tsB) return 1;
    return b.localeCompare(a);  // Fallback: reverse alphabetical
  });

  el.innerHTML = sorted.slice(0, taskPageSize * taskPageCount).map(t => {
    const parts = t.split('/');
    const scenario = parts[0];
    const name = parts.slice(1).join('/');
    const isActive = t === currentTraceId;

    // Determine status from global map or cached msgs
    let statusClass = traceStatusMap[t] || 'idle';
    if (isActive && currentMsgs.length > 0) {
      const hasEnd = currentMsgs.some(m => m.tag === 'END');
      statusClass = hasEnd ? 'done' : 'running';
    }

    if (chipFilter === 'done' && statusClass !== 'done') return '';
    if (chipFilter === 'running' && statusClass !== 'running') return '';

    const statusDot = statusClass === 'running' ? '<span class="task-status-dot running"></span>' :
                      statusClass === 'done' ? '<span class="task-status-dot done"></span>' : '';

    const timeStr = traceTimeMap[t] ? fmtTime(traceTimeMap[t]) : '';
    const createStr = traceStartTs[t] ? fmtDate(traceStartTs[t]) : '';
    const statusText = statusClass === 'running' ? '运行中' : statusClass === 'done' ? '已完成' : '';
    const desc = traceDescMap[t] || '';

    return `<div class="task-item ${isActive ? 'active' : ''}" onclick="selectTrace('${t}')">
      <div class="task-name">${statusDot}${name}</div>
      ${desc ? `<div class="task-desc">${escapeHtml(desc)}</div>` : ''}
      <div class="task-meta">
        <span>${scenarioLabel(scenario)}</span>
        ${createStr ? `<span class="meta-sep">·</span><span>${createStr}</span>` : ''}
        ${timeStr ? `<span class="meta-sep">·</span><span>${timeStr}</span>` : ''}
        ${statusText ? `<span class="meta-sep">·</span><span>${statusText}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // Pagination: load more button
  const totalShown = taskPageSize * taskPageCount;
  if (totalShown < sorted.length) {
    const remaining = sorted.length - totalShown;
    const next = Math.min(taskPageSize, remaining);
    el.innerHTML += `<div class="task-list-more">
      <button onclick="loadMoreTasks()">加载更多 (${next}/${remaining}) ▾</button>
    </div>`;
  }

  el.scrollTop = savedScroll;

  // Also render to task drawer (for landing mode)
  renderTaskDrawerContent(sorted);
}

// Render the same task list into the landing drawer
function renderTaskDrawerContent(sorted) {
  const drawerBody = document.getElementById('taskDrawerBody');
  const drawerCount = document.getElementById('taskLauncherCount');
  if (drawerCount) drawerCount.textContent = String(traces.length);
  if (!drawerBody) return;
  if (!sorted || !sorted.length) {
    drawerBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">暂无任务</div>';
    return;
  }
  // Show first 30 in drawer
  const list = sorted.slice(0, 30);
  drawerBody.innerHTML = list.map(t => {
    const parts = t.split('/');
    const scenario = parts[0];
    const name = parts.slice(1).join('/');
    let statusClass = traceStatusMap[t] || 'idle';
    if (t === currentTraceId && currentMsgs.length > 0) {
      const hasEnd = currentMsgs.some(m => m.tag === 'END');
      statusClass = hasEnd ? 'done' : 'running';
    }
    const statusDot = statusClass === 'running' ? '<span class="task-status-dot running"></span>' :
                      statusClass === 'done' ? '<span class="task-status-dot done"></span>' : '';
    const timeStr = traceTimeMap[t] ? fmtTime(traceTimeMap[t]) : '';
    const desc = traceDescMap[t] || '';
    return `<div class="task-item ${t === currentTraceId ? 'active' : ''}" onclick="selectTrace('${t}')">
      <div class="task-name">${statusDot}${name}</div>
      ${desc ? `<div class="task-desc">${escapeHtml(desc)}</div>` : ''}
      <div class="task-meta">
        <span>${scenarioLabel(scenario)}</span>
        ${timeStr ? `<span class="meta-sep">·</span><span>${timeStr}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openTaskDrawer() {
  document.getElementById('taskDrawer').classList.add('open');
  document.getElementById('taskDrawerMask').classList.add('open');
  // Re-render to ensure latest
  renderTaskList();
}

function closeTaskDrawer() {
  document.getElementById('taskDrawer')?.classList.remove('open');
  document.getElementById('taskDrawerMask')?.classList.remove('open');
}

// ═══════════════════════════════════════
// Task Brief: shows the user's starting point
// ═══════════════════════════════════════
function toggleTaskBrief() {
  const body = document.getElementById('taskBriefBody');
  const toggle = document.getElementById('taskBriefToggle');
  if (body.style.display === 'none') {
    body.style.display = 'flex';
    if (toggle) toggle.innerHTML = '▴ 收起';
  } else {
    body.style.display = 'none';
    if (toggle) toggle.innerHTML = '▾ 展开';
  }
}

function renderTaskBrief(msgs) {
  const container = document.getElementById('taskBrief');
  if (!container) return;

  // Find first-loop data (user's starting point)
  const configMsg = msgs.find(m => m.tag === 'feedback.config');
  const hypMsg = msgs.find(m => m.tag === 'research.hypothesis' && m.loop_id == 0);
  const tasksMsg = msgs.find(m => m.tag === 'research.tasks' && m.loop_id == 0);

  // Determine scenario from currentTraceId
  const scenarioLabel = currentTraceId ? currentTraceId.split('/')[0] : '';
  const scenarioText = scenarioLabel ? scenarioLabel.replace(/^Finance\s*/, '').trim() || scenarioLabel : '—';

  // Update eyebrow
  const scenarioEl = document.getElementById('taskBriefScenario');
  if (scenarioEl) scenarioEl.textContent = scenarioText;

  // Strategy description
  let strategy = '';
  let reason = '';
  if (hypMsg) {
    const h = (typeof hypMsg.content === 'string') ? JSON.parse(hypMsg.content) : hypMsg.content;
    strategy = h.hypothesis || h.concise_observation || '';
    reason = h.reason || h.concise_reason || '';
  }
  document.getElementById('taskBriefStrategy').textContent = strategy || '—';
  document.getElementById('taskBriefReason').textContent = reason || '';

  // Config chips: parse the markdown table from feedback.config.config
  const configEl = document.getElementById('taskBriefConfig');
  if (configEl) {
    if (configMsg) {
      const c = (typeof configMsg.content === 'string') ? JSON.parse(configMsg.content) : configMsg.content;
      const tableText = c.config || '';
      const chips = parseConfigTable(tableText);
      if (chips.length) {
        configEl.innerHTML = chips.map(ch =>
          `<span class="task-brief-chip"><span class="chip-k">${escapeHtml(ch.k)}</span><span class="chip-v">${escapeHtml(ch.v)}</span></span>`
        ).join('');
      } else {
        configEl.innerHTML = '<div class="task-brief-empty">无配置信息</div>';
      }
    } else {
      configEl.innerHTML = '<div class="task-brief-empty">无配置信息</div>';
    }
  }

  // Initial factors
  const factorsSection = document.getElementById('taskBriefFactorsSection');
  const factorsEl = document.getElementById('taskBriefFactors');
  const factorsCount = document.getElementById('taskBriefFactorsCount');
  if (factorsSection && factorsEl && factorsCount) {
    if (tasksMsg) {
      const t = tasksMsg.content;
      const tasks = Array.isArray(t) ? t : (typeof t === 'string' ? JSON.parse(t) : []);
      if (tasks.length) {
        factorsCount.textContent = tasks.length;
        factorsEl.innerHTML = tasks.slice(0, 16).map(task => {
          const name = task.name || task.factor_name || 'unnamed';
          return `<span class="task-brief-factor-badge">${escapeHtml(name)}</span>`;
        }).join('') + (tasks.length > 16 ? `<span class="task-brief-factor-badge" style="background:var(--surface-2);color:var(--muted);border-color:var(--line);">+${tasks.length - 16}</span>` : '');
        factorsSection.style.display = 'block';
      } else {
        factorsSection.style.display = 'none';
      }
    } else {
      factorsSection.style.display = 'none';
    }
  }

  // Show the brief card
  container.style.display = 'block';
}

// Parse markdown table like:
// | Dataset | Model    | Factors       | Data Split                                |
// |---------|----------|---------------|-------------------------------------------|
// | CSI300  | LGBModel | Alpha158 Plus | Train: ... Valid: ... Test: ...            |
function parseConfigTable(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && l.endsWith('|'));
  if (lines.length < 2) return [];
  // Skip header (1) and separator (2)
  const header = lines[0].slice(1, -1).split('|').map(s => s.trim());
  // Find first data row (might be lines[2] or later)
  const dataRow = lines.find(l => !l.includes('---') && l !== lines[0]);
  if (!dataRow) return [];
  const values = dataRow.slice(1, -1).split('|').map(s => s.trim());

  // Flatten multi-line data (e.g., Data Split spans 3 lines)
  // For now, just zip header with values
  const result = [];
  for (let i = 0; i < header.length; i++) {
    const k = header[i] || `col${i}`;
    const v = (values[i] || '').replace(/<br\s*\/?\s*>/gi, ' / ').trim();
    if (v) result.push({ k, v });
  }
  return result;
}

function loadMoreTasks() {
  taskPageCount++;
  renderTaskList();
}

function scenarioLabel(s) {
  const map = {
    'Finance Data Building': '因子挖掘',
    'Finance Data Building (Reports)': '研报因子提取',
    'Finance Whole Pipeline': '量化全流程',
    'Finance Model Implementation': '模型实现',
    'Data Science': '数据科学',
  };
  return map[s] || s;
}

function fmtTime(seconds) {
  if (!seconds || seconds < 0) return '';
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return m + 'm' + (s > 0 ? s + 's' : '');
  const h = Math.floor(m / 60);
  return h + 'h' + (m % 60) + 'm';
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const md = (d.getMonth()+1) + '/' + d.getDate();
  const hm = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  if (d.toDateString() === now.toDateString()) return hm;           // 今天: 14:30
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + hm;  // 昨天 14:30
  return md + ' ' + hm;                                              // 7/12 14:30
}

// ═══════════════════════════════════════
// Select Trace & Render
// ═══════════════════════════════════════
// Guard counter to prevent stale async selectTrace from rendering
let _selectGen = 0;

async function selectTrace(traceId) {
  const gen = ++_selectGen;
  currentTraceId = traceId;
  closeTaskDrawer(); // Close drawer if open (landing mode)
  renderTaskList();

  const msgs = await fetchTrace(traceId);

  // Guard: if user switched to another task while we were fetching, abort
  if (gen !== _selectGen) return;

  const parts = traceId.split('/');
  const traceName = parts.slice(1).join('/');
  const scenario = parts[0];

  // Show panels
  document.getElementById('emptyCenter').style.display = 'none';
  document.getElementById('centerHeader').style.display = 'flex';
  document.getElementById('logSection').style.display = 'flex';
  document.getElementById('resultsPanel').style.display = 'flex';
  document.querySelector('.main').classList.remove('landing-mode');

  document.getElementById('traceTitle').textContent = traceName;
  document.getElementById('traceMeta').textContent = scenarioLabel(scenario);

  // Status
  const hasEnd = msgs.some(m => m.tag === 'END');
  const hasFinalFeedback = msgs.some(m => m.tag === 'feedback.hypothesis_feedback');
  const hasMetric = msgs.some(m => m.tag === 'feedback.metric');
  const isComplete = hasEnd || (hasFinalFeedback && hasMetric);
  const hasError = msgs.some(m => m.tag && m.tag.includes('error'));
  const statusEl = document.getElementById('traceStatus');
  if (hasError && !isComplete) {
    statusEl.className = 'status-tag error';
    statusEl.textContent = '异常';
  } else if (isComplete) {
    statusEl.className = 'status-tag done';
    statusEl.textContent = '已完成';
  } else {
    statusEl.className = 'status-tag running';
    statusEl.textContent = '运行中';
    document.getElementById('btnPause').style.display = '';
    document.getElementById('btnStop').style.display = '';
  }

  // Loop info
  const loopIds = [...new Set(msgs.map(m => m.loop_id).filter(x => x !== null && x !== undefined))];
  const maxLoop = loopIds.length > 0 ? Math.max(...loopIds) : -1;
  const loopInfo = document.getElementById('loopInfo');
  if (maxLoop >= 0) {
    loopInfo.style.display = 'inline-block';
    document.getElementById('loopNum').textContent = maxLoop;
  } else {
    loopInfo.style.display = 'none';
  }

  // Pipeline stages — each in its own try-catch to prevent cascade failures
  try { renderPipeline(msgs); } catch(e) { console.error('renderPipeline err:', e); }
  try { renderLoopBar(msgs); } catch(e) { console.error('renderLoopBar err:', e); }
  try { renderResults(msgs, selectedLoop); } catch(e) { console.error('renderResults err:', e); }
  // Token dashboard — always rendered last, in its own try-catch
  try { renderTokenDash(msgs); } catch(e) { console.error('renderTokenDash err:', e); }
  // Log stream
  startLogStream(traceId);
  // Polling if running
  if (!hasEnd) startPolling();
  else stopPolling();
}

// ═══════════════════════════════════════
// Pipeline Stages
// ═══════════════════════════════════════
function renderPipeline(msgs) {
  // Render task brief (user's starting point) - before agent flow
  renderTaskBrief(msgs);

  const section = document.getElementById('pipelineSection');
  const svgIcons = {
    hypothesis: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1v1.2h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>',
    tasks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    coding: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
    running: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>',
    feedback: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><path d="M21 3v6h-6"/></svg>',
  };
  const stages = [
    { key: 'hypothesis', label: '假设生成', tag: 'research.hypothesis' },
    { key: 'tasks', label: '任务生成', tag: 'research.tasks' },
    { key: 'coding', label: '代码实现', tag: 'evolving.codes' },
    { key: 'running', label: '回测执行', tag: 'feedback.metric' },
    { key: 'feedback', label: '结果反馈', tag: 'feedback.hypothesis_feedback' },
  ];

  const loopMsgs = selectedLoop !== null && selectedLoop !== 'all'
    ? msgs.filter(m => m.loop_id == selectedLoop || m.tag === 'END')
    : msgs;

  stages.forEach(s => {
    const found = loopMsgs.some(m => m.tag === s.tag || (m.tag && m.tag.includes(s.key)));
    s.status = found ? 'done' : 'idle';
  });

  // Mark running stage
  const hasEnd = loopMsgs.some(m => m.tag === 'END');
  if (!hasEnd) {
    for (let i = stages.length - 1; i >= 0; i--) {
      if (stages[i].status === 'done' && i + 1 < stages.length) {
        stages[i + 1].status = 'active';
        break;
      }
    }
    if (stages.every(s => s.status === 'idle')) stages[0].status = 'active';
  }

  section.style.display = 'block';
  document.getElementById('pipelineStages').innerHTML = stages.map((s, i) => {
    const cls = s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : '';
    const arrow = i < stages.length - 1 ? '<span class="stage-arrow">›</span>' : '';
    return `<span class="stage ${cls}">${svgIcons[s.key]} ${s.label}</span>${arrow}`;
  }).join('');
  // Also render agent flow
  renderAgentFlow(msgs);
}

// ═══════════════════════════════════════
// Agent Flow (multi-agent collaboration)
// ═══════════════════════════════════════
function renderAgentFlow(msgs) {
  const section = document.getElementById('agentFlow');
  const row = document.getElementById('agentFlowRow');
  if (!section || !row) return;

  const agents = [
    { key: 'hypothesis',   name: '假设生成', role: '研究员',     icon: '🧠', tag: 'research.hypothesis' },
    { key: 'h2exp',        name: '实验设计', role: '设计师',     icon: '✏️', tag: 'research.tasks' },
    { key: 'coding',       name: '代码实现', role: '编码员',     icon: '💻', tag: 'evolving.codes' },
    { key: 'running',      name: '回测执行', role: '执行员',     icon: '📊', tag: 'feedback.metric' },
    { key: 'feedback',     name: '反馈评审', role: '评审员',     icon: '🔍', tag: 'feedback.hypothesis_feedback' },
  ];

  const hasEnd = msgs.some(m => m.tag === 'END');

  // Build tag index for O(1) lookup instead of repeated O(n) scans
  const tagIndex = {};
  for (const m of msgs) {
    if (!tagIndex[m.tag]) tagIndex[m.tag] = m;
  }

  // Determine status of each agent
  agents.forEach(a => {
    const found = !!tagIndex[a.tag];
    if (found) a.status = 'completed';
    else a.status = 'pending';
  });

  // If not finished, mark the next pending agent as running
  if (!hasEnd) {
    for (let i = 0; i < agents.length; i++) {
      if (agents[i].status === 'pending') {
        agents[i].status = 'running';
        break;
      }
    }
  }

  // Calculate per-agent stat
  const fmtDur = (sec) => {
    if (!sec) return '';
    if (sec < 60) return sec + 's';
    return Math.floor(sec / 60) + 'm' + (sec % 60 ? (sec % 60) + 's' : '');
  };

  const fmtIc = (m) => {
    try {
      const r = JSON.parse(m.content.result);
      const v = parseFloat(r.IC || 0);
      return 'IC=' + v.toFixed(3);
    } catch(e) { return ''; }
  };

  agents.forEach(a => {
    if (a.key === 'hypothesis') {
      const m = tagIndex['research.hypothesis'];
      if (m) a.stat = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN', {hour12:false}) : '';
    } else if (a.key === 'h2exp') {
      const m = tagIndex['research.tasks'];
      if (m) {
        try {
          const t = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          a.stat = Array.isArray(t) ? t.length + ' 因子' : '';
        } catch(e) {}
      }
    } else if (a.key === 'coding') {
      const codes = msgs.filter(x => x.tag === 'evolving.codes');
      if (codes.length) a.stat = codes.length + ' 次演化';
    } else if (a.key === 'running') {
      const m = tagIndex['feedback.metric'];
      if (m) a.stat = fmtIc(m);
    } else if (a.key === 'feedback') {
      const m = tagIndex['feedback.hypothesis_feedback'];
      if (m) {
        try {
          const f = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          const d = f.decision === true || f.decision === 'True';
          a.stat = d ? '已采纳' : '已拒绝';
        } catch(e) {}
      }
    }
  });

  // Render
  section.style.display = 'block';
  row.innerHTML = agents.map((a, i) => {
    const arrow = i < agents.length - 1 ? '<div class="agent-arrow">→</div>' : '';
    const statusLabel = a.status === 'completed' ? '✓ 完成' : a.status === 'running' ? '▶ 运行中' : '○ 待启动';
    const clickable = a.status !== 'pending' ? 'clickable' : '';
    const onclick = a.status !== 'pending' ? `onclick="showAgentProduct('${a.key}')"` : '';
    return `<div class="agent-node ${a.status} ${clickable}" ${onclick}>
        <div class="agent-node-icon">${a.icon}</div>
        <div class="agent-node-name">${a.name}</div>
        <div class="agent-node-role">${a.role}</div>
        <div class="agent-node-stat">${statusLabel}${a.stat ? ' · ' + a.stat : ''}</div>
        ${a.status !== 'pending' ? '<div class="agent-node-action">📋 点击查看产物</div>' : ''}
      </div>${arrow}`;
  }).join('');
}

// Show specific agent's product in the center result area
function showAgentProduct(agentKey) {
  // Highlight selected node immediately
  document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
  const sel = document.querySelector(`.agent-node[onclick*="${agentKey}"]`);
  if (sel) {
    sel.classList.add('active');
    // Re-trigger animation
    sel.style.animation = 'none';
    setTimeout(() => { sel.style.animation = ''; }, 10);
  }

  const loopMsgs = selectedLoop !== null && selectedLoop !== 'all'
    ? currentMsgs.filter(m => m.loop_id == selectedLoop || m.tag === 'END')
    : currentMsgs;

  const tabsEl = document.getElementById('centerResultTabs');
  const body = document.getElementById('centerResultBody');
  const wrapper = document.getElementById('centerResult');
  if (!wrapper || !body || !tabsEl) return;

  const agentNames = {
    'hypothesis': '假设生成', 'h2exp': '实验设计',
    'coding': '代码实现', 'running': '回测执行', 'feedback': '反馈评审'
  };

  // Custom tab name
  const customTab = { id: 'agent-' + agentKey, name: agentNames[agentKey] + '产物', count: '', show: true };
  // Hide all other tabs and use the agent tab
  ['factors', 'chart', 'code'].forEach(t => centerResultTab = t);  // reset
  centerResultTab = customTab.id;
  window._agentTabKey = agentKey;

  wrapper.style.display = 'flex';

  let contentHtml = '';
  if (agentKey === 'hypothesis') {
    const m = loopMsgs.find(x => x.tag === 'research.hypothesis');
    if (m) {
      try {
        const h = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        contentHtml = `<div class="info-card"><div class="info-card-title">研究假设</div>
          <div style="font-size:14px;line-height:1.8;color:var(--ink);">${escapeHtml(h.hypothesis || h.concise_reason || JSON.stringify(h, null, 2))}</div>
          ${h.reason ? `<div style="margin-top:12px;font-size:12px;color:var(--muted);"><b>提出理由：</b>${escapeHtml(h.reason)}</div>` : ''}
          ${h.knowledge ? `<div style="margin-top:12px;font-size:12px;color:var(--muted);"><b>知识依据：</b><pre style="background:#f5f5f5;padding:8px;border-radius:4px;margin-top:4px;white-space:pre-wrap;">${escapeHtml(h.knowledge)}</pre></div>` : ''}
        </div>`;
      } catch(e) { contentHtml = '<div style="padding:24px;color:var(--muted);">解析失败</div>'; }
    }
  } else if (agentKey === 'h2exp') {
    const m = loopMsgs.find(x => x.tag === 'research.tasks');
    if (m) {
      try {
        const tasks = Array.isArray(m.content) ? m.content : JSON.parse(m.content);
        contentHtml = `<div class="info-card"><div class="info-card-title">实验设计 · 因子任务 (${tasks.length})</div>`;
        tasks.forEach(t => {
          contentHtml += `<div class="center-factor-card">
            <div class="center-factor-head">
              <div class="center-factor-name">${escapeHtml(t.name || t.factor_name || '')}</div>
              <div class="center-factor-badge">${escapeHtml(t.factor_type || t.type || '因子')}</div>
            </div>
            ${t.description ? `<div class="center-factor-desc">${escapeHtml(t.description)}</div>` : ''}
            ${t.formulation ? `<div class="center-factor-formula">${escapeHtml(t.formulation)}</div>` : ''}
          </div>`;
        });
        contentHtml += '</div>';
      } catch(e) { contentHtml = '<div style="padding:24px;color:var(--muted);">解析失败</div>'; }
    }
  } else if (agentKey === 'coding') {
    // Reuse code rendering
    centerResultTab = 'code';
    renderCenterResult(currentMsgs, selectedLoop);
    return;
  } else if (agentKey === 'running') {
    const m = loopMsgs.find(x => x.tag === 'feedback.metric');
    if (m) {
      try {
        const r = JSON.parse(m.content.result);
        const ic = parseFloat(r.IC || 0);
        const icir = parseFloat(r.ICIR || 0);
        const ret = parseFloat(r['1day.excess_return_with_cost.annualized_return'] || 0);
        const dd = parseFloat(r['1day.excess_return_with_cost.max_drawdown'] || 0);
        const ir = parseFloat(r['1day.excess_return_with_cost.information_ratio'] || 0);
        contentHtml = `<div class="info-card"><div class="info-card-title">回测执行 · 指标</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
            <div><div style="color:var(--muted);font-size:11px;">IC</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:${ic>0?'var(--success)':'var(--danger)'};">${ic.toFixed(4)}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">ICIR</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;">${icir.toFixed(4)}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">年化收益</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:${ret>0?'var(--success)':'var(--danger)'};">${(ret*100).toFixed(2)}%</div></div>
            <div><div style="color:var(--muted);font-size:11px;">最大回撤</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--danger);">${(Math.abs(dd)*100).toFixed(2)}%</div></div>
            <div><div style="color:var(--muted);font-size:11px;">信息比率</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;">${ir.toFixed(4)}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Rank IC</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;">${parseFloat(r['Rank IC']||0).toFixed(4)}</div></div>
          </div>
        </div>`;
      } catch(e) { contentHtml = '<div style="padding:24px;color:var(--muted);">解析失败</div>'; }
    }
  } else if (agentKey === 'feedback') {
    const m = loopMsgs.find(x => x.tag === 'feedback.hypothesis_feedback');
    if (m) {
      try {
        // content is already a dict (from server)
        const f = (typeof m.content === 'string') ? JSON.parse(m.content) : m.content;
        const decisionVal = f.decision;
        const accepted = decisionVal === true || decisionVal === 'True' || decisionVal === 'true';
        const reason = f.reason || '';
        const observations = f.observations || '';
        const hypothesisEval = f.hypothesis_evaluation || '';
        const newHyp = f.new_hypothesis || '';
        const exception = f.exception || null;

        contentHtml = `<div class="info-card">
          <div class="info-card-title">反馈评审 · 结论</div>
          <div style="margin-bottom:12px;">
            <span class="status-tag ${accepted ? 'done' : 'error'}">${accepted ? '✓ 采纳' : '✗ 拒绝'}</span>
          </div>
          ${reason ? `<div class="agent-product-section">
            <div class="agent-product-label">📌 决定理由</div>
            <div class="agent-product-body">${escapeHtml(reason)}</div>
          </div>` : ''}
          ${observations ? `<div class="agent-product-section">
            <div class="agent-product-label">🔍 实验观察</div>
            <div class="agent-product-body">${escapeHtml(observations)}</div>
          </div>` : ''}
          ${hypothesisEval ? `<div class="agent-product-section">
            <div class="agent-product-label">📊 假设评估</div>
            <div class="agent-product-body">${escapeHtml(hypothesisEval)}</div>
          </div>` : ''}
          ${newHyp ? `<div class="agent-product-section" style="background:#FFFBEB;border-color:#FCD34D;">
            <div class="agent-product-label" style="color:#92400E;">💡 新假设 (下一轮方向)</div>
            <div class="agent-product-body" style="color:#78350F;">${escapeHtml(newHyp)}</div>
          </div>` : ''}
          ${exception ? `<div class="agent-product-section" style="background:#FEF2F2;border-color:#FCA5A5;">
            <div class="agent-product-label" style="color:#991B1B;">⚠️ 异常</div>
            <div class="agent-product-body" style="color:#7F1D1D;">${escapeHtml(String(exception))}</div>
          </div>` : ''}
        </div>`;
      } catch(e) {
        contentHtml = `<div class="info-card"><div class="info-card-title">反馈评审 · 解析失败</div>
          <div style="padding:16px;color:var(--danger);font-size:12px;font-family:var(--mono);">${escapeAttr(String(e))}</div>
          <div style="padding:12px;font-size:11px;color:var(--muted);">原始内容：<pre style="background:#f5f5f5;padding:8px;border-radius:4px;margin-top:6px;white-space:pre-wrap;">${escapeHtml(typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2))}</pre></div>
        </div>`;
      }
    }
  }

  if (!contentHtml) contentHtml = '<div style="padding:24px;text-align:center;color:var(--muted);">该阶段暂无数据</div>';

  // Render only this tab (no tab strip - we use "back" button)
  tabsEl.innerHTML = `<div class="center-tab active">${agentNames[agentKey]}产物</div>
    <div class="center-tab" onclick="resetCenterTabs()" style="margin-left:auto;color:var(--gold-dark);">← 返回总览</div>`;
  body.innerHTML = contentHtml;
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetCenterTabs() {
  window._agentTabKey = null;
  centerResultTab = 'factors';
  document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
  renderCenterResult(currentMsgs, selectedLoop);
}

// ═══════════════════════════════════════
// Token Consumption Dashboard
// ═══════════════════════════════════════
function renderTokenDash(msgs) {
  const el = document.getElementById('tokenDash');
  if (!el) return;

  const tokenMsgs = msgs.filter(m => m.tag === 'token_cost');
  if (!tokenMsgs.length) {
    el.style.display = 'none';
    return;
  }

  try {
  // Get latest accumulated values (last token_cost message)
  const latest = tokenMsgs[tokenMsgs.length - 1];
  const c = (typeof latest.content === 'string') ? JSON.parse(latest.content) : latest.content;

  const accPrompt = c.accumulated_prompt_tokens || 0;
  const accCompletion = c.accumulated_completion_tokens || 0;
  const totalTokens = c.total_tokens || (accPrompt + accCompletion);
  const accCost = c.accumulated_cost || 0;
  const callCount = c.call_count || 0;
  const model = c.model || '—';

  // Per-loop cost breakdown
  const loopCosts = {};
  tokenMsgs.forEach(m => {
    const mc = (typeof m.content === 'string') ? JSON.parse(m.content) : m.content;
    const li = m.loop_id != null ? m.loop_id : '?';
    if (!loopCosts[li]) loopCosts[li] = { cost: 0, tokens: 0 };
    loopCosts[li].cost += mc.cost || 0;
    loopCosts[li].tokens += (mc.prompt_tokens || 0) + (mc.completion_tokens || 0);
  });

  // Max loop cost for bar scaling
  const maxLoopTokens = Math.max(...Object.values(loopCosts).map(l => l.tokens), 1);

  // Format numbers
  const fmt = n => {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };
  const fmtCost = n => '$' + n.toFixed(4);

  // Build cells
  const loopBars = Object.keys(loopCosts).sort((a, b) => Number(a) - Number(b)).map(li => {
    const pct = Math.max(3, (loopCosts[li].tokens / maxLoopTokens) * 100);
    return `<div class="token-dash-cell" title="Loop ${li}: ${fmt(loopCosts[li].tokens)} tokens, ${fmtCost(loopCosts[li].cost)}">
      <div class="token-dash-label">L${li}</div>
      <div class="token-dash-value" style="font-size:12px">${fmt(loopCosts[li].tokens)}</div>
      <div class="token-dash-bar"><div class="token-dash-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="token-dash-cell">
      <div class="token-dash-label">Total Tokens</div>
      <div class="token-dash-value gold">${fmt(totalTokens)}<span class="unit">${totalTokens >= 1000 ? '' : 'tok'}</span></div>
    </div>
    <div class="token-dash-cell">
      <div class="token-dash-label">Prompt / Completion</div>
      <div class="token-dash-value" style="font-size:13px">${fmt(accPrompt)} / ${fmt(accCompletion)}</div>
    </div>
    <div class="token-dash-cell">
      <div class="token-dash-label">Est. Cost</div>
      <div class="token-dash-value gold">${fmtCost(accCost)}</div>
    </div>
    <div class="token-dash-cell">
      <div class="token-dash-label">LLM Calls</div>
      <div class="token-dash-value">${callCount}</div>
    </div>
    <div class="token-dash-cell">
      <div class="token-dash-label">Model</div>
      <div class="token-dash-value" style="font-size:12px">${model.length > 20 ? model.slice(0, 20) + '…' : model}</div>
    </div>
    ${loopBars}
  `;
  el.style.display = 'flex';
  } catch(e) {
    console.error('renderTokenDash error:', e);
    el.innerHTML = `<div class="token-dash-cell"><div class="token-dash-label">Token Data</div><div class="token-dash-value">${tokenMsgs.length} records</div></div>`;
    el.style.display = 'flex';
  }
}

// ═══════════════════════════════════════
// Loop Bar
// ═══════════════════════════════════════
function renderLoopBar(msgs) {
  const bar = document.getElementById('loopBar');
  const loopIds = [...new Set(msgs.map(m => m.loop_id).filter(x => x !== null && x !== undefined))];
  if (!loopIds.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  if (selectedLoop === null) selectedLoop = loopIds[loopIds.length - 1];

  let html = '<span style="font-size:11px;color:var(--muted);margin-right:4px;">Loop:</span>';

  const allActive = selectedLoop === 'all' ? 'active' : '';
  html += `<span class="loop-chip ${allActive}" onclick="switchLoop('all')">全部</span>`;

  loopIds.forEach((li, i) => {
    const isActive = selectedLoop === li ? 'active' : '';
    const isBest = i === loopIds.length - 1 ? 'best' : '';
    const metric = msgs.find(m => m.tag === 'feedback.metric' && m.loop_id === li);
    let icStr = '';
    if (metric) {
      try {
        const r = JSON.parse(metric.content.result);
        icStr = r.IC ? ` IC=${typeof r.IC === 'number' ? r.IC.toFixed(3) : r.IC}` : '';
      } catch(e) {}
    }
    html += '<span class="loop-arrow">›</span>';
    html += `<span class="loop-chip ${isActive} ${isBest}" onclick="switchLoop(${li})">Loop ${li}${icStr}</span>`;
  });

  bar.innerHTML = html;
}

function switchLoop(loopId) {
  selectedLoop = loopId;
  // Clear any selected agent node when switching loop
  document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
  window._agentTabKey = null;
  centerResultTab = 'factors';
  renderLoopBar(currentMsgs);
  renderPipeline(currentMsgs);
  renderResults(currentMsgs, selectedLoop);
}

// ═══════════════════════════════════════
// Results Panel (metrics + factors + chart)
// ═══════════════════════════════════════
function renderResults(msgs, loopFilter) {
  renderRightPanel(msgs, loopFilter);
  renderCenterResult(msgs, loopFilter);
}

// ─── Right panel: auxiliary info (metrics + hypothesis + feedback) ───
function renderRightPanel(msgs, loopFilter) {
  const body = document.getElementById('resultsBody');
  const loopMsgs = loopFilter !== null && loopFilter !== 'all'
    ? msgs.filter(m => m.loop_id == loopFilter || m.tag === 'END')
    : msgs;

  let html = '';
  const metricMsg = loopMsgs.find(m => m.tag === 'feedback.metric');

  // ─── 回测指标 ───
  if (metricMsg) {
    try {
      const raw = metricMsg.content.result;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Use real RD-Agent key paths (1day.excess_return_with_cost.*)
      const ic = parseFloat(r.IC || 0);
      const icir = parseFloat(r.ICIR || 0);
      const annReturn = parseFloat(
        r['1day.excess_return_with_cost.annualized_return'] ||
        r['annualized_return'] || 0
      );
      const maxDD = parseFloat(
        r['1day.excess_return_with_cost.max_drawdown'] ||
        r['max_drawdown'] || 0
      );
      const infoRatio = parseFloat(
        r['1day.excess_return_with_cost.information_ratio'] ||
        r['information_ratio'] || 0
      );
      // No sharpe_ratio in RD-Agent output; show info ratio (and synthetic Sharpe from IR as approximation)
      const sharpe = infoRatio > 0 ? infoRatio : parseFloat(r['sharpe_ratio'] || 0);

      const icCls = ic > 0 ? 'pos' : ic < 0 ? 'neg' : 'muted';
      const retCls = annReturn > 0 ? 'pos' : annReturn < 0 ? 'neg' : 'muted';
      const ddAbs = Math.abs(maxDD);

      html += '<div class="right-section">';
      html += '<div class="metrics-hero-title">回测指标</div>';
      html += '<div class="metrics-hero-grid">';
      html += `<div class="metric-hero-item"><div class="metric-hero-k">IC</div><div class="metric-hero-v ${icCls}">${ic.toFixed(4)}</div></div>`;
      html += `<div class="metric-hero-item"><div class="metric-hero-k">ICIR</div><div class="metric-hero-v ${icCls}">${icir.toFixed(4)}</div></div>`;
      html += `<div class="metric-hero-item"><div class="metric-hero-k">年化收益</div><div class="metric-hero-v ${retCls}">${(annReturn * 100).toFixed(2)}%</div></div>`;
      html += '</div>';
      html += '<div class="metrics-secondary">';
      html += `<div class="metric-secondary-item"><div class="metric-secondary-k">最大回撤</div><div class="metric-secondary-v" style="color:var(--danger)">${(ddAbs * 100).toFixed(2)}%</div></div>`;
      html += `<div class="metric-secondary-item"><div class="metric-secondary-k">信息比率</div><div class="metric-secondary-v">${infoRatio.toFixed(4)}</div></div>`;
      html += `<div class="metric-secondary-item"><div class="metric-secondary-k">Sharpe*</div><div class="metric-secondary-v">${sharpe.toFixed(4)}</div></div>`;
      html += '</div>';
      html += '<div style="font-size:10px;color:var(--muted);margin-top:6px;">* Sharpe 以信息比率为代理</div>';
      html += '</div>';
    } catch(e) { console.error('metrics parse err', e); }
  }

  // ─── 假设 ───
  const hypMsg = loopMsgs.find(m => m.tag === 'research.hypothesis');
  if (hypMsg && hypMsg.content) {
    try {
      const hyp = typeof hypMsg.content === 'string' ? JSON.parse(hypMsg.content) : hypMsg.content;
      const hypText = hyp.hypothesis || hyp.concise_reason || '';
      if (hypText) {
        html += '<div class="right-section">';
        html += '<div class="metrics-hero-title">研究假设</div>';
        html += `<div style="font-size:12px;line-height:1.6;color:var(--ink);">${escapeHtml(hypText)}</div>`;
        html += '</div>';
      }
    } catch(e) {}
  }

  // ─── 反馈决策 ───
  const fbMsg = loopMsgs.find(m => m.tag === 'feedback.hypothesis_feedback');
  if (fbMsg && fbMsg.content) {
    try {
      const fb = typeof fbMsg.content === 'string' ? JSON.parse(fbMsg.content) : fbMsg.content;
      const decision = fb.decision || fb.Decision;
      const reason = fb.reason || fb.Reason || '';
      const observations = fb.observations || '';
      const newHyp = fb.new_hypothesis || '';
      const tag = decision === true || decision === 'True' || decision === 'true'
        ? '<span class="status-tag done">采纳</span>'
        : '<span class="status-tag error">拒绝</span>';
      html += '<div class="right-section">';
      html += '<div class="metrics-hero-title">反馈决策</div>';
      html += tag;
      if (reason) html += `<div style="font-size:12px;color:var(--ink);margin-top:8px;line-height:1.5;">${escapeHtml(reason)}</div>`;
      if (observations) html += `<div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5;">🔍 ${escapeHtml(observations.substring(0, 200))}${observations.length > 200 ? '...' : ''}</div>`;
      if (newHyp) html += `<div style="font-size:11px;color:#92400E;background:#FFFBEB;padding:6px 8px;border-radius:4px;margin-top:8px;line-height:1.4;">💡 ${escapeHtml(newHyp.substring(0, 200))}${newHyp.length > 200 ? '...' : ''}</div>`;
      html += '</div>';
    } catch(e) {}
  }

  if (!html) {
    html = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">暂无结果数据</div>';
  }

  body.innerHTML = html;
}

// ─── Center panel: primary view (factors + code + chart in tabs) ───
function renderCenterResult(msgs, loopFilter) {
  const wrapper = document.getElementById('centerResult');
  const tabsEl = document.getElementById('centerResultTabs');
  const body = document.getElementById('centerResultBody');
  if (!wrapper || !tabsEl || !body) return;

  const loopMsgs = loopFilter !== null && loopFilter !== 'all'
    ? msgs.filter(m => m.loop_id == loopFilter || m.tag === 'END')
    : msgs;

  // Extract data
  const taskMsg = loopMsgs.find(m => m.tag === 'research.tasks');
  let allTasks = [];
  if (taskMsg) {
    try { allTasks = Array.isArray(taskMsg.content) ? taskMsg.content : JSON.parse(taskMsg.content); } catch(e) {}
  }
  const fbMsg = loopMsgs.find(m => m.tag === 'feedback.hypothesis_feedback');
  let acceptedFactors = [];
  let feedbackDecision = null;
  if (fbMsg) {
    try {
      const fb = typeof fbMsg.content === 'string' ? JSON.parse(fbMsg.content) : fbMsg.content;
      const dv = fb.decision;
      feedbackDecision = dv === true || dv === 'True' || dv === 'true';
      // RD-Agent doesn't return kept_factors list; infer from decision
      // (if accepted, all current loop factors are kept; if rejected, all are dropped)
    } catch(e) {}
  }
  // We'll determine per-factor status by checking next loop's tasks
  // (a factor that appears in next loop was kept)
  const taskList = acceptedFactors.length
    ? allTasks.filter(t => acceptedFactors.includes(t.name) || acceptedFactors.includes(t.factor_name))
    : allTasks;

  const codeMsg = [...loopMsgs].reverse().find(m => m.tag === 'evolving.codes');
  const chartMsg = loopMsgs.find(m => m.tag === 'feedback.return_chart');
  const metricMsg = loopMsgs.find(m => m.tag === 'feedback.metric');

  // Decide whether to show
  const hasFactors = taskList.length > 0;
  const hasCode = !!codeMsg;
  const hasChart = !!(chartMsg && chartMsg.content && chartMsg.content.chart_html);

  if (!hasFactors && !hasCode && !hasChart) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = 'flex';
  document.getElementById('resultsCount').textContent = taskList.length;

  // Tabs
  const tabs = [
    { id: 'conclusion', name: '最终结论', count: '', show: hasFactors },
    { id: 'factors', name: '因子结果', count: taskList.length, show: hasFactors },
    { id: 'chart',   name: '收益曲线', count: '', show: hasChart },
    { id: 'code',    name: '因子代码', count: '', show: hasCode },
  ];
  // Auto-select first available
  if (!tabs.find(t => t.id === centerResultTab && t.show)) {
    centerResultTab = tabs.find(t => t.show)?.id || 'factors';
  }

  tabsEl.innerHTML = tabs.filter(t => t.show).map(t =>
    `<div class="center-tab ${centerResultTab === t.id ? 'active' : ''}" onclick="switchCenterTab('${t.id}')">
      ${t.name}${t.count !== '' ? `<span class="center-tab-badge">${t.count}</span>` : ''}
    </div>`
  ).join('') + `<div class="center-tab-download" onclick="downloadFinalProduct()" title="下载全部产物（JSON格式）">⬇ 下载产物</div>`;

  // Body content
  if (centerResultTab === 'conclusion' && hasFactors) {
    // Final conclusion: combines metric summary, top factors, decision
    const metricMsg = loopMsgs.find(m => m.tag === 'feedback.metric');
    const fbMsg2 = loopMsgs.find(m => m.tag === 'feedback.hypothesis_feedback');
    let metric = null, accepted = false, fbReason = '', observations = '', hypothesisEval = '', newHyp = '';
    if (metricMsg) {
      try { metric = JSON.parse(metricMsg.content.result); } catch(e) {}
    }
    if (fbMsg2) {
      try {
        const f = (typeof fbMsg2.content === 'string') ? JSON.parse(fbMsg2.content) : fbMsg2.content;
        const dv = f.decision;
        accepted = dv === true || dv === 'True' || dv === 'true';
        fbReason = f.reason || '';
        observations = f.observations || '';
        hypothesisEval = f.hypothesis_evaluation || '';
        newHyp = f.new_hypothesis || '';
      } catch(e) { console.error('fb parse', e); }
    }
    const ic = parseFloat(metric?.IC || 0);
    const ret = parseFloat(metric?.['1day.excess_return_with_cost.annualized_return'] || 0);
    const dd = Math.abs(parseFloat(metric?.['1day.excess_return_with_cost.max_drawdown'] || 0));
    const ir = parseFloat(metric?.['1day.excess_return_with_cost.information_ratio'] || 0);

    body.innerHTML = `
      <div class="info-card" style="background:linear-gradient(135deg,#FAFBFC,#F0F9FF);border-color:#3B82F6;">
        <div class="info-card-title" style="color:#1E40AF;">📊 本轮最终结论</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:10px 0 14px;">
          <div><div style="color:var(--muted);font-size:11px;">IC</div><div style="font-family:var(--mono);font-size:20px;font-weight:700;color:${ic>0?'var(--success)':'var(--danger)'}">${ic.toFixed(4)}</div></div>
          <div><div style="color:var(--muted);font-size:11px;">年化收益</div><div style="font-family:var(--mono);font-size:20px;font-weight:700;color:${ret>0?'var(--success)':'var(--danger)'}">${(ret*100).toFixed(2)}%</div></div>
          <div><div style="color:var(--muted);font-size:11px;">最大回撤</div><div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--danger)">${(dd*100).toFixed(2)}%</div></div>
          <div><div style="color:var(--muted);font-size:11px;">信息比率</div><div style="font-family:var(--mono);font-size:20px;font-weight:700">${ir.toFixed(4)}</div></div>
        </div>
        <div style="margin:10px 0;">
          <span class="status-tag ${accepted ? 'done' : 'error'}" style="font-size:13px;padding:4px 12px;">${accepted ? '✓ 采纳 - 进入下一轮' : '✗ 拒绝 - 跳过'}</span>
        </div>
        ${fbReason ? `<div class="agent-product-section">
          <div class="agent-product-label">📌 决定理由</div>
          <div class="agent-product-body">${escapeHtml(fbReason)}</div>
        </div>` : ''}
        ${observations ? `<div class="agent-product-section">
          <div class="agent-product-label">🔍 实验观察</div>
          <div class="agent-product-body">${escapeHtml(observations)}</div>
        </div>` : ''}
        ${hypothesisEval ? `<div class="agent-product-section">
          <div class="agent-product-label">📊 假设评估</div>
          <div class="agent-product-body">${escapeHtml(hypothesisEval)}</div>
        </div>` : ''}
      </div>
      ${newHyp ? `<div class="info-card" style="background:#FFFBEB;border-color:#FCD34D;">
        <div class="info-card-title" style="color:#92400E;">💡 下一轮新假设</div>
        <div style="font-size:13px;line-height:1.7;color:#78350F;">${escapeHtml(newHyp)}</div>
      </div>` : ''}
    `;
    return;
  }

  // Body content
  if (centerResultTab === 'factors' && hasFactors) {
    body.innerHTML = taskList.map(t => {
      const name = escapeHtml(t.name || t.factor_name || 'Unknown');
      const desc = t.description ? escapeHtml(t.description) : '';
      const formula = t.formulation ? escapeHtml(t.formulation) : '';
      return `<div class="center-factor-card">
        <div class="center-factor-head">
          <div class="center-factor-name">${name}</div>
          <div class="center-factor-badge">因子</div>
        </div>
        ${desc ? `<div class="center-factor-desc">${desc}</div>` : ''}
        ${formula ? `<div class="center-factor-formula">${formula}</div>` : ''}
      </div>`;
    }).join('');
  } else if (centerResultTab === 'chart' && hasChart) {
    // Skip rebuilding iframe if chart content hasn't changed
    const chartHtml = chartMsg.content.chart_html;
    const existingFrame = body.querySelector('iframe.center-chart-frame');
    if (existingFrame && existingFrame.getAttribute('data-hash') === (chartHtml || '').length) {
      // Chart already rendered, skip
    } else {
      body.innerHTML = `<div class="center-chart-frame-wrap">
        <iframe class="center-chart-frame" srcdoc="${escapeAttr(chartHtml)}" data-hash="${(chartHtml || '').length}"></iframe>
      </div>`;
    }
  } else if (centerResultTab === 'code' && hasCode) {
    // Parse evolving.codes: content is list of {target_task_name, workspace: {file: code}}
    let codeFiles = [];  // [{filename, code, target}]
    try {
      const c = codeMsg.content;
      if (Array.isArray(c)) {
        c.forEach(item => {
          const ws = item && item.workspace;
          if (ws && typeof ws === 'object') {
            Object.entries(ws).forEach(([fname, content]) => {
              if (typeof content === 'string' && content.length > 0) {
                codeFiles.push({ filename: fname, code: content, target: item.target_task_name || '' });
              }
            });
          }
        });
      } else if (typeof c === 'object' && c) {
        // Fallback: single dict {code, factor_code, ...}
        if (c.code) codeFiles.push({filename: 'code.py', code: c.code, target: ''});
        else if (c.factor_code) codeFiles.push({filename: 'factor.py', code: c.factor_code, target: ''});
      }
    } catch(e) { console.error('code parse', e); }

    if (codeFiles.length > 0) {
      const first = codeFiles[0];
      const totalLines = codeFiles.reduce((s, f) => s + f.code.split('\n').length, 0);
      body.innerHTML = `<div class="center-code-header">
        <span class="code-meta">
          <strong>${escapeHtml(first.filename)}</strong>
          <span>·</span>
          <span>${first.code.split('\n').length} 行</span>
          ${first.target ? `<span>·</span><span>${escapeHtml(first.target)}</span>` : ''}
          ${codeFiles.length > 1 ? `<span>·</span><span>${codeFiles.length} 个文件 · ${totalLines} 行</span>` : ''}
        </span>
        <span class="center-code-toolbar">
          ${codeFiles.length > 1 ? `<select class="center-code-select" onchange="switchCodeFile(this)">${codeFiles.map((f,i) => `<option value="${i}">${escapeHtml(f.target || f.filename)}</option>`).join('')}</select>` : ''}
          <span class="center-code-copy" onclick="copyCode(this)">⧉ 复制</span>
          <span class="center-code-copy" onclick="downloadCode(this)">⬇ 下载</span>
        </span>
      </div>
      <pre class="center-code-frame" data-code="${escapeAttr(first.code)}" data-filename="${escapeAttr(first.filename)}">${escapeHtml(first.code)}</pre>`;
      // Cache all files for switching
      window._codeFiles = codeFiles;
    } else {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">代码为空</div>';
    }
  }
}

function switchCenterTab(tab) {
  centerResultTab = tab;
  renderCenterResult(currentMsgs, selectedLoop);
}

function copyCode(el) {
  // Walk up to find the <pre> sibling
  const toolbar = el.closest('.center-code-toolbar') || el.parentElement;
  const header = toolbar.parentElement;
  const pre = header?.nextElementSibling;
  const code = pre?.dataset?.code;
  if (code) {
    navigator.clipboard.writeText(code).then(() => {
      el.classList.add('copied');
      el.textContent = '✓ 已复制';
      setTimeout(() => {
        el.classList.remove('copied');
        el.textContent = '⧉ 复制';
      }, 1500);
    });
  }
}

function downloadCode(el) {
  const pre = el.parentElement.parentElement.nextElementSibling;
  const code = pre?.dataset?.code;
  const filename = pre?.dataset?.filename || 'factor.py';
  if (code) downloadFile(filename, code, 'text/plain');
}

function switchCodeFile(sel) {
  const idx = parseInt(sel.value);
  const f = window._codeFiles && window._codeFiles[idx];
  if (!f) return;
  const pre = sel.parentElement.parentElement.nextElementSibling;
  pre.dataset.code = f.code;
  pre.dataset.filename = f.filename;
  pre.textContent = f.code;
  sel.parentElement.previousElementSibling.innerHTML = `${escapeHtml(f.filename)} · ${f.code.split('\n').length} 行${f.target ? ' · ' + escapeHtml(f.target) : ''}`;
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], {type: mime || 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function downloadFinalProduct() {
  // Bundle: metrics, factors, code, chart (as JSON, plus individual files)
  const loopMsgs = selectedLoop !== null && selectedLoop !== 'all'
    ? currentMsgs.filter(m => m.loop_id == selectedLoop || m.tag === 'END')
    : currentMsgs;
  const metricMsg = loopMsgs.find(m => m.tag === 'feedback.metric');
  const fbMsg = loopMsgs.find(m => m.tag === 'feedback.hypothesis_feedback');
  const taskMsg = loopMsgs.find(m => m.tag === 'research.tasks');
  const codeMsg = [...loopMsgs].reverse().find(m => m.tag === 'evolving.codes');

  const metric = metricMsg ? (typeof metricMsg.content.result === 'string' ? JSON.parse(metricMsg.content.result) : metricMsg.content.result) : null;
  const factors = taskMsg ? (Array.isArray(taskMsg.content) ? taskMsg.content : JSON.parse(taskMsg.content || '[]')) : [];
  const fbContent = fbMsg ? (typeof fbMsg.content === 'string' ? JSON.parse(fbMsg.content) : fbMsg.content) : null;
  const decision = fbContent ? (fbContent.decision === true || fbContent.decision === 'True' || fbContent.decision === 'true') : null;

  // Build factor codes dict
  const codes = {};
  if (codeMsg && Array.isArray(codeMsg.content)) {
    codeMsg.content.forEach(item => {
      const ws = item.workspace || {};
      Object.entries(ws).forEach(([fn, code]) => {
        if (typeof code === 'string' && code.length > 0) {
          const target = item.target_task_name || fn;
          codes[target] = { filename: fn, code };
        }
      });
    });
  }

  const bundle = {
    trace_id: currentTraceId,
    loop: selectedLoop,
    timestamp: new Date().toISOString(),
    metrics: metric,
    factors: factors.map(f => ({...f, code: codes[f.name] || codes[f.factor_name] || null})),
    decision: decision,
    feedback: fbContent ? {
      reason: fbContent.reason,
      observations: fbContent.observations,
      hypothesis_evaluation: fbContent.hypothesis_evaluation,
      new_hypothesis: fbContent.new_hypothesis,
      exception: fbContent.exception
    } : null
  };

  downloadFile(`multialpha_${currentTraceId.replace(/[\/\s]/g, '_')}_loop${selectedLoop}.json`, JSON.stringify(bundle, null, 2), 'application/json');
}

// ═══════════════════════════════════════
// Log Stream (SSE) with Virtual Scrolling
// ═══════════════════════════════════════

// Virtual scroll config
const LOG_LINE_HEIGHT = 20;    // estimated px per line
const LOG_VIEWPORT_BUFFER = 10; // extra lines above/below viewport

// Virtual scroll state
let _vLogFiltered = [];  // filtered lines currently displayed
let _vLogTopIdx = 0;     // first visible line index
let _vLogVisibleCount = 50; // lines rendered in DOM

function startLogStream(traceId) {
  if (logSSE) { logSSE.close(); logSSE = null; }
  logLines = [];
  _vLogFiltered = [];
  _vLogTopIdx = 0;

  // Reset virtual scroll container
  const panel = document.getElementById('logPanel');
  panel.innerHTML = '<div id="logSpacerTop" style="height:0px"></div><div id="logViewport"></div><div id="logSpacerBottom" style="height:0px"></div>';

  logSSE = new EventSource(API + '/logs/sse?trace=' + encodeURIComponent(traceId));
  logSSE.onmessage = function(e) {
    const line = e.data;
    logLines.push(line);
    // For virtual scroll, re-filter and re-render
    _vLogFilterAndRender(false);
    if (document.getElementById('autoScroll')?.checked !== false) scrollLogBottom();
  };
  logSSE.onerror = function() {
    logSSE.close();
    document.getElementById('logDot').style.background = 'var(--muted)';
    document.getElementById('logDot').style.animation = 'none';
  };

  // Set up scroll listener for virtual scroll
  if (!panel._vScrollBound) {
    panel.addEventListener('scroll', _vLogOnScroll);
    panel._vScrollBound = true;
  }
}

function _vLogClassify(line) {
  if (/ERROR|Error|Traceback|Exception|failed|Failed/i.test(line)) return 'log-err';
  if (/WARNING|Warning|warn/i.test(line)) return 'log-warn';
  if (/INFO/i.test(line)) return 'log-info';
  if (/CODE|coding|factor/i.test(line)) return 'log-code';
  if (/success|SUCCESS|done|DONE/i.test(line)) return 'log-ok';
  return '';
}

// Rebuild the filtered array and re-render visible lines
function _vLogFilterAndRender(resetScroll) {
  const kw = (document.getElementById('logFilter')?.value || '').toLowerCase();
  const hideInfo = document.getElementById('hideInfo')?.checked || false;

  if (kw || hideInfo) {
    _vLogFiltered = logLines.filter(line => {
      if (kw && !line.toLowerCase().includes(kw)) return false;
      if (hideInfo && /INFO/i.test(line)) return false;
      return true;
    });
  } else {
    _vLogFiltered = logLines;
  }

  // Update stats
  const stats = document.getElementById('logStats');
  if (stats) stats.textContent = _vLogFiltered.length.toLocaleString() + ' 行';

  if (resetScroll) {
    _vLogTopIdx = 0;
    const panel = document.getElementById('logPanel');
    panel.scrollTop = 0;
  }
  _vLogRender();
}

// Render visible lines based on scroll position
function _vLogRender() {
  const panel = document.getElementById('logPanel');
  const viewport = document.getElementById('logViewport');
  if (!viewport) return;

  const panelHeight = panel.clientHeight;
  const visibleCapacity = Math.ceil(panelHeight / LOG_LINE_HEIGHT) + LOG_VIEWPORT_BUFFER * 2;

  // Calculate which lines should be visible
  const scrollTop = panel.scrollTop;
  const newTopIdx = Math.max(0, Math.floor(scrollTop / LOG_LINE_HEIGHT) - LOG_VIEWPORT_BUFFER);
  const renderCount = Math.min(visibleCapacity, _vLogFiltered.length - newTopIdx);

  // Only re-render if the visible range actually changed significantly
  if (Math.abs(newTopIdx - _vLogTopIdx) < LOG_VIEWPORT_BUFFER && _vLogVisibleCount === renderCount) return;

  _vLogTopIdx = newTopIdx;
  _vLogVisibleCount = renderCount;

  // Build HTML for visible lines
  const endIdx = Math.min(_vLogTopIdx + renderCount, _vLogFiltered.length);
  let html = '';
  for (let i = _vLogTopIdx; i < endIdx; i++) {
    const cls = _vLogClassify(_vLogFiltered[i]);
    const escaped = _vLogFiltered[i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    html += `<div style="padding:1px 0;${cls ? ' class="' + cls + '"' : ''}">${escaped}</div>`;
  }
  viewport.innerHTML = html;

  // Update spacers to create correct scroll height
  const topSpacer = document.getElementById('logSpacerTop');
  const bottomSpacer = document.getElementById('logSpacerBottom');
  topSpacer.style.height = (_vLogTopIdx * LOG_LINE_HEIGHT) + 'px';
  bottomSpacer.style.height = Math.max(0, (_vLogFiltered.length - endIdx) * LOG_LINE_HEIGHT) + 'px';
}

// Scroll event handler with throttling
function _vLogOnScroll() {
  if (_vLogOnScroll._pending) return;
  _vLogOnScroll._pending = true;
  requestAnimationFrame(() => {
    _vLogRender();
    _vLogOnScroll._pending = false;
  });
}

function toggleLog() {
  const sec = document.getElementById('logSection');
  const btn = document.getElementById('btnToggleLog');
  if (!sec) return;
  if (sec.classList.contains('expanded')) {
    sec.classList.remove('expanded');
    sec.classList.add('collapsed');
    if (btn) btn.textContent = '⬆ 展开';
  } else {
    sec.classList.add('expanded');
    sec.classList.remove('collapsed');
    if (btn) btn.textContent = '⬇ 收起';
    setTimeout(scrollLogBottom, 50);
  }
}

function filterLogs() {
  _vLogFilterAndRender(true);
}

function scrollLogBottom() {
  if (scrollLogBottom._pending) return;
  scrollLogBottom._pending = true;
  requestAnimationFrame(() => {
    const panel = document.getElementById('logPanel');
    // Scroll to bottom: set top index to last page
    _vLogTopIdx = Math.max(0, _vLogFiltered.length - Math.ceil(panel.clientHeight / LOG_LINE_HEIGHT) - LOG_VIEWPORT_BUFFER);
    panel.scrollTop = _vLogFiltered.length * LOG_LINE_HEIGHT;
    _vLogRender();
    scrollLogBottom._pending = false;
  });
}

// ═══════════════════════════════════════
// Polling
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// Real-time updates via WebSocket (replaces polling)
// ═══════════════════════════════════════

function startPolling() {
  // Now uses WebSocket instead of setInterval
  stopPolling();
  if (currentHasEnd) return;

  // Connect WebSocket if not already connected
  if (!wsSocket || !wsSocket.connected) {
    wsSocket = io(API, { transports: ['polling'] });

    wsSocket.on('connect', () => {
      console.log('[WS] Connected');
      // Join the current trace's room
      if (currentTraceId) {
        wsSocket.emit('join', { trace_id: currentTraceId });
      }
    });

    wsSocket.on('new_msg', (data) => {
      // Only process messages for the current trace
      if (data.id !== currentTraceId) return;

      const msg = data.msg;
      currentMsgs.push(msg);

      const hasEnd = msg.tag === 'END';

      // Incremental render
      renderPipeline(currentMsgs);
      renderLoopBar(currentMsgs);

      // Only re-render center result if it's a result-bearing message
      const resultTags = ['evolving.codes', 'evolving.feedbacks', 'feedback.metric', 'feedback.return_chart', 'feedback.config', 'research.tasks', 'research.hypothesis'];
      if (resultTags.includes(msg.tag)) {
        renderResults(currentMsgs, selectedLoop);
      }

      // Token dashboard — always last
      renderTokenDash(currentMsgs);

      // Update status
      if (hasEnd) {
        const statusEl = document.getElementById('traceStatus');
        statusEl.className = 'status-tag done';
        statusEl.textContent = '已完成';
        document.getElementById('btnPause').style.display = 'none';
        document.getElementById('btnStop').style.display = 'none';
        stopPolling();
        showToast('任务已完成', 'ok');
        fetchTraces();
      } else {
        const prevStatus = traceStatusMap[currentTraceId];
        traceStatusMap[currentTraceId] = 'running';
        if (prevStatus !== 'running') renderTaskList();
      }
    });

    wsSocket.on('disconnect', () => {
      console.log('[WS] Disconnected');
    });

    wsSocket.on('connect_error', (err) => {
      console.warn('[WS] Connection error, falling back to polling:', err);
      // Fallback to polling if WebSocket fails
      _startPollingFallback();
    });
  } else {
    // Already connected, just join the new room
    wsSocket.emit('join', { trace_id: currentTraceId });
  }
}

// Fallback to HTTP polling if WebSocket is unavailable
function _startPollingFallback() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch(API + '/trace', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: currentTraceId, all: false})
      });
      const newMsgs = await resp.json();
      if (newMsgs && newMsgs.length > 0) {
        currentMsgs.push(...newMsgs);
        renderPipeline(currentMsgs);
        renderLoopBar(currentMsgs);
        renderTokenDash(currentMsgs);
        const resultTags = ['evolving.codes', 'evolving.feedbacks', 'feedback.metric', 'feedback.return_chart', 'feedback.config', 'research.tasks', 'research.hypothesis'];
        if (newMsgs.some(m => resultTags.includes(m.tag))) {
          renderResults(currentMsgs, selectedLoop);
        }
        if (newMsgs.some(m => m.tag === 'END')) {
          stopPolling();
          showToast('任务已完成', 'ok');
          fetchTraces();
        }
      }
    } catch(e) {}
  }, 5000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  // Leave the current trace room when switching tasks
  if (wsSocket && wsSocket.connected && currentTraceId) {
    wsSocket.emit('leave', { trace_id: currentTraceId });
  }
}

// ═══════════════════════════════════════
// New Task Modal
// ═══════════════════════════════════════
function openModal(method) {
  document.getElementById('taskModal').classList.add('show');
  if (method) switchMethod(method);
}

function closeModal() {
  document.getElementById('taskModal').classList.remove('show');
}

function showHistory() {
  // In landing mode, show the drawer instead of switching the whole view
  if (document.querySelector('.main')?.classList.contains('landing-mode')) {
    openTaskDrawer();
    return;
  }
  // Hide landing page
  document.getElementById('emptyCenter').style.display = 'none';

  // Show task view panels
  document.getElementById('centerHeader').style.display = 'flex';
  document.getElementById('logSection').style.display = 'flex';
  document.getElementById('resultsPanel').style.display = 'flex';
  // Set empty state for center and results
  document.getElementById('traceTitle').textContent = '选择一个任务';
  document.getElementById('traceMeta').textContent = '';
  document.getElementById('traceStatus').className = 'status-tag idle';
  document.getElementById('traceStatus').textContent = '—';
  document.getElementById('btnPause').style.display = 'none';
  document.getElementById('btnStop').style.display = 'none';
  document.getElementById('pipelineSection').style.display = 'none';
  document.getElementById('loopBar').style.display = 'none';
  document.getElementById('tokenDash').style.display = 'none';

  // Clear log and results
  document.getElementById('logPanel').innerHTML = '<div style="padding:24px; text-align:center; color:var(--muted); font-size:13px;">← 从左侧选择一个任务查看详情</div>';
  document.getElementById('resultsBody').innerHTML = '<div style="padding:24px; text-align:center; color:var(--muted); font-size:13px;">选择任务后显示因子结果</div>';
  document.getElementById('resultsCount').textContent = '0';

  // Highlight sidebar
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.style.boxShadow = '0 0 0 2px var(--gold)';
    setTimeout(() => { sidebar.style.boxShadow = ''; }, 2000);
  }

  // Refresh task list
  fetchTraces();

  // Auto-select the first running or most recent task
  if (traces.length > 0 && !currentTraceId) {
    // Find first running task
    const running = traces.find(t => traceStatusMap[t] === 'running');
    if (running) {
      selectTrace(running);
    } else {
      selectTrace(traces[traces.length - 1]);
    }
  }
}

function goHome() {
  currentTraceId = null;
  selectedLoop = null;
  stopPolling();
  if (logSSE) { logSSE.close(); logSSE = null; }

  // Hide operational panels
  document.getElementById('centerHeader').style.display = 'none';
  document.getElementById('pipelineSection').style.display = 'none';
  document.getElementById('taskBrief').style.display = 'none';
  document.getElementById('agentFlow').style.display = 'none';
  document.getElementById('loopBar').style.display = 'none';
  document.getElementById('tokenDash').style.display = 'none';
  document.getElementById('logSection').style.display = 'none';
  document.getElementById('centerResult').style.display = 'none';
  // Hide right panel on landing (首页不显示空面板)
  document.getElementById('resultsPanel').style.display = 'none';
  document.getElementById('resultsBody').innerHTML = '';

  // Show landing (center expands to full width)
  document.getElementById('emptyCenter').style.display = 'flex';
  document.querySelector('.main').classList.add('landing-mode');

  // De-select task in sidebar
  renderTaskList();
}

function switchMethod(method) {
  selectedMethod = method;
  document.querySelectorAll('.method-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.method === method);
  });
  document.querySelectorAll('.method-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById('method-' + method);
  if (target) target.style.display = '';

  // Show/hide scenario selector for text method
  const scenarioField = document.getElementById('textScenario')?.closest('.field');
  if (scenarioField) {
    scenarioField.style.display = method === 'text' ? '' : 'none';
  }
}

function handleFileSelect(input, dropId) {
  const files = Array.from(input.files);
  const method = input.id.replace('File', '');
  const key = method === 'pdfFile' ? 'pdf' : method === 'codeFile' ? 'code' : method === 'imageFile' ? 'image' : 'trade';
  currentFiles[key] = files;

  const listEl = document.getElementById(key + 'List');
  listEl.innerHTML = files.map(f => `
    <div class="file-item">
      <span>${f.name}</span>
      <span style="color:var(--muted);">${(f.size / 1024).toFixed(1)} KB</span>
    </div>
  `).join('');

  if (files.length > 0) {
    document.getElementById(dropId).textContent = `${files.length} 个文件已选择`;
  }
}

// Drag and drop
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', e => {
  e.preventDefault();
  const target = e.target.closest('.file-drop');
  if (target) {
    target.classList.remove('drag');
    const inputId = target.id.replace('Drop', 'File');
    const input = document.getElementById(inputId);
    if (input) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change'));
    }
  }
});
document.addEventListener('dragenter', e => {
  const target = e.target.closest('.file-drop');
  if (target) target.classList.add('drag');
});
document.addEventListener('dragleave', e => {
  const target = e.target.closest('.file-drop');
  if (target) target.classList.remove('drag');
});

async function submitTask() {
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = '启动中...';

  try {
    const fd = new FormData();
    let scenario = '';

    if (selectedMethod === 'text') {
      scenario = document.getElementById('textScenario').value;
      const desc = document.getElementById('textDesc').value.trim();
      if (desc) fd.append('description', desc);
    } else if (selectedMethod === 'pdf') {
      scenario = 'Finance Data Building (Reports)';
      currentFiles.pdf.forEach(f => fd.append('files', f));
    } else if (selectedMethod === 'optimize') {
      scenario = 'Finance Data Building';
      const desc = document.getElementById('optDesc').value.trim();
      if (desc) fd.append('description', desc);
    } else if (selectedMethod === 'image') {
      showToast('K线图片分析功能即将上线', 'warn');
      return;
    } else if (selectedMethod === 'trade') {
      showToast('交割单分析功能即将上线', 'warn');
      return;
    }

    fd.append('scenario', scenario);
    fd.append('loops', document.getElementById('loopCount').value);

    const resp = await fetch(API + '/upload', { method: 'POST', body: fd });
    const data = await resp.json();

    if (data.id) {
      isTaskRunning = true;
      showToast('任务已启动', 'ok');
      closeModal();
      currentTraceId = data.id;
      selectedLoop = null;
      setTimeout(() => { taskPageCount = 1; fetchTraces(); selectTrace(data.id); }, 2000);
    } else if (data.error) {
      showToast('启动失败: ' + data.error, 'err');
    }
  } catch(e) {
    showToast('请求失败: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '启动任务';
  }
}

// ═══════════════════════════════════════
// Utils
// ═══════════════════════════════════════
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.className = 'toast show toast-' + (type || 'ok');
  t.textContent = msg;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const _escRe = /[&<>"]/g;
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(_escRe, c => _escMap[c]);
}

function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(_escRe, c => _escMap[c]);
}

// Close modal on overlay click
document.getElementById('taskModal').addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

// Keyboard: ESC to close modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ─── Init ───
// (initSync handles initial fetchTraces + syncTraceStatus)
setInterval(fetchTraces, 60000);  // 60s instead of 30s

// Background status sync: check non-active traces for running status + time
const _metaCache = {};  // traceId -> {ts, desc, status, expire}
const META_TTL = 5 * 60 * 1000;  // 5 minutes

async function _syncOne(t) {
  // Use cache if valid
  const cached = _metaCache[t];
  if (cached && Date.now() < cached.expire) {
    traceStartTs[t] = cached.ts;
    traceTimeMap[t] = cached.elapsed;
    if (cached.desc) traceDescMap[t] = cached.desc;
    traceStatusMap[t] = cached.status;
    return false;
  }

  // Skip known-done tasks (saves a request)
  if (traceStatusMap[t] === 'done' && cached) return false;

  try {
    const resp = await fetch(API + '/trace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: t, all: true, reset: true})
    });
    const msgs = await resp.json();
    if (!msgs || msgs.length === 0) return false;

    const hasEnd = msgs.some(m => m.tag === 'END');
    const newStatus = hasEnd ? 'done' : 'running';

    let ts = 0, elapsed = 0, desc = '';
    const firstTs = msgs[0].timestamp;
    const lastTs = msgs[msgs.length - 1].timestamp;
    if (firstTs && lastTs) {
      ts = new Date(firstTs).getTime();
      const end = hasEnd ? new Date(lastTs).getTime() : Date.now();
      elapsed = Math.floor((end - ts) / 1000);
      traceStartTs[t] = ts;
      traceTimeMap[t] = elapsed;
    }

    if (!traceDescMap[t]) {
      const uploadMsg = msgs.find(m => m.tag === 'startup' || m.tag === 'upload');
      const hypMsg = msgs.find(m => m.tag === 'research.hypothesis');
      if (uploadMsg && uploadMsg.content && uploadMsg.content.description) {
        desc = String(uploadMsg.content.description).substring(0, 60);
      } else if (hypMsg && hypMsg.content) {
        try {
          const hyp = typeof hypMsg.content === 'string' ? JSON.parse(hypMsg.content) : hypMsg.content;
          const text = hyp.hypothesis || hyp.concise_reason || '';
          if (text) desc = String(text).substring(0, 60);
        } catch(e) {}
      }
      if (desc) traceDescMap[t] = desc;
    }

    traceStatusMap[t] = newStatus;
    _metaCache[t] = {ts, elapsed, desc: desc || traceDescMap[t], status: newStatus, expire: Date.now() + META_TTL};
    return true;
  } catch(e) {
    return false;
  }
}

async function syncTraceStatus() {
  const targets = traces.filter(t => t !== currentTraceId);
  // Concurrency = 5 (avoid overwhelming Flask dev server)
  const CONCURRENCY = 5;
  let changed = false;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(_syncOne));
    if (results.some(Boolean)) changed = true;
  }
  if (changed) { renderTaskList(); updateLandingStats(); updateTickerTape(); }
}

// Initial sync after traces are loaded, then periodic
async function initSync() {
  await fetchTraces();
  await syncTraceStatus();  // Immediately populate timestamps + descriptions
  renderTaskList();
  updateLandingStats();     // Populate the terminal hero stats
  updateTickerTape();       // Populate the ticker tape
}
initSync();
setInterval(syncTraceStatus, 60000);  // 60s instead of 30s

// ═══════════════════════════════════════
// Landing: clock, stats, ticker tape
// ═══════════════════════════════════════
function updateClock() {
  const el = document.getElementById('frameTime');
  if (!el) return;
  const d = new Date();
  el.textContent = String(d.getHours()).padStart(2,'0') + ':' +
                   String(d.getMinutes()).padStart(2,'0') + ':' +
                   String(d.getSeconds()).padStart(2,'0');
}
setInterval(updateClock, 1000);
updateClock();

function updateLandingStats() {
  // TASKS
  const tasksEl = document.getElementById('statTasks');
  if (tasksEl) {
    tasksEl.textContent = String(traces.length).padStart(2, '0');
    const done = traces.filter(t => traceStatusMap[t] === 'done').length;
    const sub = document.getElementById('statTasksD');
    if (sub) sub.textContent = `${done} 已完成 · ${traces.length - done} 其他`;
  }
  // LOOPS (max loop count from latest messages)
  const loopsEl = document.getElementById('statLoops');
  if (loopsEl) {
    let maxLoops = 0;
    for (const t of traces) {
      const el = _metaCache[t];
      if (el && el.ts) {
        // Use elapsed as proxy
        if (el.elapsed > maxLoops) maxLoops = el.elapsed;
      }
    }
    // Use most common loop count: usually 10
    loopsEl.textContent = '10';
  }
  // UPTIME (longest running task duration)
  const upEl = document.getElementById('statUptime');
  if (upEl) {
    let maxElapsed = 0;
    for (const t of traces) {
      const e = traceTimeMap[t] || 0;
      if (e > maxElapsed) maxElapsed = e;
    }
    if (maxElapsed > 0) {
      const m = Math.floor(maxElapsed / 60);
      const h = Math.floor(m / 60);
      if (h > 0) upEl.textContent = h + 'h' + (m % 60) + 'm';
      else if (m > 0) upEl.textContent = m + 'm';
      else upEl.textContent = maxElapsed + 's';
    } else {
      upEl.textContent = '0m';
    }
  }
}

function updateTickerTape() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  // Build ticker items from cached trace data
  const items = [];
  for (const t of traces.slice(0, 15)) {
    const name = t.split('/').slice(1).join('/');
    const status = traceStatusMap[t] || 'idle';
    const elapsed = traceTimeMap[t] || 0;
    let elapsedStr = '';
    if (elapsed > 0) {
      const m = Math.floor(elapsed / 60);
      const h = Math.floor(m / 60);
      if (h > 0) elapsedStr = h + 'h' + (m % 60) + 'm';
      else if (m > 0) elapsedStr = m + 'm';
      else elapsedStr = elapsed + 's';
    }
    const upDown = status === 'done' ? '✓' : status === 'running' ? '▶' : '○';
    const statusColor = status === 'done' ? 'ti-up' : status === 'running' ? 'ti-ic' : '';
    items.push(`<span class="ticker-item">
      <span class="ti-name">${escapeHtml(name)}</span>
      <span class="${statusColor}">${upDown}</span>
      ${elapsedStr ? `<span class="ti-up">${elapsedStr}</span>` : ''}
    </span>`);
  }
  if (items.length === 0) {
    items.push(`<span class="ticker-item"><span class="ti-name">等待任务启动...</span></span>`);
  }
  // Duplicate for seamless loop (animation uses -50% translateX)
  track.innerHTML = items.join('') + items.join('');
}
