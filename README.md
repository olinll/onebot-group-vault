# group-vault

QQ 群组媒体资源收集与标签管理工具。自动收集群内图片和文件，支持标签分类、Web 浏览、群内命令发送。

## 功能

- **自动收集** — 监听 QQ 群消息，自动下载图片和文件，按日期归档
- **Web 画廊** — 响应式图片浏览，支持 Lightbox 大图预览、键盘导航
- **标签系统** — 手动打标签 + 自动识别表情包（GIF/小图/方形图）
- **群内命令** — `#标签名` 随机发送 5 张匹配图片，`#标签名 3` 发送第 3 张
- **WebUI 上传** — 拖拽上传文件，支持批量添加标签
- **批量操作** — 多选图片批量添加/删除标签
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
| `port` | number | HTTP 服务端口 |
| `host` | string | 监听地址，`0.0.0.0` 表示所有网卡 |
| `publicHost` | string | 公网 IP 或域名，用于生成图片 URL |
| `token` | string | NapCat WebSocket 访问令牌 |
| `wsUrl` | string | NapCat WebSocket 地址，如 `ws://192.168.1.100:6101` |
| `groupId` | number | 监听的 QQ 群号 |
| `prod` | boolean | 生产模式，设为 `true` 关闭调试日志 |

## 群内命令

| 命令 | 说明 |
|------|------|
| `#标签名` | 随机发送 5 张该标签的图片 |
| `#标签名 3` | 发送第 3 张（按存储顺序） |
| `#标签名 10` | 超出总数时发送全部 |
| `#tags` / `#标签` | 列出所有标签及数量 |

### 交互式打标签

群内发送图片后，bot 会提示输入标签。5 分钟内发送标签文字即可关联，发送「取消」放弃。

## WebUI

- `/` — Gallery 画廊 + Messages 消息视图
- `/upload` — 文件上传页面

### Gallery 功能
- 图片网格浏览，悬浮显示删除按钮
- Lightbox 大图预览，左右键导航
- 标签筛选下拉
- 多选模式：批量添加/删除标签

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

## 二次开发 — 消息适配器

group-vault 使用适配器模式分离消息收发逻辑，方便对接不同 IM 平台。

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

- **后端** — TypeScript, Express v5, WebSocket
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
│   ├── adapters/
│   │   ├── napcat.ts      # NapCat WS 适配器
│   │   └── index.ts       # 适配器工厂
│   └── routes/
│       ├── tags.ts        # 标签 API
│       ├── messages.ts    # 消息 API
│       ├── files.ts       # 文件 API
│       └── upload.ts      # 上传 API
├── webui/
│   ├── index.html         # 主页面
│   └── upload.html        # 上传页面
├── storage/               # 运行时数据（已 gitignore）
│   ├── data/              # JSON 数据（messages.json, tags.json）
│   ├── downloads/         # 下载的媒体文件
│   └── recycle/           # 回收站
├── config.json            # 配置文件
└── package.json
```

## License

MIT
