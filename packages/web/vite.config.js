/**
 * 生产构建打成「单文件」：JS 与 CSS 全部内联进 index.html，
 * 这样 dist/index.html 可以直接双击（file://）打开，不需要起服务器。
 * 注释用英文，避免不同终端编码把中文读成乱码。
 */
import { defineConfig } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWLEDGE_DIR = fileURLToPath(new URL('../../knowledge/', import.meta.url));

// Serve repository knowledge/*.json in dev/preview so relative paths like
// "knowledge/seed.json" work from the settings dialog. Only .json files inside
// that folder are exposed.
function knowledgeFilesPlugin() {
  const serve = (req, res, next) => {
    const pathname = decodeURIComponent(String(req.url || '').split('?')[0]);
    if (!pathname.startsWith('/knowledge/')) return next();
    const file = resolve(KNOWLEDGE_DIR, pathname.slice('/knowledge/'.length));
    if (!file.startsWith(KNOWLEDGE_DIR) || !file.endsWith('.json') || !existsSync(file)) return next();
    if (!statSync(file).isFile()) return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'starmap-knowledge-files',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    }
  };
}

// Inline every JS chunk and stylesheet into the HTML entry.
function singleFilePlugin() {
  return {
    name: 'starmap-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlKey = Object.keys(bundle).find((k) => k.endsWith('.html'));
      if (!htmlKey) return;
      const htmlAsset = bundle[htmlKey];
      let html = String(htmlAsset.source);

      for (const [key, item] of Object.entries(bundle)) {
        if (key === htmlKey) continue;
        if (item.type === 'chunk' && !item.isEntry) {
          // dynamic chunks are already inlined via inlineDynamicImports
          delete bundle[key];
          continue;
        }
        if (item.type === 'chunk') {
          const code = item.code.replace(/<\/script/gi, '<\\/script');
          html = html.replace(
            new RegExp('<script[^>]*src="[^"]*' + escapeRegExp(key) + '"[^>]*></script>'),
            () => '<script type="module">\n' + code + '\n</script>'
          );
          delete bundle[key];
          continue;
        }
        if (item.type === 'asset' && (key.endsWith('.css') || item.fileName.endsWith('.css'))) {
          const css = String(item.source);
          html = html.replace(
            new RegExp('<link[^>]*href="[^"]*' + escapeRegExp(item.fileName) + '"[^>]*>'),
            () => '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>'
          );
          delete bundle[key];
        }
      }

      htmlAsset.source = html;
    }
  };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  base: './',
  plugins: [knowledgeFilesPlugin(), singleFilePlugin()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 1024 * 1024,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});