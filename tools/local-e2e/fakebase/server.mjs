// 로컬 시험용 가짜 Supabase(Auth·PostgREST·Storage) + 가짜 Claude API.
// 실제 Postgres(로컬) 위에서 RLS 를 그대로 적용해, 앱의 쿼리가 진짜처럼 동작하는지 본다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.FAKE_PORT || 54321);
const DB = process.env.FAKE_DB || 'kokapp';
const SECRET = process.env.FAKE_SECRET || 'sb_secret_fake';
const FILES = process.env.FAKE_FILES || path.join(path.dirname(new URL(import.meta.url).pathname), 'files');
const ORIGIN = process.env.FAKE_ORIGIN || 'http://localhost:3000';
const LOG = process.env.FAKE_LOG === '1';

const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 54329),
  user: process.env.PGUSER || 'postgres',
  database: DB,
  max: 12,
});
pool.on('error', (e) => console.error('[fake] pool error', e.message));
// numeric·int8 를 숫자로
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));
// date 는 문자열 그대로
pg.types.setTypeParser(1082, (v) => v);

const stats = { messages: 0, tasks: {} };
let failTask = process.env.FAKE_FAIL_TASK || '';

function b64urlJson(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}

function authOf(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const apikey = req.headers['apikey'] || '';
  if (token === SECRET || (!token && apikey === SECRET)) return { role: 'service_role', sub: null };
  if (token && token.split('.').length === 3) {
    try {
      const p = b64urlJson(token.split('.')[1]);
      if (p.exp && p.exp * 1000 < Date.now()) return { role: 'anon', sub: null, expired: true };
      return { role: 'authenticated', sub: p.sub, email: p.email };
    } catch {
      return { role: 'anon', sub: null };
    }
  }
  return { role: 'anon', sub: null };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*, authorization, apikey, content-type, prefer, range, x-client-info, x-upsert, accept-profile, content-profile, x-supabase-api-version');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, content-range');
}

function send(res, status, body, headers = {}) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined || body === null) {
    res.statusCode = status;
    res.end();
    return;
  }
  if (Buffer.isBuffer(body)) {
    res.statusCode = status;
    res.end(body);
    return;
  }
  res.statusCode = status;
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function asRole(auth, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (auth.role === 'service_role') {
      await client.query('set local role service_role');
    } else if (auth.role === 'authenticated') {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [auth.sub]);
    } else {
      await client.query('set local role anon');
    }
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function pgError(res, e) {
  const code = e.code || '';
  const status = code === '42501' ? 403 : code === 'PGRST116' ? 406 : code === '23505' ? 409 : code.startsWith('P0') ? 400 : 400;
  if (LOG) console.error('[fake] pg error', code, e.message);
  send(res, status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

// ------------------------------------------------------------------ PostgREST
const ident = (s) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: 'PGRST100' });
  return `"${s}"`;
};

function parseSelect(sel) {
  if (!sel || sel === '*') return '*';
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p === '*') return '*';
      let alias = null;
      let expr = p;
      const m = p.match(/^([A-Za-z_][A-Za-z0-9_]*):(.+)$/);
      if (m) {
        alias = m[1];
        expr = m[2];
      }
      const path = expr.split(/(->>|->)/);
      let sql = ident(path[0]);
      let last = path[0];
      for (let i = 1; i < path.length; i += 2) {
        const op = path[i];
        const key = path[i + 1];
        sql += `${op}'${key.replace(/'/g, "''")}'`;
        last = key;
      }
      return `${sql} as ${ident(alias ?? last)}`;
    })
    .join(', ');
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseList(v) {
  // ("a","b") 또는 (a,b)
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner) return [];
  return splitTop(inner).map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
}

