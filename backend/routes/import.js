const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { parseBookmarks } = require('../utils/bookmark-parser');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const CATEGORY_COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C'];
const UNCATEGORIZED = 'Uncategorized';

// All routes require authentication
router.use(authMiddleware);

function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function pickColor(seed) {
  const h = crypto.createHash('md5').update(String(seed)).digest();
  return CATEGORY_COLORS[h[0] % CATEGORY_COLORS.length];
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Load existing link rows matching any of the given urls (case-insensitive)
function findExistingLinks(db, userId, urls) {
  const result = new Map();
  const uniqueUrls = [...new Set(urls.map((u) => u.toLowerCase()))];
  for (const batch of chunkArray(uniqueUrls, 400)) {
    const placeholders = batch.map(() => 'LOWER(url) = ?').join(' OR ');
    const rows = db
      .prepare(`SELECT id, url, title FROM links WHERE user_id = ? AND (${placeholders})`)
      .all(userId, ...batch);
    for (const row of rows) result.set(row.url.toLowerCase(), row);
  }
  return result;
}

function getOrCreateCategory(db, userId, folderName) {
  let category = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, folderName);
  if (!category) {
    const result = db
      .prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)')
      .run(userId, folderName, pickColor(folderName));
    return { id: result.lastInsertRowid, created: true };
  }
  return { id: category.id, created: false };
}

function buildReportDetail(db, reportId) {
  const report = db.prepare('SELECT * FROM import_reports WHERE id = ?').get(reportId);
  if (!report) return null;
  const items = db
    .prepare('SELECT * FROM import_report_items WHERE report_id = ? ORDER BY ordinal')
    .all(reportId);
  return { ...report, items };
}

// POST /api/import/preview - Upload + parse a bookmark file and return a dry-run preview.
// Nothing is written at this stage.
router.post('/preview', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件过大，仅支持 10MB 以内的书签 HTML 文件', code: 'FILE_TOO_LARGE' });
      }
      return res.status(400).json({ error: '文件上传失败，请重试', code: 'UPLOAD_ERROR' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '未收到上传文件', code: 'NO_FILE' });
    }

    const filename = req.file.originalname || 'bookmarks.html';
    const fileSize = req.file.size;
    const html = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    const hash = contentHash(html);
    const userId = req.userId;
    const db = getDb();

    // Parse failure => user stays on the pre-preview step with a clear reason.
    let bookmarks;
    try {
      bookmarks = parseBookmarks(html);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message, code: 'PARSE_ERROR', filename });
    }

    const validBookmarks = bookmarks.filter((b) => b.valid);
    const existingMap = findExistingLinks(db, userId, validBookmarks.map((b) => b.url));
    const categories = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(userId);
    const existingCategoryNames = new Set(categories.map((c) => c.name));

    const newCategorySet = new Set();
    const rows = bookmarks.map((b, index) => {
      const key = b.valid ? b.url.toLowerCase() : null;
      const existing = key ? existingMap.get(key) || null : null;
      let categoryName = null;
      let categoryAction = null;
      if (b.folder && b.folder !== UNCATEGORIZED) {
        categoryName = b.folder;
        categoryAction = existingCategoryNames.has(b.folder) ? 'existing' : 'new';
        if (categoryAction === 'new') newCategorySet.add(b.folder);
      }
      return {
        ordinal: index,
        url: b.url,
        title: b.title,
        folder: b.folder,
        full_path: b.full_path,
        valid: b.valid,
        invalid_reason: b.invalid_reason,
        in_file_duplicate: b.in_file_duplicate,
        existed: !!existing,
        existing_link_id: existing ? existing.id : null,
        existing_title: existing ? existing.title : null,
        category_name: categoryName,
        category_action: categoryAction,
        // Defaults the UI can override:
        selected: b.valid && !existing && !b.in_file_duplicate,
        duplicate_action: 'skip',
      };
    });

    // Same file content was imported before
    const sameFileReport = db
      .prepare(
        `SELECT id, filename, status, created_at, finished_at FROM import_reports
         WHERE user_id = ? AND content_hash = ? AND status != 'failed'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, hash);

    // Same filename but different content (re-exported / overwritten file)
    const sameNameReport = !sameFileReport
      ? db
          .prepare(
            `SELECT id, filename, status, created_at, finished_at FROM import_reports
             WHERE user_id = ? AND filename = ? AND content_hash != ? AND status != 'failed'
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(userId, hash, filename)
      : null;

    const invalidCount = rows.filter((r) => !r.valid).length;
    const existedCount = rows.filter((r) => r.existed).length;
    const inFileDuplicateCount = rows.filter((r) => r.in_file_duplicate).length;
    const selectedCount = rows.filter((r) => r.selected).length;

    res.json({
      filename,
      file_size: fileSize,
      content_hash: hash,
      total_count: rows.length,
      valid_count: rows.length - invalidCount,
      invalid_count: invalidCount,
      existed_count: existedCount,
      in_file_duplicate_count: inFileDuplicateCount,
      selected_count: selectedCount,
      new_categories: [...newCategorySet].sort(),
      same_file_report: sameFileReport,
      same_name_report: sameNameReport,
      rows,
    });
  });
});

