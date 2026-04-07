/* ============================================
   DISPO BUDDY — PROFILE JS
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
  renderProfile();
})();

function renderProfile() {
  var first = partner.firstName || (partner.name || '').split(' ')[0] || 'Partner';
  var last = partner.lastName || (partner.name || '').split(' ').slice(1).join(' ') || '';
  var initials = (first.charAt(0) + (last.charAt(0) || '')).toUpperCase();
  var tags = partner.tags || [];
  var isProven = tags.indexOf('db-proven-partner') !== -1;

  document.getElementById('avatarInitials').textContent = initials;
  document.getElementById('avatarName').textContent = partner.name || 'Partner';
  document.getElementById('avatarEmail').textContent = partner.email || '';

  var tierPill = document.getElementById('tierPill');
  if (isProven) {
    tierPill.className = 'tier-pill power';
    tierPill.textContent = '⭐ Power Partner · 30/70';
  } else {
    tierPill.className = 'tier-pill';
    tierPill.textContent = 'Emerging Partner · 50/50';
  }

  document.getElementById('infoName').textContent = partner.name || '—';
  document.getElementById('infoPhone').textContent = partner.phone || '—';
  document.getElementById('infoEmail').textContent = partner.email || '—';

  // Restore notification prefs from localStorage
  var prefs = JSON.parse(localStorage.getItem('db_notif_prefs') || '{}');
  document.getElementById('prefSms').checked = prefs.sms !== false;
  document.getElementById('prefEmail').checked = prefs.email !== false;
  document.getElementById('prefStage').checked = prefs.stage !== false;
  document.getElementById('prefOffers').checked = prefs.offers !== false;
  document.getElementById('prefPayouts').checked = prefs.payouts !== false;
}

window.savePrefs = function() {
  var prefs = {
    sms: document.getElementById('prefSms').checked,
    email: document.getElementById('prefEmail').checked,
    stage: document.getElementById('prefStage').checked,
    offers: document.getElementById('prefOffers').checked,
    payouts: document.getElementById('prefPayouts').checked,
  };
  localStorage.setItem('db_notif_prefs', JSON.stringify(prefs));
  showToast('Saved');
};

// Attach change listeners
['prefSms','prefEmail','prefStage','prefOffers','prefPayouts'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', window.savePrefs);
});

window.logout = function() {
  sessionStorage.removeItem('db_partner');
  localStorage.removeItem('db_notif_prefs');
  window.location.href = '/dashboard';
};

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2000);
}
