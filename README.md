# 🌸 YS工作室论坛系统

全新毛玻璃（Glassmorphism）风格的信息交流社区系统。

## ✨ 功能特性

### 🌐 前台
- 毛玻璃UI + 樱花飘落特效
- 多板块分类帖子
- 点赞/收藏/评论（楼中楼）
- 实时私信聊天
- 每日签到 + 积分系统
- 排行榜
- 好友系统
- 公告（滚动/弹窗）
- 昼夜切换
- 音乐播放
- 友情链接
- 意见反馈
- 全局搜索

### 👑 超管后台 (`/admin/super/`)
- 数据仪表盘
- 帖子管理（审核/置顶/精华/删除）
- 用户管理（封禁/重置密码/修改积分）
- 评论管理
- 举报处理
- 公告管理（弹窗/滚动/置顶）
- 板块管理
- 管理员管理
- 私信管理（可介入）
- 网站设置（LOGO/名称/注册开关等）
- 敏感词管理
- 音乐管理
- 友链管理
- 反馈管理
- 维护系统（动态齿轮效果）

### 🔧 管理员后台 (`/admin/admin/`)
- 工作台
- 帖子管理
- 评论管理
- 举报处理
- 私信管理（可介入）

### 📱 Android App
- 用户端完整功能
- 管理员端
- 超管端
- 检查更新

---

## 🚀 部署

```bash
git clone https://github.com/Zhkeji/ys-forum.git
cd ys-forum
npm install
npm start
```

- 前台: http://localhost:3000
- 后台入口: http://localhost:3000/admin
- 超管: http://localhost:3000/admin/super/
- 管理员: http://localhost:3000/admin/admin/
- 账号: `admin` / `admin123`

---

## 📦 技术栈

- Node.js + Express
- SQLite (sql.js)
- Socket.IO
- JWT 认证
- 原生 HTML/CSS/JS 前端

---

## 📄 License

MIT License
