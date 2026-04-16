// api/payment.js — NEXUS AI Payment Config API v1
// Serves OVO/DANA numbers from Vercel Environment Variables
// Set in Vercel Dashboard: OVO_NUMBER, DANA_NUMBER, OWNER_NAME

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return payment config from environment variables
  // Numbers are masked for GET (partial masking for display)
  const ovo = process.env.OVO_NUMBER || '';
  const dana = process.env.DANA_NUMBER || '';
  const owner = process.env.PAYMENT_OWNER_NAME || 'NEXUS STUDIO';

  if (!ovo && !dana) {
    return res.status(503).json({
      error: 'Payment not configured',
      message: 'Admin needs to set OVO_NUMBER and DANA_NUMBER in Vercel environment variables.'
    });
  }

  // Mask number for display (show first 4 + last 4 digits)
  function maskNumber(num) {
    if (!num || num.length < 8) return num;
    return num.substring(0, 4) + '****' + num.substring(num.length - 4);
  }

  return res.status(200).json({
    ovo: {
      available: !!ovo,
      number: ovo,        // Full number (authenticated users only see this)
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
    // Currency info
    currency: {
      idr: { symbol: 'Rp', name: 'Indonesian Rupiah' },
      usd: { symbol: '$', name: 'US Dollar', rate: 16000 }, // approx IDR per USD
    },
    // Packages
    packages: [
      { id: 'small',   cr: 21,  idr: 79000,   usd: 4.99,  label: '21 CR - Small'   },
      { id: 'popular', cr: 86,  idr: 299000,  usd: 18.99, label: '86 CR - Popular', popular: true },
      { id: 'mega',    cr: 438, idr: 1500000, usd: 93.99, label: '438 CR - Mega'   },
    ],
  });
}