function condFor(col, opval, params) {
  let neg = false;
  let rest = opval;
  if (rest.startsWith('not.')) {
    neg = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = rest.slice(0, dot);
  const val = rest.slice(dot + 1);
  const c = ident(col);
  const p = (x) => {
    params.push(x);
    return `$${params.length}`;
  };
  let sql;
  switch (op) {
    case 'eq':
      sql = `${c} = ${p(val)}`;
      break;
    case 'neq':
      sql = `${c} <> ${p(val)}`;
      break;
    case 'gt':
      sql = `${c} > ${p(val)}`;
      break;
    case 'gte':
      sql = `${c} >= ${p(val)}`;
      break;
    case 'lt':
      sql = `${c} < ${p(val)}`;
      break;
    case 'lte':
      sql = `${c} <= ${p(val)}`;
      break;
    case 'like':
      sql = `${c}::text like ${p(val.replace(/\*/g, '%'))}`;
      break;
    case 'ilike':
      sql = `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`;
      break;
    case 'is':
      sql = `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : val === 'false' ? 'false' : 'unknown'}`;
      break;
    case 'in':
      sql = `${c} = any(${p(parseList(val))})`;
      break;
    default:
      throw Object.assign(new Error(`op ${op} not supported`), { code: 'PGRST100' });
  }
  return neg ? `not (${sql})` : sql;
}

function parseOr(v, params) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  return '(' + splitTop(inner).map((part) => {
    const d = part.indexOf('.');
    return condFor(part.slice(0, d), part.slice(d + 1), params);
  }).join(' or ') + ')';
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function whereFrom(url, params) {
  const conds = [];
  for (const [k, v] of url.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === 'or') conds.push(parseOr(v, params));
    else conds.push(condFor(k, v, params));
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}

function orderFrom(url) {
  const o = url.searchParams.get('order');
  if (!o) return '';
  return (
    ' order by ' +
    o
      .split(',')
      .map((part) => {
        const [col, ...mods] = part.split('.');
        let s = ident(col);
        if (mods.includes('desc')) s += ' desc';
        if (mods.includes('nullsfirst')) s += ' nulls first';
        if (mods.includes('nullslast')) s += ' nulls last';
        return s;
      })
      .join(', ')
  );
}

async function handleRest(req, res, url, auth) {
  const rest = url.pathname.replace(/^\/rest\/v1\//, '');
  const prefer = String(req.headers['prefer'] || '');
  const accept = String(req.headers['accept'] || '');
  const single = accept.includes('vnd.pgrst.object+json');
  const wantRep = prefer.includes('return=representation');

  if (rest.startsWith('rpc/')) {
    const fn = rest.slice(4);
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    return asRole(auth, async (db) => {
      const info = await db.query(
        `select p.proretset, p.prorettype::regtype::text as rettype, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes,
                (select typtype from pg_type where oid = p.prorettype) as typtype
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`,
        [fn],
      );
      if (!info.rows.length) throw Object.assign(new Error(`function ${fn} not found`), { code: 'PGRST202' });
      const { proretset, proargnames, argtypes, typtype } = info.rows[0];
      const names = proargnames || [];
      const params = [];
      const args = names.map((n, i) => {
        let v = body[n];
        if (v !== null && typeof v === 'object') v = JSON.stringify(v);
        params.push(v === undefined ? null : v);
        return `${ident(n)} => $${params.length}::${argtypes[i]}`;
      });
      const call = `public.${ident(fn)}(${args.join(', ')})`;
      if (proretset && typtype === 'c') {
        const r = await db.query(`select * from ${call}`, params);
        return r.rows;
      }
      if (proretset) {
        const r = await db.query(`select v from ${call} as v`, params);
        return r.rows.map((x) => x.v);
      }
      const r = await db.query(`select ${call} as v`, params);
      return r.rows[0]?.v ?? null;
    }).then(
      (data) => send(res, 200, data),
      (e) => pgError(res, e),
    );
  }

  const table = `public.${ident(rest)}`;
  const select = parseSelect(url.searchParams.get('select'));

  if (req.method === 'GET' || req.method === 'HEAD') {
    const params = [];
    const where = whereFrom(url, params);
    const order = orderFrom(url);
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    let sql = `select ${select} from ${table}${where}${order}`;
    if (limit) sql += ` limit ${Number(limit)}`;
    if (offset) sql += ` offset ${Number(offset)}`;
    try {
      const out = await asRole(auth, async (db) => {
        const r = await db.query(sql, params);
        let total = null;
        if (prefer.includes('count=')) {
          const c = await db.query(`select count(*)::int as n from ${table}${where}`, params);
          total = c.rows[0].n;
        }
        return { rows: r.rows, total };
      });
      const from = Number(offset || 0);
      const headers = {};
      if (out.total !== null) headers['Content-Range'] = `${out.rows.length ? `${from}-${from + out.rows.length - 1}` : '*'}/${out.total}`;
      if (req.method === 'HEAD') return send(res, 200, null, headers);
      if (single) {
        if (out.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${out.rows.length} rows`, hint: null });
        return send(res, 200, out.rows[0], headers);
      }
      return send(res, 200, out.rows, headers);
    } catch (e) {
      return pgError(res, e);
    }
  }

  const raw = (await readBody(req)).toString();
  const body = raw ? JSON.parse(raw) : null;

  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const colList = cols.map(ident).join(', ');
    const onConflict = url.searchParams.get('on_conflict');
    const merge = prefer.includes('resolution=merge-duplicates');
    const ignore = prefer.includes('resolution=ignore-duplicates');
    let sql = `insert into ${table} (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1::json)`;
    if (merge || ignore) {
      let target = onConflict ? onConflict.split(',').map(ident).join(', ') : null;
      if (!target) {
        const pk = await pool.query(
          `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary`,
          [`public.${rest}`],
        );
        target = pk.rows.map((r) => ident(r.attname)).join(', ');
      }
      sql += ignore ? ` on conflict (${target}) do nothing` : ` on conflict (${target}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
    }
    if (wantRep) sql += ` returning ${select}`;
    try {
      const r = await asRole(auth, (db) => db.query(sql, [JSON.stringify(rows)]));
      if (!wantRep) return send(res, 201, null);
      if (single) return send(res, 201, r.rows[0] ?? null);
      return send(res, 201, r.rows);
    } catch (e) {
      return pgError(res, e);
    }
  }

  if (req.method === 'PATCH') {
    const cols = Object.keys(body || {});
    const params = [JSON.stringify(body)];
    const where = whereFrom(url, params);
    let sql = `update ${table} as t set ${cols.map((c) => `${ident(c)} = r.${ident(c)}`).join(', ')} from json_populate_record(null::${table}, $1::json) as r${where.replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, 't."$1"')}`;
    if (wantRep) sql += ` returning ${select === '*' ? 't.*' : select.replace(/(^|, )"/g, '$1t."')}`;
    try {
      const r = await asRole(auth, (db) => db.query(sql, params));
      if (!wantRep) return send(res, 204, null);
      return send(res, 200, single ? r.rows[0] ?? null : r.rows);
    } catch (e) {
      return pgError(res, e);
    }
  }

  if (req.method === 'DELETE') {
    const params = [];
    const where = whereFrom(url, params);
    let sql = `delete from ${table}${where}`;
    if (wantRep) sql += ` returning ${select}`;
    try {
      const r = await asRole(auth, (db) => db.query(sql, params));
      if (!wantRep) return send(res, 204, null);
      return send(res, 200, r.rows);
    } catch (e) {
      return pgError(res, e);
    }
  }
  return send(res, 405, { message: 'method' });
}

// ------------------------------------------------------------------ Storage
function filePath(bucket, name) {
  const p = path.join(FILES, bucket, name);
  if (!p.startsWith(path.join(FILES, bucket))) throw new Error('bad path');
  return p;
}

async function storageAllowed(auth, op, bucket, name) {
  if (auth.role === 'service_role') return true;
  if (auth.role !== 'authenticated') return false;
  try {
    await asRole(auth, async (db) => {
      if (op === 'insert') {
        await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
      } else {
        const r = await db.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]);
        if (!r.rows.length) throw Object.assign(new Error('not found'), { code: '42501' });
        if (op === 'delete') await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name]);
      }
    });
    return true;
  } catch {
    return false;
  }
}

async function handleStorage(req, res, url, auth) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''));
  // 한 번짜리 올리기 주소 만들기 (실제 Supabase 처럼 만드는 사람이 올릴 권한이 있어야 한다)
  if (req.method === 'POST' && p.startsWith('object/upload/sign/')) {
    const [, , , bucket, ...rest] = p.split('/');
    const name = rest.join('/');
    if (auth.role !== 'service_role') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    const token = crypto.createHmac('sha256', SECRET).update(`upload:${bucket}/${name}`).digest('hex');
    return send(res, 200, { url: `/object/upload/sign/${bucket}/${name}?token=${token}` });
  }
  // 한 번짜리 주소로 올리기 (로그인 없이, 토큰만 확인)
  if (req.method === 'PUT' && p.startsWith('object/upload/sign/')) {
    const [, , , bucket, ...rest] = p.split('/');
    const name = rest.join('/');
    const token = url.searchParams.get('token') || '';
    const expect = crypto.createHmac('sha256', SECRET).update(`upload:${bucket}/${name}`).digest('hex');
    if (token !== expect) return send(res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'bad token' });
    const raw = await readBody(req);
    let bytes = raw;
    const ct = String(req.headers['content-type'] || '');
    if (ct.startsWith('multipart/form-data')) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': ct }, body: raw }).formData();
      for (const [, v] of form) {
        if (typeof v !== 'string') bytes = Buffer.from(await v.arrayBuffer());
      }
    }
    if (bytes.length > 50 * 1024 * 1024) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'too large' });
    const fp = filePath(bucket, name);
    if (fs.existsSync(fp)) return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    await pool.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]).catch(() => {});
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, bytes);
    return send(res, 200, { Key: `${bucket}/${name}` });
  }
  // 서명 URL 로 받기
  if (req.method === 'GET' && p.startsWith('object/sign/')) {
    const [, , bucket, ...rest] = p.split('/');
    const name = rest.join('/');
    const token = url.searchParams.get('token') || '';
    const expect = crypto.createHmac('sha256', SECRET).update(`${bucket}/${name}`).digest('hex');
    if (token !== expect) return send(res, 400, { message: 'bad token' });
    try {
      return send(res, 200, fs.readFileSync(filePath(bucket, name)), { 'content-type': name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' });
    } catch {
      return send(res, 404, { message: 'not found' });
    }
  }
  if (req.method === 'POST' && p.startsWith('object/sign/')) {
    const bucket = p.split('/')[2];
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const out = [];
    for (const name of body.paths || []) {
      const ok = await storageAllowed(auth, 'select', bucket, name);
      if (!ok) {
        out.push({ path: name, signedURL: null, error: 'not found' });
        continue;
      }
      const token = crypto.createHmac('sha256', SECRET).update(`${bucket}/${name}`).digest('hex');
      out.push({ path: name, signedURL: `/object/sign/${bucket}/${name}?token=${token}`, error: null });
    }
    return send(res, 200, out);
  }
  if (req.method === 'POST' && p.startsWith('object/list/')) {
    const bucket = p.split('/')[2];
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const prefix = (body.prefix || '').replace(/\/$/, '');
    if (auth.role !== 'service_role' && !(auth.sub && prefix.startsWith(auth.sub))) return send(res, 200, []);
    const dir = filePath(bucket, prefix);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const offset = body.offset || 0;
    const limit = body.limit || 100;
    const out = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(offset, offset + limit)
      .map((e) => (e.isDirectory() ? { name: e.name, id: null, metadata: null } : { name: e.name, id: crypto.randomUUID(), metadata: { size: fs.statSync(path.join(dir, e.name)).size } }));
    return send(res, 200, out);
  }
  if (req.method === 'DELETE' && /^object\/[^/]+$/.test(p)) {
    const bucket = p.split('/')[1];
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const removed = [];
    for (const name of body.prefixes || []) {
      if (!(await storageAllowed(auth, 'delete', bucket, name)) && auth.role !== 'service_role') continue;
      if (auth.role === 'service_role') await pool.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name]).catch(() => {});
      try {
        fs.unlinkSync(filePath(bucket, name));
        removed.push({ name });
      } catch {
        /* 없음 */
      }
    }
    return send(res, 200, removed);
  }
  if ((req.method === 'POST' || req.method === 'PUT') && p.startsWith('object/')) {
    const [, bucket, ...rest] = p.split('/');
    const name = rest.join('/');
    const raw = await readBody(req);
    let bytes = raw;
    const ct = String(req.headers['content-type'] || '');
    if (ct.startsWith('multipart/form-data')) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': ct }, body: raw }).formData();
      for (const [, v] of form) {
        if (typeof v !== 'string') bytes = Buffer.from(await v.arrayBuffer());
      }
    }
    if (bytes.length > 50 * 1024 * 1024) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'too large' });
    const fp = filePath(bucket, name);
    if (fs.existsSync(fp) && req.headers['x-upsert'] !== 'true') return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    if (!(await storageAllowed(auth, 'insert', bucket, name))) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (auth.role === 'service_role') await pool.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]).catch(() => {});
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, bytes);
    return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
  }
  if (req.method === 'GET' && p.startsWith('object/')) {
    const parts = p.split('/');
    const start = parts[1] === 'authenticated' || parts[1] === 'public' ? 2 : 1;
    const bucket = parts[start];
    const name = parts.slice(start + 1).join('/');
    if (!(await storageAllowed(auth, 'select', bucket, name))) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    try {
      return send(res, 200, fs.readFileSync(filePath(bucket, name)), { 'content-type': 'application/octet-stream' });
    } catch {
      return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
  }
  return send(res, 404, { message: `storage ${req.method} ${p}` });
}

