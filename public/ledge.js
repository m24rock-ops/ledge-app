// ══════════════════════════════════════════
//  LEDGE – ledge.js  (ES Module)  v3.0
//  FIXES:
//  • No login required to browse
//  • Login modal only appears when listing a PG
//  • Fixed addEventListener on null (#confirmDeleteBtn)
//  • Fixed closeDetailModal scope issue
//  • Fixed authStep show/hide
//  • XSS escaping everywhere
// ══════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs,
  query, orderBy, deleteDoc, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── Firebase Config ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyB2mMkDkSU7CBRcnqhhO87WSj7yWf3lCzo",
  authDomain:        "led-ge.firebaseapp.com",
  projectId:         "led-ge",
  storageBucket:     "led-ge.firebasestorage.app",
  messagingSenderId: "303796257325",
  appId:             "1:303796257325:web:81ea3d222eb1f476c3eea4",
  measurementId:     "G-R061Y0PYNE"
};

const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);
const auth    = getAuth(app);

// ── Constants ────────────────────────────────────────────
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_RENT        = 200000;
const MIN_RENT        = 500;

// ── State ────────────────────────────────────────────────
let currentUser        = null;
let pendingDeleteId    = null;
let editingId          = null;
let confirmationResult = null;
let resendTimer        = null;
let allLocationOptions = [];
let searchDebounce     = null;
let authMode           = 'phone';

// ════════════════════════════════════════════════════════
//  XSS HELPER
// ════════════════════════════════════════════════════════
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════
function init() {
  // Hide loader
  setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => (loader.style.display = 'none'), 400);
    }
  }, 900);

  // Always show app — no login required to browse
  showApp();

  // Listen for auth state in background
  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      const saved   = localStorage.getItem('ledgeUser');
      let profile   = saved ? tryParse(saved) : null;

      if (!profile || profile.uid !== firebaseUser.uid) {
        profile = {
          name:  profile?.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          phone: profile?.phone || (firebaseUser.phoneNumber || '').replace('+91', ''),
          uid:   firebaseUser.uid
        };
        localStorage.setItem('ledgeUser', JSON.stringify(profile));
      }

      currentUser = profile;
      updateNavUser();
    } else {
      currentUser = null;
      localStorage.removeItem('ledgeUser');
      updateNavUser();
    }
  });

  // Wire up delete modal confirm button safely here
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (pendingDeleteId) deletePG(pendingDeleteId);
    });
  }

  window.addEventListener('resize', syncFilterPanelForViewport);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFilters();
      closeDetailModal();
      closeAuthModal();
    }
  });

  syncFilterPanelForViewport();
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function updateNavUser() {
  const nameEl   = document.getElementById('displayName');
  const navRight = document.getElementById('navRight');
  const logoutBtn = document.querySelector('.btn-logout');
  if (currentUser) {
    if (nameEl) nameEl.textContent = currentUser.name;
    if (navRight) navRight.style.display = 'flex';
    if (logoutBtn) logoutBtn.textContent = 'Sign Out';
  } else {
    if (navRight) navRight.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════
//  SHOW APP (always called, no login gate)
// ════════════════════════════════════════════════════════
function showApp() {
  const loginSection = document.getElementById('loginSection');
  const mainApp      = document.getElementById('mainApp');
  if (loginSection) loginSection.style.display = 'none';
  if (mainApp)      mainApp.style.display      = 'block';
  loadPGs();
}

// ════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3500);
}

// ════════════════════════════════════════════════════════
//  AUTH MODAL (shown only when trying to list a PG)
// ════════════════════════════════════════════════════════
function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('open');
    showAuthStep('authStep1');
  }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
}

function showAuthStep(stepId) {
  ['authStep1','authStepOTP','authStepSetPw','authStepReset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(stepId);
  if (target) target.style.display = 'block';
}

// ════════════════════════════════════════════════════════
//  AUTH MODE SWITCHER
// ════════════════════════════════════════════════════════
function switchAuthMode(mode) {
  authMode = mode;
  const pf = document.getElementById('phoneFields');
  const ef = document.getElementById('emailFields');
  const tp = document.getElementById('tabPhone');
  const te = document.getElementById('tabEmail');
  if (pf) pf.style.display = mode === 'phone' ? 'block' : 'none';
  if (ef) ef.style.display = mode === 'email' ? 'block' : 'none';
  if (tp) tp.classList.toggle('active', mode === 'phone');
  if (te) te.classList.toggle('active', mode === 'email');
}

function handleContinue() {
  if (authMode === 'phone') sendOTP();
  else loginWithEmail();
}

// ════════════════════════════════════════════════════════
//  RECAPTCHA
// ════════════════════════════════════════════════════════
function setupRecaptcha() {
  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {}
    });
  }
}

