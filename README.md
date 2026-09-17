# Link Collector - 书签收藏管理工具

一个轻量级的书签/链接收藏管理工具，支持分类管理、标签筛选、搜索、浏览器书签导入和死链检测功能。

## 功能特性

- **链接 CRUD**: 添加、编辑、删除链接，支持 URL、标题、描述、标签和分类
- **浏览与搜索**: 分类侧边栏、标签云筛选、文本搜索、分页展示
- **导入浏览器书签**: 上传 Chrome 书签 HTML 文件，先预览（标注新建/已存在/地址不合法/文件内重复、待新建分类），可只勾选部分条目，支持"跳过/替换"重复策略；导入结果逐条留底并持久化
- **死链检测**: 检测所有保存链接的 HTTP 状态，展示失效链接
- **用户认证**: 基于 JWT + bcrypt 的注册/登录系统

## 技术栈

### 前端
- Vue 3 + Vite
- Vue Router
- Pinia (状态管理)
- Element Plus (UI 组件库)
- Axios (HTTP 客户端)

### 后端
- Node.js + Express
- better-sqlite3 (SQLite 数据库)
- jsonwebtoken (JWT 认证)
- bcryptjs (密码加密)
- multer (文件上传)

## 快速开始

### 环境要求

- Node.js 18+ (需要原生 fetch 支持)
- npm 或 yarn

### 安装

1. 克隆或进入项目目录：

```bash
cd link-collector
```

2. 安装后端依赖：

```bash
cd backend
npm install
```

3. 初始化数据库并添加示例数据：

```bash
npm run seed
```

4. 安装前端依赖：

```bash
cd ../frontend
npm install
```

### 运行

1. 启动后端服务器 (端口 3004)：

```bash
cd backend
npm run dev
```

2. 启动前端开发服务器 (端口 5176)：

```bash
cd frontend
npm run dev
```

3. 打开浏览器访问：http://localhost:5176

### 演示账号

- 用户名: `demo`
- 密码: `demo123`

## 项目结构

```
link-collector/
├── frontend/                 # 前端项目
│   ├── src/
│   │   ├── api/             # API 请求封装
│   │   ├── components/      # Vue 组件
│   │   ├── router/          # 路由配置
│   │   ├── stores/          # Pinia 状态管理
│   │   ├── views/           # 页面视图
│   │   ├── App.vue
│   │   └── main.js
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/                  # 后端项目
│   ├── db/
│   │   ├── init.js          # 数据库初始化
│   │   └── seed.js          # 示例数据
│   ├── middleware/
│   │   └── auth.js          # JWT 认证中间件
│   ├── routes/
│   │   ├── auth.js          # 认证路由
│   │   ├── links.js         # 链接路由
│   │   ├── categories.js    # 分类路由
│   │   ├── import.js        # 导入路由
│   │   └── health-check.js  # 死链检测路由
│   ├── utils/
│   │   ├── bookmark-parser.js  # 书签解析器
│   │   └── link-checker.js     # 链接检测器
│   ├── data/                # SQLite 数据库文件
│   ├── server.js
│   └── package.json
└── README.md
```

## API 接口

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 链接
- `GET /api/links` - 获取链接列表 (支持分页、分类、标签、搜索筛选)
- `POST /api/links` - 创建链接
- `PUT /api/links/:id` - 更新链接
- `DELETE /api/links/:id` - 删除链接

### 分类
- `GET /api/categories` - 获取用户分类列表
- `POST /api/categories` - 创建分类
- `PUT /api/categories/:id` - 更新分类
- `DELETE /api/categories/:id` - 删除分类

### 标签
- `GET /api/tags` - 获取用户所有标签 (带计数)

### 导入
- `POST /api/import/bookmarks/preview` - 上传书签文件并生成预览（只解析，不写入链接/分类），返回逐条状态
- `POST /api/import/bookmarks/:id/commit` - 提交选中条目（支持 `duplicate_action=skip|replace`），逐条独立事务
- `GET /api/import/bookmarks/reports` - 导入历史列表
- `GET /api/import/bookmarks/reports/:id` - 某次导入的逐条明细（含链接库当前总数）
- `DELETE /api/import/bookmarks/reports/:id` - 删除导入明细记录（不影响已导入链接）

### 死链检测
- `POST /api/health-check/all` - 检测所有链接
- `GET /api/health-check/dead` - 获取失效链接列表

## 数据库表结构

- **users**: 用户表 (id, username, email, password, created_at)
- **categories**: 分类表 (id, user_id, name, color)
- **links**: 链接表 (id, user_id, url, title, description, category_id, status, last_checked, created_at)
- **link_tags**: 标签关联表 (id, link_id, tag)
- **import_reports**: 导入报告表 (id, user_id, filename, status[preview/committed/superseded], 各类计数, duplicate_action, superseded_by, created_at, committed_at)
- **import_items**: 导入条目明细表 (id, report_id, url, title, folder, preview_status[new/existing/invalid], final_status[imported/replaced/skipped_*], existing_link_id, new_link_id, invalid_reason, duplicate_in_file, selected, detail)

## 导入 Chrome 书签

1. 在 Chrome 浏览器中导出书签为 HTML 文件
2. 进入 "导入书签" 页面，选择文件后点击 "生成预览"（此阶段不写入任何数据）
3. 在预览页核对：
   - **新建**：库中没有的地址；**库中已存在**：会按所选策略跳过或替换
   - **文件内重复**：同一文件内多次出现的地址，默认只导入第一次
   - **地址不合法**：非 http/https、格式错误或空地址，无法勾选
   - 页面会列出本次"将新建的分类"
4. 用筛选与复选框只挑需要的条目，选择重复策略（跳过 / 替换标题与分类），然后导入
5. 结果页给出每条的最终去向（新建 / 替换 / 跳过原因 / 失败）和链接库总数；
   明细保存在服务端，刷新或重新登录后仍可在 "最近的导入记录" 中查看。
   同名文件再次导入时会提示历史明细将被标记为"被替换"还是保留。

### 取消与损坏文件

- 文件为空、二进制或不是书签导出文件时，停在选择文件这一步并写明原因，链接库不发生任何改动。
- 用户在预览页取消时不执行写入；预览明细仍保留在导入历史中。
- 导入按条目逐条提交，单条失败只标记该条，已导入的条目不回退；
  若请求中途被取消，可用 "查询导入结果" 拉取服务端实际状态（提交接口幂等，重复提交不会二次导入）。

## License

MIT
