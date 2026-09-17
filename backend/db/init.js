const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'links.db');

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
      file_size INTEGER DEFAULT 0,
      -- preview: 仅完成预览; committed: 已执行导入; superseded: 明细被同名文件的新导入替换
      status TEXT NOT NULL DEFAULT 'preview',
      total_parsed INTEGER DEFAULT 0,
      valid_count INTEGER DEFAULT 0,
      invalid_count INTEGER DEFAULT 0,
      existing_count INTEGER DEFAULT 0,
      in_file_duplicate_count INTEGER DEFAULT 0,
      new_category_count INTEGER DEFAULT 0,
      imported_count INTEGER DEFAULT 0,
      replaced_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      duplicate_action TEXT,
      superseded_by INTEGER,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      committed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      item_order INTEGER DEFAULT 0,
      url TEXT,
      title TEXT,
      folder TEXT,
      full_path TEXT,
      -- 预览阶段判定: new | existing | invalid | duplicate
      preview_status TEXT NOT NULL,
      -- 提交后结果: imported | replaced | skipped_existing | skipped_duplicate
      --           | skipped_invalid | skipped_unselected | failed
      final_status TEXT,
      existing_link_id INTEGER,
      new_link_id INTEGER,
      invalid_reason TEXT,
      duplicate_in_file INTEGER DEFAULT 0,
      selected INTEGER DEFAULT 1,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES import_reports(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
    CREATE INDEX IF NOT EXISTS idx_links_category_id ON links(category_id);
    CREATE INDEX IF NOT EXISTS idx_link_tags_link_id ON link_tags(link_id);
    CREATE INDEX IF NOT EXISTS idx_link_tags_tag ON link_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_import_reports_user_id ON import_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_import_items_report_id ON import_items(report_id);
  `);

  return db;
}

module.exports = { getDb, initDatabase };
