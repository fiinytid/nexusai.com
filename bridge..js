/**
 * ╔══════════════════════════════════════════════════╗
 * ║   NEXUS AI Bridge v5.3 — Local Server            ║
 * ║   HTTP  : localhost:7778  (Roblox Plugin)        ║
 * ║   WS    : ws://localhost:7778  (Web UI)          ║
 * ╠══════════════════════════════════════════════════╣
 * ║  Setup: Buat file config.json di folder ini      ║
 * ║  {                                               ║
 * ║    "CLAUDE_API_KEY": "sk-ant-...",               ║
 * ║    "GEMINI_API_KEY": "AIza...",                  ║
 * ║    "GROK_API_KEY":   "xai-...",                  ║
 * ║    "OPENAI_API_KEY": "sk-...",                   ║
 * ║    "APP_PASSWORD":   "password_roblox_kamu"      ║
 * ║  }                                               ║
 * ║  Lalu: node bridge.js                            ║
 * ╚══════════════════════════════════════════════════╝
 */

const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

// ── Load Config ────────────────────────────────────────────
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  console.log('✅ config.json loaded');
} catch { /* use env vars */ }

const CLAUDE_KEY = cfg.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY || '';
const GEMINI_KEY = cfg.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const GROK_KEY   = cfg.GROK_API_KEY   || process.env.GROK_API_KEY   || '';
const OPENAI_KEY = cfg.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const APP_PASS   = cfg.APP_PASSWORD   || process.env.APP_PASSWORD   || '';

// ── Fetch ──────────────────────────────────────────────────
let _nodeFetch;
try { _nodeFetch = require('node-fetch'); } catch { /* use global */ }
const apiFetch = (url, o) => (_nodeFetch ? _nodeFetch(url, o) : fetch(url, o));

// ── State ──────────────────────────────────────────────────
const state = {
  pluginConnected : false,
  pluginInfo      : {},
  workspaceTree   : null,
  commandQueue    : [],
  pendingCmds     : new Map(), // id → { resolve, reject, timeoutRef }
  sessions        : new Map(), // token → username
  webClients      : new Set(),
};

// ── Express ────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname)));   // serve local files

const server = http.createServer(app);

// ── WebSocket (Web UI) ─────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  state.webClients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function wsLog(level, msg) {
  broadcast({ type: 'log', level, msg });
  const tag = level === 'ok' ? '✅' : level === 'err' ? '❌' : level === 'warn' ? '⚠️' : '→';
  console.log(`[Bridge ${tag}] ${msg}`);
}

wss.on('connection', (ws) => {
  state.webClients.add(ws);
  wsLog('info', `Web client connected (total: ${state.webClients.size})`);

  // Immediate status push
  ws.send(JSON.stringify({
    type            : 'init',
    pluginConnected : state.pluginConnected,
    pluginInfo      : state.pluginInfo,
    workspace       : state.workspaceTree,
    models          : { claude: !!CLAUDE_KEY, gemini: !!GEMINI_KEY, grok: !!GROK_KEY, openai: !!OPENAI_KEY }
  }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'chat':          await wsHandleChat(ws, msg);    break;
      case 'studioCmd':     await wsHandleStudioCmd(ws, msg); break;
      case 'requestWorkspace':
        if (state.pluginConnected) {
          state.commandQueue.push({ id: 'req_ws_' + Date.now(), action: 'getWorkspace' });
        }
        break;
    }
  });

  ws.on('close', () => {
    state.webClients.delete(ws);
    wsLog('info', `Web client disconnected (total: ${state.webClients.size})`);
  });
});

// ── AI Chat Handler ────────────────────────────────────────
async function wsHandleChat(ws, msg) {
  const { requestId, model = 'gemini-2.5-flash', messages, username = 'User' } = msg;

  const studioCtx = state.pluginConnected
    ? buildConnectedSystemPrompt(username)
    : buildDisconnectedSystemPrompt(username);

  try {
    const content = await callAI(model, messages, studioCtx);
    ws.send(JSON.stringify({ type: 'chatResponse', requestId, content }));
    wsLog('ok', `AI (${model}) responded`);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'chatError', requestId, error: err.message }));
    wsLog('err', `AI error: ${err.message}`);
  }
}

