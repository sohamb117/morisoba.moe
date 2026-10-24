import {scrypt, randomBytes, createHash, timingSafeEqual} from 'node:crypto';
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
// OWASP's 16 MiB scrypt configuration, suitable for the Worker memory limit.
const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, {N:16384, r:8, p:5, maxmem:32 * 1024 * 1024}, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:16384:8:5:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, record) {
  const match = /^scrypt:16384:8:5:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(record || '');
  const key = await derive(password, match?.[1] || '0'.repeat(32));
  return !!match && timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}
