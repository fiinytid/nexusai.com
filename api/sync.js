// api/sync.js — NEXUS AI User Data Sync v7
// Fix FINAL v7:
//   1. Error propagation: setUser melempar error, bukan return false
//   2. resetKVState() tidak hapus _kvError (simpan untuk diagnosis)
//   3. Validasi env vars KV_REST_API_URL + KV_REST_API_TOKEN saat init
//   4. Response POST mengembalikan data yang sudah di-trim (konsisten dengan KV)
//   5. Semua path error dikembalikan dengan pesan eksplisit ke client
//   6. listUsers: paralel dengan batas concurrency agar tidak flood KV
//   7. kvDel: tambah retry seperti kvGet/kvSet

'use strict';

// ─── KV CLIENT ───────────────────────────────────────────────────────────────
let _kv        = null;
let _kvReady   = false;
let _kvError   = null;  // TIDAK pernah di-reset ke null setelah error — tetap simpan diagnosis

function getKVSync() {
  if (_kvReady && _kv) return _kv;
  if (_kvError) return null;          // sudah pernah gagal init — jangan coba lagi

  try {
    // ── Validasi env vars lebih awal, sebelum require ──────────────────────
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Env vars KV_REST_API_URL dan/atau KV_REST_API_TOKEN belum di-set. ' +
        'Buka Vercel Dashboard → Project → Settings → Environment Variables → ' +
        'pastikan kedua var tersedia di environment Production/Preview/Development.'
      );
    }

    const mod    = require('@vercel/kv');
    const client = mod.kv || mod.default || mod;

    if (typeof client !== 'object' || client === null) {
      throw new Error('@vercel/kv: export bukan object');
    }
    if (typeof client.get !== 'function' || typeof client.set !== 'function') {
      throw new Error('@vercel/kv: method .get/.set tidak ditemukan');
    }

    _kv      = client;
    _kvReady = true;
    _kvError = null;
    return _kv;

  } catch (e) {
    _kv      = null;
    _kvReady = false;
    _kvError = e.message;   // simpan permanen sampai container restart
    console.error('[NEXUS sync] KV init gagal:', e.message);
    return null;
  }
}

// Hanya reset _kvReady/_kv agar boleh retry, tapi TETAP simpan _kvError untuk diagnosis.
// Dipanggil jika operasi KV timeout (mungkin transient).
function resetKVState() {
  const savedError = _kvError;   // simpan dulu
  _kv      = null;
  _kvReady = false;
  // Kalau error sebelumnya adalah masalah env (permanent), jangan izinkan retry:
  if (savedError && savedError.includes('Env vars')) {
    _kvError = savedError;       // tetap block
  } else {
    _kvError = null;             // transient error → izinkan retry berikutnya
  }
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const KV_PREFIX   = 'nexusai:';
const KV_TTL      = 60 * 60 * 24 * 365 * 2; // 2 tahun (detik)
const TIMEOUT_GET = 7000;
const TIMEOUT_SET = 10000;
const MAX_RETRY   = 3;
const CONCURRENCY = 10;          // batas paralel listUsers

// ─── UTILS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)
    )
  ]);
}

// Batasi operasi paralel agar tidak overflow KV rate limit
async function pLimit(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]().catch(e => ({ _err: e.message }));
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── KV OPERATIONS WITH RETRY ─────────────────────────────────────────────────
async function kvGet(username) {
  const client = getKVSync();
  if (!client) return null;

  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      const result = await withTimeout(
        client.get(KV_PREFIX + username),
        TIMEOUT_GET,
        'kvGet'
      );
      return result ?? null;
    } catch (e) {
      console.error(`[NEXUS sync] kvGet #${i} gagal:`, e.message);
      if (i === MAX_RETRY) { resetKVState(); return null; }
      await sleep(200 * i);
    }
  }
  return null;
}

