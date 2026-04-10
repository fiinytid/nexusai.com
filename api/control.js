// api/control.js
// Dibuat oleh NEXUS AI untuk FIINYTID25

export default function handler(req, res) {
  // 1. Mengatur Header agar bisa diakses oleh Roblox (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Jika ini adalah permintaan OPTIONS (pre-flight), langsung balas OK
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. DATA JSON (Inilah yang akan dibaca oleh Plugin Roblox)
  // Kamu bisa mengubah isi data ini sesuai keinginan!
  const robloxCommand = {
    "action": "create_part",        // Perintah: buat part
    "name": "NEXUS_CLOUD_PART",    // Nama part
    "color": [0, 255, 127],        // Warna Hijau (RGB)
    "code": "print('Halo FIINYTID25! Kode ini disuntikkan dari Web.')" // Jika action-nya inject_script
  };

  // 3. Mengirimkan respon kembali ke Roblox
  res.status(200).json(robloxCommand);
}
