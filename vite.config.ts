import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'isolated-content-script',
    apply: 'build',
    generateBundle(_options, bundle) {
      const content = bundle['content.js'];
      if (content?.type !== 'chunk') return;
      if (content.imports.length) this.error('The content script must remain self-contained for browser injection.');
      // executeScript may load this file again after an extension update.
      // Keep lexical declarations local so reinjection can replace listeners
      // without a top-level "Identifier has already been declared" failure.
      content.code = `(() => {\n${content.code}\n})();`;
    },
  }],
  resolve: {
    // Use the patched non-minified ES build so MV3 remote-code removals
    // (pdfobject CDN, loadFile XHR, canvg dynamic import) are included.
    // package.json "browser"/"module" point at jspdf.es.min.js which is harder to patch fully.
    alias: {
      jspdf: resolve(__dirname, 'node_modules/jspdf/dist/jspdf.es.js'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
