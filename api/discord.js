// api/discord.js — NEXUS AI Notification Handler V8.2
// Notifikasi dari web ke Discord: payment, report, general, newuser
// Channel bisa di-set per tipe lewat /set-notif-channel (bot) atau KV langsung

let kv = null;
async function initKV() {
  if (kv) return kv;
  try {
    const m = await import('@vercel/kv');
    kv = m.kv || m.default || m;
  } catch(_) {}
  return kv;
}

async function getNotifChannel(type) {
  // Priority: KV config → env per-type → fallback DISCORD_NOTIF_CHANNEL
  const kvClient = await initKV();
  if (kvClient) {
    try {
      const config = await kvClient.get('nexusai:_ticket_config') || {};
      if (config[`notif_${type}`]) return config[`notif_${type}`];
      if (config['notif_general']) return config['notif_general'];
    } catch(_) {}
  }
  // Env var fallbacks
  const envMap = {
    payment: process.env.DISCORD_PAYMENT_CHANNEL,
    report:  process.env.DISCORD_REPORT_CHANNEL,
    general: process.env.DISCORD_GENERAL_CHANNEL,
    newuser: process.env.DISCORD_NEWUSER_CHANNEL,
  };
  return envMap[type] || process.env.DISCORD_NOTIF_CHANNEL || null;
}

async function sendDiscordMessage(channelId, content, embeds = []) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId) return false;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${token}`,
      },
      body: JSON.stringify({ content: content || '', embeds }),
    });
    return r.ok;
  } catch(e) {
    console.error('Discord send error:', e.message);
    return false;
  }
}

// ── Embed builders ─────────────────────────────────────────────
function reportEmbed(data) {
  return [{
    title: 'Bug Report Baru',
    color: 0x00e5ff,
    fields: [
      { name: 'User', value: `@${data.from || '?'} (ID: ${data.userId || '?'})`, inline: true },
      { name: 'Plan', value: data.plan || 'free', inline: true },
      { name: 'Credits', value: String(data.credits || 0), inline: true },
      { name: 'Pesan', value: String(data.message || '-').substring(0, 1000) },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI Report System V8.2' },
    ...(data.userId ? {
      thumbnail: { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${data.userId}&width=60&height=60&format=png` }
    } : {}),
  }];
}

function paymentEmbed(data) {
  return [{
    title: 'Pembayaran Baru!',
    color: 0x00ff88,
    description: '**Verifikasi transfer dan tambahkan credits ke akun user!**',
    fields: [
      { name: 'User', value: `@${data.from || '?'} (ID: ${data.userId || '?'})`, inline: true },
      { name: 'Paket', value: data.paymentPack || '-', inline: true },
      { name: 'Total', value: data.paymentTotal || '-', inline: true },
      { name: 'Metode', value: (data.paymentMethod || '-').toUpperCase(), inline: true },
      { name: 'Credits', value: String(data.paymentCR || 0) + ' CR', inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI Payment System V8.2' },
    ...(data.userId ? {
      thumbnail: { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${data.userId}&width=60&height=60&format=png` }
    } : {}),
  }];
}

function generalEmbed(data) {
  return [{
    title: data.title || 'Notifikasi NEXUS AI',
    description: String(data.message || '').substring(0, 2000),
    color: 0x00e5ff,
    fields: data.from ? [{ name: 'Dari', value: `@${data.from}`, inline: true }] : [],
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI V8.2 · nexusai-com.vercel.app' },
  }];
}

function newUserEmbed(data) {
  return [{
    title: 'User Baru Terdaftar!',
    color: 0x8800ff,
    fields: [
      { name: 'Username', value: `@${data.from || '?'}`, inline: true },
      { name: 'Roblox ID', value: String(data.userId || '-'), inline: true },
      { name: 'Plan', value: data.plan || 'free', inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI New User · nexusai-com.vercel.app' },
    ...(data.userId ? {
      thumbnail: { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${data.userId}&width=60&height=60&format=png` }
    } : {}),
  }];
}

// ── Main handler ───────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'NEXUS AI Discord API V8.2 Active',
      note: 'Slash commands handled by Gateway Bot (index.js)',
      endpoints: ['POST /_nexusNotify — send notification'],
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    // Discord webhook verification ping
    if (body.type === 1) return res.json({ type: 1 });

    // ── Notification from web/report.js ──
    if (body._nexusNotify) {
      const type = body.type || 'general';
      const channelId = await getNotifChannel(type);

      if (!channelId) {
        console.warn(`No channel for type: ${type}`);
        return res.status(200).json({ status: 'no_channel', type });
      }

      let embeds = [];
      let content = '';

      if (type === 'payment') {
        embeds = paymentEmbed(body);
        content = '**Pembayaran Masuk! Cek dan proses segera.**';
      } else if (type === 'report') {
        embeds = reportEmbed(body);
        content = '**Report Baru Masuk!**';
      } else if (type === 'newuser') {
        embeds = newUserEmbed(body);
        content = '**User Baru Bergabung!**';
      } else {
        // general
        embeds = generalEmbed(body);
        content = '';
      }

      const ok = await sendDiscordMessage(channelId, content, embeds);
      return res.status(200).json({ status: ok ? 'ok' : 'failed', type, channelId });
    }

    return res.status(400).json({ error: 'Unknown request' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
