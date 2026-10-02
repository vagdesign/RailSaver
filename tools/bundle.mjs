// Bundles the page scripts into plain (non-module) scripts for older WebKit:
// macOS 11/12 (Safari 14–16.3) have no import maps and no class static
// blocks, which three.js uses; the bundle has neither.
//   node tools/bundle.mjs        → web/dist/railsaver.js, web/dist/settings.js
// Needs esbuild (npm install --no-save esbuild). Without the bundles the pages
// fall back to loading the ES modules directly (fine in current browsers).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');   // works on Windows too
const common = {
  bundle: true,
  format: 'iife',
  target: ['safari14', 'chrome90', 'edge90', 'firefox90'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  alias: { three: path.join(root, 'lib/three.module.js') },
  logLevel: 'info',
};
await build({ ...common, entryPoints: [path.join(root, 'js/main.js')], outfile: path.join(root, 'dist/railsaver.js') });
await build({ ...common, entryPoints: [path.join(root, 'js/ui.js')], outfile: path.join(root, 'dist/settings.js') });
