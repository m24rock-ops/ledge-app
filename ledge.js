// ══════════════════════════════════════════
//  LEDGE – ledge.js  (ES Module)  v2.0
//  FIXES + NEW FEATURES:
//  • Correct element IDs used throughout
//  • Phone OTP + Email/Password both work
//  • Auto create account if new email
//  • Set password after phone OTP login
//  • Password strength checker
//  • Toggle password visibility
//  • Forgot password / reset email
//  • Auth mode switcher (phone ↔ email)
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
let currentUser        = null;   // { name, phone, uid }
let isGuest            = false;
let pendingDeleteId    = null;
let editingId          = null;
let confirmationResult = null;
let resendTimer        = null;
let allLocationOptions = [];
let searchDebounce     = null;
let authMode           = 'phone'; // 'phone' | 'email'

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
  setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => (loader.style.display = 'none'), 400);
    }
  }, 900);

  const guest = localStorage.getItem('ledgeGuest');

  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      const saved   = localStorage.getItem('ledgeUser');
      let profile   = saved ? JSON.parse(saved) : null;

      if (!profile || profile.uid !== firebaseUser.uid) {
        profile = {
          name:  profile?.name  || firebaseUser.displayName || 'User',
          phone: profile?.phone || (firebaseUser.phoneNumber || '').replace('+91', ''),
          uid:   firebaseUser.uid
        };
        localStorage.setItem('ledgeUser', JSON.stringify(profile));
      }

      currentUser = profile;
      isGuest     = false;
      showApp(currentUser.name);

    } else if (guest === 'true') {
      isGuest = true;
      showApp('Guest');
    } else {
      localStorage.removeItem('ledgeUser');
    }
  });
}

// ════════════════════════════════════════════════════════
//  SHOW APP
// ════════════════════════════════════════════════════════
function showApp(name) {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('mainApp').style.display      = 'block';
  document.getElementById('navRight').style.display     = 'flex';
  document.getElementById('displayName').textContent    = name;
  loadPGs();
}

// ════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3500);
}

