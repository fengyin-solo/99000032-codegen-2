/**
 * Parse Chrome bookmark HTML file (Netscape bookmark format)
 * Extracts URLs, titles, and folder structure.
 *
 * parseBookmarkFile() returns a structured result:
 *   {
 *     bookmarks: [...],       // well-formed http(s) bookmarks
 *     invalid: [...],         // entries present in the file but not importable
 *     parseErrors: [...]      // non-fatal structural problems
 *   }
 *
 * It throws BookmarkParseError when the document itself is unusable
 * (empty/binary content or no bookmark anchors at all), so callers can
 * stop at the preview step with a clear reason and never touch the DB.
 */

class BookmarkParseError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BookmarkParseError';
    this.code = code || 'PARSE_ERROR';
  }
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * Validate a bookmark URL. Returns { valid, reason }.
 */
function validateUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) {
    return { valid: false, reason: '地址为空' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { valid: false, reason: '仅支持 http/https 地址' };
  }
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (e) {
    return { valid: false, reason: 'URL 格式不合法' };
  }
  return { valid: true };
}

/**
 * Parse a bookmark HTML document.
 * @param {string} html
 * @returns {{bookmarks: Array, invalid: Array, parseErrors: string[]}}
 */
function parseBookmarkFile(html) {
  const parseErrors = [];

  if (html == null || html.toString().trim() === '') {
    throw new BookmarkParseError('文件内容为空，无法解析书签', 'EMPTY_FILE');
  }

  const content = html.toString();

  // Obvious binary/corrupted content: NUL bytes or very high ratio of
  // non-printable characters means this is not a text/HTML export.
  const nulCount = (content.match(/\0/g) || []).length;
  if (nulCount > 0) {
    throw new BookmarkParseError('文件不是有效的 HTML 文本文档（检测到二进制内容），可能已损坏', 'BINARY_FILE');
  }

  const anchorMatches = content.match(/<A\s[^>]*HREF\s*=/gi) || [];
  if (anchorMatches.length === 0) {
    if (/<\/?(html|body|p|div|h1|table)/i.test(content)) {
      throw new BookmarkParseError('文件中没有找到任何书签条目（<A HREF>），不是有效的书签导出文件', 'NO_BOOKMARKS');
    }
    throw new BookmarkParseError('无法识别书签文件结构，请确认上传的是浏览器导出的 HTML 书签文件', 'UNRECOGNIZED_FILE');
  }

  // Walk the document token by token so nested folders (<H3> + <DL>)
  // and their closing tags are tracked with a proper stack.
  const tokenRegex = /<H3\b[^>]*>([\s\S]*?)<\/H3>|<A\b([^>]*)>([\s\S]*?)<\/A>|<DL\b[^>]*>|<\/DL>|<\/DT>/gi;
  const hrefRegex = /HREF\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

  const bookmarks = [];
  const invalid = [];
  const folderStack = [];
  let order = 0;

  let match;
  while ((match = tokenRegex.exec(content)) !== null) {
    const token = match[0];

    if (/^<H3/i.test(token)) {
      const name = decodeHtmlEntities(match[1].replace(/<[^>]*>/g, '').trim());
      folderStack.push(name || '未命名文件夹');
    } else if (/^<A\s/i.test(token)) {
      const attrs = match[2] || '';
      const rawTitle = decodeHtmlEntities(match[3].replace(/<[^>]*>/g, '').trim());
      const hrefMatch = attrs.match(hrefRegex);
      const rawUrl = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? '') : '';
      const url = decodeHtmlEntities(rawUrl).trim();
      const title = rawTitle || url;
      const folder = folderStack.length > 0 ? folderStack[folderStack.length - 1] : '未分类';
      const fullPath = folderStack.length > 0 ? folderStack.join(' > ') : '';
      order += 1;

      const check = validateUrl(url);
      const entry = {
        url,
        title,
        folder,
        full_path: fullPath,
        order,
      };
      if (check.valid) {
        bookmarks.push(entry);
      } else {
        invalid.push({ ...entry, invalid_reason: check.reason });
      }
    } else if (/^<DL/i.test(token)) {
      // Folder list begins; folders themselves are pushed by <H3>.
      // Nothing to do here besides letting </DL> pop.
    } else if (/^<\/DL/i.test(token)) {
      folderStack.pop();
    }
  }

  // Tag bookmarks whose URL appears more than once inside this same file.
  // Only repeat occurrences (not the first one) count into the duplicate total.
  const seen = new Map();
  for (const bm of bookmarks) {
    const key = bm.url.toLowerCase();
    if (seen.has(key)) {
      bm.duplicate_in_file = true;
      const first = seen.get(key);
      parseErrors.push(`文件内重复地址（第 ${bm.order} 条与第 ${first.order} 条）：${bm.url}`);
    } else {
      seen.set(key, bm);
    }
  }

  if (bookmarks.length === 0 && invalid.length > 0) {
    throw new BookmarkParseError(
      `文件中找到 ${invalid.length} 个条目，但没有任何合法的 http/https 书签地址`,
      'NO_VALID_BOOKMARKS'
    );
  }

  return { bookmarks, invalid, parseErrors };
}

/**
 * Legacy simple parser kept for compatibility.
 * Returns only valid bookmarks (same shape as before).
 */
function parseBookmarks(html) {
  return parseBookmarkFile(html).bookmarks.map((b) => ({
    url: b.url,
    title: b.title,
    folder: b.folder === '未分类' ? 'Uncategorized' : b.folder,
    full_path: b.full_path || 'Root',
  }));
}

module.exports = { parseBookmarks, parseBookmarkFile, validateUrl, BookmarkParseError };
