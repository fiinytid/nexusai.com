// api/redeem.js — NEXUS AI Redeem Code Handler
// Codes bisa diset via REDEEM_CODES env var atau hardcoded di sini
// Format env: CODE1:credits:plan:oneTime,CODE2:credits:plan:oneTime

import { readFileSync, writeFileSync, existsSync } from 'fs';

const USED_FILE = '/tmp/nexus_redeemed.json';

// Hardcoded codes — tambah/edit sesuai kebutuhan
const BUILTIN_CODES = {
  'NEXUS2026':    { credits: 50,  plan: null,  oneTime: true,  maxUses: 1,    desc: 'Welcome bonus 2026' },
  'DISCORD100':   { credits: 100, plan: null,  oneTime: false, maxUses: 9999, desc: 'Discord member bonus' },
  'NEXUSPRO':     { credits: 200, plan: 'pro', oneTime: true,  maxUses: 1,    desc: 'Pro plan upgrade' },
  'QWIEWIEUWI':   { credits: 150, plan: null,  oneTime: false, maxUses: 9999, desc: 'Special code' },
  'NEXUSVIP':     { credits: 500, plan: 'pro', oneTime: true,  maxUses: 1,    desc: 'VIP upgrade' },
  'FREECREDITS':  { credits: 30,  plan: null,  oneTime: false, maxUses: 9999, desc: 'Free credits' },
};

function getAllCodes() {
  const codes = { ...BUILTIN_CODES };
  // Load from env var: "CODE1:credits:plan:maxUses,CODE2:credits:plan:maxUses"
  const envStr = process.env.REDEEM_CODES || '';
  if (envStr) {
    envStr.split(',').forEach(entry => {
      const parts = entry.trim().split(':');
      if (parts.length >= 2) {
        const code  = parts[0].trim().toUpperCase();
        const creds = parseFloat(parts[1]) || 0;
        const plan  = parts[2] && parts[2] !== 'null' ? parts[2].trim() : null;
        const maxU  = parseInt(parts[3]) || 9999;
        if (code) codes[code] = { credits: creds, plan, oneTime: maxU === 1, maxUses: maxU, desc: 'Custom code' };
      }
    });
  }
  return codes;
}

function getUsed() {
  try {
    if (existsSync(USED_FILE)) return JSON.parse(readFileSync(USED_FILE, 'utf8'));
  } catch(_) {}
  return {};
}

function saveUsed(used) {
  try { writeFileSync(USED_FILE, JSON.stringify(used)); } catch(_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: list codes (admin only)
  if (req.method === 'GET') {
    const token = req.query.token;
    if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    const codes = getAllCodes();
    const used  = getUsed();
    const list  = Object.entries(codes).map(([code, data]) => ({
      code, ...data,
      usedBy: used[code] ? Object.keys(used[code]).length : 0,
    }));
    return res.status(200).json({ codes: list });
  }

  // POST: redeem a code
  if (req.method === 'POST') {
    const body = req.body || {};
    const code = (body.code || '').trim().toUpperCase();
    const user = (body.user || '').trim().toLowerCase();

    if (!code) return res.status(400).json({ error: 'Kode tidak boleh kosong' });
    if (!user) return res.status(400).json({ error: 'User tidak boleh kosong' });

    const codes = getAllCodes();
    const codeData = codes[code];

    if (!codeData) {
      return res.status(404).json({ error: 'Kode tidak valid atau tidak ditemukan' });
    }

    const used = getUsed();
    const codeUsed = used[code] || {};
    const totalUses = Object.keys(codeUsed).length;

    // Check max uses
    if (totalUses >= codeData.maxUses) {
      return res.status(400).json({ error: 'Kode sudah habis digunakan' });
    }

    // Check if user already used this code
    if (codeUsed[user]) {
      return res.status(400).json({ error: 'Kamu sudah pernah menggunakan kode ini' });
    }

    // Mark as used
    if (!used[code]) used[code] = {};
    used[code][user] = Date.now();
    saveUsed(used);

    return res.status(200).json({
      success: true,
      credits: codeData.credits,
      plan:    codeData.plan,
      desc:    codeData.desc,
      message: `Berhasil! +${codeData.credits} CR${codeData.plan ? ` + upgrade ke ${codeData.plan}` : ''} telah ditambahkan!`,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
