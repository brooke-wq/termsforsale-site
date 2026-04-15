/* =========================================================
   Dispo Buddy — Admin Shell JS
   Shared sidebar, auth gate, toast, helpers for /admin/*
   Ports the Terms For Sale pattern with DB-specific nav.
   ========================================================= */

(function () {
  'use strict';

  var PW_KEY = 'db_admin_pw';

  function getPw() {
    try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
  }
  function setPw(v) {
    try { sessionStorage.setItem(PW_KEY, v); } catch (e) {}
  }
  function clearPw() {
    try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
  }

  function renderShell(active) {
    var nav = [
      {
        label: 'Overview',
        items: [
          { key: 'dashboard', href: '/admin/', label: 'Dashboard', icon: 'grid' }
        ]
      },
      {
        label: 'Operations',
        items: [
          { key: 'deals',        href: '/admin/deals.html',        label: 'JV Deals',     icon: 'home' },
          { key: 'partners',     href: '/admin/partners.html',     label: 'Partners',     icon: 'users' },
          { key: 'underwriting', href: '/admin/underwriting.html', label: 'Underwriting', icon: 'target' },
          { key: 'messages',     href: '/admin/messages.html',     label: 'Messages',     icon: 'mailbox' }
        ]
      },
      {
        label: 'System',
        items: [
          { key: 'sop', href: '/admin/sop.html', label: 'Operations SOP', icon: 'book' }
        ]
      },
      {
        label: 'External',
        items: [
          { href: 'https://app.gohighlevel.com/', label: 'GoHighLevel', icon: 'link', ext: true },
          { href: 'https://www.notion.so/a3c0a38fd9294d758dedabab2548ff29', label: 'Notion Deal DB', icon: 'link', ext: true },
          { href: 'https://app.netlify.com/sites/dispobuddy/deploys', label: 'Netlify Deploys', icon: 'link', ext: true },
          { href: 'https://dispobuddy.com/', label: 'Public Site', icon: 'link', ext: true }
        ]
      }
    ];

    var navHtml = nav.map(function (g) {
      var items = g.items.map(function (it) {
        var cls = 'sb-link' + (it.key && it.key === active ? ' active' : '');
        var target = it.ext ? ' target="_blank" rel="noopener"' : '';
        var trailing = it.ext
          ? '<svg class="sb-ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>'
          : (it.badgeId ? '<span class="sb-badge" id="' + it.badgeId + '">·</span>' : '');
        return '<a href="' + it.href + '" class="' + cls + '"' + target + '>' +
          icon(it.icon) +
          '<span>' + it.label + '</span>' +
          trailing +
          '</a>';
      }).join('');
      return '<div class="sb-group">' +
        '<div class="sb-group-label">' + g.label + '</div>' +
        items +
        '</div>';
    }).join('');

    var shell =
      '<button class="sb-mobile-toggle" id="sb-toggle" aria-label="Toggle menu">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>' +
      '</button>' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="sb-brand">' +
          '<div class="sb-brand-mark">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>' +
          '</div>' +
          '<div class="sb-brand-text">' +
            '<div class="sb-brand-name">Dispo Buddy</div>' +
            '<div class="sb-brand-sub">Admin Console</div>' +
          '</div>' +
        '</div>' +
        '<div class="sb-env" title="Connected to production GHL + Notion">Live · Production</div>' +
        '<nav class="sb-nav">' + navHtml + '</nav>' +
        '<div class="sb-footer">' +
          '<strong>Dispo Buddy</strong><br>' +
          'Deal Pros LLC · JV Pipeline<br>' +
          '<button class="sb-logout" onclick="AdminShell.logout()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
            'Sign out' +
          '</button>' +
        '</div>' +
      '</aside>' +
      '<div class="sb-overlay" id="sb-overlay"></div>';

    var host = document.querySelector('.admin-shell');
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = shell;
    var main = host.querySelector('.main');
    while (wrap.firstChild) {
      if (main) host.insertBefore(wrap.firstChild, main);
      else host.appendChild(wrap.firstChild);
    }

    var toggle = document.getElementById('sb-toggle');
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sb-overlay');
    if (toggle && sidebar && overlay) {
      toggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
      });
      overlay.addEventListener('click', function () {
        sidebar.classList.remove('open');
      });
    }
  }

  function icon(name) {
    var paths = {
      grid:    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      home:    '<path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      users:   '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      target:  '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
      mailbox: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
      edit:    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
      book:    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
      link:    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
    };
    return '<svg viewBox="0 0 24 24">' + (paths[name] || paths.grid) + '</svg>';
  }

  var GATE_HTML =
    '<div id="gate" class="gate">' +
      '<div class="gate-card">' +
        '<div class="gate-logo">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
        '</div>' +
        '<h2>Dispo Buddy Admin</h2>' +
        '<div class="gate-sub">Restricted Access</div>' +
        '<div id="gate-err" class="gate-err"></div>' +
        '<input type="password" id="gate-pw" placeholder="Admin password" autocomplete="current-password">' +
        '<button id="gate-btn">Unlock Dashboard</button>' +
      '</div>' +
    '</div>';

  function showGateErr(msg) {
    var el = document.getElementById('gate-err');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
  }

  async function verify(pw) {
    var res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    var data = await res.json().catch(function () { return {}; });
    return res.ok && data.ok;
  }

  async function mountGate(onUnlock) {
    document.body.classList.add('locked');
    var host = document.createElement('div');
    host.innerHTML = GATE_HTML;
    document.body.appendChild(host.firstChild);

    var pwInput = document.getElementById('gate-pw');
    var btn = document.getElementById('gate-btn');

    async function attempt() {
      var pw = pwInput.value.trim();
      if (!pw) { showGateErr('Enter the password'); return; }
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      try {
        var ok = await verify(pw);
        if (!ok) {
          showGateErr('Invalid password');
          btn.disabled = false;
          btn.textContent = 'Unlock Dashboard';
          return;
        }
        setPw(pw);
        var gate = document.getElementById('gate');
        if (gate) gate.remove();
        document.body.classList.remove('locked');
        if (onUnlock) onUnlock();
      } catch (err) {
        showGateErr('Network error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Unlock Dashboard';
      }
    }

    btn.addEventListener('click', attempt);
    pwInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') attempt();
    });
    setTimeout(function () { pwInput.focus(); }, 50);
  }

  function requireAuth(onReady) {
    var pw = getPw();
    if (pw) {
      document.body.classList.remove('locked');
      if (onReady) onReady();
      return;
    }
    mountGate(onReady || function () { location.reload(); });
  }

  function logout() {
    clearPw();
    location.href = '/admin/';
  }

  async function adminFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers['X-Admin-Password'] = getPw();
    var res = await fetch(url, opts);
    if (res.status === 401) {
      clearPw();
      toast('Session expired — please sign in');
      setTimeout(function () { location.reload(); }, 900);
    }
    return res;
  }

  function toast(msg, ms) {
    var el = document.getElementById('admin-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'admin-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, ms || 1800);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    var num = Number(n);
    if (!num || isNaN(num)) return '—';
    return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fmtNum(n) {
    var num = Number(n);
    if (isNaN(num)) return '—';
    return num.toLocaleString('en-US');
  }
  function fmtDate(d) {
    if (!d) return '—';
    try {
      var dt = new Date(d);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return String(d); }
  }
  function copy(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () { toast('Copied: ' + text); });
  }

  window.AdminShell = {
    renderShell: renderShell,
    requireAuth: requireAuth,
    logout: logout,
    fetch: adminFetch,
    toast: toast,
    esc: esc,
    fmtMoney: fmtMoney,
    fmtNum: fmtNum,
    fmtDate: fmtDate,
    copy: copy,
    getPw: getPw
  };
})();
