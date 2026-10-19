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
// timestamptz 는 PostgREST 처럼 마이크로초까지 ISO 글자로 ("2026-10-18T03:00:00.123456+00:00").
// JS Date 로 바꾸면 밀리초에서 잘려, 읽은 updated_at 그대로 고치는(eq) 검사가 실제와 다르게 동작한다
pg.types.setTypeParser(1184, (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(v);
  return m ? `${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}` : v;
});

const stats = { messages: 0, tasks: {}, maxDocBytes: 0, docs: 0 };
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
  // proposal->>status 처럼 JSON 칸 안을 거르는 것도 받는다
  const path = col.split(/(->>|->)/);
  let c = ident(path[0]);
  for (let i = 1; i < path.length; i += 2) c += `${path[i]}'${path[i + 1].replace(/'/g, "''")}'`;
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
        // 배열 인자(uuid[] 등)는 Postgres 배열로 (PostgREST 처럼), 그 밖의 객체는 JSON 글로
        if (v !== null && typeof v === 'object' && !(Array.isArray(v) && argtypes[i].endsWith('[]'))) v = JSON.stringify(v);
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
  // 관리자: 사용자 한 명 (로그인 회사 계정 번호는 raw_app_meta_data 의 provider·provider_id 로 흉내 낸다)
  if (p.startsWith('admin/users/') && req.method === 'GET') {
    if (auth.role !== 'service_role') return send(res, 403, { msg: 'forbidden' });
    const id = p.split('/')[2];
    const r = await pool.query('select id, email, raw_app_meta_data as meta from auth.users where id = $1', [id]);
    if (!r.rows.length) return send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
    const u = r.rows[0];
    const provider = u.meta?.provider ?? 'google';
    return send(res, 200, {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email ?? '',
      app_metadata: { provider, providers: [provider] },
      user_metadata: {},
      identities: [{ identity_id: crypto.randomUUID(), id: String(u.meta?.provider_id ?? u.id), user_id: u.id, provider, identity_data: {} }],
      created_at: new Date().toISOString(),
    });
  }
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
/** 자료 글에 '표시:이름' 이 있으면 정리 노트에 남긴다 (자료 더하기 시험에서 어느 자료가 합쳐졌는지 본다) */
const MARK = /표시:([^\s".,<]+)/g;

function fakeNote(text) {
  const title = /광합성/.test(text) ? '광합성' : '시험 자료';
  const marks = [...new Set([...text.matchAll(MARK)].map((m) => m[1]))];
  return {
    title,
    unit: '2. 식물과 에너지',
    summary: '식물은 빛 에너지로 $CO_2$와 물을 포도당과 산소로 바꾸는 광합성을 한다.' + marks.map((m) => ` 표시:${m}`).join(''),
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
        { id: 'n1', parent_id: '', label: '재료', icon: '💧', key_point_id: 'k1', pages: [1], hint: '물은 뿌리로, 이산화탄소는 기공으로' },
        { id: 'n2', parent_id: '', label: '장소', icon: '🌿', key_point_id: 'k2', pages: [2], hint: '초록색 엽록소가 있는 엽록체' },
        { id: 'n3', parent_id: '', label: '결과물', icon: '🍬', key_point_id: 'k3', pages: [2], hint: '산소는 재료가 아니라 결과물!' },
        { id: 'n4', parent_id: '', label: '빛의 세기', icon: '☀️', key_point_id: 'k4', pages: [4], hint: '세질수록 늘다가 어느 순간 일정' },
        { id: 'n5', parent_id: 'n1', label: '물', icon: '', key_point_id: 'k1', pages: [1], hint: '' },
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

/**
 * 노트에 자료를 더할 때: 받은 지금 노트(<note>)에 새 자료의 개념을 붙인다.
 * 새 자료(<new_parts>)에 '표시:이름' 이 있으면 '표시 이름' 개념을, 없으면 '광합성과 호흡' 개념을 붙인다
 */
function fakeMerged(textOf) {
  const section = (tag) => (textOf.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`)) || [])[1] || '';
  let base = null;
  try {
    base = JSON.parse(section('note'));
  } catch {
    base = null;
  }
  const n = base && Array.isArray(base.key_points) ? { ...fakeNote(textOf), ...base } : fakeNote(textOf);
  const kps = [...n.key_points];
  const nextId = () => `k${Math.max(0, ...kps.map((k) => Number(String(k.id).replace(/\D/g, '')) || 0)) + 1}`;
  const marks = [...new Set([...section('new_parts').matchAll(MARK)].map((m) => m[1]))];
  if (!marks.length) {
    if (!kps.some((k) => k.title === '광합성과 호흡')) {
      kps.push({ id: nextId(), title: '광합성과 호흡', explanation: '호흡은 포도당을 분해해 에너지를 얻는 과정으로, 밤낮없이 일어난다.', why: '광합성과 비교하는 문제가 나온다.', importance: 'high', pages: [] });
    }
    return { ...n, summary: '식물은 광합성으로 양분을 만들고, 호흡으로 그 양분에서 에너지를 꺼내 쓴다.', key_points: kps };
  }
  for (const m of marks) {
    if (!kps.some((k) => k.title === `표시 ${m}`)) kps.push({ id: nextId(), title: `표시 ${m}`, explanation: `${m} 자료에서 더한 내용이에요.`, why: '', importance: 'medium', pages: [] });
  }
  return { ...n, key_points: kps };
}

/** 더한 자료(k5)로만 만든 새 문제 */
function fakeNewQuiz() {
  const base = { choices: [], answer_index: -1, answer_bool: false, answer_text: '', accepted: [], pages: [] };
  return {
    questions: [
      { ...base, type: 'ox', prompt: '식물은 밤에도 호흡을 한다.', answer_bool: true, explanation: '호흡은 밤낮없이 일어나요.', key_point_id: 'k5', difficulty: 'easy' },
      { ...base, type: 'short', prompt: '포도당을 분해해 에너지를 얻는 과정은?', answer_text: '호흡', accepted: ['세포 호흡'], explanation: '호흡으로 에너지를 얻어요.', key_point_id: 'k5', difficulty: 'medium' },
    ],
  };
}

/** 노트 채팅: '문제' 를 말하면 문제를, '노트에' 를 말하면 노트에 넣자고 한다 */
const emptyQuestion = { type: 'short', prompt: '', choices: [], answer_index: -1, answer_bool: false, answer_text: '', accepted: [], explanation: '', key_point_id: '', difficulty: 'medium', pages: [] };
const it = (p) => ({ refs: [], x: 0, y: 0, w: 0, h: 0, r: 0, expr: '', from: 0, to: 0, label: '', style: 'given', marks: 0, ...p });
const noFigure = { include: false, view: { x_min: 0, x_max: 0, y_min: 0, y_max: 0 }, axes: false, grid: false, items: [] };

/** 채팅에서 푼 문제 (사진·'풀어' 가 있으면): 직각삼각형 빗변. Pro 스키마(그림 칸이 있음)면 그림도 */
function fakeChatSolution(solveProps, wantSolve) {
  const figures = !!solveProps?.properties?.figure;
  if (!wantSolve) return { include: false, problem: '', steps: [], ...(figures ? { figure: noFigure } : {}), question: emptyQuestion, subject: '', unit: '' };
  const steps = [
    { text: '직각을 낀 두 변이 $3$ cm, $4$ cm 이에요. 빗변은 직각의 맞은편 $\\overline{BC}$ 예요.', add: [], focus: ['AB', 'AC', 'right'] },
    { text: '피타고라스 정리: $\\overline{BC}^2 = 3^2 + 4^2 = 25$', add: [], focus: ['BC'] },
    { text: '그래서 $\\overline{BC} = 5$ cm 예요.', add: ['ans'], focus: ['BC', 'ans'] },
  ];
  return {
    include: true,
    problem: '직각삼각형 ABC 에서 ∠A = 90°, AB = 4 cm, AC = 3 cm 일 때 빗변 BC 의 길이를 구하시오.',
    steps: figures ? steps : steps.map(({ text }) => ({ text })),
    ...(figures
      ? {
          figure: {
            include: true,
            view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
            axes: false,
            grid: false,
            items: [
              it({ id: 'A', type: 'point', x: 0, y: 0, label: 'A' }),
              it({ id: 'B', type: 'point', x: 4, y: 0, label: 'B' }),
              it({ id: 'C', type: 'point', x: 0, y: 3, label: 'C' }),
              it({ id: 'AB', type: 'segment', refs: ['A', 'B'], label: '4 cm' }),
              it({ id: 'AC', type: 'segment', refs: ['A', 'C'], label: '3 cm' }),
              it({ id: 'right', type: 'angle', refs: ['B', 'A', 'C'], label: '90°' }),
              it({ id: 'BC', type: 'segment', refs: ['B', 'C'], label: '?', style: 'answer' }),
              it({ id: 'ans', type: 'text', x: 2.9, y: 2.2, label: '5 cm', style: 'answer' }),
            ],
          },
        }
      : {}),
    question: { ...emptyQuestion, type: 'short', prompt: '∠A = 90° 인 직각삼각형 ABC 에서 AB = 4 cm, AC = 3 cm 일 때 BC 의 길이는? (cm)', answer_text: '5', accepted: ['5cm', '5 cm'], explanation: '피타고라스 정리로 $3^2+4^2=25$ 이니 빗변은 5 cm 예요.', difficulty: 'easy' },
    subject: '수학',
    unit: '피타고라스 정리',
  };
}

function fakeChat(textOf, props = {}, images = 0) {
  const q = (textOf.match(/<question>\n([\s\S]*?)\n<\/question>/) || [])[1] || '';
  const allowQuestions = !/adding questions from chat is turned off/.test(textOf);
  const allowNote = !/adding to the note from chat is turned off/.test(textOf);
  const none = { kind: 'none', questions: [], note_addition: { key_point_id: '', title: '', text: '' } };
  const wantSolve = images > 0 || /풀어/.test(q);
  const solution = props.solution ? { solution: fakeChatSolution(props.solution, wantSolve) } : {};
  // 홈 AI 채팅 (노트 없음)
  if (!props.outside_note) {
    return wantSolve
      ? { reply: '빗변 BC 는 **5 cm** 예요. 아래 단계별 풀이를 보세요.', ...solution }
      : { reply: '광합성은 식물이 빛 에너지로 물과 이산화탄소에서 포도당과 산소를 만드는 과정이에요.', ...solution };
  }
  if (wantSolve) {
    return { reply: '빗변 BC 는 5 cm 예요. 단계별 풀이를 보세요.', outside_note: true, proposal: none, ...solution };
  }
  if (/문제/.test(q) && allowQuestions) {
    return {
      reply: '노트로 문제 2개를 만들었어요. 넣을지 골라 주세요.',
      outside_note: false,
      proposal: { ...none, kind: 'questions', questions: fakeQuiz().questions.slice(0, 2) },
      ...solution,
    };
  }
  if (/노트에/.test(q) && allowNote) {
    return {
      reply: '엽록체 설명에 이 내용을 더하면 좋겠어요.',
      outside_note: true,
      proposal: { ...none, kind: 'note', note_addition: { key_point_id: 'k2', title: '', text: '엽록체는 두 겹의 막으로 싸여 있어요.' } },
      ...solution,
    };
  }
  return {
    reply: `노트에 따르면 광합성은 **엽록체**에서 일어나요. ${/자세히|더/.test(q) ? '노트 밖 설명을 보태면, 엽록체 안의 틸라코이드에서 빛을 받아요.' : ''}`.trim(),
    outside_note: /자세히|더/.test(q),
    proposal: none,
    ...solution,
  };
}

/** 노트 문제 그림 풀이: 받은 문제 앞에서부터 max 개 (객관식은 과정 상자 그림, OX 는 그래프, 나머지는 글 단계) */
function fakeSolve(textOf) {
  const listed = JSON.parse((textOf.match(/<questions>\n([\s\S]*?)\n<\/questions>/) || [])[1] || '[]');
  const max = Number((textOf.match(/Pick at most (\d+) questions/) || [])[1] || 1);
  const solutions = listed.slice(0, max).map((q) => {
    if (q.type === 'mcq') {
      return {
        index: q.index,
        steps: [
          { text: '광합성의 재료는 물과 이산화탄소예요.', add: [], focus: ['in', 'a2'] },
          { text: '엽록체가 빛 에너지를 써서', add: [], focus: ['light', 'a1', 'chl'] },
          { text: '포도당과 산소를 만들어요. 그래서 답은 2번이에요.', add: ['out', 'a3'], focus: ['out'] },
        ],
        figure: {
          include: true,
          view: { x_min: -5, x_max: 5, y_min: -2, y_max: 4 },
          axes: false,
          grid: false,
          items: [
            it({ id: 'light', type: 'box', x: 0, y: 3, label: '빛 에너지' }),
            it({ id: 'in', type: 'box', x: -3.4, y: 0, label: '물 + 이산화탄소' }),
            it({ id: 'chl', type: 'box', x: 0, y: 0, label: '엽록체' }),
            it({ id: 'out', type: 'box', x: 3.4, y: 0, label: '포도당 + 산소', style: 'answer' }),
            it({ id: 'a1', type: 'arrow', refs: ['light', 'chl'] }),
            it({ id: 'a2', type: 'arrow', refs: ['in', 'chl'], label: '재료' }),
            it({ id: 'a3', type: 'arrow', refs: ['chl', 'out'], label: '결과물' }),
          ],
        },
      };
    }
    if (q.type === 'ox') {
      return {
        index: q.index,
        steps: [
          { text: '빛이 약할 때는 빛이 셀수록 광합성량이 늘어요.', add: [], focus: ['g'] },
          { text: '어느 세기를 넘으면 더 늘지 않고 일정해져요 (광포화점).', add: ['sat', 'P'], focus: ['sat', 'P'] },
          { text: '그래서 "끝없이 늘어난다"는 틀렸어요 (X).', add: [], focus: ['sat'] },
        ],
        figure: {
          include: true,
          view: { x_min: -0.5, x_max: 10, y_min: -0.5, y_max: 5 },
          axes: true,
          grid: false,
          items: [
            it({ id: 'g', type: 'function', expr: '4(1 - e^(-x/2))', from: 0, to: 10, label: '광합성량' }),
            it({ id: 'P', type: 'point', x: 6, y: 3.8, label: '광포화점', style: 'answer' }),
            it({ id: 'S1', type: 'point', x: 0, y: 4, style: 'muted' }),
            it({ id: 'S2', type: 'point', x: 10, y: 4, style: 'muted' }),
            it({ id: 'sat', type: 'line', refs: ['S1', 'S2'], style: 'aux' }),
          ],
        },
      };
    }
    return { index: q.index, steps: [{ text: '노트의 정의를 떠올려요.', add: [], focus: [] }, { text: `답은 ${q.answer} 예요.`, add: [], focus: [] }], figure: noFigure };
  });
  return { solutions };
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

// ------------------------------------------------------------------ 테마 (가짜 AI·가짜 Cloudflare)
/** 96×96 그라데이션 JPEG (가짜 AI 그림) */
const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABgAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDVApcUuKdivSbPOixuKdilxSgVk2axYmKUClApcVk2bRYgFLinAUuKybNosTFLilxSgVk2bRYgFLilApwFYtm0WVAKUClApcV67Z89FiYpcUoFOArJs2ixAKXFLilxWTZtFiYpcUuKdismzaLG4p2KUClArJs2ixMUuKXFLismzaLKmKdilApQK9ds+eixAKUClxSgVk2bRYmKXFOApcVk2bRYgFKBSgUuKxbNYsQClxSgU7FZNm0WNxTsUuKXFZNm0WVAKXFKBTgK9ds+eixAKUClApcVk2bRYmKXFLinYrJs2ixuKdilApQKybNosQClApcUuKybNosTFKBTgKXFZNm0WVAKUClApQK9Zs+eixAKXFOxS4rJs2ixMUoFLilArJs2ixAKXFKBTgKybNosbinAUoFKBWTZtFiYpcUuKUCsmzWLKmKdilApcV67Z8/FiYpcUuKUCsmzaLEAp2KXFKBWTZtFiAUoFLilxWLZrFiYpcU7FKBWTZtFiYpQKXFLismzaLP/2Q==';
let cfMode = 'ok';

function fakeTheme(text) {
  const req = (text.match(/<request>\n([\s\S]*?)\n<\/request>/) || [])[1] || '테마';
  const wantPattern = /pattern_svg: a soft, repeating/.test(text);
  return {
    name: `${req.slice(0, 8)} 테마`,
    summary: '차분하고 따뜻한 분위기예요.',
    light: { bg: '#f4f1ea', surface: '#ffffff', accent: '#3a7d5c' },
    // 어두운 모드에 너무 밝은 바탕을 보내도 서버가 어둡게 맞추는지 본다
    dark: { bg: '#eeeeee', surface: '#151a17', accent: '#7fd1a8' },
    font: 'round',
    paper: 'dots',
    image_prompt: 'soft watercolor rain on a quiet cafe window, calm, no people, no text',
    // 무늬: 스크립트·이벤트·링크를 섞어 보내도 서버가 깨끗하게 거르는지 본다
    pattern_svg: wantPattern
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" onload="alert(1)"><script>alert(2)</script><circle cx="60" cy="60" r="8" fill="#3a7d5c" opacity="0.3"/><a href="https://evil.example"><rect x="1" y="1" width="9" height="9"/></a><circle cx="180" cy="180" r="6" fill="#7fd1a8" opacity="0.3"/></svg>'
      : '',
  };
}

async function handleCloudflare(req, res, url) {
  stats.cf = (stats.cf || 0) + 1;
  if (req.headers.authorization !== 'Bearer fake-cf-token') return send(res, 401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
  if (!/\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/.test(url.pathname)) return send(res, 404, { success: false, errors: [{ code: 7003, message: 'No route' }] });
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  stats.cfPrompts = [...(stats.cfPrompts || []), String(body.prompt || '').slice(0, 80)].slice(-5);
  // 실제 Cloudflare 와 같은 번호: 3036 = 오늘 무료 몫을 다 씀, 3040 = 잠깐 바쁨
  if (cfMode === 'quota') return send(res, 429, { success: false, errors: [{ code: 3036, message: 'Account limited: you have used up your daily free allocation of 10,000 neurons' }] });
  if (cfMode === 'busy') return send(res, 429, { success: false, errors: [{ code: 3040, message: 'Capacity temporarily exceeded, please try again.' }] });
  if (cfMode === 'fail') return send(res, 500, { success: false, errors: [{ code: 7000, message: 'internal error' }] });
  await new Promise((r) => setTimeout(r, 200));
  return send(res, 200, { success: true, errors: [], messages: [], result: { image: TINY_JPEG } });
}

async function handleClaude(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  stats.messages++;
  const schema = body?.output_config?.format?.schema ?? {};
  const props = schema.properties ?? {};
  const content = body.messages?.[0]?.content ?? [];
  const textOf = typeof content === 'string' ? content : content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  // 실제 Claude 는 요청 하나가 32MB 를 넘으면 받지 않는다: 보낸 PDF 조각의 크기를 기록해 시험에서 확인한다
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c?.type === 'document' && c.source?.type === 'base64') {
        stats.docs++;
        stats.maxDocBytes = Math.max(stats.maxDocBytes, Math.floor((c.source.data.length * 3) / 4));
      }
    }
  }
  let out;
  let task;
  const images = Array.isArray(content) ? content.filter((c) => c?.type === 'image').length : 0;
  if (Array.isArray(content)) stats.images = (stats.images || 0) + images;
  if (props.reply) {
    task = props.outside_note ? 'chat' : 'ask';
    out = fakeChat(textOf, props, images);
  } else if (props.solutions) {
    task = 'solve';
    out = fakeSolve(textOf);
  } else if (props.key_points && /Merge the new material into the current note/.test(textOf)) {
    task = 'merge';
    out = fakeMerged(textOf);
  } else if (props.key_points) {
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
    out = task === 'fix' ? { questions: [fakeQuiz().questions[0]] } : /comes from the new material/.test(textOf) ? fakeNewQuiz() : fakeQuiz();
  } else if (props.result) {
    task = 'grade';
    const ans = (textOf.match(/<answer>\n([\s\S]*?)\n<\/answer>/) || [])[1] || '';
    out = /기공|stoma/i.test(ans) ? { result: 'correct', score: 1, feedback: '정확해요.', missing_points: [] } : /구멍/.test(ans) ? { result: 'partial', score: 0.6, feedback: '뜻은 맞아요. 용어 "기공"을 써 보세요.', missing_points: ['기공'] } : { result: 'wrong', score: 0, feedback: '기공이 정답이에요.', missing_points: ['기공'] };
  } else if (props.pattern_svg) {
    task = 'theme';
    out = fakeTheme(textOf);
  } else if (props.image_prompt) {
    task = 'theme_image';
    out = { image_prompt: 'calm pastel hills at sunrise, soft gradient, no people, no text' };
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
    if (url.pathname === '/__cf') {
      cfMode = url.searchParams.get('mode') || 'ok';
      return send(res, 200, { cfMode });
    }
    if (url.pathname.startsWith('/cf/')) return await handleCloudflare(req, res, url);
    return send(res, 404, { message: `no route ${url.pathname}` });
  } catch (e) {
    console.error('[fake] crash', req.method, url.pathname, e);
    return send(res, 500, { message: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => console.log(`[fake] listening on ${PORT}, db ${DB}`));