// POST /api/import/commit - Commit the user-selected rows. Each row is processed in
// its own savepoint, so a failure/cancel never rolls back rows already written.
router.post('/commit', (req, res) => {
  const {
    filename,
    file_size,
    content,
    content_hash,
    items,
    default_duplicate_action = 'skip',
  } = req.body || {};

  if (!filename || typeof content !== 'string' || !Array.isArray(items)) {
    return res.status(400).json({ error: '提交数据不完整', code: 'BAD_REQUEST' });
  }

  const hash = contentHash(content);
  if (content_hash && hash !== content_hash) {
    return res.status(400).json({
      error: '文件内容与预览时不一致，可能已被修改，请重新选择文件预览',
      code: 'CONTENT_CHANGED',
    });
  }

  // Re-parse server-side: commit must not trust the client's rows blindly.
  let parsed;
  try {
    parsed = parseBookmarks(content);
  } catch (parseErr) {
    return res.status(400).json({ error: parseErr.message, code: 'PARSE_ERROR' });
  }

  const db = getDb();
  const userId = req.userId;

  const createReport = db.prepare(
    `INSERT INTO import_reports (user_id, filename, file_size, content_hash, status, total_count)
     VALUES (?, ?, ?, ?, 'processing', ?)`
  );
  const reportId = createReport.run(userId, filename, file_size || null, hash, items.length).lastInsertRowid;

  const insertItem = db.prepare(
    `INSERT INTO import_report_items
       (report_id, ordinal, url, title, folder, full_path, valid, invalid_reason, selected, in_file_duplicate, category_name, category_action, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );
  const updateItem = db.prepare(
    `UPDATE import_report_items
       SET selected = ?, existed = ?, category_name = ?, category_action = ?, result = ?, reason = ?, link_id = ?
     WHERE id = ?`
  );
  const finishReport = db.prepare(
    `UPDATE import_reports
       SET status = ?, cancel_reason = ?, total_count = ?, created_count = ?, replaced_count = ?,
           skipped_count = ?, failed_count = ?, links_total = ?, finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  );

  // Persist every client row up front
  const insertAll = db.transaction((rows) => {
    for (const it of rows) {
      insertItem.run(
        reportId,
        it.ordinal,
        it.url || null,
        it.title || null,
        it.folder || null,
        it.full_path || null,
        it.valid ? 1 : 0,
        it.invalid_reason || null,
        it.selected ? 1 : 0,
        it.in_file_duplicate ? 1 : 0,
        it.category_name || null,
        it.category_action || null
      );
    }
  });
  insertAll(items);

  const itemIds = db.prepare('SELECT id FROM import_report_items WHERE report_id = ? ORDER BY ordinal').all(reportId).map((r) => r.id);

  // Recompute server-side truth: validity and existing links are authoritative
  const validRows = parsed.filter((b) => b.valid);
  const existingMap = findExistingLinks(db, userId, validRows.map((b) => b.url));

  const counts = { created: 0, replaced: 0, skipped: 0, failed: 0 };
  let clientAborted = false;
  req.on('aborted', () => {
    clientAborted = true;
  });

  const finalize = (status, reason) => {
    const linksTotal = db.prepare('SELECT COUNT(*) AS n FROM links WHERE user_id = ?').get(userId).n;
    finishReport.run(
      status,
      reason || null,
      items.length,
      counts.created,
      counts.replaced,
      counts.skipped,
      counts.failed,
      linksTotal,
      reportId
    );
  };

  const markPendingAsUnprocessed = db.transaction((reasonText) => {
    const pendingRows = db
      .prepare("SELECT id FROM import_report_items WHERE report_id = ? AND result = 'pending'")
      .all(reportId);
    for (const row of pendingRows) {
      db.prepare('UPDATE import_report_items SET result = ?, reason = ? WHERE id = ?')
        .run('skipped', reasonText, row.id);
      counts.skipped++;
    }
  });

  try {
    for (let i = 0; i < items.length; i++) {
      if (clientAborted || req.aborted || req.destroyed) {
        throw Object.assign(new Error('CLIENT_ABORTED'), { aborted: true });
      }

      const clientRow = items[i];
      const itemId = itemIds[i];
      const parsedRow = parsed[clientRow.ordinal];
      const selected = !!clientRow.selected;
      const duplicateAction = clientRow.duplicate_action === 'replace' ? 'replace' : default_duplicate_action === 'replace' ? 'replace' : 'skip';

      const processOne = db.transaction(() => {
        // Invalid address
        if (!parsedRow || !parsedRow.valid) {
          const reason = parsedRow ? parsedRow.invalid_reason : '预览数据与文件内容对不上';
          updateItem.run(itemId, selected ? 1 : 0, 0, clientRow.category_name || null, clientRow.category_action || null, 'skipped', `地址不合法：${reason}`, null);
          counts.skipped++;
          return;
        }

        const url = parsedRow.url;
        const title = parsedRow.title || url;
        const folder = parsedRow.folder !== UNCATEGORIZED ? parsedRow.folder : null;

        if (!selected) {
          // Unselected rows never create categories or links.
          updateItem.run(itemId, 0, 0, folder, clientRow.category_action || null, 'skipped', '用户未勾选，未导入', null);
          counts.skipped++;
          return;
        }

        let categoryId = null;
        let categoryAction = null;
        if (folder) {
          const cat = getOrCreateCategory(db, userId, folder);
          categoryId = cat.id;
          categoryAction = cat.created ? 'new' : 'existing';
        }

        const key = url.toLowerCase();
        const existing = existingMap.get(key) || null;

        if (existing) {
          if (duplicateAction === 'replace') {
            db.prepare('UPDATE links SET title = ?, category_id = ? WHERE id = ? AND user_id = ?')
              .run(title, categoryId, existing.id, userId);
            existingMap.set(key, { ...existing, title });
            updateItem.run(itemId, 1, 1, folder, categoryAction, 'replaced', '链接库中已存在相同地址，按设置替换了标题和分类', existing.id);
            counts.replaced++;
          } else {
            updateItem.run(itemId, 1, 1, folder, categoryAction, 'skipped', '链接库中已存在相同地址，按设置跳过', existing.id);
            counts.skipped++;
          }
          return;
        }

        const info = db
          .prepare('INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)')
          .run(userId, url, title, '', categoryId, 'unchecked');
        existingMap.set(key, { id: info.lastInsertRowid, url, title });
        updateItem.run(itemId, 1, 0, folder, categoryAction, 'created', null, info.lastInsertRowid);
        counts.created++;
      });

      try {
        processOne();
      } catch (itemErr) {
        try {
          updateItem.run(itemId, selected ? 1 : 0, 0, clientRow.category_name || null, clientRow.category_action || null, 'failed', `处理失败：${itemErr.message}`, null);
        } catch {
          /* item bookkeeping failure must not kill the batch */
        }
        counts.failed++;
      }
    }

    finalize('completed', null);
  } catch (batchErr) {
    if (batchErr.aborted) {
      const reasonText = '导入中途取消：尚未处理，未写入';
      markPendingAsUnprocessed(reasonText);
      const reason = '用户在导入过程中取消：已处理的条目已保留且不会回退，未处理的条目未写入';
      finalize('cancelled', reason);
      // Connection is gone; client will fetch the report by id.
      return;
    }
    markPendingAsUnprocessed('导入中断：尚未处理，未写入');
    finalize('failed', `导入中断：${batchErr.message}`);
    if (!res.headersSent) {
      return res.status(500).json({ error: '导入过程中发生错误，已处理的条目已保留', report_id: reportId, code: 'COMMIT_ERROR' });
    }
    return;
  }

  if (!res.headersSent) {
    return res.json(buildReportDetail(db, reportId));
  }
});