// ════════════════════════════════════════════════════════
//  PHONE OTP — Send
// ════════════════════════════════════════════════════════
async function sendOTP() {
  const name  = document.getElementById('userName')?.value.trim() || '';
  const phone = document.getElementById('userPhone')?.value.trim() || '';

  if (!name)                   { toast('Please enter your name', 'error');              return; }
  if (!/^\d{10}$/.test(phone)) { toast('Enter a valid 10-digit phone number', 'error'); return; }

  const btn = document.getElementById('continueBtn');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    setupRecaptcha();
    confirmationResult = await signInWithPhoneNumber(auth, '+91' + phone, window.recaptchaVerifier);

    showAuthStep('authStepOTP');
    const otpPhoneEl = document.getElementById('otpPhone');
    if (otpPhoneEl) otpPhoneEl.textContent = '+91 ' + phone;
    window._pendingAuth = { name, phone };

    startResendTimer();
    toast('OTP sent to +91' + phone + ' ✅', 'success');

  } catch (err) {
    console.error(err);
    let msg = 'Failed to send OTP.';
    if (err.code === 'auth/too-many-requests')    msg = 'Too many attempts. Try again later.';
    if (err.code === 'auth/invalid-phone-number') msg = 'Invalid phone number.';
    if (err.code === 'auth/billing-not-enabled')  msg = 'Phone auth not enabled on this project. Use email instead.';
    toast(msg, 'error');
    window.recaptchaVerifier = null;
  } finally {
    if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════
//  PHONE OTP — Verify
// ════════════════════════════════════════════════════════
async function verifyOTP() {
  const otpInput = document.getElementById('otpInput');
  const otp = otpInput ? otpInput.value.trim() : '';
  if (otp.length !== 6) { toast('Enter the 6-digit OTP', 'error'); return; }

  const btn = document.querySelector('#authStepOTP .auth-btn');
  if (btn) { btn.textContent = 'Verifying…'; btn.disabled = true; }

  try {
    const result       = await confirmationResult.confirm(otp);
    const firebaseUser = result.user;
    const { name, phone } = window._pendingAuth || {};

    currentUser = { name: name || 'User', phone: phone || '', uid: firebaseUser.uid };
    localStorage.setItem('ledgeUser', JSON.stringify(currentUser));

    clearResendTimer();
    updateNavUser();
    toast('Welcome, ' + currentUser.name + '! 👋', 'success');
    closeAuthModal();

    const hasEmail = !!(firebaseUser.email);
    if (!hasEmail) {
      // Offer set-password in modal
      openAuthModal();
      showAuthStep('authStepSetPw');
    } else {
      showSection('add');
    }

  } catch (err) {
    console.error(err);
    toast(
      err.code === 'auth/invalid-verification-code'
        ? 'Incorrect OTP. Please try again.'
        : 'Verification failed: ' + err.message,
      'error'
    );
  } finally {
    if (btn) { btn.textContent = 'Verify'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════
//  SET PASSWORD (after phone OTP login)
// ════════════════════════════════════════════════════════
async function saveNewPassword() {
  const pw1 = document.getElementById('setPwInput')?.value || '';
  const pw2 = document.getElementById('setPwConfirm')?.value || '';

  if (pw1.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
  if (pw1 !== pw2)    { toast('Passwords do not match', 'error');                  return; }
  if (getPasswordStrength(pw1) < 2) { toast('Password is too weak. Add numbers or symbols.', 'error'); return; }

  const btn = document.querySelector('#authStepSetPw .auth-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('No user session found.');

    const email = currentUser.name.replace(/\s+/g,'').toLowerCase() + '_' + (currentUser.phone || Date.now()) + '@ledge.app';

    try {
      const credential = EmailAuthProvider.credential(email, pw1);
      await linkWithCredential(user, credential);
      toast('✅ Password saved!', 'success');
    } catch (linkErr) {
      if (linkErr.code === 'auth/provider-already-linked' || linkErr.code === 'auth/email-already-in-use') {
        await updatePassword(user, pw1);
        toast('✅ Password updated!', 'success');
      } else {
        throw linkErr;
      }
    }

    closeAuthModal();
    showSection('add');

  } catch (err) {
    console.error(err);
    toast('Could not save password: ' + err.message, 'error');
  } finally {
    if (btn) { btn.textContent = 'Save password'; btn.disabled = false; }
  }
}

function skipSetPassword() {
  toast('You can set a password later from your profile.', 'info');
  closeAuthModal();
  showSection('add');
}

// ════════════════════════════════════════════════════════
//  EMAIL LOGIN / REGISTER
// ════════════════════════════════════════════════════════
async function loginWithEmail() {
  const fallbackName = document.getElementById('userName')?.value.trim() || '';
  const name     = document.getElementById('userNameEmail')?.value.trim() || fallbackName;
  const email    = document.getElementById('userEmail')?.value.trim() || '';
  const password = document.getElementById('userPassword')?.value || '';

  if (!email)    { toast('Please enter your email', 'error');   return; }
  if (!password) { toast('Please enter a password', 'error');   return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Please enter a valid email address', 'error'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

  const btn = document.getElementById('continueBtn');
  if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    currentUser = {
      name: name || user.displayName || user.email.split('@')[0],
      phone: '',
      uid: user.uid
    };
    localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
    updateNavUser();
    closeAuthModal();
    showSection('add');
    toast('Welcome back, ' + currentUser.name + '! 👋', 'success');

  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      if (!name) {
        toast('Add your full name above to create a new account', 'error');
        if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
        return;
      }
      try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCred.user;
        currentUser = { name, phone: '', uid: user.uid };
        localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
        updateNavUser();
        closeAuthModal();
        showSection('add');
        toast('Account created! Welcome ' + name + ' 🎉', 'success');
      } catch (regErr) {
        toast(regErr.message, 'error');
      }
    } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-password') {
      toast('Incorrect password. Try again or reset it below.', 'error');
    } else if (err.code === 'auth/too-many-requests') {
      toast('Too many attempts. Please reset your password or try later.', 'error');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    if (btn) { btn.textContent = 'Continue'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════
//  PASSWORD RESET
// ════════════════════════════════════════════════════════
function showResetStep() {
  const emailVal = document.getElementById('userEmail')?.value || '';
  const resetEl  = document.getElementById('resetEmail');
  if (emailVal && resetEl) resetEl.value = emailVal;
  showAuthStep('authStepReset');
}

async function sendPasswordReset() {
  const email = document.getElementById('resetEmail')?.value.trim() || '';
  if (!email) { toast('Enter your email address', 'error'); return; }

  const btn = document.querySelector('#authStepReset .auth-btn');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }

  try {
    await sendPasswordResetEmail(auth, email);
    toast('Reset link sent to ' + email + ' ✅', 'success');
    setTimeout(() => backToStep1(), 1500);
  } catch (err) {
    toast(err.code === 'auth/user-not-found' ? 'No account found with that email.' : err.message, 'error');
  } finally {
    if (btn) { btn.textContent = 'Send reset link'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════
//  OTP — Resend & Countdown
// ════════════════════════════════════════════════════════
function startResendTimer() {
  let seconds = 30;
  const timerEl   = document.getElementById('otpTimer');
  const resendRow = document.getElementById('resendRow');
  if (!timerEl || !resendRow) return;

  resendRow.style.display = 'none';
  timerEl.textContent = `Resend in ${seconds}s`;
  clearResendTimer();

  resendTimer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearResendTimer();
      timerEl.textContent     = '';
      resendRow.style.display = 'block';
    } else {
      timerEl.textContent = `Resend in ${seconds}s`;
    }
  }, 1000);
}

function clearResendTimer() {
  if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
}

async function resendOTP() {
  const otpInput  = document.getElementById('otpInput');
  const resendRow = document.getElementById('resendRow');
  if (otpInput)  otpInput.value          = '';
  if (resendRow) resendRow.style.display = 'none';
  window.recaptchaVerifier = null;
  const { phone } = window._pendingAuth || {};
  if (!phone) { backToStep1(); return; }
  try {
    setupRecaptcha();
    confirmationResult = await signInWithPhoneNumber(auth, '+91' + phone, window.recaptchaVerifier);
    startResendTimer();
    toast('OTP resent ✅', 'success');
  } catch (err) {
    toast('Failed to resend: ' + err.message, 'error');
    window.recaptchaVerifier = null;
  }
}

function backToStep1() {
  clearResendTimer();
  showAuthStep('authStep1');
  const otpInput = document.getElementById('otpInput');
  if (otpInput) otpInput.value = '';
  window.recaptchaVerifier = null;
  confirmationResult = null;
}

// ════════════════════════════════════════════════════════
//  PASSWORD UTILITIES
// ════════════════════════════════════════════════════════
function getPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)         score++;
  if (/[A-Z]/.test(pw))       score++;
  if (/[0-9]/.test(pw))       score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function checkPasswordStrength(pw, fillId, labelId) {
  const score = getPasswordStrength(pw);
  const fill  = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  if (!fill || !label) return;

  const configs = [
    { pct:'0%',   bg:'transparent', text:'' },
    { pct:'25%',  bg:'#e74c3c',     text:'Too weak' },
    { pct:'50%',  bg:'#e67e22',     text:'Weak' },
    { pct:'75%',  bg:'#f1c40f',     text:'Fair' },
    { pct:'100%', bg:'#27ae60',     text:'Strong 💪' },
  ];
  const c = configs[score];
  fill.style.width      = c.pct;
  fill.style.background = c.bg;
  label.textContent     = c.text;
  label.style.color     = c.bg;
}

function togglePwVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type      = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type      = 'password';
    btn.textContent = 'Show';
  }
}

// ════════════════════════════════════════════════════════
//  AUTH — Logout
// ════════════════════════════════════════════════════════
function logout() {
  localStorage.removeItem('ledgeUser');
  currentUser = null;
  auth.signOut().catch(() => {});
  updateNavUser();
  showSection('browse');
  toast('Signed out successfully', 'info');
}

// ════════════════════════════════════════════════════════
//  FILE SELECT
// ════════════════════════════════════════════════════════
function handleFileSelect(input) {
  const f = input.files[0];
  const photoName = document.getElementById('photoName');
  if (!f) { if (photoName) photoName.textContent = ''; return; }
  if (f.size > MAX_IMAGE_BYTES) {
    toast(`Image too large (${(f.size/1024/1024).toFixed(1)} MB). Max is 3 MB.`, 'error');
    input.value = '';
    if (photoName) photoName.textContent = '';
    return;
  }
  if (photoName) photoName.textContent = '✔ ' + f.name;
}

// ════════════════════════════════════════════════════════
//  LOCATION FILTER
// ════════════════════════════════════════════════════════
function filterLocationDropdown() {
  const q      = document.getElementById('locationSearch')?.value.toLowerCase().trim() || '';
  const select = document.getElementById('filterLocation');
  if (!select) return;

  select.innerHTML = '<option value="all">All Locations</option>';
  const filtered = q
    ? allLocationOptions.filter(l => l.toLowerCase().includes(q))
    : allLocationOptions;

  filtered.forEach(l => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = l;
    select.appendChild(opt);
  });
  select.value = filtered.length === 1 ? filtered[0] : 'all';
  loadPGs();
}

// ════════════════════════════════════════════════════════
//  DEBOUNCED SEARCH
// ════════════════════════════════════════════════════════
function debouncedSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadPGs, 300);
}

