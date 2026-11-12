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
  let inCode = false;
  let code = [];
  let blockCount = 0;
  let warning = '';

  const target = () => (section ? section.children : root);

  const addText = (value) => {
    for (const chunk of splitText(value)) {
      if (blockCount >= MAX_BLOCKS) {
        warning = `内容较多，只保留了前 ${MAX_BLOCKS} 条`;
        return;
      }
      target().push(makeNoteBlock(chunk, []));
      blockCount++;
    }
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const value = cleanInline(paragraph.join(' '));
    paragraph = [];
    if (value) addText(value);
  };

  const addHeading = (value, level) => {
    flushParagraph();
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
    const bullet = line.match(/^\s*[-*+•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const value = cleanInline(bullet[1]);
      if (value) addText(value);
      continue;
    }
    if (/^\s*\d+[.)、]\s+/.test(line)) {
      flushParagraph();
      const value = cleanInline(line.replace(/^\s*\d+[.)、]\s+/, ''));
      if (value) addText(value);
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

function pdfLineText(items) {
  let line = '';
  const lines = [];
  for (const item of items || []) {
    const str = String(item && item.str ? item.str : '');
    if (!str) continue;
    if (!line) line = str;
    else {
      const noSpace = PUNCT_END.test(line) || PUNCT_START.test(str) || (CJK_END.test(line) && CJK_START.test(str));
      line += (noSpace ? '' : ' ') + str;
    }
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = '';
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

function pdfParagraphs(raw) {
  const text = String(raw || '')
    .replace(/\r/g, '')
    .replace(/-\n(?=[A-Za-z])/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return [];
  const rawParas = text.split(/\n\s*\n/);
  const out = [];
  for (const para of rawParas) {
    const flat = para.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    for (const chunk of splitText(flat)) out.push(chunk);
  }
  return out;
}

/**
 * 解析 PDF。扫描版/纯图片 PDF 没有可提取文字，会抛错让 UI 提示。
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
  const content = [];
  let blocks = 0;
  let chars = 0;
  let warning = '';
  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const pageText = pdfLineText(textContent.items);
    chars += pageText.length;
    for (const para of pdfParagraphs(pageText)) {
      if (blocks >= MAX_BLOCKS) {
        warning = `内容较多，只保留了前 ${MAX_BLOCKS} 条`;
        break;
      }
      content.push(makeNoteBlock(para, []));
      blocks++;
    }
    if (onProgress) onProgress(pageNo, pageCount);
    if (blocks >= MAX_BLOCKS) break;
  }
  await pdf.destroy();
  if (!content.length) throw new Error('没有提取到文字，可能是扫描版 PDF');
  return {
    key: `${file.name}:${file.size}:${file.lastModified}`,
    file,
    title: cleanTitle(title, baseName(file.name)),
    kind: 'pdf',
    content,
    blocks,
    chars,
    pages: pageCount,
    structured: false,
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