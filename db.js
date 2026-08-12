const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'jaynet.db');
const db = new sqlite3.Database(dbPath);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function initDB() {
  db.serialize(() => {
    // 1. Packages Table
    db.run(`
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        duration_hours REAL NOT NULL,
        download_speed TEXT DEFAULT '5M',
        upload_speed TEXT DEFAULT '2M',
        device_limit INTEGER DEFAULT 1,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Transactions Table
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        amount INTEGER NOT NULL,
        package_id INTEGER,
        package_name TEXT,
        checkout_request_id TEXT UNIQUE,
        mpesa_receipt_number TEXT,
        mac_address TEXT,
        voucher_code TEXT,
        status TEXT DEFAULT 'PENDING',
        result_desc TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Active Sessions Table
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        mac_address TEXT,
        package_name TEXT,
        voucher_code TEXT,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Safely add voucher_code column to existing databases if missing
    db.run("ALTER TABLE sessions ADD COLUMN voucher_code TEXT", () => {});
    db.run("ALTER TABLE transactions ADD COLUMN voucher_code TEXT", () => {});

    // Seed Monthly Unlimited Packages if not exists
    db.get('SELECT COUNT(*) as count FROM packages WHERE price >= 2000', (err, row) => {
      if (!err && row.count === 0) {
        const monthlyPackages = [
          ['JayNet 15Mbps Monthly Unlimited', 2000, 720, '15M', '10M', 3],
          ['JayNet 20Mbps Monthly Unlimited', 2500, 720, '20M', '10M', 4],
          ['JayNet 30Mbps Monthly Unlimited', 3500, 720, '30M', '15M', 5]
        ];
        const stmt = db.prepare(`
          INSERT INTO packages (name, price, duration_hours, download_speed, upload_speed, device_limit)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        monthlyPackages.forEach(pkg => stmt.run(pkg));
        stmt.finalize();
        console.log('[JayNet DB] Seeded Monthly Unlimited packages (2000 KES, 2500 KES, 3500 KES).');
      }
    });

    // 4. Support Tickets Table
    db.run(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'OPEN',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Settings Table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  });
}

initDB();

module.exports = {
  db,
  query,
  get,
  run
};
