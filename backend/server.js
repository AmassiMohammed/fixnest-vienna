const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fixnest_secret_2026';

// ── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Datenbank ─────────────────────────────────────────────────────
const db = new sqlite3.Database('./fixnest.db', (err) => {
  if (err) console.error('DB Fehler:', err);
  else console.log('✅ SQLite Datenbank verbunden');
});

db.serialize(() => {
  // Users Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'customer',
    district TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Craftsmen Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS craftsmen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    initials TEXT,
    role TEXT,
    district TEXT,
    rating REAL DEFAULT 0,
    color TEXT DEFAULT '#2E7DD1',
    online INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    response_time TEXT DEFAULT '~15 Min.',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tools Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    district TEXT,
    available INTEGER DEFAULT 1,
    owner_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Bookings Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    craftsman_name TEXT,
    description TEXT,
    district TEXT,
    address TEXT,
    date TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Reviews Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    craftsman_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Messages Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Conversations Tabelle
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    last_message TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1_id, user2_id)
  )`);

  // Demo Handwerker einfügen (nur wenn leer)
  db.get(`SELECT COUNT(*) as count FROM craftsmen`, [], (err, row) => {
    if (row && row.count === 0) {
      const craftsmen = [
        ['Martin Kaufmann',  'MK', 'Klempner',    '1010 Wien', 4.9, '#2E7DD1', 1],
        ['Sandra Fischer',   'SF', 'Elektrikerin', '1030 Wien', 4.6, '#18A16A', 0],
        ['Anna Huber',       'AH', 'Malerin',      '1010 Wien', 4.7, '#7C5ABF', 1],
        ['Josef Berger',     'JB', 'Elektriker',   '1010 Wien', 4.5, '#C05A20', 0],
        ['Klaus Weber',      'KW', 'Tischler',     '1020 Wien', 4.8, '#D4821A', 1],
        ['Maria Novak',      'MN', 'Klempnerin',   '1050 Wien', 4.4, '#C0392B', 0],
        ['Peter Huber',      'PH', 'Maler',        '1080 Wien', 4.6, '#2E7DD1', 1],
        ['Lisa Müller',      'LM', 'Elektrikerin', '1090 Wien', 4.7, '#18A16A', 1],
      ];
      craftsmen.forEach(c => {
        db.run(
          `INSERT INTO craftsmen (name, initials, role, district, rating, color, online) VALUES (?,?,?,?,?,?,?)`,
          c
        );
      });
      console.log('✅ Demo-Handwerker eingefügt');
    }
  });
});

// ── Auth Middleware ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Kein Token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

// ══════════════════════════════════════════════════════════════════
//  AUTH ROUTEN
// ══════════════════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', (req, res) => {
  const { first_name, last_name, email, password, role, district, beruf } = req.body;
  if (!first_name || !email || !password)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });

  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (first_name, last_name, email, password, role, district) VALUES (?,?,?,?,?,?)`,
    [first_name, last_name, email, hash, role || 'customer', district || ''],
    function (err) {
      if (err) return res.status(400).json({ error: 'E-Mail bereits vergeben' });
      const userId = this.lastID;
      const token = jwt.sign({ id: userId, email, role: role || 'customer' }, JWT_SECRET);

      // Wenn Handwerker → zur craftsmen Tabelle hinzufügen
      if (role === 'craftsman' && beruf) {
        const initials = (first_name[0] + (last_name ? last_name[0] : '')).toUpperCase();
        const colors = ['#2E7DD1', '#18A16A', '#7C5ABF', '#C05A20', '#D4821A', '#C0392B'];
        const color = colors[userId % colors.length];
        db.run(
          `INSERT INTO craftsmen (user_id, name, initials, role, district, color, online) VALUES (?,?,?,?,?,?,1)`,
          [userId, first_name + ' ' + last_name, initials, beruf, district, color]
        );
      }

      res.json({
        token,
        user: { id: userId, first_name, last_name, email, role: role || 'customer', district }
      });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (!user) return res.status(400).json({ error: 'E-Mail oder Passwort falsch' });
    if (!bcrypt.compareSync(password, user.password))
      return res.status(400).json({ error: 'E-Mail oder Passwort falsch' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
    res.json({
      token,
      user: {
        id: user.id, first_name: user.first_name, last_name: user.last_name,
        email: user.email, role: user.role, district: user.district,
        created_at: user.created_at
      }
    });
  });
});

// Get current user
app.get('/api/auth/me', auth, (req, res) => {
  db.get(
    `SELECT id, first_name, last_name, email, role, district, created_at FROM users WHERE id = ?`,
    [req.user.id],
    (err, user) => {
      if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
      res.json(user);
    }
  );
});

// ══════════════════════════════════════════════════════════════════
//  CRAFTSMEN ROUTEN
// ══════════════════════════════════════════════════════════════════