// kvSet SELALU melempar error jika gagal setelah semua retry
async function kvSet(username, data) {
  const client = getKVSync();
  if (!client) {
    throw new Error(
      _kvError
        ? `KV tidak siap — ${_kvError}`
        : 'KV tidak tersedia. Cek env KV_REST_API_URL & KV_REST_API_TOKEN di Vercel Dashboard.'
    );
  }

  // Trim sebelum simpan
  let payload = trimUserData(data);

  // Potong lebih agresif jika masih terlalu besar
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const sizeKB    = sizeBytes / 1024;
  if (sizeKB > 4096) {
    console.warn(`[NEXUS sync] ${username}: ${sizeKB.toFixed(0)} KB — potong agresif`);
    payload.convs    = (payload.convs    || []).slice(-8);
    payload.allConvs = (payload.allConvs || []).slice(-8);
  }

  let lastErr;
  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      await withTimeout(
        client.set(KV_PREFIX + username, payload, { ex: KV_TTL }),
        TIMEOUT_SET,
        'kvSet'
      );
      return payload;   // kembalikan payload yang sudah di-trim
    } catch (e) {
      lastErr = e;
      console.error(`[NEXUS sync] kvSet #${i} gagal:`, e.message);
      if (i === MAX_RETRY) { resetKVState(); break; }
      await sleep(300 * i);
    }
  }
  throw lastErr;   // lempar ke caller — JANGAN telan error
}

async function kvDel(username) {
  const client = getKVSync();
  if (!client) {
    throw new Error(
      _kvError
        ? `KV tidak siap — ${_kvError}`
        : 'KV tidak tersedia. Cek env KV_REST_API_URL & KV_REST_API_TOKEN.'
    );
  }

  let lastErr;
  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      await withTimeout(client.del(KV_PREFIX + username), TIMEOUT_SET, 'kvDel');
      return true;
    } catch (e) {
      lastErr = e;
      console.error(`[NEXUS sync] kvDel #${i} gagal:`, e.message);
      if (i === MAX_RETRY) { resetKVState(); break; }
      await sleep(200 * i);
    }
  }
  throw lastErr;
}

async function kvKeys(pattern) {
  const client = getKVSync();
  if (!client) return [];
  try {
    return (await withTimeout(client.keys(pattern), TIMEOUT_GET, 'kvKeys')) || [];
  } catch (e) {
    console.error('[NEXUS sync] kvKeys gagal:', e.message);
    return [];
  }
}

// ─── DATA TRIMMING ────────────────────────────────────────────────────────────
function trimMsgs(msgs, maxMsgs, maxChars) {
  maxMsgs  = maxMsgs  || 60;
  maxChars = maxChars || 6000;
  if (!Array.isArray(msgs)) return [];
  return msgs.slice(-maxMsgs).map(function(m) {
    const msg = Object.assign({}, m);
    if (typeof msg.content === 'string' && msg.content.length > maxChars) {
      msg.content = msg.content.slice(0, maxChars) + '\n...[trimmed by server]';
    }
    if (Array.isArray(msg.attachments)) {
      msg.attachments = msg.attachments.map(function(a) {
        if (a.type === 'image') return { type: 'image', name: a.name, mime: a.mime };
        return { type: a.type, name: a.name };
      });
    }
    delete msg._rawContent;
    return msg;
  });
}

function trimUserData(data) {
  if (!data || typeof data !== 'object') return data;
  const d = Object.assign({}, data);

  if (Array.isArray(d.convs)) {
    d.convs = d.convs.slice(-50).map(function(cv) {
      return Object.assign({}, cv, { msgs: trimMsgs(cv.msgs) });
    });
  }
  if (Array.isArray(d.allConvs)) {
    d.allConvs = d.allConvs.slice(-50).map(function(cv) {
      return Object.assign({}, cv, { msgs: trimMsgs(cv.msgs) });
    });
  }
  if (Array.isArray(d.projects)) {
    d.projects = d.projects.slice(-100);
  }

  delete d.draftAttach;
  return d;
}

// ─── OWNER / ADMIN HELPERS ────────────────────────────────────────────────────
function parseIdList(envStr) {
  return (envStr || '')
    .split(',')
    .map(function(s) {
      const parts = s.trim().split(':');
      return { id: parts[0].trim(), name: parts[1] ? parts[1].trim() : null };
    })
    .filter(function(x) { return x.id; });
}

function getOwnerIds() {
  const fromEnv = parseIdList(process.env.OWNER_IDS);
  if (fromEnv.length === 0) return [{ id: '128649548', name: 'FIINYTID25' }];
  return fromEnv;
}

function getAdminIds() {
  return parseIdList(process.env.ADMIN_IDS);
}

function isOwnerById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  return getOwnerIds().some(function(o) { return String(o.id).trim() === uid; });
}

