// api/report.js — NEXUS AI Report System v4
// Handles bug reports & payment confirmations with beautiful HTML emails
// Admin can list, confirm, or reject reports via API

import { readFileSync, writeFileSync, existsSync } from 'fs';

const REPORT_FILE = '/tmp/nexus_reports.json';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'nexusadmin2024';

function loadReports() {
  try {
    if (existsSync(REPORT_FILE)) return JSON.parse(readFileSync(REPORT_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function saveReports(reports) {
  try { writeFileSync(REPORT_FILE, JSON.stringify(reports.slice(0, 500))); } catch (_) {}
}

// ─── HTML Email Template (English) ────────────────────
function buildEmail(report) {
  const isPayment = report.type === 'payment';
  const avatarUrl = report.avatar || (report.userId && report.userId !== '0'
    ? `https://www.roblox.com/headshot-thumbnail/image?userId=${report.userId}&width=60&height=60&format=png`
    : '');

  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" style="width:60px;height:60px;border-radius:50%;border:2px solid #00e5ff;object-fit:cover;display:block;margin:0 auto 10px;" alt="${report.from}" />`
    : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#00e5ff,#8800ff);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:white;margin:0 auto 10px;">${report.from.charAt(0).toUpperCase()}</div>`;

  const paymentSection = isPayment ? `
  <div style="background:#06071a;border:1px solid rgba(0,255,170,.2);border-radius:10px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;color:#00ffaa;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">💳 PAYMENT DETAILS</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;width:120px;">Package</td><td style="padding:7px 0;color:white;font-weight:700;font-size:12px;">${report.paymentPack || '-'}</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Credits</td><td style="padding:7px 0;color:#ffd600;font-weight:700;font-size:14px;">${report.paymentCR} CR</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Method</td><td style="padding:7px 0;color:#00e5ff;font-weight:700;font-size:12px;">${(report.paymentMethod || '').toUpperCase()}</td></tr>
      <tr style="border-top:1px solid rgba(0,229,255,.12);">
        <td style="padding:12px 0 7px;color:white;font-size:12px;font-weight:700;">TOTAL PAID</td>
        <td style="padding:12px 0 7px;color:#00ffaa;font-size:18px;font-weight:700;">${report.paymentTotal || '-'}</td>
      </tr>
    </table>
    <div style="background:rgba(255,214,0,.05);border:1px solid rgba(255,214,0,.2);border-radius:6px;padding:10px;margin-top:10px;">
      <div style="font-size:10px;color:#ffd600;margin-bottom:4px;">⚠️ ACTION REQUIRED:</div>
      <div style="font-size:11px;color:#b8cfff;">Add <strong style="color:#ffd600;">${report.paymentCR} CR</strong> to <strong style="color:white;">@${report.from}</strong> (ID: ${report.userId}) after verifying the transfer.</div>
    </div>
  </div>` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#030312;font-family:'Courier New',monospace;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px;">
  <div style="background:linear-gradient(135deg,#0a0b22,#06071a);border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#00e5ff,#8800ff);"></div>
    <div style="font-size:20px;font-weight:700;background:linear-gradient(135deg,#00e5ff,#8800ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NEXUS AI</div>
    <div style="font-size:10px;color:#3a4a7a;letter-spacing:3px;text-transform:uppercase;">${isPayment ? '💳 NEW PAYMENT' : '📩 NEW REPORT'}</div>
  </div>
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:20px;margin-bottom:16px;text-align:center;">
    ${avatarHtml}
    <div style="font-size:16px;font-weight:700;color:white;">@${report.from}</div>
    <div style="font-size:11px;color:#3a4a7a;">Roblox ID: ${report.userId || '-'}</div>
    <div style="margin-top:8px;">
      <span style="background:rgba(255,214,0,.12);color:#ffd600;border-radius:12px;padding:2px 10px;font-size:10px;font-weight:700;">${report.credits} CR</span>
      <span style="background:rgba(0,229,255,.08);color:#00e5ff;border-radius:12px;padding:2px 10px;font-size:10px;font-weight:700;">${(report.plan || 'free').toUpperCase()}</span>
    </div>
  </div>
  ${paymentSection}
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:11px;color:#00e5ff;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">💬 ${isPayment ? 'TRANSFER NOTE' : 'MESSAGE'}</div>
    <div style="font-size:12px;color:#b8cfff;line-height:1.7;">${String(report.message).replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
  </div>
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.08);border-radius:10px;padding:14px;margin-bottom:16px;">
    <div style="font-size:10px;color:#3a4a7a;">Report ID: ${report.id}</div>
    <div style="font-size:10px;color:#3a4a7a;">Time: ${report.time || 'Unknown'}</div>
  </div>
  <div style="text-align:center;font-size:9px;color:#3a4a7a;">NEXUS AI · NEXUS STUDIO</div>
</div>
</body>
</html>`;
}

// ─── MAIN HANDLER ──────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const isAdmin = token === ADMIN_TOKEN;

  // ═══════════════════════════════════════════════════════
  // GET (admin only)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    let reports = loadReports();
    if (req.query.type) reports = reports.filter(r => r.type === req.query.type);
    if (req.query.id) reports = reports.filter(r => r.id === req.query.id);
    return res.json({ reports, total: reports.length });
  }

  // ═══════════════════════════════════════════════════════
  // POST — new report
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.message || !body.from) return res.status(400).json({ error: 'from and message required' });

    const report = {
      id: Date.now().toString(36),
      from: String(body.from).substring(0, 50),
      userId: body.userId || '0',
      avatar: body.avatar || '',
      message: String(body.message).substring(0, 2000),
      plan: body.plan || 'free',
      credits: body.credits || 0,
      time: body.time || new Date().toISOString(),
      type: body.type || 'bug',
      paymentPack: body.paymentPack || null,
      paymentCR: body.paymentCR || null,
      paymentMethod: body.paymentMethod || null,
      paymentTotal: body.paymentTotal || null,
      transactionId: body.transactionId || null,
      status: body.type === 'payment' ? 'pending' : null,
      adminNote: null,
      savedAt: Date.now(),
    };

    const reports = loadReports();
    reports.unshift(report);
    saveReports(reports);

    // Kirim email
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const html = buildEmail(report);
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'NEXUS AI <onboarding@resend.dev>',
            to: ['arifiinytid@gmail.com'],
            subject: (report.type === 'payment' ? '💳 Payment' : '📩 Report') + ` from @${report.from}`,
            html,
          }),
        });
      } catch (_) {}
    }

    return res.status(200).json({ status: 'ok', id: report.id });
  }

  // ═══════════════════════════════════════════════════════
  // PATCH — admin actions (confirm/reject)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'PATCH') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { id, action, adminNote } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });

    const reports = loadReports();
    const report = reports.find(r => r.id === id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    if (action === 'confirm') {
      // Panggil sync untuk menambah kredit
      if (report.type === 'payment' && report.paymentCR) {
        const syncUrl = `https://${req.headers.host || 'nexusai-roblox.vercel.app'}/api/sync`;
        await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'confirm-payment',
            target: report.from,
            amount: report.paymentCR,
            transactionId: report.transactionId || report.id,
          }),
        });
      }
      report.status = 'confirmed';
      report.adminNote = adminNote || '';
      report.confirmedAt = new Date().toISOString();
      saveReports(reports);
      return res.json({ success: true, message: 'Confirmed and credits added.' });
    }

    if (action === 'reject') {
      report.status = 'rejected';
      report.adminNote = adminNote || '';
      report.confirmedAt = new Date().toISOString();
      saveReports(reports);
      return res.json({ success: true, message: 'Rejected.' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
