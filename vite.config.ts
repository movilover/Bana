import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

const ALLOWED_ZIPS = new Set([
  'BANA-FULL-PROJECT.zip',
  'BANA-USER-WEBSITE.zip',
  'BANA-ADMIN-PANEL.zip',
  'BANA-BACKEND.zip',
  'BANA-SECURITY.zip',
]);

function banaReleaseDownloadPlugin(): Plugin {
  return {
    name: 'bana-release-zip-downloads',
    configureServer(server) {
      server.middlewares.use('/downloads', (req, res, next) => {
        const cleanName = path.basename((req.url || '').split('?')[0]);
        if (!ALLOWED_ZIPS.has(cleanName)) {
          next();
          return;
        }
        const filePath = path.resolve(__dirname, cleanName);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Archive not generated yet.');
          return;
        }
        const stat = fs.statSync(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    // GitHub Pages serves project sites from /<repo>/. The deploy workflow sets VITE_BASE_PATH automatically.
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss(), banaReleaseDownloadPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'firebase';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/lucide-react')
            ) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
