/* ============================================
   DISPO BUDDY — MESSAGES JS
   ============================================ */

var partner = null;

window.addEventListener('scroll', function() {
  document.querySelector('.nav').classList.toggle('scrolled', window.scrollY > 10);
});
var ham = document.getElementById('hamburger');
if (ham) ham.addEventListener('click', function() {
  this.classList.toggle('on');
  document.getElementById('mobMenu').classList.toggle('on');
});

(function init() {
  var saved = sessionStorage.getItem('db_partner');
  if (!saved) { window.location.href = '/dashboard'; return; }
  try { partner = JSON.parse(saved); }
  catch(e) { window.location.href = '/dashboard'; return; }
  loadMessages();
})();

async function loadMessages() {
  var list = document.getElementById('msgList');
  try {
    var res = await fetch('/.netlify/functions/partner-messages?contactId=' + encodeURIComponent(partner.id));
    var data = await res.json();
    if (!res.ok) {
      list.innerHTML = '<div class="empty-state"><h3>Could not load messages</h3><p>Please refresh and try again.</p></div>';
      return;
    }
    renderMessages(data.messages || []);
  } catch(err) {
    list.innerHTML = '<div class="empty-state"><h3>Connection error</h3><p>Please refresh.</p></div>';
  }
}

function renderMessages(messages) {
  var list = document.getElementById('msgList');
  if (!messages || messages.length === 0) {
    list.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '<h3>No messages yet</h3>' +
        '<p>Start a conversation with the team. We\'ll respond within a few hours during business hours.</p>' +
      '</div>';
    return;
  }

  var html = '';
  var lastDay = '';
  messages.forEach(function(m) {
    var day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      html += '<div class="msg-day">' + escHtml(day) + '</div>';
      lastDay = day;
    }
    // inbound = from team to partner (shown on left, gray)
    // outbound = from partner to team (shown on right, blue)
    var dir = m.direction === 'outbound' ? 'outbound' : 'inbound';
    var time = timeOnly(m.createdAt);
    html += '<div class="msg ' + dir + '">' +
      escHtml(m.body || m.subject || '') +
      '<div class="meta">' + escHtml(time) + ' · ' + escHtml(m.type || 'SMS') + '</div>' +
    '</div>';
  });
  list.innerHTML = html;
  // Scroll to bottom
  list.scrollTop = list.scrollHeight;
}

window.sendMsg = async function() {
  var ta = document.getElementById('composeInput');
  var btn = document.getElementById('sendBtn');
  var msg = (ta.value || '').trim();
  if (!msg) return;

  btn.disabled = true;
  ta.disabled = true;

  try {
    var res = await fetch('/.netlify/functions/partner-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: partner.id, message: msg }),
    });
    var data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to send');
      btn.disabled = false;
      ta.disabled = false;
      return;
    }
    ta.value = '';
    if (data.testMode) {
      showToast('Saved (test mode — notifications off)');
    } else {
      showToast('Sent');
    }
    btn.disabled = false;
    ta.disabled = false;
    // Refresh messages after short delay
    setTimeout(loadMessages, 800);
  } catch(err) {
    showToast('Connection error');
    btn.disabled = false;
    ta.disabled = false;
  }
};

// Enter to send, Shift+Enter for new line
document.getElementById('composeInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    window.sendMsg();
  }
});

function dayLabel(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeOnly(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ampm;
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}

function escHtml(s) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(s == null ? '' : String(s)));
  return div.innerHTML;
}
