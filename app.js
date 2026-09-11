const savedSession = (() => { try { return JSON.parse(sessionStorage.getItem('garageai_session') || 'null'); } catch (error) { return null; } })();
if (savedSession?.user?.username === 'owner') savedSession.user.name = 'Shiva Rajkumara R';
if (savedSession?.user?.username === 'advisor') savedSession.user.name = 'Sandhesh';
const state = {
  session: savedSession,
  offlineDemo: false,
  mode: 'pro',
  view: 'overview',
  search: '',
  workFilter: 'All status',
  appointments: [],
  inventory: [],
  invoices: [],
  customers: [],
  notifications: [],
  notificationMetrics: null,
  integrationStatus: {},
  financialReport: null,
  marketingPosts: [],
  marketingStatus: {},
  customerTab: 'overview',
  estimateStatus: 'awaiting',
  bookingConfirmed: false,
  apiReady: false,
  environment: 'development',
  workOrders: [
    { id: 'WO-2026-0048', customer: 'Ananya Rao', vehicle: '2021 Honda City VX', plate: 'KA 03 MK 8271', issue: 'A/C not cooling', status: 'In progress', mechanic: 'Unassigned', eta: 'Today, 4:30 PM', total: '₹ 8,450', tone: 'purple' },
    { id: 'WO-2026-0047', customer: 'Rohan Shah', vehicle: '2018 Toyota Innova', plate: 'KA 05 MC 2190', issue: 'Brake vibration', status: 'Quality check', mechanic: 'Unassigned', eta: 'Today, 2:15 PM', total: '₹ 5,800', tone: 'blue' },
    { id: 'WO-2026-0046', customer: 'Meera Nair', vehicle: '2020 Hyundai Creta', plate: 'KA 04 NG 4102', issue: 'Oil service + inspection', status: 'Ready for pickup', mechanic: 'Unassigned', eta: 'Ready now', total: '₹ 4,250', tone: 'green' },
    { id: 'WO-2026-0045', customer: 'Vikram Singh', vehicle: '2017 Ford EcoSport', plate: 'KA 01 AB 7788', issue: 'Check engine light', status: 'Awaiting parts', mechanic: 'Unassigned', eta: 'Parts: Tomorrow', total: '₹ 12,900', tone: 'orange' },
    { id: 'WO-2026-0044', customer: 'Priya Menon', vehicle: '2022 Kia Seltos HTX', plate: 'KA 02 PJ 6510', issue: 'Periodic maintenance', status: 'Received', mechanic: 'Unassigned', eta: 'Today, 3:00 PM', total: '₹ 3,600', tone: 'gray' },
    { id: 'WO-2026-0043', customer: 'Sanjay Kumar', vehicle: '2019 Maruti Suzuki Baleno', plate: 'KA 51 MN 9831', issue: 'Steering noise', status: 'Diagnosing', mechanic: 'Unassigned', eta: 'Today, 5:15 PM', total: '₹ 2,100', tone: 'blue' }
  ],
  chat: [
    { who: 'ai', text: 'Good morning, Shiva. I’m ready to help with diagnostics, work orders, parts, or scheduling.' }
  ]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function statusTone(status) {
  const map = { 'In progress': 'purple', 'Quality check': 'blue', 'Ready for pickup': 'green', 'Awaiting parts': 'orange', 'Received': 'gray', 'Diagnosing': 'blue', 'Completed': 'green' };
  return map[status] || 'gray';
}
function initials(name) { return name.split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase(); }
function dateLabel() {
  return new Intl.DateTimeFormat('en-IN', { weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(new Date(2026, 8, 10));
}
function money(n) { return `₹ ${Number(n).toLocaleString('en-IN')}`; }

function render() {
  if (!state.session) {
    renderAuth();
    return;
  }
  document.body.dataset.mode = state.mode;
  const content = $('#content');
  if (state.mode === 'customer') {
    $('#breadcrumbCurrent').textContent = 'Customer portal';
    content.innerHTML = customerView();
  } else {
    const labels = { overview: 'Overview', 'work-orders': 'Work orders', schedule: 'Schedule', customers: 'Customers', inventory: 'Inventory', billing: 'Billing', notifications: 'Communications', reports: 'Reports', marketing: 'Marketing studio', ai: 'AI assistant', settings: 'Settings & integrations' };
    $('#breadcrumbCurrent').textContent = labels[state.view] || 'Overview';
    content.innerHTML = proView();
  }
  $$('.nav-item').forEach(b => b.classList.toggle('active', state.mode === 'pro' && b.dataset.view === state.view));
  $$('.view-option').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
  applyRoleAccess();
  bindEvents();
}

function renderAuth() {
  const root = $('#authRoot');
  if (!root) return;
  root.innerHTML = `<div class="auth-backdrop"><div class="auth-card"><div class="auth-brand"><img class="auth-logo-image" src="assets/royal-car-service-logo-transparent.png" alt="Royal Car Service Center logo" /><div><div class="brand-name">Royal <span>Car Service</span></div><div class="brand-sub">Expert care every drive</div></div></div><div class="auth-copy"><h1>Welcome back</h1><p>Sign in to run your garage with less admin and more control.</p></div><form id="loginForm"><div class="auth-field"><label>Username / employee ID</label><input id="loginUsername" autocomplete="username" value="owner" placeholder="owner" required /></div><div class="auth-field"><label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" value="garage123" placeholder="••••••••" required /></div><div class="auth-field"><label>Access role <span style="font-weight:400;color:var(--muted-2)">(demo account)</span></label><select id="loginRole"><option>Owner</option><option>Advisor</option></select></div><div class="auth-error" id="authError"></div><button class="primary-btn auth-submit" type="submit">Sign in to operations <span>→</span></button></form><div class="demo-access"><b>Operations accounts</b><span>Owner: owner / garage123 · Advisor: advisor / advisor123</span></div><button class="offline-demo-btn" id="offlineDemo" type="button">Continue in offline demo mode</button><div class="auth-footer">Protected workspace · Session expires after 8 hours</div></div></div>`;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const button = $('.auth-submit');
    button.disabled = true;
    button.innerHTML = 'Signing in…';
    const error = $('#authError');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#loginUsername').value, password: $('#loginPassword').value, role: $('#loginRole').value }) });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch (parseError) { data = { error: raw || `Server returned ${response.status}` }; }
      if (!response.ok) throw new Error(data.error || 'Unable to sign in');
      state.session = data;
      try { sessionStorage.setItem('garageai_session', JSON.stringify(data)); } catch (storageError) { /* optional */ }
      state.mode = 'pro';
      state.view = 'overview';
      root.innerHTML = '';
      render();
      loadApiData();
    } catch (err) {
      if (/method not allowed|failed to fetch|network/i.test(err.message)) {
        startOfflineDemo();
        return;
      }
      error.textContent = err.message;
      button.disabled = false;
      button.innerHTML = 'Sign in to operations <span>→</span>';
    }
  };
  const demoAccounts = {
    Owner: { username: 'owner', password: 'garage123' },
    Advisor: { username: 'advisor', password: 'advisor123' },

  };
  $('#loginRole').onchange = () => {
    const account = demoAccounts[$('#loginRole').value];
    if (account) {
      $('#loginUsername').value = account.username;
      $('#loginPassword').value = account.password;
      $('#authError').textContent = '';
    }
  };
  $('#offlineDemo').onclick = () => startOfflineDemo();
}

function startOfflineDemo() {
  state.session = { token: null, user: { id: 0, username: 'offline-demo', name: 'Shiva Rajkumara R', role: 'Owner' }, permissions: ['*'], mode: 'offline-demo' };
  state.offlineDemo = true;
  state.mode = 'pro';
  state.view = 'overview';
  $('#authRoot').innerHTML = '';
  render();
  showToast('Offline demo mode: API actions are disabled');
}

async function logout() {
  if (state.session) {
    try { await postJson('/api/auth/logout', {}); } catch (error) { /* session may already be expired */ }
  }
  state.session = null;
  try { sessionStorage.removeItem('garageai_session'); } catch (storageError) { /* optional */ }
  state.offlineDemo = false;
  state.customerTab = 'overview';
  state.estimateStatus = 'awaiting';
  render();
}

function applyRoleAccess() {
  const role = state.session?.user?.role || 'Owner';
  const access = { overview: ['Owner', 'Advisor'], 'work-orders': ['Owner', 'Advisor'], schedule: ['Owner', 'Advisor'], customers: ['Owner', 'Advisor'], inventory: ['Owner', 'Advisor'], billing: ['Owner', 'Advisor'], notifications: ['Owner', 'Advisor'], reports: ['Owner'], marketing: ['Owner', 'Advisor'], ai: ['Owner', 'Advisor'], settings: ['Owner'] };
  $$('.nav-item').forEach(btn => { const allowed = (access[btn.dataset.view] || []).includes(role); btn.style.display = allowed ? '' : 'none'; btn.title = allowed ? '' : `Restricted for ${role}`; });
  if (state.mode === 'pro' && !access[state.view]?.includes(role)) { state.view = 'overview'; render(); }
  const userName = $('.user-copy b');
  const userRole = $('.user-copy span');
  if (userName && state.session) userName.textContent = state.session.user.name;
  if (userRole && state.session) userRole.textContent = `${state.session.user.role} · secure session`;
}

function proView() {
  switch (state.view) {
    case 'work-orders': return workOrdersView();
    case 'schedule': return scheduleView();
    case 'customers': return customersView();
    case 'inventory': return inventoryView();
    case 'billing': return billingView();
    case 'notifications': return notificationsView();
    case 'reports': return reportsView();
    case 'marketing': return marketingView();
    case 'ai': return aiView();
    case 'settings': return settingsView();
    default: return overviewView();
  }
}

function pageHeading(title, subtitle, action = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${action}</div></div>`;
}
function liveWorkspaceEmpty(items, title, subtitle, action = '') {
  if (state.environment !== 'production' || !state.apiReady || items.length) return false;
  return `${pageHeading(title, subtitle, action)}<section class="card empty-workspace"><div class="empty-workspace-icon">✦</div><h2>No live records yet</h2><p>This workspace is ready for Royal Car Service Center. Add your first real record to replace this empty state.</p></section>`;
}

function overviewView() {
  const empty = liveWorkspaceEmpty(state.workOrders, 'Overview', 'Your live garage workspace is ready.', '<button class="primary-btn" data-modal="work-order">＋ New work order</button>');
  if (empty && !state.invoices.length && !state.appointments.length) return empty;

  return `
    ${pageHeading('Good morning, Shiva <span style="color:var(--orange)">✦</span>', `${dateLabel()} · Here’s what’s happening at your garage today.`, '<span class="date-chip">⌄ Today, Sep 10</span><button class="primary-btn" data-modal="work-order">＋ New work order</button>')}
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-top"><span>Today’s appointments</span><span class="kpi-icon purple">▣</span></div><div class="kpi-value">12</div><div class="kpi-foot"><span class="up">↑ 16%</span> vs. last Thursday</div></div>
      <div class="kpi-card"><div class="kpi-top"><span>Vehicles in shop</span><span class="kpi-icon blue">▱</span></div><div class="kpi-value">06</div><div class="kpi-foot"><span class="up">4 active</span> · 2 waiting</div></div>
      <div class="kpi-card"><div class="kpi-top"><span>Jobs in progress</span><span class="kpi-icon orange">⚙</span></div><div class="kpi-value">04</div><div class="kpi-foot"><span class="down">2 due soon</span> before 4 PM</div></div>
      <div class="kpi-card"><div class="kpi-top"><span>Revenue this month</span><span class="kpi-icon green">₹</span></div><div class="kpi-value">₹ 2.84L</div><div class="kpi-foot"><span class="up">↑ 12.8%</span> vs. last month</div></div>
    </div>
    <div class="dashboard-grid">
      <div>
        <section class="card bays-card">
          <div class="card-header"><div><span class="card-title">Bay overview</span><span class="card-sub">Live status across 4 service bays</span></div><a class="card-link" data-view="schedule">Open schedule →</a></div>
          <div class="bay-list">
            <div class="bay-item"><div class="bay-head"><span class="bay-name"><i class="status-dot green"></i>Bay 1</span><span class="status-label">In progress</span></div><div class="bay-order"><div class="car-thumb">🚘</div><div><b>Honda City · A/C service</b><span>WO-2026-0048 · Owner-managed</span></div></div><div class="progress-row"><div class="progress"><i style="width:68%"></i></div><small>68%</small></div></div>
            <div class="bay-item"><div class="bay-head"><span class="bay-name"><i class="status-dot blue"></i>Bay 2</span><span class="status-label">Quality check</span></div><div class="bay-order"><div class="car-thumb">🚙</div><div><b>Toyota Innova · Brakes</b><span>WO-2026-0047 · Advisor-managed</span></div></div><div class="progress-row"><div class="progress"><i style="width:86%; background:var(--blue)"></i></div><small>86%</small></div></div>
            <div class="bay-item"><div class="bay-head"><span class="bay-name"><i class="status-dot orange"></i>Bay 3</span><span class="status-label">Awaiting parts</span></div><div class="bay-order"><div class="car-thumb">🚗</div><div><b>Ford EcoSport · CEL</b><span>WO-2026-0045 · Parts ETA tomorrow</span></div></div><div class="progress-row"><div class="progress"><i style="width:31%; background:var(--orange)"></i></div><small>31%</small></div></div>
            <div class="bay-item"><div class="bay-head"><span class="bay-name"><i class="status-dot gray"></i>Bay 4</span><span class="status-label">Available</span></div><div class="empty-bay">Next booking at 3:00 PM<br><strong style="color:var(--text);font-size:10px">Kia Seltos · periodic service</strong></div></div>
          </div>
        </section>
        <section class="card section-gap table-card">
          <div class="card-header"><div><span class="card-title">Recent work orders</span><span class="card-sub">Keep an eye on every vehicle in motion</span></div><a class="card-link" data-view="work-orders">View all →</a></div>
          ${workOrderTable(state.workOrders.slice(0,4), false)}
        </section>
      </div>
      <div>
        <section class="card quick-card"><div class="card-header"><div><span class="card-title">Quick actions</span><span class="card-sub">Common tasks, one click away</span></div></div><div class="quick-list">
          <button class="quick-action" data-modal="work-order"><span class="quick-icon">＋</span><div><b>New work order</b><span>Check in a vehicle</span></div></button>
          <button class="quick-action" data-view="schedule"><span class="quick-icon">▣</span><div><b>Book appointment</b><span>Find an open slot</span></div></button>
          <button class="quick-action" data-view="inventory"><span class="quick-icon">▥</span><div><b>Check inventory</b><span>3 low stock items</span></div></button>
          <button class="quick-action" data-view="ai"><span class="quick-icon">✦</span><div><b>Ask GarageAI</b><span>Get a diagnostic assist</span></div></button>
        </div></section>
        <section class="card alert-card"><div class="card-header"><div><span class="card-title">Alerts & actions</span><span class="card-sub">Items that need your attention</span></div><span class="status-pill red">4 open</span></div><div class="alert-list">
          <div class="alert-row"><div class="alert-icon red">!</div><div><b>Estimate awaiting approval</b><span>WO-2026-0048 · ₹ 8,450 estimate sent 42m ago</span></div><a data-toast="Opening estimate…">Review</a></div>
          <div class="alert-row"><div class="alert-icon orange">▥</div><div><b>Parts below minimum stock</b><span>Brake pads, 5W-30 oil, cabin filters</span></div><a data-view="inventory">Restock</a></div>
          <div class="alert-row"><div class="alert-icon blue">◉</div><div><b>Customer callback requested</b><span>Ananya Rao · prefers WhatsApp</span></div><a data-toast="Callback marked for follow-up">Call</a></div>
          <div class="alert-row"><div class="alert-icon blue">＋</div><div><b>New online booking</b><span>Priya Menon · tomorrow at 10:00 AM</span></div><a data-view="schedule">Open</a></div>
        </div></section>
        <section class="card team-card"><div class="card-header"><div><span class="card-title">Operations status</span><span class="card-sub">Owner and advisor workspace</span></div><a class="card-link" data-toast="Team management is coming soon">Manage</a></div><div class="team-list">
          <div class="team-row"><div class="avatar avatar-gold">SR</div><div><b>Shiva Rajkumara R</b><span>Owner · Full operations access</span></div><span class="team-state">● Active</span></div>
          <div class="team-row"><div class="avatar" style="background:#24ae75">SA</div><div><b>Sandhesh</b><span>Advisor · Service desk</span></div><span class="team-state">● Active</span></div>
          <div class="team-row"><div class="avatar" style="background:#e9edf4;color:var(--muted)">+</div><div><b>Workshop staff</b><span>Managed by owner and advisor</span></div><span class="team-state off">Offline access</span></div>
        </div></section>
      </div>
    </div>`;
}

function workOrderTable(items, full = true) {
  return `<div class="table-wrap"><table><thead><tr><th>Work order</th><th>Customer / vehicle</th><th>Service</th><th>Status</th><th>Assigned to</th><th>Total</th></tr></thead><tbody>${items.map(wo => `<tr data-wo="${wo.id}"><td><span class="wo-id">${wo.id}</span><span class="muted" style="display:block;font-size:9px;margin-top:4px">${wo.eta}</span></td><td><div class="vehicle-cell"><div class="car-thumb">${wo.vehicle.includes('Honda') ? '🚘' : wo.vehicle.includes('Toyota') ? '🚙' : '🚗'}</div><div><b>${wo.customer}</b><span>${wo.vehicle} · ${wo.plate}</span></div></div></td><td><span style="font-size:10px">${wo.issue}</span></td><td><span class="status-pill ${statusTone(wo.status)}"><i class="status-dot ${statusTone(wo.status)}"></i>${wo.status}</span></td><td><span style="font-size:10px">${wo.mechanic}</span></td><td><b style="font-size:10px">${wo.total}</b></td></tr>`).join('')}</tbody></table></div>${full ? `<div class="table-footer"><span>Showing ${items.length} of 24 work orders</span><div class="pagination"><button class="page-btn active">1</button><button class="page-btn">2</button><button class="page-btn">3</button><button class="page-btn">›</button></div></div>` : ''}`;
}

function workOrdersView() {
  const empty = liveWorkspaceEmpty(state.workOrders, 'Work orders', 'Manage repairs from check-in to completion.', '<button class="primary-btn" data-modal="work-order">＋ Create work order</button>');
  if (empty) return empty;
  let items = [...state.workOrders];
  const q = state.search.toLowerCase();
  if (q) items = items.filter(x => Object.values(x).join(' ').toLowerCase().includes(q));
  if (state.workFilter !== 'All status') items = items.filter(x => x.status === state.workFilter);
  const kanbanStatuses = ['Received', 'Diagnosing', 'In progress', 'Quality check'];
  return `${pageHeading('Work orders', 'Manage every repair from check-in to completed.', '<button class="secondary-btn" data-toast="Export prepared as CSV">↥ Export</button><button class="primary-btn" data-modal="work-order">＋ Create work order</button>')}
    <div class="metric-mini-grid"><div class="metric-mini"><span>Open work orders</span><b>18</b></div><div class="metric-mini"><span>Awaiting approval</span><b style="color:var(--orange)">03</b></div><div class="metric-mini"><span>Ready for pickup</span><b style="color:var(--green)">04</b></div></div>
    <div class="card table-card"><div class="toolbar"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div class="search-box">⌕<input id="woSearch" placeholder="Search work orders, vehicles..." value="${state.search}" /></div><select class="filter-select" id="woFilter"><option>All status</option><option>Received</option><option>Diagnosing</option><option>In progress</option><option>Awaiting parts</option><option>Quality check</option><option>Ready for pickup</option></select></div><div style="display:flex;gap:7px;align-items:center"><button class="secondary-btn" style="padding:8px 10px" id="boardToggle">▦ Kanban</button><button class="ghost-btn" data-toast="Filters panel opened">☷ More filters</button></div></div>${workOrderTable(items, true)}</div>
    <section class="card section-gap table-card" id="kanbanSection" style="display:none"><div class="card-header"><div><span class="card-title">Status board</span><span class="card-sub">Drag-and-drop workflow overview</span></div><span class="status-pill blue">Live</span></div><div class="kanban">${kanbanStatuses.map(status => `<div class="kanban-col"><div class="kanban-head"><b>${status.toUpperCase()}</b><span class="kanban-count">${state.workOrders.filter(x=>x.status===status).length}</span></div><div class="kanban-stack">${state.workOrders.filter(x=>x.status===status).map(wo=>`<div class="kanban-card" data-wo="${wo.id}"><span class="wo-id">${wo.id}</span><b>${wo.vehicle}</b><span>${wo.issue}</span><div class="kanban-foot"><small>${wo.eta.replace('Today, ','')}</small><div class="avatar-stack"><div class="avatar" style="background:#7b74eb">${initials(wo.mechanic)}</div></div></div></div>`).join('') || '<div class="empty-bay">No jobs here</div>'}</div></div>`).join('')}</div></section>`;
}

function scheduleView() {
  const empty = liveWorkspaceEmpty(state.appointments, 'Schedule', 'Book and manage service appointments.', '<button class="primary-btn" data-modal="appointment">＋ New appointment</button>');
  if (empty) return empty;
  const appts = [
    ['8:30 AM','Rohan Shah','Toyota Innova · Brake vibration','purple'], ['9:00 AM','—','Bay 4 available','green'], ['10:00 AM','Priya Menon','Kia Seltos · Periodic service','blue'], ['11:30 AM','Meera Nair','Hyundai Creta · Pickup','orange'], ['1:00 PM','Walk-in slot','Reserved for urgent repairs','green'], ['3:00 PM','Vikram Singh','Ford EcoSport · Diagnostics','purple']
  ];
  state.appointments.slice(-3).forEach(a => appts.push([a.appointment_time, a.customer_name || 'Customer appointment', `${a.make || ''} ${a.model || ''} · ${a.service_type}`.trim(), 'green']));
  return `${pageHeading('Schedule', 'Thursday, September 10, 2026 · 72% capacity used', '<button class="secondary-btn" data-toast="Week view selected">Week view</button><button class="primary-btn" data-modal="appointment">＋ New appointment</button>')}
    <div class="schedule-layout"><section class="card calendar-card"><div class="calendar-toolbar"><div><h3>September 2026</h3><p>4 service bays · 3 technicians on shift</p></div><div class="calendar-controls"><button class="cal-arrow">‹</button><button class="cal-arrow">›</button></div></div><div class="cal-body"><div class="week-strip">${[['MON','7'],['TUE','8'],['WED','9'],['THU','10'],['FRI','11'],['SAT','12'],['SUN','13']].map(([d,n],i)=>`<div class="week-day ${i===3?'active':''}">${d}<b>${n}</b></div>`).join('')}</div><div class="timeline">${appts.map(a=>`<div class="timeline-row"><div class="time-label">${a[0]}</div><div class="timeline-slot"><div class="appointment ${a[3]}"><div><b>${a[1]}</b><span>${a[2]}</span></div><span class="appt-time">${a[0]}</span></div></div></div>`).join('')}</div></div></section><div><section class="card agenda-card"><div class="card-header"><div><span class="card-title">Today’s agenda</span><span class="card-sub">6 appointments · 2 walk-ins</span></div></div><div class="agenda-list">${appts.slice(0,5).map(a=>`<div class="agenda-item"><div class="agenda-time">${a[0]}</div><div class="agenda-body"><b>${a[1]}</b><span>${a[2]}</span></div><span class="status-dot ${a[3]}"></span></div>`).join('')}</div></section><section class="card section-gap side-stat"><h3>AI scheduling insight</h3><p>Keep Bay 4 open until noon for urgent brake and steering repairs.</p><div class="stat-line"><span>Capacity used</span><b>72%</b></div><div class="full-bar"><i style="width:72%"></i></div><div class="stat-line"><span>Estimated wait</span><b>15 min</b></div><div class="stat-line"><span>Open slots</span><b>04</b></div></section></div></div>`;
}

function customersView() {
  const empty = liveWorkspaceEmpty(state.customers, 'Customers', 'Store customer and vehicle service history.', '<button class="primary-btn" data-modal="customer">＋ Add customer</button>');
  if (empty) return empty;
  const customers = [
    ['Ananya Rao','ananya.rao@email.com','2021 Honda City VX','KA 03 MK 8271','₹ 18,650','Sep 10, 2026','AR'],
    ['Rohan Shah','rohan.shah@email.com','2018 Toyota Innova','KA 05 MC 2190','₹ 42,800','Sep 10, 2026','RS'],
    ['Meera Nair','meera.nair@email.com','2020 Hyundai Creta','KA 04 NG 4102','₹ 26,400','Sep 09, 2026','MN'],
    ['Vikram Singh','vikram.singh@email.com','2017 Ford EcoSport','KA 01 AB 7788','₹ 31,250','Aug 28, 2026','VS'],
    ['Priya Menon','priya.menon@email.com','2022 Kia Seltos HTX','KA 02 PJ 6510','₹ 12,900','Aug 18, 2026','PM']
  ];
  return `${pageHeading('Customers', '342 customers · 18 new this month · 73% return rate', '<button class="secondary-btn" data-toast="Customer import started">⇩ Import</button><button class="primary-btn" data-modal="customer">＋ Add customer</button>')}
    <div class="kpi-grid"><div class="kpi-card"><div class="kpi-top"><span>Total customers</span><span class="kpi-icon purple">♙</span></div><div class="kpi-value">342</div><div class="kpi-foot"><span class="up">↑ 5.6%</span> this month</div></div><div class="kpi-card"><div class="kpi-top"><span>New this month</span><span class="kpi-icon blue">＋</span></div><div class="kpi-value">18</div><div class="kpi-foot">7 from referrals</div></div><div class="kpi-card"><div class="kpi-top"><span>Repeat customers</span><span class="kpi-icon green">↻</span></div><div class="kpi-value">73%</div><div class="kpi-foot"><span class="up">↑ 4.2%</span> vs. last month</div></div><div class="kpi-card"><div class="kpi-top"><span>Avg. customer value</span><span class="kpi-icon orange">₹</span></div><div class="kpi-value">₹ 24.7k</div><div class="kpi-foot">Annual spend per customer</div></div></div>
    <div class="card table-card"><div class="toolbar"><div class="search-box">⌕<input placeholder="Search by name, phone, vehicle..." /></div><div style="display:flex;gap:7px"><select class="filter-select"><option>All customers</option><option>Active this month</option><option>Needs reminder</option></select><button class="ghost-btn" data-toast="Customer tags opened">⌑ Tags</button></div></div><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Primary vehicle</th><th>Lifetime value</th><th>Last visit</th><th>Contact</th></tr></thead><tbody>${customers.map(c=>`<tr data-toast="Opening ${c[0]}'s profile"><td><div class="vehicle-cell"><div class="avatar" style="background:#7a73eb">${c[6]}</div><div><b>${c[0]}</b><span>${c[1]}</span></div></div></td><td><div class="vehicle-cell"><div class="car-thumb">🚗</div><div><b>${c[2]}</b><span>${c[3]}</span></div></div></td><td><b style="font-size:10px">${c[4]}</b></td><td><span style="font-size:10px">${c[5]}</span></td><td><button class="ghost-btn" data-modal="message">Message</button></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Showing 5 of 342 customers</span><div class="pagination"><button class="page-btn active">1</button><button class="page-btn">2</button><button class="page-btn">3</button><button class="page-btn">›</button></div></div></div>`;
}

function inventoryView() {
  const empty = liveWorkspaceEmpty(state.inventory, 'Inventory', 'Track parts and reorder before repairs are delayed.', '<button class="primary-btn" data-modal="part">＋ Add part</button>');
  if (empty) return empty;
  const parts = [
    ['Front brake pads · Universal','BP-UNV-001','3','5','₹ 1,800','A-1','Low stock'], ['5W-30 Synthetic oil · 1L','OL-5W30-01','6','20','₹ 4,200','C-1','Low stock'], ['Cabin air filter · Hyundai','CF-HYU-004','2','5','₹ 1,100','D-3','Low stock'], ['0W-20 Synthetic oil · 1L','OL-0W20-01','24','20','₹ 14,400','C-1','In stock'], ['Oil filter · Assorted','OF-AST-001','18','10','₹ 2,700','B-2','In stock'], ['Denso iridium spark plug','SP-DEN-011','16','8','₹ 3,840','B-4','In stock'], ['Wiper blades · Universal','WB-UNV-001','8','5','₹ 4,000','E-1','In stock']
  ];
  return `${pageHeading('Inventory', 'Track parts, reorder before you run out, and keep jobs moving.', '<button class="secondary-btn" data-toast="Inventory report downloaded">⇩ Export report</button><button class="primary-btn" data-modal="part">＋ Add part</button>')}
    <div class="inventory-layout"><section class="card table-card"><div class="toolbar"><div class="search-box">⌕<input placeholder="Search part name or number..." /></div><div style="display:flex;gap:7px"><select class="filter-select"><option>All categories</option><option>Brakes</option><option>Fluids</option><option>Filters</option></select><button class="secondary-btn" style="padding:8px 10px" data-modal="purchase">＋ Purchase order</button><button class="secondary-btn" style="padding:8px 10px" data-modal="stock-adjust">↕ Adjust stock</button></div></div><div class="table-wrap"><table><thead><tr><th>Part</th><th>Part number</th><th>On hand</th><th>Min. stock</th><th>Inventory value</th><th>Location</th><th>Status</th></tr></thead><tbody>${parts.map(p=>`<tr><td><div class="vehicle-cell"><div class="car-thumb" style="font-size:14px">⚙</div><div><b>${p[0]}</b><span>Supplier: Bosch / MGP</span></div></div></td><td><span class="wo-id">${p[1]}</span></td><td><b style="font-size:11px;color:${p[2] <= p[3]?'var(--red)':'var(--text)'}">${p[2]}</b></td><td><span class="muted">${p[3]}</span></td><td><b style="font-size:10px">${p[4]}</b></td><td><span class="muted">${p[5]}</span></td><td><span class="status-pill ${p[6]==='Low stock'?'orange':'green'}">${p[6]}</span></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Showing 7 of 86 parts</span><div class="pagination"><button class="page-btn active">1</button><button class="page-btn">2</button><button class="page-btn">3</button><button class="page-btn">›</button></div></div></section><div><section class="card"><div class="stock-kpi"><span class="card-title">Inventory health</span><div class="stock-number">86%</div><p>of parts are comfortably above minimum stock</p><div class="full-bar"><i style="width:86%;background:var(--green)"></i></div><div class="category-row"><span>Fluids</span><div class="full-bar"><i style="width:91%;background:var(--blue)"></i></div><b>91%</b></div><div class="category-row"><span>Filters</span><div class="full-bar"><i style="width:78%;background:var(--purple)"></i></div><b>78%</b></div><div class="category-row"><span>Brakes</span><div class="full-bar"><i style="width:62%;background:var(--orange)"></i></div><b>62%</b></div></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Low stock alerts</span><span class="card-sub">Reorder to avoid job delays</span></div><span class="status-pill orange">3 items</span></div><div class="stock-list"><div class="stock-alert"><div class="part-icon">⚙</div><div><b>Front brake pads</b><span>3 left · minimum 5</span></div><a data-modal="purchase">Reorder</a></div><div class="stock-alert"><div class="part-icon">◌</div><div><b>5W-30 synthetic oil</b><span>6 left · minimum 20</span></div><a data-modal="purchase">Reorder</a></div><div class="stock-alert"><div class="part-icon">▤</div><div><b>Cabin air filters</b><span>2 left · minimum 5</span></div><a data-modal="purchase">Reorder</a></div></div></section></div></div>`;
}

function billingView() {
  const empty = liveWorkspaceEmpty(state.invoices, 'Billing & financials', 'Invoices and payments will appear here after your first job.', '<button class="primary-btn" data-modal="invoice">＋ New invoice</button>');
  if (empty) return empty;
  const f = state.financialReport || { paid_revenue: 284650, inventory_cost: 91240, estimated_gross_profit: 193410, outstanding: 28450, invoice_count: 5 };
  return `${pageHeading('Billing & financials', 'A clear view of cash flow, payments, and outstanding invoices.', '<button class="secondary-btn" data-report-action="close-day">▣ Close day</button><button class="secondary-btn" data-integration-action="export-accounting">⇩ Export CSV</button><button class="primary-btn" data-modal="invoice">＋ New invoice</button>')}
    <div class="billing-grid"><div class="card finance-card"><span>Revenue · September</span><div class="finance-value">₹ ${Number(f.paid_revenue || 0).toLocaleString('en-IN')}</div><div class="finance-foot"><strong>↑ 12.8%</strong> compared with August</div></div><div class="card finance-card"><span>Inventory costs</span><div class="finance-value">₹ ${Number(f.inventory_cost || 0).toLocaleString('en-IN')}</div><div class="finance-foot"><strong style="color:var(--blue)">32% of revenue</strong> · healthy range</div></div><div class="card finance-card"><span>Estimated gross profit</span><div class="finance-value">₹ ${Number(f.estimated_gross_profit || 0).toLocaleString('en-IN')}</div><div class="finance-foot"><strong>68% margin</strong> · +3.4% this month</div></div></div>
    <div class="billing-columns"><section class="card table-card"><div class="card-header"><div><span class="card-title">Outstanding invoices</span><span class="card-sub">3 invoices · ₹ 28,450 due</span></div><button class="ghost-btn" data-toast="Payment reminders sent">Send reminders</button></div><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${[['INV-2026-0138','Ananya Rao','Sep 10','₹ 8,450','Awaiting approval','orange'],['INV-2026-0131','Vikram Singh','Sep 05','₹ 12,900','Due in 2 days','blue'],['INV-2026-0124','Sanjay Kumar','Aug 29','₹ 7,100','Overdue 5 days','red'],['INV-2026-0119','Meera Nair','Aug 28','₹ 4,250','Paid','green']].map(i=>`<tr><td><span class="wo-id">${i[0]}</span></td><td><span style="font-size:10px">${i[1]}</span></td><td><span class="muted">${i[2]}</span></td><td><b style="font-size:10px">${i[3]}</b></td><td><span class="status-pill ${i[5]}">${i[4]}</span></td><td><button class="ghost-btn" data-toast="Invoice ${i[0]} opened">View</button>${i[5] !== 'green' ? `<button class="ghost-btn" data-invoice-action="pay" data-invoice-id="${i[0]}">Mark paid</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section><section class="card"><div class="card-header"><div><span class="card-title">Revenue mix</span><span class="card-sub">September by service type</span></div></div><div class="donut-wrap"><div class="donut"><b>₹2.84L</b></div><div class="legend"><div class="legend-row"><i style="background:var(--purple)"></i>Repairs <b>49%</b></div><div class="legend-row"><i style="background:var(--blue)"></i>Maintenance <b>27%</b></div><div class="legend-row"><i style="background:var(--orange)"></i>Diagnostics <b>14%</b></div><div class="legend-row"><i style="background:#e8ebf3"></i>Other <b>10%</b></div></div></div></section></div>`;
}

function marketingView() {
  const posts = state.marketingPosts.length ? state.marketingPosts : [
    { id: 'demo-1', title: 'Brake safety checklist', format: 'Reel', platforms: 'Instagram · Facebook · YouTube', status: 'Draft', scheduled_for: 'Not scheduled', caption: 'A simple brake check can prevent a big problem. Save this checklist and book an inspection at Royal Car Service Center.' },
    { id: 'demo-2', title: 'A/C service before summer', format: 'Reel', platforms: 'Instagram · Facebook', status: 'Scheduled', scheduled_for: 'Sep 14 · 11:00 AM', caption: 'Is your A/C taking longer to cool? Here are 3 signs it is time for a check.' },
    { id: 'demo-3', title: 'Meet the team', format: 'Short video', platforms: 'YouTube', status: 'Published', scheduled_for: 'Sep 08 · 6:00 PM', caption: 'The people behind every careful inspection and repair.' }
  ];
  const connected = state.marketingStatus || {};
  return `${pageHeading('Marketing studio', 'Create useful local content, approve it, and schedule it across your social channels.', '<button class="secondary-btn" data-marketing-action="connect">⚙ Connect accounts</button><button class="primary-btn" data-marketing-action="generate">✦ Generate reel idea</button>')}
    <div class="kpi-grid"><div class="kpi-card"><div class="kpi-top"><span>Drafts waiting</span><span class="kpi-icon purple">✺</span></div><div class="kpi-value">${posts.filter(x=>x.status==='Draft').length}</div><div class="kpi-foot">Owner approval required</div></div><div class="kpi-card"><div class="kpi-top"><span>Scheduled posts</span><span class="kpi-icon blue">▣</span></div><div class="kpi-value">${posts.filter(x=>x.status==='Scheduled').length}</div><div class="kpi-foot">Next post Sep 14</div></div><div class="kpi-card"><div class="kpi-top"><span>Published this month</span><span class="kpi-icon green">✓</span></div><div class="kpi-value">${posts.filter(x=>x.status==='Published').length}</div><div class="kpi-foot"><span class="up">↑ 24%</span> reach vs last month</div></div><div class="kpi-card"><div class="kpi-top"><span>Channels connected</span><span class="kpi-icon orange">◉</span></div><div class="kpi-value">${Object.values(connected).filter(Boolean).length || 0}/3</div><div class="kpi-foot">Instagram · Facebook · YouTube</div></div></div>
    <div class="marketing-layout"><section class="card content-studio-card"><div class="card-header"><div><span class="card-title">AI content studio</span><span class="card-sub">Turn real workshop work into helpful local content</span></div><span class="status-pill purple">Human approval on</span></div><div class="content-studio-form"><div class="form-group"><label>Content topic</label><select class="form-select" id="marketingTopic"><option>Brake safety tips</option><option>A/C service before summer</option><option>Oil change checklist</option><option>Meet the Royal Car team</option><option>Before and after repair</option></select></div><div class="form-group"><label>Format</label><select class="form-select" id="marketingFormat"><option>Instagram Reel</option><option>Facebook Reel</option><option>YouTube Short</option><option>All three</option></select></div><div class="form-group"><label>Language</label><select class="form-select" id="marketingLanguage"><option>English</option><option>Kannada</option><option>Hindi</option><option>English + Kannada</option></select></div><div class="form-group"><label>Call to action</label><select class="form-select" id="marketingCta"><option>Book an inspection</option><option>Call the garage</option><option>WhatsApp us</option><option>Visit the workshop</option></select></div><div class="form-group full"><label>Optional source material</label><input class="form-input" id="marketingSourceMedia" type="file" accept="image/*,video/*" multiple /><small class="field-hint">Use real repair photos only with customer consent. AI will create a hook, shot list, caption, hashtags, and voiceover script.</small></div><label class="marketing-consent"><input id="marketingConsent" type="checkbox" /> I confirm these photos/videos are approved for marketing use.</label><button class="primary-btn" data-marketing-action="generate">Generate content package →</button></div><div class="generated-content" id="generatedMarketingContent"><div class="generated-placeholder"><span>✦</span><b>Your content package will appear here</b><small>Generate a reel idea to see the script, caption, and shot list.</small></div></div></section><div><section class="card social-accounts-card"><div class="card-header"><div><span class="card-title">Publishing accounts</span><span class="card-sub">Connect once, publish with approval</span></div></div><div class="social-list"><div class="social-row"><div class="social-icon instagram">◎</div><div><b>Instagram Professional</b><span>${connected.instagram ? 'Connected · @royalcarservice' : 'Needs Meta credentials'}</span></div><span class="status-pill ${connected.instagram?'green':'orange'}">${connected.instagram?'Connected':'Setup'}</span></div><div class="social-row"><div class="social-icon facebook">f</div><div><b>Facebook Page</b><span>${connected.facebook ? 'Connected · Royal Car Service Center' : 'Needs Meta Page access'}</span></div><span class="status-pill ${connected.facebook?'green':'orange'}">${connected.facebook?'Connected':'Setup'}</span></div><div class="social-row"><div class="social-icon youtube">▶</div><div><b>YouTube channel</b><span>${connected.youtube ? 'Connected · Royal Car Service Center' : 'Needs Google OAuth'}</span></div><span class="status-pill ${connected.youtube?'green':'orange'}">${connected.youtube?'Connected':'Setup'}</span></div></div></section><section class="card section-gap marketing-safety"><div class="card-header"><div><span class="card-title">Publishing guardrails</span><span class="card-sub">Protect the garage brand</span></div></div><div class="safety-list"><div><span>Owner approval</span><b style="color:var(--green)">Required</b></div><div><span>Customer faces</span><b>Blur before publish</b></div><div><span>Claims review</span><b>AI disclaimer on</b></div><div><span>Music licensing</span><b>Original audio only</b></div></div></section></div></div>
    <section class="card section-gap marketing-queue"><div class="card-header"><div><span class="card-title">Content queue</span><span class="card-sub">Draft, schedule, and publish only after approval</span></div><button class="ghost-btn" data-marketing-action="refresh">↻ Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Content</th><th>Format</th><th>Platforms</th><th>Scheduled</th><th>Status</th><th></th></tr></thead><tbody>${posts.map(p=>`<tr><td><div class="marketing-title"><div class="reel-thumb">▶</div><div><b>${p.title}</b><span>${p.caption}</span></div></div></td><td><span class="channel-pill">${p.format}</span></td><td><span class="muted">${p.platforms}</span></td><td><span class="muted">${p.scheduled_for}</span></td><td><span class="status-pill ${p.status==='Published'?'green':p.status==='Scheduled'?'blue':'orange'}">${p.status}</span></td><td>${p.status==='Draft'?(state.session?.user?.role==='Owner'?'<button class="ghost-btn" data-marketing-action="approve" data-post-id="'+p.id+'">Approve</button>':'<span class="muted">Owner approval</span>'):'<button class="ghost-btn" data-marketing-action="preview" data-post-id="'+p.id+'">Preview</button>'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function notificationsView() {
  const empty = liveWorkspaceEmpty(state.notifications, 'Communications', 'Customer messages will appear here once notifications are sent.', '<button class="primary-btn" data-notification-action="queue">＋ Queue message</button>');
  if (empty) return empty;
  const metrics = state.notificationMetrics || { queued: 2, sent_today: 18, failed: 1, delivery_rate: 94 };
  const rows = state.notifications.length ? state.notifications : [
    { id: 101, type: 'Estimate approval', channel: 'WhatsApp', recipient: 'Ananya Rao', message: 'Your estimate is ready for review.', status: 'Queued', scheduled_for: 'Now', attempts: 0 },
    { id: 102, type: 'Repair update', channel: 'WhatsApp', recipient: 'Rohan Shah', message: 'Your Toyota Innova has moved to quality check.', status: 'Sent', scheduled_for: 'Today, 9:45 AM', attempts: 1 },
    { id: 103, type: 'Maintenance reminder', channel: 'SMS', recipient: 'Priya Menon', message: 'Your tire rotation is due soon.', status: 'Failed', scheduled_for: 'Today, 8:00 AM', attempts: 3 }
  ];
  return `${pageHeading('Communications', 'Automate customer updates and keep every delivery traceable.', '<button class="secondary-btn" data-notification-action="run">▶ Run scheduler</button><button class="primary-btn" data-notification-action="queue">＋ Queue message</button>')}
    <div class="kpi-grid"><div class="kpi-card"><div class="kpi-top"><span>Queued messages</span><span class="kpi-icon purple">⌁</span></div><div class="kpi-value">${metrics.queued || 0}</div><div class="kpi-foot">Waiting for delivery</div></div><div class="kpi-card"><div class="kpi-top"><span>Sent today</span><span class="kpi-icon green">✓</span></div><div class="kpi-value">${metrics.sent_today || 0}</div><div class="kpi-foot"><span class="up">↑ 18%</span> vs. yesterday</div></div><div class="kpi-card"><div class="kpi-top"><span>Failed deliveries</span><span class="kpi-icon orange">!</span></div><div class="kpi-value">${metrics.failed || 0}</div><div class="kpi-foot"><span class="down">Needs retry</span> after provider setup</div></div><div class="kpi-card"><div class="kpi-top"><span>Delivery rate</span><span class="kpi-icon blue">◉</span></div><div class="kpi-value">${metrics.delivery_rate || 0}%</div><div class="kpi-foot">Across WhatsApp and SMS</div></div></div>
    <div class="notifications-layout"><section class="card table-card"><div class="card-header"><div><span class="card-title">Delivery queue</span><span class="card-sub">Every customer message, its channel, and current status</span></div><button class="ghost-btn" data-notification-action="refresh">↻ Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Message</th><th>Recipient</th><th>Channel</th><th>Scheduled</th><th>Status</th><th>Attempts</th><th></th></tr></thead><tbody>${rows.map(n=>`<tr><td><div class="notification-table-copy"><b>${n.type || 'Customer update'}</b><span>${n.message || ''}</span></div></td><td><span style="font-size:10px">${n.recipient || 'Customer'}</span></td><td><span class="channel-pill">${n.channel || 'WhatsApp'}</span></td><td><span class="muted">${n.scheduled_for || 'Now'}</span></td><td><span class="status-pill ${n.status === 'Sent' ? 'green' : n.status === 'Failed' ? 'red' : 'orange'}">${n.status}</span></td><td><span class="muted">${n.attempts || 0}/3</span></td><td>${n.status === 'Failed' ? `<button class="ghost-btn" data-notification-action="retry" data-notification-id="${n.id}">Retry</button>` : `<button class="ghost-btn" data-toast="Message details opened">View</button>`}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Showing ${rows.length} recent messages</span><span class="muted">Logs retained for 7 years</span></div></section><div><section class="card message-templates"><div class="card-header"><div><span class="card-title">Automation templates</span><span class="card-sub">Queue the right message at the right moment</span></div></div><div class="template-list"><button class="template-item" data-notification-template="appointment"><div class="template-icon purple">▣</div><div><b>Appointment reminder</b><span>Send 24 hours before a booking</span></div><span>→</span></button><button class="template-item" data-notification-template="estimate"><div class="template-icon orange">₹</div><div><b>Estimate approval</b><span>Send a secure approval link</span></div><span>→</span></button><button class="template-item" data-notification-template="pickup"><div class="template-icon green">✓</div><div><b>Ready for pickup</b><span>Notify when quality check passes</span></div><span>→</span></button><button class="template-item" data-notification-template="maintenance"><div class="template-icon blue">⌁</div><div><b>Maintenance reminder</b><span>Use mileage and service history</span></div><span>→</span></button></div></section><section class="card section-gap retry-card"><div class="card-header"><div><span class="card-title">Retry policy</span><span class="card-sub">Failures are retried automatically</span></div><span class="status-pill blue">Active</span></div><div class="retry-policy"><div><span>Maximum attempts</span><b>3</b></div><div><span>Retry delay</span><b>15 minutes</b></div><div><span>Escalation</span><b>Owner alert</b></div></div></section></div></div>`;
}

function reportsView() {
  const empty = liveWorkspaceEmpty(state.invoices, 'Reports & insights', 'Reports will populate as your real garage records arrive.', '<button class="primary-btn" data-view="work-orders">Open work orders</button>');
  if (empty) return empty;
  return `${pageHeading('Reports & insights', 'September 2026 · Trends that help you make the next move.', '<button class="date-chip">⌄ September 2026</button><button class="primary-btn" data-toast="Report exported as PDF">⇩ Export report</button>')}
    <div class="report-grid"><section class="card"><div class="card-header"><div><span class="card-title">Revenue trend</span><span class="card-sub">Monthly revenue · last 6 months</span></div><span class="status-pill green">↑ 12.8%</span></div><div class="bar-chart">${[['Apr','1.58L',48],['May','1.84L',58],['Jun','2.02L',66],['Jul','2.28L',74],['Aug','2.52L',84],['Sep','2.84L',100]].map((b,i)=>`<div class="chart-bar-col"><div class="chart-bar" style="height:${b[2]}%;${i===5?'background:var(--purple-dark)':''}" data-value="${b[1]}"></div><span class="chart-label">${b[0]}</span></div>`).join('')}</div></section><section class="card"><div class="card-header"><div><span class="card-title">Top services by revenue</span><span class="card-sub">September performance</span></div><a class="card-link" data-toast="Detailed service report opened">Details →</a></div><div class="insight-list"><div class="insight"><div class="insight-bulb" style="background:var(--purple-soft);color:var(--purple)">1</div><div style="flex:1"><b>Brake services</b><span><span class="full-bar" style="display:inline-block;width:70%;height:5px;margin-right:8px;vertical-align:middle"><i style="width:82%"></i></span> ₹ 62,400</span></div></div><div class="insight"><div class="insight-bulb" style="background:var(--blue-soft);color:var(--blue)">2</div><div style="flex:1"><b>Periodic maintenance</b><span><span class="full-bar" style="display:inline-block;width:70%;height:5px;margin-right:8px;vertical-align:middle"><i style="width:68%;background:var(--blue)"></i></span> ₹ 48,700</span></div></div><div class="insight"><div class="insight-bulb" style="background:var(--orange-soft);color:var(--orange)">3</div><div style="flex:1"><b>A/C & cooling</b><span><span class="full-bar" style="display:inline-block;width:70%;height:5px;margin-right:8px;vertical-align:middle"><i style="width:46%;background:var(--orange)"></i></span> ₹ 31,200</span></div></div><div class="insight"><div class="insight-bulb" style="background:var(--green-soft);color:var(--green)">4</div><div style="flex:1"><b>Diagnostics</b><span><span class="full-bar" style="display:inline-block;width:70%;height:5px;margin-right:8px;vertical-align:middle"><i style="width:39%;background:var(--green)"></i></span> ₹ 26,850</span></div></div></div></section></div>
    <div class="dashboard-grid section-gap"><section class="card"><div class="card-header"><div><span class="card-title">Workshop performance</span><span class="card-sub">Operations managed by the owner and advisor</span></div></div><div class="table-wrap"><table><thead><tr><th>Operations</th><th>Jobs closed</th><th>Avg. job time</th><th>Efficiency</th><th>Rating</th></tr></thead><tbody>${[['Workshop team','71','2.1 hrs','88%','4.6']].map(x=>`<tr><td><div class="vehicle-cell"><div class="avatar avatar-gold">WT</div><b>${x[0]}</b></div></td><td>${x[1]}</td><td class="muted">${x[2]}</td><td><span class="status-pill green">${x[3]}</span></td><td>★ ${x[4]}</td></tr>`).join('')}</tbody></table></div></section><section class="card side-stat"><h3>AI insights</h3><p>GarageAI found 3 useful patterns in your business data.</p><div class="insight" style="border-top:1px solid var(--line);padding-top:12px"><div class="insight-bulb">✦</div><div><b>Brake jobs are up 22%</b><span>Stock 8 extra pad sets before next week.</span></div></div><div class="insight"><div class="insight-bulb">✦</div><div><b>Tuesday has open capacity</b><span>Try a midweek A/C inspection offer.</span></div></div><div class="insight"><div class="insight-bulb">✦</div><div><b>3 customers need reminders</b><span>Maintenance reminders are queued.</span></div></div></section></div>`;
}

function aiView() {
  return `${pageHeading('GarageAI assistant', 'Technical support for your team — diagnostics, procedures, specs, and more.', '<span class="status-pill green"><i class="status-dot green"></i>Connected</span>')}
    <div class="ai-layout"><section class="card chat-card"><div class="chat-header"><div class="ai-orb">✦</div><div><b>GarageAI Pro Assistant</b><span>● Online · Technical mode</span></div><button class="chat-mode">Technical ⌄</button></div><div class="chat-messages" id="chatMessages">${state.chat.map(m=>messageHtml(m)).join('')}</div><div class="chat-suggestions"><button class="suggestion" data-prompt="P0301 on a 2019 Toyota Camry 2.5L">Diagnose P0301</button><button class="suggestion" data-prompt="Oil capacity for 2021 Honda CR-V 1.5 turbo">Lookup oil capacity</button><button class="suggestion" data-prompt="Check brake pads on a Toyota Innova">Brake inspection checklist</button></div><div class="chat-input-row"><input class="chat-input" id="chatInput" placeholder="Ask about a symptom, DTC, part, or procedure..." /><button class="chat-send" id="chatSend">↑</button></div></section><div><section class="card"><div class="card-header"><div><span class="card-title">Technical tools</span><span class="card-sub">Fast answers for the workshop floor</span></div></div><div class="tool-list"><button class="tool-item" data-prompt="Diagnose an engine misfire at idle"><div class="tool-icon">⌕</div><div><b>Diagnose symptom</b><span>Work from customer complaints</span></div></button><button class="tool-item" data-prompt="Show the inspection checklist for grinding brakes"><div class="tool-icon">✓</div><div><b>Inspection checklist</b><span>Step-by-step safety checks</span></div></button><button class="tool-item" data-prompt="Find the labor time for front brake pads on a 2019 Toyota Camry"><div class="tool-icon">◷</div><div><b>Lookup labor time</b><span>Estimate hours and parts</span></div></button><button class="tool-item" data-prompt="Find compatible front brake pads for a 2019 Toyota Camry"><div class="tool-icon">▥</div><div><b>Find a part</b><span>Search inventory and fitment</span></div></button></div></section><section class="card section-gap side-stat"><h3>Safety first</h3><p>GarageAI suggestions support, but never replace, OEM documentation and hands-on inspection.</p><span class="status-pill orange">Verify safety-critical repairs</span></section></div></div>`;
}
function messageHtml(m) {
  const isUser = m.who === 'user';
  return `<div class="message ${isUser?'user':''}"><div class="mini-avatar">${isUser?'AM':'✦'}</div><div class="message-bubble">${m.text}</div></div>`;
}

function settingsView() {
  const integrations = [
    ['twilio', '◉', 'SMS & WhatsApp', 'Twilio', 'Appointment reminders, estimate approvals, and pickup alerts', 'Connected', 'green'],
    ['payments', '₹', 'Payments', 'Razorpay / Stripe', 'Secure checkout links, cards, UPI, and payment status', 'Ready to connect', 'orange'],
    ['accounting', '▤', 'Accounting', 'QuickBooks / Zoho Books', 'Export invoices, expenses, and daily summaries', 'Ready to connect', 'orange'],
    ['vin', '⌁', 'VIN & vehicle data', 'NHTSA / OEM data', 'Decode VINs and enrich vehicle profiles', 'Connected', 'green'],
    ['suppliers', '▥', 'Parts suppliers', 'MGP / Bosch / Boodmo', 'Compare availability, prices, and estimated delivery', 'Connected', 'green'],
    ['maps', '⌖', 'Maps & directions', 'Google Maps', 'Customer directions and pickup/drop-off routes', 'Ready to connect', 'orange']
  ];
  return `${pageHeading('Settings & integrations', 'Control access, communication, payments, and the systems behind your garage.', '<button class="secondary-btn" data-modal="vin">⌁ Test VIN decoder</button><button class="primary-btn" data-integration-action="export-accounting">⇧ Export data</button>')}
    <div class="settings-layout"><div><section class="card settings-profile"><div class="card-header"><div><span class="card-title">Garage profile</span><span class="card-sub">Expert care every drive · used on customer messages and invoices</span></div><span class="status-pill green">Live</span></div><div class="settings-fields"><div><label>Garage name</label><b>Royal Car Service Center</b></div><div><label>Phone</label><b>09535666858</b></div><div class="full"><label>Address</label><b>73, Dasarahalli Main Rd, Mariyannapalya, Nagavara, Bengaluru, Karnataka 560024</b></div><div><label>Operating hours</label><b>Mon–Sat · 9:30 AM–9:00 PM</b></div><div><label>Sunday</label><b>9:30 AM–1:30 PM</b></div><div><label>WhatsApp</label><b>9880131114</b></div><div><label>Payments</label><b>Cash · UPI · INR</b></div><div class="full"><label>Services</label><b>General service · Brakes · A/C · Diagnostics · Suspension · Electrical · Detailing</b></div></div><div class="settings-actions"><button class="secondary-btn" data-settings-action="edit-profile">Edit profile</button><button class="ghost-btn" data-settings-action="save-profile">Save changes</button></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Communication center</span><span class="card-sub">Default customer notification rules</span></div><span class="status-pill blue">Automation on</span></div><div class="settings-list"><div class="settings-row"><div class="settings-row-icon purple">⌁</div><div><b>Appointment reminders</b><span>Send WhatsApp and SMS 24 hours before a booking</span></div><button class="toggle on" data-settings-toggle="reminders"><i></i></button></div><div class="settings-row"><div class="settings-row-icon green">✓</div><div><b>Repair status updates</b><span>Notify customers when a vehicle changes status</span></div><button class="toggle on" data-settings-toggle="status"><i></i></button></div><div class="settings-row"><div class="settings-row-icon orange">₹</div><div><b>Estimate approvals</b><span>Send a secure approval link when an estimate is ready</span></div><button class="toggle on" data-settings-toggle="estimates"><i></i></button></div><div class="settings-row"><div class="settings-row-icon blue">▥</div><div><b>Low-stock alerts</b><span>Notify the owner when parts reach minimum stock</span></div><button class="toggle on" data-settings-toggle="inventory"><i></i></button></div></div><div class="settings-footer"><button class="secondary-btn" data-integration-action="send-test-message">Send test message</button><span>Last test: Never · <a data-toast="Notification log opened">View log</a></span></div></section></div><div><section class="card"><div class="card-header"><div><span class="card-title">Team access</span><span class="card-sub">Role-based access for your staff</span></div><button class="ghost-btn" data-settings-action="invite">＋ Invite</button></div><div class="access-list"><div class="access-row"><div class="avatar avatar-gold">SR</div><div><b>Shiva Rajkumara R</b><span>Owner · Full access</span></div><span class="access-chip full">Owner</span></div><div class="access-row"><div class="avatar" style="background:#24ae75">SA</div><div><b>Sandhesh</b><span>Advisor · Work orders, customers, billing</span></div><span class="access-chip">Advisor</span></div></div><div class="role-note">Workshop technicians do not require phone logins. The owner and advisor manage their work orders from the operations workspace. Permissions are enforced at the API layer.</div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Data & safety</span><span class="card-sub">Keep your garage records protected</span></div></div><div class="safety-list"><div><span>Last backup</span><b>Today, 2:00 AM</b></div><div><span>Records retained</span><b>7 years</b></div><div><span>Audit events</span><b>128 this month</b></div><button class="secondary-btn" data-settings-action="backup" style="width:100%;margin-top:10px">Run backup now</button></div></section></div></div>
    <section class="card section-gap integrations-card"><div class="card-header"><div><span class="card-title">Integrations</span><span class="card-sub">Connect the tools that keep Royal Car Service Center moving</span></div><button class="ghost-btn" data-integration-action="refresh">↻ Refresh statuses</button></div><div class="integration-grid">${integrations.map(x=>{ const configured = state.integrationStatus[x[0]]; const status = configured === false ? 'Not configured' : x[5]; const tone = configured === false ? 'orange' : x[6]; return `<div class="integration-card"><div class="integration-top"><div class="integration-icon ${tone}">${x[1]}</div><span class="status-pill ${tone}">${status}</span></div><b>${x[2]}</b><small>${x[3]}</small><p>${x[4]}</p><div class="integration-actions"><button class="ghost-btn" data-integration-action="test" data-integration-id="${x[0]}">Test connection</button><button class="secondary-btn" data-integration-action="connect" data-integration-id="${x[0]}">${status === 'Connected' ? 'Configure' : 'Connect'}</button></div></div>`; }).join('')}</div></section>`;
}

function customerView() {
  const tabContent = state.customerTab === 'history' ? customerHistoryView() : state.customerTab === 'payments' ? customerPaymentsView() : state.customerTab === 'chat' ? customerChatView() : customerOverviewView();
  return `${pageHeading('Your garage, in one place', 'Everything you need to stay on top of your car care.', '<button class="secondary-btn" data-customer-tab="overview">🚗 My vehicles</button><button class="primary-btn" data-modal="appointment">＋ Book a service</button>')}${customerTabs()}${tabContent}`;
}

function customerTabs() {
  return `<div class="customer-tabs"><button class="customer-tab ${state.customerTab==='overview'?'active':''}" data-customer-tab="overview">Overview</button><button class="customer-tab ${state.customerTab==='history'?'active':''}" data-customer-tab="history">Service history</button><button class="customer-tab ${state.customerTab==='payments'?'active':''}" data-customer-tab="payments">Invoices & payments</button><button class="customer-tab ${state.customerTab==='chat'?'active':''}" data-customer-tab="chat">Chat with GarageAI</button></div>`;
}

function customerOverviewView() {
  return `${state.bookingConfirmed ? '<div class="approval-banner success"><span>✓</span><div><b>Appointment confirmed</b><small>We’ll see you on September 14 at 10:00 AM. A reminder will be sent before your visit.</small></div><button data-customer-action="dismiss-booking">×</button></div>' : ''}
    <div class="customer-hero"><div><h1>Good morning, Priya <span style="color:var(--orange)">✦</span></h1><p>Your 2022 Kia Seltos is due for a tire rotation in about 500 km.</p></div><div class="hero-actions"><button class="secondary-btn" data-customer-tab="chat">Ask GarageAI</button><button class="primary-btn" data-modal="appointment">Book now</button></div></div>
    <div class="customer-grid"><div><section class="card"><div class="card-header"><div><span class="card-title">My vehicles</span><span class="card-sub">2 vehicles · service records always at hand</span></div><a class="card-link" data-modal="vehicle">＋ Add vehicle</a></div><div class="vehicle-list"><div class="vehicle-card active"><div class="vehicle-top"><div class="vehicle-illustration">🚙</div><div><b>2022 Kia Seltos HTX</b><span>KA 02 PJ 6510 · White</span></div></div><div class="customer-status"><span class="status-pill green">● No active service</span></div><div class="vehicle-meta"><span>Current mileage <strong>32,180 km</strong></span><span>Health <strong style="color:var(--green)">92/100</strong></span></div></div><div class="vehicle-card"><div class="vehicle-top"><div class="vehicle-illustration" style="background:var(--blue-soft)">🚗</div><div><b>2019 Honda City VX</b><span>KA 03 MK 8271 · Silver</span></div></div><div class="customer-status"><span class="status-pill blue">● Service completed</span></div><div class="vehicle-meta"><span>Current mileage <strong>58,420 km</strong></span><span>Health <strong style="color:var(--green)">87/100</strong></span></div></div></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Track your repair</span><span class="card-sub">Live updates from Royal Car Service Center</span></div><a class="card-link" data-customer-tab="history">View details →</a></div><div class="repair-progress"><div class="repair-banner"><div class="car-thumb">🚗</div><div><b>2019 Honda City VX · A/C service</b><span>WO-2026-0048 · Estimated ready today at 4:30 PM</span></div><a data-customer-action="open-estimate">${state.estimateStatus === 'approved' ? 'Approved' : '₹ 8,450'}</a></div><div class="stepper"><div class="step done"><div class="step-dot"></div>Checked in</div><div class="step done"><div class="step-dot"></div>Diagnosing</div><div class="step current"><div class="step-dot"></div>In progress</div><div class="step"><div class="step-dot"></div>Quality check</div><div class="step"><div class="step-dot"></div>Ready</div></div></div></section><section class="card section-gap estimate-card"><div class="card-header"><div><span class="card-title">${state.estimateStatus === 'approved' ? 'Estimate approved' : 'Estimate ready for approval'}</span><span class="card-sub">WO-2026-0048 · 2019 Honda City VX</span></div><span class="status-pill ${state.estimateStatus === 'approved' ? 'green' : 'orange'}">${state.estimateStatus === 'approved' ? 'Approved' : 'Action needed'}</span></div><div class="estimate-lines"><div class="estimate-line"><div><b>A/C inspection and refrigerant service</b><span>Parts and consumables</span></div><strong>₹ 5,850</strong></div><div class="estimate-line"><div><b>Labor · 2.5 hours</b><span>Diagnostics and repair labor</span></div><strong>₹ 2,000</strong></div><div class="estimate-total"><span>Estimated total including GST</span><b>₹ 8,450</b></div></div>${state.estimateStatus === 'approved' ? '<div class="estimate-approved">✓ You approved this estimate. The garage can continue with the repair.</div>' : '<div class="estimate-actions"><button class="secondary-btn" data-customer-action="decline-estimate">Decline</button><button class="primary-btn" data-customer-action="approve-estimate">Approve estimate · ₹ 8,450</button></div>'}</section></div><div><section class="card appointment-card"><div class="card-header"><div><span class="card-title">Upcoming appointment</span><span class="card-sub">We’ll send a reminder 24 hours before</span></div></div><div class="next-appt"><div class="date-tile"><small>Sep</small><b>14</b></div><div><b>Tire rotation + inspection</b><span>10:00 AM · Royal Car Service Center</span><a data-toast="Appointment reschedule opened">Reschedule · Cancel</a></div></div></section><section class="card notifications-card"><div class="card-header"><div><span class="card-title">Recent updates</span><span class="card-sub">You’re all caught up</span></div><span class="status-pill green">2 new</span></div><div class="notification-list"><div class="notification-item"><div class="notif-icon">✓</div><div><b>Your estimate is ready</b><span>A/C service estimate of ₹ 8,450 is waiting for your approval.</span></div></div><div class="notification-item"><div class="notif-icon" style="background:var(--blue-soft);color:var(--blue)">⌁</div><div><b>Maintenance reminder</b><span>Tire rotation recommended in about 500 km.</span></div></div><div class="notification-item"><div class="notif-icon" style="background:var(--purple-soft);color:var(--purple)">★</div><div><b>You earned 120 points</b><span>Your loyalty balance is now ₹ 240 in credit.</span></div></div></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Notification preferences</span><span class="card-sub">Choose how Royal Car Service Center reaches you</span></div></div><div class="preference-list"><div class="preference-row"><span>Repair status updates</span><button class="toggle on" data-toast="Preference saved"><i></i></button></div><div class="preference-row"><span>Appointment reminders</span><button class="toggle on" data-toast="Preference saved"><i></i></button></div><div class="preference-row"><span>Maintenance reminders</span><button class="toggle on" data-toast="Preference saved"><i></i></button></div></div></section></div></div><button class="customer-chat-fab" data-customer-tab="chat" aria-label="Chat with GarageAI">✦</button>`;
}

function customerHistoryView() {
  return `<div class="customer-section-head"><div><h2>Service history</h2><p>Digital records for your vehicles, all in one place.</p></div><button class="secondary-btn" data-toast="Full service report downloaded">⇩ Download report</button></div><div class="history-layout"><div><section class="card"><div class="card-header"><div><span class="card-title">2022 Kia Seltos HTX</span><span class="card-sub">KA 02 PJ 6510 · 32,180 km · Health score 92/100</span></div><span class="status-pill green">Healthy</span></div><div class="history-list"><div class="history-item"><div class="history-date"><b>18</b><span>Aug 2026</span></div><div class="history-icon">⚙</div><div class="history-copy"><b>Periodic maintenance</b><span>Engine oil, oil filter, tire pressure, multipoint inspection</span><small>Royal Car Service Center · ₹ 4,250</small></div><a data-toast="Service record opened">View</a></div><div class="history-item"><div class="history-date"><b>12</b><span>Feb 2026</span></div><div class="history-icon" style="background:var(--blue-soft);color:var(--blue)">◌</div><div class="history-copy"><b>Wheel alignment</b><span>Alignment corrected and road-tested</span><small>Royal Car Service Center · ₹ 1,600</small></div><a data-toast="Service record opened">View</a></div><div class="history-item"><div class="history-date"><b>05</b><span>Sep 2025</span></div><div class="history-icon" style="background:var(--green-soft);color:var(--green)">✓</div><div class="history-copy"><b>Annual inspection</b><span>All safety points passed</span><small>Royal Car Service Center · ₹ 850</small></div><a data-toast="Service record opened">View</a></div></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Upcoming maintenance</span><span class="card-sub">Based on your vehicle and service history</span></div></div><div class="maintenance-list"><div class="maintenance-row"><div class="maintenance-icon orange">◌</div><div><b>Tire rotation</b><span>Due in about 500 km · recommended with next visit</span></div><button class="secondary-btn" data-modal="appointment">Schedule</button></div><div class="maintenance-row"><div class="maintenance-icon green">⚙</div><div><b>Brake inspection</b><span>Due at 40,000 km · approximately 7,820 km remaining</span></div><button class="ghost-btn" data-toast="Added to maintenance reminders">Remind me</button></div><div class="maintenance-row"><div class="maintenance-icon blue">◫</div><div><b>Transmission fluid</b><span>Due at 60,000 km · approximately 27,820 km remaining</span></div><button class="ghost-btn" data-toast="Added to maintenance reminders">Remind me</button></div></div></section></div><section class="card health-card"><div class="card-header"><div><span class="card-title">Vehicle health</span><span class="card-sub">Last inspection: Aug 18, 2026</span></div></div><div class="health-score"><div class="health-ring"><b>92</b><span>/100</span></div><div><b>Looking good</b><p>Stay on schedule with the upcoming tire rotation.</p></div></div><div class="health-bars"><div><span>Engine</span><i><em style="width:95%"></em></i><b>95</b></div><div><span>Brakes</span><i><em style="width:90%"></em></i><b>90</b></div><div><span>Tyres</span><i><em style="width:84%;background:var(--orange)"></em></i><b>84</b></div><div><span>Electrical</span><i><em style="width:97%;background:var(--blue)"></em></i><b>97</b></div></div></section></div>`;
}

function customerPaymentsView() {
  return `<div class="customer-section-head"><div><h2>Invoices & payments</h2><p>Review estimates, pay securely, and download receipts.</p></div><span class="loyalty-badge">★ 240 points · ₹ 240 credit</span></div><div class="payments-layout"><div><section class="card"><div class="card-header"><div><span class="card-title">Invoices</span><span class="card-sub">Your recent garage payments</span></div><select class="filter-select"><option>All vehicles</option><option>Kia Seltos</option><option>Honda City</option></select></div><div class="invoice-list"><div class="invoice-item"><div class="invoice-mark purple">₹</div><div class="invoice-copy"><b>INV-2026-0138 · A/C service estimate</b><span>2019 Honda City VX · Sep 10, 2026</span></div><strong>₹ 8,450</strong><span class="status-pill ${state.estimateStatus === 'approved' ? 'green' : 'orange'}">${state.estimateStatus === 'approved' ? 'Approved' : 'Awaiting approval'}</span><button class="ghost-btn" data-customer-action="${state.estimateStatus === 'approved' ? 'pay-invoice' : 'open-estimate'}">${state.estimateStatus === 'approved' ? 'Pay now' : 'Review'}</button></div><div class="invoice-item"><div class="invoice-mark green">✓</div><div class="invoice-copy"><b>INV-2026-0104 · Periodic maintenance</b><span>2022 Kia Seltos HTX · Aug 18, 2026</span></div><strong>₹ 4,250</strong><span class="status-pill green">Paid</span><button class="ghost-btn" data-toast="Receipt downloaded">PDF</button></div><div class="invoice-item"><div class="invoice-mark blue">✓</div><div class="invoice-copy"><b>INV-2026-0041 · Wheel alignment</b><span>2022 Kia Seltos HTX · Feb 12, 2026</span></div><strong>₹ 1,600</strong><span class="status-pill green">Paid</span><button class="ghost-btn" data-toast="Receipt downloaded">PDF</button></div></div></section><section class="card section-gap"><div class="card-header"><div><span class="card-title">Spending summary</span><span class="card-sub">Your 2026 service activity</span></div></div><div class="spending-grid"><div><span>Total spent</span><b>₹ 12,900</b></div><div><span>Visits</span><b>3</b></div><div><span>Average visit</span><b>₹ 4,300</b></div></div></section></div><div><section class="card payment-method-card"><div class="card-header"><div><span class="card-title">Payment methods</span><span class="card-sub">Securely stored for faster checkout</span></div><button class="ghost-btn" data-toast="Add payment method opened">＋ Add</button></div><div class="payment-method"><div class="card-chip">▰</div><div><b>Visa ending 4532</b><span>Default · Expires 08/28</span></div><span class="status-pill green">Default</span></div><div class="payment-method"><div class="card-chip" style="background:var(--blue-soft);color:var(--blue)">UPI</div><div><b>priya@upi</b><span>Connected payment</span></div><button class="ghost-btn" data-toast="UPI selected">Use</button></div></section><section class="card section-gap side-stat"><h3>Need help with a payment?</h3><p>Our service advisor can explain any line item before you approve or pay.</p><button class="secondary-btn" data-customer-tab="chat" style="width:100%">Message the garage</button></section></div></div>`;
}

function customerChatView() {
  return `<div class="customer-section-head"><div><h2>Chat with GarageAI</h2><p>Ask questions in plain language or message the service team.</p></div><span class="status-pill green"><i class="status-dot green"></i>Online</span></div><div class="customer-chat-layout"><section class="card customer-chat-card"><div class="chat-header"><div class="ai-orb">✦</div><div><b>GarageAI Customer Assistant</b><span>● Friendly, clear, and here to help</span></div></div><div class="customer-chat-messages"><div class="message"><div class="mini-avatar">✦</div><div class="message-bubble">Hi Priya! I can help you understand your estimate, book a service, or explain what the technician found. What would you like to know?</div></div><div class="message user"><div class="mini-avatar">PM</div><div class="message-bubble">Can I approve only the A/C repair for now?</div></div><div class="message"><div class="mini-avatar">✦</div><div class="message-bubble">Yes. Your current estimate covers the A/C inspection and refrigerant service. You can approve the ₹ 8,450 estimate, and the garage will contact you before adding any work beyond it.</div></div></div><div class="chat-suggestions"><button class="suggestion" data-customer-action="open-estimate">Review my estimate</button><button class="suggestion" data-modal="appointment">Book an appointment</button><button class="suggestion" data-customer-tab="history">View service history</button></div><div class="chat-input-row"><input class="chat-input" placeholder="Ask a question..." /><button class="chat-send" data-toast="Message sent to the garage">↑</button></div></section><section class="card side-stat"><h3>Garage contact</h3><p>Royal Car Service Center<br>73, Dasarahalli Main Rd, Bengaluru</p><div class="preference-row"><span>WhatsApp</span><b>Available</b></div><div class="preference-row"><span>Phone</span><b>Open until 9:30 PM</b></div><button class="primary-btn" data-toast="Calling Royal Car Service Center" style="width:100%;margin-top:15px">☎ Call garage</button></section></div>`;
}

function openModal(type) {
  const configs = {
    'work-order': { title:'Create a work order', sub:'Check in a customer vehicle and start tracking the job.', body:`<div class="form-grid"><div class="form-group"><label>Customer</label><select class="form-select"><option>Choose a customer</option><option>Ananya Rao</option><option>Rohan Shah</option><option>Meera Nair</option><option>Walk-in customer</option></select></div><div class="form-group"><label>Vehicle</label><select class="form-select"><option>Choose a vehicle</option><option>2021 Honda City VX · KA 03 MK 8271</option><option>2018 Toyota Innova · KA 05 MC 2190</option></select></div><div class="form-group full"><label>Customer complaint</label><textarea class="form-textarea" placeholder="Describe the reported symptoms or requested service..."></textarea></div><div class="form-group"><label>Priority</label><select class="form-select"><option>Normal</option><option>High priority</option><option>Emergency / safety</option></select></div><div class="form-group"><label>Assign technician</label><select class="form-select"><option>Owner-managed</option><option>Advisor-managed</option><option>Workshop team</option></select></div></div>` },
    appointment: { title:'Book an appointment', sub:'Find a slot without overbooking your bays.', body:`<div class="form-grid"><div class="form-group"><label>Customer</label><select class="form-select"><option>Choose a customer</option><option>Priya Menon</option><option>Ananya Rao</option><option>New customer</option></select></div><div class="form-group"><label>Vehicle</label><select class="form-select"><option>2022 Kia Seltos HTX</option><option>2019 Honda City VX</option></select></div><div class="form-group"><label>Date</label><input class="form-input" type="date" value="2026-09-14" /></div><div class="form-group"><label>Time</label><select class="form-select"><option>10:00 AM · Available</option><option>10:30 AM · Available</option><option>11:00 AM · Available</option></select></div><div class="form-group full"><label>Service requested</label><select class="form-select"><option>Tire rotation + inspection</option><option>Oil change</option><option>Brake inspection</option><option>A/C service</option><option>Other</option></select></div></div>` },
    customer: { title:'Add a customer', sub:'Create a profile so every visit stays connected.', body:`<div class="form-grid"><div class="form-group"><label>Full name</label><input class="form-input" placeholder="e.g. Kavya Iyer" /></div><div class="form-group"><label>Phone number</label><input class="form-input" placeholder="+91 98765 43210" /></div><div class="form-group"><label>Email</label><input class="form-input" placeholder="name@email.com" /></div><div class="form-group"><label>Preferred contact</label><select class="form-select"><option>WhatsApp</option><option>SMS</option><option>Email</option><option>Phone call</option></select></div><div class="form-group full"><label>Address (optional)</label><input class="form-input" placeholder="Street, city, postcode" /></div></div>` },
    vehicle: { title:'Add a vehicle', sub:'VIN lookup can fill in the details automatically.', body:`<div class="form-grid"><div class="form-group"><label>Make</label><select class="form-select"><option>Kia</option><option>Honda</option><option>Toyota</option><option>Hyundai</option><option>Maruti Suzuki</option></select></div><div class="form-group"><label>Model</label><input class="form-input" value="Seltos" /></div><div class="form-group"><label>Year</label><input class="form-input" value="2022" /></div><div class="form-group"><label>License plate</label><input class="form-input" placeholder="KA 02 PJ 6510" /></div><div class="form-group"><label>VIN</label><input class="form-input" placeholder="Enter or scan VIN" /></div><div class="form-group"><label>Current mileage (km)</label><input class="form-input" placeholder="32,180" /></div></div>` },
    part: { title:'Add an inventory part', sub:'Keep your stock ledger accurate from day one.', body:`<div class="form-grid"><div class="form-group full"><label>Part name</label><input class="form-input" placeholder="e.g. Bosch front brake pads" /></div><div class="form-group"><label>Part number</label><input class="form-input" placeholder="BP-000-000" /></div><div class="form-group"><label>Supplier</label><select class="form-select"><option>MGP Auto Parts</option><option>Bosch</option><option>Boodmo</option></select></div><div class="form-group"><label>Quantity</label><input class="form-input" type="number" value="1" /></div><div class="form-group"><label>Minimum stock</label><input class="form-input" type="number" value="5" /></div></div>` },
    purchase: { title:'Create purchase order', sub:'Replenish low stock before it delays a repair.', body:`<div class="form-grid"><div class="form-group full"><label>Supplier</label><select class="form-select"><option>MGP Auto Parts</option><option>Bosch India</option><option>Boodmo</option></select></div><div class="form-group full"><label>Parts to reorder</label><select class="form-select"><option>Front brake pads · 8 sets recommended</option><option>5W-30 Synthetic oil · 24 litres recommended</option><option>Cabin air filter · 6 units recommended</option></select></div><div class="form-group"><label>Expected delivery</label><input class="form-input" type="date" value="2026-09-12" /></div><div class="form-group"><label>Notes</label><input class="form-input" placeholder="Optional note" /></div></div>` },
    message: { title:'Send a customer message', sub:'Use a clear template and keep the delivery in the communication log.', body:`<div class="form-grid"><div class="form-group"><label>Customer</label><select class="form-select"><option>Ananya Rao · +91 98765 20101</option><option>Rohan Shah · +91 98765 20102</option><option>Priya Menon · +91 98765 20105</option></select></div><div class="form-group"><label>Channel</label><select class="form-select"><option>WhatsApp</option><option>SMS</option></select></div><div class="form-group full"><label>Template</label><select class="form-select" id="messageTemplate"><option>Appointment reminder</option><option>Estimate approval</option><option>Ready for pickup</option><option>Maintenance reminder</option><option>Custom message</option></select></div><div class="form-group full"><label>Message</label><textarea class="form-textarea" id="messageBody">Reminder: your appointment at Royal Car Service Center is tomorrow at 10:00 AM.</textarea></div><div class="form-group full"><label class="consent-check"><input type="checkbox" checked /> Customer has opted in to service updates</label></div></div>` },
    vin: { title:'Decode a vehicle VIN', sub:'GarageAI will prefill the profile. Verify the result against OEM documentation.', body:`<div class="form-grid"><div class="form-group full"><label>VIN</label><input class="form-input" id="vinInput" placeholder="e.g. 4T1B11HK5KU812345" value="4T1B11HK5KU812345" /></div><div class="form-group full"><div class="vin-result" id="vinResult"><span class="status-dot gray"></span>Enter a VIN and run the decoder to preview vehicle details.</div></div></div>` },
    'stock-adjust': { title:'Adjust inventory stock', sub:'Record parts received, used, or corrected.', body:`<div class="form-grid"><div class="form-group full"><label>Part</label><select class="form-select"><option value="1">Front brake pads · BP-UNV-001 · 3 on hand</option><option value="2">5W-30 Synthetic oil · OL-5W30-01 · 6 on hand</option><option value="3">Cabin air filter · CF-HYU-004 · 2 on hand</option><option value="4">0W-20 Synthetic oil · OL-0W20-01 · 24 on hand</option></select></div><div class="form-group"><label>Movement</label><select class="form-select"><option value="add">Stock received (+)</option><option value="subtract">Part used (-)</option><option value="set">Set exact quantity</option></select></div><div class="form-group"><label>Quantity</label><input class="form-input" type="number" value="1" min="0" /></div><div class="form-group full"><label>Reason / reference</label><input class="form-input" placeholder="e.g. Used on WO-2026-0048" /></div></div>` },
    invoice: { title:'Create an invoice', sub:'Turn an approved estimate into an itemized invoice.', body:`<div class="form-grid"><div class="form-group"><label>Work order</label><select class="form-select"><option>WO-2026-0048 · Ananya Rao</option><option>WO-2026-0047 · Rohan Shah</option></select></div><div class="form-group"><label>Payment terms</label><select class="form-select"><option>Due on receipt</option><option>Due in 7 days</option><option>Due in 15 days</option></select></div><div class="form-group"><label>Parts subtotal</label><input class="form-input" value="₹ 5,850" /></div><div class="form-group"><label>Labor subtotal</label><input class="form-input" value="₹ 2,000" /></div><div class="form-group"><label>Tax rate</label><input class="form-input" value="18%" /></div><div class="form-group"><label>Discount</label><input class="form-input" value="₹ 0" /></div></div>` }
  };
  const config = configs[type];
  if (!config) return;
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><div class="modal-head"><div><h2>${config.title}</h2><p>${config.sub}</p></div><button class="close-modal" id="closeModal">×</button></div><div class="modal-body">${config.body}</div><div class="modal-footer"><button class="secondary-btn" id="cancelModal">Cancel</button><button class="primary-btn" id="saveModal">${type==='invoice'?'Create invoice':type==='purchase'?'Create purchase order':type==='message'?'Send message':'Save and continue'} <span>→</span></button></div></div></div>`;
  $('#closeModal').onclick = closeModal; $('#cancelModal').onclick = closeModal; $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  $('#saveModal').onclick = async () => {
    const selects = $$('.form-select', $('#modalRoot'));
    const inputs = $$('.form-input', $('#modalRoot'));
    const textarea = $('.form-textarea', $('#modalRoot'));
    let saved = false;
    if (type === 'work-order') {
      const customerLabel = selects[0]?.value || 'Walk-in customer';
      const vehicleLabel = selects[1]?.value || '';
      const result = await postJson('/api/work-orders', {
        customer_name: customerLabel.startsWith('Choose') ? 'Walk-in customer' : customerLabel,
        vehicle_label: vehicleLabel,
        complaint: textarea?.value || 'General service',
        priority: selects[2]?.value?.includes('Emergency') ? 'Emergency' : selects[2]?.value?.includes('High') ? 'High' : 'Normal'
      });
      if (result?.id) { state.workOrders.unshift(result); state.apiReady = true; saved = true; }
    } else if (type === 'appointment') {
      const date = inputs.find(x => x.type === 'date')?.value || '2026-09-14';
      const time = selects[2]?.value?.split(' · ')[0] || '10:00 AM';
      const service = selects[3]?.value || 'General service';
      const result = await postJson('/api/appointments', { service_type: service, appointment_date: date, appointment_time: time, notes: 'Booked from GarageAI' });
      if (result?.id) state.appointments.push(result);
      saved = Boolean(result?.id);
    } else if (type === 'customer') {
      const values = inputs.map(x => x.value);
      const result = await postJson('/api/customers', { name: values[0], phone: values[1], email: values[2], preferred_contact: selects[0]?.value || 'WhatsApp' });
      saved = Boolean(result?.id);
    } else if (type === 'part') {
      const values = inputs.map(x => x.value);
      const result = await postJson('/api/inventory', { name: values[0], part_number: values[1], supplier: selects[0]?.value || '', quantity: Number(values[2] || 0), min_stock: Number(values[3] || 0) });
      saved = Boolean(result?.id);
    } else if (type === 'message') {
      const customer = selects[0]?.value || 'Ananya Rao · +91 98765 20101';
      const channel = selects[1]?.value || 'WhatsApp';
      const recipient = customer.match(/\+\d[\d ]+/)?.[0]?.replace(/\s/g, '') || '+919876520101';
      const result = await postJson('/api/notifications/send', { type: $('#messageTemplate')?.value || 'Customer update', channel, recipient, message: $('#messageBody')?.value || '', opted_in: $('.consent-check input')?.checked !== false });
      saved = Boolean(result?.notification);
    } else if (type === 'vin') {
      const result = await postJson('/api/vehicle/decode', { vin: $('#vinInput')?.value || '' });
      saved = Boolean(result?.decoded);
      if (saved) {
        const decoded = result.decoded;
        showToast(`${decoded.year || 'Vehicle'} ${decoded.make} ${decoded.model} decoded — verify before saving`);
      }
    } else if (type === 'stock-adjust') {
      const partId = selects[0]?.value || '1';
      const movement = selects[1]?.value || 'add';
      const quantity = Number(inputs[0]?.value || 0);
      const delta = movement === 'subtract' ? -quantity : movement === 'set' ? quantity : quantity;
      const result = await patchJson(`/api/inventory/${partId}`, movement === 'set' ? { quantity } : { quantity_delta: delta, reason: inputs[1]?.value || '' });
      saved = Boolean(result?.id);
    } else if (type === 'invoice') {
      const values = inputs.map(x => x.value);
      const parseMoney = value => Number(String(value || '0').replace(/[^0-9.]/g, '')) || 0;
      const subtotal = parseMoney(values[0]) + parseMoney(values[1]);
      const tax = subtotal * 0.18;
      const result = await postJson('/api/invoices', { work_order_id: selects[0]?.value?.split(' · ')[0], subtotal, tax, total: subtotal + tax, status: 'Draft' });
      saved = Boolean(result?.id);
    }
    closeModal();
    if (type === 'appointment' && saved) state.bookingConfirmed = true;
    showToast(saved ? (type === 'appointment' ? 'Appointment booked successfully' : type === 'work-order' ? 'Work order created and saved' : 'Saved successfully') : 'Saved in demo mode');
    if (type === 'work-order' || type === 'appointment') render();
  };
}
async function apiRequest(path, options = {}) {
  if (state.offlineDemo) throw new Error('Offline demo mode');
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
  if (state.session?.token) headers.Authorization = `Bearer ${state.session.token}`;
  const response = await fetch(path, { ...options, headers });
  return response;
}
async function postJson(path, body) {
  try {
    const response = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
    return response.ok ? await response.json() : null;
  } catch (error) {
    state.apiReady = false;
    return null;
  }
}
async function patchJson(path, body) {
  try {
    const response = await apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) });
    return response.ok ? await response.json() : null;
  } catch (error) {
    state.apiReady = false;
    return null;
  }
}
async function loadApiData() {
  try {
    const [workOrdersResponse, appointmentsResponse, inventoryResponse, invoicesResponse, customersResponse, configResponse, financialResponse, notificationsResponse, notificationMetricsResponse, marketingPostsResponse, marketingStatusResponse] = await Promise.all([
      apiRequest('/api/work-orders'), apiRequest('/api/appointments'), apiRequest('/api/inventory'), apiRequest('/api/invoices'), apiRequest('/api/customers'), apiRequest('/api/config/status'), apiRequest('/api/reports/financial'), apiRequest('/api/notifications'), apiRequest('/api/notifications/metrics'), apiRequest('/api/marketing/posts'), apiRequest('/api/marketing/status')
    ]);
    const workOrders = workOrdersResponse.ok ? await workOrdersResponse.json() : [];
    const appointments = appointmentsResponse.ok ? await appointmentsResponse.json() : [];
    const inventory = inventoryResponse.ok ? await inventoryResponse.json() : [];
    const invoices = invoicesResponse.ok ? await invoicesResponse.json() : [];
    const customers = customersResponse.ok ? await customersResponse.json() : [];
    const config = configResponse.ok ? await configResponse.json() : null;
    const financial = financialResponse.ok ? await financialResponse.json() : null;
    const notifications = notificationsResponse.ok ? await notificationsResponse.json() : [];
    const notificationMetrics = notificationMetricsResponse.ok ? await notificationMetricsResponse.json() : null;
    const marketingPosts = marketingPostsResponse.ok ? await marketingPostsResponse.json() : [];
    const marketingStatus = marketingStatusResponse.ok ? await marketingStatusResponse.json() : null;
    if (Array.isArray(workOrders)) state.workOrders = workOrders;
    if (Array.isArray(appointments)) state.appointments = appointments;
    if (Array.isArray(inventory)) state.inventory = inventory;
    if (Array.isArray(invoices)) state.invoices = invoices;
    if (Array.isArray(customers)) state.customers = customers;
    if (config?.integrations) state.integrationStatus = config.integrations;
    if (config?.environment) state.environment = config.environment;
    if (financial) state.financialReport = financial;
    if (Array.isArray(notifications)) state.notifications = notifications;
    if (notificationMetrics) state.notificationMetrics = notificationMetrics;
    if (Array.isArray(marketingPosts) && marketingPosts.length) state.marketingPosts = marketingPosts;
    if (marketingStatus?.connected) state.marketingStatus = marketingStatus.connected;
    state.apiReady = true;
    render();
  } catch (error) {
    state.apiReady = false;
  }
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
function showToast(text) { const root = $('#toastRoot'); const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = `<i>✓</i><span>${text}</span>`; root.appendChild(el); setTimeout(() => el.remove(), 3000); }
function openWorkOrder(id) {
  const wo = state.workOrders.find(x => x.id === id);
  if (!wo) return;
  const statuses = ['Received', 'Diagnosing', 'Awaiting parts', 'In progress', 'Quality check', 'Ready for pickup', 'Completed'];
  const mechanics = ['Unassigned', 'Workshop team'];
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><div class="modal-head"><div><h2>${wo.id} · ${wo.issue}</h2><p>${wo.customer} · ${wo.vehicle} · ${wo.plate}</p></div><button class="close-modal" id="closeModal">×</button></div><div class="modal-body"><div class="repair-banner" style="margin:0 0 14px"><div class="car-thumb">🚗</div><div><b>Status: ${wo.status}</b><span>${wo.mechanic} · ${wo.eta}</span></div><span class="status-pill ${statusTone(wo.status)}">${wo.total}</span></div><div class="form-grid"><div class="form-group"><label>Work order status</label><select class="form-select" id="woStatus">${statuses.map(x=>`<option ${x===wo.status?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-group"><label>Priority</label><select class="form-select" id="woPriority"><option ${wo.priority==='Normal'?'selected':''}>Normal</option><option ${wo.priority==='High'?'selected':''}>High</option><option ${wo.priority==='Emergency'?'selected':''}>Emergency</option></select></div><div class="form-group"><label>Assigned technician</label><select class="form-select" id="woMechanic">${mechanics.map(x=>`<option ${x===wo.mechanic || (x==='Unassigned' && wo.mechanic==='Unassigned')?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-group"><label>Service bay</label><select class="form-select" id="woBay"><option value="">Unassigned</option><option value="1" ${wo.bay==1?'selected':''}>Bay 1</option><option value="2" ${wo.bay==2?'selected':''}>Bay 2</option><option value="3" ${wo.bay==3?'selected':''}>Bay 3</option><option value="4" ${wo.bay==4?'selected':''}>Bay 4</option></select></div><div class="form-group full"><label>Diagnostic notes</label><textarea class="form-textarea" id="woDiagnosis">${wo.diagnosis || `Customer reports: ${wo.issue}. Initial inspection pending technician notes.`}</textarea></div><div class="form-group full"><label>Photo documentation</label><div class="photo-upload-row"><input class="form-input" id="woPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" /><input class="form-input" id="woPhotoNote" placeholder="Photo note, e.g. worn brake pad" /></div><div class="media-grid" id="woMediaList"><span class="media-empty">Loading photos…</span></div><small class="field-hint">Photos are stored with the work order and can be shared with the customer.</small></div></div></div><div class="modal-footer"><button class="secondary-btn" id="sendWorkOrderUpdate">Send customer update</button><button class="primary-btn" id="saveWorkOrder">Save changes <span>→</span></button></div></div></div>`;
  $('#closeModal').onclick = closeModal;
  $('#sendWorkOrderUpdate').onclick = async () => {
    const result = await postJson('/api/notifications/send', { type: 'Repair update', channel: 'WhatsApp', recipient: '+91 98765 20101', work_order_id: id, message: `${wo.vehicle} update: ${$('#woStatus').value}. Photos and notes are available in your repair tracker.` });
    showToast(result?.delivery?.sent ? 'Customer update sent on WhatsApp' : 'Customer update queued — connect WhatsApp to deliver');
  };
  $('#woPhotoInput').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = await postJson(`/api/work-orders/${id}/media`, { filename: file.name, mime_type: file.type, data_url: reader.result, note: $('#woPhotoNote').value });
      if (result?.id) { showToast('Photo attached to work order'); loadWorkOrderMedia(id); } else showToast('Photo could not be uploaded');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  };
  loadWorkOrderMedia(id);
  $('#saveWorkOrder').onclick = async () => {
    const payload = { status: $('#woStatus').value, priority: $('#woPriority').value, employee_name: $('#woMechanic').value, bay_number: $('#woBay').value ? Number($('#woBay').value) : null, diagnosis: $('#woDiagnosis').value };
    const result = await patchJson(`/api/work-orders/${id}`, payload);
    if (result?.id) {
      const index = state.workOrders.findIndex(x => x.id === id);
      if (index >= 0) state.workOrders[index] = result;
      closeModal(); render(); showToast(`${id} updated successfully`);
    } else {
      closeModal(); showToast('Saved in demo mode');
    }
  };
  $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
}

async function loadWorkOrderMedia(id) {
  try {
    const response = await apiRequest(`/api/work-orders/${id}/media`);
    const media = response.ok ? await response.json() : [];
    const target = $('#woMediaList');
    if (!target) return;
    target.innerHTML = media.length ? media.map(item => `<div class="media-item"><img src="${item.url}" alt="${item.note || 'Work order photo'}" /><span>${item.note || 'Workshop photo'}</span></div>`).join('') : '<span class="media-empty">No photos attached yet.</span>';
  } catch (error) { /* modal remains usable in demo mode */ }
}

function bindEvents() {
  $$('.nav-item').forEach(btn => btn.onclick = () => { state.view = btn.dataset.view; state.mode = 'pro'; $$('.nav-item').forEach(b=>b.classList.toggle('active', b===btn)); closeMobile(); render(); });
  $$('[data-view]').forEach(btn => btn.onclick = (e) => { e.preventDefault(); state.view = btn.dataset.view; state.mode = 'pro'; closeMobile(); render(); });
  $$('[data-customer-tab]').forEach(btn => btn.onclick = (e) => { e.preventDefault(); state.mode = 'customer'; state.customerTab = btn.dataset.customerTab; render(); });
  $$('[data-customer-action]').forEach(btn => btn.onclick = async (e) => {
    e.preventDefault();
    const action = btn.dataset.customerAction;
    if (action === 'approve-estimate') {
      state.estimateStatus = 'approved';
      try { await postJson('/api/estimates/WO-2026-0048/approve', { approved: true, approved_by: 'Priya Menon' }); } catch (error) { /* demo mode fallback */ }
      render();
      showToast('Estimate approved — the garage has been notified');
    } else if (action === 'decline-estimate') {
      showToast('The service advisor will contact you to discuss the estimate');
    } else if (action === 'dismiss-booking') {
      state.bookingConfirmed = false;
      render();
    } else if (action === 'open-estimate') {
      state.customerTab = 'payments';
      render();
      showToast('Estimate opened');
    } else if (action === 'pay-invoice') {
      const result = await postJson('/api/payments/checkout', { invoice_id: 'INV-2026-0138', amount: 8450, description: 'A/C service · 2019 Honda City VX' });
      if (result?.ready && result.checkout_url) {
        window.open(result.checkout_url, '_blank', 'noopener');
        showToast(`${result.provider} checkout opened`);
      } else if (result?.ready) {
        showToast(`${result.provider} payment order created`);
      } else {
        showToast('Payment provider credentials are not configured yet');
      }
    }
  });
  $$('[data-mode]').forEach(btn => btn.onclick = () => { state.mode = btn.dataset.mode; if (state.mode === 'customer') state.view = 'overview'; $$('.view-option').forEach(b=>b.classList.toggle('active', b.dataset.mode===state.mode)); render(); });
  $$('[data-modal]').forEach(btn => btn.onclick = () => openModal(btn.dataset.modal));
  $$('[data-toast]').forEach(btn => btn.onclick = () => showToast(btn.dataset.toast));
  $$('[data-invoice-action]').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const result = await patchJson(`/api/invoices/${btn.dataset.invoiceId}`, { status: 'Paid', payment_method: 'Card' });
    showToast(result ? `${btn.dataset.invoiceId} marked as paid` : 'Payment recorded in demo mode');
  });
  $$('[data-marketing-action]').forEach(btn => btn.onclick = async (e) => {
    e.preventDefault();
    const action = btn.dataset.marketingAction;
    if (action === 'generate') {
      const sourceFiles = [...($('#marketingSourceMedia')?.files || [])];
      if (sourceFiles.length && !$('#marketingConsent')?.checked) {
        showToast('Confirm customer photo/video consent before using source media');
        return;
      }
      const packageTarget = $('#generatedMarketingContent');
      if (packageTarget) packageTarget.innerHTML = '<div class="generated-placeholder"><span>✦</span><b>Creating your content package…</b><small>Drafting hook, caption, voiceover, and shot list.</small></div>';
      const result = await postJson('/api/marketing/generate', { topic: $('#marketingTopic')?.value || 'Brake safety tips', format: $('#marketingFormat')?.value || 'Instagram Reel', language: $('#marketingLanguage')?.value || 'English', cta: $('#marketingCta')?.value || 'Book an inspection', source_media: sourceFiles.map(file => file.name), media_consent_confirmed: Boolean(sourceFiles.length) });
      const pkg = result?.package || { title: $('#marketingTopic')?.value || 'Brake safety tips', hook: 'Before you drive again, check these 3 things.', voiceover: 'A draft voiceover will be created when the AI provider is connected.', caption: 'Useful advice from your local workshop. Owner review required before publishing.', hashtags: '#BengaluruCars #AutoCare #CarMaintenance', shot_list: ['Show the workshop and technician', 'Capture the inspection close-up', 'End with the booking CTA'], language: 'English', format: $('#marketingFormat')?.value || 'Instagram Reel' };
      if (packageTarget) packageTarget.innerHTML = `<div class="generated-package"><h3>${escapeHtml(pkg.title)} <span class="status-pill purple">Draft</span></h3><p><b>Hook:</b> ${escapeHtml(pkg.hook)}</p><p><b>Voiceover:</b> ${escapeHtml(pkg.voiceover)}</p><p><b>Caption:</b> ${escapeHtml(pkg.caption)}</p><p><b>Shot list:</b> ${pkg.shot_list.map(escapeHtml).join(' · ')}</p><div class="generated-tags">${escapeHtml(pkg.hashtags)} · ${escapeHtml(pkg.language)} · ${escapeHtml(pkg.format)}</div><div class="generated-actions"><button class="secondary-btn" data-toast="Draft saved to the approval queue">Save draft</button><button class="primary-btn" data-toast="Owner approval is required before publishing">Send for approval →</button></div></div>`;
      showToast(result ? 'Content package drafted — review before publishing' : 'Content package preview created in demo mode');
      $$('[data-toast]').forEach(x => x.onclick = () => showToast(x.dataset.toast));
    } else if (action === 'connect') {
      const results = await Promise.all(['instagram', 'facebook', 'youtube'].map(account => postJson('/api/marketing/connect', { account })));
      const setup = results.some(result => result?.status === 'needs_credentials') || !results.some(Boolean);
      showToast(setup ? 'Account setup requires Meta or Google OAuth credentials' : 'Publishing accounts connected');
      if (!setup) loadApiData();
    } else if (action === 'approve') {
      const result = await postJson(`/api/marketing/posts/${btn.dataset.postId}/approve`, {});
      showToast(result?.status === 'Approved' ? 'Approved and ready for scheduling' : 'Approval saved in demo mode');
      if (result) loadApiData();
    } else if (action === 'preview') {
      showToast('Preview opened — publishing remains behind the approval guardrail');
    } else if (action === 'refresh') {
      loadApiData();
      showToast('Marketing queue refreshed');
    }
  });
  $$('[data-notification-action]').forEach(btn => btn.onclick = async (e) => {
    e.preventDefault();
    const action = btn.dataset.notificationAction;
    if (action === 'run') {
      const result = await postJson('/api/notifications/run-scheduler', {});
      showToast(result ? `${result.processed} notifications processed` : 'Scheduler run queued in demo mode');
      if (result) loadApiData();
    } else if (action === 'queue') {
      const result = await postJson('/api/notifications/queue', { type: 'Customer update', channel: 'WhatsApp', recipient: '+91 98765 20101', message: 'Your Royal Car Service Center update is ready.' });
      showToast(result ? 'Message queued for delivery' : 'Message saved in demo mode');
      if (result) loadApiData();
    } else if (action === 'retry') {
      const result = await postJson(`/api/notifications/retry/${btn.dataset.notificationId}`, {});
      showToast(result?.notification?.status === 'Sent' ? 'Message delivered' : 'Retry recorded; provider still needs attention');
      if (result) loadApiData();
    } else if (action === 'refresh') {
      loadApiData();
      showToast('Communication queue refreshed');
    }
  });
  $$('[data-notification-template]').forEach(btn => btn.onclick = async () => {
    const templates = {
      appointment: ['Appointment reminder', 'Reminder: your appointment at Royal Car Service Center is tomorrow at 10:00 AM.'],
      estimate: ['Estimate approval', 'Your repair estimate is ready. Review and approve it securely in GarageAI.'],
      pickup: ['Ready for pickup', 'Your vehicle has passed quality check and is ready for pickup.'],
      maintenance: ['Maintenance reminder', 'Your vehicle is due for scheduled maintenance. Book a convenient time with us.']
    };
    const template = templates[btn.dataset.notificationTemplate];
    const result = await postJson('/api/notifications/queue', { type: template[0], channel: 'WhatsApp', recipient: '+91 98765 20101', message: template[1] });
    showToast(result ? `${template[0]} queued` : 'Template saved in demo mode');
    if (result) loadApiData();
  });
  $$('[data-report-action]').forEach(btn => btn.onclick = async (e) => {
    e.preventDefault();
    if (btn.dataset.reportAction === 'close-day') {
      const result = await postJson('/api/reports/close-day', {});
      showToast(result?.status === 'closed' ? 'End-of-day report recorded' : 'Report prepared in demo mode');
    }
  });
  $$('[data-integration-action]').forEach(btn => btn.onclick = async (e) => {
    e.preventDefault();
    const action = btn.dataset.integrationAction;
    if (action === 'test') {
      const result = await postJson('/api/integrations/test', { integration_id: btn.dataset.integrationId });
      showToast(result?.ok ? `${btn.dataset.integrationId} connection passed` : `${btn.dataset.integrationId} needs provider credentials`);
    } else if (action === 'connect') {
      const result = await postJson('/api/integrations/connect', { integration_id: btn.dataset.integrationId });
      showToast(result ? `${btn.dataset.integrationId} connector ready` : 'Connector saved in demo mode');
    } else if (action === 'send-test-message') {
      const result = await postJson('/api/notifications/send', { channel: 'WhatsApp', recipient: 'owner', message: 'GarageAI test message' });
      showToast(result?.queued ? 'Test message queued successfully' : 'Test message prepared in demo mode');
    } else if (action === 'export-accounting') {
      const result = await postJson('/api/accounting/export', { type: 'invoices' });
      if (result?.csv) {
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = result.filename || 'garageai_export.csv'; link.click();
        URL.revokeObjectURL(url);
        showToast(`${result.record_count} records exported as CSV`);
      } else showToast('Export prepared in demo mode');
    } else {
      showToast('Integration statuses refreshed');
    }
  });
  $$('[data-settings-action]').forEach(btn => btn.onclick = () => showToast({ 'edit-profile': 'Profile editor opened', 'save-profile': 'Garage profile saved', invite: 'Team invite dialog opened', backup: 'Backup job started' }[btn.dataset.settingsAction] || 'Settings saved'));
  $$('[data-settings-toggle]').forEach(btn => btn.onclick = () => { btn.classList.toggle('on'); showToast('Notification preference saved'); });
  $$('[data-wo]').forEach(row => row.onclick = () => openWorkOrder(row.dataset.wo));
  $('#mobileMenu')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#searchBtn')?.addEventListener('click', () => { if (state.view !== 'work-orders') { state.view = 'work-orders'; state.mode='pro'; render(); setTimeout(()=>$('#woSearch')?.focus(), 50); } else { $('#woSearch')?.focus(); } });
  $('#notificationBtn')?.addEventListener('click', () => showToast('You have 4 alerts requiring attention'));
  $('#userCard')?.addEventListener('click', () => logout());
  $('.top-avatar')?.addEventListener('click', () => logout());
  $('#woSearch')?.addEventListener('input', e => { state.search=e.target.value; render(); setTimeout(()=>{ const input=$('#woSearch'); if(input){input.focus();input.setSelectionRange(state.search.length,state.search.length);}},0); });
  $('#woFilter')?.addEventListener('change', e => { state.workFilter=e.target.value; render(); setTimeout(()=>$('#woFilter').value=state.workFilter,0); });
  $('#boardToggle')?.addEventListener('click', () => { const k=$('#kanbanSection'); k.style.display=k.style.display==='none'?'block':'none'; });
  $$('.suggestion, .tool-item').forEach(btn => btn.onclick = () => sendChat(btn.dataset.prompt));
  $('#chatSend')?.addEventListener('click', () => sendChat($('#chatInput').value));
  $('#chatInput')?.addEventListener('keydown', e => { if(e.key==='Enter') sendChat(e.target.value); });
}
function sendChat(text) {
  text = (text || '').trim(); if (!text) return;
  state.chat.push({who:'user', text: escapeHtml(text)});
  const lower = text.toLowerCase();
  let response = 'I can help with that. Start with a visual inspection, record the measured values in the work order, and verify against the vehicle’s OEM service information before authorizing a repair.';
  if (lower.includes('p0301') || lower.includes('misfire')) response = '<strong>DTC P0301 · Cylinder 1 misfire</strong><br>Recommended sequence:<ul><li>Check spark plug condition and gap; swap with another cylinder to see if the fault follows.</li><li>Swap the ignition coil and inspect the connector for corrosion or poor pin fit.</li><li>Verify injector pulse and resistance, then check compression and intake leaks.</li></ul><span style="color:var(--red);font-weight:700">Do not release the vehicle until the misfire is resolved and a road test confirms it.</span>';
  else if (lower.includes('oil capacity') || lower.includes('cr-v')) response = '<strong>2021 Honda CR-V 1.5L turbo</strong><br>Use the exact engine and market configuration to confirm capacity in OEM documentation. As a starting reference, many 1.5L turbo variants use about 3.5 L with filter change. Fill gradually and verify at the dipstick — do not rely on capacity alone.';
  else if (lower.includes('brake') || lower.includes('grinding')) response = '<strong>Brake inspection checklist</strong><br>Flag as <span style="color:var(--red);font-weight:700">high priority</span>. Measure pad thickness at all corners, inspect rotors for scoring and minimum thickness, check caliper slides and brake fluid, then perform a controlled road test. Advise the customer not to drive if braking performance is reduced.';
  else if (lower.includes('part')) response = 'I found 3 matching part categories in the live inventory. Front brake pads are low at 3 sets, while the Toyota cabin filter has 2 units. Open Inventory to compare suppliers or create a purchase order.';
  setTimeout(() => { state.chat.push({who:'ai', text:response}); render(); setTimeout(()=>$('#chatMessages')?.scrollTo(0, 9999),30); }, 380);
  render(); setTimeout(()=>$('#chatMessages')?.scrollTo(0, 9999),30);
}
function escapeHtml(str) { return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function closeMobile() { $('#sidebar')?.classList.remove('open'); }

render();
