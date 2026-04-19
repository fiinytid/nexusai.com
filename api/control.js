// api/control.js — NEXUS AI RELAY v8 (Queue System)
// FIXED: better error handling, batch_commands support, output safety
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TMP = '/tmp';

function san(user) {
  return (user || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}
function queueFile(u)  { return `${TMP}/nq_${san(u)}.json`; }
function pollFile(u)   { return `${TMP}/np_${san(u)}.txt`; }
function outFile(u)    { return `${TMP}/no_${san(u)}.json`; }
function wsFile(u)     { return `${TMP}/nw_${san(u)}.json`; }
const LOG_FILE  = `${TMP}/nexus_log.json`;
const HIST_FILE = `${TMP}/nexus_hist.json`;

function getQueue(u) {
  try {
    if (existsSync(queueFile(u))) return JSON.parse(readFileSync(queueFile(u), 'utf8'));
  } catch(_) {}
  return [];
}
function saveQueue(u, arr) {
  try { writeFileSync(queueFile(u), JSON.stringify(arr)); } catch(_) {}
}
function pushQueue(u, cmd) {
  const q = getQueue(u);
  q.push({ ...cmd, _ts: Date.now() });
  saveQueue(u, q);
}
function clearQueue(u) {
  saveQueue(u, []);
}
function bumpPoll(u) {
  try { writeFileSync(pollFile(u), String(Date.now())); } catch(_) {}
}
function lastPoll(u) {
  try { return parseInt(readFileSync(pollFile(u), 'utf8') || '0'); } catch(_) { return 0; }
}
function isOnline(u) {
  return (Date.now() - lastPoll(u)) < 7000;
}
function saveOutput(u, arr) {
  try { writeFileSync(outFile(u), JSON.stringify({ outputs: arr, ts: Date.now() })); } catch(_) {}
}
function getOutputData(u) {
  try {
    if (existsSync(outFile(u))) return JSON.parse(readFileSync(outFile(u), 'utf8'));
  } catch(_) {}
  return { outputs: [] };
}

function pushLog(e) {
  try {
    let l = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
    l.unshift({ ...e, ts: Date.now() });
    if (l.length > 300) l = l.slice(0, 300);
    writeFileSync(LOG_FILE, JSON.stringify(l));
  } catch(_) {}
}
function pushHist(e) {
  try {
    let h = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [];
    h.unshift({ ...e, ts: Date.now() });
    if (h.length > 150) h = h.slice(0, 150);
    writeFileSync(HIST_FILE, JSON.stringify(h));
  } catch(_) {}
}

const VALID = new Set([
  'none', 'inject_script', 'batch_inject', 'create_part', 'batch_create',
  'insert_model', 'clone_object', 'create_mesh', 'create_npc', 'create_sound',
  'create_gui', 'create_billboard', 'create_surface_gui', 'create_proximity_prompt',
  'create_click_detector', 'weld_parts', 'create_tool', 'create_seat',
  'create_particle', 'create_light', 'add_effect', 'clear_workspace',
  'delete_object', 'delete_multiple', 'modify_part', 'select_object',
  'create_instance', 'create_folder', 'create_team', 'create_animation',
  'set_lighting', 'change_baseplate', 'fill_terrain', 'clear_terrain',
  'create_spawn', 'set_value', 'create_value', 'create_remote', 'batch_remote',
  'print_output', 'get_output', 'read_workspace', 'workspace_data',
  'set_game_info', 'modify_humanoid', 'batch_commands',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ─────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Proxy userinfo (plugin cannot call roblox.com directly)
    if (req.query.userinfo === '1') {
      const uid = parseInt(req.query.userId || '0');
      if (!uid || uid <= 0) return res.status(400).json({ ok: false, error: 'Invalid userId' });
      try {
        const r = await fetch(
          `https://users.roblox.com/v1/users/${uid}`,
          { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return res.status(502).json({ ok: false, error: `Roblox API ${r.status}` });
        const d = await r.json();
        return res.status(200).json({
          ok: true,
          userId: uid,
          username: d.name || '',
          displayName: d.displayName || d.name || '',
        });
      } catch(e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Check plugin online status (web polling — do NOT bump poll here)
    if (req.query.check) {
      const u = san(req.query.user || '');
      return res.status(200).json({
        _pluginConnected: isOnline(u),
        _lastPoll: lastPoll(u),
        user: u,
        queueLength: getQueue(u).length,
      });
    }

    if (req.query.get_output) {
      const u = san(req.query.user || '');
      return res.status(200).json(getOutputData(u));
    }

    if (req.query.get_workspace) {
      const u = san(req.query.user || '');
      try {
        if (existsSync(wsFile(u))) return res.status(200).json(JSON.parse(readFileSync(wsFile(u), 'utf8')));
      } catch(_) {}
      return res.status(200).json({ ok: false, error: 'No workspace data' });
    }

    // Plugin polling — bump poll AND return queue
    const pu = san(req.query.user || req.query.u || '');
    if (!pu) return res.status(400).json({ error: 'user required', queue: [] });
    bumpPoll(pu);
    const q = getQueue(pu);
    return res.status(200).json({ queue: q, count: q.length });
  }

  // ── POST ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // Reset queue
    if (body.type === 'reset' || (body.action === 'none' && body.type)) {
      const u = san(body._user || body.user || '');
      if (u) clearQueue(u);
      return res.status(200).json({ status: 'ok' });
    }

    // Status check
    if (body.type === 'status') {
      const u = san(body.user || '');
      return res.status(200).json({ connected: isOnline(u), lastPoll: lastPoll(u) });
    }

    // Workspace data from plugin
    if (body.action === 'workspace_data') {
      const u = san(body._user || '');
      pushLog({ action: 'workspace_read', user: u });
      try { writeFileSync(wsFile(u), JSON.stringify({ ...body, _ts: Date.now() })); } catch(_) {}
      return res.status(200).json({ status: 'ok' });
    }

    // Output data from plugin
    if (body.action === 'output_data') {
      const u = san(body._user || '');
      saveOutput(u, body.outputs || []);
      return res.status(200).json({ status: 'ok' });
    }

    // Get logs
    if (body.type === 'get_logs') {
      try {
        return res.status(200).json({
          logs: existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [],
        });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // Get history
    if (body.type === 'get_history') {
      try {
        return res.status(200).json({
          history: existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [],
        });
      } catch(_) { return res.status(200).json({ history: [] }); }
    }

    // Batch commands
    if (body.type === 'batch_commands' && Array.isArray(body.commands)) {
      const target = san(body.target || body._target_user || '');
      if (!target) return res.status(400).json({ error: 'target required' });
      let pushed = 0;
      for (const cmd of body.commands) {
        if (!cmd.action || !VALID.has(cmd.action)) continue;
        pushQueue(target, {
          ...cmd,
          _user: String(body._user || 'web').substring(0, 50),
          _target_user: target,
          _apiKey: undefined,
        });
        pushed++;
      }
      pushLog({ action: 'batch_commands', user: body._user || 'web', target, count: pushed });
      return res.status(200).json({
        status: 'ok',
        pushed,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // Single command
    if (body.action) {
      if (!VALID.has(body.action)) {
        return res.status(400).json({ error: 'Invalid action: ' + body.action });
      }
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      pushQueue(target, {
        ...body,
        _user: String(body._user || 'web').substring(0, 50),
        _target_user: target,
        _apiKey: undefined,
      });
      pushLog({
        action: body.action,
        user: body._user || 'web',
        target,
        name: body.name || '',
        parent: body.parent || '',
      });
      pushHist({
        action: body.action,
        details: body.name || (body.code ? body.code.substring(0, 80) + '...' : '') || JSON.stringify(body).substring(0, 100),
        user: body._user || 'web',
        target,
      });
      return res.status(200).json({
        status: 'ok',
        action: body.action,
        target,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // Prompt log
    if (body.type === 'prompt') {
      pushLog({ action: 'prompt', user: body.user || 'web', msg: (body.msg || '').substring(0, 100) });
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(400).json({ error: 'Unknown request type' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
