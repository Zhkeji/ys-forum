const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getSetting } = require('../settings');

const r = express.Router();

// 敏感词过滤
function filterText(text) {
  try {
    const db = getDb();
    const words = db.prepare('SELECT word,replacement FROM sensitive_words').all();
    let t = text;
    words.forEach(w => { t = t.replace(new RegExp(w.word, 'gi'), w.replacement || '***'); });
    return t;
  } catch (e) { return text; }
}

// 获取板块列表
r.get('/forums', (req, res) => {
  try {
    const forums = getDb().prepare("SELECT * FROM forums WHERE status='active' ORDER BY sort_order").all();
    res.json({ forums });
  } catch (e) { res.status(500).json({ error: '获取失败' }); }
});

// 获取帖子列表
r.get('/', optionalAuth, (req, res) => {
  try {
    const db = getDb(), page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit, sort = req.query.sort || 'latest';
    const forumId = req.query.forum, search = req.query.search;

    let w = "WHERE p.status = 'published'", params = [];
    if (forumId) { w += ' AND p.forum_id=?'; params.push(forumId); }
    if (search) { w += ' AND (p.title LIKE ? OR p.content LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    let o = 'ORDER BY p.is_pinned DESC, p.created_at DESC';
    if (sort === 'hot') o = 'ORDER BY p.is_pinned DESC, p.likes DESC';
    if (sort === 'views') o = 'ORDER BY p.is_pinned DESC, p.views DESC';
    if (sort === 'comments') o = 'ORDER BY p.is_pinned DESC, p.comments_count DESC';
    if (sort === 'essence') { w += " AND p.is_essence=1"; o = 'ORDER BY p.created_at DESC'; }

    const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${w}`).get(...params).c;
    const posts = db.prepare(`SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.id as author_id,u.level as author_level,f.name as forum_name FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN forums f ON p.forum_id=f.id ${w} ${o} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({
      posts: posts.map(x => {
        let img = [], tag = [];
        try { img = JSON.parse(x.images); } catch (e) {}
        try { tag = JSON.parse(x.tags); } catch (e) {}
        const liked = req.user ? !!db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, x.id) : false;
        const favorited = req.user ? !!db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, x.id) : false;
        return { ...x, images: img, tags: tag, isLiked: liked, isFavorited: favorited, author_name: x.is_anonymous ? '匿名用户' : x.author_name, author_avatar: x.is_anonymous ? '/img/default-avatar.png' : x.author_avatar, author_id: x.is_anonymous ? null : x.author_id };
      }),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: '获取失败' }); }
});

// 获取单个帖子
r.get('/:id', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE posts SET views=views+1 WHERE id=?').run(req.params.id);
    const p = db.prepare("SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.id as author_id,u.level as author_level,f.name as forum_name FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN forums f ON p.forum_id=f.id WHERE p.id=? AND p.status!='deleted'").get(req.params.id);
    if (!p) return res.status(404).json({ error: '帖子不存在' });
    let img = [], tag = [];
    try { img = JSON.parse(p.images); } catch (e) {}
    try { tag = JSON.parse(p.tags); } catch (e) {}
    const liked = req.user ? !!db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, p.id) : false;
    const favorited = req.user ? !!db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, p.id) : false;

    // 获取评论（楼中楼）
    const comments = db.prepare("SELECT c.*,u.nickname as author_name,u.avatar as author_avatar FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? AND c.status='published' ORDER BY c.floor_num ASC").all(req.params.id);
    const commentMap = {};
    comments.forEach(c => { c.replies = []; commentMap[c.id] = c; });
    const rootComments = [];
    comments.forEach(c => {
      if (c.parent_id && commentMap[c.parent_id]) commentMap[c.parent_id].replies.push(c);
      else rootComments.push(c);
    });

    res.json({
      post: { ...p, images: img, tags: tag, isLiked: liked, isFavorited: favorited, author_name: p.is_anonymous ? '匿名用户' : p.author_name, author_avatar: p.is_anonymous ? '/img/default-avatar.png' : p.author_avatar, author_id: p.is_anonymous ? null : p.author_id },
      comments: rootComments
    });
  } catch (e) { console.error(e); res.status(500).json({ error: '获取失败' }); }
});

