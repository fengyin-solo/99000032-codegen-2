/**
 * Parse Chrome/Firefox bookmark HTML export
 * Extracts URLs, titles, folder structure and validity information
 */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—',
  ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] || m);
}

function stripTags(html) {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, '')).trim();
}

/**
 * Validate an http(s) URL.
 * Returns { valid, normalized, reason }
 */
function validateUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return { valid: false, normalized: '', reason: '地址为空' };
  }
  if (/[\s<>]/.test(url)) {
    return { valid: false, normalized: url, reason: '地址包含空白或非法字符' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, normalized: url, reason: '不是合法的 URL 格式' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, normalized: url, reason: `不支持的协议：${parsed.protocol}//（仅支持 http/https）` };
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    // localhost style hosts are still accepted but flag anything without a dot only as warning?
    if (parsed.hostname !== 'localhost') {
      return { valid: false, normalized: url, reason: '域名不合法' };
    }
  }

  return { valid: true, normalized: parsed.toString(), reason: null };
}

const LINK_RE = /<DT[^>]*>\s*<A\s+([^>]*?)>([\s\S]*?)<\/A>/gi;
const HEADER_RE = /<DT[^>]*>\s*<H3[^>]*>([\s\S]*?)<\/H3>/i;
const DL_OPEN_RE = /<DL[^>]*>/i;
const DL_CLOSE_RE = /<\/DL>/i;
const HREF_RE = /HREF\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Parse bookmark HTML.
 * Throws Error with a Chinese message when the document is corrupt/empty.
 */
function parseBookmarks(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('文件内容为空，无法解析书签');
  }

  const body = html.replace(/^﻿/, '');

  // A bookmark export must contain at least one DL structure (Netscape format).
  if (!DL_OPEN_RE.test(body)) {
    throw new Error('文件结构损坏：未找到书签列表（<DL>）结构，请确认上传的是浏览器导出的书签 HTML 文件');
  }

  const bookmarks = [];
  // In the Netscape bookmark format every folder is an <H3> immediately
  // followed by one <DL>…</DL> block, so H3 pushes and </DL> pops.
  const folderStack = [];
  const lines = body.split(/\r?\n/);

  // Order inside a single line matters, so scan tokens by position.
  const TOKEN_RE = /<DT[^>]*>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<\/DL>|<DT[^>]*>\s*<A\s+([^>]*?)>([\s\S]*?)<\/A>/gi;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const m of line.matchAll(TOKEN_RE)) {
      if (m[1] !== undefined) {
        folderStack.push(stripTags(m[1]) || '未命名文件夹');
      } else if (m[0].match(DL_CLOSE_RE)) {
        folderStack.pop();
      } else if (m[2] !== undefined) {
        const attrs = m[2];
        const hrefMatch = attrs.match(HREF_RE);
        const rawUrl = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? '') : '';
        const title = stripTags(m[3]) || rawUrl;

        const folder = folderStack.length > 0 ? folderStack[folderStack.length - 1] : 'Uncategorized';
        const fullPath = folderStack.length > 0 ? folderStack.join(' > ') : 'Root';

        const { valid, normalized, reason } = validateUrl(rawUrl);

        bookmarks.push({
          url: valid ? normalized : String(rawUrl || '').trim(),
          title,
          folder,
          full_path: fullPath,
          valid,
          invalid_reason: valid ? null : reason,
        });
      }
    }
  }

  if (bookmarks.length === 0) {
    throw new Error('文件中没有找到任何书签链接（<A HREF=...>），文件可能已损坏或不是书签导出文件');
  }

  // Mark duplicates inside the same file (by normalized URL). Invalid rows are excluded.
  const seen = new Map();
  bookmarks.forEach((b) => {
    if (!b.valid) {
      b.in_file_duplicate = false;
      return;
    }
    const key = b.url.toLowerCase();
    if (seen.has(key)) {
      b.in_file_duplicate = true;
    } else {
      b.in_file_duplicate = false;
      seen.set(key, true);
    }
  });

  return bookmarks;
}

module.exports = { parseBookmarks, validateUrl };
