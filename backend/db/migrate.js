const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'links.db');

function migrateDatabase() {
  const db = new Database(DB_PATH);
  
  try {
    const tableInfo = db.pragma("table_info(links)");
    const columns = tableInfo.map(col => col.name);
    
    if (!columns.includes('is_read_later')) {
      db.exec('ALTER TABLE links ADD COLUMN is_read_later INTEGER DEFAULT 0');
      console.log('Added column: is_read_later');
    }
    
    if (!columns.includes('review_date')) {
      db.exec('ALTER TABLE links ADD COLUMN review_date DATETIME');
      console.log('Added column: review_date');
    }
    
    if (!columns.includes('review_status')) {
      db.exec("ALTER TABLE links ADD COLUMN review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'completed', 'skipped'))");
      console.log('Added column: review_status');
    }

    // Import report tables (preview/commit detail persistence)
    db.exec(`
      CREATE TABLE IF NOT EXISTS import_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
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
        preview_status TEXT NOT NULL,
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

      CREATE INDEX IF NOT EXISTS idx_import_reports_user_id ON import_reports(user_id);
      CREATE INDEX IF NOT EXISTS idx_import_items_report_id ON import_items(report_id);
    `);
    console.log('Ensured import report tables exist');

    // Add columns introduced after the initial import tables (idempotent)
    const itemInfo = db.pragma("table_info(import_items)");
    const itemColumns = itemInfo.map(col => col.name);
    if (itemColumns.length > 0 && !itemColumns.includes('duplicate_in_file')) {
      db.exec('ALTER TABLE import_items ADD COLUMN duplicate_in_file INTEGER DEFAULT 0');
      console.log('Added column: import_items.duplicate_in_file');
    }

    console.log('Database migration completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    db.close();
  }
}

module.exports = { migrateDatabase };
