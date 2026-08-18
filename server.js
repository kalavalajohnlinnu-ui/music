const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'sir_slot.db');

// Initialize SQLite Database
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and create tables
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coaches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    mobile TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    pin_hash TEXT,
    salt TEXT,
    batch_id TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    group_members TEXT,
    instruments TEXT,
    skill_level TEXT DEFAULT 'Beginner',
    current_lesson TEXT,
    homework TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    date_key TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    group_members TEXT,
    instruments TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    date_key TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL,
    member_statuses TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (date_key, student_id)
  );

  CREATE TABLE IF NOT EXISTS makeup_slots (
    id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    vacated_by_id TEXT NOT NULL,
    vacated_by_name TEXT NOT NULL,
    claimed_by_id TEXT,
    claimed_by_name TEXT,
    claimed_by_mobile TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS performance_logs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    member_name TEXT,
    date_key TEXT NOT NULL,
    rating_sur INTEGER DEFAULT 5,
    rating_taal INTEGER DEFAULT 5,
    rating_overall INTEGER DEFAULT 5,
    remarks TEXT,
    homework TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    instrument TEXT,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    group_members TEXT,
    instruments TEXT,
    preferred_days TEXT,
    preferred_time TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    keys_auth TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    user_id TEXT,
    name TEXT,
    mobile TEXT,
    role TEXT DEFAULT 'student',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sent_notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_role TEXT NOT NULL,
    target_id TEXT,
    target_name TEXT,
    date_key TEXT NOT NULL,
    slot_time TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sent_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_mobile TEXT,
    action_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    user_id TEXT,
    name TEXT,
    mobile TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Auto-migrate columns
try {
  const tInfo = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
  if (!tInfo.includes('slot_type')) db.exec("ALTER TABLE students ADD COLUMN slot_type TEXT NOT NULL DEFAULT 'solo'");
  if (!tInfo.includes('duration_hours')) db.exec("ALTER TABLE students ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1");
  if (!tInfo.includes('group_members')) db.exec("ALTER TABLE students ADD COLUMN group_members TEXT");
  if (!tInfo.includes('instruments')) db.exec("ALTER TABLE students ADD COLUMN instruments TEXT");
  if (!tInfo.includes('skill_level')) db.exec("ALTER TABLE students ADD COLUMN skill_level TEXT DEFAULT 'Beginner'");
  if (!tInfo.includes('current_lesson')) db.exec("ALTER TABLE students ADD COLUMN current_lesson TEXT");
  if (!tInfo.includes('homework')) db.exec("ALTER TABLE students ADD COLUMN homework TEXT");
  if (!tInfo.includes('group_id')) db.exec("ALTER TABLE students ADD COLUMN group_id TEXT");
  if (!tInfo.includes('group_name')) db.exec("ALTER TABLE students ADD COLUMN group_name TEXT");
  if (!tInfo.includes('student_type')) db.exec("ALTER TABLE students ADD COLUMN student_type TEXT NOT NULL DEFAULT 'regular'");

  const rInfo = db.prepare('PRAGMA table_info(requests)').all().map(c => c.name);
  if (!rInfo.includes('slot_type')) db.exec("ALTER TABLE requests ADD COLUMN slot_type TEXT NOT NULL DEFAULT 'solo'");
  if (!rInfo.includes('duration_hours')) db.exec("ALTER TABLE requests ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1");
  if (!rInfo.includes('group_members')) db.exec("ALTER TABLE requests ADD COLUMN group_members TEXT");
  if (!rInfo.includes('instruments')) db.exec("ALTER TABLE requests ADD COLUMN instruments TEXT");
  if (!rInfo.includes('group_name')) db.exec("ALTER TABLE requests ADD COLUMN group_name TEXT");

  const bInfo = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
  if (!bInfo.includes('slot_type')) db.exec("ALTER TABLE bookings ADD COLUMN slot_type TEXT NOT NULL DEFAULT 'solo'");
  if (!bInfo.includes('duration_hours')) db.exec("ALTER TABLE bookings ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1");
  if (!bInfo.includes('group_members')) db.exec("ALTER TABLE bookings ADD COLUMN group_members TEXT");
  if (!bInfo.includes('instruments')) db.exec("ALTER TABLE bookings ADD COLUMN instruments TEXT");

  const mInfo = db.prepare('PRAGMA table_info(makeup_slots)').all().map(c => c.name);
  if (!mInfo.includes('duration_hours')) db.exec("ALTER TABLE makeup_slots ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1");

  const aInfo = db.prepare('PRAGMA table_info(attendance)').all().map(c => c.name);
  if (!aInfo.includes('member_statuses')) db.exec("ALTER TABLE attendance ADD COLUMN member_statuses TEXT");
} catch (e) {
  console.warn('Migration warning:', e.message);
}

function uid() { return crypto.randomUUID(); }
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(pin, salt, 1000, 32, 'sha256').toString('hex');
  return { hash, salt };
}
function verifyPin(pin, hash, salt) {
  const check = crypto.pbkdf2Sync(pin, salt, 1000, 32, 'sha256').toString('hex');
  return check === hash;
}

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '').slice(-10);
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function slotTypeLabel(type) {
  if (type === 'sibling_duo') return 'Sibling Duo';
  if (type === 'sibling_trio') return 'Sibling Trio';
  if (type === 'group') return 'Group Class';
  return 'Solo (1-on-1)';
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dateToKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${pad(displayH)}:${pad(m)} ${ampm}`;
}

// 5 AM to 11 PM standard 1-hour slots
const DEFAULT_HOURLY_SLOTS = [];
for (let h = 5; h <= 22; h++) {
  DEFAULT_HOURLY_SLOTS.push((h < 10 ? '0' + h : '' + h) + ':00');
}

function addHoursToTime(timeStr, hours) {
  const [h, m] = (timeStr || '05:00').split(':').map(Number);
  const endH = Math.min(23, h + hours);
  return pad(endH) + ':' + pad(m);
}

function getOccupiedSlotList(startTime, durationHours = 1) {
  const slots = [];
  const [h, m] = startTime.split(':').map(Number);
  for (let i = 0; i < durationHours; i++) {
    const curH = h + i;
    if (curH <= 23) {
      slots.push(pad(curH) + ':' + pad(m));
    }
  }
  return slots;
}

// Seed Defaults
const DEFAULT_BATCHES = [
  { id: 'batchA', name: 'Monday Batch', sub: 'Mon · Wed · Fri', days: [1, 3, 5] },
  { id: 'batchB', name: 'Tuesday Batch', sub: 'Tue · Thu · Sat', days: [2, 4, 6] }
];

const DEFAULT_TEMPLATE = "Hi {name} 🎵 Reminder: you have your music class today at {time}. Please come on time!";
const DEFAULT_INSTRUMENTS = [
  "Keyboard",
  "Guitar",
  "Flute",
  "Violin",
  "Octapad & Rhythm Pads",
  "Recorder",
  "Harmonica",
  "Ukulele",
  "Melodica",
  "Tabla"
];

const DEFAULT_FEE_PLANS = [
  { classes: 12, fee: 5600, duration: '6 Months', label: '12 Classes / Month · ₹5,600 (Course: 6 Months)' },
  { classes: 10, fee: 4600, duration: '7.2 Months', label: '10 Classes / Month · ₹4,600 (Course: 7.2 Months)' },
  { classes: 8, fee: 3700, duration: '9 Months', label: '8 Classes / Month · ₹3,700 (Course: 9 Months)' },
  { classes: 6, fee: 2800, duration: '12 Months', label: '6 Classes / Month · ₹2,800 (Course: 12 Months)' },
  { classes: 4, fee: 1900, duration: '18 Months', label: '4 Classes / Month · ₹1,900 (Course: 18 Months)' }
];

const DEFAULT_COACH_MOBILES = ["9848173025", "8919545774"];

function logActivity({ actorType, actorName, actorMobile, actionType, title, message, details }) {
  const id = uid();
  try {
    db.prepare(`
      INSERT INTO activity_logs (id, actor_type, actor_name, actor_mobile, action_type, title, message, details, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, actorType || 'student', actorName || '', actorMobile || '', actionType || 'general', title, message, details || '', Date.now());
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
  return id;
}

function seedInitialData() {
  const getCfg = db.prepare('SELECT value FROM config WHERE key = ?');
  const setCfg = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');

  if (!getCfg.get('batches')) setCfg.run('batches', JSON.stringify(DEFAULT_BATCHES));
  setCfg.run('slots', JSON.stringify(DEFAULT_HOURLY_SLOTS));
  if (!getCfg.get('template')) setCfg.run('template', DEFAULT_TEMPLATE);
  setCfg.run('instruments', JSON.stringify(DEFAULT_INSTRUMENTS));
  setCfg.run('feePlans', JSON.stringify(DEFAULT_FEE_PLANS));
  
  if (!getCfg.get('coachMobile') || !getCfg.get('coachMobile').value) {
    setCfg.run('coachMobile', '9848173025');
  }

  // Set/Update Music Sir PIN to 1717
  const { hash, salt } = hashPin('1717');
  const coach = db.prepare('SELECT id FROM coaches LIMIT 1').get();
  if (!coach) {
    db.prepare('INSERT INTO coaches (id, name, pin_hash, salt, mobile, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('coach-1', 'Music Sir', hash, salt, '9848173025', Date.now());
  } else {
    db.prepare("UPDATE coaches SET pin_hash = ?, salt = ?, mobile = '9848173025' WHERE id = ?").run(hash, salt, coach.id);
  }
}

seedInitialData();

function getConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const cfg = {
    batches: DEFAULT_BATCHES,
    slots: DEFAULT_HOURLY_SLOTS,
    template: DEFAULT_TEMPLATE,
    instruments: DEFAULT_INSTRUMENTS,
    feePlans: DEFAULT_FEE_PLANS,
    coachMobile: '9848173025',
    secondaryMobile: '8919545774'
  };
  for (const r of rows) {
    try {
      cfg[r.key] = JSON.parse(r.value);
    } catch {
      cfg[r.key] = r.value;
    }
  }
  return cfg;
}