// Alle Handwerker
app.get('/api/craftsmen', (req, res) => {
  db.all(`SELECT * FROM craftsmen ORDER BY rating DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// Handwerker nach Bezirk
app.get('/api/craftsmen/district/:district', (req, res) => {
  db.all(
    `SELECT * FROM craftsmen WHERE district LIKE ? ORDER BY rating DESC`,
    ['%' + req.params.district + '%'],
    (err, rows) => res.json(rows || [])
  );
});

// ══════════════════════════════════════════════════════════════════
//  TOOLS ROUTEN
// ══════════════════════════════════════════════════════════════════

// Alle Werkzeuge
app.get('/api/tools', (req, res) => {
  db.all(
    `SELECT tools.*, users.first_name, users.last_name
     FROM tools LEFT JOIN users ON tools.owner_id = users.id
     ORDER BY tools.created_at DESC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

// Werkzeug hinzufügen
app.post('/api/tools', auth, (req, res) => {
  const { name, description, category, district } = req.body;
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  db.run(
    `INSERT INTO tools (name, description, category, district, owner_id) VALUES (?,?,?,?,?)`,
    [name, description, category, district, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, category, district, available: 1 });
    }
  );
});

// ══════════════════════════════════════════════════════════════════
//  BOOKINGS ROUTEN
// ══════════════════════════════════════════════════════════════════

// Termin buchen
app.post('/api/bookings', auth, (req, res) => {
  const { craftsman_name, description, district, address, date } = req.body;
  db.run(
    `INSERT INTO bookings (user_id, craftsman_name, description, district, address, date) VALUES (?,?,?,?,?,?)`,
    [req.user.id, craftsman_name, description, district, address, date],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, status: 'pending' });
    }
  );
});

// Meine Buchungen
app.get('/api/bookings/my', auth, (req, res) => {
  db.all(
    `SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id],
    (err, rows) => res.json(rows || [])
  );
});

// ══════════════════════════════════════════════════════════════════
//  REVIEWS ROUTEN
// ══════════════════════════════════════════════════════════════════

// Bewertung hinzufügen
app.post('/api/reviews', auth, (req, res) => {
  const { craftsman_name, rating, comment } = req.body;
  if (!craftsman_name || !rating)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  db.run(
    `INSERT INTO reviews (user_id, craftsman_name, rating, comment) VALUES (?,?,?,?)`,
    [req.user.id, craftsman_name, rating, comment],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, craftsman_name, rating, comment });
    }
  );
});

// Bewertungen für einen Handwerker
app.get('/api/reviews/:craftsman', (req, res) => {
  db.all(
    `SELECT reviews.*, users.first_name, users.last_name
     FROM reviews LEFT JOIN users ON reviews.user_id = users.id
     WHERE reviews.craftsman_name = ?
     ORDER BY reviews.created_at DESC`,
    [req.params.craftsman],
    (err, rows) => res.json(rows || [])
  );
});

// ══════════════════════════════════════════════════════════════════
//  MESSAGES & CONVERSATIONS ROUTEN
// ══════════════════════════════════════════════════════════════════

// Nachricht senden
app.post('/api/messages', auth, (req, res) => {
  const { receiver_id, message } = req.body;
  if (!message || !receiver_id)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });

  db.run(
    `INSERT INTO messages (sender_id, receiver_id, message) VALUES (?,?,?)`,
    [req.user.id, receiver_id, message],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // Konversation erstellen oder aktualisieren
      const u1 = Math.min(req.user.id, receiver_id);
      const u2 = Math.max(req.user.id, receiver_id);
      db.run(
        `INSERT INTO conversations (user1_id, user2_id, last_message, updated_at)
         VALUES (?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(user1_id, user2_id)
         DO UPDATE SET last_message=?, updated_at=CURRENT_TIMESTAMP`,
        [u1, u2, message, message]
      );

      res.json({ id: this.lastID, message, created_at: new Date().toISOString() });
    }
  );
});

// Nachrichten zwischen zwei Usern
app.get('/api/messages/:receiver_id', auth, (req, res) => {
  db.all(
    `SELECT messages.*, users.first_name as sender_first, users.last_name as sender_last
     FROM messages
     LEFT JOIN users ON messages.sender_id = users.id
     WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
     ORDER BY created_at ASC`,
    [req.user.id, req.params.receiver_id, req.params.receiver_id, req.user.id],
    (err, rows) => res.json(rows || [])
  );
});

// Alle Konversationen des Users
app.get('/api/conversations', auth, (req, res) => {
  db.all(
    `SELECT conversations.*,
            u1.first_name as u1_first, u1.last_name as u1_last,
            u2.first_name as u2_first, u2.last_name as u2_last
     FROM conversations
     LEFT JOIN users u1 ON conversations.user1_id = u1.id
     LEFT JOIN users u2 ON conversations.user2_id = u2.id
     WHERE user1_id=? OR user2_id=?
     ORDER BY updated_at DESC`,
    [req.user.id, req.user.id],
    (err, rows) => res.json(rows || [])
  );
});

// ══════════════════════════════════════════════════════════════════
//  USERS ROUTEN
// ══════════════════════════════════════════════════════════════════

// User nach Name suchen (für Chat)
app.get('/api/users', (req, res) => {
  const name = req.query.name || '';
  const parts = name.trim().split(' ');
  db.get(
    `SELECT id, first_name, last_name, role FROM users WHERE first_name=? AND last_name=?`,
    [parts[0], parts[1] || ''],
    (err, row) => res.json(row || {})
  );
});

// ── Health Check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '🔧 FixNest Vienna API läuft!' });
});

// ── Alle anderen Routen → index.html ──────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Server starten ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔧 FixNest Vienna läuft auf http://localhost:${PORT}`);
  console.log(`📋 Endpunkte:`);
  console.log(`   POST /api/auth/register`);
  console.log(`   POST /api/auth/login`);
  console.log(`   GET  /api/craftsmen`);
  console.log(`   GET  /api/tools`);
  console.log(`   POST /api/tools`);
  console.log(`   POST /api/bookings`);
  console.log(`   POST /api/reviews`);
  console.log(`   GET  /api/reviews/:craftsman`);
  console.log(`   POST /api/messages`);
  console.log(`   GET  /api/messages/:receiver_id`);
  console.log(`   GET  /api/conversations`);
  console.log(`   GET  /api/health`);
});