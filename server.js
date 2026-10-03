const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3075;
const LOG_DIR = process.env.LOG_DIR || '/opt/admin/logs';

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ---- Phase 1: expose backend tech ----
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Powered-By', 'Node.js');
  next();
});

// ---- access.log writer (Nginx-style) ----
function accessLog(req, res) {
  const line = `${req.ip} - - [${new Date().toISOString()}] "${req.method} ${req.originalUrl} HTTP/1.1" ${res.statusCode} - "${req.headers['user-agent'] || '-'}" XFF:"${req.headers['x-forwarded-for'] || '-'}"\n`;
  fs.appendFileSync(path.join(LOG_DIR, 'access.log'), line);
}
app.use((req, res, next) => {
  res.on('finish', () => accessLog(req, res));
  next();
});

function errorLog(message, level = 'INFO') {
  fs.appendFileSync(path.join(LOG_DIR, 'error.log'), `[${new Date().toISOString()}] [${level}] ${message}\n`);
}

// ---- in-memory stored feedback (this is the stored-XSS sink) ----
let feedbackStore = [];

// ---- Phase 1: pre-auth session cookie, intentionally not HttpOnly ----
app.use((req, res, next) => {
  if (!req.cookies.pre_mfa_session) {
    res.cookie('pre_mfa_session', 'pending_mfa_verification', { httpOnly: false, path: '/' });
  }
  next();
});

// ---- robots.txt hints at the restricted endpoint ----
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /api/verify-mfa\n');
});

// ---- home page: feedback form + ASCII hint pointing to robots.txt ----
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head><title>Admin Feedback System</title>
<!--
   _____ _               _      _____       _           ___
  / ____| |             | |    |  __ \\     | |         |__ \\
 | |    | |__   ___  ___| | __ | |__) |___ | |__   ___     ) |
 | |    | '_ \\ / _ \\/ __| |/ / |  _  // _ \\| '_ \\ / _ \\   / /
 | |____| | | |  __/ (__|   <  | | \\ \\ (_) | |_) | (_) | / /_
  \\_____|_| |_|\\___|\\___|_|\\_\\ |_|  \\_\\___/|_.__/ \\___/ |____|
  Hint: always check robots.txt first ;)
-->
</head>
<body>
  <h1>Admin Feedback System</h1>
  <form method="POST" action="/feedback">
    <input name="name" placeholder="Name"/><br/>
    <textarea name="message" placeholder="Your feedback"></textarea><br/>
    <button type="submit">Submit</button>
  </form>
</body>
</html>`);
});

// ---- Phase 2: a WAF that blocks obvious payloads but can be bypassed ----
function wafBlocks(input) {
  const lower = input.toLowerCase();
  if (lower.includes('<script')) return true;       // blocks classic XSS
  if (lower.includes('document.cookie')) return true; // forces bracket-notation obfuscation
  return false;
}

app.post('/feedback', (req, res) => {
  const { name, message } = req.body;
  const combined = `${name || ''} ${message || ''}`;

  if (wafBlocks(combined)) {
    errorLog(`WAF blocked payload from ${req.ip}: <script> tag detected`, 'WARNING');
    return res.status(403).send('Forbidden: malicious payload detected by WAF');
  }

  feedbackStore.push({ name, message, ts: new Date().toISOString() });
  res.send('Thank you for your feedback!');
});

// ---- attacker "collector" endpoint to demonstrate exfiltration ----
app.get('/collector', (req, res) => {
  const stolen = req.query.c || '(none)';
  errorLog(`Exfiltrated cookie received via collector: ${stolen}`, 'CRITICAL');
  res.sendStatus(200);
});

// ---- the MFA endpoint that SHOULD gate every admin session ----
app.get('/api/verify-mfa', (req, res) => {
  res.json({ status: 'mfa_required', message: 'Please complete MFA to continue.' });
});

// ---- legitimate admin login (completes MFA correctly) ----
app.get('/admin/login', (req, res) => {
  const sessionId = 'adm_sess_' + Math.random().toString(36).slice(2, 15);
  res.cookie('adm_sess', sessionId, { httpOnly: false, path: '/' });
  errorLog(`Admin completed MFA and established session ${sessionId}`, 'INFO');
  res.redirect('/dashboard');
});

// ---- Phase 3: THE BUG — any cookie with the adm_sess prefix bypasses MFA ----
app.get('/dashboard', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const hasAdminSession = /adm_sess=/.test(cookieHeader);

  if (!hasAdminSession) {
    return res.status(401).send('Unauthorized. Please login via /admin/login');
  }

  // VULNERABILITY: /api/verify-mfa is never called here on replay
  errorLog(`Dashboard accessed via session replay - /api/verify-mfa was skipped entirely`, 'CRITICAL');

  const feedbackHtml = feedbackStore
    .map(f => `<div class="xss-payload">${f.name}: ${f.message}</div>`)
    .join('\n');

  res.send(`<!DOCTYPE html>
<html>
<head><title>Admin Dashboard</title></head>
<body>
  <h1>Admin Dashboard</h1>
  <h2>Feedback Review</h2>
  ${feedbackHtml}
  <hr/>
  <p id="flag">SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}</p>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Admin Feedback System listening on port ${PORT}`);
});
