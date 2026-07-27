const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticate, requireAdmin, requirePermission, requireSuperAdmin } = require('../middleware/auth');
const { loadSettings, setSettings } = require('../settings');

const r = express.Router();
r.use(authenticate, requireAdmin);

// 统计
r.get('/stats', (req, res) => {
  try {
    const db = getDb();
    res.json({
      stats: {
        totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        totalPosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE status!='deleted'").get().c,
        totalComments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE status!='deleted'").get().c,
        todayPosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE date(created_at)=date('now')").get().c,
        pendingReview: db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='pending'").get().c,
        pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status='pending'").get().c
      },
      recentPosts: db.prepare("SELECT p.id,p.title,p.created_at,p.status,u.nickname FROM posts p LEFT JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC LIMIT 10").all()
    });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 用户管理
r.get('/users', (req, res) => {
  try {
    const db = getDb(), page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const search = req.query.search, role = req.query.role, status = req.query.status;
    let w = 'WHERE 1=1', p = [];
    if (search) { w += ' AND (username LIKE ? OR nickname LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
    if (role) { w += ' AND role=?'; p.push(role); }
    if (status) { w += ' AND status=?'; p.push(status); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM users ${w}`).get(...p).c;
    const users = db.prepare(`SELECT id,username,nickname,avatar,role,status,points,level,created_at,last_login FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p, limit, (page - 1) * limit);
    res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 帖子管理
r.get('/posts', requirePermission('posts'), (req, res) => {
  try {
    const db = getDb(), page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const status = req.query.status, search = req.query.search;
    let w = "WHERE p.status!='deleted'", p = [];
    if (status) { w += ' AND p.status=?'; p.push(status); }
    if (search) { w += ' AND (p.title LIKE ? OR p.content LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${w}`).get(...p).c;
    const posts = db.prepare(`SELECT p.*,u.nickname as author_name FROM posts p LEFT JOIN users u ON p.user_id=u.id ${w} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...p, limit, (page - 1) * limit);
    res.json({ posts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 帖子状态
r.put('/posts/:id/status', requirePermission('posts'), (req, res) => {
  try { const { status } = req.body; getDb().prepare('UPDATE posts SET status=? WHERE id=?').run(status, req.params.id); res.json({ message: '已更新' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 帖子置顶/精华
r.put('/posts/:id/pin', requireSuperAdmin, (req, res) => {
  try { const { pinned } = req.body; getDb().prepare('UPDATE posts SET is_pinned=? WHERE id=?').run(pinned ? 1 : 0, req.params.id); res.json({ message: pinned ? '已置顶' : '已取消' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/posts/:id/essence', requirePermission('posts'), (req, res) => {
  try { const { essence } = req.body; getDb().prepare('UPDATE posts SET is_essence=? WHERE id=?').run(essence ? 1 : 0, req.params.id); res.json({ message: essence ? '已加精' : '已取消' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 删除帖子
r.delete('/posts/:id', requirePermission('posts'), (req, res) => {
  try { getDb().prepare("UPDATE posts SET status='deleted' WHERE id=?").run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 评论管理
r.get('/comments', requirePermission('comments'), (req, res) => {
  try {
    const db = getDb(), page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const total = db.prepare("SELECT COUNT(*) as c FROM comments WHERE status!='deleted'").get().c;
    const comments = db.prepare("SELECT c.*,u.nickname as author_name,p.title as post_title FROM comments c LEFT JOIN users u ON c.user_id=u.id LEFT JOIN posts p ON c.post_id=p.id WHERE c.status!='deleted' ORDER BY c.created_at DESC LIMIT ? OFFSET ?").all(limit, (page - 1) * limit);
    res.json({ comments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/comments/:id', requirePermission('comments'), (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE comments SET status='deleted' WHERE id=?").run(req.params.id);
    db.prepare('UPDATE posts SET comments_count=MAX(0,comments_count-1) WHERE id=(SELECT post_id FROM comments WHERE id=?)').run(req.params.id);
    res.json({ message: '已删除' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 举报管理
r.get('/reports', requirePermission('reports'), (req, res) => {
  try {
    const db = getDb();
    const reports = db.prepare("SELECT r.*,u.nickname as reporter_name FROM reports r LEFT JOIN users u ON r.reporter_id=u.id WHERE r.status='pending' ORDER BY r.created_at DESC").all();
    res.json({ reports });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/reports/:id', requirePermission('reports'), (req, res) => {
  try { const { status } = req.body; getDb().prepare("UPDATE reports SET status=? WHERE id=?").run(status, req.params.id); res.json({ message: '已处理' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 板块管理
r.get('/forums', requirePermission('forums'), (req, res) => {
  try { res.json({ forums: getDb().prepare('SELECT * FROM forums ORDER BY sort_order').all() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/forums', requireSuperAdmin, (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ error: '请输入名称' });
    const id = uuidv4();
    getDb().prepare('INSERT INTO forums (id,name,description,icon) VALUES (?,?,?,?)').run(id, name, description || '', icon || '💬');
    res.json({ message: '已创建', id });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/forums/:id', requireSuperAdmin, (req, res) => {
  try {
    const { name, description, icon, status } = req.body;
    const f = [], v = [];
    if (name) { f.push('name=?'); v.push(name); }
    if (description !== undefined) { f.push('description=?'); v.push(description); }
    if (icon) { f.push('icon=?'); v.push(icon); }
    if (status) { f.push('status=?'); v.push(status); }
    if (f.length) { v.push(req.params.id); getDb().prepare(`UPDATE forums SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ message: '已更新' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/forums/:id', requireSuperAdmin, (req, res) => {
  try { getDb().prepare("UPDATE forums SET status='deleted' WHERE id=?").run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 敏感词
r.get('/sensitive-words', requirePermission('sensitive'), (req, res) => {
  try { res.json({ words: getDb().prepare('SELECT * FROM sensitive_words').all() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/sensitive-words', requirePermission('sensitive'), (req, res) => {
  try {
    const { word, replacement } = req.body;
    if (!word) return res.status(400).json({ error: '请输入敏感词' });
    if (getDb().prepare('SELECT id FROM sensitive_words WHERE word=?').get(word)) return res.status(400).json({ error: '已存在' });
    getDb().prepare('INSERT INTO sensitive_words (id,word,replacement) VALUES (?,?,?)').run(uuidv4(), word, replacement || '***');
    res.json({ message: '已添加' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/sensitive-words/:id', requirePermission('sensitive'), (req, res) => {
  try { getDb().prepare('DELETE FROM sensitive_words WHERE id=?').run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 公告管理
r.get('/announcements', requirePermission('announcements'), (req, res) => {
  try { res.json({ announcements: getDb().prepare('SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC').all() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/announcements', requirePermission('announcements'), (req, res) => {
  try {
    const { title, content, type, is_pinned, show_popup } = req.body;
    if (!title || !content) return res.status(400).json({ error: '请填写完整' });
    const id = uuidv4();
    getDb().prepare("INSERT INTO announcements (id,title,content,type,is_pinned,show_popup,status) VALUES (?,?,?,?,?,?,'published')").run(id, title, content, type || 'info', is_pinned ? 1 : 0, show_popup ? 1 : 0);
    res.json({ message: '已发布', id });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/announcements/:id', requirePermission('announcements'), (req, res) => {
  try {
    const { title, content, type, is_pinned, show_popup, status } = req.body;
    const f = [], v = [];
    if (title) { f.push('title=?'); v.push(title); }
    if (content) { f.push('content=?'); v.push(content); }
    if (type) { f.push('type=?'); v.push(type); }
    if (is_pinned !== undefined) { f.push('is_pinned=?'); v.push(is_pinned ? 1 : 0); }
    if (show_popup !== undefined) { f.push('show_popup=?'); v.push(show_popup ? 1 : 0); }
    if (status) { f.push('status=?'); v.push(status); }
    if (f.length) { v.push(req.params.id); getDb().prepare(`UPDATE announcements SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ message: '已更新' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/announcements/:id', requirePermission('announcements'), (req, res) => {
  try { getDb().prepare('DELETE FROM announcements WHERE id=?').run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 音乐管理
r.get('/music', requirePermission('music'), (req, res) => {
  try { res.json({ music: getDb().prepare('SELECT * FROM music ORDER BY sort_order').all() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/music', requireSuperAdmin, (req, res) => {
  try {
    const { title, artist, url, cover } = req.body;
    if (!title || !url) return res.status(400).json({ error: '请填写完整' });
    const id = uuidv4();
    getDb().prepare('INSERT INTO music (id,title,artist,url,cover) VALUES (?,?,?,?,?)').run(id, title, artist || '', url, cover || '');
    res.json({ message: '已添加', id });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/music/:id', requireSuperAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM music WHERE id=?').run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 友链管理
r.get('/friend-links', requirePermission('links'), (req, res) => {
  try { res.json({ links: getDb().prepare('SELECT * FROM friend_links ORDER BY sort_order').all() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/friend-links', requireSuperAdmin, (req, res) => {
  try {
    const { name, url, logo, description } = req.body;
    if (!name || !url) return res.status(400).json({ error: '请填写完整' });
    const id = uuidv4();
    getDb().prepare('INSERT INTO friend_links (id,name,url,logo,description) VALUES (?,?,?,?,?)').run(id, name, url, logo || '', description || '');
    res.json({ message: '已添加', id });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.delete('/friend-links/:id', requireSuperAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM friend_links WHERE id=?').run(req.params.id); res.json({ message: '已删除' }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 反馈
r.get('/feedback', requirePermission('feedback'), (req, res) => {
  try {
    const db = getDb();
    const fb = db.prepare("SELECT f.*,u.nickname FROM feedback f LEFT JOIN users u ON f.user_id=u.id ORDER BY f.created_at DESC").all();
    res.json({ feedback: fb });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/feedback/:id', requirePermission('feedback'), (req, res) => {
  try {
    const { status, reply } = req.body;
    const f = [], v = [];
    if (status) { f.push('status=?'); v.push(status); }
    if (reply) { f.push('reply=?'); v.push(reply); }
    if (f.length) { v.push(req.params.id); getDb().prepare(`UPDATE feedback SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ message: '已处理' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 用户操作（超管）
r.put('/users/:id/status', requirePermission('users'), (req, res) => {
  try {
    const db = getDb(), { status, reason } = req.body;
    if (req.params.id === req.user.id) return res.status(400).json({ error: '不能操作自己' });
    const f = ['status=?'], v = [status];
    if (reason) { f.push('ban_reason=?'); v.push(reason); }
    v.push(req.params.id);
    db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v);
    res.json({ message: status === 'banned' ? '已封禁' : '已解封' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/users/:id/reset-password', requireSuperAdmin, (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密码至少6位' });
    getDb().prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.params.id);
    res.json({ message: '密码已重置' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 添加管理员
r.post('/users/admin', requireSuperAdmin, (req, res) => {
  try {
    const db = getDb(), { username, password, nickname } = req.body;
    if (!username || !password || !nickname) return res.status(400).json({ error: '请填写完整' });
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(400).json({ error: '用户名已存在' });
    const id = uuidv4();
    db.prepare("INSERT INTO users (id,username,password,nickname,role,status) VALUES (?,?,?,?,?,'admin','active')").run(id, username, bcrypt.hashSync(password, 10), nickname);
    res.json({ message: '已添加', id });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/users/:id/role', requireSuperAdmin, (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'super_admin'].includes(role)) return res.status(400).json({ error: '无效' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: '不能改自己' });
    getDb().prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
    res.json({ message: '已更新' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 网站设置
r.get('/settings', (req, res) => {
  try { res.json({ settings: loadSettings() }); } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/settings', (req, res) => {
  try {
    const allowed = ['siteName', 'siteDescription', 'siteLogo', 'siteFooter', 'allowRegister', 'postReview', 'checkinPoints', 'registerPoints', 'splashEnabled', 'splashIcon', 'splashTitle', 'splashDesc', 'splashBg'];
    const f = {};
    for (const [k, v] of Object.entries(req.body)) if (allowed.includes(k)) f[k] = v;
    if (Object.keys(f).length) setSettings(f);
    res.json({ message: '已保存' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 维护系统
r.get('/maintenance', requireSuperAdmin, (req, res) => {
  try {
    const s = loadSettings();
    res.json({ maintenance: { mode: s.maintenanceMode === 'true', title: s.maintenanceTitle, message: s.maintenanceMessage, bgColor: s.maintenanceBgColor, icon: s.maintenanceIcon, countdown: s.maintenanceCountdown, contact: s.maintenanceContact, customCss: s.maintenanceCustomCss, customHtml: s.maintenanceCustomHtml } });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.put('/maintenance', requireSuperAdmin, (req, res) => {
  try {
    const { mode, title, message, bgColor, icon, countdown, contact, customCss, customHtml } = req.body;
    const u = {};
    if (mode !== undefined) u.maintenanceMode = String(mode);
    if (title !== undefined) u.maintenanceTitle = title;
    if (message !== undefined) u.maintenanceMessage = message;
    if (bgColor !== undefined) u.maintenanceBgColor = bgColor;
    if (icon !== undefined) u.maintenanceIcon = icon;
    if (countdown !== undefined) u.maintenanceCountdown = countdown;
    if (contact !== undefined) u.maintenanceContact = contact;
    if (customCss !== undefined) u.maintenanceCustomCss = customCss;
    if (customHtml !== undefined) u.maintenanceCustomHtml = customHtml;
    setSettings(u);
    res.json({ message: mode ? '维护已开启' : '维护已关闭' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

r.post('/maintenance/toggle', requireSuperAdmin, (req, res) => {
  try {
    const s = loadSettings(), n = s.maintenanceMode !== 'true';
    setSettings({ maintenanceMode: String(n) });
    res.json({ message: n ? '维护已开启' : '维护已关闭', mode: n });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

module.exports = r;

// === 管理员权限管理 ===

// 获取管理员权限
r.get('/admins/:id/permissions', requireSuperAdmin, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, nickname, admin_permissions FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
    if (!user) return res.status(404).json({ error: '管理员不存在' });
    let perms = [];
    try { perms = JSON.parse(user.admin_permissions || '[]'); } catch (e) {}
    res.json({ permissions: perms });
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});

// 设置管理员权限
r.put('/admins/:id/permissions', requireSuperAdmin, (req, res) => {
  try {
    const db = getDb();
    const { permissions } = req.body; // ['posts','comments','reports','chats',...]
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user || user.role !== 'admin') return res.status(400).json({ error: '只能设置管理员权限' });
    db.prepare('UPDATE users SET admin_permissions = ? WHERE id = ?').run(JSON.stringify(permissions), req.params.id);
    res.json({ message: '权限已更新' });
  } catch (e) { res.status(500).json({ error: '更新失败' }); }
});

// 获取管理员列表（含权限）
r.get('/admins/list', requireSuperAdmin, (req, res) => {
  try {
    const db = getDb();
    const admins = db.prepare("SELECT id, username, nickname, avatar, admin_permissions, created_at, last_login FROM users WHERE role = 'admin' ORDER BY created_at DESC").all();
    res.json({ admins: admins.map(a => { let p = []; try { p = JSON.parse(a.admin_permissions || '[]'); } catch(e) {} return { ...a, permissions: p }; }) });
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});
