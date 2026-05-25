# 群宝箱 (group-vault)

QQ 群组媒体资源收集与标签管理工具。自动收集群内图片、视频和文件，按日期归档，支持标签分类、Web 浏览、群内命令发送。

## 功能

- **自动收集** — 监听 QQ 群消息，自动下载图片、视频和文件，按日期归档
- **跨群收集** — 静默模式下可从 bot 所在的任何群组收集媒体，无需配置群号
- **群组名称** — 消息和图片自动显示来源群组名称
- **Web 画廊** — 响应式图片网格浏览，支持 Lightbox 大图预览、键盘导航
- **消息视图** — 2-3 瀑布流布局，单媒体突出展示，支持多种消息类型筛选
- **标签系统** — 手动打标签 + 自动识别表情包（GIF/小图/方形图）
- **群内命令** — `#标签名` 随机发送 5 张匹配图片，`#标签名 N` 随机发送 N 张
- **WebUI 上传** — 左右分栏布局，拖拽上传，支持图片/视频/文件，批量添加标签
- **图片去重** — 基于 MD5 + 感知哈希扫描重复图片，支持自动选择和批量删除
- **批量操作** — 多选图片批量添加/删除标签
- **状态保持** — 画廊/消息视图切换后刷新页面自动恢复
- **消息适配器** — 可扩展架构，支持对接不同消息源

## 快速开始

```bash
# 克隆项目
git clone https://github.com/yourname/group-vault.git
cd group-vault

# 安装依赖
npm install

# 配置
cp config.example.json config.json
# 编辑 config.json，填入你的 NapCat 配置

# 开发模式运行
npm run dev

# 或编译后运行
npm run build
npm start
```

## 配置

`config.json` 字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | number | HTTP 服务端口，默认 `3000` |
| `host` | string | 监听地址，`0.0.0.0` 表示所有网卡 |
| `publicHost` | string | 公网 IP 或域名，用于生成图片 URL |
| `token` | string | NapCat WebSocket 访问令牌 |
| `wsUrl` | string | NapCat WebSocket 地址，如 `ws://192.168.1.100:6101` |
| `groupId` | number | 目标群号（非静默模式下用于交互式标签提示） |
| `prod` | boolean | 生产模式，设为 `true` 关闭调试日志 |
| `silent` | boolean | 静默模式，设为 `true` 从任何群组静默收集媒体，不发送任何回复 |

### 静默模式

将 `silent` 设为 `true` 后，bot 不会回复任何消息，只在后台静默收集所有群组的图片、视频和文件。此时 `groupId` 仅用于非静默模式下的交互式标签功能，可随意填写。

## 群内命令

| 命令 | 说明 |
|------|------|
| `#标签名` | 随机发送 5 张该标签的图片 |
| `#标签名 3` | 随机发送 3 张该标签的图片 |
| `#tags` / `#标签` | 列出所有标签及数量 |

### 交互式打标签

群内发送图片后，bot 会提示输入标签。5 分钟内发送标签文字即可关联，发送「取消」放弃。

## WebUI

- `/` — 画廊 + 消息视图（显示群组名称，刷新保持当前视图）
- `/upload` — 左右分栏上传页面
- `/dedup` — 重复图片扫描与清理

### 画廊功能
- 图片网格浏览，悬浮显示删除按钮
- Lightbox 大图预览，左右键导航
- 日期/标签筛选
- 多选模式：批量添加/删除标签
- 右上角刷新按钮

### 消息功能
- 2-3 瀑布流布局，单媒体消息突出展示
- 单张图片全宽显示，单个视频全宽播放，单个文件美化卡片
- 多媒体消息缩略图网格，显示标签
- 按时间线展示，显示昵称、群组名称、时间
- 支持图片/视频/文件/转发/@/表情等多种消息类型
- 类型筛选：纯文字、图片、视频、文件
- 点击图片 Lightbox 预览，支持删除

### 上传功能
- 左侧拖拽区 + 右侧文件列表
- 全局标签 + 每文件独立标签
- 支持图片、视频、文件（单个最大 100MB，最多 20 个）
- 上传进度条

### 去重功能
- 基于 MD5 精确匹配 + 感知哈希（pHash）相似度检测
- 自动选择：保留每组最大文件
- 批量删除，确保每组至少保留一张

## API

