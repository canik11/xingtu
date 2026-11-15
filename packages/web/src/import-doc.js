// 文档导入：把 Markdown / PDF 解析成笔记块树。
// 这里只做纯解析，不直接写知识库；层级映射由 actions.js 完成。
import { LIMITS, makeNoteBlock } from '@starmap/core';
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import pdfWorkerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

const MAX_BLOCKS = 600;
const MAX_TEXT = Math.min(1500, LIMITS.noteText - 20);
const CJK_END = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]$/;
const CJK_START = /^[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;
const PUNCT_END = /[，。！？；：、,.!?;:）】》”’)]$/;
const PUNCT_START = /^[，。！？；：、,.!?;:）】》”’(]/;

let workerReady = null;

/**
 * 单文件版用“主线程 worker”解析 PDF。
 * file:// 页面创建 Blob Worker 会被 Edge 拒绝并留下控制台错误；
 * 先把 worker 模块载入主线程，再让 PDF.js 走 fake worker 路径。
 */
async function ensurePdfWorker() {
  if (workerReady) return workerReady;
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('当前环境不支持 PDF 解析');
  }
  workerReady = (async () => {
    const workerUrl = URL.createObjectURL(new Blob([pdfWorkerSource], { type: 'text/javascript' }));
    const workerModule = await import(/* @vite-ignore */ workerUrl);
    globalThis.pdfjsWorker = workerModule;
    // 保留 workerSrc 作为兼容兜底；有 pdfjsWorker 时 PDF.js 会直接走 fake worker。
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  })();
  return workerReady;
}

function baseName(name) {
  return String(name || '未命名文档')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.(md|markdown|pdf)$/i, '');
}

function cleanTitle(text, fallback) {
  const value = String(text || '')
    .replace(/[#>*_`[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (value || fallback || '未命名文档').slice(0, 40);
}

function stripFrontmatter(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^---\s*\n/.test(raw)) return { body: raw, meta: {} };
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { body: raw, meta: {} };
  const head = raw.slice(4, end);
  const meta = {};
  for (const line of head.split('\n')) {
    const hit = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!hit) continue;
    meta[hit[1].toLowerCase()] = hit[2].trim().replace(/^["']|["']$/g, '');
  }
  return { body: raw.slice(end + 4).replace(/^\n+/, ''), meta };
}

function cleanInline(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*>\s?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按长度切块，尽量在句号/逗号处断开，避免 makeNoteBlock 的 2000 字截断。 */
function splitText(text, max = MAX_TEXT) {
  let rest = String(text || '').replace(/\s+/g, ' ').trim();
  if (!rest) return [];
  const out = [];
  let guard = 0;
  while (rest.length > max && guard++ < 200) {
    let cut = max;
    const window = rest.slice(0, max + 1);
    let best = -1;
    for (const mark of ['。', '！', '？', '.', '!', '?', '；', ';', '，', ',', '、', ' ']) {
      const at = window.lastIndexOf(mark);
      if (at > best) best = at;
    }
    if (best > max * 0.55) cut = best + 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function isTableDivider(line) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line);
}

function cleanTableRow(line) {
  const cells = line.replace(/^\||\|$/g, '').split('|').map((s) => cleanInline(s)).filter(Boolean);
  return cells.join(' · ');
}

/**
 * 幕布之类的工具会把标题导出成"孤立的短行 + 下面一串列表"，没有 # 号。
 * 这类行如果按正文处理，整篇文档就会摊平成同一层，导入后看不出上下级。
 * 判定刻意收紧：短、不带句子标点、下一行是列表/表格，才当作二级标题。
 */
function isPseudoHeading(lines, index) {
  const text = String(lines[index] || '').trim();
  if (!text || text.length > 30) return false;
  if (/^[#>*`|]/.test(text)) return false;
  if (/^[-*+•]\s/.test(text) || /^\d+[.)、]\s/.test(text)) return false;
  if (/[。！？；，、,.!?;:：）】》”’)]$/.test(text)) return false;
  for (let i = index + 1; i < lines.length; i++) {
    const next = String(lines[i] || '').trim();
    if (!next) continue;
    return /^([-*+•]\s|\d+[.)、]\s|\|)/.test(next);
  }
  return false;
}

/**
 * 解析 Markdown。标题会形成层级；正文段落挂在最近的标题下。
 * @param {{name:string, size:number, lastModified:number}} file
 * @param {string} text
 */
export function parseMarkdown(file, text) {
  const { body, meta } = stripFrontmatter(text);
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = cleanTitle(meta.title || (h1 ? h1[1] : ''), baseName(file.name));
  const root = [];
  const stack = [];
  let section = null;
  let sawHeading = false;
  let skippedTitle = false;
  let paragraph = [];
  let listStack = [];
  let inCode = false;
  let code = [];
  let blockCount = 0;
  let warning = '';

  const target = () => (section ? section.children : root);

  const pushBlock = (parent, block) => {
    if (blockCount >= MAX_BLOCKS) {
      warning = `内容较多，只保留了前 ${MAX_BLOCKS} 条`;
      return false;
    }
    parent.push(block);
    blockCount++;
    return true;
  };

  const addText = (value) => {
    for (const chunk of splitText(value)) {
      if (!pushBlock(target(), makeNoteBlock(chunk, []))) return;
    }
  };

  /** 列表项按缩进嵌套：缩进更深的是上一项的下一级，这样上下级不会摊平。 */
  const addListItem = (indentRaw, value) => {
    const indent = String(indentRaw || '').replace(/\t/g, '  ').length;
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
    const parent = listStack.length ? listStack[listStack.length - 1].block.children : target();
    const block = makeNoteBlock(value, []);
    if (!pushBlock(parent, block)) return;
    listStack.push({ indent, block });
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    listStack = [];
    const value = cleanInline(paragraph.join(' '));
    paragraph = [];
    if (value) addText(value);
  };

  const addHeading = (value, level) => {
    flushParagraph();
    listStack = [];
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].block.children : root;
    const block = makeNoteBlock(value, []);
    parent.push(block);
    blockCount++;
    stack.push({ level, block });
    section = block;
    sawHeading = true;
  };

  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      flushParagraph();
      if (inCode) {
        const codeText = cleanInline(code.join(' '));
        if (codeText) addText(`代码：${codeText}`);
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const value = cleanInline(heading[2]);
      if (!skippedTitle && level === 1 && h1 && value === cleanTitle(h1[1], '')) {
        // 第一个 H1 已经作为文档标题，避免在正文里重复出现。
        flushParagraph();
        skippedTitle = true;
        section = null;
        stack.length = 0;
        continue;
      }
      if (value) addHeading(value, level);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      if (!isTableDivider(line)) {
        const row = cleanTableRow(line);
        if (row) addText(row);
      }
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const value = cleanInline(bullet[2]);
      if (value) addListItem(bullet[1], value);
      continue;
    }
    const ordered = line.match(/^(\s*)\d+[.)、]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      const value = cleanInline(ordered[2]);
      if (value) addListItem(ordered[1], value);
      continue;
    }
    if (isPseudoHeading(lines, i)) {
      // 没有 # 的章节名（如幕布导出的 Git.md），按二级标题挂进层级。
      flushParagraph();
      addHeading(cleanInline(line), 2);
      continue;
    }
    paragraph.push(line.replace(/^\s*>\s?/, ''));
  }
  flushParagraph();

  const blocks = countBlocks(root);
  return {
    key: `${file.name}:${file.size}:${file.lastModified}`,
    file,
    title,
    kind: 'md',
    content: root,
    blocks,
    chars: body.length,
    pages: 0,
    structured: sawHeading,
    warning
  };
}