// GET /api/import/reports - List import reports (newest first)
router.get('/reports', (req, res) => {
  const db = getDb();
  const reports = db
    .prepare(
      `SELECT id, filename, file_size, status, cancel_reason, total_count, created_count,
              replaced_count, skipped_count, failed_count, links_total, created_at, finished_at
       FROM import_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.userId);
  res.json(reports);
});

// GET /api/import/reports/:id - Full report with per-item details
router.get('/reports/:id', (req, res) => {
  const db = getDb();
  const detail = buildReportDetail(db, req.params.id);
  if (!detail || detail.user_id !== req.userId) {
    return res.status(404).json({ error: '导入明细不存在', code: 'NOT_FOUND' });
  }
  res.json(detail);
});

// POST /api/import/bookmarks - Legacy one-shot import (kept for compatibility)
router.post('/bookmarks', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: '文件上传失败或超过 10MB 限制' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let bookmarks;
    try {
      bookmarks = parseBookmarks(req.file.buffer.toString('utf-8'));
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    const db = getDb();
    const userId = req.userId;
    let imported = 0;
    let skipped = 0;

    const run = db.transaction(() => {
      const checkExists = db.prepare('SELECT id FROM links WHERE user_id = ? AND url = ?');
      const insertLink = db.prepare(
        'INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const b of bookmarks) {
        if (!b.valid || checkExists.get(userId, b.url)) {
          skipped++;
          continue;
        }
        let categoryId = null;
        if (b.folder !== UNCATEGORIZED) {
          categoryId = getOrCreateCategory(db, userId, b.folder).id;
        }
        insertLink.run(userId, b.url, b.title, '', categoryId, 'unchecked');
        imported++;
      }
    });
    run();

    res.json({
      message: `Successfully imported ${imported} bookmarks`,
      imported,
      skipped,
      total: bookmarks.length,
    });
  });
});

module.exports = router;
