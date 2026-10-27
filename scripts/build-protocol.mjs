import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex').slice(0,16);
const options={bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof'};
await build({...options,entryPoints:['protocol/browser-worker.mjs'],outfile:'mimori/crypto.worker.js',define:{__MIMORI_WASM_URL__:JSON.stringify('/mimori/crypto/mimori_crypto_bg.wasm?v='+await digest('mimori/crypto/mimori_crypto_bg.wasm'))}});
await build({...options,entryPoints:['protocol/browser.mjs'],outfile:'mimori/app.bundle.js',define:{__MIMORI_WORKER_URL__:JSON.stringify('/mimori/crypto.worker.js?v='+await digest('mimori/crypto.worker.js'))}});