### 标签

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/tags` | 获取所有标签及数量 |
| `GET` | `/api/tags/:tag` | 获取某标签的图片列表 |
| `POST` | `/api/tags` | 设置单个图片标签 `{localPath, tags[]}` |
| `POST` | `/api/tags/batch` | 批量设置标签 `{localPaths[], tags[], mode}` |

`mode` 可选值：`add`（追加）、`set`（覆盖）、`remove`（删除）

### 消息与图片

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/messages` | 分页消息，支持 `?date=&type=&tag=&page=&limit=` |
| `GET` | `/api/images` | 分页图片列表，支持 `?date=&tag=&page=&limit=` |
| `GET` | `/api/dates` | 获取所有日期及消息数 |

### 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/upload` | 上传文件（multipart/form-data） |
| `DELETE` | `/api/files/*path` | 删除文件（移到回收站） |

### 去重

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/dedup/scan` | 扫描重复图片（MD5 + pHash） |
| `POST` | `/api/dedup/delete` | 批量删除重复图片 `{paths[]}` |

## 二次开发 — 消息适配器

群宝箱使用适配器模式分离消息收发逻辑，方便对接不同 IM 平台。

### 接口定义

```typescript
// src/types.ts
interface MessageSource {
  name: string;
  connect(): void;
  onMessage(handler: (event: GroupMessageEvent) => Promise<void>): void;
  disconnect(): void;
}

interface MessageSender {
  name: string;
  sendGroupMsg(groupId: number, message: Segment[]): Promise<any>;
  getGroupName(groupId: number): Promise<string>;
}
```

### 自定义适配器

1. 在 `src/adapters/` 下创建新文件，实现 `MessageSource` + `MessageSender`
2. 在 `src/adapters/index.ts` 的 `createAdapter` 中添加路由逻辑

示例：

```typescript
// src/adapters/webhook.ts
import type { MessageSource, MessageSender, GroupMessageEvent, Segment } from '../types.js';

export class WebhookAdapter implements MessageSource, MessageSender {
  name = 'webhook';

  private handler: ((event: GroupMessageEvent) => Promise<void>) | null = null;

  connect(): void {
    // 在 Express 中注册 webhook 路由
    // POST /webhook → 解析 OneBot 11 事件 → 调用 this.handler
  }

  onMessage(handler: (event: GroupMessageEvent) => Promise<void>): void {
    this.handler = handler;
  }

  disconnect(): void { /* 清理 */ }

  async sendGroupMsg(groupId: number, message: Segment[]): Promise<any> {
    // 调用目标 IM 的 API 发送消息
  }

  async getGroupName(groupId: number): Promise<string> {
    // 返回群组名称，用于界面显示
    return String(groupId);
  }
}
```

3. 更新 `createAdapter`：

```typescript
export function createAdapter(config: Config): MessageAdapter {
  // 根据配置或环境变量选择适配器
  return new NapCatAdapter(config);
}
```

### 适配其他 IM

| 平台 | 需要实现 |
|------|---------|
| OneBot 11 HTTP | WebhookAdapter，接收 POST 回调 |
| 钉钉机器人 | DingTalkAdapter，调用钉钉开放平台 API |
| Telegram Bot | TelegramAdapter，使用 Bot API 轮询或 Webhook |
| 飞书机器人 | FeishuAdapter，调用飞书开放平台 API |

## 技术栈

- **后端** — TypeScript, Express v5, WebSocket, sharp (pHash)
- **前端** — Vanilla JS, Tailwind CSS (CDN)
- **协议** — OneBot 11 (NapCat)

## 目录结构

```
group-vault/
├── src/
│   ├── index.ts           # 入口
│   ├── config.ts          # 配置加载
│   ├── types.ts           # 类型定义（含适配器接口）
│   ├── store.ts           # 数据持久化
│   ├── helpers.ts         # 工具函数
│   ├── handler.ts         # 消息业务逻辑
│   ├── dedup.ts           # 重复图片检测（MD5 + pHash）
│   ├── adapters/
│   │   ├── napcat.ts      # NapCat WS 适配器
│   │   └── index.ts       # 适配器工厂
│   └── routes/
│       ├── tags.ts        # 标签 API
│       ├── messages.ts    # 消息 API
│       ├── files.ts       # 文件 API
│       ├── upload.ts      # 上传 API
│       └── dedup.ts       # 去重 API
├── webui/
│   ├── index.html         # 主页面（画廊 + 消息）
│   ├── upload.html        # 上传页面
│   ├── dedup.html         # 去重页面
│   └── favicon.svg        # 网站图标
├── storage/               # 运行时数据（已 gitignore）
│   ├── data/              # JSON 数据（messages.json, tags.json）
│   ├── downloads/         # 下载的媒体文件
│   └── recycle/           # 回收站
├── config.json            # 配置文件
└── package.json
```

## License

MIT
