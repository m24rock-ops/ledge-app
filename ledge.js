// ══════════════════════════════════════════
//  LEDGE – app.js  (ES Module)
// ══════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs,
  query, orderBy, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

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

// ── State ────────────────────────────────────────────────
let currentUser     = null;
let isGuest         = false;
let pendingDeleteId = null;

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════
function init() {
  const saved = localStorage.getItem('ledgeUser');
  const guest = localStorage.getItem('ledgeGuest');

  if (saved) {
    currentUser = JSON.parse(saved);
    showApp(currentUser.name);
  } else if (guest === 'true') {
    isGuest = true;
    showApp('Guest');
  }

  // Hide loader after short delay
  setTimeout(() => {
    const loader = document.getElementById('loader');
    loader.style.opacity = '0';
    setTimeout(() => (loader.style.display = 'none'), 400);
  }, 900);
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
  el.className = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3000);
}

// ════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════
function login() {
  const name  = document.getElementById('userName').value.trim();
  const phone = document.getElementById('userPhone').value.trim();

  if (!name || !phone) {
    toast('Please fill both fields', 'error');
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    toast('Enter a valid 10-digit phone number', 'error');
    return;
  }

  currentUser = { name, phone, id: Date.now() };
  localStorage.setItem('ledgeUser', JSON.stringify(currentUser));
  isGuest = false;
  showApp(name);
  toast('Welcome, ' + name + '! 👋', 'success');
}

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
  location.reload();
}

// ════════════════════════════════════════════════════════
//  FILE SELECT
// ════════════════════════════════════════════════════════
function handleFileSelect(input) {
  const f = input.files[0];
  document.getElementById('photoName').textContent = f ? '✔ ' + f.name : '';
}

// ════════════════════════════════════════════════════════
//  SHOW SECTION (TABS)
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
  } else if (section === 'add') {
    document.getElementById('addSection').style.display = 'block';
    document.getElementById('tab-add').classList.add('active');

    if (isGuest) {
      document.getElementById('guestNotice').style.display          = 'flex';
      document.getElementById('addFormContent').style.opacity        = '0.4';
      document.getElementById('addFormContent').style.pointerEvents  = 'none';
    }
  }
}