function buildConnectedSystemPrompt(username) {
  const wsSnippet = state.workspaceTree
    ? JSON.stringify(state.workspaceTree).slice(0, 4000)
    : 'Belum dimuat';

  return `Kamu adalah NEXUS AI v5.3, asisten developer Roblox yang sangat canggih.
Nama pengguna: ${username}. Sapa dengan nama mereka.
Keahlian: Lua/Luau, Roblox Studio, GUI, DataStore, RemoteEvents, Module Systems, OOP, Pathfinding, dll.

🟢 STUDIO STATUS: TERHUBUNG
Place: ${state.pluginInfo.placeName || '?'} (ID: ${state.pluginInfo.placeId || '?'})
Workspace saat ini: ${wsSnippet}

🔧 STUDIO TOOLS (gunakan format ini di respons kamu):
Baca script  : <nexus_tool>{"action":"readScript","path":"ServiceName/ScriptName"}</nexus_tool>
Tulis script : <nexus_tool>{"action":"writeScript","path":"ServiceName/Script","source":"-- kode"}</nexus_tool>
Buat script  : <nexus_tool>{"action":"createScript","parent":"ServerScriptService","name":"NamaScript","scriptType":"Script"}</nexus_tool>
Hapus objek  : <nexus_tool>{"action":"deleteObject","path":"ServiceName/NamaObjek"}</nexus_tool>
Rename       : <nexus_tool>{"action":"renameObject","path":"Service/Obj","newName":"NamaBaru"}</nexus_tool>
Refresh WS   : <nexus_tool>{"action":"getWorkspace"}</nexus_tool>

Instruksi tool: gunakan SATU tool per respons. Setelah menerima hasilnya, baru lanjutkan.
Berikan kode Lua yang lengkap, benar, dengan komentar bahasa Indonesia.
Gunakan markdown: \`\`\`lua untuk blok kode, **bold** untuk poin penting.`;
}

function buildDisconnectedSystemPrompt(username) {
  return `Kamu adalah NEXUS AI v5.3, asisten developer Roblox yang sangat canggih.
Nama pengguna: ${username}. Sapa dengan nama mereka.
Keahlian: Lua/Luau, Roblox Studio, GUI, DataStore, RemoteEvents, Module Systems, OOP, dll.

🔴 STUDIO STATUS: TIDAK TERHUBUNG
PENTING: Jika pengguna meminta kamu untuk membaca script, memodifikasi workspace, membuat script, 
atau melakukan APAPUN langsung di Roblox Studio, kamu HARUS menjawab dengan persis:
"Maaf, saya tidak bisa melakukan itu karena plugin Roblox Studio belum terhubung ke NEXUS AI. 
Silakan buka Roblox Studio, install plugin NEXUS AI, dan klik tombol Connect."

Kamu tetap bisa: membantu menulis kode, menjelaskan konsep, debug dari kode yang diberikan manual.
Gunakan markdown dan berikan kode Lua yang lengkap dan benar.`;
}

async function callAI(model, messages, systemPrompt) {
  if (model.includes('claude')) {
    if (!CLAUDE_KEY) throw new Error('CLAUDE_API_KEY belum dikonfigurasi di config.json');
    const r = await apiFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages })
    });
    const d = await r.json();
    if (d.error) throw new Error(`Claude: ${d.error.message}`);
    return d.content[0].text;

  } else if (model.includes('gemini')) {
    if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY belum dikonfigurasi di config.json');
    const gMsgs = [
      { role: 'user',  parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Siap! Saya NEXUS AI.' }] },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    ];
    const r = await apiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: gMsgs })
    });
    const d = await r.json();
    if (d.error) throw new Error(`Gemini: ${d.error.message}`);
    return d.candidates[0].content.parts[0].text;

  } else if (model.includes('grok')) {
    if (!GROK_KEY) throw new Error('GROK_API_KEY belum dikonfigurasi di config.json');
    const r = await apiFetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
    });
    const d = await r.json();
    if (d.error) throw new Error(`Grok: ${d.error.message || JSON.stringify(d.error)}`);
    return d.choices[0].message.content;

  } else if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) {
    if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY belum dikonfigurasi di config.json');
    const r = await apiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'system', content: systemPrompt }, ...messages] })
    });
    const d = await r.json();
    if (d.error) throw new Error(`OpenAI: ${d.error.message}`);
    return d.choices[0].message.content;

  } else {
    throw new Error(`Model tidak dikenali: ${model}`);
  }
}

// ── Studio Command from Web ────────────────────────────────
async function wsHandleStudioCmd(ws, msg) {
  const { requestId, command } = msg;

  if (!state.pluginConnected) {
    ws.send(JSON.stringify({ type: 'studioCmdError', requestId, error: 'Plugin belum terhubung.' }));
    return;
  }

  try {
    const result = await queueCommand(command);
    ws.send(JSON.stringify({ type: 'studioCmdResult', requestId, result }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'studioCmdError', requestId, error: err.message }));
  }
}