// 发帖
r.post('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    let { title, content, images, isAnonymous, tags, category, forumId } = req.body;
    if (!title || !content) return res.status(400).json({ error: '请输入标题和内容' });
    title = filterText(title); content = filterText(content);
    const st = getSetting('postReview') === 'true' ? 'pending' : 'published';
    const id = uuidv4();
    db.prepare("INSERT INTO posts (id,user_id,forum_id,title,content,images,is_anonymous,tags,status) VALUES (?,?,?,?,?,?,?,?,?)").run(id, req.user.id, forumId || null, title, content, JSON.stringify(images || []), isAnonymous ? 1 : 0, JSON.stringify(tags || []), st);
    // 加积分
    db.prepare('UPDATE users SET points=points+2, exp=exp+2 WHERE id=?').run(req.user.id);
    db.prepare('INSERT INTO points_log (id,user_id,amount,reason) VALUES (?,?,?,?)').run(uuidv4(), req.user.id, 2, '发布帖子');
    res.json({ message: st === 'pending' ? '发布成功，等待审核' : '发布成功', post: { id, title, status: st } });
  } catch (e) { res.status(500).json({ error: '发布失败' }); }
});

// 点赞
r.post('/:id/like', authenticate, (req, res) => {
  try {
    const db = getDb(), p = db.prepare('SELECT id,likes,user_id FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '不存在' });
    const ex = db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, req.params.id);
    if (ex) { db.prepare('DELETE FROM likes WHERE id=?').run(ex.id); db.prepare('UPDATE posts SET likes=MAX(0,likes-1) WHERE id=?').run(req.params.id); res.json({ liked: false, likes: p.likes - 1 }); }
    else { db.prepare("INSERT INTO likes (id,user_id,target_id,target_type) VALUES (?,?,?,'post')").run(uuidv4(), req.user.id, req.params.id); db.prepare('UPDATE posts SET likes=likes+1 WHERE id=?').run(req.params.id); res.json({ liked: true, likes: p.likes + 1 }); }
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 收藏
r.post('/:id/favorite', authenticate, (req, res) => {
  try {
    const db = getDb();
    const ex = db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, req.params.id);
    if (ex) { db.prepare('DELETE FROM favorites WHERE id=?').run(ex.id); db.prepare('UPDATE posts SET favorites=MAX(0,favorites-1) WHERE id=?').run(req.params.id); res.json({ favorited: false }); }
    else { db.prepare('INSERT INTO favorites (id,user_id,post_id) VALUES (?,?,?)').run(uuidv4(), req.user.id, req.params.id); db.prepare('UPDATE posts SET favorites=favorites+1 WHERE id=?').run(req.params.id); res.json({ favorited: true }); }
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 评论
r.post('/:id/comments', authenticate, (req, res) => {
  try {
    const db = getDb();
    let { content, parentId, replyToId } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '请输入评论' });
    content = filterText(content);
    const p = db.prepare("SELECT id,user_id,title FROM posts WHERE id=? AND status='published'").get(req.params.id);
    if (!p) return res.status(404).json({ error: '帖子不存在' });
    const floor = (db.prepare('SELECT MAX(floor_num) as m FROM comments WHERE post_id=?').get(req.params.id).m || 0) + 1;
    const id = uuidv4();
    db.prepare('INSERT INTO comments (id,post_id,user_id,parent_id,reply_to_id,content,floor_num) VALUES (?,?,?,?,?,?,?)').run(id, req.params.id, req.user.id, parentId || null, replyToId || null, content, floor);
    db.prepare('UPDATE posts SET comments_count=comments_count+1 WHERE id=?').run(req.params.id);
    db.prepare('UPDATE users SET points=points+1,exp=exp+1 WHERE id=?').run(req.user.id);
    const c = db.prepare('SELECT c.*,u.nickname as author_name,u.avatar as author_avatar FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.id=?').get(id);
    res.json({ message: '评论成功', comment: c });
  } catch (e) { res.status(500).json({ error: '评论失败' }); }
});

// 举报
r.post('/:id/report', authenticate, (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: '请填写原因' });
    const db = getDb();
    if (db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_id=? AND status='pending'").get(req.user.id, req.params.id)) return res.status(400).json({ error: '已举报过' });
    db.prepare("INSERT INTO reports (id,reporter_id,target_id,target_type,reason) VALUES (?,?,?,'post',?)").run(uuidv4(), req.user.id, req.params.id, reason);
    res.json({ message: '举报已提交' });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 获取标签
r.get('/meta/tags', (req, res) => {
  try {
    const tc = {};
    getDb().prepare("SELECT tags FROM posts WHERE status='published'").all().forEach(x => { try { JSON.parse(x.tags).forEach(t => { tc[t] = (tc[t] || 0) + 1; }); } catch (e) {} });
    res.json({ tags: Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => ({ name: n, count: c })) });
  } catch (e) { res.json({ tags: [] }); }
});

module.exports = r;
