// api/control.js — NEXUS AI RELAY v10.3 (Complete Queue + Workspace + Script System)
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TMP = '/tmp';
export const REQUIRED_PLUGIN_VERSION = 'V10.3';
export const WEB_VERSION = 'V10.3';

function san(user) {
  return (user || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}
function queueFile(u)    { return `${TMP}/nq_${san(u)}.json`; }
function pollFile(u)     { return `${TMP}/np_${san(u)}.txt`; }
function outFile(u)      { return `${TMP}/no_${san(u)}.json`; }
function wsFile(u)       { return `${TMP}/nw_${san(u)}.json`; }
function scriptFile(u)   { return `${TMP}/ns_${san(u)}.json`; }
function thinkFile(u)    { return `${TMP}/nt_${san(u)}.json`; }
const LOG_FILE  = `${TMP}/nexus_log.json`;
const HIST_FILE = `${TMP}/nexus_hist.json`;

function getQueue(u) {
  try { if (existsSync(queueFile(u))) return JSON.parse(readFileSync(queueFile(u), 'utf8')); } catch(_) {}
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
function clearQueue(u) { saveQueue(u, []); }
function bumpPoll(u) {
  try { writeFileSync(pollFile(u), String(Date.now())); } catch(_) {}
}
function lastPoll(u) {
  try { return parseInt(readFileSync(pollFile(u), 'utf8') || '0'); } catch(_) { return 0; }
}
function isOnline(u) { return (Date.now() - lastPoll(u)) < 7000; }

function saveOutput(u, arr) {
  try { writeFileSync(outFile(u), JSON.stringify({ outputs: arr, ts: Date.now() })); } catch(_) {}
}
function getOutputData(u) {
  try { if (existsSync(outFile(u))) return JSON.parse(readFileSync(outFile(u), 'utf8')); } catch(_) {}
  return { outputs: [] };
}

// ── Script storage: save script content from plugin ──
function saveScriptData(u, data) {
  try {
    let existing = {};
    if (existsSync(scriptFile(u))) existing = JSON.parse(readFileSync(scriptFile(u), 'utf8'));
    const key = data.name + '|' + (data.parent || '');
    existing[key] = { ...data, ts: Date.now() };
    writeFileSync(scriptFile(u), JSON.stringify(existing));
  } catch(_) {}
}
function getScriptData(u, name, parent) {
  try {
    if (existsSync(scriptFile(u))) {
      const all = JSON.parse(readFileSync(scriptFile(u), 'utf8'));
      const key = name + '|' + (parent || '');
      return all[key] || null;
    }
  } catch(_) {}
  return null;
}
function getAllScripts(u) {
  try {
    if (existsSync(scriptFile(u))) return JSON.parse(readFileSync(scriptFile(u), 'utf8'));
  } catch(_) {}
  return {};
}

// ── Workspace storage ──
function saveWsData(u, data) {
  try { writeFileSync(wsFile(u), JSON.stringify({ ...data, _ts: Date.now() })); } catch(_) {}
}
function getWsData(u) {
  try { if (existsSync(wsFile(u))) return JSON.parse(readFileSync(wsFile(u), 'utf8')); } catch(_) {}
  return null;
}

// ── Thinking state ──
function saveThink(u, data) {
  try { writeFileSync(thinkFile(u), JSON.stringify({ ...data, ts: Date.now() })); } catch(_) {}
}
function getThink(u) {
  try { if (existsSync(thinkFile(u))) return JSON.parse(readFileSync(thinkFile(u), 'utf8')); } catch(_) {}
  return null;
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
  'create_wedge', 'create_cylinder', 'create_sphere', 'create_truss',
  'move_object', 'rotate_object', 'resize_object',
  'place_decal', 'place_texture', 'create_trail', 'create_beam',
  'create_constraint', 'create_sky', 'create_water', 'create_fire',
  'create_smoke', 'create_sparkles', 'create_selectbox', 'create_hinge',
  'create_door', 'create_window', 'create_stairs', 'create_ramp',
  'create_tree', 'create_rock', 'group_parts', 'ungroup_model',
  'anchor_all', 'unanchor_all', 'set_property', 'copy_properties',
  'create_hat', 'create_attachment', 'create_motor6d', 'create_humanoid',
  'run_lua', 'batch_modify',
  // NEW v10.3 actions
  'read_script',      // Read a script's source code
  'edit_script',      // Edit/replace a script's source
  'scan_workspace',   // Scan full workspace structure
  'list_scripts',     // List all scripts in a service
  'get_console_log',  // Get Studio output log
  'play_test',        // Start play test
  'stop_test',        // Stop play test
  'get_properties',   // Get all properties of an object
  'find_errors',      // Find errors in a script (via Studio output)
  'search_instances', // Search for instances by name/class
  'rename_object',    // Rename an object
  'duplicate_script', // Duplicate a script
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Version check
    if (req.query.version === '1' || req.query.version_check === '1') {
      return res.status(200).json({
        ok: true,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
        update_url: 'https://discord.gg/HuGtbRvD',
        changelog: 'V10.3: Script reading, workspace scan, thinking system, edit script',
      });
    }

    // Proxy Roblox userinfo
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
        return res.status(200).json({ ok: true, userId: uid, username: d.name || '', displayName: d.displayName || d.name || '' });
      } catch(e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Check plugin online
    if (req.query.check) {
      const u = san(req.query.user || '');
      return res.status(200).json({
        _pluginConnected: isOnline(u),
        _lastPoll: lastPoll(u),
        user: u,
        queueLength: getQueue(u).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // Get output data
    if (req.query.get_output) {
      const u = san(req.query.user || '');
      return res.status(200).json(getOutputData(u));
    }

    // Get workspace data
    if (req.query.get_workspace) {
      const u = san(req.query.user || '');
      const ws = getWsData(u);
      if (ws) return res.status(200).json({ ok: true, ...ws });
      return res.status(200).json({ ok: false, error: 'No workspace data yet. Use scan_workspace.' });
    }

    // Get specific script content
    if (req.query.get_script) {
      const u = san(req.query.user || '');
      const name = req.query.name || '';
      const parent = req.query.parent || '';
      const script = getScriptData(u, name, parent);
      if (script) return res.status(200).json({ ok: true, ...script });
      return res.status(200).json({ ok: false, error: 'Script not found. Use read_script action.' });
    }

    // Get all scripts list
    if (req.query.list_scripts) {
      const u = san(req.query.user || '');
      const all = getAllScripts(u);
      return res.status(200).json({ ok: true, scripts: Object.values(all) });
    }

    // Get thinking state
    if (req.query.get_think) {
      const u = san(req.query.user || '');
      const think = getThink(u);
      return res.status(200).json({ ok: true, think });
    }

    // Get logs
    if (req.query.get_logs) {
      try {
        return res.status(200).json({
          logs: existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [],
        });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // ── Plugin polling ──────────────────────────────────────────────
    const pu = san(req.query.user || req.query.u || '');
    if (!pu) return res.status(400).json({ error: 'user required', queue: [] });
    bumpPoll(pu);
    const q = getQueue(pu);
    return res.status(200).json({
      queue: q,
      count: q.length,
      required_plugin_version: REQUIRED_PLUGIN_VERSION,
      web_version: WEB_VERSION,
      _pluginConnected: true,
    });
  }

  // ── POST ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // Reset queue
    if (body.type === 'reset' || (body.action === 'none' && body._user)) {
      const u = san(body._user || body.user || '');
      if (u) clearQueue(u);
      return res.status(200).json({ status: 'ok' });
    }

    // Status check
    if (body.type === 'status') {
      const u = san(body.user || '');
      return res.status(200).json({
        connected: isOnline(u),
        lastPoll: lastPoll(u),
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // ── Plugin sends workspace scan result ──────────────────────────
    if (body.action === 'workspace_data' || body.type === 'workspace_data') {
      const u = san(body._user || body.user || '');
      saveWsData(u, body);
      pushLog({ action: 'workspace_scan_received', user: u });
      return res.status(200).json({ status: 'ok' });
    }

    // ── Plugin sends script content ─────────────────────────────────
    if (body.action === 'script_content' || body.type === 'script_content') {
      const u = san(body._user || body.user || '');
      saveScriptData(u, {
        name: body.name || 'Unknown',
        parent: body.parent || '',
        scriptType: body.scriptType || 'Script',
        source: body.source || '',
        lineCount: (body.source || '').split('\n').length,
        size: (body.source || '').length,
      });
      pushLog({ action: 'script_read', user: u, name: body.name });
      return res.status(200).json({ status: 'ok' });
    }

    // ── Plugin sends output/console data ───────────────────────────
    if (body.action === 'output_data' || body.type === 'output_data') {
      const u = san(body._user || body.user || '');
      saveOutput(u, body.outputs || []);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Plugin sends thinking state update ─────────────────────────
    if (body.type === 'think_update') {
      const u = san(body._user || body.user || '');
      saveThink(u, { step: body.step, total: body.total, label: body.label, action: body.action });
      return res.status(200).json({ status: 'ok' });
    }

    // ── Get logs (POST) ─────────────────────────────────────────────
    if (body.type === 'get_logs') {
      try {
        return res.status(200).json({ logs: existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [] });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // ── Get history ─────────────────────────────────────────────────
    if (body.type === 'get_history') {
      try {
        return res.status(200).json({ history: existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [] });
      } catch(_) { return res.status(200).json({ history: [] }); }
    }

    // ── Batch commands ──────────────────────────────────────────────
    if (body.type === 'batch_commands' && Array.isArray(body.commands)) {
      const target = san(body.target || body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: 'target required' });
      let pushed = 0;
      for (const cmd of body.commands) {
        if (!cmd.action || !VALID.has(cmd.action)) continue;
        pushQueue(target, { ...cmd, _user: String(body._user || 'web').substring(0, 50), _target_user: target, _apiKey: undefined });
        pushed++;
      }
      pushLog({ action: 'batch_commands', user: body._user || 'web', target, count: pushed });
      return res.status(200).json({ status: 'ok', pushed, pluginConnected: isOnline(target), queueLength: getQueue(target).length });
    }

    // ── Execute JSON blocks from AI response ─────────────────────────
    if (body.type === 'execute_json' && body.text) {
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      const jsonBlockRe = /```json\s*([\s\S]*?)```/g;
      let match, pushed = 0;
      const errors = [];
      while ((match = jsonBlockRe.exec(body.text)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          const cmds = Array.isArray(parsed) ? parsed : [parsed];
          for (const cmd of cmds) {
            if (!cmd.action) continue;
            if (cmd.action === 'batch_commands' && Array.isArray(cmd.commands)) {
              for (const subCmd of cmd.commands) {
                if (!subCmd.action || !VALID.has(subCmd.action)) continue;
                pushQueue(target, { ...subCmd, _user: String(body._user || 'web').substring(0, 50), _target_user: target, _apiKey: undefined });
                pushed++;
              }
            } else if (VALID.has(cmd.action)) {
              pushQueue(target, { ...cmd, _user: String(body._user || 'web').substring(0, 50), _target_user: target, _apiKey: undefined });
              pushed++;
            }
          }
        } catch(e) { errors.push(e.message); }
      }
      pushLog({ action: 'execute_json', user: body._user || 'web', target, count: pushed });
      return res.status(200).json({ status: 'ok', pushed, errors, pluginConnected: isOnline(target), queueLength: getQueue(target).length });
    }

    // ── Single command ──────────────────────────────────────────────
    if (body.action) {
      if (!VALID.has(body.action)) return res.status(400).json({ error: 'Invalid action: ' + body.action });
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      pushQueue(target, {
        ...body,
        _user: String(body._user || 'web').substring(0, 50),
        _target_user: target,
        _apiKey: undefined,
      });
      pushLog({ action: body.action, user: body._user || 'web', target, name: body.name || '', parent: body.parent || '' });
      pushHist({
        action: body.action,
        details: body.name || (body.source ? '[script edit]' : body.code ? body.code.substring(0, 80) + '...' : JSON.stringify(body).substring(0, 100)),
        user: body._user || 'web',
        target,
      });
      return res.status(200).json({
        status: 'ok',
        action: body.action,
        target,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
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