function queueCommand(cmd) {
  return new Promise((resolve, reject) => {
    const id = 'cmd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    cmd.id = id;
    const timeoutRef = setTimeout(() => {
      if (state.pendingCmds.has(id)) {
        state.pendingCmds.delete(id);
        reject(new Error(`Timeout: Plugin tidak merespons perintah "${cmd.action}" dalam 15 detik.`));
      }
    }, 15000);
    state.pendingCmds.set(id, { resolve, reject, timeoutRef });
    state.commandQueue.push(cmd);
    wsLog('info', `Command queued: ${cmd.action} → ${cmd.path || ''}`);
  });
}

// ── Plugin HTTP Routes ─────────────────────────────────────

app.get('/status', (req, res) => {
  res.json({
    bridge       : 'nexusai-v5.3',
    webConnected : state.webClients.size > 0,
    pluginConnected: state.pluginConnected,
    ts           : Date.now()
  });
});

app.post('/pluginConnected', (req, res) => {
  state.pluginConnected = req.body.connected !== false;
  state.pluginInfo      = req.body;

  if (state.pluginConnected) {
    wsLog('ok', `Plugin terhubung! Place: "${state.pluginInfo.placeName}" (${state.pluginInfo.placeId})`);
    broadcast({ type: 'studioStatus', connected: true, info: state.pluginInfo });
    // Auto-request workspace
    state.commandQueue.push({ id: 'auto_ws_' + Date.now(), action: 'getWorkspace' });
  } else {
    wsLog('warn', 'Plugin terputus.');
    state.workspaceTree = null;
    broadcast({ type: 'studioStatus', connected: false });
  }
  res.json({ ok: true });
});

app.get('/poll', (req, res) => {
  if (state.commandQueue.length > 0) {
    const cmd = state.commandQueue.shift();
    wsLog('info', `Poll → Plugin: ${cmd.action}`);
    res.json(cmd);
  } else {
    res.json({ action: 'idle' });
  }
});

app.post('/workspace', (req, res) => {
  state.workspaceTree = req.body;
  const count = Array.isArray(req.body) ? req.body.length : '?';
  wsLog('ok', `Workspace diterima (${count} services)`);
  broadcast({ type: 'workspace', data: state.workspaceTree });
  res.json({ ok: true });
});

app.post('/script', (req, res) => {
  const { path: scriptPath, content, id } = req.body;
  wsLog('ok', `Script diterima: ${scriptPath}`);

  // Resolve by command id
  if (id && state.pendingCmds.has(id)) {
    const p = state.pendingCmds.get(id);
    clearTimeout(p.timeoutRef);
    state.pendingCmds.delete(id);
    p.resolve({ success: true, path: scriptPath, content });
  }

  broadcast({ type: 'scriptContent', path: scriptPath, content });
  res.json({ ok: true });
});

app.post('/result', (req, res) => {
  const result = req.body;
  wsLog(result.success === false ? 'err' : 'ok', `Result: ${result.action} → ${result.message || 'ok'}`);

  if (result.id && state.pendingCmds.has(result.id)) {
    const p = state.pendingCmds.get(result.id);
    clearTimeout(p.timeoutRef);
    state.pendingCmds.delete(result.id);
    p.resolve(result);
  }

  broadcast({ type: 'commandResult', result });
  res.json({ ok: true });
});

// ── Start ──────────────────────────────────────────────────
const PORT = 7778;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      NEXUS AI Bridge v5.3  ONLINE        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n  Plugin HTTP : http://localhost:${PORT}`);
  console.log(`  Web WS      : ws://localhost:${PORT}`);
  console.log('\n  API Keys:');
  console.log(`    Claude  : ${CLAUDE_KEY  ? '✅' : '❌  tambahkan ke config.json'}`);
  console.log(`    Gemini  : ${GEMINI_KEY  ? '✅' : '❌  tambahkan ke config.json'}`);
  console.log(`    Grok    : ${GROK_KEY    ? '✅' : '❌  tambahkan ke config.json'}`);
  console.log(`    OpenAI  : ${OPENAI_KEY  ? '✅' : '❌  tambahkan ke config.json'}`);
  console.log(`    Password: ${APP_PASS    ? '✅' : '⚠️  kosong (opsional)'}`);
  console.log('\n  Buka Roblox Studio → klik Connect di plugin NEXUS AI');
  console.log('  Buka browser → arifiinytid-boop.github.io/nexusai.com/\n');
});
