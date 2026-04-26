// api/payment.js — NEXUS AI Payment System v3
// Supports: GET config, POST create transaction, PATCH confirm (admin)
// Stores transactions in /tmp/nexus_payments.json
// Sends beautiful HTML emails to admin

import { readFileSync, writeFileSync, existsSync } from 'fs';

const PAYMENTS_FILE = '/tmp/nexus_payments.json';

// ─── Daftar Paket Resmi (sama untuk GET dan POST) ──────────
const PACKAGES = [
  { id: 'small',   cr: 50,  idr: 38000,   usd: 2.38,  label: '50 CR — Starter' },
  { id: 'popular', cr: 80,  idr: 50000,   usd: 3.13,  label: '80 CR — Popular', popular: true },
  { id: 'pro',     cr: 150, idr: 120000,  usd: 7.50,  label: '150 CR — Pro' },
  { id: 'mega',    cr: 500, idr: 1500000, usd: 93.75, label: '500 CR — Mega' },
];

// ─── Helpers ───────────────────────────────────────────────
function loadPayments() {
  try {
    if (existsSync(PAYMENTS_FILE)) return JSON.parse(readFileSync(PAYMENTS_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function savePayments(payments) {
  try {
    writeFileSync(PAYMENTS_FILE, JSON.stringify(payments.slice(0, 500)));
  } catch (_) {}
}

function generateCode() {
  return 'NPAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ─── HTML Email Template untuk Payment ──────────────────────
function buildPaymentEmail(username, userId, pkg, method, amount, transactionId) {
  const avatarUrl = userId && userId !== '0'
    ? `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=60&height=60&format=png`
    : '';
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" style="width:60px;height:60px;border-radius:50%;border:2px solid #00e5ff;object-fit:cover;display:block;margin:0 auto 10px;" alt="${username}" />`
    : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#00e5ff,#8800ff);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:white;margin:0 auto 10px;">${username.charAt(0).toUpperCase()}</div>`;

  const paymentTotalFormatted = 'Rp ' + pkg.idr.toLocaleString('id-ID');
  const methodUpper = method.toUpperCase();
  const credits = pkg.cr;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030312;font-family:'Courier New',monospace;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0a0b22,#06071a);border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#00e5ff,#8800ff);"></div>
    <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;background:linear-gradient(135deg,#00e5ff,#8800ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#00e5ff;margin-bottom:4px;">NEXUS AI</div>
    <div style="font-size:10px;color:#3a4a7a;letter-spacing:3px;text-transform:uppercase;">💳 NEW PAYMENT</div>
  </div>

  <!-- User Card -->
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:20px;margin-bottom:16px;text-align:center;">
    ${avatarHtml}
    <div style="font-size:16px;font-weight:700;color:white;">@${username}</div>
    <div style="font-size:11px;color:#3a4a7a;">Roblox ID: ${userId || '-'}</div>
  </div>

  <!-- Payment Details -->
  <div style="background:#06071a;border:1px solid rgba(0,255,170,.2);border-radius:10px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;color:#00ffaa;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">💳 PAYMENT DETAILS</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;width:120px;">Package</td><td style="padding:7px 0;color:white;font-weight:700;font-size:12px;">${pkg.label}</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Credits</td><td style="padding:7px 0;color:#ffd600;font-weight:700;font-size:14px;">${credits} CR</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Method</td><td style="padding:7px 0;color:#00e5ff;font-weight:700;font-size:12px;">${methodUpper}</td></tr>
      <tr style="border-top:1px solid rgba(0,229,255,.12);">
        <td style="padding:12px 0 7px;color:white;font-size:12px;font-weight:700;">TOTAL PAID</td>
        <td style="padding:12px 0 7px;color:#00ffaa;font-size:18px;font-weight:700;">${paymentTotalFormatted}</td>
      </tr>
    </table>
    <div style="background:rgba(255,214,0,.05);border:1px solid rgba(255,214,0,.2);border-radius:6px;padding:10px;margin-top:10px;">
      <div style="font-size:10px;color:#ffd600;margin-bottom:4px;">⚠️ ACTION REQUIRED:</div>
      <div style="font-size:11px;color:#b8cfff;">Add <strong style="color:#ffd600;">${credits} CR</strong> to <strong style="color:white;">@${username}</strong> (ID: ${userId}) after verifying the transfer.</div>
    </div>
  </div>

  <!-- Transaction Info -->
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.08);border-radius:10px;padding:14px;margin-bottom:16px;">
    <div style="font-size:10px;color:#3a4a7a;">Transaction Code: <strong style="color:white;">${transactionId}</strong></div>
    <div style="font-size:10px;color:#3a4a7a;">Time: ${new Date().toISOString()}</div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;font-size:9px;color:#3a4a7a;padding-top:10px;">
    NEXUS AI · NEXUS STUDIO · Built by FIINYTID25<br>
    nexusai-roblox.vercel.app
  </div>
</div>
</body>
</html>`;
}

// ─── Main Handler ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ovo = process.env.OVO_NUMBER || '';
  const dana = process.env.DANA_NUMBER || '';
  const owner = process.env.PAYMENT_OWNER_NAME || 'NEXUS STUDIO';
  const adminToken = process.env.ADMIN_TOKEN || 'nexusadmin2024';

  // ═══════════════════════════════════════════════════════════
  // GET
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'GET') {
    if (req.query.id) {
      const payments = loadPayments();
      const tx = payments.find(p => p.id === req.query.id);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      return res.status(200).json({
        id: tx.id,
        status: tx.status,
        package: tx.package,
        credits: tx.credits,
        method: tx.method,
        total: tx.total,
        createdAt: tx.createdAt,
        confirmedAt: tx.confirmedAt || null,
      });
    }

    if (req.query.admin === '1') {
      const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
      if (token !== adminToken) return res.status(401).json({ error: 'Unauthorized' });
      const payments = loadPayments();
      return res.status(200).json({ payments, total: payments.length });
    }

    if (!ovo && !dana) {
      return res.status(503).json({
        error: 'Payment not configured',
        message: 'Admin must set OVO_NUMBER and DANA_NUMBER in Vercel environment variables.',
      });
    }

    function maskNumber(num) {
      if (!num || num.length < 8) return num;
      return num.substring(0, 4) + '****' + num.substring(num.length - 4);
    }

    return res.status(200).json({
      ovo: {
        available: !!ovo,
        number: ovo,
        masked: maskNumber(ovo),
        name: owner,
      },
      dana: {
        available: !!dana,
        number: dana,
        masked: maskNumber(dana),
        name: owner,
      },
      owner: owner,
      packages: PACKAGES,   // <--- pakai daftar yang sama
    });
  }

  // ═══════════════════════════════════════════════════════════
  // POST — create transaction
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const { username, userId, packId, method, amount, note } = req.body || {};

    if (!username || !packId || !method || !amount) {
      return res.status(400).json({ error: 'Missing required fields: username, packId, method, amount' });
    }

    // Cari paket di PACKAGES
    const pkg = PACKAGES.find(p => p.id === packId);
    if (!pkg) return res.status(400).json({ error: 'Invalid package ID' });

    const newTx = {
      id: generateCode(),
      username: username.toLowerCase().trim(),
      userId: userId || '0',
      package: pkg.id,
      credits: pkg.cr,
      method,
      total: pkg.idr,
      amountTransferred: parseInt(amount) || 0,
      note: note || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      confirmedAt: null,
    };

    const payments = loadPayments();
    payments.unshift(newTx);
    savePayments(payments);

    // Kirim email HTML ke admin
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const html = buildPaymentEmail(username, userId, pkg, method, amount, newTx.id);
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`
          },
          body: JSON.stringify({
            from: 'NEXUS AI <onboarding@resend.dev>',
            to: ['arifiinytid@gmail.com'],
            subject: `💳 NEW PAYMENT: ${username} — Rp ${pkg.idr.toLocaleString('id-ID')} (${pkg.id})`,
            html,
          }),
        });
      } catch (_) {}
    }

    return res.status(201).json({
      success: true,
      transaction: {
        id: newTx.id,
        code: newTx.id,
        status: 'pending',
        instructions: {
          method,
          number: method === 'ovo' ? ovo : dana,
          name: owner,
          amount: 'Rp ' + pkg.idr.toLocaleString('id-ID'),
          note: note || `NEXUS-${username}-${pkg.cr}CR`,
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PATCH — admin actions (confirm / reject)
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'PATCH') {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token !== adminToken) return res.status(401).json({ error: 'Unauthorized' });

    const { id, action } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });

    const payments = loadPayments();
    const tx = payments.find(p => p.id === id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction already processed' });

    if (action === 'confirm') {
      try {
        const syncUrl = `https://${req.headers.host || 'nexusai-roblox.vercel.app'}/api/sync`;
        const syncRes = await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'give-credits',
            target: tx.username,
            amount: tx.credits,
          }),
        });
        if (!syncRes.ok) throw new Error('Sync failed');
        tx.status = 'confirmed';
        tx.confirmedAt = new Date().toISOString();
        savePayments(payments);
        return res.status(200).json({ success: true, message: `Credited ${tx.credits} CR to @${tx.username}` });
      } catch (e) {
        return res.status(500).json({ error: 'Failed to grant credits: ' + e.message });
      }
    } else if (action === 'reject') {
      tx.status = 'rejected';
      tx.confirmedAt = new Date().toISOString();
      savePayments(payments);
      return res.status(200).json({ success: true, message: 'Transaction rejected' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
