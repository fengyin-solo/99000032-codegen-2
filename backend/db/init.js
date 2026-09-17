const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'links.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#409EFF',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category_id INTEGER,
      status TEXT DEFAULT 'unchecked' CHECK(status IN ('alive', 'dead', 'unchecked')),
      last_checked DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_read_later INTEGER DEFAULT 0,
      review_date DATETIME,
      review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'completed', 'skipped')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS link_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_size INTEGER,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      cancel_reason TEXT,
      total_count INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      replaced_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      links_total INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_report_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      url TEXT,
      title TEXT,
      folder TEXT,
      full_path TEXT,
      valid INTEGER DEFAULT 1,
      invalid_reason TEXT,
      selected INTEGER DEFAULT 1,
      in_file_duplicate INTEGER DEFAULT 0,
      existed INTEGER DEFAULT 0,
      category_name TEXT,
      category_action TEXT,
      result TEXT DEFAULT 'pending',
      reason TEXT,
      link_id INTEGER,
      FOREIGN KEY (report_id) REFERENCES import_reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
    CREATE INDEX IF NOT EXISTS idx_links_category_id ON links(category_id);
    CREATE INDEX IF NOT EXISTS idx_link_tags_link_id ON link_tags(link_id);
    CREATE INDEX IF NOT EXISTS idx_link_tags_tag ON link_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_import_reports_user ON import_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_import_reports_hash ON import_reports(user_id, content_hash);
    CREATE INDEX IF NOT EXISTS idx_import_report_items_report ON import_report_items(report_id);
  `);

  return db;
}

module.exports = { getDb, initDatabase };