function countBlocks(list) {
  let n = 0;
  for (const block of list || []) {
    n++;
    n += countBlocks(block.children);
  }
  return n;
}

/** 取一段文字的字号：pdf.js 给的是 height，兜底用 transform 的缩放。 */
function pdfItemSize(item) {
  if (item && typeof item.height === 'number' && item.height > 0) return item.height;
  const t = item && item.transform;
  if (Array.isArray(t) && typeof t[3] === 'number' && t[3] !== 0) return Math.abs(t[3]);
  return 10;
}

function joinPdfParts(parts) {
  let line = '';
  const sorted = [...parts].sort((a, b) => a.x - b.x);
  for (const part of sorted) {
    const str = part.str;
    if (!str) continue;
    if (!line) {
      line = str;
      continue;
    }
    const noSpace = PUNCT_END.test(line) || PUNCT_START.test(str) || (CJK_END.test(line) && CJK_START.test(str));
    line += (noSpace ? '' : ' ') + str;
  }
  return line.replace(/\s+/g, ' ').trim();
}

/** 把一页的文字项按基线聚成行，保留字号与左边界，供标题/正文判定。 */
function pdfRows(items) {
  const groups = [];
  for (const item of items || []) {
    const str = String(item && item.str ? item.str : '');
    if (!str.trim()) continue;
    const size = pdfItemSize(item);
    const t = (item && item.transform) || [];
    const x = typeof t[4] === 'number' ? t[4] : 0;
    const y = typeof t[5] === 'number' ? t[5] : 0;
    let group = null;
    for (const g of groups) {
      if (Math.abs(g.y - y) <= Math.max(2, size * 0.4)) {
        group = g;
        break;
      }
    }
    if (!group) {
      group = { y, x, size, parts: [] };
      groups.push(group);
    }
    group.parts.push({ x, str, size });
    group.x = Math.min(group.x, x);
    group.size = Math.max(group.size, size);
  }
  return groups
    .map((g) => ({ text: joinPdfParts(g.parts), size: g.size, x: g.x, y: g.y }))
    .filter((row) => row.text)
    .sort((a, b) => b.y - a.y);
}

/**
 * 从排版线索里还原 PDF 层级。经验：幕布 / Markdown 转出的 PDF 里，
 * 标题是「短、以中文开头、不含标点与空格」的行，且缩进比正文浅；
 * 缩进越浅层级越高。识别不出两个以上标题时返回 null（调用方平铺）。
 */