function isAdminById(userId) {
  if (isOwnerById(userId)) return true;
  const uid = String(userId || '').trim();
  if (!uid) return false;
  return getAdminIds().some(function(a) { return String(a.id).trim() === uid; });
}

function normalizeKey(key) {
  return (key || '').toLowerCase().trim();
}

function applyRoleOverrides(data) {
  if (!data || !data.robloxId) return data;
  if (isOwnerById(data.robloxId)) {
    data.credits = 999999;
    data.plan    = 'owner';
    data.roles   = ['owner', 'admin'];
  } else if (isAdminById(data.robloxId)) {
    data.credits = 999999;
    if (!Array.isArray(data.roles)) data.roles = [];
    if (!data.roles.includes('admin')) data.roles.push('admin');
  }
  return data;
}

// ─── CRUD WRAPPERS ────────────────────────────────────────────────────────────
async function getUser(username) {
  const key = normalizeKey(username);
  if (!key) return null;
  try { return await kvGet(key); }
  catch (e) { console.error('[NEXUS sync] getUser:', e.message); return null; }
}

// setUser SELALU melempar error jika gagal — caller bertanggung jawab menangani
async function setUser(username, data) {
  const key = normalizeKey(username);
  if (!key)  throw new Error('Username tidak valid');
  if (!data) throw new Error('Data tidak boleh kosong');
  // kvSet juga melempar jika gagal; kembalikan payload yang sudah di-trim
  return await kvSet(key, data);
}

async function listUsers() {
  const keys = await kvKeys(KV_PREFIX + '*');
  const cleanKeys = keys
    .map(k => k.replace(KV_PREFIX, ''))
    .filter(k => !k.startsWith('_'));

  const tasks = cleanKeys.map(k => async () => {
    const data = await kvGet(k);
    return { k, data };
  });

  const settled = await pLimit(tasks, CONCURRENCY);
  const result  = {};
  for (const item of settled) {
    if (item && !item._err && item.data) {
      result[item.k] = item.data;
    }
  }
  return result;
}

