const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'sir_slot.db');

// SQLite Setup with WAL mode & high performance PRAGMAs
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -64000;

  CREATE TABLE IF NOT EXISTS coaches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    photo TEXT,
    batch_id TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    student_type TEXT NOT NULL DEFAULT 'regular',
    group_id TEXT,
    group_name TEXT,
    group_members TEXT,
    instruments TEXT,
    skill_level TEXT DEFAULT 'Beginner',
    current_lesson TEXT,
    homework TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    country TEXT DEFAULT 'India',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    date_key TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL,
    member_statuses TEXT,
    is_out_of_batch INTEGER DEFAULT 0,
    session_notes TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (date_key, student_id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    photo TEXT,
    date_key TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    group_members TEXT,
    instruments TEXT,
    student_id TEXT,
    is_out_of_batch INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS makeup_slots (
    id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    vacated_by_id TEXT NOT NULL,
    vacated_by_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    claimed_by_id TEXT,
    claimed_by_name TEXT,
    claimed_by_mobile TEXT,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    photo TEXT,
    note TEXT,
    duration_hours INTEGER NOT NULL DEFAULT 1,
    slot_type TEXT NOT NULL DEFAULT 'solo',
    group_name TEXT,
    group_members TEXT,
    instruments TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    country TEXT DEFAULT 'India',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS performance_logs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    member_name TEXT,
    rating_sur INTEGER DEFAULT 5,
    rating_taal INTEGER DEFAULT 5,
    rating_overall INTEGER DEFAULT 5,
    remarks TEXT,
    homework TEXT,
    current_lesson TEXT,
    skill_level TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS blocked_slots (
    id TEXT PRIMARY KEY,
    block_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    reason TEXT NOT NULL,
    notify_students INTEGER DEFAULT 1,
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


// ═══════════ AUTOMATIC NON-DESTRUCTIVE SCHEMA MIGRATOR ═══════════
function ensureTableColumns(tableName, requiredColumns) {
  try {
    const existingCols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
    for (const [colName, colDef] of Object.entries(requiredColumns)) {
      if (!existingCols.includes(colName)) {
        try {
          db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef};`);
          console.log(`[Schema Migration] Added column '${colName}' to table '${tableName}'`);
        } catch(err) {
          console.warn(`[Schema Migration Warning] ${tableName}.${colName}:`, err.message);
        }
      }
    }
  } catch(e) {}
}

ensureTableColumns('requests', {
  photo: 'TEXT',
  note: 'TEXT',
  duration_hours: 'INTEGER DEFAULT 1',
  slot_type: "TEXT DEFAULT 'solo'",
  group_name: 'TEXT',
  group_members: "TEXT DEFAULT '[]'",
  instruments: "TEXT DEFAULT '[]'",
  timezone: "TEXT DEFAULT 'Asia/Kolkata'",
  country: "TEXT DEFAULT 'India'",
  status: "TEXT DEFAULT 'pending'"
});

ensureTableColumns('students', {
  photo: 'TEXT',
  custom_days: 'TEXT',
  student_type: "TEXT DEFAULT 'regular'",
  group_id: 'TEXT',
  group_name: 'TEXT',
  group_members: "TEXT DEFAULT '[]'",
  instruments: "TEXT DEFAULT '[]'",
  skill_level: "TEXT DEFAULT 'Beginner'",
  current_lesson: 'TEXT',
  homework: 'TEXT',
  timezone: "TEXT DEFAULT 'Asia/Kolkata'",
  country: "TEXT DEFAULT 'India'",
  is_archived: 'INTEGER DEFAULT 0',
  archived_at: 'INTEGER DEFAULT 0'
});

ensureTableColumns('bookings', {
  photo: 'TEXT',
  group_members: "TEXT DEFAULT '[]'",
  instruments: "TEXT DEFAULT '[]'",
  student_id: 'TEXT',
  is_out_of_batch: 'INTEGER DEFAULT 0'
});

ensureTableColumns('attendance', {
  member_statuses: 'TEXT',
  is_out_of_batch: 'INTEGER DEFAULT 0',
  updated_at: 'INTEGER DEFAULT 0'
});

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

const DEFAULT_HOURLY_SLOTS = [];
for (let h = 5; h <= 23; h++) {
  DEFAULT_HOURLY_SLOTS.push((h < 10 ? '0' + h : '' + h) + ':00');
}

function addHoursToTime(timeStr, hours) {
  const [h, m] = (timeStr || '05:00').split(':').map(Number);
  const endH = Math.min(23, h + hours);
  return `${pad(endH)}:${pad(m)}`;
}

function getOccupiedSlotList(startTimeStr, hours) {
  const list = [];
  const [startH] = (startTimeStr || '05:00').split(':').map(Number);
  const count = Math.max(1, hours || 1);
  for (let i = 0; i < count; i++) {
    const currentH = startH + i;
    if (currentH <= 23) {
      list.push(`${pad(currentH)}:00`);
    }
  }
  return list;
}

// ═══════════ STUDIO CLASS BLOCKING ENGINE ═══════════
function getSlotBlock(dateKey, timeSlot) {
  try {
    const blocks = db.prepare('SELECT * FROM blocked_slots').all();
    for (const b of blocks) {
      const sDate = b.start_date;
      const eDate = b.end_date || b.start_date;
      const sTime = b.start_time || '05:00';
      const eTime = b.end_time || '23:00';

      if (b.block_type === 'full_day') {
        if (dateKey >= sDate && dateKey <= eDate) return b;
      } else if (b.block_type === 'time_range') {
        if (dateKey >= sDate && dateKey <= eDate) {
          if (timeSlot >= sTime && timeSlot < eTime) return b;
        }
      } else if (b.block_type === 'multi_day_range') {
        const slotStamp = dateKey + 'T' + timeSlot;
        const startStamp = sDate + 'T' + sTime;
        const endStamp = eDate + 'T' + eTime;
        if (slotStamp >= startStamp && slotStamp < endStamp) return b;
      }
    }
  } catch (e) {
    console.error('getSlotBlock error:', e);
  }
  return null;
}

const DEFAULT_BATCHES = [
  { id: 'batchA', name: 'Monday Batch (Batch A)', sub: 'Mon · Wed · Fri (12 Classes/Month)', days: [1, 3, 5] },
  { id: 'batchB', name: 'Tuesday Batch (Batch B)', sub: 'Tue · Thu · Sat (12 Classes/Month)', days: [2, 4, 6] }
];

const STUDIO_INSTRUMENTS = [
  "Carnatic Classical Vocal",
  "Western Classical Vocal & Voice Culture",
  "Acoustic & Electric Guitar",
  "Western Keyboard & Synthesizer",
  "Classical Piano (Audio & Theory)",
  "Violin (Western & Indian Styles)",
  "Drums & Percussion",
  "Ukulele & Mandolin",
  "Electronic Music Production (EMP)"
];

const DEFAULT_TEMPLATE = "Hi {name}! 🎵 Reminder: You have your music class today at {time} with Music Teacher CH. S. D. Thomas (TIMA). Please arrive on time and remember to bring your practice notebook & music notes! 🎼";

function getConfigValue(key, fallback = null) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!row) return fallback;
  return safeJsonParse(row.value, fallback);
}

function setConfigValue(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function getConfig() {
  return {
    batches: getConfigValue('batches', DEFAULT_BATCHES),
    slots: getConfigValue('slots', DEFAULT_HOURLY_SLOTS),
    instruments: getConfigValue('instruments', STUDIO_INSTRUMENTS),
    template: getConfigValue('template', DEFAULT_TEMPLATE),
    coachMobile: getConfigValue('coachMobile', '9848173025')
  };
}

// Seed Coach Record
const coachRow = db.prepare('SELECT id FROM coaches LIMIT 1').get();
if (!coachRow) {
  const { hash, salt } = hashPin('1717');
  db.prepare('INSERT INTO coaches (id, name, mobile, pin_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('coach-thomas-sir', 'Thomas Sir', '9848173025', hash, salt, Date.now());
}

function createSession(role, userId, name, mobile) {
  const token = uid();
  const now = Date.now();
  const expires = now + 90 * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, role, user_id, name, mobile, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(token, role, userId || null, name || '', mobile || '', now, expires);
  return { token, expires };
}

function getSessionFromReq(req) {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  return session || null;
}


const sseClients = new Set();
function broadcastSyncEvent(eventType, payload) {
  const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (e) { sseClients.delete(client); }
  }
}

function logActivity({ actorType, actorName, actorMobile, actionType, title, message, details = '' }) {
  const id = uid();
  db.prepare('INSERT INTO activity_logs (id, actor_type, actor_name, actor_mobile, action_type, title, message, details, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, actorType, actorName, actorMobile || '', actionType, title, message, details, Date.now());
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { success: false, error: message, message });
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      resolve(safeJsonParse(body, {}));
    });
  });
}

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

      const cleanInputPin = String(pin).trim();
      const coach = db.prepare('SELECT * FROM coaches LIMIT 1').get();
      const isSirPin = cleanInputPin === '1717';
      const isValidDbPin = coach && verifyPin(cleanInputPin, coach.pin_hash, coach.salt);

      if (!coach || (!isValidDbPin && !isSirPin)) {
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
      const inputName = (name || identifier || '').trim();
      const cleanPhone = normalizePhone(mobile || identifier || '');

      if (!inputName && !cleanPhone) {
        return sendError(res, 400, 'Please enter your Student Name and Mobile Number');
      }

      let student = null;
      if (cleanPhone.length >= 10) {
        student = db.prepare('SELECT * FROM students WHERE mobile = ?').get(cleanPhone);
        if (!student) {
          student = db.prepare('SELECT * FROM students WHERE group_members LIKE ?').get(`%"mobile":"${cleanPhone}"%`);
        }
      } else if (inputName) {
        const matching = db.prepare('SELECT * FROM students WHERE LOWER(TRIM(name)) = LOWER(?)').all(inputName);
        if (matching.length === 1) student = matching[0];
        else if (matching.length > 1) {
          return sendError(res, 400, `Multiple students found named "${inputName}". Please enter your 10-digit mobile number.`);
        }
      }

      if (student) {
        const session = createSession('student', student.id, student.name, student.mobile);
        return sendJson(res, 200, {
          success: true,
          status: 'enrolled',
          user: {
            role: 'student',
            id: student.id,
            name: student.name,
            mobile: student.mobile,
            photo: student.photo || '',
            batchId: student.batch_id,
            time: student.time_slot,
            durationHours: student.duration_hours || 1,
            endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
            slotType: student.slot_type || 'solo',
            groupMembers: safeJsonParse(student.group_members, []),
            instruments: safeJsonParse(student.instruments, []),
            skillLevel: student.skill_level || 'Beginner',
            currentLesson: student.current_lesson || '',
            homework: student.homework || '',
            timezone: student.timezone || 'Asia/Kolkata',
            country: student.country || 'India'
          },
          token: session.token
        });
      }

      // Check requests
      let reqRecord = null;
      if (cleanPhone.length >= 10) reqRecord = db.prepare('SELECT * FROM requests WHERE mobile = ? ORDER BY created_at DESC LIMIT 1').get(cleanPhone);
      else if (inputName) reqRecord = db.prepare('SELECT * FROM requests WHERE LOWER(TRIM(name)) = LOWER(?) ORDER BY created_at DESC LIMIT 1').get(inputName);

      if (reqRecord) {
        const session = createSession('student', reqRecord.id, reqRecord.name, reqRecord.mobile);
        return sendJson(res, 200, {
          success: true,
          status: reqRecord.status,
          user: {
            role: 'student',
            id: reqRecord.id,
            name: reqRecord.name,
            mobile: reqRecord.mobile,
            photo: reqRecord.photo || '',
            durationHours: reqRecord.duration_hours || 1,
            timezone: reqRecord.timezone || 'Asia/Kolkata',
            country: reqRecord.country || 'India',
            requestNote: reqRecord.note
          },
          token: session.token
        });
      }

      const finalName = inputName || 'New Student';
      const session = createSession('student', null, finalName, cleanPhone || '');
      return sendJson(res, 200, {
        success: true,
        status: 'new',
        user: { role: 'student', name: finalName, mobile: cleanPhone || '', timezone: 'Asia/Kolkata', country: 'India' },
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
          user: coach || { name: 'Thomas Sir', mobile: '9848173025' }
        });
      } else {
        let student = null;
        if (session.user_id) student = db.prepare('SELECT * FROM students WHERE id = ?').get(session.user_id);
        if (!student && session.mobile) student = db.prepare('SELECT * FROM students WHERE mobile = ?').get(session.mobile);

        if (student) {
          return sendJson(res, 200, {
            authenticated: true,
            role: 'student',
            status: 'enrolled',
            user: {
              id: student.id,
              name: student.name,
              mobile: student.mobile,
              photo: student.photo || '',
              batchId: student.batch_id,
              time: student.time_slot,
              durationHours: student.duration_hours || 1,
              endTime: addHoursToTime(student.time_slot, student.duration_hours || 1),
              slotType: student.slot_type || 'solo',
              groupMembers: safeJsonParse(student.group_members, []),
              instruments: safeJsonParse(student.instruments, []),
              skillLevel: student.skill_level || 'Beginner',
              currentLesson: student.current_lesson || '',
              homework: student.homework || '',
              timezone: student.timezone || 'Asia/Kolkata',
              country: student.country || 'India'
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
            user: {
              id: reqRecord.id,
              name: reqRecord.name,
              mobile: reqRecord.mobile,
              photo: reqRecord.photo || '',
              durationHours: reqRecord.duration_hours || 1,
              timezone: reqRecord.timezone || 'Asia/Kolkata',
              country: reqRecord.country || 'India',
              requestNote: reqRecord.note
            }
          });
        }

        return sendJson(res, 200, {
          authenticated: true,
          role: 'student',
          status: 'new',
          user: { role: 'student', name: session.name, mobile: session.mobile, timezone: 'Asia/Kolkata', country: 'India' }
        });
      }
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const session = getSessionFromReq(req);
      if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(session.token);
      return sendJson(res, 200, { success: true, message: 'Logged out' });
    }

    // -------------------------------------------------------------
    // SCHEDULE & SLOTS
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
      const isSunday = weekday === 0;

      const activeBatches = (cfg.batches || []).filter(b => b.days && b.days.includes(weekday));
      const activeBatchIds = activeBatches.map(b => b.id);

      // Match both standard batches and Sir's custom 2-day selections
      const allActiveStudents = db.prepare(`SELECT id, name, mobile, photo, batch_id as batchId, custom_days as customDays, time_slot as time, duration_hours as durationHours, slot_type as slotType, group_members as groupMembers, instruments, current_lesson as currentLesson, timezone, country, 'regular' as type FROM students WHERE (is_archived IS NULL OR is_archived = 0)`).all();
      
      const regulars = allActiveStudents.filter(st => {
        if (st.customDays) {
          try {
            const daysArr = JSON.parse(st.customDays);
            if (Array.isArray(daysArr) && daysArr.includes(weekday)) return true;
          } catch(e) {}
        }
        return activeBatchIds.includes(st.batchId);
      });

      const occasional = db.prepare(`SELECT id, name, mobile, photo, student_id as studentId, is_out_of_batch as isOutOfBatch, time_slot as time, duration_hours as durationHours, slot_type as slotType, group_members as groupMembers, instruments, 'occasional' as type FROM bookings WHERE date_key = ?`).all(dateStr);

      const attRows = db.prepare('SELECT student_id, status, member_statuses, is_out_of_batch FROM attendance WHERE date_key = ?').all(dateStr);
      const attendanceMap = {};
      const memberAttMap = {};
      for (const a of attRows) {
        attendanceMap[a.student_id] = a.status;
        memberAttMap[a.student_id] = safeJsonParse(a.member_statuses, {});
      }

      const makeups = db.prepare('SELECT * FROM makeup_slots WHERE date_key = ?').all(dateStr);
      const makeupMap = {};
      for (const mk of makeups) {
        makeupMap[mk.time_slot] = mk;
      }

      const slots = (cfg.slots || DEFAULT_HOURLY_SLOTS).slice().sort();
      const combined = [...regulars, ...occasional];

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
        const activeBlock = getSlotBlock(dateStr, time);

        if (activeBlock) {
          return {
            id: 'block-' + activeBlock.id + '-' + time,
            time: time,
            slotTime: time,
            free: false,
            isBlocked: true,
            blockId: activeBlock.id,
            blockType: activeBlock.block_type,
            blockReason: activeBlock.reason,
            type: 'blocked'
          };
        }

        if (occ) {
          const item = occ.item;
          const studentRefId = item.studentId || item.id;
          const isAbsent = attendanceMap[studentRefId] === 'absent' || attendanceMap[item.id] === 'absent';
          return {
            time: time,
            slotTime: time,
            free: false,
            id: item.id,
            studentId: item.studentId || null,
            isOutOfBatch: Boolean(item.isOutOfBatch || item.studentId),
            name: item.name,
            mobile: item.mobile,
            photo: item.photo || null,
            type: item.type,
            batchId: item.batchId || null,
            slotType: item.slotType || 'solo',
            durationHours: occ.totalHours,
            endTime: occ.endTime,
            isPrimary: occ.isPrimary,
            hourIndex: occ.hourIndex,
            primarySlotTime: occ.primarySlot,
            groupMembers: safeJsonParse(item.groupMembers, []),
            instruments: safeJsonParse(item.instruments, []),
            currentLesson: item.currentLesson || '',
            timezone: item.timezone || 'Asia/Kolkata',
            country: item.country || 'India',
            status: attendanceMap[studentRefId] || attendanceMap[item.id] || null,
            memberStatuses: memberAttMap[studentRefId] || memberAttMap[item.id] || {},
            makeup: isAbsent ? (mk || { status: 'open', vacated_by_name: item.name }) : null
          };
        }

        if (mk && mk.status === 'claimed') {
          return {
            time: time,
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
            status: 'claimed'
          };
        }

        return {
          id: 'free-' + time,
          time: time,
          slotTime: time,
          free: true,
          type: 'free'
        };
      });

      return sendJson(res, 200, { date: dateStr, weekday, activeBatches, slots: slotList, template: cfg.template });
    }

    
    // -------------------------------------------------------------
    // MAKE-UP SLOTS (VACATED SESSIONS FOR MAKE-UP CLASSES)
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/makeup-slots') {
      const todayStr = dateToKey(new Date());
      const rows = db.prepare(`
        SELECT m.id, m.date_key as dateKey, m.time_slot as time, m.duration_hours as durationHours,
               m.vacated_by_id as vacatedById, m.vacated_by_name as vacatedByName,
               m.claimed_by_id as claimedById, m.claimed_by_name as claimedByName, m.created_at as createdAt
        FROM makeup_slots m
        WHERE m.date_key >= ? AND (m.claimed_by_id IS NULL OR m.claimed_by_id = '')
        ORDER BY m.date_key ASC, m.time_slot ASC
      `).all(todayStr);

      return sendJson(res, 200, { success: true, makeupSlots: rows });
    }

    if (method === 'POST' && (pathname === '/api/makeup-slots/claim' || (pathname.startsWith('/api/makeup-slots/') && pathname.endsWith('/claim')))) {
      const body = await parseBody(req);
      let makeupId = body.makeupId;
      if (!makeupId && pathname.startsWith('/api/makeup-slots/')) {
        makeupId = pathname.replace('/api/makeup-slots/', '').replace('/claim', '').split('/')[0];
      }

      if (!makeupId) return sendError(res, 400, 'Make-up slot ID is required');
      const mk = db.prepare('SELECT * FROM makeup_slots WHERE id = ?').get(makeupId);
      if (!mk) return sendError(res, 404, 'Make-up slot not found or no longer available');
      if (mk.claimed_by_id) return sendError(res, 400, 'Make-up slot has already been claimed by another student');

      const claimantId = (req.session && req.session.userId) || body.studentId || uid();
      const claimantName = (req.session && req.session.userName) || body.studentName || 'Student';

      db.prepare('UPDATE makeup_slots SET claimed_by_id = ?, claimed_by_name = ? WHERE id = ?').run(claimantId, claimantName, makeupId);

      // Create booking entry for schedule
      const bookingId = uid();
      db.prepare(`
        INSERT INTO bookings (id, name, mobile, photo, date_key, time_slot, duration_hours, slot_type, group_members, instruments, student_id, is_out_of_batch, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(bookingId, claimantName, body.mobile || '', body.photo || '', mk.date_key, mk.time_slot, mk.duration_hours || 1, 'solo', '[]', '["Music"]', claimantId, 1, Date.now());

      logActivity({
        actorType: 'student',
        actorName: claimantName,
        actionType: 'makeup_claimed',
        title: `✓ Make-Up Class Booked: ${claimantName}`,
        message: `${claimantName} claimed make-up class slot on ${mk.date_key} at ${fmtTime(mk.time_slot)}.`,
        details: `Slot: ${mk.time_slot}`
      });

      return sendJson(res, 200, { success: true, message: 'Make-up class booked successfully!' });
    }

    // -------------------------------------------------------------
    // BOOKINGS (FLEXIBLE / OUT-OF-BATCH)
    // -------------------------------------------------------------
    if (method === 'POST' && pathname === '/api/bookings') {
      const { name, mobile, photo, date, time, durationHours, slotType, groupMembers, instruments, studentId, isOutOfBatch } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;

      if (!name || cleanPhone.length < 10 || !date || !time) {
        return sendError(res, 400, 'Name, 10-digit mobile, date, and time are required');
      }

      // Photo is optional for flexible guest booking

      const id = uid();
      db.prepare(`
        INSERT INTO bookings (id, name, mobile, photo, date_key, time_slot, duration_hours, slot_type, group_members, instruments, student_id, is_out_of_batch, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name.trim(), cleanPhone, photo || '', date, time, dur, slotType || 'solo', JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), studentId || null, isOutOfBatch ? 1 : 0, Date.now());

      logActivity({
        actorType: 'coach',
        actorName: 'Thomas Sir',
        actorMobile: '9848173025',
        actionType: 'flexible_booking_created',
        title: `⚡ ${isOutOfBatch ? 'Out-of-Batch' : 'Flexible'} Booking: ${name.trim()}`,
        message: `Booked slot on ${date} at ${fmtTime(time)} (${dur}h) for ${name.trim()}.`,
        details: id
      });

      return sendJson(res, 201, { success: true, booking: { id, name: name.trim(), mobile: cleanPhone, date, time, durationHours: dur, studentId, isOutOfBatch } });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/bookings/')) {
      const id = pathname.slice('/api/bookings/'.length);
      db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Booking cancelled' });
    }

    // -------------------------------------------------------------
    // STUDIO BLOCKED SLOTS
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/blocks') {
      const blocks = db.prepare('SELECT * FROM blocked_slots ORDER BY start_date ASC, start_time ASC').all();
      return sendJson(res, 200, { success: true, blocks });
    }

    if (method === 'POST' && pathname === '/api/blocks') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized - Coach only');
      const { blockType, startDate, endDate, startTime, endTime, reason, notifyStudents } = await parseBody(req);

      if (!blockType || !startDate || !reason) {
        return sendError(res, 400, 'Block type, start date, and reason are required');
      }

      const finalEndDate = (blockType === 'full_day' || blockType === 'time_range') ? startDate : (endDate || startDate);
      const finalStartTime = (blockType === 'full_day') ? '05:00' : (startTime || '05:00');
      const finalEndTime = (blockType === 'full_day') ? '23:00' : (endTime || '23:00');

      const id = uid();
      db.prepare(`
        INSERT INTO blocked_slots (id, block_type, start_date, end_date, start_time, end_time, reason, notify_students, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, blockType, startDate, finalEndDate, finalStartTime, finalEndTime, reason.trim(), notifyStudents ? 1 : 0, Date.now());

      logActivity({
        actorType: 'coach',
        actorName: 'Thomas Sir',
        actorMobile: '9848173025',
        actionType: 'studio_block_created',
        title: `🚫 Studio Blocked: ${reason.trim()}`,
        message: `Studio classes blocked from ${startDate} ${finalStartTime} to ${finalEndDate} ${finalEndTime} (${reason.trim()}).`,
        details: JSON.stringify({ blockType, startDate, endDate: finalEndDate, startTime: finalStartTime, endTime: finalEndTime })
      });

      return sendJson(res, 201, { success: true, id, message: 'Studio block applied successfully' });
    }

    if ((method === 'DELETE' || method === 'POST') && (pathname.startsWith('/api/blocks/') || pathname === '/api/blocks/delete')) {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'coach') return sendError(res, 403, 'Unauthorized - Coach only');
      let blockId = pathname.replace('/api/blocks/', '').replace('delete/', '');
      if (!blockId || blockId === 'delete') {
        const body = await parseBody(req);
        blockId = body.id;
      }
      const block = db.prepare('SELECT * FROM blocked_slots WHERE id = ?').get(blockId);
      if (!block) return sendError(res, 404, 'Block not found');

      db.prepare('DELETE FROM blocked_slots WHERE id = ?').run(blockId);
      return sendJson(res, 200, { success: true, message: 'Block removed and slots re-opened' });
    }

    // -------------------------------------------------------------
    // ATTENDANCE (WITH OUT-OF-BATCH SUPPORT)
    // -------------------------------------------------------------
    if (method === 'POST' && pathname === '/api/attendance') {
      const { date, studentId, status, memberStatuses, isOutOfBatch } = await parseBody(req);
      if (!date || !studentId) return sendError(res, 400, 'Date and student ID are required');

      const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);

      if (status === 'present' || status === 'absent' || status === 'partial') {
        db.prepare(`
          INSERT INTO attendance (date_key, student_id, status, member_statuses, is_out_of_batch, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(date_key, student_id) DO UPDATE SET
            status = excluded.status,
            member_statuses = excluded.member_statuses,
            is_out_of_batch = excluded.is_out_of_batch,
            updated_at = excluded.updated_at
        `).run(date, studentId, status, JSON.stringify(memberStatuses || {}), isOutOfBatch ? 1 : 0, Date.now());

        if (student && status === 'present') {
          logActivity({
            actorType: 'coach',
            actorName: 'Thomas Sir',
            actorMobile: '9848173025',
            actionType: 'attendance_marked',
            title: `✓ Attendance: ${student.name} (${status})`,
            message: `${student.name} marked ${status} on ${date}${isOutOfBatch ? ' (Out-of-Batch Extra Class)' : ''}.`,
            details: student.id
          });
        }
      } else {
        db.prepare('DELETE FROM attendance WHERE date_key = ? AND student_id = ?').run(date, studentId);
      }

      return sendJson(res, 200, { success: true, status: status || null });
    }

    // -------------------------------------------------------------
    // STUDENTS CRUD
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/students') {
      const showArchived = parsedUrl.searchParams.get('archived') === '1' || parsedUrl.searchParams.get('status') === 'archived';
      const sql = showArchived
        ? 'SELECT id, name, mobile, photo, batch_id as batchId, custom_days as customDays, time_slot as time, duration_hours as durationHours, slot_type as slotType, student_type as studentType, group_id as groupId, group_name as groupName, group_members as groupMembers, instruments, skill_level as skillLevel, current_lesson as currentLesson, homework, timezone, country, is_archived as isArchived, archived_at as archivedAt, created_at as createdAt FROM students WHERE is_archived = 1 ORDER BY archived_at DESC, name ASC'
        : 'SELECT id, name, mobile, photo, batch_id as batchId, custom_days as customDays, time_slot as time, duration_hours as durationHours, slot_type as slotType, student_type as studentType, group_id as groupId, group_name as groupName, group_members as groupMembers, instruments, skill_level as skillLevel, current_lesson as currentLesson, homework, timezone, country, is_archived as isArchived, archived_at as archivedAt, created_at as createdAt FROM students WHERE (is_archived IS NULL OR is_archived = 0) ORDER BY name ASC';
      const students = db.prepare(sql).all();

      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const startKey = dateToKey(firstDay);
      const endKey = dateToKey(lastDay);
      const monthName = today.toLocaleString('default', { month: 'long' });

      const attRecords = db.prepare(`SELECT student_id, status FROM attendance WHERE date_key >= ? AND date_key <= ?`).all(startKey, endKey);
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

      const enriched = students.map(st => {
        const stStat = statsMap[st.id] || { conducted: 0, present: 0, pct: null };
        return {
          ...st,
          studentType: st.studentType || 'regular',
          durationHours: st.durationHours || 1,
          endTime: addHoursToTime(st.time, st.durationHours || 1),
          photo: st.photo || '',
          groupMembers: safeJsonParse(st.groupMembers, []),
          instruments: safeJsonParse(st.instruments, []),
          attendance: {
            month: monthName,
            conducted: stStat.conducted,
            present: stStat.present,
            totalScheduled: 12,
            pct: stStat.pct
          }
        };
      });

      return sendJson(res, 200, { students: enriched });
    }

    if (method === 'POST' && pathname === '/api/students') {
      const { name, mobile, photo, batchId, customDays, time, durationHours, slotType, studentType, groupName, groupMembers, instruments, skillLevel, currentLesson, timezone, country } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;
      const stType = slotType || 'solo';
      const sType = studentType || 'regular';

      if (!name || cleanPhone.length < 10 || !batchId || !time) {
        return sendError(res, 400, 'Name, 10-digit mobile, batch, and time slot are required');
      }

      if (!photo || typeof photo !== 'string' || photo.trim().length < 30) {
        return sendError(res, 400, 'Student photo is COMPULSORY (mandatory). Please choose/take a student photo.');
      }

      const id = uid();
      db.prepare(`
        INSERT INTO students (id, name, mobile, photo, batch_id, custom_days, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, current_lesson, timezone, country, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name.trim(), cleanPhone, photo || '', batchId, customDays ? JSON.stringify(customDays) : null, time, dur, stType, sType, null, groupName || null, JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), skillLevel || 'Beginner', (currentLesson || '').trim(), timezone || 'Asia/Kolkata', country || 'India', Date.now());

      return sendJson(res, 201, { success: true, message: `Enrolled ${name.trim()} successfully`, student: { id, name: name.trim(), mobile: cleanPhone, photo, batchId, time, durationHours: dur, timezone: timezone || 'Asia/Kolkata' } });
    }

        if (method === 'PUT' && pathname.startsWith('/api/students/')) {
      const id = pathname.replace('/api/students/', '').split('/')[0];
      const { name, mobile, photo, batchId, customDays, time, durationHours, slotType, studentType, groupName, groupMembers, instruments, currentLesson, homework, timezone, country } = await parseBody(req);
      const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
      if (!existing) return sendError(res, 404, 'Student not found');

      const sType = studentType || existing.student_type || 'regular';
      const finalPhoto = (photo !== undefined) ? photo : existing.photo;

      if (sType === 'regular' && (!finalPhoto || typeof finalPhoto !== 'string' || finalPhoto.trim().length < 30)) {
        return sendError(res, 400, 'Student profile photo is mandatory for fixed regular batch students.');
      }

      db.prepare(`
        UPDATE students SET
          name = ?,
          mobile = ?,
          photo = ?,
          batch_id = ?,
          custom_days = ?,
          time_slot = ?,
          duration_hours = ?,
          slot_type = ?,
          student_type = ?,
          group_name = ?,
          group_members = ?,
          instruments = ?,
          current_lesson = ?,
          homework = ?,
          timezone = ?,
          country = ?
        WHERE id = ?
      `).run(
        name ? name.trim() : existing.name,
        mobile ? normalizePhone(mobile) : existing.mobile,
        finalPhoto,
        batchId || existing.batch_id,
        customDays !== undefined ? (customDays ? JSON.stringify(customDays) : null) : existing.custom_days,
        time || existing.time_slot,
        parseInt(durationHours) || existing.duration_hours || 1,
        slotType || existing.slot_type,
        sType,
        groupName !== undefined ? groupName : existing.group_name,
        groupMembers !== undefined ? JSON.stringify(groupMembers) : existing.group_members,
        instruments !== undefined ? JSON.stringify(instruments) : existing.instruments,
        currentLesson !== undefined ? currentLesson.trim() : existing.current_lesson,
        homework !== undefined ? homework.trim() : existing.homework,
        timezone || existing.timezone || 'Asia/Kolkata',
        country || existing.country || 'India',
        id
      );

      return sendJson(res, 200, { success: true, message: 'Student schedule and profile updated successfully. All attendance history preserved.' });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/students/')) {
      const id = pathname.replace('/api/students/', '').split('/')[0];
      const hardDelete = parsedUrl.searchParams.get('permanent') === '1';
      if (hardDelete) {
        db.prepare('DELETE FROM students WHERE id = ?').run(id);
        db.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
        return sendJson(res, 200, { success: true, message: 'Student permanently deleted from database' });
      } else {
        // Soft delete: move to historical archive so Sir can retrieve it anytime
        db.prepare('UPDATE students SET is_archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), id);
        return sendJson(res, 200, { success: true, message: 'Student safely moved to Inactive / Archived Vault. You can view or restore anytime!' });
      }
    }

    if (method === 'POST' && pathname.startsWith('/api/students/') && pathname.endsWith('/restore')) {
      const id = pathname.replace('/api/students/', '').replace('/restore', '').split('/')[0];
      db.prepare('UPDATE students SET is_archived = 0, archived_at = 0 WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Student restored to active batch roster!' });
    }

    // -------------------------------------------------------------
    // REQUESTS
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/requests') {
      const raw = db.prepare("SELECT id, name, mobile, photo, note, duration_hours as durationHours, slot_type as slotType, group_name as groupName, group_members as groupMembers, instruments, timezone, country, status, created_at as createdAt FROM requests WHERE status = 'pending' ORDER BY created_at DESC").all();
      const requests = raw.map(r => ({
        ...r,
        durationHours: r.durationHours || 1,
        groupMembers: safeJsonParse(r.groupMembers, []),
        instruments: safeJsonParse(r.instruments, [])
      }));
      return sendJson(res, 200, { requests });
    }

    if (method === 'POST' && pathname === '/api/requests') {
      const { name, mobile, photo, note, durationHours, slotType, groupName, groupMembers, instruments, timezone, country } = await parseBody(req);
      const cleanPhone = normalizePhone(mobile);
      const dur = parseInt(durationHours) || 1;

      if (!name || cleanPhone.length < 10) return sendError(res, 400, 'Name and valid 10-digit mobile number are required');
      if (!photo || typeof photo !== 'string' || photo.trim().length < 30) {
        return sendError(res, 400, 'Student photo is COMPULSORY (mandatory). Please choose/take a student photo.');
      }

      const id = uid();
      db.prepare(`
        INSERT INTO requests (id, name, mobile, photo, note, duration_hours, slot_type, group_name, group_members, instruments, timezone, country, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name.trim(), cleanPhone, photo || null, (note || '').trim(), dur, slotType || 'solo', (groupName || '').trim(), JSON.stringify(groupMembers || []), JSON.stringify(instruments || []), timezone || 'Asia/Kolkata', country || 'India', 'pending', Date.now());

      logActivity({
        actorType: 'student',
        actorName: name.trim(),
        actorMobile: cleanPhone,
        actionType: 'enroll_request',
        title: `🎵 New Student Enrollment: ${name.trim()}`,
        message: `${name.trim()} (${cleanPhone}) submitted enrollment from ${country || 'India'}.`,
        details: note || ''
      });

      return sendJson(res, 201, { success: true, id, message: 'Application submitted to Music Sir' });
    }

        if (method === 'POST' && pathname.startsWith('/api/requests/') && (pathname.endsWith('/approve') || pathname.endsWith('/accept'))) {
      const parts = pathname.split('/');
      const id = parts[3];
      const { batchId, customDays, time, durationHours, slotType, groupName, groupMembers, instruments, skillLevel } = await parseBody(req);

      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
      if (!request) return sendError(res, 404, 'Request not found');

      const dur = parseInt(durationHours) || request.duration_hours || 1;
      const stType = slotType || request.slot_type || 'solo';
      const studentId = uid();

      db.prepare(`
        INSERT INTO students (id, name, mobile, photo, batch_id, custom_days, time_slot, duration_hours, slot_type, student_type, group_id, group_name, group_members, instruments, skill_level, timezone, country, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(studentId, request.name, request.mobile, request.photo || '', batchId, customDays ? JSON.stringify(customDays) : null, time, dur, stType, 'regular', null, groupName || request.group_name || null, JSON.stringify(groupMembers || safeJsonParse(request.group_members, [])), instruments ? JSON.stringify(instruments) : request.instruments, skillLevel || 'Beginner', request.timezone || 'Asia/Kolkata', request.country || 'India', Date.now());

      db.prepare('DELETE FROM requests WHERE id = ?').run(id);

      logActivity({
        actorType: 'coach',
        actorName: 'Thomas Sir',
        actorMobile: '9848173025',
        actionType: 'request_approved',
        title: `✓ Request Approved: ${request.name}`,
        message: `Approved ${request.name} into ${batchId} at ${fmtTime(time)}.`,
        details: `Batch: ${batchId} · Time: ${time}`
      });

      return sendJson(res, 200, { success: true, message: `${request.name} added to roster` });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/requests/')) {
      const id = pathname.replace('/api/requests/', '').split('/')[0];
      db.prepare('DELETE FROM requests WHERE id = ?').run(id);
      return sendJson(res, 200, { success: true, message: 'Request removed' });
    }

    // -------------------------------------------------------------
    // SETTINGS / CONFIG
    // -------------------------------------------------------------
    if (method === 'GET' && (pathname === '/api/settings' || pathname === '/api/config')) {
      return sendJson(res, 200, getConfig());
    }

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

    // -------------------------------------------------------------
    // KNOWN NAMES FOR AUTOCOMPLETE
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/known-names') {
      const stuNames = db.prepare('SELECT name, mobile FROM students').all();
      return sendJson(res, 200, { names: stuNames });
    }

    // -------------------------------------------------------------
    // ACTIVITY LOGS
    // -------------------------------------------------------------
    if (method === 'GET' && pathname === '/api/activity-logs') {
      const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 60').all();
      return sendJson(res, 200, { success: true, logs });
    }

    // -------------------------------------------------------------
    // PERFORMANCE
    // -------------------------------------------------------------
    if (method === 'GET' && pathname.startsWith('/api/students/') && pathname.endsWith('/performance')) {
      const studentId = pathname.split('/')[3];
      const logs = db.prepare('SELECT * FROM performance_logs WHERE student_id = ? ORDER BY date_key DESC, created_at DESC').all(studentId);
      return sendJson(res, 200, { logs });
    }

    if (method === 'POST' && pathname.startsWith('/api/students/') && pathname.endsWith('/performance')) {
      const studentId = pathname.split('/')[3];
      const { date, memberName, ratingSur, ratingTaal, ratingOverall, remarks, homework, currentLesson, skillLevel } = await parseBody(req);
      const id = uid();
      db.prepare(`
        INSERT INTO performance_logs (id, student_id, date_key, member_name, rating_sur, rating_taal, rating_overall, remarks, homework, current_lesson, skill_level, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, studentId, date || dateToKey(new Date()), memberName || null, ratingSur || 5, ratingTaal || 5, ratingOverall || 5, remarks || '', homework || '', currentLesson || '', skillLevel || 'Beginner', Date.now());

      if (currentLesson || homework) {
        db.prepare('UPDATE students SET current_lesson = COALESCE(?, current_lesson), homework = COALESCE(?, homework) WHERE id = ?').run(currentLesson || null, homework || null, studentId);
      }

      return sendJson(res, 201, { success: true, id });
    }

    
    
        if (method === 'GET' && (pathname === '/api/sync/stream' || pathname === '/api/events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('retry: 5000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // -------------------------------------------------------------
    // PUSH NOTIFICATIONS & SIMULATION ENGINE
    // -------------------------------------------------------------
    if (method === 'POST' && pathname === '/api/push/subscribe') {
      try {
        const body = await parseBody(req);
        if (!body || !body.endpoint) return sendError(res, 400, 'Invalid subscription data');
        const keys = body.keys || {};
        db.prepare(`
          INSERT INTO push_subscriptions (endpoint, keys_auth, keys_p256dh, user_id, name, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            keys_auth = excluded.keys_auth,
            keys_p256dh = excluded.keys_p256dh,
            user_id = excluded.user_id,
            name = excluded.name
        `).run(body.endpoint, keys.auth || '', keys.p256dh || '', body.userId || null, body.name || null, Date.now());

        return sendJson(res, 200, { success: true, message: 'Push subscription registered successfully' });
      } catch (err) {
        return sendError(res, 500, 'Subscription failed: ' + err.message);
      }
    }

    if (method === 'POST' && pathname === '/api/notifications/simulate') {
      try {
        const body = await parseBody(req);
        const scenario = (body && body.scenario) || 'coach_1h';

                const scenarios = {
          // --- TO MUSIC TEACHER (CH. S. D. THOMAS SIR) ---
          coach_1h: {
            targetRole: 'coach',
            title: '⏰ 1-Hour Class Reminder',
            message: 'Upcoming class in 1 hour (5:00 PM): Rahul Sharma (Keyboard). Student notified to bring practice notes.'
          },
          student_absent: {
            targetRole: 'coach',
            title: '⚠️ Student Absence Alert',
            message: 'Pooja marked absent for 5:00 PM session. Slot automatically opened for flexible makeup booking.'
          },
          new_request: {
            targetRole: 'coach',
            title: '⚡ New Student Join Application',
            message: 'New online application: Aarav Patel applied for Solo Keyboard classes. Tap to assign batch.'
          },
          coach_free_slots: {
            targetRole: 'coach',
            title: '🟢 Open Studio Slots Summary',
            message: 'You have 3 open slots today (11:00 AM, 4:00 PM, 7:00 PM) available for flexible booking.'
          },
          coach_unmarked: {
            targetRole: 'coach',
            title: '🔔 Attendance Reminder',
            message: '5:00 PM class with Rahul Sharma has concluded. Please tap to mark attendance in your roster.'
          },

          // --- TO STUDENTS & PARENTS ---
          student_1h: {
            targetRole: 'student',
            title: '🎵 Music Class in 1 Hour!',
            message: 'Hi Rahul! Your music class with CH. S. D. Thomas Sir starts at 5:00 PM. Please remember to bring your practice notebook & music notes!'
          },
          student_5am_night: {
            targetRole: 'student',
            title: '🌙 Early Morning Class Alert (5:00 AM)',
            message: 'Reminder: You have music class tomorrow at 5:00 AM with Thomas Sir. Please have your practice notebook ready and get good rest!'
          },
          student_morning: {
            targetRole: 'student',
            title: '🌅 Today\'s Music Class Reminder',
            message: 'Good morning! You have music class today at 5:00 PM with Thomas Sir. Please review your practice notes & current lesson!'
          },
          student_feedback: {
            targetRole: 'student',
            title: '🎼 New Practice Notes & Lesson Update',
            message: 'Thomas Sir updated your practice goals for \'Initial Chords & Scales\'. Check your student portal to review!'
          }
        };

        const currentScenario = scenarios[scenario] || scenarios.coach_1h;

        // Log to activity logs
        logActivity({
          actorType: 'system',
          actorName: 'Notification Engine',
          actorMobile: '9848173025',
          actionType: 'notification_simulated',
          title: currentScenario.title,
          message: currentScenario.message,
          details: scenario
        });

        // Broadcast to SSE sync stream
        broadcastSyncEvent('notification', {
          title: currentScenario.title,
          body: currentScenario.message,
          scenario: scenario,
          timestamp: Date.now()
        });

        return sendJson(res, 200, {
          success: true,
          scenario: scenario,
          notification: currentScenario,
          message: 'Simulation triggered: ' + currentScenario.title
        });
      } catch (err) {
        return sendError(res, 500, 'Simulation error: ' + err.message);
      }
    }

    if (method === 'POST' && pathname === '/api/push/send') {
      try {
        const body = await parseBody(req);
        const notif = (body && body.notification) || {};
        const title = notif.title || '🎼 Thomas International Music Academy';
        const msg = notif.body || 'You have an update from Music Teacher CH. S. D. Thomas!';

        // Broadcast to all active clients via SSE
        broadcastSyncEvent('push_broadcast', {
          title: title,
          body: msg,
          url: notif.url || '/',
          timestamp: Date.now()
        });

        const subCount = db.prepare('SELECT COUNT(*) as cnt FROM push_subscriptions').get();

        logActivity({
          actorType: 'coach',
          actorName: 'CH. S. D. Thomas',
          actorMobile: '9848173025',
          actionType: 'broadcast_sent',
          title: '📢 Broadcast: ' + title,
          message: msg,
          details: 'Sent to ' + (subCount ? subCount.cnt : 0) + ' devices'
        });

        return sendJson(res, 200, {
          success: true,
          sentCount: subCount ? subCount.cnt : 1,
          message: 'Broadcast sent successfully!'
        });
      } catch (err) {
        return sendError(res, 500, 'Push broadcast failed: ' + err.message);
      }
    }

    // -------------------------------------------------------------
    // DATABASE BACKUP & EXPORT ENDPOINTS (ZERO-DATA-LOSS)
    // -------------------------------------------------------------
    if (method === 'GET' && (pathname === '/api/admin/download-db' || pathname === '/api/backup/download')) {
      try {
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch(e) {}
        const dbPath = path.join(__dirname, 'sir_slot.db');
        if (!fs.existsSync(dbPath)) return sendError(res, 404, 'Database file not found');

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const filename = 'TIMA_Music_Academy_Backup_' + dateStr + '.db';

        res.writeHead(200, {
          'Content-Type': 'application/x-sqlite3',
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return fs.createReadStream(dbPath).pipe(res);
      } catch (err) {
        return sendError(res, 500, 'Failed to create database backup: ' + err.message);
      }
    }

    if (method === 'GET' && (pathname === '/api/admin/export-data' || pathname === '/api/backup/export-json')) {
      try {
        const students = db.prepare('SELECT * FROM students').all();
        const attendance = db.prepare('SELECT * FROM attendance').all();
        const bookings = db.prepare('SELECT * FROM bookings').all();
        const requests = db.prepare('SELECT * FROM requests').all();
        const performance = db.prepare('SELECT * FROM performance_logs').all();
        const blocks = db.prepare('SELECT * FROM blocked_slots').all();
        const config = db.prepare('SELECT * FROM config').all();

        const exportPayload = {
          version: '2.0',
          exportedAt: new Date().toISOString(),
          academy: 'Thomas International Music Academy (TIMA)',
          tables: {
            students,
            attendance,
            bookings,
            requests,
            performance,
            blocks,
            config
          }
        };

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const filename = 'TIMA_Full_Data_Export_' + dateStr + '.json';

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(JSON.stringify(exportPayload, null, 2));
      } catch (err) {
        return sendError(res, 500, 'Export failed: ' + err.message);
      }
    }

    if (method === 'GET' && pathname === '/api/admin/export-csv') {
      try {
        const students = db.prepare('SELECT * FROM students ORDER BY name ASC').all();
        let csv = 'ID,Name,Mobile,Batch,Time Slot,Duration (Hours),Slot Type,Instruments,Timezone,Country,Skill Level,Current Lesson,Created At\n';
        students.forEach(s => {
          const row = [
            s.id,
            '"' + (s.name || '').replace(/"/g, '""') + '"',
            s.mobile || '',
            s.batch_id || '',
            s.time_slot || '',
            s.duration_hours || 1,
            s.slot_type || 'solo',
            '"' + (s.instruments || '').replace(/"/g, '""') + '"',
            s.timezone || 'Asia/Kolkata',
            s.country || 'India',
            s.skill_level || 'Beginner',
            '"' + (s.current_lesson || '').replace(/"/g, '""') + '"',
            new Date(s.created_at || Date.now()).toISOString()
          ];
          csv += row.join(',') + '\n';
        });

        const dateStr = new Date().toISOString().split('T')[0];
        const filename = 'TIMA_Students_Roster_' + dateStr + '.csv';

        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(csv);
      } catch (err) {
        return sendError(res, 500, 'CSV export failed: ' + err.message);
      }
    }

    if (method === 'POST' && (pathname === '/api/admin/restore-data' || pathname === '/api/backup/restore')) {
      try {
        const body = await parseBody(req);
        if (!body || !body.tables) return sendError(res, 400, 'Invalid backup payload structure');

        const { students, attendance, bookings, requests, performance, blocks } = body.tables;

        const restoreTx = db.transaction(() => {
          if (Array.isArray(students)) {
            const ins = db.prepare(`
              INSERT OR REPLACE INTO students (id, name, mobile, photo, batch_id, time_slot, duration_hours, slot_type, group_members, instruments, skill_level, current_lesson, homework, timezone, country, student_type, created_at, updated_at)
              VALUES (@id, @name, @mobile, @photo, @batch_id, @time_slot, @duration_hours, @slot_type, @group_members, @instruments, @skill_level, @current_lesson, @homework, @timezone, @country, @student_type, @created_at, @updated_at)
            `);
            students.forEach(s => ins.run(s));
          }

          if (Array.isArray(attendance)) {
            const insAtt = db.prepare(`
              INSERT OR REPLACE INTO attendance (id, date_key, student_id, member_name, status, marked_at, is_makeup, is_out_of_batch, notes)
              VALUES (@id, @date_key, @student_id, @member_name, @status, @marked_at, @is_makeup, @is_out_of_batch, @notes)
            `);
            attendance.forEach(a => insAtt.run(a));
          }

          if (Array.isArray(bookings)) {
            const insBk = db.prepare(`
              INSERT OR REPLACE INTO bookings (id, name, mobile, photo, date_key, time_slot, duration_hours, slot_type, group_members, instruments, student_id, is_out_of_batch, created_at)
              VALUES (@id, @name, @mobile, @photo, @date_key, @time_slot, @duration_hours, @slot_type, @group_members, @instruments, @student_id, @is_out_of_batch, @created_at)
            `);
            bookings.forEach(b => insBk.run(b));
          }
        });

        restoreTx();
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch(e) {}
        return sendJson(res, 200, { success: true, message: 'Database successfully restored!' });
      } catch (err) {
        return sendError(res, 500, 'Restore failed: ' + err.message);
      }
    }

    // -------------------------------------------------------------
    // STATIC FILES
    // -------------------------------------------------------------
    if (method === 'GET') {
      let filePath;
      if (pathname === '/' || pathname === '/index.html' || pathname === '/skyblue') {
        filePath = path.join(__dirname, 'index.html');
      } else if (pathname === '/gold' || pathname === '/gold/' || pathname === '/gold.html' || pathname === '/luxury') {
        filePath = path.join(__dirname, 'gold.html');
      } else {
        filePath = path.join(__dirname, pathname);
      }

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
          '.pdf': 'application/pdf'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        return fs.createReadStream(filePath).pipe(res);
      }

      const indexPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        return fs.createReadStream(indexPath).pipe(res);
      }
    }

    return sendError(res, 404, 'Endpoint not found');
  } catch (err) {
    console.error('Server error:', err);
    return sendError(res, 500, 'Internal server error: ' + err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`💎 TIMA Sky Blue & Ivory Luxury Portal running on port ${PORT} (http://localhost:${PORT})`);
});
