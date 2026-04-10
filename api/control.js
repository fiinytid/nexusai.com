// api/control.js - Smart AI Logic for FIINYTID25
let currentCommand = { action: "none" };

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 1. MENERIMA PROMPT DARI ROBLOX (User mengetik sesuatu)
    if (req.method === 'POST') {
        const data = req.body;

        // Jika plugin mengirim reset (action: "none")
        if (data.action === "none") {
            currentCommand = { action: "none" };
            return res.status(200).json({ status: "Reset Success" });
        }

        // LOGIKA AI SEDERHANA (Menerjemahkan kata kunci)
        let prompt = data.msg ? data.msg.toLowerCase() : "";
        
        if (prompt.includes("part") || prompt.includes("buat")) {
            currentCommand = {
                action: "create_part",
                name: "AI_Generated_Part",
                color: [Math.random()*255, Math.random()*255, Math.random()*255]
            };
        } else if (prompt.includes("hapus") || prompt.includes("bersihkan")) {
            currentCommand = { action: "clear_workspace" };
        } else if (prompt.includes("malam")) {
            currentCommand = { action: "inject_script", code: "game.Lighting.ClockTime = 0" };
        } else if (prompt.includes("siang")) {
            currentCommand = { action: "inject_script", code: "game.Lighting.ClockTime = 14" };
        } else {
            // Jika tidak ada kata kunci, buat script random
            currentCommand = { 
                action: "inject_script", 
                code: `print("NEXUS AI: Kamu berkata '${prompt}'")` 
            };
        }

        return res.status(200).json({ status: "AI Thinking...", result: currentCommand });
    }

    // 2. MENGIRIM PERINTAH KE ROBLOX (Polling)
    if (req.method === 'GET') {
        return res.status(200).json(currentCommand);
    }
}