function buildPdfTree(rows, title) {
  if (rows.length < 3) return null;
  const sizes = rows.map((row) => row.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 0;
  if (!(median > 0)) return null;

  const keyOf = (row) => `${Math.round(row.x / 8)}:${row.size.toFixed(1)}`;
  const isHeading = (row) => {
    const text = row.text;
    if (!text || text.length < 2 || text.length > 44) return false;
    if (!/^[\u3400-\u9fff]/.test(text)) return false;
    if (/[\s\u3000]/.test(text)) return false;
    if (/[，、；：。！？,;:!?]/.test(text)) return false;
    if (/^\d/.test(text)) return false;
    return row.size >= median * 0.99;
  };
  const headings = rows.filter(isHeading);
  if (headings.length < 2) return null;

  const seen = new Map();
  for (const row of headings) {
    const key = keyOf(row);
    if (!seen.has(key)) seen.set(key, row);
  }
  // 缩进越浅层级越高；同一缩进时字号大的更高。
  const ordered = [...seen.entries()].sort((a, b) => a[1].x - b[1].x || b[1].size - a[1].size);
  const rank = new Map();
  ordered.forEach(([key], index) => rank.set(key, Math.min(index, 2)));

  const root = { title, blocks: [], children: [] };
  const stack = [root];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const text = pending.join(' ');
    pending = [];
    for (const chunk of splitText(text)) stack[stack.length - 1].blocks.push(makeNoteBlock(chunk, []));
  };

  for (const row of rows) {
    if (isHeading(row)) {
      flush();
      const level = (rank.get(keyOf(row)) || 0) + 1;
      while (stack.length > level) stack.pop();
      const node = { title: row.text.slice(0, 44), blocks: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    // 页脚（幕布导出带作者/发布方）字号更小且很短，直接丢弃。
    if (row.size < median * 0.92 && row.text.length < 40) continue;
    pending.push(row.text);
    // 正文按行成块：命令/说明类 PDF 一行就是一条，合并反而糊在一起。
    flush();
  }
  flush();
  return root;
}

/** 结构树转笔记块：标题成为块本身，正文与子标题嵌套在 children 里。 */
function outlineToBlocks(node) {
  const blocks = [...node.blocks];
  for (const child of node.children) {
    blocks.push(makeNoteBlock(child.title, outlineToBlocks(child), false));
  }
  return blocks;
}

/** 按预算裁剪块树（复制节点，不动原对象）。 */
function clipBlocks(list, state) {
  const out = [];
  for (const block of list) {
    if (state.left <= 0) break;
    state.left--;
    out.push({ ...block, children: clipBlocks(block.children || [], state) });
  }
  return out;
}

/**
 * 解析 PDF。优先按字号/缩进还原标题层级；识别不出来时退回平铺。
 * 扫描版/纯图片 PDF 没有可提取文字，会抛错让 UI 提示。
 * @param {{name:string, size:number, lastModified:number}} file
 */
export async function parsePdf(file, onProgress) {
  await ensurePdfWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise;
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    title = meta && meta.info && meta.info.Title ? String(meta.info.Title) : '';
  } catch {
    title = '';
  }
  const pageCount = pdf.numPages;
  const rows = [];
  let chars = 0;
  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    for (const row of pdfRows(textContent.items)) {
      rows.push(row);
      chars += row.text.length;
    }
    if (onProgress) onProgress(pageNo, pageCount);
  }
  await pdf.destroy();
  if (!rows.length) throw new Error('没有提取到文字，可能是扫描版 PDF');

  const docTitle = cleanTitle(title, baseName(file.name));
  const tree = buildPdfTree(rows, docTitle);
  let content = [];
  if (tree) {
    content = outlineToBlocks(tree);
  } else {
    for (const row of rows) {
      for (const chunk of splitText(row.text)) content.push(makeNoteBlock(chunk, []));
    }
  }

  let warning = '';
  if (countBlocks(content) > MAX_BLOCKS) {
    content = clipBlocks(content, { left: MAX_BLOCKS });
    warning = `内容较多，只保留了前 ${MAX_BLOCKS} 条`;
  }

  return {
    key: `${file.name}:${file.size}:${file.lastModified}`,
    file,
    title: docTitle,
    kind: 'pdf',
    content,
    blocks: countBlocks(content),
    chars,
    pages: pageCount,
    structured: Boolean(tree),
    warning
  };
}

/**
 * 按扩展名解析一个文件。
 * @param {File} file
 * @param {(page:number,total:number)=>void} [onProgress]
 */
export async function parseDocumentFile(file, onProgress) {
  const name = String(file.name || '').toLowerCase();
  if (/\.(md|markdown)$/.test(name)) {
    return parseMarkdown(file, await file.text());
  }
  if (/\.pdf$/.test(name)) {
    return parsePdf(file, onProgress);
  }
  throw new Error('只支持 Markdown 或 PDF');
}

export { MAX_BLOCKS };