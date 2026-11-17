import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Génère un service worker minimal (sw.js) avec la liste complète des fichiers
 * à mettre en cache (précache). Pas de dépendance externe : l'app fonctionne
 * hors-ligne dès la première visite.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'esn-service-worker',
    apply: (_config, env) => env.command === 'build' && !env.isSsrBuild,
    generateBundle(_options, bundle) {
      const publicDir = join(process.cwd(), 'public');
      const publicFiles: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else publicFiles.push(relative(publicDir, full).split('\\').join('/'));
        }
      };
      try {
        walk(publicDir);
      } catch {
        /* pas de dossier public */
      }
      const files = ['./', ...Object.keys(bundle), ...publicFiles]
        // pdf.js (≈ 1,9 Mo) : chargé seulement quand une compétition ne publie que des PDF, puis mis en cache.
        // Polices .woff : doublons des .woff2 (lus par tous les navigateurs actuels).
        // Données du club (data/) : lues par l'application quand elles changent, pas à chaque mise à jour du code.
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js' && !/^assets\/pdf/.test(f) && !/\.woff$/.test(f) && !/^data\//.test(f))
        .map((f) => (f === './' ? f : `./${f}`));
      const hash = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle)) {
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : String(chunk.source));
      }
      // Une nouvelle version des données (data/) ne force pas le retéléchargement de toute l'application
      for (const f of publicFiles) if (!/^data\//.test(f)) hash.update(readFileSync(join(publicDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync(join(process.cwd(), 'src', 'sw-template.js'), 'utf8');
      const source = template
        .replace('__CACHE_VERSION__', version)
        .replace('__PRECACHE_FILES__', JSON.stringify(Array.from(new Set(files))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as never);
