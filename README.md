# MultiAlpha WebUI

> RD-Agent 量化研究平台的前端界面 | 零构建工具，纯 HTML/CSS/JS

## 文件结构

```
multialpha-webui/
├── multialpha.html      # 主页面 (HTML 结构)
├── style.css            # 样式 (CSS 变量设计系统)
├── app.js               # 业务逻辑 (原生 JS, 无框架)
├── socket.io.min.js     # Socket.IO 客户端 (实时通信)
├── App logo.jpg         # 品牌 Logo
├── docs/
│   ├── architecture.md      # 前端架构文档
│   └── technical-spec.md    # 技术方案文档
├── deploy.sh            # 部署脚本
└── .gitignore
```

## 快速开始

### 本地开发

直接用浏览器打开 `multialpha.html` 即可预览 UI（无后端数据）。

### 部署到 RD-Agent

```bash
# 方法 1: 部署脚本（推荐）
./deploy.sh /path/to/rdagent/git_ignore_folder/static

# 方法 2: 手动复制
cp multialpha.html style.css app.js socket.io.min.js "App logo.jpg" /path/to/static/
```

### 完整运行（需要后端）

```bash
cd /path/to/rdagent
export UI_STATIC_PATH=$(pwd)/multialpha-webui  # 直接指向此目录
python webui_main.py
# → http://localhost:19899/multialpha.html
```

## 技术栈

| 层面 | 选型 |
|------|------|
| HTML | 原生 HTML5, 语义化标签 |
| CSS | CSS 变量 + Flexbox, 零预处理 |
| JS | 原生 ES6+, 无框架/无构建 |
| 实时通信 | Socket.IO (polling) + HTTP fallback |
| 字体 | Google Fonts (JetBrains Mono + Noto Sans SC) |
| 图表 | iframe + ECharts/Plotly |

## 核心特性

- **实时更新**: Socket.IO 推送，< 1s 延迟
- **虚拟滚动日志**: 支持无限日志，DOM 只渲染可视区域
- **Token 看板**: 实时 LLM 调用统计
- **Pipeline 可视化**: 研究 → 编码 → 回测 → 反馈 全流程
- **响应式布局**: 桌面/平板/移动端自适应

## 后端 API 依赖

| 端点 | 方法 | 用途 |
|------|------|------|
| `/traces` | GET | Trace 列表 |
| `/trace` | POST | 消息获取 (首次加载) |
| `/receive` | POST | 工作进程推送 (触发 Socket.IO emit) |
| `/control` | POST | 任务控制 |
| `/socket.io/` | WS | 实时消息推送 |
| `/logs/sse` | GET | SSE 日志流 |

## 与 RD-Agent 的关系

本仓库是 [RD-Agent](https://github.com/microsoft/RD-Agent) 的前端独立管理仓库。

- 后端代码: `rdagent/log/server/app.py`
- 数据层: `rdagent/log/ui/storage.py`
- 前端 (本仓库): `git_ignore_folder/static/`

前端通过 `UI_STATIC_PATH` 环境变量告诉后端去哪里找静态文件，两者完全解耦。

## License

Same as RD-Agent.
