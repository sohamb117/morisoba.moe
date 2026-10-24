import {token, digest, hashPassword, verifyPassword} from './mimori-crypto.mjs';
const BASE = '/api/mimorigasaka';
const WEEK = 7 * 86400000;
const PUBLIC_USER = 'id, username, display_name, bio, role, avatar_version';
const HEADERS = {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Vary':'Cookie'};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200, extra = {}) => Response.json(data, {status, headers:{...HEADERS, ...extra}});
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const userView = u => ({id:u.id, username:u.username, displayName:u.display_name, bio:u.bio, role:u.role, avatarVersion:u.avatar_version});
function cookieInfo(request, env) {
  const url = new URL(request.url);
  const local = env.MIMORI_LOCAL === 'true' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  return {name:local ? 'mimori_local' : '__Host-mimori', flags:`Path=/; HttpOnly; SameSite=Strict${local ? '' : '; Secure'}`};
}
function setCookie(request, env, value, maxAge) {
  const {name, flags} = cookieInfo(request, env);
  return `${name}=${value}; ${flags}; Max-Age=${maxAge}`;
}
function cookieValue(request, env) {
  const {name} = cookieInfo(request, env);
  const parts = (request.headers.get('Cookie') || '').split(';').map(s => s.trim());
  return parts.find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
}
async function session(request, env) {
  const raw = cookieValue(request, env);
  if (!/^[a-f0-9]{64}$/.test(raw)) return null;
  return one(env.MIMORI_DB, `SELECT u.*, s.csrf, s.token_hash AS session_hash FROM mimori_sessions s JOIN mimori_users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`, digest(raw), Date.now());
}
async function issueSession(request, env, user) {
  const raw = token(), csrf = token(), now = Date.now();
  await env.MIMORI_DB.batch([
    env.MIMORI_DB.prepare('DELETE FROM mimori_sessions WHERE expires_at<=?').bind(now),
    env.MIMORI_DB.prepare('DELETE FROM mimori_limits WHERE expires_at<=?').bind(now),
    env.MIMORI_DB.prepare('INSERT INTO mimori_sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').bind(digest(raw), user.id, csrf, now + WEEK)
  ]);
  return json({user:userView(user), csrf}, 200, {'Set-Cookie':setCookie(request, env, raw, WEEK / 1000)});
}
async function limit(db, scope, maximum, interval = 900000) {
  const now = Date.now(), key = digest(scope);
  const row = await one(db, `INSERT INTO mimori_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`, key, now + interval, now, now);
  if (row.count > maximum) fail(429, 'Too many attempts. Try again later.');
}
async function bytes(request, maximum) {
  if (Number(request.headers.get('Content-Length')) > maximum) fail(413, 'Upload is too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); fail(413, 'Upload is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') fail(415, 'Use JSON.');
  try {
    const data = JSON.parse(new TextDecoder().decode(await bytes(request, 16000)));
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid request.');
    return data;
  } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Invalid JSON.'); }
}
function text(value, max, name, min = 0) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(400, `Invalid ${name}.`);
  return value.trim();
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Use a passcode of 12–128 characters.');
  return value;
}
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(value)) fail(400, 'ID must be 3–24 letters, numbers, or underscores.');
  return value.toLowerCase();
}
function checkOrigin(request, env) {
  const url = new URL(request.url);
  const expected = env.MIMORI_ORIGIN || 'https://morisoba.moe';
  const local = env.MIMORI_LOCAL === 'true' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (request.headers.get('Origin') !== (local ? url.origin : expected) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Request origin rejected.');
}
function admin(user) { if (user.role !== 'admin') fail(403, 'Owner access required.'); }
function avatarMime(data) {
  const b = [...data.slice(0,12)];
  if (b.slice(0,8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') return 'image/webp';
  fail(415, 'Use a PNG, JPEG, or WebP picture.');
}
export async function mimorigasakaMiddleware(request, env, next) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return next();
  try {
    if (!env.MIMORI_DB) fail(503, 'Mimorigasaka is not configured yet.');
    const db = env.MIMORI_DB, route = url.pathname.slice(BASE.length), method = request.method;
    const mutation = !['GET','HEAD'].includes(method);
    if (mutation) checkOrigin(request, env);
    if (['/login','/register'].includes(route) && method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      await limit(db, 'auth-ip:' + ip, 30);
      const data = await body(request), id = username(data.username), pass = password(data.password);
      await limit(db, 'auth-id:' + id, 10);
      if (route === '/login') {
        const user = await one(db, 'SELECT * FROM mimori_users WHERE username=?', id);
        const valid = await verifyPassword(pass, user?.password_hash);
        if (!valid || user.disabled) fail(401, 'ID or passcode is incorrect.');
        return issueSession(request, env, user);
      }
      if (typeof data.invite !== 'string' || !/^[a-f0-9]{64}$/.test(data.invite)) fail(400, 'Invitation is invalid or expired.');
      const inviteHash = digest(data.invite), now = Date.now();
      const invite = await one(db, 'SELECT * FROM mimori_invites WHERE token_hash=? AND claimed_by IS NULL AND revoked=0 AND expires_at>?', inviteHash, now);
      if (!invite) fail(400, 'Invitation is invalid or expired.');
      const hash = await hashPassword(pass), uid = crypto.randomUUID();
      try {
        // One transaction: a unique invite may create exactly one account, even under racing requests.
        const result = await db.batch([
          db.prepare(`INSERT INTO mimori_users(id,username,display_name,password_hash,role,registration_invite,created_at) SELECT ?,?,?,?,role,token_hash,? FROM mimori_invites WHERE token_hash=? AND claimed_by IS NULL AND revoked=0 AND expires_at>?`).bind(uid,id,id,hash,now,inviteHash,Date.now()),
          db.prepare('UPDATE mimori_invites SET claimed_by=? WHERE token_hash=? AND EXISTS(SELECT 1 FROM mimori_users WHERE id=?)').bind(uid,inviteHash,uid)
        ]);
        if (!result[0].meta.changes) fail(400, 'Invitation is invalid or expired.');
      } catch (e) {
        if (e instanceof HttpError) throw e;
        if (/UNIQUE constraint/.test(e.message)) fail(409, 'ID or invitation is already in use.');
        throw e;
      }
      return issueSession(request, env, await one(db, `SELECT ${PUBLIC_USER} FROM mimori_users WHERE id=?`, uid));
    }
    const user = await session(request, env);
    if (route === '/session' && method === 'GET') return json(user ? {user:userView(user), csrf:user.csrf} : {user:null});
    if (!user) fail(401, 'Sign in to view posts.');
    if (mutation && request.headers.get('X-CSRF-Token') !== user.csrf) fail(403, 'Session check failed. Reload and try again.');
    if (mutation) await limit(db, 'write:' + user.id, 120, 60000);
    if (route === '/logout' && method === 'POST') {
      await run(db, 'DELETE FROM mimori_sessions WHERE token_hash=?', user.session_hash);
      return json({ok:true}, 200, {'Set-Cookie':setCookie(request, env, '', 0)});
    }
    if (route === '/password' && method === 'POST') {
      const data = await body(request); await limit(db, 'password:' + user.id, 5);
      if (!await verifyPassword(password(data.currentPassword), user.password_hash)) fail(400, 'Current passcode is incorrect.');
      const hash = await hashPassword(password(data.password));
      await db.batch([db.prepare('UPDATE mimori_users SET password_hash=? WHERE id=?').bind(hash,user.id), db.prepare('DELETE FROM mimori_sessions WHERE user_id=?').bind(user.id)]);
      return issueSession(request, env, user);
    }
    if (route === '/profile' && method === 'PATCH') {
      const data = await body(request), name = text(data.displayName, 48, 'name', 1), bio = text(data.bio, 280, 'bio');
      await run(db, 'UPDATE mimori_users SET display_name=?,bio=? WHERE id=?', name,bio,user.id);
      return json({user:userView(await one(db, `SELECT ${PUBLIC_USER} FROM mimori_users WHERE id=?`, user.id))});
    }
    if (route === '/avatar' && method === 'PUT') {
      await limit(db, 'avatar:' + user.id, 10, 3600000);
      const data = await bytes(request, 256000), mime = avatarMime(data);
      await run(db, 'UPDATE mimori_users SET avatar=?,avatar_type=?,avatar_version=avatar_version+1 WHERE id=?', data.buffer,mime,user.id);
      return json({user:userView(await one(db, `SELECT ${PUBLIC_USER} FROM mimori_users WHERE id=?`, user.id))});
    }
    if (route === '/avatar' && method === 'DELETE') {
      await run(db,'UPDATE mimori_users SET avatar=NULL,avatar_type=NULL,avatar_version=avatar_version+1 WHERE id=?',user.id);
      return json({user:userView(await one(db, `SELECT ${PUBLIC_USER} FROM mimori_users WHERE id=?`, user.id))});
    }
    const avatar = /^\/avatars\/([a-f0-9-]{36})$/.exec(route);
    if (avatar && method === 'GET') {
      const row = await one(db, 'SELECT avatar,avatar_type FROM mimori_users WHERE id=? AND disabled=0', avatar[1]);
      if (!row?.avatar) return new Response(null, {status:404, headers:HEADERS});
      return new Response(new Uint8Array(row.avatar), {headers:{...HEADERS, 'Content-Type':row.avatar_type, 'Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    if (route === '/posts' && method === 'GET') {
      const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before) || before < 1) fail(400, 'Invalid cursor.');
      const pinned = url.searchParams.get('pinned') === '1';
      const author = url.searchParams.get('author');
      const rows = await all(db, `SELECT p.*,u.username,u.display_name,u.avatar_version FROM mimori_posts p JOIN mimori_users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND u.disabled=0 AND p.id<? ${pinned ? 'AND p.pinned=1' : ''} ${author ? 'AND u.username=?' : ''} ORDER BY p.id DESC LIMIT 31`, ...[before,...(author ? [username(author)] : [])]);
      const more = rows.length > 30; if (more) rows.pop();
      return json({posts:rows.map(p=>({id:p.id,body:p.body,pinned:!!p.pinned,createdAt:p.created_at,updatedAt:p.updated_at,author:{id:p.user_id,username:p.username,displayName:p.display_name,avatarVersion:p.avatar_version},canEdit:p.user_id===user.id,canModerate:user.role==='admin'})),next:more ? rows.at(-1).id : null});
    }
    if (route === '/posts' && method === 'POST') {
      const data = await body(request), content = text(data.body, 2000, 'post', 1);
      const now = Date.now();
      const result = await run(db, 'INSERT INTO mimori_posts(user_id,body,created_at,updated_at) VALUES(?,?,?,?)', user.id,content,now,now);
      return json({id:result.meta.last_row_id}, 201);
    }
    const post = /^\/posts\/([1-9][0-9]*)$/.exec(route);
    if (post && method === 'GET') {
      const p = await one(db, `SELECT p.*,u.username,u.display_name,u.avatar_version FROM mimori_posts p JOIN mimori_users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL AND u.disabled=0`,Number(post[1]));
      if (!p) fail(404, 'Post not found.');
      return json({post:{id:p.id,body:p.body,pinned:!!p.pinned,createdAt:p.created_at,updatedAt:p.updated_at,author:{id:p.user_id,username:p.username,displayName:p.display_name,avatarVersion:p.avatar_version},canEdit:p.user_id===user.id,canModerate:user.role==='admin'}});
    }
    if (post && ['PATCH','DELETE'].includes(method)) {
      const existing = await one(db, 'SELECT * FROM mimori_posts WHERE id=? AND deleted_at IS NULL', Number(post[1]));
      if (!existing) fail(404, 'Post not found.');
      if (existing.user_id !== user.id && !(method === 'DELETE' && user.role === 'admin')) fail(403, 'You can only edit your own posts.');
      if (method === 'DELETE') { await run(db, 'UPDATE mimori_posts SET deleted_at=? WHERE id=?', Date.now(),existing.id); return json({ok:true}); }
      const data = await body(request);
      const content = data.body === undefined ? existing.body : text(data.body,2000,'post',1);
      if (data.pinned !== undefined && typeof data.pinned !== 'boolean') fail(400, 'Invalid pin.');
      await run(db, 'UPDATE mimori_posts SET body=?,pinned=?,updated_at=? WHERE id=?', content,data.pinned === undefined ? existing.pinned : Number(data.pinned),content === existing.body ? existing.updated_at : Date.now(),existing.id);
      return json({ok:true});
    }
    if (route === '/invites' && method === 'GET') {
      admin(user);
      return json({invites:await all(db, 'SELECT token_hash AS id,created_at AS createdAt,expires_at AS expiresAt,claimed_by AS claimedBy,revoked FROM mimori_invites WHERE created_by=? ORDER BY created_at DESC LIMIT 50',user.id)});
    }
    if (route === '/invites' && method === 'POST') {
      admin(user); await limit(db,'invite:' + user.id,20,3600000);
      const raw = token(), now = Date.now();
      await run(db, 'INSERT INTO mimori_invites(token_hash,role,created_at,expires_at,created_by) VALUES(?,?,?,?,?)', digest(raw),'member',now,now+WEEK,user.id);
      return json({token:raw,expiresAt:now+WEEK},201);
    }
    const invite = /^\/invites\/([a-f0-9]{64})$/.exec(route);
    if (invite && method === 'DELETE') {
      admin(user); await run(db,'UPDATE mimori_invites SET revoked=1 WHERE token_hash=? AND created_by=? AND claimed_by IS NULL',invite[1],user.id);
      return json({ok:true});
    }
    if (route === '/members' && method === 'GET') {
      admin(user); return json({members:await all(db,`SELECT ${PUBLIC_USER},disabled FROM mimori_users ORDER BY created_at DESC LIMIT 200`)});
    }
    const member = /^\/members\/([a-f0-9-]{36})$/.exec(route);
    if (member && method === 'PATCH') {
      admin(user); const data = await body(request);
      if (typeof data.disabled !== 'boolean') fail(400,'Invalid member status.');
      const target = await one(db,'SELECT id,role FROM mimori_users WHERE id=?',member[1]);
      if (!target || target.role === 'admin') fail(403,'Owner accounts cannot be disabled here.');
      await db.batch([db.prepare('UPDATE mimori_users SET disabled=? WHERE id=?').bind(Number(data.disabled),target.id),db.prepare('DELETE FROM mimori_sessions WHERE user_id=?').bind(target.id)]);
      return json({ok:true});
    }
    fail(404,'Not found.');
  } catch (e) {
    if (e instanceof HttpError) return json({error:e.message},e.status,e.status===429 ? {'Retry-After':'900'} : {});
    // Deliberately omit request data, credentials, SQL, and exception text from logs and responses.
    console.error('Mimorigasaka request failed');
    return json({error:'Service unavailable. Please try again.'},503);
  }
}
