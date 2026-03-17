    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getFirestore, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc }
      from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
    import { getStorage, ref, uploadBytes, getDownloadURL }
      from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

    // 🔥 Firebase Config
    const firebaseConfig = {
      apiKey: "AIzaSyB2mMkDkSU7CBRcnqhhO87WSj7yWf3lCzo",
      authDomain: "led-ge.firebaseapp.com",
      projectId: "led-ge",
      storageBucket: "led-ge.firebasestorage.app",
      messagingSenderId: "303796257325",
      appId: "1:303796257325:web:81ea3d222eb1f476c3eea4",
      measurementId: "G-R061Y0PYNE"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const storage = getStorage(app);

    let currentUser = null;

    // ── Login ──────────────────────────────────────────────
    function login() {
      const name  = document.getElementById('userName').value.trim();
      const phone = document.getElementById('userPhone').value.trim();

      if (!name || !phone) {
        alert('Please fill both fields');
        return;
      }

      currentUser = { name, phone, id: Date.now() };
      localStorage.setItem('ledgeUser', JSON.stringify(currentUser));

      document.getElementById('loginSection').style.display = 'none';
      document.getElementById('mainApp').style.display = 'block';
      document.getElementById('displayName').textContent = name;

      alert('Welcome ' + name + '!');
    }

    // ── Logout ─────────────────────────────────────────────
    function logout() {
      localStorage.removeItem('ledgeUser');
      location.reload();
    }

    // ── Show Section ───────────────────────────────────────
    function showSection(section) {
      document.getElementById('browseSection').style.display = 'none';
      document.getElementById('addSection').style.display   = 'none';

      if (section === 'browse') {
        document.getElementById('browseSection').style.display = 'block';
        loadPGs();
      } else if (section === 'add') {
        document.getElementById('addSection').style.display = 'block';
      }
    }

    // ── Load PGs from Firestore ────────────────────────────
    async function loadPGs() {
      try {
        const q        = query(collection(db, 'pgs'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const filter   = document.getElementById('filterType')?.value || 'all';

        if (snapshot.empty) {
          document.getElementById('pgList').innerHTML = '<p>No PGs listed yet. Be the first!</p>';
          return;
        }

        let html = '';
        snapshot.forEach(docSnap => {
          const pg      = docSnap.data();
          const isOwner = currentUser && pg.ownerId === currentUser.id;

          if (filter !== 'all' && pg.propertyType !== filter) return;

          const imageHtml = pg.imageUrl
            ? `<img src="${pg.imageUrl}" alt="Property photo"
                 style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;margin-bottom:8px;">`
            : '';

          const deleteBtn = isOwner
            ? `<button data-id="${docSnap.id}" class="delete-btn"
                 style="margin-top:8px;background:#ef4444;color:white;border:none;
                        padding:6px 10px;border-radius:6px;cursor:pointer;">
                 Delete
               </button>`
            : '';

          html += `
            <div style="border:1px solid #ddd;padding:12px;border-radius:8px;margin-bottom:12px;">
              ${imageHtml}
              <h3 style="margin-bottom:6px;">${pg.name} (${pg.propertyType})</h3>
              <p>📍 ${pg.location}</p>
              <p>💰 Rent: ₹${pg.price} / month &bull; ${pg.type}</p>
              <p>📞 ${pg.contact}</p>
              <a href="https://wa.me/91${pg.contact}" target="_blank"
                 style="display:inline-block;margin-top:6px;background:#25D366;color:white;
                        padding:6px 10px;border-radius:6px;text-decoration:none;">
                Chat on WhatsApp
              </a>
              ${deleteBtn}
            </div>
          `;
        });

        document.getElementById('pgList').innerHTML = html || '<p>No properties match the filter.</p>';

        // Attach delete listeners after rendering
        document.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', () => deletePG(btn.dataset.id));
        });

      } catch (err) {
        console.error('Error loading PGs:', err);
        document.getElementById('pgList').innerHTML = '<p>Error loading PGs</p>';
      }
    }

    // ── Submit PG to Firestore ─────────────────────────────
    async function submitPG() {
      try {
        const propertyType = document.getElementById('propertyType').value;
        const name         = document.getElementById('pgName').value.trim();
        const price        = document.getElementById('pgPrice').value.trim();
        const location     = document.getElementById('pgLocation').value.trim();
        const type         = document.getElementById('pgType').value;
        const contact      = document.getElementById('pgContact').value.trim();
        const file         = document.getElementById('pgImage').files[0];

        if (!propertyType || !name || !price || !location || !type || !contact) {
          alert('Please fill all fields');
          return;
        }

        let imageUrl = '';
        if (file) {
          const imageRef = ref(storage, 'pgImages/' + Date.now());
          await uploadBytes(imageRef, file);
          imageUrl = await getDownloadURL(imageRef);
        }

        await addDoc(collection(db, 'pgs'), {
          propertyType,
          name,
          price: parseInt(price),
          location,
          type,
          contact,
          imageUrl,
          ownerId:   currentUser.id,
          ownerName: currentUser.name,
          createdAt: new Date()
        });

        alert('PG listed successfully!');

        // Clear form
        document.getElementById('propertyType').value = '';
        document.getElementById('pgName').value       = '';
        document.getElementById('pgPrice').value      = '';
        document.getElementById('pgLocation').value   = '';
        document.getElementById('pgType').value       = '';
        document.getElementById('pgContact').value    = '';
        document.getElementById('pgImage').value      = '';

        showSection('browse');
      } catch (err) {
        console.error('Error adding PG:', err);
        alert('Error listing PG. Check console.');
      }
    }

    // ── Delete PG ─────────────────────────────────────────
    async function deletePG(id) {
      if (confirm('Are you sure you want to delete this PG?')) {
        try {
          await deleteDoc(doc(db, 'pgs', id));
          loadPGs();
        } catch (err) {
          console.error('Error deleting PG:', err);
          alert('Error deleting PG');
        }
      }
    }

    // ── Wire up buttons ────────────────────────────────────
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('browsBtn').addEventListener('click', () => showSection('browse'));
    document.getElementById('addBtn').addEventListener('click', () => showSection('add'));
    document.getElementById('submitBtn').addEventListener('click', submitPG);
    document.getElementById('backBtn').addEventListener('click', () => showSection('browse'));
    document.getElementById('filterType').addEventListener('change', loadPGs);

    // ── Auto-login if session saved ────────────────────────
    const saved = localStorage.getItem('ledgeUser');
    if (saved) {
      currentUser = JSON.parse(saved);
      document.getElementById('loginSection').style.display = 'none';
      document.getElementById('mainApp').style.display      = 'block';
      document.getElementById('displayName').textContent    = currentUser.name;
    }
