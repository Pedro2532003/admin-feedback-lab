const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '/opt/admin/logs';
fs.mkdirSync(LOG_DIR, { recursive: true });

// Base64 string required by the assignment, taken verbatim from the PDF
// (the trailing stray "}" in the source document was a template artifact
// and has been stripped so the string decodes cleanly).
// NOTE: decodes to "PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}" — the PDF's own
// "Final Flag" bullet instead prints "SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}"
// and claims a 44-char length; neither matches this 48-char padded string.
// This is documented as a known spec inconsistency in README.md — flag it
// to your instructor/client rather than silently trusting either value.
const XFF_B64 = "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=";

const accessLines = [
  `192.168.1.100 - - [2026-10-02T18:49:00.000Z] "GET /dashboard HTTP/1.1" 200 - "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" XFF:"-"`,
  `10.10.14.50 - - [2026-10-02T18:50:15.000Z] "POST /feedback HTTP/1.1" 403 - "Mozilla/5.0" XFF:"-"`,
  `10.10.14.50 - - [2026-10-02T18:51:55.000Z] "GET /dashboard HTTP/1.1" 200 - "Mozilla/5.0" XFF:"${XFF_B64}"`,
];

const errorLines = [
  `[2026-10-02T18:50:15.000Z] [WARNING] WAF blocked payload from 10.10.14.50: <script> tag detected`,
  `[2026-10-02T18:51:55.000Z] [CRITICAL] Dashboard accessed via session replay from 10.10.14.50 - /api/verify-mfa was never reached`,
  `[2026-10-02T18:53:10.000Z] [WARNING] Authentication bypass anomaly`,
];

fs.appendFileSync(path.join(LOG_DIR, 'access.log'), accessLines.join('\n') + '\n');
fs.appendFileSync(path.join(LOG_DIR, 'error.log'), errorLines.join('\n') + '\n');

console.log('Seed logs written to', LOG_DIR);
