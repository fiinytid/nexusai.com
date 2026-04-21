// api/inbox.js — NEXUS AI Inbox System v1.0
import { readFileSync, writeFileSync, existsSync } from 'fs';
const INBOX_DIR = '/tmp';

function inboxFile(user) { return `${INBOX_DIR}/inbox_${user.toLowerCase().replace(/[^a-z0-9]/g,'_')}.json`; }

function getInbox(user) {
  try { if (existsSync(inboxFile(user))) return JSON.parse(readFileSync(inboxFile(user), 'utf8')); } catch(_) {}
  return [];
}
function saveInbox(user, msgs) {
  try { writeFileSync(inboxFile(user), JSON.stringify(msgs)); } catch(_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = (req.query.user || '').toLowerCase().trim();

  if (req.method === 'GET') {
    if (!user) return res.status(400).json({ error: 'user required' });
    const msgs = getInbox(user);
    const unread = msgs.filter(m => !m.read).length;
    return res.status(200).json({ messages: msgs, unread });
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    // Mark as read
    if (body.action === 'mark_read') {
      const msgs = getInbox(user);
      const updated = msgs.map(m => body.id === 'all' || m.id === body.id ? { ...m, read: true } : m);
      saveInbox(user, updated);
      return res.status(200).json({ ok: true });
    }

    // Delete message
    if (body.action === 'delete') {
      const msgs = getInbox(user);
      const updated = msgs.filter(m => m.id !== body.id);
      saveInbox(user, updated);
      return res.status(200).json({ ok: true });
    }

    // Send message (admin only - verified by ADMIN_TOKEN or owner ID)
    if (body.action === 'send') {
      const { to, subject, content, from_name, token, to_all } = body;
      const isAdmin = token === process.env.ADMIN_TOKEN || body.owner_id === process.env.OWNER_ID;
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      
      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        from: from_name || 'NEXUS AI',
        subject: subject || 'Message from NEXUS AI',
        content: content || '',
        timestamp: Date.now(),
        read: false,
        official: true,
      };

      if (to_all) {
        // Broadcast - handled separately (use /api/sync list)
        return res.status(200).json({ ok: true, broadcast: true, msg });
      }

      if (!to) return res.status(400).json({ error: 'to required' });
      const toUser = to.toLowerCase();
      const msgs = getInbox(toUser);
      msgs.unshift(msg);
      if (msgs.length > 50) msgs.splice(50);
      saveInbox(toUser, msgs);
      return res.status(200).json({ ok: true, id: msg.id });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
