// api/admin.js — NEXUS AI Admin Management v1
// Owner and Admin identification by Roblox User ID (NOT username)
// Set OWNER_IDS and ADMIN_IDS in Vercel env vars as comma-separated Roblox user IDs

import { readFileSync, writeFileSync, existsSync } from 'fs';

const ADMIN_FILE = '/tmp/nexus_admins.json';

// Parse comma-separated IDs from env
function parseIds(envStr) {
  return (envStr || '').split(',').map(s => s.trim()).filter(Boolean);
}

function getOwnerIds() {
  // From env var OWNER_IDS (comma-separated Roblox user IDs)
  const fromEnv = parseIds(process.env.OWNER_IDS);
  return fromEnv.length ? fromEnv : ['9979111444']; // fallback: FIINYTID25's user ID
}

function getAdminIds() {
  // From env var ADMIN_IDS + dynamic admin file
  const fromEnv = parseIds(process.env.ADMIN_IDS);
  let fromFile = [];
  try {
    if (existsSync(ADMIN_FILE)) {
      fromFile = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));
    }
  } catch(_) {}
  return [...new Set([...fromEnv, ...fromFile])];
}

function isOwner(userId) {
  const id = String(userId);
  return getOwnerIds().includes(id);
}

function isAdmin(userId) {
  const id = String(userId);
  return isOwner(id) || getAdminIds().includes(id);
}

function addAdmin(userId) {
  const id = String(userId);
  let admins = [];
  try {
    if (existsSync(ADMIN_FILE)) admins = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));
  } catch(_) {}
  if (!admins.includes(id)) {
    admins.push(id);
    writeFileSync(ADMIN_FILE, JSON.stringify(admins));
  }
}

function removeAdmin(userId) {
  const id = String(userId);
  let admins = [];
  try {
    if (existsSync(ADMIN_FILE)) admins = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));
  } catch(_) {}
  admins = admins.filter(a => a !== id);
  writeFileSync(ADMIN_FILE, JSON.stringify(admins));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Check if a userId is owner/admin
  if (req.method === 'GET') {
    const userId = req.query.userId || req.query.user_id || '';

    if (req.query.list) {
      // Admin-only: list all admins (requires owner token)
      const token = req.query.token;
      if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return res.status(200).json({
        owners: getOwnerIds(),
        admins: getAdminIds(),
      });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const ownerStatus = isOwner(userId);
    const adminStatus = isAdmin(userId);
    return res.status(200).json({
      userId:  String(userId),
      isOwner: ownerStatus,
      isAdmin: adminStatus,
      // Owner has unlimited credits, admin has 500 credits/day allowance
      creditLimit: ownerStatus ? Infinity : (adminStatus ? 500 : null),
      roles: ownerStatus ? ['owner', 'admin'] : (adminStatus ? ['admin'] : []),
    });
  }

  // POST: Add/remove admin (requires owner authentication)
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action, targetUserId, requesterUserId, token } = body;

    // Authenticate: must be owner OR provide admin token
    const isRequesterOwner = isOwner(requesterUserId);
    const hasToken = token === process.env.ADMIN_TOKEN;

    if (!isRequesterOwner && !hasToken) {
      return res.status(403).json({ error: 'Forbidden: Owner access or admin token required' });
    }

    if (action === 'add_admin') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      addAdmin(targetUserId);
      return res.status(200).json({ status: 'ok', action: 'added', userId: targetUserId });
    }

    if (action === 'remove_admin') {
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      removeAdmin(targetUserId);
      return res.status(200).json({ status: 'ok', action: 'removed', userId: targetUserId });
    }

    if (action === 'set_credits') {
      // Owner can set unlimited credits for a user via sync API
      // This just validates the request
      if (!isRequesterOwner) return res.status(403).json({ error: 'Owner only' });
      return res.status(200).json({ status: 'ok', message: 'Use /api/sync to set credits directly' });
    }

    return res.status(400).json({ error: 'Unknown action. Use: add_admin, remove_admin, set_credits' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
