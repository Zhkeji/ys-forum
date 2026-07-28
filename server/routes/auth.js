const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { getSetting } = require('../settings');

const r = express.Router();

r.post('/register', (req, res) => {
  try {
    const { username, password, nickname, email } = req.body;
    if (!username || !password || !nickname) return res.status(400).json({ error: '请填写所有信息' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: '用户名3-20字符' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    if (getSetting('allowRegister') !== 'true') return res.status(403).json({ error: '暂不开放注册' });
    const db = getDb();
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(400).json({ error: '用户名已存在' });
    if (email && db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(400).json({ error: '邮箱已注册' });
    const id = uuidv4(), points = parseInt(getSetting('registerPoints')) || 10;
    db.prepare("INSERT INTO users (id,username,password,nickname,email,points,role,status) VALUES (?,?,?,?,?,?,'user','active')").run(id, username, bcrypt.hashSync(password, 10), nickname, email || null, points);
    if (points > 0) db.prepare("INSERT INTO points_log (id,user_id,amount,reason) VALUES (?,?,?,?)").run(uuidv4(), id, points, '注册奖励');
    const u = db.prepare('SELECT id,username,nickname,avatar,role,points,level FROM users WHERE id=?').get(id);
    res.json({ message: '注册成功', token: generateToken(u), user: u });
  } catch (e) { console.error(e); res.status(500).json({ error: '注册失败' }); }
});

r.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入账号密码' });
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!u) return res.status(401).json({ error: '账号或密码错误' });
    if (u.status === 'banned') return res.status(403).json({ error: '账号已被封禁: ' + (u.ban_reason || '') });
    if (!bcrypt.compareSync(password, u.password)) return res.status(401).json({ error: '账号或密码错误' });
    db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(u.id);
    res.json({ message: '登录成功', token: generateToken(u), user: { id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar, role: u.role, bio: u.bio, points: u.points, level: u.level } });
  } catch (e) { res.status(500).json({ error: '登录失败' }); }
});

r.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

r.put('/profile', authenticate, (req, res) => {
  try {
    const { nickname, bio, avatar } = req.body;
    const db = getDb(), f = [], v = [];
    if (nickname) { if (nickname.length > 20) return res.status(400).json({ error: '昵称最长20字' }); f.push('nickname=?'); v.push(nickname); }
    if (bio !== undefined) { if (bio.length > 200) return res.status(400).json({ error: '简介最长200字' }); f.push('bio=?'); v.push(bio); }
    if (avatar) { f.push('avatar=?'); v.push(avatar); }
    if (!f.length) return res.status(400).json({ error: '无更新内容' });
    v.push(req.user.id);
    db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v);
    res.json({ message: '已更新', user: db.prepare('SELECT id,username,nickname,avatar,bio,role,points,level FROM users WHERE id=?').get(req.user.id) });
  } catch (e) { res.status(500).json({ error: '更新失败' }); }
});

r.put('/password', authenticate, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请输入密码' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
    const db = getDb();
    if (!bcrypt.compareSync(oldPassword, db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id).password)) return res.status(401).json({ error: '旧密码错误' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    res.json({ message: '密码已修改' });
  } catch (e) { res.status(500).json({ error: '修改失败' }); }
});

// 签到
r.post('/checkin', authenticate, (req, res) => {
  try {
    const db = getDb(), uid = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const last = db.prepare('SELECT created_at FROM checkin_records WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
    if (last && last.created_at && last.created_at.startsWith(today)) return res.status(400).json({ error: '今天已签到' });
    const points = parseInt(getSetting('checkinPoints')) || 5;
    db.prepare('INSERT INTO checkin_records (id,user_id,points) VALUES (?,?,?)').run(uuidv4(), uid, points);
    db.prepare('UPDATE users SET points=points+?, exp=exp+?, checkin_streak=checkin_streak+1, last_checkin=datetime("now") WHERE id=?').run(points, points, uid);
    db.prepare('INSERT INTO points_log (id,user_id,amount,reason) VALUES (?,?,?,?)').run(uuidv4(), uid, points, '每日签到');
    const user = db.prepare('SELECT points,level,exp,checkin_streak FROM users WHERE id=?').get(uid);
    res.json({ message: `签到成功 +${points}积分`, points: user.points, streak: user.checkin_streak });
  } catch (e) { res.status(500).json({ error: '签到失败' }); }
});

// 获取用户公开信息
r.get('/user/:id', (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT id,username,nickname,avatar,bio,points,level,created_at FROM users WHERE id=? AND status='active'").get(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const posts = db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=? AND status='published'").get(req.params.id).c;
    res.json({ user: { ...u, postCount: posts } });
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});

// 忘记密码（简单重置）
r.post('/forgot-password', (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) return res.status(400).json({ error: '请输入用户名和新密码' });
    if (newPassword.length < 6) return res.status(400).json({ error: '密码至少6位' });
    const db = getDb();
    const u = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), u.id);
    res.json({ message: '密码已重置，请使用新密码登录' });
  } catch (e) { res.status(500).json({ error: '重置失败' }); }
});

module.exports = r;