function setConfigValue(key, val) {
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, str);
}

function getSessionFromReq(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['cookie']) {
    const match = req.headers['cookie'].match(/sir_session=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token) return null;

  const now = Date.now();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, now);
  return session || null;
}

function createSession(role, userId, name, mobile) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, role, user_id, name, mobile, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(token, role, userId || '', name || '', mobile || '', now, expiresAt);
  return { token, role, userId, name, mobile, expiresAt };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function safeJsonParse(str, fallback = []) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════════
// WEB PUSH CRYPTOGRAPHY (RFC 8291 + RFC 8292 VAPID)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_VAPID_PUBLIC_KEY = 'BL2XK2UoL2SiH2v2-lexHyEde_d-cHkQ_aKl9f1kXnlBpaSvK22JxafBpOdpFaI3McnI-5ZRf7vRNgIyrfOTowE';
const DEFAULT_VAPID_PRIVATE_KEY = 'HGYQxTas9Gsl6hstdNkomvdjRnzCxv8pqyNVnyc5NX0';
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@surslot.com';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = Buffer.from(base64, 'base64');
  return new Uint8Array(rawData);
}

function uint8ArrayToUrlBase64(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createVapidHeader(audience, subject, publicKeyStr, privateKeyStr) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };
  const encodedHeader = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = encodedHeader + '.' + encodedPayload;

  const rawPriv = urlBase64ToUint8Array(privateKeyStr);
  const rawPub = urlBase64ToUint8Array(publicKeyStr);

  const jwk = { kty: 'EC', crv: 'P-256', x: uint8ArrayToUrlBase64(rawPub.slice(1, 33)), y: uint8ArrayToUrlBase64(rawPub.slice(33, 65)), d: uint8ArrayToUrlBase64(rawPriv), ext: true };
  const key = await globalThis.crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await globalThis.crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, new TextEncoder().encode(unsignedToken));
  const encodedSig = uint8ArrayToUrlBase64(new Uint8Array(signature));

  return 'vapid t=' + unsignedToken + '.' + encodedSig + ', k=' + publicKeyStr;
}

async function encryptPayload(clientP256dhStr, clientAuthStr, payloadString) {
  const userPublicKey = urlBase64ToUint8Array(clientP256dhStr);
  const userAuth = urlBase64ToUint8Array(clientAuthStr);
  const plaintext = new TextEncoder().encode(payloadString);

  const localKeypair = await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', localKeypair.publicKey));

  const userKey = await globalThis.crypto.subtle.importKey('raw', userPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, localKeypair.privateKey, 256));
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));

  async function hkdf(salt, ikm, info, length) {
    const key = await globalThis.crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
    return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
  }

  const authInfo = new TextEncoder().encode('WebPush: info\0');
  const prkInfo = concatBuffers(authInfo, userPublicKey, localPubRaw);
  const ikm = await hkdf(userAuth, sharedSecret, prkInfo, 32);

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');

  const contentEncryptionKey = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const aesKey = await globalThis.crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, ['encrypt']);
  const paddedPlaintext = new Uint8Array(plaintext.length + 2);
  paddedPlaintext.set(plaintext);
  paddedPlaintext[plaintext.length] = 2;

  const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, paddedPlaintext));
  const rsBuf = new Uint8Array(4);
  new DataView(rsBuf.buffer).setUint32(0, 4096);

  const header = concatBuffers(salt, rsBuf, new Uint8Array([localPubRaw.length]), localPubRaw);
  return concatBuffers(header, encrypted);
}

function concatBuffers(...arrays) {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function sendWebPush(subscription, notificationData, vapidKeys = {}) {
  const pubKey = vapidKeys.publicKey || DEFAULT_VAPID_PUBLIC_KEY;
  const privKey = vapidKeys.privateKey || DEFAULT_VAPID_PRIVATE_KEY;
  const subj = vapidKeys.subject || DEFAULT_VAPID_SUBJECT;

  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = url.protocol + '//' + url.host;

  const vapidHeader = await createVapidHeader(audience, subj, pubKey, privKey);
  const payloadString = JSON.stringify(notificationData);
  const authKey = subscription.keys_auth || (subscription.keys && subscription.keys.auth);
  const p256Key = subscription.keys_p256dh || (subscription.keys && subscription.keys.p256dh);

  if (!authKey || !p256Key) return { ok: false, error: 'Missing keys' };

  const body = await encryptPayload(p256Key, authKey, payloadString);

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'high'
    },
    body: body
  });
}

// Universal Push Dispatcher with DB record
async function dispatchPush(target, notification, meta = {}) {
  let subs = db.prepare('SELECT * FROM push_subscriptions').all();
  if (target && target !== 'all') {
    subs = subs.filter(s => {
      if (typeof target === 'string') return s.role === target;
      if (target.role && s.role !== target.role) return false;
      if (target.id && s.user_id && s.user_id === target.id) return true;
      if (target.mobile) {
        const cleanTgt = normalizePhone(target.mobile);
        const cleanSub = normalizePhone(s.mobile);
        if (cleanTgt && cleanSub && cleanTgt === cleanSub) return true;
      }
      if (target.name && s.name && s.name.toLowerCase().includes(target.name.toLowerCase())) return true;
      if (!target.id && !target.mobile && !target.name) return true;
      return false;
    });
  }

  const notifId = uid();
  db.prepare(`
    INSERT INTO sent_notifications (id, type, target_role, target_id, target_name, date_key, slot_time, title, body, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    notifId,
    meta.type || 'general',
    (typeof target === 'string' ? target : target.role) || 'student',
    (target && target.id) || '',
    (target && target.name) || '',
    meta.dateKey || dateToKey(new Date()),
    meta.slotTime || '',
    notification.title,
    notification.body,
    Date.now()
  );

  if (subs.length === 0) return { sent: 0, total: 0 };

  const results = await Promise.allSettled(subs.map(sub => sendWebPush(sub, notification).catch(e => e)));
  const successful = results.filter(r => r.status === 'fulfilled' && r.value && r.value.ok).length;
  return { sent: successful, total: subs.length };
}

// Automated Scheduled Notification Engine
async function runNotificationEngine(overrideDate) {
  const now = overrideDate || new Date();
  const todayKey = dateToKey(now);
  const currentHour = now.getHours();

  const cfg = getConfig();
  const batches = cfg.batches || DEFAULT_BATCHES;
  const dayOfWeek = now.getDay();

  // 1. 1-HOUR BEFORE CLASS ALERT (For Coach and Student)
  const nextHour = (currentHour + 1) % 24;
  const targetSlotTime = String(nextHour).padStart(2, '0') + ':00';

  const activeBatchesToday = batches.filter(b => b.days.includes(dayOfWeek)).map(b => b.id);
  const students = db.prepare('SELECT * FROM students').all();
  const todayAtt = db.prepare('SELECT * FROM attendance WHERE date_key = ?').all(todayKey);
  const attMap = new Map(todayAtt.map(a => [a.student_id, a.status]));

  for (const st of students) {
    const isScheduledToday = activeBatchesToday.includes(st.batch_id);
    if (!isScheduledToday) continue;

    if (st.time_slot === targetSlotTime) {
      const attStatus = attMap.get(st.id);
      if (attStatus === 'absent') continue;

      // Student 1h Reminder (with Absent confirmation prompt)
      const alreadySentStu = db.prepare('SELECT * FROM sent_notifications WHERE type = ? AND target_id = ? AND date_key = ? AND slot_time = ?')
        .get('student_1h_reminder', st.id, todayKey, targetSlotTime);

      if (!alreadySentStu) {
        await dispatchPush({ role: 'student', id: st.id, mobile: st.mobile, name: st.name }, {
          title: `⏰ Class in 1 Hour (${fmtTime(st.time_slot)})`,
          body: `Your ${safeJsonParse(st.instruments, ['Music'])[0] || 'Music'} class starts at ${fmtTime(st.time_slot)}. Are you coming? If you cannot make it, please mark absent so Sir can open a make-up slot!`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `student-1h-${st.id}-${todayKey}-${st.time_slot}`,
          data: { url: '/?tab=attendance&date=' + todayKey }
        }, { type: 'student_1h_reminder', dateKey: todayKey, slotTime: targetSlotTime });
      }

      // Coach 1h Reminder
      const alreadySentCoach = db.prepare('SELECT * FROM sent_notifications WHERE type = ? AND date_key = ? AND slot_time = ?')
        .get('coach_1h_reminder', todayKey, targetSlotTime);

      if (!alreadySentCoach) {
        await dispatchPush({ role: 'coach' }, {
          title: `⏰ Next Class in 1h: ${st.name} (${fmtTime(st.time_slot)})`,
          body: `${st.name} is coming at ${fmtTime(st.time_slot)} (${st.duration_hours || 1}h, ${safeJsonParse(st.instruments, ['Music']).join(', ')}). Lesson: "${st.current_lesson || 'Active lesson'}"`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `coach-1h-${todayKey}-${st.time_slot}`,
          data: { url: '/?tab=schedule&date=' + todayKey }
        }, { type: 'coach_1h_reminder', dateKey: todayKey, slotTime: targetSlotTime });
      }
    }
  }

  // 2. NIGHT-BEFORE 9:00 PM ALERT FOR 5:00 AM & 6:00 AM CLASSES
  if (currentHour === 21) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dateToKey(tomorrow);
    const tomorrowDay = tomorrow.getDay();
    const tomorrowBatches = batches.filter(b => b.days.includes(tomorrowDay)).map(b => b.id);

    const earlyMorningStudents = students.filter(st => {
      if (!tomorrowBatches.includes(st.batch_id)) return false;
      const h = parseInt(st.time_slot.split(':')[0]);
      return h === 5 || h === 6;
    });

    for (const st of earlyMorningStudents) {
      const alreadySentNight = db.prepare('SELECT * FROM sent_notifications WHERE type = ? AND target_id = ? AND date_key = ?')
        .get('student_night_5am_reminder', st.id, tomorrowKey);

      if (!alreadySentNight) {
        await dispatchPush({ role: 'student', id: st.id, mobile: st.mobile, name: st.name }, {
          title: `🌙 Early Morning Class Tomorrow: ${fmtTime(st.time_slot)}`,
          body: `Good evening ${st.name}! Friendly reminder that you have your music class tomorrow at ${fmtTime(st.time_slot)} with Music Sir. Sleep early and see you in the morning! 🎵`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `student-night-${st.id}-${tomorrowKey}`,
          data: { url: '/?date=' + tomorrowKey }
        }, { type: 'student_night_5am_reminder', dateKey: tomorrowKey, slotTime: st.time_slot });
      }
    }
  }

  // 3. MORNING DAILY DIGEST AT 7:00 AM (07:00)
  if (currentHour === 7) {
    const todayStudents = students.filter(st => {
      if (!activeBatchesToday.includes(st.batch_id)) return false;
      const h = parseInt(st.time_slot.split(':')[0]);
      return h >= 7;
    });

    for (const st of todayStudents) {
      const alreadySentMorning = db.prepare('SELECT * FROM sent_notifications WHERE type = ? AND target_id = ? AND date_key = ?')
        .get('student_morning_alert', st.id, todayKey);

      if (!alreadySentMorning) {
        await dispatchPush({ role: 'student', id: st.id, mobile: st.mobile, name: st.name }, {
          title: `🎼 Music Class Today at ${fmtTime(st.time_slot)}`,
          body: `Good morning ${st.name}! You have your music class today with Music Sir at ${fmtTime(st.time_slot)}. ${st.homework ? 'Homework: "' + st.homework + '"' : 'Keep your notes ready!'}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `student-morning-${st.id}-${todayKey}`,
          data: { url: '/?date=' + todayKey }
        }, { type: 'student_morning_alert', dateKey: todayKey, slotTime: st.time_slot });
      }
    }
  }
}