function getPriceValue(pg) {
  const v = parseInt(pg.price, 10);
  return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
}

function getDistanceValue(pg) {
  const v = parseFloat(pg.distanceFromCollege);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

function hasFoodIncluded(pg) {
  if (typeof pg.foodIncluded === 'boolean') return pg.foodIncluded;
  const h = [pg.amenities, pg.description].filter(Boolean).join(' ').toLowerCase();
  return /food|meal|mess/.test(h);
}

function hasWifi(pg) {
  if (typeof pg.wifiAvailable === 'boolean') return pg.wifiAvailable;
  const h = [pg.amenities, pg.description].filter(Boolean).join(' ').toLowerCase();
  return /wifi|wi-fi|internet|broadband/.test(h);
}

function parseBudgetRange(range) {
  if (!range || range === 'all') return null;
  const [min, max] = range.split('-').map(Number);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function updateMarketplaceStats(total, available, locations) {
  const t = document.getElementById('statTotal');
  const a = document.getElementById('statAvailable');
  const l = document.getElementById('statLocations');
  if (t) t.textContent = String(total);
  if (a) a.textContent = String(available);
  if (l) l.textContent = String(locations);
}

function setResultsSummary(displayed, total, available, locations) {
  const resultsMeta  = document.getElementById('resultsMeta');
  const resultsPills = document.getElementById('resultsPills');

  if (resultsMeta) {
    if (!total)              resultsMeta.textContent = 'No listings yet. Be the first to add one.';
    else if (displayed === total) resultsMeta.textContent = `Showing all ${total} listing${total !== 1 ? 's' : ''}`;
    else                    resultsMeta.textContent = `Showing ${displayed} of ${total} listing${total !== 1 ? 's' : ''}`;
  }
  if (resultsPills) {
    resultsPills.innerHTML = `
      <span class="results-pill">${available} available now</span>
      <span class="results-pill">${locations} locations</span>
    `;
  }
}

function clearAllFilters() {
  ['searchInput','locationSearch'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['filterType','filterGender','filterAvail','filterLocation','filterBudget','filterDistance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = 'all';
  });
  const sortEl = document.getElementById('sortBy');
  if (sortEl) sortEl.value = 'newest';
  const foodEl = document.getElementById('filterFood');
  if (foodEl) foodEl.checked = false;
  const wifiEl = document.getElementById('filterWifi');
  if (wifiEl) wifiEl.checked = false;
  if (window.innerWidth <= 960) closeFilters();
  loadPGs();
}

// ════════════════════════════════════════════════════════
//  SHOW SECTION
// ════════════════════════════════════════════════════════
function showSection(section) {
  closeFilters();
  const browseSection = document.getElementById('browseSection');
  const addSection    = document.getElementById('addSection');
  const tabBrowse     = document.getElementById('tab-browse');
  const tabAdd        = document.getElementById('tab-add');

  if (browseSection) browseSection.style.display = 'none';
  if (addSection)    addSection.style.display    = 'none';
  if (tabBrowse)     tabBrowse.classList.remove('active');
  if (tabAdd)        tabAdd.classList.remove('active');

  if (section === 'browse') {
    if (browseSection) browseSection.style.display = 'block';
    if (tabBrowse)     tabBrowse.classList.add('active');
    loadPGs();
  } else {
    // Gate: must be logged in to list
    if (!currentUser) {
      openAuthModal();
      return;
    }
    if (addSection) addSection.style.display = 'block';
    if (tabAdd)     tabAdd.classList.add('active');

    if (!editingId) {
      const t = document.getElementById('addCardTitle');
      const s = document.getElementById('addCardSubtitle');
      const b = document.getElementById('submitBtn');
      const c = document.getElementById('cancelEditBtn');
      if (t) t.textContent = 'List Your Property';
      if (s) s.textContent = 'Fill in the details below to publish your PG listing.';
      if (b) b.textContent = '🚀 Publish Listing';
      if (c) c.style.display = 'none';
    }
  }
}

// ════════════════════════════════════════════════════════
//  LOAD PGs
// ════════════════════════════════════════════════════════
async function loadPGs() {
  const listEl = document.getElementById('pgList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="spinner"></div>';
  setResultsSummary(0, 0, 0, 0);

  try {
    const snap = await getDocs(query(collection(db, 'pgs'), orderBy('createdAt', 'desc')));
    const docs = snap.docs.map(d => ({ id: d.id, pg: d.data() }));

    const filterType     = document.getElementById('filterType')?.value     || 'all';
    const filterGender   = document.getElementById('filterGender')?.value   || 'all';
    const filterLocation = document.getElementById('filterLocation')?.value || 'all';
    const filterAvail    = document.getElementById('filterAvail')?.value    || 'all';
    const filterBudget   = document.getElementById('filterBudget')?.value   || 'all';
    const filterDistance = document.getElementById('filterDistance')?.value || 'all';
    const filterFood     = !!document.getElementById('filterFood')?.checked;
    const filterWifi     = !!document.getElementById('filterWifi')?.checked;
    const sortBy         = document.getElementById('sortBy')?.value         || 'newest';
    const searchQuery    = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const budgetRange    = parseBudgetRange(filterBudget);
    const maxDistance    = filterDistance === 'all' ? null : Number(filterDistance);

    const totalListings  = docs.length;
    const availableCount = docs.filter(({ pg }) => pg.available !== false).length;
    const locationCount  = new Set(
      docs.map(({ pg }) => (pg.location || '').split(',')[0].trim()).filter(Boolean)
    ).size;

    updateMarketplaceStats(totalListings, availableCount, locationCount);

    if (!totalListings) {
      setResultsSummary(0, 0, 0, 0);
      listEl.innerHTML = emptyState('🏠', 'No listings yet', 'Be the first to add a PG.');
      return;
    }

    allLocationOptions = [...new Set(
      docs.map(({ pg }) => (pg.location || '').split(',')[0].trim()).filter(Boolean)
    )].sort();

    const locSearch = (document.getElementById('locationSearch')?.value || '').toLowerCase().trim();
    const locSelect = document.getElementById('filterLocation');
    if (locSelect) {
      const currentValue    = locSelect.value;
      const filteredLocations = locSearch
        ? allLocationOptions.filter(l => l.toLowerCase().includes(locSearch))
        : allLocationOptions;
      locSelect.innerHTML = '<option value="all">All locations</option>' +
        filteredLocations.map(l =>
          `<option value="${esc(l)}"${currentValue === l ? ' selected' : ''}>${esc(l)}</option>`
        ).join('');
      if (currentValue !== 'all' && !filteredLocations.includes(currentValue)) locSelect.value = 'all';
    }

    const filteredDocs = docs.filter(({ pg }) => {
      if (filterType !== 'all' && pg.propertyType !== filterType) return false;
      if (filterGender !== 'all' && pg.gender !== filterGender) return false;

      const isAvailable = pg.available !== false;
      if (filterAvail === 'available'   && !isAvailable) return false;
      if (filterAvail === 'unavailable' &&  isAvailable) return false;

      const primaryLocation = (pg.location || '').split(',')[0].trim();
      if (filterLocation !== 'all' && primaryLocation !== filterLocation) return false;

      const priceValue = getPriceValue(pg);
      if (budgetRange && (priceValue < budgetRange.min || priceValue > budgetRange.max)) return false;

      const distanceValue = getDistanceValue(pg);
      if (maxDistance !== null && distanceValue > maxDistance) return false;

      if (filterFood && !hasFoodIncluded(pg)) return false;
      if (filterWifi && !hasWifi(pg))         return false;

      if (searchQuery) {
        const haystack = [
          pg.name, pg.location, pg.amenities, pg.description, pg.type, pg.propertyType,
          hasFoodIncluded(pg) ? 'food included' : '',
          hasWifi(pg) ? 'wifi internet' : ''
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });

    if (!filteredDocs.length) {
      setResultsSummary(0, totalListings, availableCount, locationCount);
      listEl.innerHTML = emptyState('🔎', 'No matches', 'Try adjusting the filters or search term.');
      return;
    }

    filteredDocs.sort((a, b) => {
      if (sortBy === 'price-low')      return getPriceValue(a.pg) - getPriceValue(b.pg);
      if (sortBy === 'price-high')     return getPriceValue(b.pg) - getPriceValue(a.pg);
      if (sortBy === 'distance-near')  return getDistanceValue(a.pg) - getDistanceValue(b.pg);
      return (b.pg.createdAt || 0) - (a.pg.createdAt || 0);
    });

    const cards = filteredDocs.map(({ id, pg }) => {
      const isOwner    = !!(currentUser?.uid && pg.ownerId === currentUser.uid);
      const isAvailable = pg.available !== false;
      const ownerBadge  = isOwner ? '<div class="owner-badge">Your listing</div>' : '';
      const foodIncluded = hasFoodIncluded(pg);
      const wifiAvailable = hasWifi(pg);
      const distanceValue = getDistanceValue(pg);
      const distanceText  = Number.isFinite(distanceValue) ? `${distanceValue.toFixed(1)} km from college` : 'Distance not shared';

      const actionBtns = isOwner ? `
        <button class="btn btn-secondary btn-sm edit-btn" data-id="${id}">Edit</button>
        <button class="btn btn-danger btn-sm delete-btn" data-id="${id}">Delete</button>
        <button class="btn ${isAvailable ? 'btn-secondary' : 'btn-primary'} btn-sm toggle-avail-btn"
                data-id="${id}" data-avail="${isAvailable}">
          ${isAvailable ? 'Mark Filled' : 'Mark Available'}
        </button>` : '';

      const imgHtml = pg.imageUrl
        ? `<img class="pg-card-img" src="${esc(pg.imageUrl)}" alt="Photo" loading="lazy"/>`
        : '<div class="pg-card-img-placeholder">🏘️</div>';
      const pgAttr = encodeURIComponent(JSON.stringify({ ...pg, id }));

      return `
        <div class="pg-card${isAvailable ? '' : ' pg-card-unavailable'}">
          <div class="pg-card-clickable" data-pg="${pgAttr}" style="cursor:pointer;">
            ${imgHtml}
            <div class="pg-card-body">
              ${ownerBadge}
              <div class="pg-card-header">
                <div>
                  <div class="pg-card-title">${esc(pg.name)}</div>
                  <div class="avail-badge ${isAvailable ? 'available' : 'unavailable'}">${isAvailable ? 'Available' : 'Filled'}</div>
                </div>
                <div class="pg-type-badge">${esc(pg.propertyType || 'PG')}</div>
              </div>
              ${pg.description ? `<p style="font-size:0.84rem;color:var(--muted);margin-bottom:12px;line-height:1.6;">${esc(pg.description)}</p>` : ''}
              <div class="pg-meta">
                <div class="pg-meta-item">📍 <span>${esc(pg.location)}</span></div>
                <div class="pg-meta-item">👥 <span>${esc(pg.gender || 'Unisex')} • ${esc(pg.type)}</span></div>
                <div class="pg-meta-item">💰 <strong class="pg-price">₹${esc(String(pg.price))}/mo</strong></div>
                <div class="pg-meta-item">🎓 <span>${esc(distanceText)}</span></div>
                <div class="pg-meta-item">📞 <span>${esc(pg.contact)}</span></div>
              </div>
              <div class="result-feature-badges">
                <span class="feature-badge">${foodIncluded ? '🍛 Food included' : '🍛 No food'}</span>
                <span class="feature-badge">${wifiAvailable ? '📶 WiFi' : '📶 No WiFi'}</span>
              </div>
            </div>
          </div>
          <div class="pg-card-footer">
            <a href="https://wa.me/91${esc(pg.contact)}" target="_blank" rel="noopener" class="btn btn-whatsapp">WhatsApp</a>
            ${actionBtns}
          </div>
        </div>`;
    });

    setResultsSummary(filteredDocs.length, totalListings, availableCount, locationCount);
    listEl.innerHTML = `<div class="pg-grid">${cards.join('')}</div>`;
    attachCardListeners(listEl);
    if (window.innerWidth <= 960) closeFilters();

  } catch (err) {
    console.error(err);
    listEl.innerHTML = emptyState('⚠️', 'Failed to load', err.message);
  }
}

function emptyState(icon, title, msg) {
  return `<div class="empty-state"><div class="icon">${icon}</div><h4>${esc(title)}</h4><p>${esc(msg)}</p></div>`;
}

function attachCardListeners(listEl) {
  listEl.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openDeleteModal(btn.dataset.id); })
  );
  listEl.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.pg-card');
      if (!card) return;
      const pgData = tryParse(decodeURIComponent(card.querySelector('.pg-card-clickable')?.dataset.pg || '{}'));
      if (pgData) openEditForm(btn.dataset.id, pgData);
    })
  );
  listEl.querySelectorAll('.toggle-avail-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleAvailability(btn.dataset.id, btn.dataset.avail === 'true');
    })
  );
  listEl.querySelectorAll('.pg-card-clickable').forEach(card =>
    card.addEventListener('click', () => {
      const pgData = tryParse(decodeURIComponent(card.dataset.pg || '{}'));
      if (pgData) openDetailModal(pgData);
    })
  );
}

