// api/google-callback.js — Google OAuth Callback Handler
// Exchanges auth code for Google user info
// Required env var: GMAIL_KEY (Google OAuth Client ID) + GMAIL_CLIENT_SECRET
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error } = req.query;
  const isApiCall = req.headers['accept'] && req.headers['accept'].includes('application/json');

  if (error) {
    if (isApiCall) return res.status(400).json({ error: 'OAuth error: ' + error });
    return res.redirect(302, '/login?google_error=' + encodeURIComponent(error));
  }
  if (!code) {
    if (isApiCall) return res.status(400).json({ error: 'No code provided' });
    return res.redirect(302, '/login');
  }

  const clientId     = process.env.GMAIL_KEY;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    if (isApiCall) return res.status(500).json({ error: 'GMAIL_KEY or GMAIL_CLIENT_SECRET not configured' });
    return res.redirect(302, '/login?google_error=server_config');
  }

  try {
    const base = (process.env.PRODUCTION_URL || 'https://nexusai-roblox.vercel.app')
      .replace(/\/api\/google-callback\/?$/, '').replace(/\/$/, '');
    const redirectUri = base + '/api/google-callback';

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errData = await tokenResp.json().catch(() => ({}));
      const msg = errData.error_description || errData.error || 'Token exchange failed';
      if (isApiCall) return res.status(400).json({ error: msg, google_error: errData.error || '', redirect_uri_used: redirectUri });
      return res.redirect(302, '/login?google_error=' + encodeURIComponent(msg));
    }

    const tokens = await tokenResp.json();
    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    if (!userResp.ok) {
      if (isApiCall) return res.status(400).json({ error: 'Failed to get user info' });
      return res.redirect(302, '/login?google_error=userinfo_failed');
    }

    const gUser = await userResp.json();
    const userData = {
      id:      gUser.id,
      name:    gUser.name    || gUser.email,
      email:   gUser.email   || '',
      picture: gUser.picture || '',
    };

    if (isApiCall) return res.status(200).json({ user: userData });

    // Browser redirect dari Google — kirim data ke /login via query param
    const encoded = Buffer.from(JSON.stringify(userData)).toString('base64');
    return res.redirect(302, '/login?google_user=' + encodeURIComponent(encoded));

  } catch (e) {
    if (isApiCall) return res.status(500).json({ error: e.message });
    return res.redirect(302, '/login?google_error=' + encodeURIComponent(e.message));
  }
}
