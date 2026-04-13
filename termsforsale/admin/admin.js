/* =========================================================
   Terms For Sale — Admin Shell JS
   Shared sidebar, auth gate, toast, helpers for /admin/*
   ========================================================= */

(function () {
  'use strict';

  // ─── Shared password storage ────────────────────────────────
  var PW_KEY = 'tfs_admin_pw';

  function getPw() {
    try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
  }
  function setPw(v) {
    try { sessionStorage.setItem(PW_KEY, v); } catch (e) {}
  }
  function clearPw() {
    try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
  }

  // ─── Sidebar HTML ───────────────────────────────────────────
  // `active` is the route key for the page that should be highlighted.
  function renderShell(active) {
    var nav = [
      {
        label: 'Overview',
        items: [
          { key: 'dashboard', href: '/admin/', label: 'Dashboard', icon: 'grid' },
          { key: 'analytics', href: '/admin/analytics.html', label: 'Sales Tracking', icon: 'activity' }
        ]
      },
      {
        label: 'Operations',
        items: [
          { key: 'deals',        href: '/admin/deals.html',        label: 'Active Deals',     icon: 'home' },
          { key: 'buyers',       href: '/admin/buyers.html',       label: 'Buyer List',       icon: 'users' },
          { key: 'deal-buyers',  href: '/admin/deal-buyers.html',  label: 'Deal Buyer Lookup',icon: 'target' }
        ]
      },
      {
        label: 'Content',
        items: [
          { key: 'blog', href: '/admin/blog.html', label: 'Blog & Posts', icon: 'edit' }
        ]
      },
      {
        label: 'AI',
        items: [
          { key: 'lindy', href: '/admin/lindy.html', label: 'Deal Buddy', icon: 'activity' }
        ]
      },
      {
        label: 'System',
        items: [
          { key: 'sop', href: '/admin/paperclip-sop.html', label: 'Paperclip SOP', icon: 'book' }
        ]
      },
      {
        label: 'External',
        items: [
          { href: 'https://app.gohighlevel.com/', label: 'GoHighLevel', icon: 'link', ext: true },
          { href: 'https://www.notion.so/a3c0a38fd9294d758dedabab2548ff29', label: 'Notion Deal DB', icon: 'link', ext: true },
          { href: 'https://app.netlify.com/sites/termsforsale/deploys', label: 'Netlify Deploys', icon: 'link', ext: true }
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
            '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
          '</div>' +
          '<div class="sb-brand-text">' +
            '<div class="sb-brand-name">Terms For Sale</div>' +
            '<div class="sb-brand-sub">Admin Console</div>' +
          '</div>' +
        '</div>' +
        '<div class="sb-env" title="Connected to production GHL + Notion">Live · Production</div>' +
        '<nav class="sb-nav">' + navHtml + '</nav>' +
        '<div class="sb-footer">' +
          '<strong>Paperclip AI OS</strong><br>' +
          'Deal Pros LLC · v2.0<br>' +
          '<button class="sb-logout" onclick="AdminShell.logout()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
            'Sign out' +
          '</button>' +
        '</div>' +
      '</aside>' +
      '<div class="sb-overlay" id="sb-overlay"></div>';

    // Insert shell at the start of .admin-shell
    var host = document.querySelector('.admin-shell');
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = shell;
    // Move children into host before existing .main
    var main = host.querySelector('.main');
    while (wrap.firstChild) {
      if (main) host.insertBefore(wrap.firstChild, main);
      else host.appendChild(wrap.firstChild);
    }

    // Wire mobile toggle
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
      mailbox: '<path d="M22 17h-8V7h6a2 2 0 0 1 2 2v8z"/><path d="M14 17H2V9a2 2 0 0 1 2-2h2"/><path d="M6 3v4"/><path d="M18 10h.01"/>',
      edit:    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
      book:    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
      link:    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
    };
    return '<svg viewBox="0 0 24 24">' + (paths[name] || paths.grid) + '</svg>';
  }

  // ─── Password gate ───────────────────────────────────────────
  var GATE_HTML =
    '<div id="gate" class="gate">' +
      '<div class="gate-card">' +
        '<div class="gate-logo">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
        '</div>' +
        '<h2>Admin Console</h2>' +
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

  // Called by admin pages — shows gate if no session, otherwise calls onReady.
  function requireAuth(onReady) {
    var pw = getPw();
    if (pw) {
      // Valid session — drop the locked blur and proceed.
      // Individual API calls will redirect back to gate on 401.
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

  // ─── Fetch helper — auto-adds password header, re-gates on 401 ──
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

  // ─── Toast ───────────────────────────────────────────────────
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

  // ─── Helpers ─────────────────────────────────────────────────
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
  function slugifyAddress(addr) {
    return String(addr || '')
      .toLowerCase()
      .replace(/,/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  // Public API
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
    slugifyAddress: slugifyAddress,
    getPw: getPw
  };
})();
