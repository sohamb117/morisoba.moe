import {build} from 'esbuild';
await build({entryPoints:['protocol/browser.mjs'],outfile:'mimorigasaka/protocol/app.bundle.js',bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof'});
