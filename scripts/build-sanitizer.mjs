// Lambda can disable require(ESM). Bundle the sanitizer's ESM dependencies
// instead of downgrading its security fixes or changing the runtime globally.
import {build} from 'esbuild';
await build({
  entryPoints:['sanitize-html'],
  outfile:'lib/generated/sanitize-html.cjs',
  bundle:true,
  platform:'node',
  format:'cjs',
  target:'node22',
});
