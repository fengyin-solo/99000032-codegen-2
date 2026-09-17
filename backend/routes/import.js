const express = require('express');
const multer = require('multer');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { parseBookmarkFile, BookmarkParseError } = require('../utils/bookmark-parser');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// All routes require authentication
router.use(authMiddleware);

const CATEGORY_COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C'];
const UNCATEGORIZED = '未分类';

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function multerSingleFile(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Fetch a report and verify it belongs to the current user
function getOwnedReport(db, reportId, userId) {
  return db.prepare('SELECT * FROM import_reports WHERE id = ? AND user_id = ?').get(reportId, userId);
}

function buildReportDetail(db, report) {
  const items = db.prepare(
    'SELECT * FROM import_items WHERE report_id = ? ORDER BY item_order ASC, id ASC'
  ).all(report.id);

  const linksTotal = db.prepare('SELECT COUNT(*) AS count FROM links WHERE user_id = ?').get(report.user_id).count;

  return {
    ...report,
    items,
    links_total: linksTotal,
  };
}

/**
 * POST /api/import/bookmarks/preview
 * Parse an uploaded bookmark file WITHOUT writing any links/categories.
 * Produces a persisted preview report the UI can render and re-fetch.
 */
router.post('/bookmarks/preview', async (req, res) => {
  try {
    await multerSingleFile(req, res);
  } catch (uploadErr) {
    if (uploadErr.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件超过 10MB 大小限制', code: 'FILE_TOO_LARGE' });
    }
    return res.status(400).json({ error: '文件上传失败：' + uploadErr.message, code: 'UPLOAD_ERROR' });
  }

  if (!req.file) {
    return res.status(400).json({ error: '未收到上传文件', code: 'NO_FILE' });
  }

  const filename = req.file.originalname || 'bookmarks.html';
  const fileSize = req.file.size || 0;

  // Parsing never touches the database: a corrupt document stops here,
  // at the preview step, with a clear reason.
  let parsed;
  try {
    const html = req.file.buffer.toString('utf-8');
    parsed = parseBookmarkFile(html);
  } catch (err) {
    if (err instanceof BookmarkParseError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: '书签解析失败：' + err.message, code: 'PARSE_ERROR' });
  }

  const db = getDb();
  const userId = req.userId;

  const existingByUrl = db.prepare('SELECT id, url, title FROM links WHERE user_id = ?');
  const existingUrls = new Map();
  for (const row of existingByUrl.all(userId)) {
    existingUrls.set(row.url.toLowerCase(), row);
  }

  const existingCategories = new Set(
    db.prepare('SELECT name FROM categories WHERE user_id = ?').all(userId).map((r) => r.name)
  );

  // Persist the preview report + every parsed item in one transaction
  // (still no link/category rows are created).
  const tx = db.transaction(() => {
    const reportResult = db.prepare(`
      INSERT INTO import_reports (user_id, filename, file_size, status, total_parsed, message)
      VALUES (?, ?, ?, 'preview', ?, ?)
    `).run(userId, filename, fileSize, parsed.bookmarks.length + parsed.invalid.length, '预览已生成，尚未导入');

    const reportId = reportResult.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO import_items
        (report_id, user_id, item_order, url, title, folder, full_path, preview_status, existing_link_id, invalid_reason, duplicate_in_file, selected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let existingCount = 0;
    let inFileDuplicateCount = 0;
    const neededCategories = new Set();
    const seenInFile = new Set();

    const allEntries = [
      ...parsed.bookmarks.map((b) => ({ ...b, invalid: false })),
      ...parsed.invalid.map((b) => ({ ...b, invalid: true })),
    ].sort((a, b) => a.order - b.order);

    for (const entry of allEntries) {
      let previewStatus = 'new';
      let existingLinkId = null;
      let selected = 1;

      if (entry.invalid) {
        previewStatus = 'invalid';
        selected = 0;
      } else {
        const key = entry.url.toLowerCase();
        const existing = existingUrls.get(key);
        if (existing) {
          previewStatus = 'existing';
          existingLinkId = existing.id;
          existingCount += 1;
        }
        if (entry.folder && entry.folder !== UNCATEGORIZED) {
          neededCategories.add(entry.folder);
        }
        // Only the first occurrence inside the file is selected by default
        if (entry.duplicate_in_file) {
          inFileDuplicateCount += 1;
        }
        if (seenInFile.has(key)) {
          selected = 0;
        } else {
          seenInFile.add(key);
        }
      }

      insertItem.run(
        reportId,
        userId,
        entry.order,
        entry.url || '',
        entry.title || '(无标题)',
        entry.folder || UNCATEGORIZED,
        entry.full_path || '',
        previewStatus,
        existingLinkId,
        entry.invalid ? entry.invalid_reason : null,
        entry.duplicate_in_file ? 1 : 0,
        selected
      );
    }

    const newCategories = [...neededCategories].filter((name) => !existingCategories.has(name));

    db.prepare(`
      UPDATE import_reports
      SET valid_count = ?, invalid_count = ?, existing_count = ?,
          in_file_duplicate_count = ?, new_category_count = ?
      WHERE id = ?
    `).run(
      parsed.bookmarks.length,
      parsed.invalid.length,
      existingCount,
      inFileDuplicateCount,
      newCategories.length,
      reportId
    );

    return { reportId, newCategories };
  });

  const { reportId, newCategories } = tx();

  // Detect earlier uploads with the same filename so the UI can state
  // up-front whether history will be replaced or kept.
  const sameNameReports = db.prepare(`
    SELECT id, status, filename, imported_count, replaced_count, skipped_count, created_at, committed_at
    FROM import_reports
    WHERE user_id = ? AND filename = ? AND id != ?
    ORDER BY created_at DESC
  `).all(userId, filename, reportId);

  const report = buildReportDetail(db, getOwnedReport(db, reportId, userId));
  report.new_categories = newCategories;
  report.same_name_reports = sameNameReports;
  report.parse_errors = parsed.parseErrors;

  res.status(201).json(report);
});

/**
 * POST /api/import/bookmarks/:id/commit
 * Import the selected items of a preview report.
 *
 * Every item is committed in its own transaction: a failure on one item
 * never rolls back items already imported, and better-sqlite3 runs
 * synchronously to completion even if the client cancels the request.
 */
router.post('/bookmarks/:id/commit', (req, res) => {
  const reportId = Number(req.params.id);
  const userId = req.userId;
  const db = getDb();

  const report = getOwnedReport(db, reportId, userId);
  if (!report) {
    return res.status(404).json({ error: '未找到对应的导入预览', code: 'REPORT_NOT_FOUND' });
  }

  // Idempotent: a retry (e.g. after a client-side abort) returns the
  // already produced detail instead of importing twice.
  if (report.status === 'committed') {
    return res.json(buildReportDetail(db, report));
  }
  if (report.status !== 'preview') {
    return res.status(409).json({ error: '该导入记录当前状态不允许提交', code: 'INVALID_REPORT_STATUS' });
  }

  const duplicateAction = req.body.duplicate_action === 'replace' ? 'replace' : 'skip';
  const selectedIds = Array.isArray(req.body.selected_ids)
    ? new Set(req.body.selected_ids.map(Number).filter((n) => Number.isInteger(n)))
    : null; // null = use per-item selection stored at preview

  const items = db.prepare(
    'SELECT * FROM import_items WHERE report_id = ? ORDER BY item_order ASC, id ASC'
  ).all(reportId);

  const findExistingStmt = db.prepare('SELECT * FROM links WHERE user_id = ? AND lower(url) = lower(?)');
  const findCategoryStmt = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?');
  const insertCategoryStmt = db.prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)');
  const insertLinkStmt = db.prepare(
    'INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const replaceLinkStmt = db.prepare('UPDATE links SET title = ?, category_id = ? WHERE id = ?');
  const setItemResultStmt = db.prepare(
    'UPDATE import_items SET final_status = ?, new_link_id = ?, detail = ?, selected = ? WHERE id = ?'
  );

  let imported = 0;
  let replaced = 0;
  let skippedExisting = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  let skippedUnselected = 0;
  let failed = 0;

  const getOrCreateCategory = (folder) => {
    if (!folder || folder === UNCATEGORIZED) return null;
    const found = findCategoryStmt.get(userId, folder);
    if (found) return found.id;
    const result = insertCategoryStmt.run(userId, folder, colorForName(folder));
    return result.lastInsertRowid;
  };

  // Tracks URLs handled earlier within this same commit (in-file duplicates)
  const handledUrls = new Set();

  for (const item of items) {
    // Invalid addresses are never importable, even if a client marks them selected.
    if (item.preview_status === 'invalid') {
      setItemResultStmt.run('skipped_invalid', null, item.invalid_reason || '地址不合法', 0, item.id);
      skippedInvalid += 1;
      continue;
    }

    const isSelected = selectedIds === null ? !!item.selected : selectedIds.has(item.id);

    if (!isSelected) {
      setItemResultStmt.run('skipped_unselected', null, '用户未勾选，未导入', 0, item.id);
      skippedUnselected += 1;
      continue;
    }

    const urlKey = (item.url || '').toLowerCase();
    if (handledUrls.has(urlKey)) {
      setItemResultStmt.run('skipped_duplicate', null, '与本次导入中更早的条目地址重复，已跳过', 1, item.id);
      skippedDuplicate += 1;
      continue;
    }

    // Each item is an independent unit of work.
    const processItem = db.transaction(() => {
      const existing = findExistingStmt.get(userId, item.url);

      if (existing) {
        if (duplicateAction === 'skip') {
          setItemResultStmt.run(
            'skipped_existing',
            null,
            '链接库中已存在相同地址，按"跳过重复"策略未改动',
            1,
            item.id
          );
          return 'skipped_existing';
        }
        const categoryId = getOrCreateCategory(item.folder);
        replaceLinkStmt.run(item.title, categoryId, existing.id);
        setItemResultStmt.run(
          'replaced',
          null,
          '链接库中已存在相同地址，已按"替换"策略更新标题与分类',
          1,
          item.id
        );
        return 'replaced';
      }

      const categoryId = getOrCreateCategory(item.folder);
      const result = insertLinkStmt.run(userId, item.url, item.title, '', categoryId, 'unchecked');
      setItemResultStmt.run(
        'imported',
        result.lastInsertRowid,
        categoryId ? `新建链接，归入分类「${item.folder}」` : '新建链接（未分类）',
        1,
        item.id
      );
      return 'imported';
    });

    try {
      const outcome = processItem();
      handledUrls.add(urlKey);
      if (outcome === 'imported') imported += 1;
      else if (outcome === 'replaced') replaced += 1;
      else if (outcome === 'skipped_existing') skippedExisting += 1;
    } catch (err) {
      // Failure is recorded against this item only; earlier commits stay.
      failed += 1;
      setItemResultStmt.run('failed', null, '导入失败：' + err.message, 1, item.id);
    }
  }

  const skipped = skippedExisting + skippedDuplicate + skippedInvalid + skippedUnselected;
  const linksTotal = db.prepare('SELECT COUNT(*) AS count FROM links WHERE user_id = ?').get(userId).count;

  // Resolve same-name history: replace (supersede) or keep (skip)
  let sameNameNote = '';
  const finalize = db.transaction(() => {
    if (duplicateAction === 'replace') {
      const older = db.prepare(`
        SELECT id FROM import_reports
        WHERE user_id = ? AND filename = ? AND id != ? AND status = 'committed'
      `).all(userId, report.filename, reportId);
      if (older.length > 0) {
        const markStmt = db.prepare(
          "UPDATE import_reports SET status = 'superseded', superseded_by = ? WHERE id = ?"
        );
        older.forEach((r) => markStmt.run(reportId, r.id));
        sameNameNote = `同名文件的 ${older.length} 份历史明细已标记为「被本次导入替换」`;
      }
    } else {
      const olderCount = db.prepare(`
        SELECT COUNT(*) AS count FROM import_reports
        WHERE user_id = ? AND filename = ? AND id != ? AND status = 'committed'
      `).get(userId, report.filename, reportId).count;
      if (olderCount > 0) {
        sameNameNote = `同名文件已有 ${olderCount} 份历史明细，按"跳过重复"策略予以保留`;
      }
    }

    const messageParts = [
      `导入完成：新建 ${imported} 条`,
      replaced > 0 ? `替换 ${replaced} 条` : null,
      skipped > 0 ? `跳过 ${skipped} 条` : null,
      failed > 0 ? `失败 ${failed} 条` : null,
    ].filter(Boolean);

    db.prepare(`
      UPDATE import_reports
      SET status = 'committed', committed_at = CURRENT_TIMESTAMP,
          duplicate_action = ?, imported_count = ?, replaced_count = ?,
          skipped_count = ?, failed_count = ?, message = ?
      WHERE id = ?
    `).run(
      duplicateAction,
      imported,
      replaced,
      skipped,
      failed,
      [messageParts.join('，'), sameNameNote].filter(Boolean).join('。'),
      reportId
    );
  });
  finalize();

  const detail = buildReportDetail(db, getOwnedReport(db, reportId, userId));
  detail.same_name_note = sameNameNote;
  res.json(detail);
});

// GET /api/import/bookmarks/reports - list import history (persisted detail)
router.get('/bookmarks/reports', (req, res) => {
  const db = getDb();
  const userId = req.userId;
  const reports = db.prepare(`
    SELECT * FROM import_reports
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(userId);
  res.json(reports);
});

// GET /api/import/bookmarks/reports/:id - full detail for one import
router.get('/bookmarks/reports/:id', (req, res) => {
  const db = getDb();
  const userId = req.userId;
  const report = getOwnedReport(db, Number(req.params.id), userId);
  if (!report) {
    return res.status(404).json({ error: '未找到该导入记录', code: 'REPORT_NOT_FOUND' });
  }
  res.json(buildReportDetail(db, report));
});

// DELETE /api/import/bookmarks/reports/:id - discard an import record
router.delete('/bookmarks/reports/:id', (req, res) => {
  const db = getDb();
  const userId = req.userId;
  const report = getOwnedReport(db, Number(req.params.id), userId);
  if (!report) {
    return res.status(404).json({ error: '未找到该导入记录', code: 'REPORT_NOT_FOUND' });
  }
  db.prepare('DELETE FROM import_items WHERE report_id = ?').run(report.id);
  db.prepare('DELETE FROM import_reports WHERE id = ?').run(report.id);
  res.json({ message: '导入记录已删除' });
});

module.exports = router;
