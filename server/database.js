const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '../data/forum.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db = null;

function createWrapper(sqlDb) {
  return {
    _db: sqlDb,
    prepare(sql) {
      return {
        run(...params) { try { sqlDb.run(sql, params); saveDb(); } catch (e) { console.error('DB run:', e.message, sql.substring(0, 50)); } },
        get(...params) {
          try {
            const stmt = sqlDb.prepare(sql);
            if (params.length > 0) stmt.bind(params);
            if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
            stmt.free(); return undefined;
          } catch (e) { return undefined; }
        },
        all(...params) {
          try {
            const results = []; const stmt = sqlDb.prepare(sql);
            if (params.length > 0) stmt.bind(params);
            while (stmt.step()) results.push(stmt.getAsObject());
            stmt.free(); return results;
          } catch (e) { return []; }
        }
      };
    },
    exec(sql) { try { sqlDb.run(sql); saveDb(); } catch (e) { console.error('DB exec:', e.message); } }
  };
}

function saveDb() {
  if (!db) return;
  try { fs.writeFileSync(dbPath, Buffer.from(db._db.export())); } catch (e) {}
}

async function initDatabase() {
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(dbPath)) { sqlDb = new SQL.Database(fs.readFileSync(dbPath)); }
  else { sqlDb = new SQL.Database(); }
  db = createWrapper(sqlDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      nickname TEXT NOT NULL, avatar TEXT DEFAULT '/img/default-avatar.png',
      bio TEXT DEFAULT '', email TEXT, role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active', points INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0, checkin_streak INTEGER DEFAULT 0, last_checkin TEXT,
      admin_permissions TEXT DEFAULT '[]', ban_reason TEXT, ban_until TEXT,
      created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS forums (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      icon TEXT DEFAULT '💬', sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, forum_id TEXT,
      title TEXT NOT NULL, content TEXT NOT NULL, images TEXT DEFAULT '[]',
      likes INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0, favorites INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published', is_anonymous INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0, is_essence INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      parent_id TEXT, reply_to_id TEXT, content TEXT NOT NULL,
      likes INTEGER DEFAULT 0, status TEXT DEFAULT 'published',
      floor_num INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_id TEXT NOT NULL,
      target_type TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL,
      last_message TEXT, last_message_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'text',
      is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, friend_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      type TEXT DEFAULT 'info', is_pinned INTEGER DEFAULT 0,
      show_popup INTEGER DEFAULT 0, status TEXT DEFAULT 'published',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_id TEXT NOT NULL,
      target_type TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sensitive_words (
      id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, replacement TEXT DEFAULT '***'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkin_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, points INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS points_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL,
      reason TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS music (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT,
      url TEXT NOT NULL, cover TEXT, sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS friend_links (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      logo TEXT, description TEXT, sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, user_id TEXT, content TEXT NOT NULL,
      contact TEXT, status TEXT DEFAULT 'pending',
      reply TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id TEXT PRIMARY KEY, user_id TEXT, ip TEXT, user_agent TEXT,
      status TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target TEXT,
      details TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT, from_user_id TEXT, post_id TEXT, is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 初始化默认数据
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get();
  if (!adminExists) {
    db.prepare("INSERT INTO users (id,username,password,nickname,role,status) VALUES (?,?,?,?,?,?)").run(
      uuidv4(), 'admin', bcrypt.hashSync('admin123', 10), '超级管理员', 'super_admin', 'active'
    );
    console.log('默认超管: admin / admin123');
  }

  // 默认设置
  const defaults = {
    siteName: 'YS工作室论坛', siteDescription: '信息交流社区',
    siteLogo: '/img/logo.png', siteFooter: '© 2026 YS工作室论坛系统',
    maintenanceMode: 'false', maintenanceTitle: '系统维护中',
    maintenanceMessage: '我们正在进行系统升级，预计很快恢复。',
    maintenanceBgColor: '#667eea', maintenanceIcon: '🔧',
    maintenanceCountdown: '', maintenanceContact: '',
    maintenanceCustomCss: '', maintenanceCustomHtml: '',
    allowRegister: 'true', postReview: 'false',
    checkinPoints: '5', registerPoints: '10'
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!db.prepare("SELECT key FROM settings WHERE key=?").get(k)) {
      db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run(k, v);
    }
  }

  // 默认板块
  const forumExists = db.prepare("SELECT id FROM forums LIMIT 1").get();
  if (!forumExists) {
    const forums = [
      { name: '综合讨论', desc: '自由交流区', icon: '💬' },
      { name: '技术交流', desc: '技术问题讨论', icon: '💻' },
      { name: '情感天地', desc: '情感故事分享', icon: '💕' },
      { name: '日常分享', desc: '生活点滴', icon: '☕' },
      { name: '资源分享', desc: '资源共享区', icon: '📦' }
    ];
    forums.forEach((f, i) => {
      db.prepare("INSERT INTO forums (id,name,description,icon,sort_order) VALUES (?,?,?,?,?)").run(uuidv4(), f.name, f.desc, f.icon, i);
    });
  }

  saveDb();
  console.log('数据库就绪');
  return db;
}

function getDb() { return db; }
module.exports = { initDatabase, getDb, saveDb };
