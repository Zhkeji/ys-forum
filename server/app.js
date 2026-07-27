const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initDatabase } = require('./database');
const { setupSocket } = require('./socket');
const { loadSettings } = require('./settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.set('io', io);

// 维护模式
app.use((req, res, next) => {
  try {
    const s = loadSettings();
    if (s.maintenanceMode === 'true' && !req.path.startsWith('/admin') && !req.path.startsWith('/api/') && !req.path.startsWith('/socket.io') && !req.path.startsWith('/img/') && !req.path.startsWith('/css/') && !req.path.startsWith('/js/')) {
      return res.sendFile(path.join(__dirname, '../views/maintenance.html'));
    }
  } catch (e) {}
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/upload', require('./routes/upload'));

// 公告公开接口
app.get('/api/announcements', (req, res) => {
  try { res.json({ announcements: getDb().prepare("SELECT id,title,content,type,is_pinned,show_popup,created_at FROM announcements WHERE status='published' ORDER BY is_pinned DESC,created_at DESC LIMIT 10").all() }); } catch (e) { res.json({ announcements: [] }); }
});
app.get('/api/announcements/popup', (req, res) => {
  try { res.json({ announcement: getDb().prepare("SELECT id,title,content,type FROM announcements WHERE status='published' AND show_popup=1 ORDER BY is_pinned DESC,created_at DESC LIMIT 1").get() || null }); } catch (e) { res.json({ announcement: null }); }
});

// 音乐公开接口
app.get('/api/music', (req, res) => {
  try { res.json({ music: getDb().prepare('SELECT * FROM music ORDER BY sort_order').all() }); } catch (e) { res.json({ music: [] }); }
});

// 友链公开接口
app.get('/api/friend-links', (req, res) => {
  try { res.json({ links: getDb().prepare('SELECT * FROM friend_links ORDER BY sort_order').all() }); } catch (e) { res.json({ links: [] }); }
});

// 反馈公开接口
app.post('/api/feedback', (req, res) => {
  try {
    const { content, contact } = req.body;
    if (!content) return res.status(400).json({ error: '请输入内容' });
    getDb().prepare('INSERT INTO feedback (id,user_id,content,contact) VALUES (?,?,?,?)').run(uuidv4(), req.user?.id || null, content, contact || null);
    res.json({ message: '反馈已提交' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 维护预览
app.get('/api/maintenance/preview', (req, res) => {
  try {
    const s = loadSettings();
    res.json({ title: s.maintenanceTitle, message: s.maintenanceMessage, bgColor: s.maintenanceBgColor, icon: s.maintenanceIcon, countdown: s.maintenanceCountdown, contact: s.maintenanceContact, customCss: s.maintenanceCustomCss, customHtml: s.maintenanceCustomHtml });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 页面路由
app.get('/admin/super', (req, res) => res.sendFile(path.join(__dirname, '../admin/super/index.html')));
app.get('/admin/super/', (req, res) => res.sendFile(path.join(__dirname, '../admin/super/index.html')));
app.get('/admin/admin', (req, res) => res.sendFile(path.join(__dirname, '../admin/admin/index.html')));
app.get('/admin/admin/', (req, res) => res.sendFile(path.join(__dirname, '../admin/admin/index.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, '../views/chat.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// 通知接口
app.get('/api/notifications/unread-count', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ count: 0 });
    const jwt = require('jsonwebtoken');
    const d = jwt.verify(token, 'ys-forum-secret-key-2026');
    const count = getDb().prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(d.id).c;
    res.json({ count });
  } catch (e) { res.json({ count: 0 }); }
});

const PORT = process.env.PORT || 3000;
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');

initDatabase().then(() => {
  setupSocket(io);
  server.listen(PORT, () => {
    console.log(`🌸 YS论坛系统运行在 http://localhost:${PORT}`);
    console.log(`🔧 超管后台: http://localhost:${PORT}/admin/super/`);
    console.log(`🔧 管理后台: http://localhost:${PORT}/admin/admin/`);
    console.log(`👤 默认超管: admin / admin123`);
  });
}).catch(e => { console.error('启动失败:', e); process.exit(1); });
