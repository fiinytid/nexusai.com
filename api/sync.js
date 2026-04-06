// api/sync.js — Persistent user data sync via Vercel KV
// Setup: vercel env add KV_REST_API_URL and KV_REST_API_TOKEN
// Or use the Vercel KV dashboard to link a KV store

let kv = null;
let kvReady = false;

async function initKV() {
  if (kvReady) return kv;
  try {
    const kvModule = require('@vercel/kv');
    kv = kvModule.kv || kvModule.default || kvModule;
    kvReady = true;
  } catch (e) {
    // Fallback: in-memory (not persistent across cold starts)
    kv = null;
    kvReady = false;
  }
  return kv;
}

// In-memory fallback
const memStore = {};

async function getUser(key) {
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try { return await kvClient.get('nexusai:' + key); } catch(e) {}
  }
  return memStore[key] || null;
}

async function setUser(key, data) {
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try { await kvClient.set('nexusai:' + key, data, { ex: 60 * 60 * 24 * 365 }); return; } catch(e) {}
  }
  memStore[key] = data;
}

async function listUsers() {
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try {
      const keys = await kvClient.keys('nexusai:*');
      const result = {};
      for (const k of keys) {
        result[k.replace('nexusai:', '')] = await kvClient.get(k);
      }
      return result;
    } catch(e) {}
  }
  return memStore;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = (req.query.user || '').toLowerCase().trim();

  if (req.method === 'GET') {
    if (req.query.list === '1') {
      // Admin list all users
      const all = await listUsers();
      res.json(all);
      return;
    }
    if (!userKey) { res.json(null); return; }
    const data = await getUser(userKey);
    res.json(data);
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { user, data, action } = body || {};

      // Admin actions
      if (action === 'give-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) { res.json({ error: 'Invalid params' }); return; }
        const existing = await getUser(target.toLowerCase()) || {};
        existing.credits = parseFloat(((existing.credits || 0) + parseFloat(amount)).toFixed(4));
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        res.json({ success: true, newCredits: existing.credits });
        return;
      }

      if (action === 'set-plan') {
        const { target, plan } = body;
        if (!target || !plan) { res.json({ error: 'Invalid params' }); return; }
        const existing = await getUser(target.toLowerCase()) || {};
        existing.plan = plan;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        res.json({ success: true });
        return;
      }

      if (action === 'reset-credits') {
        const { target } = body;
        if (!target) { res.json({ error: 'Invalid params' }); return; }
        const existing = await getUser(target.toLowerCase()) || {};
        existing.credits = 30;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        res.json({ success: true });
        return;
      }

      if (action === 'ban') {
        const { target } = body;
        if (!target) { res.json({ error: 'Invalid params' }); return; }
        const existing = await getUser(target.toLowerCase()) || {};
        existing.banned = true;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        res.json({ success: true });
        return;
      }

      if (action === 'unban') {
        const { target } = body;
        const existing = await getUser(target.toLowerCase()) || {};
        existing.banned = false;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        res.json({ success: true });
        return;
      }

      // Normal user sync
      if (!user || !data) { res.json({ error: 'Missing user or data' }); return; }
      const key = user.toLowerCase();
      await setUser(key, { ...data, _updated: Date.now() });
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'DELETE') {
    if (!userKey) { res.json({ error: 'Missing user' }); return; }
    try {
      const kvClient = await initKV();
      if (kvClient && kvReady) { await kvClient.del('nexusai:' + userKey); }
      else { delete memStore[userKey]; }
      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