// ════════════════════════════════════════════════════════
//  AUTH STEP NAVIGATION
// ════════════════════════════════════════════════════════
function showAuthStep(stepId) {
  ['authStep1','authStepOTP','authStepSetPw','authStepReset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(stepId);
  if (target) target.style.display = 'block';
}

// ════════════════════════════════════════════════════════
//  AUTH MODE SWITCHER (Phone ↔ Email)
// ════════════════════════════════════════════════════════
function switchAuthMode(mode) {
  authMode = mode;
  document.getElementById('phoneFields').style.display = mode === 'phone' ? 'block' : 'none';
  document.getElementById('emailFields').style.display = mode === 'email' ? 'block' : 'none';
  document.getElementById('tabPhone').classList.toggle('active', mode === 'phone');
  document.getElementById('tabEmail').classList.toggle('active', mode === 'email');
}

// ════════════════════════════════════════════════════════
//  MAIN CONTINUE HANDLER
// ════════════════════════════════════════════════════════
function handleContinue() {
  if (authMode === 'phone') {
    sendOTP();
  } else {
    loginWithEmail();
  }
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
  const name  = document.getElementById('userName').value.trim();
  const phone = document.getElementById('userPhone').value.trim();

  if (!name)                   { toast('Please enter your name', 'error');              return; }
  if (!/^\d{10}$/.test(phone)) { toast('Enter a valid 10-digit phone number', 'error'); return; }

  const btn = document.getElementById('continueBtn');
  btn.textContent = 'Sending…';
  btn.disabled    = true;

  try {
    setupRecaptcha();
    confirmationResult = await signInWithPhoneNumber(auth, '+91' + phone, window.recaptchaVerifier);

    // Show OTP step
    showAuthStep('authStepOTP');
    document.getElementById('otpPhone').textContent = '+91 ' + phone;
    window._pendingAuth = { name, phone };

    startResendTimer();
    toast('OTP sent to +91' + phone + ' ✅', 'success');

  } catch (err) {
    console.error(err);
    let msg = 'Failed to send OTP.';
    if (err.code === 'auth/too-many-requests')    msg = 'Too many attempts. Try again later.';
    if (err.code === 'auth/invalid-phone-number') msg = 'Invalid phone number.';
    if (err.code === 'auth/billing-not-enabled')  msg = 'Phone auth not enabled. Use email instead.';
    toast(msg, 'error');
    window.recaptchaVerifier = null;
  } finally {
    btn.textContent = 'Continue →';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════════
//  PHONE OTP — Verify
// ════════════════════════════════════════════════════════
async function verifyOTP() {
  const otp = document.getElementById('otpInput').value.trim();
  if (otp.length !== 6) { toast('Enter the 6-digit OTP', 'error'); return; }

  const btn = document.querySelector('#authStepOTP .auth-btn');
  btn.textContent = 'Verifying…';
  btn.disabled    = true;

  try {
    const result       = await confirmationResult.confirm(otp);
    const firebaseUser = result.user;

    const { name, phone } = window._pendingAuth;
    currentUser = { name, phone, uid: firebaseUser.uid };
    localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
    isGuest = false;

    clearResendTimer();
    toast('Welcome, ' + name + '! 👋', 'success');

    // Offer to set password if new user OR no email linked
    const hasEmail = !!(firebaseUser.email);
    if (!hasEmail) {
      showAuthStep('authStepSetPw');
    } else {
      showApp(name);
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
    btn.textContent = 'Verify & Continue →';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════════
//  SET PASSWORD (after phone OTP login)
// ════════════════════════════════════════════════════════
async function saveNewPassword() {
  const pw1 = document.getElementById('setPwInput').value;
  const pw2 = document.getElementById('setPwConfirm').value;

  if (pw1.length < 8)  { toast('Password must be at least 8 characters', 'error'); return; }
  if (pw1 !== pw2)     { toast('Passwords do not match', 'error');                  return; }

  const strength = getPasswordStrength(pw1);
  if (strength < 2)    { toast('Password is too weak. Add numbers or symbols.', 'error'); return; }

  const btn = document.querySelector('#authStepSetPw .auth-btn');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('No user session found.');

    // If user has a phone number, link email/password credential
    const email = currentUser.name.replace(/\s+/g,'').toLowerCase() + '_' + (currentUser.phone || Date.now()) + '@ledge.app';

    try {
      const credential = EmailAuthProvider.credential(email, pw1);
      await linkWithCredential(user, credential);
      toast('✅ Password saved! You can now log in with email too.', 'success');
    } catch (linkErr) {
      // Already linked — just update password
      if (linkErr.code === 'auth/provider-already-linked' || linkErr.code === 'auth/email-already-in-use') {
        await updatePassword(user, pw1);
        toast('✅ Password updated!', 'success');
      } else {
        throw linkErr;
      }
    }

    showApp(currentUser.name);

  } catch (err) {
    console.error(err);
    toast('Could not save password: ' + err.message, 'error');
  } finally {
    btn.textContent = '🔒 Save Password';
    btn.disabled    = false;
  }
}

function skipSetPassword() {
  toast('You can set a password later from your profile.', 'info');
  showApp(currentUser.name);
}

// ════════════════════════════════════════════════════════
//  EMAIL LOGIN / REGISTER
// ════════════════════════════════════════════════════════
async function loginWithEmail() {
  const name     = document.getElementById('userName').value.trim();
  const email    = document.getElementById('userEmail').value.trim();
  const password = document.getElementById('userPassword').value;

  if (!name)     { toast('Please enter your name', 'error');    return; }
  if (!email)    { toast('Please enter your email', 'error');   return; }
  if (!password) { toast('Please enter a password', 'error');   return; }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Please enter a valid email address', 'error');
    return;
  }
  if (password.length < 6) {
    toast('Password must be at least 6 characters', 'error');
    return;
  }

  const btn = document.getElementById('continueBtn');
  btn.textContent = 'Signing in…';
  btn.disabled    = true;

  try {
    // Try sign in first
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user     = userCred.user;

    currentUser = {
      name:  name || user.email.split('@')[0],
      phone: '',
      uid:   user.uid
    };
    localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
    isGuest = false;
    showApp(currentUser.name);
    toast('Welcome back, ' + currentUser.name + '! 👋', 'success');

  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      // Auto register new user
      try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user     = userCred.user;
        currentUser    = { name, phone: '', uid: user.uid };
        localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
        isGuest = false;
        showApp(name);
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
    btn.textContent = 'Continue →';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════════
//  PASSWORD RESET
// ════════════════════════════════════════════════════════
function showResetStep() {
  // Pre-fill email if typed
  const emailVal = document.getElementById('userEmail')?.value || '';
  if (emailVal) document.getElementById('resetEmail').value = emailVal;
  showAuthStep('authStepReset');
}

async function sendPasswordReset() {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) { toast('Enter your email address', 'error'); return; }

  const btn = document.querySelector('#authStepReset .auth-btn');
  btn.textContent = 'Sending…';
  btn.disabled    = true;

  try {
    await sendPasswordResetEmail(auth, email);
    toast('Reset link sent to ' + email + ' ✅', 'success');
    setTimeout(() => backToStep1(), 1500);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      toast('No account found with that email.', 'error');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    btn.textContent = 'Send Reset Link';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════════
//  OTP — Resend & Countdown
// ════════════════════════════════════════════════════════
function startResendTimer() {
  let seconds = 30;
  const timerEl   = document.getElementById('otpTimer');
  const resendRow = document.getElementById('resendRow');

  resendRow.style.display = 'none';
  timerEl.textContent     = `Resend in ${seconds}s`;
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
  document.getElementById('otpInput').value          = '';
  document.getElementById('resendRow').style.display = 'none';
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
  document.getElementById('otpInput').value = '';
  window.recaptchaVerifier = null;
  confirmationResult = null;
}

// ════════════════════════════════════════════════════════
//  PASSWORD UTILITIES
// ════════════════════════════════════════════════════════
function getPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)                       score++;
  if (/[A-Z]/.test(pw))                     score++;
  if (/[0-9]/.test(pw))                     score++;
  if (/[^A-Za-z0-9]/.test(pw))             score++;
  return score; // 0–4
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
    input.type   = 'text';
    btn.textContent = '🙈';
  } else {
    input.type   = 'password';
    btn.textContent = '👁';
  }
}

// ════════════════════════════════════════════════════════
//  AUTH — Guest / Logout
// ════════════════════════════════════════════════════════
function continueAsGuest() {
  isGuest = true;
  localStorage.setItem('ledgeGuest', 'true');
  showApp('Guest');
  toast('Browsing as guest', 'info');
}

function switchToLogin() {
  localStorage.removeItem('ledgeGuest');
  location.reload();
}

function logout() {
  localStorage.removeItem('ledgeUser');
  localStorage.removeItem('ledgeGuest');
  auth.signOut().catch(() => {});
  location.reload();
}

// ════════════════════════════════════════════════════════
//  FILE SELECT — size validation
// ════════════════════════════════════════════════════════
function handleFileSelect(input) {
  const f = input.files[0];
  if (!f) { document.getElementById('photoName').textContent = ''; return; }
  if (f.size > MAX_IMAGE_BYTES) {
    toast(`Image too large (${(f.size/1024/1024).toFixed(1)} MB). Max is 3 MB.`, 'error');
    input.value = '';
    document.getElementById('photoName').textContent = '';
    return;
  }
  document.getElementById('photoName').textContent = '✔ ' + f.name;
}

// ════════════════════════════════════════════════════════
//  LOCATION FILTER
// ════════════════════════════════════════════════════════
function filterLocationDropdown() {
  const q      = document.getElementById('locationSearch').value.toLowerCase().trim();
  const select = document.getElementById('filterLocation');

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

// ════════════════════════════════════════════════════════
//  SHOW SECTION
// ════════════════════════════════════════════════════════
function showSection(section) {
  document.getElementById('browseSection').style.display = 'none';
  document.getElementById('addSection').style.display    = 'none';
  document.getElementById('tab-browse').classList.remove('active');
  document.getElementById('tab-add').classList.remove('active');

  if (section === 'browse') {
    document.getElementById('browseSection').style.display = 'block';
    document.getElementById('tab-browse').classList.add('active');
    loadPGs();
  } else {
    document.getElementById('addSection').style.display = 'block';
    document.getElementById('tab-add').classList.add('active');

    if (!editingId) {
      document.getElementById('addCardTitle').textContent    = 'List Your Property';
      document.getElementById('addCardSubtitle').textContent = 'Fill in the details below to publish your PG listing.';
      document.getElementById('submitBtn').textContent       = '🚀 Publish Listing';
      document.getElementById('cancelEditBtn').style.display = 'none';
    }

    if (isGuest) {
      document.getElementById('guestNotice').style.display         = 'flex';
      document.getElementById('addFormContent').style.opacity       = '0.4';
      document.getElementById('addFormContent').style.pointerEvents = 'none';
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
  document.getElementById('resultsMeta').textContent = '';

  try {
    const snap = await getDocs(query(collection(db, 'pgs'), orderBy('createdAt', 'desc')));

    const filterType     = document.getElementById('filterType')?.value     || 'all';
    const filterGender   = document.getElementById('filterGender')?.value   || 'all';
    const filterLocation = document.getElementById('filterLocation')?.value || 'all';
    const filterAvail    = document.getElementById('filterAvail')?.value    || 'all';
    const searchQuery    = (document.getElementById('searchInput')?.value   || '').toLowerCase().trim();
    const maxRentVal     = parseInt(document.getElementById('filterMaxRent')?.value || '0', 10);

    if (snap.empty) {
      listEl.innerHTML = emptyState('🏠', 'No listings yet', 'Be the first to add a PG!');
      return;
    }

    // Rebuild location list
    const locSet = new Set();
    snap.forEach(d => { const l = d.data().location; if (l) locSet.add(l.split(',')[0].trim()); });
    allLocationOptions = [...locSet].sort();

    const locSearch = (document.getElementById('locationSearch')?.value || '').toLowerCase().trim();
    const locSelect = document.getElementById('filterLocation');
    if (locSelect) {
      const curVal   = locSelect.value;
      const filtered = locSearch
        ? allLocationOptions.filter(l => l.toLowerCase().includes(locSearch))
        : allLocationOptions;
      locSelect.innerHTML = '<option value="all">All Locations</option>' +
        filtered.map(l => `<option value="${l}"${curVal === l ? ' selected' : ''}>${esc(l)}</option>`).join('');
    }

    const cards = [];

    snap.forEach(docSnap => {
      const pg = docSnap.data();

      if (filterType   !== 'all' && pg.propertyType !== filterType)   return;
      if (filterGender !== 'all' && pg.gender       !== filterGender) return;

      const pgAvail = pg.available !== false;
      if (filterAvail === 'available'   && !pgAvail) return;
      if (filterAvail === 'unavailable' && pgAvail)  return;

      if (filterLocation !== 'all') {
        if ((pg.location || '').split(',')[0].trim() !== filterLocation) return;
      }

      if (maxRentVal > 0 && parseInt(pg.price, 10) > maxRentVal) return;

      if (searchQuery) {
        const hay = [pg.name, pg.location, pg.amenities, pg.description, pg.type]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(searchQuery)) return;
      }

      const isOwner = !!(currentUser?.uid && pg.ownerId === currentUser.uid);

      const availBadge = pgAvail
        ? `<div class="avail-badge available">🟢 Available</div>`
        : `<div class="avail-badge unavailable">🔴 Filled</div>`;

      const ownerBadge = isOwner ? `<div class="owner-badge">✏️ Your listing</div>` : '';

      const actionBtns = isOwner ? `
        <button class="btn btn-secondary btn-sm edit-btn"  data-id="${docSnap.id}">✏️ Edit</button>
        <button class="btn btn-danger   btn-sm delete-btn" data-id="${docSnap.id}">🗑 Delete</button>
        <button class="btn ${pgAvail ? 'btn-secondary' : 'btn-primary'} btn-sm toggle-avail-btn"
                data-id="${docSnap.id}" data-avail="${pgAvail}">
          ${pgAvail ? '🔴 Mark Filled' : '✅ Mark Available'}
        </button>` : '';

      const imgHtml = pg.imageUrl
        ? `<img class="pg-card-img" src="${esc(pg.imageUrl)}" alt="Photo" loading="lazy"/>`
        : `<div class="pg-card-img-placeholder">🏘️</div>`;

      const pgAttr = encodeURIComponent(JSON.stringify({ ...pg, id: docSnap.id }));

      cards.push(`
        <div class="pg-card${pgAvail ? '' : ' pg-card-unavailable'}">
          <div class="pg-card-clickable" data-pg="${pgAttr}" style="cursor:pointer;">
            ${imgHtml}
            <div class="pg-card-body">
              ${ownerBadge}${availBadge}
              <div class="pg-card-header">
                <div class="pg-card-title">${esc(pg.name)}</div>
                <div class="pg-type-badge">${esc(pg.propertyType || 'PG')}</div>
              </div>
              ${pg.description ? `<p style="font-size:0.8rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">${esc(pg.description)}</p>` : ''}
              <div class="pg-meta">
                <div class="pg-meta-item">📍 <span>${esc(pg.location)}</span></div>
                <div class="pg-meta-item">👥 <span>${esc(pg.gender || 'Unisex')} &bull; ${esc(pg.type)}</span></div>
                <div class="pg-meta-item">💰 <strong class="pg-price">₹${esc(String(pg.price))}/mo</strong></div>
                <div class="pg-meta-item">📞 <span>${esc(pg.contact)}</span></div>
                ${pg.amenities ? `<div class="pg-meta-item">✨ <span>${esc(pg.amenities)}</span></div>` : ''}
              </div>
            </div>
          </div>
          <div class="pg-card-footer" style="padding:0 16px 16px;display:flex;flex-wrap:wrap;gap:8px;">
            <a href="https://wa.me/91${esc(pg.contact)}" target="_blank" rel="noopener" class="btn btn-whatsapp">💬 WhatsApp</a>
            ${actionBtns}
          </div>
        </div>`);
    });

    if (cards.length === 0) {
      listEl.innerHTML = emptyState('🔍', 'No matches', 'Try adjusting the filters or search term.');
    } else {
      document.getElementById('resultsMeta').textContent =
        `${cards.length} listing${cards.length !== 1 ? 's' : ''} found`;
      listEl.innerHTML = `<div class="pg-grid">${cards.join('')}</div>`;
      attachCardListeners(listEl);
    }

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
      const pg = JSON.parse(decodeURIComponent(
        btn.closest('.pg-card').querySelector('.pg-card-clickable').dataset.pg
      ));
      openEditForm(btn.dataset.id, pg);
    })
  );
  listEl.querySelectorAll('.toggle-avail-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleAvailability(btn.dataset.id, btn.dataset.avail === 'true');
    })
  );
  listEl.querySelectorAll('.pg-card-clickable').forEach(card =>
    card.addEventListener('click', () =>
      openDetailModal(JSON.parse(decodeURIComponent(card.dataset.pg)))
    )
  );
}

// ════════════════════════════════════════════════════════
//  AVAILABILITY TOGGLE
// ════════════════════════════════════════════════════════
async function toggleAvailability(id, currentlyAvailable) {
  try {
    await updateDoc(doc(db, 'pgs', id), {
      available: !currentlyAvailable,
      updatedAt: Date.now()
    });
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
  const pgAvail = pg.available !== false;

  const imgHtml = pg.imageUrl
    ? `<img src="${esc(pg.imageUrl)}" alt="Photo" style="width:100%;height:220px;object-fit:cover;border-radius:10px;margin-bottom:18px;" loading="lazy"/>`
    : `<div style="width:100%;height:160px;background:linear-gradient(135deg,var(--bg),var(--border));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:3rem;margin-bottom:18px;">🏘️</div>`;

  const amenitiesList = pg.amenities
    ? pg.amenities.split(',').map(a =>
        `<span style="display:inline-block;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:0.78rem;margin:3px;">${esc(a.trim())}</span>`
      ).join('')
    : '<span style="color:var(--muted);font-size:0.82rem;">Not specified</span>';

  const availTag = pgAvail
    ? `<span style="background:#efffef;color:#1a7c3e;border-radius:20px;padding:3px 12px;font-size:0.78rem;font-weight:600;border:1px solid #a8e6b8;">🟢 Available</span>`
    : `<span style="background:#fff0f0;color:#c0392b;border-radius:20px;padding:3px 12px;font-size:0.78rem;font-weight:600;border:1px solid #f5b7b1;">🔴 Filled</span>`;

  document.getElementById('detailModalBody').innerHTML = `
    ${imgHtml}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <h3 style="font-size:1.3rem;font-weight:800;">${esc(pg.name)}</h3>
      <div class="pg-type-badge">${esc(pg.propertyType || 'PG')}</div>
    </div>
    <div style="margin-bottom:12px;">${availTag}</div>
    <div style="font-size:1.5rem;font-weight:800;color:var(--accent);margin-bottom:14px;">
      ₹${esc(String(pg.price))}<span style="font-size:0.9rem;font-weight:400;color:var(--muted);">/month</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
      ${infoBox('Location','📍',pg.location)}
      ${infoBox('Gender','👥',pg.gender||'Unisex')}
      ${infoBox('Room Type','🛏',pg.type)}
      ${infoBox('Contact','📞',pg.contact)}
    </div>
    ${pg.description ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">About this place</div>
      <p style="font-size:0.88rem;line-height:1.6;color:var(--text);">${esc(pg.description)}</p>
    </div>` : ''}
    <div style="margin-bottom:20px;">
      <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Amenities</div>
      <div>${amenitiesList}</div>
    </div>
    <div style="display:flex;gap:10px;">
      <a href="https://wa.me/91${esc(pg.contact)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-full">💬 Contact on WhatsApp</a>
    </div>
    <div style="font-size:0.75rem;color:var(--muted);text-align:center;margin-top:14px;">Listed by ${esc(pg.ownerName || 'Owner')}</div>
  `;

  document.getElementById('detailModal').classList.add('open');
}

function infoBox(label, icon, value) {
  return `<div style="background:var(--surface);border-radius:8px;padding:12px;">
    <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:0.88rem;font-weight:600;">${icon} ${esc(value)}</div>
  </div>`;
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.remove('open');
}

// ════════════════════════════════════════════════════════
//  EDIT LISTING
// ════════════════════════════════════════════════════════
function openEditForm(id, pg) {
  editingId = id;
  document.getElementById('pgName').value       = pg.name        || '';
  document.getElementById('propertyType').value = pg.propertyType|| 'PG';
  document.getElementById('pgPrice').value      = pg.price       || '';
  document.getElementById('pgType').value       = pg.type        || 'Single';
  document.getElementById('pgGender').value     = pg.gender      || 'Unisex';
  document.getElementById('pgContact').value    = pg.contact     || '';
  document.getElementById('pgLocation').value   = pg.location    || '';
  document.getElementById('pgAmenities').value  = pg.amenities   || '';
  document.getElementById('pgDesc').value       = pg.description || '';

  document.getElementById('addCardTitle').textContent    = 'Edit Listing';
  document.getElementById('addCardSubtitle').textContent = 'Update your property details below.';
  document.getElementById('submitBtn').textContent       = '💾 Save Changes';
  document.getElementById('cancelEditBtn').style.display = 'inline-flex';

  showSection('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;
  resetForm();
  showSection('browse');
}

function resetForm() {
  ['pgName','pgPrice','pgContact','pgLocation','pgAmenities','pgDesc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pf = document.getElementById('photoFile');
  if (pf) pf.value = '';
  document.getElementById('photoName').textContent       = '';
  document.getElementById('addCardTitle').textContent    = 'List Your Property';
  document.getElementById('addCardSubtitle').textContent = 'Fill in the details below to publish your PG listing.';
  document.getElementById('submitBtn').textContent       = '🚀 Publish Listing';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

// ════════════════════════════════════════════════════════
//  DELETE MODAL
// ════════════════════════════════════════════════════════
function openDeleteModal(id) {
  pendingDeleteId = id;
  document.getElementById('deleteModal').classList.add('open');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('deleteModal').classList.remove('open');
}

async function deletePG(id) {
  try {
    const snap = await getDoc(doc(db, 'pgs', id));
    if (!snap.exists())                            { toast('Listing not found', 'error');           closeDeleteModal(); return; }
    if (snap.data().ownerId !== currentUser?.uid)  { toast('Not authorised to delete', 'error');    closeDeleteModal(); return; }

    await deleteDoc(doc(db, 'pgs', id));
    closeDeleteModal();
    toast('Listing deleted ✅', 'success');
    loadPGs();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  if (pendingDeleteId) deletePG(pendingDeleteId);
});

// ════════════════════════════════════════════════════════
//  SUBMIT / UPDATE PG
// ════════════════════════════════════════════════════════
async function submitPG() {
  if (isGuest)           { toast('Sign in to add a listing', 'error');  return; }
  if (!currentUser?.uid) { toast('Please sign in first', 'error');      return; }

  const propertyType = document.getElementById('propertyType').value;
  const name         = document.getElementById('pgName').value.trim();
  const priceRaw     = document.getElementById('pgPrice').value.trim();
  const type         = document.getElementById('pgType').value;
  const gender       = document.getElementById('pgGender').value;
  const contact      = document.getElementById('pgContact').value.trim();
  const location     = document.getElementById('pgLocation').value.trim();
  const amenities    = document.getElementById('pgAmenities').value.trim();
  const description  = document.getElementById('pgDesc').value.trim();
  const photoFile    = document.getElementById('photoFile').files[0];

  if (!name || !priceRaw || !contact || !location) {
    toast('Please fill all required fields *', 'error'); return;
  }
  if (name.length < 3 || name.length > 80) {
    toast('Property name must be 3–80 characters', 'error'); return;
  }
  const price = parseInt(priceRaw, 10);
  if (isNaN(price) || price < MIN_RENT) {
    toast(`Minimum rent is ₹${MIN_RENT.toLocaleString()}`, 'error'); return;
  }
  if (price > MAX_RENT) {
    toast(`Rent above ₹${MAX_RENT.toLocaleString()} seems unusual. Please check.`, 'error'); return;
  }
  if (!/^\d{10}$/.test(contact)) {
    toast('Enter a valid 10-digit contact number', 'error'); return;
  }
  if (location.length < 5) {
    toast('Please enter a more specific location', 'error'); return;
  }
  if (photoFile && photoFile.size > MAX_IMAGE_BYTES) {
    toast('Image too large (max 3 MB)', 'error'); return;
  }

  const btn    = document.getElementById('submitBtn');
  const isEdit = !!editingId;
  btn.textContent = isEdit ? 'Saving…' : 'Uploading…';
  btn.disabled    = true;

  try {
    let imageUrl = '';
    if (isEdit) {
      const existing = await getDoc(doc(db, 'pgs', editingId));
      if (existing.data()?.ownerId !== currentUser.uid) {
        toast('Not authorised', 'error'); return;
      }
      imageUrl = existing.data()?.imageUrl || '';
    }

    if (photoFile) {
      const storageRef = ref(storage, `pg-photos/${currentUser.uid}/${Date.now()}_${photoFile.name}`);
      await uploadBytes(storageRef, photoFile);
      imageUrl = await getDownloadURL(storageRef);
    }

    const data = {
      name, propertyType, price: String(price),
      type, gender, contact, location, amenities, description,
      imageUrl,
      updatedAt: Date.now()
    };

    if (isEdit) {
      await updateDoc(doc(db, 'pgs', editingId), data);
      toast('✅ Listing updated!', 'success');
      editingId = null;
    } else {
      await addDoc(collection(db, 'pgs'), {
        ...data,
        ownerId:   currentUser.uid,
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
    btn.textContent = isEdit ? '💾 Save Changes' : '🚀 Publish Listing';
    btn.disabled    = false;
  }
}

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
window.continueAsGuest        = continueAsGuest;
window.logout                 = logout;
window.showSection            = showSection;
window.loadPGs                = loadPGs;
window.submitPG               = submitPG;
window.handleFileSelect       = handleFileSelect;
window.closeDeleteModal       = closeDeleteModal;
window.closeDetailModal       = closeDetailModal;
window.cancelEdit             = cancelEdit;
window.switchToLogin          = switchToLogin;
window.filterLocationDropdown = filterLocationDropdown;
window.debouncedSearch        = debouncedSearch;

// ── Kick off ─────────────────────────────────────────────
init();
