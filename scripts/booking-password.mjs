import {readFileSync} from 'node:fs';
import {hashPassword} from '../middleware/mimori-crypto.mjs';
// Pipe directly into a secret store; the password is never passed in argv or written to disk.
const password=readFileSync(0,'utf8').replace(/\r?\n$/,'');
if(password.length<16||password.length>512)throw Error('Use a password of 16–512 characters.');
process.stdout.write(await hashPassword(password)+'\n');