// ─── CORS ────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── ERROR RESPONSE HELPER ───────────────────────────────────────────────────
function kvErrResponse(res, e) {
  const msg = e && e.message ? e.message : String(e);
  console.error('[NEXUS sync] KV error response:', msg);
  return res.status(500).json({
    error: msg,
    code:  'KV_ERROR',
    hint:  _kvError
      ? `Init error: ${_kvError}`
      : 'Cek env KV_REST_API_URL & KV_REST_API_TOKEN di Vercel Dashboard → Storage → KV'
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = normalizeKey(req.query.user || '');

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Health check — tes KV dengan operasi nyata
    if (req.query.health === '1') {
      const client  = getKVSync();
      let canWrite  = false;
      let canRead   = false;
      let healthErr = null;

      if (client) {
        try {
          await withTimeout(
            client.set(KV_PREFIX + '__health__', { ok: true, ts: Date.now() }, { ex: 60 }),
            5000, 'healthWrite'
          );
          canWrite = true;
          const r  = await withTimeout(client.get(KV_PREFIX + '__health__'), 5000, 'healthRead');
          canRead  = !!r;
        } catch (e) {
          healthErr = e.message;
        }
      }

      return res.json({
        kv:        !!client,
        canWrite,
        canRead,
        initError: _kvError    || null,
        opsError:  healthErr   || null
      });
    }

    // List semua user
    if (req.query.list === '1') {
      try {
        return res.json(await listUsers());
      } catch (e) {
        return kvErrResponse(res, e);
      }
    }

    if (!userKey) return res.json(null);

    try {
      let data = await getUser(userKey);
      if (!data) return res.json(null);
      data = applyRoleOverrides(data);
      return res.json(data);
    } catch (e) {
      return kvErrResponse(res, e);
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body: ' + e.message });
    }

    const { user, data, action } = body;

    // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────
    if (action) {

      // ── Helper: load + update + save dengan error eksplisit ──────────────
      async function adminUpdate(target, updateFn) {
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const tKey = normalizeKey(target);
        const ex   = (await getUser(tKey)) || {};
        const next = updateFn(ex);
        next._updated = Date.now();
        try {
          await setUser(tKey, next);
          return null; // null = sukses, no error
        } catch (e) {
          return kvErrResponse(res, e);
        }
      }

      if (action === 'give-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'target dan amount (angka) wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.credits = parseFloat(((ex.credits || 0) + parseFloat(amount)).toFixed(4));
          return ex;
        });
        if (errRes) return errRes;
        const updated = await getUser(normalizeKey(target));
        return res.json({ success: true, newCredits: updated ? updated.credits : null, user: target });
      }

      if (action === 'set-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'target dan amount (angka) wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.credits = parseFloat(parseFloat(amount).toFixed(4));
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'set-plan') {
        const { target, plan } = body;
        if (!target || !plan) return res.status(400).json({ error: 'target dan plan wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.plan = plan;
          if (plan === 'pro') ex.credits = Math.max(ex.credits || 0, 200);
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'reset-credits') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const errRes = await adminUpdate(target, ex => { ex.credits = 30; return ex; });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'ban') {
        const { target, reason } = body;
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.banned    = true;
          ex.banReason = reason || 'No reason given';
          ex.bannedAt  = Date.now();
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'unban') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.banned     = false;
          ex.banReason  = null;
          ex.unbannedAt = Date.now();
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'add-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) return res.status(403).json({ error: 'Owner only' });
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.roles = ex.roles || [];
          if (!ex.roles.includes('admin')) ex.roles.push('admin');
          ex.credits = 999999;
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      if (action === 'remove-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) return res.status(403).json({ error: 'Owner only' });
        if (!target) return res.status(400).json({ error: 'target wajib diisi' });
        const errRes = await adminUpdate(target, ex => {
          ex.roles = (ex.roles || []).filter(r => r !== 'admin');
          return ex;
        });
        if (errRes) return errRes;
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    // ── NORMAL USER SYNC ──────────────────────────────────────────────────────
    if (!user) return res.status(400).json({ error: 'Missing user' });
    if (!data) return res.status(400).json({ error: 'Missing data' });

    const key = normalizeKey(user);
    if (!key) return res.status(400).json({ error: 'Invalid user' });

    try {
      const existing = await getUser(key);

      if (existing && existing.banned) {
        return res.status(403).json({
          error:  'Account banned',
          reason: existing.banReason || 'Violation of ToS'
        });
      }

      // Field yang BOLEH diupdate oleh client
      const SAFE_FIELDS = [
        'convs', 'allConvs', 'curConv', 'model', 'guiModel',
        'lastClaim', 'draftText', 'avatar', 'displayName',
        'settings', 'preferences', 'projects'
      ];

      const clientUpdate = {};
      SAFE_FIELDS.forEach(function(f) {
        if (data[f] !== undefined) clientUpdate[f] = data[f];
      });

      let merged;
      if (existing) {
        merged = Object.assign(
          {},
          existing,        // semua field dari KV (termasuk credits, plan, dll)
          clientUpdate,    // hanya safe fields dari client
          {
            // Field kontrol: SELALU pakai nilai dari KV, TIDAK bisa di-override client
            credits:     existing.credits,
            plan:        existing.plan      || 'free',
            roles:       existing.roles     || [],
            banned:      existing.banned    || false,
            banReason:   existing.banReason || null,
            robloxId:    existing.robloxId     || data.robloxId     || '',
            googleEmail: existing.googleEmail  || data.googleEmail  || '',
            _updated:    Date.now()
          }
        );
      } else {
        // User pertama kali
        merged = Object.assign(
          {},
          clientUpdate,
          {
            credits:     30,
            plan:        'free',
            roles:       [],
            banned:      false,
            banReason:   null,
            robloxId:    data.robloxId    || '',
            googleEmail: data.googleEmail || '',
            _created:    Date.now(),
            _updated:    Date.now()
          }
        );
      }

      merged = applyRoleOverrides(merged);

      // setUser melempar error jika gagal — tangkap dan kirim ke client
      let savedPayload;
      try {
        savedPayload = await setUser(key, merged);
      } catch (e) {
        return kvErrResponse(res, e);
      }

      // Kembalikan data yang benar-benar tersimpan (sudah di-trim oleh kvSet)
      // Terapkan role override pada payload yang sudah di-trim
      const responseData = applyRoleOverrides(Object.assign({}, savedPayload));
      return res.json({ success: true, data: responseData });

    } catch (e) {
      console.error('[NEXUS sync] POST error:', e.message);
      return res.status(500).json({ error: 'Internal error: ' + e.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!userKey) return res.status(400).json({ error: 'Missing user' });
    try {
      await kvDel(userKey);
      return res.json({ success: true });
    } catch (e) {
      return kvErrResponse(res, e);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