// Background scheduler timer (runs every 60 seconds)
setInterval(() => {
  runNotificationEngine().catch(e => console.error('Notification engine error:', e));
}, 60000);

// Request Router
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // -------------------------------------------------------------
    // AUTHENTICATION
    // -------------------------------------------------------------
    if (method === 'POST' && (pathname === '/api/auth/coach/login' || pathname === '/api/auth/coach')) {
      const { pin } = await parseBody(req);
      if (!pin) return sendError(res, 400, 'PIN is required');

      const coach = db.prepare('SELECT * FROM coaches LIMIT 1').get();
      if (!coach || !verifyPin(pin, coach.pin_hash, coach.salt)) {
        return sendError(res, 401, 'Invalid Coach PIN');
      }

      const session = createSession('coach', coach.id, coach.name, coach.mobile);
      return sendJson(res, 200, { success: true, user: { role: 'coach', name: coach.name, mobile: coach.mobile }, token: session.token });
    }

    if (method === 'POST' && pathname === '/api/auth/coach/change-pin') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      const { currentPin, newPin } = await parseBody(req);
      if (!currentPin || !newPin || newPin.length < 4) return sendError(res, 400, 'New PIN must be at least 4 digits');

      const coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(session.user_id);
      if (!coach || !verifyPin(currentPin, coach.pin_hash, coach.salt)) return sendError(res, 401, 'Current PIN is incorrect');

      const { hash, salt } = hashPin(newPin);
      db.prepare('UPDATE coaches SET pin_hash = ?, salt = ? WHERE id = ?').run(hash, salt, coach.id);
      return sendJson(res, 200, { success: true, message: 'PIN changed successfully' });
    }

    if (method === 'POST' && pathname === '/api/auth/student/login') {
      const { mobile, name, identifier } = await parseBody(req);
      const query = (identifier || name || mobile || '').trim();

      if (!query) return sendError(res, 400, 'Please enter your Student Name or Mobile Number');

      const cleanPhone = normalizePhone(query);
      let student = null;

      // 1. If 10-digit mobile number, search by mobile
      if (cleanPhone.length >= 10) {
        student = db.prepare('SELECT * FROM students WHERE mobile = ?').get(cleanPhone);
      }

      // 2. Search by Student Name in database (exact or case-insensitive)
      if (!student) {
        student = db.prepare('SELECT * FROM students WHERE LOWER(TRIM(name)) = LOWER(?)').get(query);
      }

      // 3. Search by partial name or group member name
      if (!student) {
        student = db.prepare('SELECT * FROM students WHERE LOWER(name) LIKE ? OR LOWER(group_members) LIKE ?').get(`%${query.toLowerCase()}%`, `%"name":"${query.toLowerCase()}%`);
      }

      let session;
      if (student) {
        session = createSession('student', student.id, student.name, student.mobile);
        return sendJson(res, 200, {
          success: true,
          status: 'enrolled',
          user: {
            role: 'student',
            id: student.id,
            name: student.name,
            mobile: student.mobile,
            batchId: student.batch_id,
            time: student.time_slot,
            durationHours: student.duration_hours || 1,
            endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
            slotType: student.slot_type || 'solo',
            groupMembers: safeJsonParse(student.group_members, []),
            instruments: safeJsonParse(student.instruments, []),
            skillLevel: student.skill_level || 'Beginner',
            currentLesson: student.current_lesson || '',
            homework: student.homework || ''
          },
          token: session.token
        });
      }

      // Check in requests table
      let reqRecord = null;
      if (cleanPhone.length >= 10) {
        reqRecord = db.prepare('SELECT * FROM requests WHERE mobile = ? ORDER BY created_at DESC LIMIT 1').get(cleanPhone);
      }
      if (!reqRecord) {
        reqRecord = db.prepare('SELECT * FROM requests WHERE LOWER(TRIM(name)) = LOWER(?) ORDER BY created_at DESC LIMIT 1').get(query);
      }

      if (reqRecord) {
        session = createSession('student', reqRecord.id, reqRecord.name, reqRecord.mobile);
        return sendJson(res, 200, {
          success: true,
          status: reqRecord.status,
          user: {
            role: 'student',
            id: reqRecord.id,
            name: reqRecord.name,
            mobile: reqRecord.mobile,
            durationHours: reqRecord.duration_hours || 1,
            requestNote: reqRecord.note
          },
          token: session.token
        });
      }

      // New student applicant
      session = createSession('student', null, query, cleanPhone || '');
      return sendJson(res, 200, {
        success: true,
        status: 'new',
        user: { role: 'student', name: query, mobile: cleanPhone || '' },
        token: session.token
      });
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const session = getSessionFromReq(req);
      if (!session) return sendError(res, 401, 'Session invalid or expired');

      if (session.role === 'coach') {
        const coach = db.prepare('SELECT id, name, mobile FROM coaches WHERE id = ?').get(session.user_id);
        return sendJson(res, 200, {
          authenticated: true,
          role: 'coach',
          user: coach || { name: 'Music Sir', mobile: '' }
        });
      } else {
        let student = null;
        if (session.user_id) student = db.prepare('SELECT * FROM students WHERE id = ?').get(session.user_id);
        if (!student && session.mobile) student = db.prepare('SELECT * FROM students WHERE mobile = ?').get(session.mobile);
        if (!student && session.name) student = db.prepare('SELECT * FROM students WHERE LOWER(TRIM(name)) = LOWER(?)').get(session.name);

        if (student) {
          return sendJson(res, 200, {
            authenticated: true,
            role: 'student',
            status: 'enrolled',
            user: {
              id: student.id,
              name: student.name,
              mobile: student.mobile,
              batchId: student.batch_id,
              time: student.time_slot,
              durationHours: student.duration_hours || 1,
              endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
              slotType: student.slot_type || 'solo',
              groupMembers: safeJsonParse(student.group_members, []),
              instruments: safeJsonParse(student.instruments, []),
              skillLevel: student.skill_level || 'Beginner',
              currentLesson: student.current_lesson || '',
              homework: student.homework || ''
            }
          });
        }
        let reqRecord = null;
        if (session.user_id) reqRecord = db.prepare('SELECT * FROM requests WHERE id = ?').get(session.user_id);
        if (!reqRecord && session.mobile) reqRecord = db.prepare('SELECT * FROM requests WHERE mobile = ? ORDER BY created_at DESC LIMIT 1').get(session.mobile);

        if (reqRecord) {
          return sendJson(res, 200, {
            authenticated: true,
            role: 'student',
            status: reqRecord.status,
            user: { id: reqRecord.id, name: reqRecord.name, mobile: reqRecord.mobile, durationHours: reqRecord.duration_hours || 1, requestNote: reqRecord.note }
          });
        }
        return sendJson(res, 200, { authenticated: true, role: 'student', status: 'new', user: { name: session.name, mobile: session.mobile } });
      }
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const session = getSessionFromReq(req);
      if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(session.token);
      return sendJson(res, 200, { success: true, message: 'Logged out' });
    }

    // -------------------------------------------------------------
    // SCHEDULE & MAKE-UP SLOTS (5 AM - 11 PM + MULTI-HOUR SPAN)
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/schedule') {
      const dateStr = parsedUrl.searchParams.get('date');
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return sendError(res, 400, 'Valid date parameter (YYYY-MM-DD) is required');
      }

      const cfg = getConfig();
      const [y, m, d] = dateStr.split('-').map(Number);
      const targetDate = new Date(y, m - 1, d);
      const weekday = targetDate.getDay();

      const activeBatches = (cfg.batches || []).filter(b => b.days && b.days.includes(weekday));
      const activeBatchIds = activeBatches.map(b => b.id);

      const regulars = activeBatchIds.length > 0
        ? db.prepare(`SELECT id, name, mobile, batch_id as batchId, time_slot as time, duration_hours as durationHours, slot_type as slotType, group_members as groupMembers, instruments, current_lesson as currentLesson, 'regular' as type FROM students WHERE batch_id IN (${activeBatchIds.map(() => '?').join(',')})`).all(...activeBatchIds)
        : [];

      const occasional = db.prepare(`SELECT id, name, mobile, time_slot as time, duration_hours as durationHours, slot_type as slotType, group_members as groupMembers, instruments, 'occasional' as type FROM bookings WHERE date_key = ?`).all(dateStr);

      const attRows = db.prepare('SELECT student_id, status, member_statuses FROM attendance WHERE date_key = ?').all(dateStr);
      const attendanceMap = {};
      const memberAttMap = {};
      for (const a of attRows) {
        attendanceMap[a.student_id] = a.status;
        memberAttMap[a.student_id] = safeJsonParse(a.member_statuses, {});
      }

      // Fetch make-up slots for this date
      const makeups = db.prepare('SELECT * FROM makeup_slots WHERE date_key = ?').all(dateStr);
      const makeupMap = {};
      for (const m of makeups) {
        makeupMap[m.time_slot] = m;
      }

      const slots = (cfg.slots || DEFAULT_HOURLY_SLOTS).slice().sort();
      const combined = [...regulars, ...occasional];

      // Build occupied hour mapping
      const occupiedMap = {};
      for (const item of combined) {
        const dur = item.durationHours || 1;
        const occSlots = getOccupiedSlotList(item.time, dur);
        occSlots.forEach((slotTime, idx) => {
          occupiedMap[slotTime] = {
            item,
            isPrimary: idx === 0,
            hourIndex: idx + 1,
            totalHours: dur,
            primarySlot: item.time,
            endTime: addHoursToTime(item.time, dur)
          };
        });
      }

      const slotList = slots.map(time => {
        const occ = occupiedMap[time];
        const mk = makeupMap[time];

        if (occ) {
          const item = occ.item;
          const isAbsent = attendanceMap[item.id] === 'absent';
          return {
            slotTime: time,
            free: false,
            id: item.id,
            name: item.name,
            mobile: item.mobile,
            type: item.type,
            batchId: item.batchId,
            slotType: item.slotType || 'solo',
            durationHours: occ.totalHours,
            endTime: occ.endTime,
            isPrimary: occ.isPrimary,
            hourIndex: occ.hourIndex,
            primarySlotTime: occ.primarySlot,
            groupMembers: safeJsonParse(item.groupMembers, []),
            instruments: safeJsonParse(item.instruments, []),
            currentLesson: item.currentLesson || '',
            status: attendanceMap[item.id] || null,
            memberStatuses: memberAttMap[item.id] || {},
            makeup: isAbsent ? (mk || { status: 'open', vacated_by_name: item.name }) : null
          };
        }

        // Slot has no regular booking, check if a makeup class is booked here
        if (mk && mk.status === 'claimed') {
          return {
            slotTime: time,
            free: false,
            id: mk.id,
            name: mk.claimed_by_name + ' (Make-up Class)',
            mobile: mk.claimed_by_mobile,
            type: 'makeup',
            slotType: 'solo',
            durationHours: mk.duration_hours || 1,
            endTime: addHoursToTime(time, mk.duration_hours || 1),
            isPrimary: true,
            hourIndex: 1,
            instruments: [],
            status: attendanceMap[mk.id] || null,
            makeup: mk
          };
        }

        return { slotTime: time, free: true };
      });

      return sendJson(res, 200, {
        date: dateStr,
        weekday,
        activeBatches,
        slots: slotList,
        coachMobile: cfg.coachMobile,
        template: cfg.template
      });
    }

    // GET /api/makeup-slots (List available compensation slots)
    if (method === 'GET' && pathname === '/api/makeup-slots') {
      const today = dateToKey(new Date());
      const slots = db.prepare(`
        SELECT * FROM makeup_slots 
        WHERE date_key >= ? AND status = 'open' 
        ORDER BY date_key ASC, time_slot ASC 
        LIMIT 25
      `).all(today);
      return sendJson(res, 200, { makeupSlots: slots });
    }

    // POST /api/makeup-slots/claim (Claim a make-up slot)
    if (method === 'POST' && pathname === '/api/makeup-slots/claim') {
      const session = getSessionFromReq(req);
      const { makeupId, studentId, studentName, studentMobile } = await parseBody(req);
      const sId = studentId || (session ? session.user_id : '');
      const sName = studentName || (session ? session.name : '');
      const sMobile = studentMobile || (session ? session.mobile : '');

      if (!makeupId || !sName) return sendError(res, 400, 'Make-up slot ID and student name are required');

      const mk = db.prepare('SELECT * FROM makeup_slots WHERE id = ?').get(makeupId);
      if (!mk || mk.status !== 'open') return sendError(res, 409, 'This make-up slot is no longer available');

      db.prepare(`
        UPDATE makeup_slots SET 
          claimed_by_id = ?, 
          claimed_by_name = ?, 
          claimed_by_mobile = ?, 
          status = 'claimed' 
        WHERE id = ?
      `).run(sId, sName, sMobile, makeupId);

      // 🔔 Instant Push Alert to Music Sir
      dispatchPush({ role: 'coach' }, {
        title: `🔄 Make-up Slot Claimed: ${sName}`,
        body: `${sName} claimed the make-up slot on ${mk.date_key} at ${fmtTime(mk.time_slot)}.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `makeup-claim-${makeupId}`,
        data: { url: '/?tab=schedule&date=' + mk.date_key }
      }, { type: 'makeup_claimed', dateKey: mk.date_key, slotTime: mk.time_slot }).catch(() => {});

      return sendJson(res, 200, { success: true, message: `Make-up class reserved for ${sName} on ${mk.date_key} at ${mk.time_slot}!` });
    }

    // POST /api/bookings (Walk-in booking)
    if (method === 'POST' && pathname === '/api/bookings') {
      const { name, mobile, date, time, durationHours, slotType, groupMembers, instruments } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;

      if (!name || cleanPhone.length < 10 || !date || !time) {
        return sendError(res, 400, 'Name, 10-digit mobile, date, and time slot are required');
      }

      // Check slot conflicts for all spanned hours
      const wantedSlots = getOccupiedSlotList(time, dur);
      const existingBookings = db.prepare('SELECT time_slot, duration_hours, name FROM bookings WHERE date_key = ?').all(date);
      for (const eb of existingBookings) {
        const ebSlots = getOccupiedSlotList(eb.time_slot, eb.duration_hours || 1);
        const overlap = wantedSlots.find(s => ebSlots.includes(s));
        if (overlap) {
          return sendError(res, 409, `Conflict: ${eb.name} is already booked at ${overlap}`);
        }
      }

      const id = uid();
      db.prepare('INSERT INTO bookings (id, name, mobile, date_key, time_slot, duration_hours, slot_type, group_members, instruments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, name.trim(), cleanPhone, date, time, dur, slotType || 'solo', JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), Date.now());

      // 🔔 Instant Push Alert to Music Sir
      dispatchPush({ role: 'coach' }, {
        title: `⚡ Flexible Slot Booked: ${name.trim()}`,
        body: `${name.trim()} reserved a ${dur}h slot on ${date} at ${fmtTime(time)}.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `booking-alert-${id}`,
        data: { url: '/?tab=schedule&date=' + date }
      }, { type: 'flexible_booking_direct', dateKey: date, slotTime: time }).catch(() => {});

      return sendJson(res, 201, { success: true, booking: { id, name: name.trim(), mobile: cleanPhone, date, time, durationHours: dur } });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/bookings/')) {
      const id = pathname.slice('/api/bookings/'.length);
      db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Booking cancelled' });
    }

    // -------------------------------------------------------------
    // ATTENDANCE & AUTOMATIC MAKE-UP SLOT CREATION
    // -------------------------------------------------------------
    if (method === 'POST' && pathname === '/api/attendance') {
      const { date, studentId, status, memberStatuses } = await parseBody(req);
      if (!date || !studentId) return sendError(res, 400, 'Date and studentId are required');

      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);

      if (status === 'present' || status === 'absent' || status === 'partial') {
        db.prepare('INSERT INTO attendance (date_key, student_id, status, member_statuses, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date_key, student_id) DO UPDATE SET status = excluded.status, member_statuses = excluded.member_statuses, updated_at = excluded.updated_at')
          .run(date, studentId, status, JSON.stringify(memberStatuses || {}), Date.now());

        // Smart Make-up Slot Generation (full absent creates open slot)
        if (status === 'absent' && student) {
          const existingMk = db.prepare('SELECT * FROM makeup_slots WHERE date_key = ? AND time_slot = ?').get(date, student.time_slot);
          if (!existingMk) {
            db.prepare(`
              INSERT INTO makeup_slots (id, date_key, time_slot, duration_hours, vacated_by_id, vacated_by_name, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
            `).run(uid(), date, student.time_slot, student.duration_hours || 1, student.id, student.name, Date.now());
          }

          // 🔔 Instant Push Alert to Music Sir
          dispatchPush({ role: 'coach' }, {
            title: `⚠️ Student Absent: ${student.name}`,
            body: `${student.name} marked absent for today's ${fmtTime(student.time_slot)} class. The slot is now open for make-up!`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `absent-alert-${student.id}-${date}`,
            data: { url: '/?tab=schedule&date=' + date }
          }, { type: 'student_absent_alert', dateKey: date, slotTime: student.time_slot }).catch(() => {});
        } else if ((status === 'present' || status === 'partial') && student) {
          db.prepare("DELETE FROM makeup_slots WHERE date_key = ? AND time_slot = ? AND status = 'open'").run(date, student.time_slot);
        }
      } else {
        db.prepare('DELETE FROM attendance WHERE date_key = ? AND student_id = ?').run(date, studentId);
        if (student) {
          db.prepare("DELETE FROM makeup_slots WHERE date_key = ? AND time_slot = ? AND status = 'open'").run(date, student.time_slot);
        }
      }

      return sendJson(res, 200, { success: true, status: status || null, memberStatuses: memberStatuses || {} });
    }

    // -------------------------------------------------------------
    // STUDENT PERFORMANCE
    // -------------------------------------------------------------
    if (method === 'GET' && pathname.startsWith('/api/students/') && pathname.endsWith('/performance')) {
      const parts = pathname.split('/');
      const studentId = parts[3];

      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
      if (!student) return sendError(res, 404, 'Student not found');

      const logs = db.prepare('SELECT * FROM performance_logs WHERE student_id = ? ORDER BY date_key DESC, created_at DESC').all(studentId);

      return sendJson(res, 200, {
        student: {
          id: student.id,
          name: student.name,
          mobile: student.mobile,
          durationHours: student.duration_hours || 1,
          endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
          slotType: student.slot_type || 'solo',
          groupMembers: safeJsonParse(student.group_members, []),
          instruments: safeJsonParse(student.instruments, []),
          skillLevel: student.skill_level || 'Beginner',
          currentLesson: student.current_lesson || '',
          homework: student.homework || ''
        },
        logs
      });
    }

    if (method === 'POST' && pathname.startsWith('/api/students/') && pathname.endsWith('/performance')) {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      const parts = pathname.split('/');
      const studentId = parts[3];

      const { date, memberName, ratingSur, ratingTaal, ratingOverall, remarks, homework, currentLesson, skillLevel } = await parseBody(req);
      const dateKeyStr = date || dateToKey(new Date());

      const logId = uid();
      db.prepare(`
        INSERT INTO performance_logs (id, student_id, member_name, date_key, rating_sur, rating_taal, rating_overall, remarks, homework, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(logId, studentId, memberName || '', dateKeyStr, ratingSur || 5, ratingTaal || 5, ratingOverall || 5, (remarks || '').trim(), (homework || '').trim(), Date.now());

      if (currentLesson !== undefined || homework !== undefined || skillLevel !== undefined) {
        db.prepare('UPDATE students SET current_lesson = COALESCE(?, current_lesson), homework = COALESCE(?, homework), skill_level = COALESCE(?, skill_level) WHERE id = ?')
          .run(currentLesson !== undefined ? currentLesson.trim() : null, homework !== undefined ? homework.trim() : null, skillLevel || null, studentId);
      }

      // 🔔 Instant Push Alert to Student
      const stObj = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
      if (stObj) {
        dispatchPush({ role: 'student', id: stObj.id, mobile: stObj.mobile, name: stObj.name }, {
          title: `⭐ New Music Class Feedback (${ratingOverall || 5} Stars)`,
          body: `Sir evaluated your class: "${(remarks || '').trim() || 'Good practice!'}". ${homework ? 'Homework: "' + homework.trim() + '"' : ''}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `perf-alert-${studentId}-${logId}`,
          data: { url: '/?tab=attendance' }
        }, { type: 'performance_evaluation', dateKey: dateKeyStr }).catch(() => {});
      }

      return sendJson(res, 201, { success: true, message: 'Performance evaluation saved', logId });
    }

    // Attendance + Performance Report
    if (method === 'GET' && pathname.startsWith('/api/students/') && pathname.endsWith('/attendance-report')) {
      const parts = pathname.split('/');
      const studentId = parts[3];

      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
      if (!student) return sendError(res, 404, 'Student not found');

      const session = getSessionFromReq(req);
      if (session && session.role === 'student' && session.user_id !== student.id && session.mobile !== student.mobile) {
        return sendError(res, 403, 'You can only view your own report');
      }

      const cfg = getConfig();
      const batch = (cfg.batches || []).find(b => b.id === student.batch_id);
      const batchDays = batch ? batch.days : [1, 3, 5];

      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const fromStr = parsedUrl.searchParams.get('from') || dateToKey(defaultFrom);
      const toStr = parsedUrl.searchParams.get('to') || dateToKey(defaultTo);

      const [fy, fm, fd] = fromStr.split('-').map(Number);
      const [ty, tm, td] = toStr.split('-').map(Number);
      const startDate = new Date(fy, fm - 1, fd);
      const endDate = new Date(ty, tm - 1, td);

      const attRecords = db.prepare('SELECT date_key, status, member_statuses, updated_at FROM attendance WHERE student_id = ?').all(student.id);
      const attMap = {};
      const memberAttMap = {};
      for (const a of attRecords) {
        attMap[a.date_key] = a.status;
        memberAttMap[a.date_key] = safeJsonParse(a.member_statuses, {});
      }

      const perfLogs = db.prepare('SELECT * FROM performance_logs WHERE student_id = ? AND date_key BETWEEN ? AND ? ORDER BY date_key ASC').all(student.id, fromStr, toStr);

      const classes = [];
      const cur = new Date(startDate);
      while (cur <= endDate) {
        const wkday = cur.getDay();
        if (batchDays.includes(wkday)) {
          const dk = dateToKey(cur);
          const st = attMap[dk] || 'unmarked';
          const pLog = perfLogs.find(p => p.date_key === dk);
          classes.push({
            date: dk,
            weekday: wkday,
            dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wkday],
            time: student.time_slot,
            durationHours: student.duration_hours || 1,
            endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
            status: st,
            memberStatuses: memberAttMap[dk] || {},
            performance: pLog ? {
              ratingSur: pLog.rating_sur,
              ratingTaal: pLog.rating_taal,
              ratingOverall: pLog.rating_overall,
              remarks: pLog.remarks,
              homework: pLog.homework
            } : null
          });
        }
        cur.setDate(cur.getDate() + 1);
      }

      const totalClasses = classes.length;
      const presentCount = classes.filter(c => c.status === 'present').length;
      const partialCount = classes.filter(c => c.status === 'partial').length;
      const absentCount = classes.filter(c => c.status === 'absent').length;
      const unmarkedCount = classes.filter(c => c.status === 'unmarked').length;
      const attendancePct = totalClasses > 0 ? Math.round(((presentCount + (partialCount * 0.75)) / totalClasses) * 100) : 0;

      const ratedLogs = perfLogs.filter(p => p.rating_overall > 0);
      const avgRating = ratedLogs.length > 0 ? (ratedLogs.reduce((acc, p) => acc + p.rating_overall, 0) / ratedLogs.length).toFixed(1) : null;

      return sendJson(res, 200, {
        student: {
          id: student.id,
          name: student.name,
          mobile: student.mobile,
          batchId: student.batch_id,
          batchName: batch ? batch.name : 'Regular Batch',
          batchSub: batch ? batch.sub : '',
          time: student.time_slot,
          durationHours: student.duration_hours || 1,
          endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
          slotType: student.slot_type || 'solo',
          groupMembers: safeJsonParse(student.group_members, []),
          instruments: safeJsonParse(student.instruments, []),
          skillLevel: student.skill_level || 'Beginner',
          currentLesson: student.current_lesson || '',
          homework: student.homework || ''
        },
        range: { from: fromStr, to: toStr },
        summary: {
          totalClasses,
          presentCount,
          absentCount,
          unmarkedCount,
          attendancePct,
          avgRating,
          ratedClassesCount: ratedLogs.length
        },
        classes,
        perfLogs
      });
    }

    // -------------------------------------------------------------
    // STUDENTS (ROSTER)
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/students') {
      const students = db.prepare('SELECT id, name, mobile, batch_id as batchId, time_slot as time, duration_hours as durationHours, slot_type as slotType, student_type as studentType, group_id as groupId, group_name as groupName, group_members as groupMembers, instruments, skill_level as skillLevel, current_lesson as currentLesson, homework, created_at as createdAt FROM students').all();

      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const startKey = dateToKey(firstDay);
      const endKey = dateToKey(lastDay);
      const monthName = today.toLocaleString('default', { month: 'long' });

      // Aggregate monthly stats for this student
      const attRecords = db.prepare(`
        SELECT student_id, status FROM attendance
        WHERE date_key >= ? AND date_key <= ?
      `).all(startKey, endKey);

      const statsMap = {};
      for (const a of attRecords) {
        if (!statsMap[a.student_id]) statsMap[a.student_id] = { conducted: 0, present: 0 };
        statsMap[a.student_id].conducted++;
        if (a.status === 'present') statsMap[a.student_id].present++;
      }
      for (const sId in statsMap) {
        const c = statsMap[sId].conducted;
        const p = statsMap[sId].present;
        statsMap[sId].pct = c > 0 ? Math.round((p / c) * 100) : null;
      }

      const cfg = getConfig();
      const batchList = cfg.batches || DEFAULT_BATCHES;

      const enriched = students.map(st => {
        const batch = batchList.find(b => b.id === st.batchId);
        const batchDays = batch ? batch.days : [1, 3, 5];
        
        // Count total scheduled batch classes in this calendar month
        let totalMonthlyScheduled = 0;
        const curD = new Date(firstDay);
        while (curD <= lastDay) {
          if (batchDays.includes(curD.getDay())) {
            totalMonthlyScheduled++;
          }
          curD.setDate(curD.getDate() + 1);
        }

        const stStat = statsMap[st.id] || { conducted: 0, present: 0, pct: null };

        return {
          ...st,
          studentType: st.studentType || 'regular',
          durationHours: st.durationHours || 1,
          endTime: addHoursToTime(st.time, st.durationHours || 1),
          groupMembers: safeJsonParse(st.groupMembers, []),
          instruments: safeJsonParse(st.instruments, []),
          attendance: {
            month: monthName,
            conducted: stStat.conducted,
            present: stStat.present,
            totalScheduled: totalMonthlyScheduled,
            pct: stStat.pct
          }
        };
      });

      return sendJson(res, 200, { students: enriched });
    }

    if (method === 'POST' && pathname === '/api/students') {
      const { name, mobile, batchId, time, durationHours, slotType, studentType, groupName, groupMembers, instruments, skillLevel, currentLesson } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;
      const stType = slotType || 'solo';
      const sType = studentType || 'regular';

      if (!name || cleanPhone.length < 10 || !batchId || !time) {
        return sendError(res, 400, 'Name, 10-digit mobile, batch, and time slot are required');
      }

      // Check slot conflicts for all spanned hours in this batch
      const wantedSlots = getOccupiedSlotList(time, dur);
      const existingStudents = db.prepare('SELECT name, time_slot, duration_hours FROM students WHERE batch_id = ?').all(batchId);
      for (const es of existingStudents) {
        const esSlots = getOccupiedSlotList(es.time_slot, es.duration_hours || 1);
        const overlap = wantedSlots.find(s => esSlots.includes(s));
        if (overlap) {
          return sendError(res, 409, `Slot conflict: ${es.name} is already assigned at ${overlap}`);
        }
      }

      const isGroup = (stType === 'sibling_duo' || stType === 'sibling_trio' || stType === 'group');
      const membersList = (isGroup && Array.isArray(groupMembers) && groupMembers.length > 0) ? groupMembers : null;

      if (membersList) {
        const groupId = uid();
        const finalGroupName = (groupName || name + ' Group').trim();
        const enrichedMembers = membersList.map(m => ({
          id: uid(),
          name: (m.name || '').trim(),
          mobile: normalizePhone(m.mobile || cleanPhone),
          instruments: Array.isArray(m.instruments) ? m.instruments : (instruments || [])
        }));

        const insertStmt = db.prepare(`
          INSERT INTO students (id, name, mobile, batch_id, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, current_lesson, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const m of enrichedMembers) {
          insertStmt.run(
            m.id,
            m.name,
            m.mobile,
            batchId,
            time,
            dur,
            stType,
            sType,
            groupId,
            finalGroupName,
            JSON.stringify(enrichedMembers),
            JSON.stringify(m.instruments),
            skillLevel || 'Beginner',
            (currentLesson || '').trim(),
            Date.now()
          );
        }

        return sendJson(res, 201, { success: true, message: `Enrolled ${finalGroupName} (${enrichedMembers.length} siblings) into ${batchId} at ${fmtTime(time)}`, student: { id: enrichedMembers[0].id, name: finalGroupName, mobile: cleanPhone, batchId, time, durationHours: dur } });
      } else {
        const id = uid();
        db.prepare(`
          INSERT INTO students (id, name, mobile, batch_id, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, current_lesson, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name.trim(), cleanPhone, batchId, time, dur, stType, sType, null, null, JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), skillLevel || 'Beginner', (currentLesson || '').trim(), Date.now());

        return sendJson(res, 201, { success: true, student: { id, name: name.trim(), mobile: cleanPhone, batchId, time, durationHours: dur } });
      }
    }

    if (method === 'PUT' && pathname.startsWith('/api/students/')) {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      const id = pathname.slice('/api/students/'.length);
      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
      if (!student) return sendError(res, 404, 'Student not found');

      const { name, mobile, batchId, time, durationHours, slotType, studentType, groupMembers, instruments, skillLevel, currentLesson, homework } = await parseBody(req);
      
      const newBatchId = batchId || student.batch_id;
      const newTime = time || student.time_slot;
      const newDuration = parseInt(durationHours) || student.duration_hours || 1;
      const cleanPhone = mobile ? normalizePhone(mobile) : student.mobile;
      const newName = name ? name.trim() : student.name;
      const newStudentType = studentType || student.student_type || 'regular';

      // Check slot conflicts for all spanned hours (excluding this student's current record)
      const wantedSlots = getOccupiedSlotList(newTime, newDuration);
      const otherStudents = db.prepare('SELECT id, name, time_slot, duration_hours FROM students WHERE batch_id = ? AND id != ?').all(newBatchId, id);
      for (const os of otherStudents) {
        const osSlots = getOccupiedSlotList(os.time_slot, os.duration_hours || 1);
        const overlap = wantedSlots.find(s => osSlots.includes(s));
        if (overlap) {
          return sendError(res, 409, `Slot conflict: ${os.name} is already assigned at ${overlap}`);
        }
      }

      db.prepare(`
        UPDATE students SET
          name = ?,
          mobile = ?,
          batch_id = ?,
          time_slot = ?,
          duration_hours = ?,
          slot_type = COALESCE(?, slot_type),
          student_type = COALESCE(?, student_type),
          group_members = COALESCE(?, group_members),
          instruments = COALESCE(?, instruments),
          skill_level = COALESCE(?, skill_level),
          current_lesson = COALESCE(?, current_lesson),
          homework = COALESCE(?, homework)
        WHERE id = ?
      `).run(
        newName,
        cleanPhone,
        newBatchId,
        newTime,
        newDuration,
        slotType || null,
        newStudentType,
        groupMembers ? JSON.stringify(groupMembers) : null,
        instruments ? JSON.stringify(instruments) : null,
        skillLevel || null,
        currentLesson !== undefined ? currentLesson.trim() : null,
        homework !== undefined ? homework.trim() : null,
        id
      );

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'timing_change',
        title: `🕒 Student Profile Updated: ${newName}`,
        message: `Updated profile for ${newName} (${newStudentType === 'flexible' ? 'Flexible' : 'Regular Batch'}) in ${newBatchId} at ${fmtTime(newTime)} (${newDuration}h).`,
        details: `Batch: ${newBatchId} · Time: ${newTime} · Type: ${newStudentType}`
      });

      return sendJson(res, 200, { success: true, message: `Profile updated for ${newName}` });
    }

    if (method === 'POST' && pathname === '/api/students/merge-group') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      const { studentIds, batchId, time, durationHours, slotType, groupName } = await parseBody(req);
      if (!studentIds || !Array.isArray(studentIds) || studentIds.length < 2) {
        return sendError(res, 400, 'Please select at least 2 students to merge into a group');
      }
      if (!batchId || !time) return sendError(res, 400, 'Batch ID and time slot are required');

      const dur = parseInt(durationHours) || studentIds.length;
      const stType = slotType || (studentIds.length === 2 ? 'sibling_duo' : 'sibling_trio');

      // Fetch all students to be merged
      const placeholders = studentIds.map(() => '?').join(',');
      const studentsToMerge = db.prepare(`SELECT * FROM students WHERE id IN (${placeholders})`).all(...studentIds);
      if (studentsToMerge.length < 2) return sendError(res, 404, 'Selected students not found');

      // Check slot conflict for merged slot (excluding the students themselves)
      const wantedSlots = getOccupiedSlotList(time, dur);
      const otherStudents = db.prepare(`SELECT id, name, time_slot, duration_hours FROM students WHERE batch_id = ? AND id NOT IN (${placeholders})`).all(batchId, ...studentIds);
      for (const os of otherStudents) {
        const osSlots = getOccupiedSlotList(os.time_slot, os.duration_hours || 1);
        const overlap = wantedSlots.find(s => osSlots.includes(s));
        if (overlap) {
          return sendError(res, 409, `Slot conflict: ${os.name} is already assigned at ${overlap}`);
        }
      }

      const groupId = uid();
      const combinedName = groupName || studentsToMerge.map(s => s.name).join(' & ');
      const groupMembers = studentsToMerge.map(s => ({
        id: s.id,
        name: s.name,
        mobile: s.mobile,
        instruments: safeJsonParse(s.instruments, [])
      }));

      const updateStmt = db.prepare(`
        UPDATE students SET
          batch_id = ?,
          time_slot = ?,
          duration_hours = ?,
          slot_type = ?,
          group_id = ?,
          group_name = ?,
          group_members = ?
        WHERE id = ?
      `);

      for (const s of studentsToMerge) {
        updateStmt.run(batchId, time, dur, stType, groupId, combinedName, JSON.stringify(groupMembers), s.id);

        // Send Push Alert to student
        dispatchPush({ role: 'student', mobile: s.mobile }, {
          title: '🔗 Sibling Group Combined & Slot Confirmed!',
          body: `Hi ${s.name}! Music Sir has grouped you with ${studentsToMerge.filter(x => x.id !== s.id).map(x => x.name).join(', ')}. Your confirmed class slot is now ${fmtTime(time)} (${dur}h) in ${batchId}.`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `merge-${s.id}`,
          data: { url: '/' }
        }, { type: 'group_merged', dateKey: dateToKey(new Date()), slotTime: time }).catch(() => {});
      }

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'merge_group',
        title: `🔗 Group Created: ${combinedName}`,
        message: `Music Sir merged ${studentsToMerge.map(s=>s.name).join(' & ')} into a ${dur}-Hour group class in ${batchId} at ${fmtTime(time)}. Final timings assigned to all members.`,
        details: `Members: ${studentsToMerge.map(s=>s.name).join(', ')} · Batch: ${batchId} · Time: ${time}`
      });

      return sendJson(res, 200, {
        success: true,
        message: `Successfully merged ${studentNames} into ${batchObj.name} at ${fmtTime(time)} (${dur}h)!`,
        groupMembers
      });
    }

    if (method === 'GET' && pathname === '/api/activity-logs') {
      const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 60').all();
      const unreadRow = db.prepare('SELECT COUNT(*) as cnt FROM activity_logs WHERE is_read = 0').get();
      return sendJson(res, 200, { success: true, logs, unreadCount: unreadRow ? unreadRow.cnt : 0 });
    }

    if (method === 'POST' && pathname === '/api/activity-logs/read') {
      db.exec('UPDATE activity_logs SET is_read = 1');
      return sendJson(res, 200, { success: true });
    }

    if (method === 'DELETE' && pathname === '/api/activity-logs') {
      db.exec('DELETE FROM activity_logs');
      return sendJson(res, 200, { success: true, message: 'All activity notifications cleared' });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/activity-logs/')) {
      const id = pathname.slice('/api/activity-logs/'.length);
      db.prepare('DELETE FROM activity_logs WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Notification removed' });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/students/')) {
      const id = pathname.slice('/api/students/'.length);
      const student = db.prepare('SELECT name FROM students WHERE id = ?').get(id);
      db.prepare('DELETE FROM students WHERE id = ?').run(id);
      db.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
      db.prepare('DELETE FROM performance_logs WHERE student_id = ?').run(id);
      db.prepare('DELETE FROM makeup_slots WHERE vacated_by_id = ?').run(id);

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'student_removed',
        title: `Student Removed: ${student ? student.name : id}`,
        message: `Removed ${student ? student.name : id} from roster. Slot is now free.`,
        details: id
      });

      return sendJson(res, 200, { success: true, message: 'Student removed from roster' });
    }

    // -------------------------------------------------------------
    // JOIN REQUESTS
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/requests') {
      const raw = db.prepare("SELECT id, name, mobile, note, duration_hours as durationHours, slot_type as slotType, group_name as groupName, group_members as groupMembers, instruments, status, created_at as createdAt FROM requests WHERE status = 'pending' ORDER BY created_at DESC").all();
      const requests = raw.map(r => ({
        ...r,
        durationHours: r.durationHours || 1,
        groupMembers: safeJsonParse(r.groupMembers, []),
        instruments: safeJsonParse(r.instruments, [])
      }));
      return sendJson(res, 200, { requests });
    }

    if (method === 'POST' && pathname === '/api/requests') {
      const { name, mobile, note, durationHours, slotType, groupName, groupMembers, instruments } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;

      if (!name || cleanPhone.length < 10) return sendError(res, 400, 'Name and valid 10-digit mobile number are required');

      const id = uid();
      db.prepare(`
        INSERT INTO requests (id, name, mobile, note, duration_hours, slot_type, group_name, group_members, instruments, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name.trim(), cleanPhone, (note || '').trim(), dur, slotType || 'solo', (groupName || '').trim(), JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), 'pending', Date.now());

      logActivity({
        actorType: 'student',
        actorName: name.trim(),
        actorMobile: cleanPhone,
        actionType: 'enroll_request',
        title: `🎓 New Student Enrollment: ${name.trim()}`,
        message: `${name.trim()} (${cleanPhone}) submitted enrollment for ${dur}h class (${(instruments && instruments.length) ? instruments.join(', ') : 'Music'}). Awaiting Coach Slot Assignment.`,
        details: note || ''
      });

      // 🔔 Instant Push Alert to Music Sir
      dispatchPush({ role: 'coach' }, {
        title: `⚡ New Enrollment Request: ${name.trim()}`,
        body: `${name.trim()} (${cleanPhone}) submitted an enrollment application. Tap to review and assign slot!`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `new-request-${id}`,
        data: { url: '/?tab=requests' }
      }, { type: 'flexible_booking_request', dateKey: dateToKey(new Date()) }).catch(() => {});

      return sendJson(res, 201, { success: true, request: { id, name: name.trim(), mobile: cleanPhone, durationHours: dur, status: 'pending' } });
    }

    if (method === 'POST' && pathname.startsWith('/api/requests/') && pathname.endsWith('/approve')) {
      const parts = pathname.split('/');
      const id = parts[3];
      const { batchId, time, durationHours, slotType, groupName, groupMembers, instruments, skillLevel } = await parseBody(req);

      if (!batchId || !time) return sendError(res, 400, 'Batch ID and time slot are required for approval');

      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
      if (!request) return sendError(res, 404, 'Request not found');

      const dur = parseInt(durationHours) || request.duration_hours || 1;
      const stType = slotType || request.slot_type || 'solo';
      const parsedMembers = (groupMembers && Array.isArray(groupMembers) && groupMembers.length > 0)
        ? groupMembers
        : safeJsonParse(request.group_members, []);

      // Check slot conflicts for all spanned hours in this batch
      const wantedSlots = getOccupiedSlotList(time, dur);
      const existingStudents = db.prepare('SELECT name, time_slot, duration_hours FROM students WHERE batch_id = ?').all(batchId);
      for (const es of existingStudents) {
        const esSlots = getOccupiedSlotList(es.time_slot, es.duration_hours || 1);
        const overlap = wantedSlots.find(s => esSlots.includes(s));
        if (overlap) {
          return sendError(res, 409, `Slot conflict: ${es.name} is already assigned at ${overlap}`);
        }
      }

      const isGroup = (stType === 'sibling_duo' || stType === 'sibling_trio' || stType === 'group');
      const finalGroupName = (groupName || request.group_name || (request.name + ' Group')).trim();

      if (isGroup && parsedMembers && parsedMembers.length > 0) {
        const groupId = uid();
        const enrichedMembers = parsedMembers.map(m => ({
          id: uid(),
          name: (m.name || '').trim(),
          mobile: normalizePhone(m.mobile || request.mobile),
          instruments: Array.isArray(m.instruments) ? m.instruments : safeJsonParse(request.instruments, [])
        }));

        const insertStmt = db.prepare(`
          INSERT INTO students (id, name, mobile, batch_id, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const m of enrichedMembers) {
          insertStmt.run(
            m.id,
            m.name,
            m.mobile,
            batchId,
            time,
            dur,
            stType,
            'regular',
            groupId,
            finalGroupName,
            JSON.stringify(enrichedMembers),
            JSON.stringify(m.instruments),
            skillLevel || 'Beginner',
            Date.now()
          );

          dispatchPush({ role: 'student', mobile: m.mobile }, {
            title: '🎉 Music Class Slot Confirmed!',
            body: `Hi ${m.name}! Music Sir has approved and confirmed your ${finalGroupName} class timing at ${fmtTime(time)} (${dur}h).`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `approved-${m.id}`,
            data: { url: '/' }
          }, { type: 'slot_approved', dateKey: dateToKey(new Date()), slotTime: time }).catch(() => {});
        }
      } else {
        const studentId = uid();
        db.prepare(`
          INSERT INTO students (id, name, mobile, batch_id, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          studentId,
          request.name,
          request.mobile,
          batchId,
          time,
          dur,
          stType,
          'regular',
          null,
          null,
          JSON.stringify(parsedMembers),
          instruments ? JSON.stringify(instruments) : request.instruments,
          skillLevel || 'Beginner',
          Date.now()
        );

        dispatchPush({ role: 'student', mobile: request.mobile }, {
          title: '🎉 Music Class Slot Confirmed!',
          body: `Hi ${request.name}! Music Sir has approved and confirmed your class timing at ${fmtTime(time)} (${dur}h).`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `approved-${studentId}`,
          data: { url: '/' }
        }, { type: 'slot_approved', dateKey: dateToKey(new Date()), slotTime: time }).catch(() => {});
      }

      db.prepare('DELETE FROM requests WHERE id = ?').run(id);

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'request_approved',
        title: `✓ Request Approved: ${request.name}`,
        message: `Approved ${request.name} into ${batchId} at ${fmtTime(time)} (${dur}h). Slot confirmed.`,
        details: `Batch: ${batchId} · Time: ${time}`
      });

      return sendJson(res, 200, { success: true, message: `${request.name} added to roster` });
    }

    if (method === 'POST' && pathname.startsWith('/api/requests/') && pathname.endsWith('/decline')) {
      const parts = pathname.split('/');
      const id = parts[3];
      const request = db.prepare('SELECT name FROM requests WHERE id = ?').get(id);
      db.prepare('DELETE FROM requests WHERE id = ?').run(id);

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'request_declined',
        title: `✕ Request Declined: ${request ? request.name : id}`,
        message: `Declined join request for ${request ? request.name : id}.`,
        details: id
      });

      return sendJson(res, 200, { success: true, message: 'Request declined and removed' });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/requests/')) {
      const id = pathname.slice('/api/requests/'.length);
      const request = db.prepare('SELECT name FROM requests WHERE id = ?').get(id);
      db.prepare('DELETE FROM requests WHERE id = ?').run(id);

      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'request_removed',
        title: `🗑️ Request Removed: ${request ? request.name : id}`,
        message: `Removed join request for ${request ? request.name : id}.`,
        details: id
      });

      return sendJson(res, 200, { success: true, message: 'Request permanently removed' });
    }

    if (method === 'DELETE' && pathname === '/api/requests') {
      db.prepare('DELETE FROM requests').run();
      logActivity({
        actorType: 'coach',
        actorName: 'Music Sir',
        actorMobile: '9848173025',
        actionType: 'requests_cleared',
        title: '🗑️ All Requests Cleared',
        message: 'Music Sir cleared all pending join requests from the portal.',
        details: 'All requests deleted'
      });
      return sendJson(res, 200, { success: true, message: 'All requests cleared' });
    }

    // -------------------------------------------------------------
    // SETTINGS / CONFIG
    // -------------------------------------------------------------
    if (method === 'GET' && (pathname === '/api/settings' || pathname === '/api/config')) return sendJson(res, 200, getConfig());

    if (method === 'POST' && (pathname === '/api/settings' || pathname === '/api/config')) {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      const body = await parseBody(req);
      if (body.slots) setConfigValue('slots', body.slots);
      if (body.batches) setConfigValue('batches', body.batches);
      if (body.instruments) setConfigValue('instruments', body.instruments);
      if (body.template !== undefined) setConfigValue('template', body.template);
      if (body.coachMobile !== undefined) setConfigValue('coachMobile', normalizePhone(body.coachMobile));

      return sendJson(res, 200, { success: true, config: getConfig() });
    }

    if (method === 'POST' && pathname === '/api/settings/reset') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized');

      db.exec(`
        DELETE FROM students;
        DELETE FROM bookings;
        DELETE FROM attendance;
        DELETE FROM requests;
        DELETE FROM performance_logs;
        DELETE FROM makeup_slots;
      `);

      return sendJson(res, 200, { success: true, message: 'All data reset' });
    }

    if (method === 'GET' && pathname === '/api/known-names') {
      const map = new Map();
      const students = db.prepare('SELECT name, mobile FROM students').all();
      students.forEach(s => map.set(s.name + '|' + s.mobile, s));
      const bookings = db.prepare('SELECT name, mobile FROM bookings').all();
      bookings.forEach(b => map.set(b.name + '|' + b.mobile, b));
      const requests = db.prepare('SELECT name, mobile FROM requests').all();
      requests.forEach(r => map.set(r.name + '|' + r.mobile, r));

      return sendJson(res, 200, { names: Array.from(map.values()) });
    }

    // -------------------------------------------------------------
    // PUSH NOTIFICATIONS (Web Push)
    // -------------------------------------------------------------
    const VAPID_PUBLIC_KEY = 'BL2XK2UoL2SiH2v2-lexHyEde_d-cHkQ_aKl9f1kXnlBpaSvK22JxafBpOdpFaI3McnI-5ZRf7vRNgIyrfOTowE';

    if (method === 'GET' && (pathname === '/api/push/vapid-public-key' || pathname === '/api/push/vapid-key')) {
      return sendJson(res, 200, { success: true, key: VAPID_PUBLIC_KEY, publicKey: VAPID_PUBLIC_KEY });
    }

    if (method === 'POST' && pathname === '/api/push/subscribe') {
      const body = await parseBody(req);
      const { subscription, userId, name, mobile, role } = body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return sendError(res, 400, 'Invalid push subscription');
      }

      db.prepare(`
        INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_auth, keys_p256dh, user_id, name, mobile, role, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        subscription.endpoint,
        subscription.keys.auth || '',
        subscription.keys.p256dh || '',
        userId || '',
        name || '',
        normalizePhone(mobile || ''),
        role || 'student',
        Date.now()
      );

      return sendJson(res, 200, { success: true, message: 'Subscription saved' });
    }

    if (method === 'POST' && pathname === '/api/push/send') {
      const body = await parseBody(req);
      const { target, notification } = body;
      if (!notification || !notification.title) {
        return sendError(res, 400, 'Notification title required');
      }

      const result = await dispatchPush(target, notification);
      return sendJson(res, 200, {
        success: true,
        sentCount: result.sent,
        totalSubscribers: result.total,
        message: `Push notification dispatched to ${result.sent} active subscriber(s)`
      });
    }

    if (method === 'GET' && pathname === '/api/notifications/history') {
      const history = db.prepare('SELECT * FROM sent_notifications ORDER BY sent_at DESC LIMIT 50').all();
      return sendJson(res, 200, { history });
    }

    if (method === 'POST' && pathname === '/api/notifications/run-check') {
      await runNotificationEngine();
      return sendJson(res, 200, { success: true, message: 'Automated notification check executed' });
    }

    if (method === 'POST' && pathname === '/api/notifications/simulate') {
      const { scenario } = await parseBody(req);
      let result = { message: 'Unknown scenario' };

      if (scenario === 'coach_1h') {
        result = await dispatchPush({ role: 'coach' }, {
          title: '⏰ Next Class in 1h: Rahul Sharma (04:00 PM)',
          body: 'Rahul Sharma is scheduled at 04:00 PM (1h, 🎹 Keyboard). Lesson: "Raga Bhairav - Swaras"',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-coach-1h',
          data: { url: '/?tab=schedule' }
        }, { type: 'simulation_coach_1h' });
      } else if (scenario === 'student_1h') {
        result = await dispatchPush({ role: 'student' }, {
          title: '⏰ Class in 1 Hour (04:00 PM)',
          body: 'Your Keyboard class starts at 04:00 PM. Are you coming? If you cannot make it, tap here to mark absent!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-student-1h',
          data: { url: '/?tab=attendance' }
        }, { type: 'simulation_student_1h' });
      } else if (scenario === 'student_5am_night') {
        result = await dispatchPush({ role: 'student' }, {
          title: '🌙 Early Morning Class Tomorrow: 5:00 AM',
          body: 'Good evening! Reminder that you have your music class tomorrow at 5:00 AM with Music Sir. Sleep well!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-student-5am',
          data: { url: '/' }
        }, { type: 'simulation_student_5am' });
      } else if (scenario === 'student_absent') {
        result = await dispatchPush({ role: 'coach' }, {
          title: '⚠️ Student Absent: Priya Patel',
          body: 'Priya Patel marked absent for today\'s 05:00 PM class. The slot is now open for make-up classes!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-absent',
          data: { url: '/?tab=schedule' }
        }, { type: 'simulation_absent' });
      } else if (scenario === 'new_request') {
        result = await dispatchPush({ role: 'coach' }, {
          title: '⚡ New Booking Request: Ananya Varma',
          body: 'Ananya Varma (9876543210) requested a Guitar session at 06:00 PM. Tap to approve & block slot!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-request',
          data: { url: '/?tab=requests' }
        }, { type: 'simulation_request' });
      } else if (scenario === 'coach_free_slots') {
        result = await dispatchPush({ role: 'coach' }, {
          title: '🟢 Studio Free Slots Today: 4 Hours Open',
          body: 'You have free slots open (11:00 AM, 02:00 PM, 03:00 PM). Flexible students can be accommodated!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'sim-free',
          data: { url: '/?tab=schedule' }
        }, { type: 'simulation_free' });
      }

      return sendJson(res, 200, { success: true, scenario, result });
    }

    // Static Files
    if (method === 'GET') {
      let filePath = pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, pathname);
      if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.ico': 'image/x-icon',
          '.svg': 'image/svg+xml',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return fs.createReadStream(filePath).pipe(res);
      }

      const indexPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(indexPath).pipe(res);
      }
    }

    return sendError(res, 404, 'Endpoint not found');
  } catch (err) {
    console.error('Server error:', err);
    return sendError(res, 500, 'Internal server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`🎶 Music Slot Booking backend running at http://localhost:${PORT}`);
});