// ════════════════════════════════════════════════════════
//  LOAD PGs FROM FIRESTORE
// ════════════════════════════════════════════════════════
async function loadPGs() {
  const listEl = document.getElementById('pgList');
  listEl.innerHTML = '<div class="spinner"></div>';
  document.getElementById('resultsMeta').textContent = '';

  try {
    const q        = query(collection(db, 'pgs'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);

    const filterType   = document.getElementById('filterType')?.value   || 'all';
    const filterGender = document.getElementById('filterGender')?.value || 'all';

    if (snapshot.empty) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">🏠</div>
          <h4>No listings yet</h4>
          <p>Be the first to add a PG!</p>
        </div>`;
      return;
    }

    const cards = [];

    snapshot.forEach(docSnap => {
      const pg = docSnap.data();

      if (filterType   !== 'all' && pg.propertyType !== filterType)   return;
      if (filterGender !== 'all' && pg.gender       !== filterGender) return;

      const isOwner = currentUser && pg.ownerId === currentUser.id;

      const imgHtml = pg.imageUrl
        ? `<img class="pg-card-img" src="${pg.imageUrl}" alt="Photo"/>`
        : `<div class="pg-card-img-placeholder">🏘️</div>`;

      const ownerBadge = isOwner
        ? `<div class="owner-badge">✏️ Your listing</div>` : '';

      const deleteBtn = isOwner
        ? `<button class="btn btn-danger btn-sm delete-btn" data-id="${docSnap.id}">🗑 Delete</button>`
        : '';

      const amenitiesHtml = pg.amenities
        ? `<div class="pg-meta-item">✨ <span>${pg.amenities}</span></div>` : '';

      const descHtml = pg.description
        ? `<p style="font-size:0.8rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">${pg.description}</p>`
        : '';

      cards.push(`
        <div class="pg-card">
          ${imgHtml}
          <div class="pg-card-body">
            ${ownerBadge}
            <div class="pg-card-header">
              <div class="pg-card-title">${pg.name}</div>
              <div class="pg-type-badge">${pg.propertyType || 'PG'}</div>
            </div>
            ${descHtml}
            <div class="pg-meta">
              <div class="pg-meta-item">📍 <span>${pg.location}</span></div>
              <div class="pg-meta-item">👥 <span>${pg.gender || 'Unisex'} &bull; ${pg.type}</span></div>
              <div class="pg-meta-item">💰 <strong class="pg-price">₹${pg.price}/mo</strong></div>
              <div class="pg-meta-item">📞 <span>${pg.contact}</span></div>
              ${amenitiesHtml}
            </div>
            <div class="pg-card-footer">
              <a href="https://wa.me/91${pg.contact}" target="_blank" class="btn btn-whatsapp">💬 WhatsApp</a>
              ${deleteBtn}
            </div>
          </div>
        </div>
      `);
    });

    if (cards.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">🔍</div>
          <h4>No matches</h4>
          <p>Try changing the filters.</p>
        </div>`;
    } else {
      document.getElementById('resultsMeta').textContent =
        `${cards.length} listing${cards.length !== 1 ? 's' : ''} found`;
      listEl.innerHTML = `<div class="pg-grid">${cards.join('')}</div>`;

      // Attach delete listeners after rendering
      listEl.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
      });
    }

  } catch (err) {
    console.error(err);
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h4>Failed to load</h4>
        <p>${err.message}</p>
      </div>`;
  }
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
    await deleteDoc(doc(db, 'pgs', id));
    closeDeleteModal();
    toast('Listing deleted', 'success');
    loadPGs();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// Confirm delete button listener
document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  if (pendingDeleteId) deletePG(pendingDeleteId);
});

// ════════════════════════════════════════════════════════
//  SUBMIT PG TO FIRESTORE
// ════════════════════════════════════════════════════════
async function submitPG() {
  if (isGuest) {
    toast('Sign in to add a listing', 'error');
    return;
  }

  const propertyType = document.getElementById('propertyType').value;
  const name         = document.getElementById('pgName').value.trim();
  const price        = document.getElementById('pgPrice').value.trim();
  const type         = document.getElementById('pgType').value;
  const gender       = document.getElementById('pgGender').value;
  const contact      = document.getElementById('pgContact').value.trim();
  const location     = document.getElementById('pgLocation').value.trim();
  const amenities    = document.getElementById('pgAmenities').value.trim();
  const description  = document.getElementById('pgDesc').value.trim();
  const photoFile    = document.getElementById('photoFile').files[0];

  if (!name || !price || !contact || !location) {
    toast('Please fill all required fields *', 'error');
    return;
  }
  if (!/^\d{10}$/.test(contact)) {
    toast('Enter a valid 10-digit contact number', 'error');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Uploading…';
  btn.disabled = true;

  try {
    let imageUrl = '';
    if (photoFile) {
      const storageRef = ref(storage, `pg-photos/${Date.now()}_${photoFile.name}`);
      await uploadBytes(storageRef, photoFile);
      imageUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, 'pgs'), {
      name, propertyType, price, type, gender,
      contact, location, amenities, description,
      imageUrl,
      ownerId:   currentUser?.id   || null,
      ownerName: currentUser?.name || 'Unknown',
      createdAt: Date.now()
    });

    toast('🎉 Listing published!', 'success');

    // Reset form fields
    ['pgName', 'pgPrice', 'pgContact', 'pgLocation', 'pgAmenities', 'pgDesc'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('photoFile').value   = '';
    document.getElementById('photoName').textContent = '';

    showSection('browse');

  } catch (err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.textContent = '🚀 Publish Listing';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════════
//  EXPOSE TO GLOBAL SCOPE
//  (Required because type="module" isolates scope — this
//   fixes "function is not defined" errors from onclick="")
// ════════════════════════════════════════════════════════
window.login            = login;
window.continueAsGuest  = continueAsGuest;
window.logout           = logout;
window.showSection      = showSection;
window.loadPGs          = loadPGs;
window.submitPG         = submitPG;
window.handleFileSelect = handleFileSelect;
window.closeDeleteModal = closeDeleteModal;
window.switchToLogin    = switchToLogin;

// ── Kick off ─────────────────────────────────────────────
init();
