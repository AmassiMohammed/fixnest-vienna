const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fixnest_secret';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Datenbank Setup ──────────────────────────────────────
const db = new sqlite3.Database('./fixnest.db', (err) => {
  if (err) console.error(err);
  else console.log('✅ SQLite Datenbank verbunden');
});

db.serialize(() => {
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

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    craftsman_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS craftsmen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_name TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});
  // Demo Handwerker einfügen
db.get(`SELECT COUNT(*) as count FROM craftsmen`, [], (err, row) => {
  if(row && row.count === 0) {
    const craftsmen = [
      ['Martin Kaufmann','MK','Klempner','1010 Wien',4.9,'#2E7DD1',1],
      ['Sandra Fischer','SF','Elektrikerin','1030 Wien',4.6,'#18A16A',0],
      ['Anna Huber','AH','Malerin','1010 Wien',4.7,'#7C5ABF',1],
      ['Josef Berger','JB','Elektriker','1010 Wien',4.5,'#C05A20',0],
      ['Klaus Weber','KW','Tischler','1020 Wien',4.8,'#D4821A',1],
      ['Maria Novak','MN','Klempnerin','1050 Wien',4.4,'#C0392B',0],
      ['Peter Huber','PH','Maler','1080 Wien',4.6,'#2E7DD1',1],
      ['Lisa Müller','LM','Elektrikerin','1090 Wien',4.7,'#18A16A',1],
    ];
    craftsmen.forEach(c => {
      db.run(`INSERT INTO craftsmen (name,initials,role,district,rating,color,online) VALUES (?,?,?,?,?,?,?)`, c);
    });
    console.log('✅ Demo-Handwerker eingefügt');
  }
    });


// ── Auth Middleware ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Kein Token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

// ── ROUTES ────────────────────────────────────────────────

// Register
app.post('/api/auth/register', (req, res) => {
  const { first_name, last_name, email, password, role, district } = req.body;
  if (!first_name || !email || !password)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });

  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (first_name, last_name, email, password, role, district) VALUES (?,?,?,?,?,?)`,
    [first_name, last_name, email, hash, role || 'customer', district || ''],
    function (err) {
      if (err) return res.status(400).json({ error: 'E-Mail bereits vergeben' });
      const token = jwt.sign({ id: this.lastID, email, role: role || 'customer' }, JWT_SECRET);
      res.json({ token, user: { id: this.lastID, first_name, last_name, email, role, district } });
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
    res.json({ token, user: { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role, district: user.district } });
  });
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  db.get(`SELECT id, first_name, last_name, email, role, district FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    res.json(user);
  });
});

// Get tools
app.get('/api/tools', (req, res) => {
  db.all(`SELECT tools.*, users.first_name, users.last_name FROM tools LEFT JOIN users ON tools.owner_id = users.id`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// Add tool
app.post('/api/tools', authMiddleware, (req, res) => {
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

// Add booking
app.post('/api/bookings', authMiddleware, (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'FixNest API läuft!' }));



// Bewertung hinzufügen
app.post('/api/reviews', authMiddleware, (req, res) => {
  const { craftsman_name, rating, comment } = req.body;
  if (!craftsman_name || !rating)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  db.run(
    `INSERT INTO reviews (user_id, craftsman_name, rating, comment) VALUES (?,?,?,?)`,
    [req.user.id, craftsman_name, rating, comment],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, craftsman_name, rating, comment });
    }
  );
});

// Bewertungen für einen Handwerker abrufen
app.get('/api/reviews/:craftsman', (req, res) => {
  db.all(
    `SELECT reviews.*, users.first_name, users.last_name 
     FROM reviews LEFT JOIN users ON reviews.user_id = users.id
     WHERE reviews.craftsman_name = ? ORDER BY reviews.created_at DESC`,
    [req.params.craftsman],
    (err, rows) => res.json(rows || [])
  );
});

// Alle Handwerker abrufen
app.get('/api/craftsmen', (req, res) => {
  db.all(`SELECT * FROM craftsmen ORDER BY rating DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// Handwerker nach Bezirk filtern
app.get('/api/craftsmen/:district', (req, res) => {
  db.all(`SELECT * FROM craftsmen WHERE district LIKE ? ORDER BY rating DESC`,
    ['%'+req.params.district+'%'],
    (err, rows) => res.json(rows || [])
  );
});

// Handwerker registrieren (nur für Handwerker-Accounts)
app.post('/api/craftsmen', authMiddleware, (req, res) => {
  if(req.user.role !== 'craftsman')
    return res.status(403).json({ error: 'Nur für Handwerker' });
  const { role, district, color } = req.body;
  db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if(!user) return res.status(404).json({ error: 'User nicht gefunden' });
    const initials = (user.first_name[0] + (user.last_name?user.last_name[0]:'')).toUpperCase();
    db.run(`INSERT OR IGNORE INTO craftsmen (name, initials, role, district, color, online)
            VALUES (?,?,?,?,?,1)`,
      [user.first_name+' '+user.last_name, initials, role, district, color||'#2E7DD1'],
      function(err) {
        if(err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  });
});

// Nachricht senden
app.post('/api/messages', authMiddleware, (req, res) => {
  const { receiver_name, message } = req.body;
  if(!message) return res.status(400).json({ error: 'Nachricht fehlt' });
  db.run(
    `INSERT INTO messages (sender_id, receiver_name, message) VALUES (?,?,?)`,
    [req.user.id, receiver_name, message],
    function(err) {
      if(err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message, created_at: new Date().toISOString() });
    }
  );
});

// Nachrichten abrufen
app.get('/api/messages/:receiver', authMiddleware, (req, res) => {
  db.all(
    `SELECT messages.*, users.first_name, users.last_name 
     FROM messages LEFT JOIN users ON messages.sender_id = users.id
     WHERE (messages.sender_id = ? AND messages.receiver_name = ?)
     ORDER BY messages.created_at ASC`,
    [req.user.id, req.params.receiver],
    (err, rows) => res.json(rows || [])
  );
});

// Alle anderen Routen → index.html
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🔧 FixNest Vienna läuft auf http://localhost:${PORT}`);
});