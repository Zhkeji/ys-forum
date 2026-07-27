const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const SECRET = 'ys-forum-secret-key-2026';

function generateToken(u) { return jwt.sign({ id: u.id, username: u.username, role: u.role }, SECRET, { expiresIn: '7d' }); }

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const d = jwt.verify(token, SECRET);
    const u = getDb().prepare('SELECT id,username,nickname,avatar,role,status,bio,points,level,admin_permissions FROM users WHERE id=?').get(d.id);
    if (!u) return res.status(401).json({ error: '用户不存在' });
    if (u.status === 'banned') return res.status(403).json({ error: '账号已被封禁' });
    // 解析权限
    let perms = [];
    try { perms = JSON.parse(u.admin_permissions || '[]'); } catch (e) {}
    u.permissions = perms;
    req.user = u; next();
  } catch (e) { return res.status(401).json({ error: '登录已过期' }); }
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) try {
    const d = jwt.verify(token, SECRET);
    const u = getDb().prepare('SELECT id,username,nickname,avatar,role,status,admin_permissions FROM users WHERE id=?').get(d.id);
    if (u && u.status !== 'banned') {
      let perms = [];
      try { perms = JSON.parse(u.admin_permissions || '[]'); } catch (e) {}
      u.permissions = perms;
      req.user = u;
    }
  } catch (e) {}
  next();
}

// 管理员权限检查（超管拥有全部权限，管理员需要勾选）
function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// 检查具体权限（管理员需要对应权限，超管自动通过）
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: '需要管理员权限' });
    if (req.user.role === 'super_admin') return next(); // 超管直接通过
    if (req.user.permissions && req.user.permissions.includes(perm)) return next();
    return res.status(403).json({ error: `没有${perm}权限` });
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') return res.status(403).json({ error: '需要超级管理员权限' });
  next();
}

module.exports = { generateToken, authenticate, optionalAuth, requireAdmin, requirePermission, requireSuperAdmin };
