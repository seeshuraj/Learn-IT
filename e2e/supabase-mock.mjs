// A stand-in for the parts of Supabase Auth and Storage that LearnIT calls,
// for end-to-end tests in CI only. Users live in the test database's
// auth.users (so the real on_auth_user_created trigger runs); passwords are
// checked with pgcrypto. Tokens are HS256 JWTs signed with a throwaway key.
//
//   node e2e/supabase-mock.mjs          (DATABASE_URL, MOCK_PORT=54321)

import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const SECRET = crypto.randomBytes(32);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const files = new Map(); // "bucket/path" → { type, body }

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function sign(user) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [head, body, sig] = String(token ?? '').split('.');
  if (!sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}

const userJson = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
  email_confirmed_at: u.created_at, app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at,
});
const refreshTokens = new Map();
function session(u) {
  const refresh = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh, u);
  return { access_token: sign(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJson(u) };
}

async function findUser(id) {
  const { rows } = await pool.query('select id, email, created_at from auth.users where id = $1', [id]);
  return rows[0] ?? null;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body ?? {}) : body);
}
const authErr = (res, status, msg, code = 'invalid_credentials') => send(res, status, { error: code, error_description: msg, msg, code });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const jsonOf = (buf) => { try { return JSON.parse(buf.toString() || '{}'); } catch { return {}; } };
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const raw = await readBody(req);

  // ── Auth ────────────────────────────────────────────────────────────────
  if (p === '/auth/v1/token' && req.method === 'POST') {
    const b = jsonOf(raw);
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const u = refreshTokens.get(b.refresh_token);
      return u ? send(res, 200, session(u)) : authErr(res, 400, 'Invalid Refresh Token', 'refresh_token_not_found');
    }
    const { rows } = await pool.query(
      `select id, email, created_at from auth.users
       where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
      [b.email ?? '', b.password ?? '']);
    return rows[0] ? send(res, 200, session(rows[0])) : authErr(res, 400, 'Invalid login credentials');
  }
  if (p === '/auth/v1/user' && req.method === 'GET') {
    const c = verify(bearer(req));
    const u = c && await findUser(c.sub);
    return u ? send(res, 200, userJson(u)) : authErr(res, 401, 'invalid JWT', 'bad_jwt');
  }
  if (p === '/auth/v1/user' && req.method === 'PUT') {
    const c = verify(bearer(req));
    if (!c) return authErr(res, 401, 'invalid JWT', 'bad_jwt');
    const b = jsonOf(raw);
    if (b.password) await pool.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1", [c.sub, b.password]);
    return send(res, 200, userJson(await findUser(c.sub)));
  }
  if (p === '/auth/v1/logout') return send(res, 204, '', 'text/plain');
  if (p === '/auth/v1/recover') return send(res, 200, {});
  if (p.endsWith('/.well-known/jwks.json')) return send(res, 200, { keys: [] });

  if (p === '/auth/v1/admin/users' && req.method === 'POST') {
    const b = jsonOf(raw);
    try {
      const { rows } = await pool.query(
        `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
         values (gen_random_uuid(), 'authenticated', 'authenticated', lower($1), extensions.crypt($2, extensions.gen_salt('bf')), now())
         returning id, email, created_at`, [b.email, b.password ?? crypto.randomUUID()]);
      return send(res, 200, userJson(rows[0]));
    } catch (e) {
      return e.code === '23505' ? authErr(res, 422, 'A user with this email address has already been registered', 'email_exists') : authErr(res, 500, e.message, 'unexpected_failure');
    }
  }
  const adminUser = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
  if (adminUser && req.method === 'DELETE') {
    await pool.query('delete from auth.users where id = $1', [adminUser[1]]);
    return send(res, 200, {});
  }
  if (adminUser && req.method === 'PUT') {
    const b = jsonOf(raw);
    if (b.password) await pool.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1", [adminUser[1], b.password]);
    const u = await findUser(adminUser[1]);
    return u ? send(res, 200, userJson(u)) : authErr(res, 404, 'User not found', 'user_not_found');
  }
  if (adminUser && req.method === 'GET') {
    const u = await findUser(adminUser[1]);
    return u ? send(res, 200, userJson(u)) : authErr(res, 404, 'User not found', 'user_not_found');
  }

  // ── Storage (in memory) ─────────────────────────────────────────────────
  const signPath = p.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
  if (signPath && req.method === 'POST') {
    return send(res, 200, { signedURL: `/object/sign/${signPath[1]}?token=e2e` });
  }
  if (signPath && req.method === 'GET') {
    const f = files.get(decodeURIComponent(signPath[1]));
    return f ? send(res, 200, f.body, f.type) : send(res, 404, { error: 'not_found', message: 'Object not found' });
  }
  // Signed uploads: the server asks for a URL, the browser PUTs the file to it.
  const uploadSign = p.match(/^\/storage\/v1\/object\/upload\/sign\/(.+)$/);
  if (uploadSign && req.method === 'POST') {
    return send(res, 200, { url: `/object/upload/sign/${uploadSign[1]}?token=e2e-upload` });
  }
  if (uploadSign && req.method === 'PUT') {
    if (url.searchParams.get('token') !== 'e2e-upload') return send(res, 400, { error: 'invalid_token' });
    files.set(decodeURIComponent(uploadSign[1]), { type: req.headers['content-type'] ?? 'application/octet-stream', body: raw });
    return send(res, 200, { Key: uploadSign[1] });
  }
  const listIn = p.match(/^\/storage\/v1\/object\/list\/(.+)$/);
  if (listIn && req.method === 'POST') {
    const b = jsonOf(raw);
    const prefix = `${decodeURIComponent(listIn[1])}/${b.prefix ? `${b.prefix}/` : ''}`;
    const out = [...files.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && (!b.search || k.slice(prefix.length).includes(b.search)))
      .map(([k, f]) => ({ name: k.slice(prefix.length), id: k, metadata: { size: f.body.length, mimetype: f.type } }));
    return send(res, 200, out);
  }
  const obj = p.match(/^\/storage\/v1\/object\/(?:authenticated\/)?(.+)$/);
  if (obj && req.method === 'HEAD') {
    const f = files.get(decodeURIComponent(obj[1]));
    res.writeHead(f ? 200 : 404, f ? { 'Content-Type': f.type, 'Content-Length': f.body.length } : {});
    return res.end();
  }
  const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
  if (obj && req.method === 'GET' && range) {
    const f = files.get(decodeURIComponent(obj[1]));
    if (!f) return send(res, 404, { error: 'not_found', message: 'Object not found' });
    const part = f.body.subarray(Number(range[1]), Number(range[2]) + 1);
    res.writeHead(206, { 'Content-Type': f.type, 'Content-Range': `bytes ${range[1]}-${range[1] * 1 + part.length - 1}/${f.body.length}` });
    return res.end(part);
  }
  if (obj && (req.method === 'POST' || req.method === 'PUT')) {
    files.set(decodeURIComponent(obj[1]), { type: req.headers['content-type'] ?? 'application/octet-stream', body: raw });
    return send(res, 200, { Key: obj[1], Id: crypto.randomUUID() });
  }
  if (obj && req.method === 'GET') {
    const f = files.get(decodeURIComponent(obj[1]));
    return f ? send(res, 200, f.body, f.type) : send(res, 404, { error: 'not_found', message: 'Object not found' });
  }
  if (obj && req.method === 'DELETE') {
    for (const k of jsonOf(raw).prefixes ?? []) files.delete(`${obj[1]}/${k}`);
    return send(res, 200, []);
  }
  if (p.startsWith('/storage/v1/bucket')) return send(res, 200, []);

  return send(res, 404, { error: 'not_found', message: `e2e mock has no ${req.method} ${p}` });
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-upsert, cache-control, range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  handle(req, res).catch(e => { console.error('[mock]', e); send(res, 500, { error: 'mock_error', message: e.message }); });
}).listen(PORT, '127.0.0.1', () => console.log(`[mock] Supabase stand-in on :${PORT}`));