// ------------------------------------------------------------------ Auth
async function handleAuth(req, res, url, auth) {
  const p = url.pathname.replace(/^\/auth\/v1\//, '');
  if (p === 'user' && req.method === 'GET') {
    if (auth.role !== 'authenticated') return send(res, 401, { code: 401, error_code: 'no_authorization', msg: 'no user' });
    const r = await pool.query('select id, email from auth.users where id = $1', [auth.sub]);
    if (!r.rows.length) return send(res, 401, { code: 401, error_code: 'user_not_found', msg: 'User not found' });
    return send(res, 200, {
      id: r.rows[0].id,
      aud: 'authenticated',
      role: 'authenticated',
      email: r.rows[0].email,
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    });
  }
  if (p === 'logout') return send(res, 204, null);
  if (p.startsWith('admin/users/') && req.method === 'DELETE') {
    if (auth.role !== 'service_role') return send(res, 403, { msg: 'forbidden' });
    const id = p.split('/')[2];
    await pool.query('delete from auth.users where id = $1', [id]);
    return send(res, 200, {});
  }
  if (p === 'token') return send(res, 400, { error: 'invalid_grant', error_description: 'refresh not supported in fake' });
  return send(res, 404, { msg: `auth ${p}` });
}

// ------------------------------------------------------------------ Claude (가짜)
function fakeNote(text) {
  const title = /광합성/.test(text) ? '광합성' : '시험 자료';
  return {
    title,
    unit: '2. 식물과 에너지',
    summary: '식물은 빛 에너지로 $CO_2$와 물을 포도당과 산소로 바꾸는 광합성을 한다.',
    key_points: [
      { id: 'k1', title: '광합성의 재료', explanation: '광합성에는 물과 이산화탄소가 필요하다. 물은 뿌리, 이산화탄소는 기공으로 들어온다.', why: '재료와 결과물을 바꿔 묻는 문제가 자주 나온다.', importance: 'high', pages: [1] },
      { id: 'k2', title: '광합성 장소: 엽록체', explanation: '광합성은 잎의 엽록체에서 일어난다. 엽록체에는 엽록소가 있다.', why: '세포 소기관 이름을 헷갈리기 쉽다.', importance: 'high', pages: [2] },
      { id: 'k3', title: '광합성의 결과물', explanation: '광합성으로 포도당과 산소가 만들어진다. 포도당은 녹말로 바뀌어 저장된다.', why: '결과물을 고르는 문제가 나온다.', importance: 'medium', pages: [2, 3] },
      { id: 'k4', title: '빛의 세기와 광합성', explanation: '빛이 셀수록 광합성량이 늘다가 어느 정도 이상에서는 일정해진다.', why: '그래프 해석 문제로 나온다.', importance: 'low', pages: [4] },
    ],
    terms: [
      { term: '엽록체', meaning: '광합성이 일어나는 세포 소기관' },
      { term: '기공', meaning: '잎 표면의 작은 구멍. 기체가 드나든다' },
      { term: '엽록소', meaning: '빛을 흡수하는 초록색 색소' },
    ],
    formulas: [{ latex: '6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2', label: '광합성 식' }],
    pitfalls: [
      { text: '광합성은 미토콘드리아가 아니라 엽록체에서 일어난다.', key_point_id: 'k2' },
      { text: '산소는 재료가 아니라 결과물이다.', key_point_id: 'k1' },
    ],
    examples: [{ text: '검정말에 빛을 비추면 기포(산소)가 생긴다.', key_point_id: 'k3' }],
    checks: /내가 쓴|직접/.test(text) ? [{ text: '식물이 밤에도 광합성을 한다는 문장은 확인해 보세요.' }] : [],
    changes: /내가 쓴|직접/.test(text) ? [{ text: '문단 순서를 재료 → 장소 → 결과물로 바꿨어요.' }] : [],
  };
}

function fakeVisual(prompt) {
  const wantTable = /asked for a table/.test(prompt);
  const wantTimeline = /asked for a timeline/.test(prompt);
  return {
    recommended: 'mindmap',
    mindmap: {
      root_label: '광합성',
      nodes: [
        { id: 'n1', parent_id: '', label: '재료', icon: '💧', key_point_id: 'k1', pages: [1] },
        { id: 'n2', parent_id: '', label: '장소', icon: '🌿', key_point_id: 'k2', pages: [2] },
        { id: 'n3', parent_id: '', label: '결과물', icon: '🍬', key_point_id: 'k3', pages: [2] },
        { id: 'n4', parent_id: '', label: '빛의 세기', icon: '☀️', key_point_id: 'k4', pages: [4] },
        { id: 'n5', parent_id: 'n1', label: '물', icon: '', key_point_id: 'k1', pages: [1] },
        { id: 'n6', parent_id: 'n1', label: '이산화탄소', icon: '', key_point_id: 'k1', pages: [1] },
        { id: 'n7', parent_id: 'n2', label: '엽록체', icon: '', key_point_id: 'k2', pages: [2] },
        { id: 'n8', parent_id: 'n7', label: '엽록소', icon: '', key_point_id: 'k2', pages: [2] },
        { id: 'n9', parent_id: 'n3', label: '포도당', icon: '', key_point_id: 'k3', pages: [2] },
        { id: 'n10', parent_id: 'n3', label: '산소', icon: '', key_point_id: 'k3', pages: [2] },
        { id: 'n11', parent_id: 'n9', label: '녹말로 저장', icon: '', key_point_id: 'k3', pages: [3] },
        { id: 'n12', parent_id: 'n4', label: '셀수록 증가', icon: '', key_point_id: 'k4', pages: [4] },
      ],
    },
    table: wantTable
      ? { include: true, title: '광합성 정리표', columns: ['구분', '내용', '어디서'], rows: [['재료', '물, 이산화탄소', '뿌리, 기공'], ['결과물', '포도당, 산소', '엽록체']] }
      : { include: false, title: '', columns: [], rows: [] },
    timeline: wantTimeline
      ? { include: true, title: '광합성 순서', events: [{ date: '1단계', label: '빛 흡수', detail: '엽록소가 빛을 흡수' }, { date: '2단계', label: '물 분해', detail: '' }, { date: '3단계', label: '포도당 생성', detail: '' }] }
      : { include: false, title: '', events: [] },
  };
}

function fakeQuiz() {
  const base = { choices: [], answer_index: -1, answer_bool: false, answer_text: '', accepted: [], pages: [1] };
  return {
    questions: [
      { ...base, type: 'mcq', prompt: '광합성이 일어나는 세포 소기관은?', choices: ['미토콘드리아', '엽록체', '핵', '세포막'], answer_index: 1, explanation: '광합성은 엽록체에서 일어나요. 미토콘드리아는 세포 호흡 장소예요.', key_point_id: 'k2', difficulty: 'easy', pages: [2] },
      { ...base, type: 'ox', prompt: '산소는 광합성의 재료이다.', answer_bool: false, explanation: '산소는 광합성의 결과물이에요. 재료는 물과 이산화탄소예요.', key_point_id: 'k1', difficulty: 'easy' },
      { ...base, type: 'cloze', prompt: '광합성으로 만들어진 포도당은 ____ 으로 바뀌어 저장된다.', answer_text: '녹말', accepted: ['전분'], explanation: '포도당은 물에 잘 녹지 않는 녹말로 바뀌어 저장돼요.', key_point_id: 'k3', difficulty: 'medium', pages: [3] },
      { ...base, type: 'short', prompt: '잎 표면에서 기체가 드나드는 작은 구멍의 이름은?', answer_text: '기공', accepted: [], explanation: '이산화탄소는 기공으로 들어와요.', key_point_id: 'k1', difficulty: 'medium' },
      { ...base, type: 'mcq', prompt: '광합성의 결과물로 옳은 것만 고른 것은?', choices: ['물, 이산화탄소', '포도당, 산소', '산소, 이산화탄소', '물, 포도당'], answer_index: 1, explanation: '결과물은 포도당과 산소예요.', key_point_id: 'k3', difficulty: 'medium', pages: [2] },
      { ...base, type: 'ox', prompt: '빛의 세기가 셀수록 광합성량은 끝없이 늘어난다.', answer_bool: false, explanation: '어느 정도 이상에서는 일정해져요.', key_point_id: 'k4', difficulty: 'hard', pages: [4] },
    ],
  };
}

async function handleClaude(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  stats.messages++;
  const schema = body?.output_config?.format?.schema ?? {};
  const props = schema.properties ?? {};
  const content = body.messages?.[0]?.content ?? [];
  const textOf = typeof content === 'string' ? content : content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  let out;
  let task;
  if (props.key_points) {
    task = 'organize';
    out = fakeNote(textOf);
  } else if (props.mindmap) {
    task = 'visual';
    out = fakeVisual(textOf);
  } else if (props.verdicts) {
    task = 'check';
    const n = (textOf.match(/"index":/g) || []).length;
    out = { verdicts: Array.from({ length: n }, (_, i) => ({ index: i, keep: true, reason: 'ok' })) };
  } else if (props.questions) {
    task = /looks wrong/.test(textOf) ? 'fix' : 'quiz';
    out = task === 'fix' ? { questions: [fakeQuiz().questions[0]] } : fakeQuiz();
  } else if (props.result) {
    task = 'grade';
    const ans = (textOf.match(/<answer>\n([\s\S]*?)\n<\/answer>/) || [])[1] || '';
    out = /기공|stoma/i.test(ans) ? { result: 'correct', score: 1, feedback: '정확해요.', missing_points: [] } : /구멍/.test(ans) ? { result: 'partial', score: 0.6, feedback: '뜻은 맞아요. 용어 "기공"을 써 보세요.', missing_points: ['기공'] } : { result: 'wrong', score: 0, feedback: '기공이 정답이에요.', missing_points: ['기공'] };
  } else {
    task = 'other';
    out = { ok: true };
  }
  stats.tasks[task] = (stats.tasks[task] || 0) + 1;
  if (failTask && failTask === task) {
    return send(res, 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  }
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AI_DELAY || 300)));
  return send(res, 200, {
    id: `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(out) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 4200, output_tokens: 1300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

// ------------------------------------------------------------------ 서버
const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, null);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const auth = authOf(req);
  if (LOG) console.log('[fake]', req.method, url.pathname + url.search, auth.role);
  try {
    if (url.pathname === '/__stats') return send(res, 200, stats);
    if (url.pathname === '/__fail') {
      failTask = url.searchParams.get('task') || '';
      return send(res, 200, { failTask });
    }
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, auth);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url, auth);
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url, auth);
    if (url.pathname === '/v1/messages') return await handleClaude(req, res);
    return send(res, 404, { message: `no route ${url.pathname}` });
  } catch (e) {
    console.error('[fake] crash', req.method, url.pathname, e);
    return send(res, 500, { message: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => console.log(`[fake] listening on ${PORT}, db ${DB}`));