// ════════════════════════════════════════════════════════
//  AVAILABILITY TOGGLE
// ════════════════════════════════════════════════════════
async function toggleAvailability(id, currentlyAvailable) {
  try {
    await updateDoc(doc(db, 'pgs', id), { available: !currentlyAvailable, updatedAt: Date.now() });
    toast(currentlyAvailable ? '🔴 Marked as filled' : '✅ Marked as available', 'success');
    loadPGs();
  } catch (err) {
    toast('Update failed: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  DETAIL MODAL
// ════════════════════════════════════════════════════════
function openDetailModal(pg) {
  const isAvailable = pg.available !== false;
  const imgHtml = pg.imageUrl
    ? `<img class="detail-media" src="${esc(pg.imageUrl)}" alt="Photo" loading="lazy"/>`
    : '<div class="detail-media-placeholder">🏘️</div>';

  const amenitiesList = pg.amenities
    ? pg.amenities.split(',').map(item => `<span class="amenity-pill">${esc(item.trim())}</span>`).join('')
    : '<span style="color:var(--muted);font-size:0.82rem;">Not specified</span>';

  const distanceValue = getDistanceValue(pg);
  const distanceText  = Number.isFinite(distanceValue) ? `${distanceValue.toFixed(1)} km` : 'Not shared';

  const body = document.getElementById('detailModalBody');
  if (!body) return;

  body.innerHTML = `
    <div class="detail-shell">
      ${imgHtml}
      <div class="detail-head">
        <div>
          <h3 style="font-size:1.4rem;font-weight:800;margin-bottom:8px;">${esc(pg.name)}</h3>
          <div class="avail-badge ${isAvailable ? 'available' : 'unavailable'}">${isAvailable ? 'Available now' : 'Currently filled'}</div>
        </div>
        <div class="pg-type-badge">${esc(pg.propertyType || 'PG')}</div>
      </div>
      <div class="detail-price"><strong>₹${esc(String(pg.price))}</strong><span>per month</span></div>
      <div class="detail-grid">
        ${infoBox('Location', pg.location)}
        ${infoBox('For', pg.gender || 'Unisex')}
        ${infoBox('Room type', pg.type)}
        ${infoBox('Distance from college', distanceText)}
        ${infoBox('Food included', hasFoodIncluded(pg) ? 'Yes' : 'No')}
        ${infoBox('WiFi', hasWifi(pg) ? 'Yes' : 'No')}
      </div>
      ${pg.description ? `
        <div class="detail-section">
          <h4>About this place</h4>
          <p style="font-size:0.92rem;line-height:1.7;color:var(--text);">${esc(pg.description)}</p>
        </div>` : ''}
      <div class="detail-section">
        <h4>Amenities</h4>
        <div class="amenities-list">${amenitiesList}</div>
      </div>
      <a href="https://wa.me/91${esc(pg.contact)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-full">Contact on WhatsApp</a>
      <div class="detail-footer-note">Listed by ${esc(pg.ownerName || 'Owner')}</div>
    </div>
  `;

  document.getElementById('detailModal').classList.add('open');
}

function infoBox(label, value) {
  return `<div class="detail-info-box"><strong>${esc(label)}</strong><span>${esc(String(value || ''))}</span></div>`;
}

function closeDetailModal() {
  const modal = document.getElementById('detailModal');
  if (modal) modal.classList.remove('open');
}

// ════════════════════════════════════════════════════════
//  EDIT LISTING
// ════════════════════════════════════════════════════════
function openEditForm(id, pg) {
  editingId = id;
  const fields = {
    pgName: pg.name || '', propertyType: pg.propertyType || 'PG',
    pgPrice: pg.price || '', pgType: pg.type || 'Single',
    pgGender: pg.gender || 'Unisex', pgContact: pg.contact || '',
    pgLocation: pg.location || '',
    pgFoodIncluded: String(typeof pg.foodIncluded === 'boolean' ? pg.foodIncluded : hasFoodIncluded(pg)),
    pgWifi: String(typeof pg.wifiAvailable === 'boolean' ? pg.wifiAvailable : hasWifi(pg)),
    pgDistance: Number.isFinite(getDistanceValue(pg)) ? String(getDistanceValue(pg)) : '',
    pgAmenities: pg.amenities || '', pgDesc: pg.description || ''
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id); if (el) el.value = val;
  });

  const t = document.getElementById('addCardTitle');
  const s = document.getElementById('addCardSubtitle');
  const b = document.getElementById('submitBtn');
  const c = document.getElementById('cancelEditBtn');
  if (t) t.textContent = 'Edit Listing';
  if (s) s.textContent = 'Update your property details below.';
  if (b) b.textContent = '💾 Save Changes';
  if (c) c.style.display = 'inline-flex';

  showSection('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;
  resetForm();
  showSection('browse');
}

function resetForm() {
  ['pgName','pgPrice','pgContact','pgLocation','pgDistance','pgAmenities','pgDesc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const fi = document.getElementById('pgFoodIncluded'); if (fi) fi.value = 'true';
  const wi = document.getElementById('pgWifi');         if (wi) wi.value = 'true';
  const pf = document.getElementById('photoFile');      if (pf) pf.value = '';
  const pn = document.getElementById('photoName');      if (pn) pn.textContent = '';

  const t = document.getElementById('addCardTitle');
  const s = document.getElementById('addCardSubtitle');
  const b = document.getElementById('submitBtn');
  const c = document.getElementById('cancelEditBtn');
  if (t) t.textContent = 'List Your Property';
  if (s) s.textContent = 'Fill in the details below to publish your PG listing.';
  if (b) b.textContent = '🚀 Publish Listing';
  if (c) c.style.display = 'none';
}

// ════════════════════════════════════════════════════════
//  DELETE MODAL
// ════════════════════════════════════════════════════════
function openDeleteModal(id) {
  pendingDeleteId = id;
  const modal = document.getElementById('deleteModal');
  if (modal) modal.classList.add('open');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('deleteModal');
  if (modal) modal.classList.remove('open');
}

async function deletePG(id) {
  try {
    const snap = await getDoc(doc(db, 'pgs', id));
    if (!snap.exists())                           { toast('Listing not found', 'error');        closeDeleteModal(); return; }
    if (snap.data().ownerId !== currentUser?.uid) { toast('Not authorised to delete', 'error'); closeDeleteModal(); return; }

    await deleteDoc(doc(db, 'pgs', id));
    closeDeleteModal();
    toast('Listing deleted ✅', 'success');
    loadPGs();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  SUBMIT / UPDATE PG
// ════════════════════════════════════════════════════════
async function submitPG() {
  if (!currentUser?.uid) { toast('Please sign in first', 'error'); openAuthModal(); return; }

  const propertyType    = document.getElementById('propertyType')?.value || 'PG';
  const name            = document.getElementById('pgName')?.value.trim() || '';
  const priceRaw        = document.getElementById('pgPrice')?.value.trim() || '';
  const type            = document.getElementById('pgType')?.value || 'Single';
  const gender          = document.getElementById('pgGender')?.value || 'Unisex';
  const contact         = document.getElementById('pgContact')?.value.trim() || '';
  const location        = document.getElementById('pgLocation')?.value.trim() || '';
  const foodIncluded    = document.getElementById('pgFoodIncluded')?.value === 'true';
  const wifiAvailable   = document.getElementById('pgWifi')?.value === 'true';
  const distanceRaw     = document.getElementById('pgDistance')?.value.trim() || '';
  const amenities       = document.getElementById('pgAmenities')?.value.trim() || '';
  const description     = document.getElementById('pgDesc')?.value.trim() || '';
  const photoFileInput  = document.getElementById('photoFile');
  const photoFile       = photoFileInput?.files[0] || null;

  if (!name || !priceRaw || !contact || !location || !distanceRaw) {
    toast('Please fill all required fields *', 'error'); return;
  }
  if (name.length < 3 || name.length > 80) { toast('Property name must be 3–80 characters', 'error'); return; }

  const price = parseInt(priceRaw, 10);
  if (isNaN(price) || price < MIN_RENT) { toast(`Minimum rent is ₹${MIN_RENT.toLocaleString()}`, 'error'); return; }
  if (price > MAX_RENT)                 { toast(`Rent above ₹${MAX_RENT.toLocaleString()} seems unusual.`, 'error'); return; }
  if (!/^\d{10}$/.test(contact))        { toast('Enter a valid 10-digit contact number', 'error'); return; }
  if (location.length < 5)              { toast('Please enter a more specific location', 'error'); return; }

  const distanceFromCollege = parseFloat(distanceRaw);
  if (!Number.isFinite(distanceFromCollege) || distanceFromCollege < 0 || distanceFromCollege > 50) {
    toast('Enter a valid distance from college (0–50 km)', 'error'); return;
  }
  if (photoFile && photoFile.size > MAX_IMAGE_BYTES) { toast('Image too large (max 3 MB)', 'error'); return; }

  const btn = document.getElementById('submitBtn');
  const isEdit = !!editingId;
  if (btn) { btn.textContent = isEdit ? 'Saving…' : 'Uploading…'; btn.disabled = true; }

  try {
    let imageUrl = '';
    if (isEdit) {
      const existing = await getDoc(doc(db, 'pgs', editingId));
      if (existing.data()?.ownerId !== currentUser.uid) { toast('Not authorised', 'error'); return; }
      imageUrl = existing.data()?.imageUrl || '';
    }

    if (photoFile) {
      const storageRef = ref(storage, `pg-photos/${currentUser.uid}/${Date.now()}_${photoFile.name}`);
      await uploadBytes(storageRef, photoFile);
      imageUrl = await getDownloadURL(storageRef);
    }

    const data = {
      name, propertyType, price: String(price), type, gender, contact, location,
      foodIncluded, wifiAvailable, distanceFromCollege, amenities, description,
      imageUrl, updatedAt: Date.now()
    };

    if (isEdit) {
      await updateDoc(doc(db, 'pgs', editingId), data);
      toast('✅ Listing updated!', 'success');
      editingId = null;
    } else {
      await addDoc(collection(db, 'pgs'), {
        ...data,
        ownerId: currentUser.uid,
        ownerName: currentUser.name || 'Owner',
        available: true,
        createdAt: Date.now()
      });
      toast('🎉 Listing published!', 'success');
    }

    resetForm();
    showSection('browse');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  } finally {
    if (btn) { btn.textContent = isEdit ? '💾 Save Changes' : '🚀 Publish Listing'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════
//  FILTER PANEL
// ════════════════════════════════════════════════════════
function setFiltersOpen(open) {
  const layout    = document.getElementById('browseLayout');
  const toggleBtn = document.getElementById('filterToggleBtn');
  if (!layout) return;
  layout.classList.toggle('filters-open', open);
  if (toggleBtn) {
    toggleBtn.textContent = open ? '✕ Close Filters' : '☰ Filters';
    toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  document.body.classList.toggle('filters-panel-open', open && window.innerWidth <= 960);
}

function toggleFilters() {
  const layout = document.getElementById('browseLayout');
  if (layout) setFiltersOpen(!layout.classList.contains('filters-open'));
}

function closeFilters() { setFiltersOpen(false); }
function syncFilterPanelForViewport() { closeFilters(); }

// ════════════════════════════════════════════════════════
//  EXPOSE TO GLOBAL SCOPE
// ════════════════════════════════════════════════════════
window.handleContinue         = handleContinue;
window.switchAuthMode         = switchAuthMode;
window.verifyOTP              = verifyOTP;
window.resendOTP              = resendOTP;
window.backToStep1            = backToStep1;
window.saveNewPassword        = saveNewPassword;
window.skipSetPassword        = skipSetPassword;
window.showResetStep          = showResetStep;
window.sendPasswordReset      = sendPasswordReset;
window.togglePwVisibility     = togglePwVisibility;
window.checkPasswordStrength  = checkPasswordStrength;
window.logout                 = logout;
window.showSection            = showSection;
window.loadPGs                = loadPGs;
window.submitPG               = submitPG;
window.handleFileSelect       = handleFileSelect;
window.closeDeleteModal       = closeDeleteModal;
window.closeDetailModal       = closeDetailModal;
window.closeAuthModal         = closeAuthModal;
window.cancelEdit             = cancelEdit;
window.filterLocationDropdown = filterLocationDropdown;
window.debouncedSearch        = debouncedSearch;
window.clearAllFilters        = clearAllFilters;
window.toggleFilters          = toggleFilters;
window.closeFilters           = closeFilters;

// ── Kick off ─────────────────────────────────────────────
init();
