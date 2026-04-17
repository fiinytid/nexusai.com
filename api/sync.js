// api/sync.js — NEXUS AI User Data Sync v3
// Persistent storage via Vercel KV (keyed by Roblox username)
// Owner/Admin by Roblox User ID (from OWNER_IDS / ADMIN_IDS env vars)

let kv = null;
let kvReady = false;

async function initKV() {
  if (kvReady) return kv;
  try {
    const kvModule = require('@vercel/kv');
    kv = kvModule.kv || kvModule.default || kvModule;
    kvReady = true;
  } catch (e) {
    kv = null;
    kvReady = false;
  }
  return kv;
}

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
    try {
      await kvClient.set('nexusai:' + key, data, { ex: 60 * 60 * 24 * 365 });
      return;
    } catch(e) {}
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

// Parse Owner/Admin IDs from env vars
// Format: "userId1:Name1,userId2:Name2,userId3:Name3"
// or just "userId1,userId2,userId3"
function parseIdList(envStr) {
  return (envStr || '').split(',').map(s => {
    const parts = s.trim().split(':');
    return { id: parts[0].trim(), name: parts[1] ? parts[1].trim() : null };
  }).filter(x => x.id);
}

function getOwnerIds() {
  const fromEnv = parseIdList(process.env.OWNER_IDS);
  // Default: FIINYTID25 user ID
  if (fromEnv.length === 0) return [{ id: '128649548', name: 'FIINYTID25' }];
  return fromEnv;
}

function getAdminIds() {
  return parseIdList(process.env.ADMIN_IDS);
}

function isOwnerById(userId) {
  const uid = String(userId).trim();
  return getOwnerIds().some(o => {
    const oid = String(o.id || o).trim();
    return oid === uid;
  });
}

function isAdminById(userId) {
  if (isOwnerById(userId)) return true;
  const uid = String(userId).trim();
  return getAdminIds().some(a => {
    const aid = String(a.id || a).trim();
    return aid === uid;
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = (req.query.user || '').toLowerCase().trim();

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (req.query.list === '1') {
      const all = await listUsers();
      return res.json(all);
    }
    if (!userKey) return res.json(null);
    const data = await getUser(userKey);
    // Auto-set unlimited credits for owner/admin (if userId known)
    if (data && data.robloxId && isOwnerById(data.robloxId)) {
      data.credits = 999999;
      data.plan = 'owner';
      data.roles = ['owner', 'admin'];
    } else if (data && data.robloxId && isAdminById(data.robloxId)) {
      if ((data.credits || 0) < 999999) data.credits = 999999;
      if (!data.roles) data.roles = ['admin'];
      if (!data.roles.includes('admin')) data.roles.push('admin');
    }
    return res.json(data);
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { user, data, action } = body || {};

      // ─── Admin actions ───────────────────────────────────────────────────
      if (action === 'give-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.json({ error: 'Invalid params' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.credits = parseFloat(((existing.credits || 0) + parseFloat(amount)).toFixed(4));
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true, newCredits: existing.credits, user: target });
      }

      if (action === 'set-plan') {
        const { target, plan } = body;
        if (!target || !plan) return res.json({ error: 'Invalid params' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.plan = plan;
        if (plan === 'pro' || plan === 'owner') {
          existing.credits = Math.max(existing.credits || 0, 200);
        }
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true });
      }

      if (action === 'reset-credits') {
        const { target } = body;
        if (!target) return res.json({ error: 'Invalid params' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.credits = 30;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true });
      }

      if (action === 'ban') {
        const { target, reason } = body;
        if (!target) return res.json({ error: 'Invalid params' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.banned = true;
        existing.banReason = reason || 'No reason given';
        existing.bannedAt = Date.now();
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true });
      }

      if (action === 'unban') {
        const { target } = body;
        if (!target) return res.json({ error: 'Invalid params' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.banned = false;
        existing.banReason = null;
        existing.unbannedAt = Date.now();
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true });
      }

      if (action === 'add-admin') {
        // Only owner can add admins via web console
        // (actual admin list is in env vars - this just sets a role flag in user data)
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) return res.json({ error: 'Owner only' });
        const existing = await getUser(target.toLowerCase()) || {};
        existing.roles = existing.roles || [];
        if (!existing.roles.includes('admin')) existing.roles.push('admin');
        existing.credits = 999999;
        existing._updated = Date.now();
        await setUser(target.toLowerCase(), existing);
        return res.json({ success: true });
      }

      // ─── Normal user data sync ───────────────────────────────────────────
      if (!user || !data) return res.json({ error: 'Missing user or data' });
      const key = user.toLowerCase();

      // Check if user is banned
      const existingData = await getUser(key);
      if (existingData && existingData.banned) {
        return res.status(403).json({ error: 'Account banned', reason: existingData.banReason || 'Violation of ToS' });
      }

      // Auto-set credits/roles for owner/admin based on userId
      let saveData = { ...data, _updated: Date.now() };
      if (data.robloxId && isOwnerById(data.robloxId)) {
        saveData.credits = 999999;
        saveData.plan = 'owner';
        saveData.roles = ['owner', 'admin'];
      } else if (data.robloxId && isAdminById(data.robloxId)) {
        saveData.credits = 999999;
        saveData.roles = saveData.roles || [];
        if (!saveData.roles.includes('admin')) saveData.roles.push('admin');
      }

      await setUser(key, saveData);
      return res.json({ success: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!userKey) return res.json({ error: 'Missing user' });
    try {
      const kvClient = await initKV();
      if (kvClient && kvReady) { await kvClient.del('nexusai:' + userKey); }
      else { delete memStore[userKey]; }
      return res.json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
