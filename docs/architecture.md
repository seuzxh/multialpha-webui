# Multialpha WebUI 前端架构文档

> 文件：`git_ignore_folder/static/multialpha.html`
> 单文件 SPA，约 4000 行，零构建工具，原生 HTML/CSS/JS

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        body (100vh)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  .topbar (56px, fixed)                  │  │
│  │  Logo │ Trace Title │ Status │ Controls │ Clock         │  │
│  ├──────────┬───────────────────────────┬──────────────────┤  │
│  │ .sidebar │        .center             │   .results      │  │
│  │ (280px)  │     (flex:1, scrollable)   │   (360px)       │  │
│  │          │                            │                  │  │
│  │ Task     │  ┌─ .center-header ──────┐ │  Metrics        │  │
│  │ List     │  ├─ .pipeline ───────────┤ │  Hypothesis     │  │
│  │          │  ├─ .task-brief ─────────┤ │  Feedback       │  │
│  │ History  │  ├─ .agent-flow ────────┤ │  Knowledge      │  │
│  │          │  ├─ .loop-bar ──────────┤ │                  │  │
│  │          │  ├─ .token-dash ────────┤ │                  │  │
│  │          │  ├─ .center-result ─────┤ │                  │  │
│  │          │  │   (factors/chart/code)│ │                  │  │
│  │          │  └─ .empty/.landing ────┘ │                  │  │
│  │          │     (首页 hero + 启动器)    │                  │  │
│  ├──────────┴───────────────────────────┴──────────────────┤  │
│  │              .log-float (position:fixed, SSE日志)        │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 布局模式

| 模式 | 触发条件 | 特征 |
|------|----------|------|
| **Landing** | 首次打开 / 点击 Logo | sidebar 隐藏, results 隐藏, center 全宽, 显示 hero |
| **Detail** | 选择任务后 | sidebar 显示, results 显示, center 显示 pipeline |
| **Landing + Drawer** | Landing 模式点击"任务"按钮 | 弹出 task-drawer 浮层 |

切换由 `.main.landing-mode` CSS 类控制。

### 1.2 Flex 高度链（关键）

从 body 到滚动容器的完整链路：

```
body            height:100vh; overflow:hidden
  └─ .main      flex:1; min-height:0
    └─ .center  flex:1; min-height:0; overflow-y:auto  ← 主滚动容器
      └─ 子元素  flex-shrink:0 (固定高) 或 flex:1; min-height:0 (可伸缩)
```

**设计原则**：所有弹性容器必须用 `flex:1; min-height:0`，不依赖 `height:100%`。

---

## 2. 数据流架构

### 2.1 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `GET /traces` | GET | 获取所有 trace ID 列表 |
| `POST /trace` | POST | 获取指定 trace 的消息（支持增量/全量） |
| `GET /stream/<id>` | GET (SSE) | 实时日志流 |
| `POST /control` | POST | 控制任务（pause/resume/stop） |
| `POST /upload` | POST | 上传文件启动新任务 |

### 2.2 消息类型（tag）

```
研究阶段:  research.hypothesis, research.tasks
编码阶段:  evolving.codes, evolving.feedbacks
回测阶段:  feedback.metric, feedback.return_chart, feedback.config
反馈阶段:  feedback.hypothesis_feedback
系统:      startup, END, token_cost
```

### 2.3 轮询策略

```
                    ┌──────────────────┐
                    │  selectTrace(id) │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ fetchTrace(all)  │ ← 一次性加载全部消息
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │ renderPipeline│ │renderToken│ │renderResults│
     └───────────────┘ └──────────┘ └─────────────┘
                             │
                    ┌────────▼─────────┐
                    │  任务未完成？     │
                    └────────┬─────────┘
                      Yes    │    No
                 ┌───────────┘    └──────────┐
          ┌──────▼──────┐              ┌──────▼──────┐
          │ startPolling│              │ stopPolling │
          │ (5s interval)│              └─────────────┘
          └─────────────┘
```

**增量轮询**：每 5 秒请求新消息 `{id, all:false}`，只追加到 `currentMsgs`。
**条件渲染**：只有包含结果类 tag 的新消息才触发 `renderResults`。

### 2.4 全局状态

```javascript
let traces = [];          // 所有 trace ID
let currentTraceId = null; // 当前选中
let currentMsgs = [];     // 当前消息（只增不减）
let selectedLoop = null;  // 选中的 loop
let centerResultTab = 'factors'; // factors | chart | code | conclusion
let pollTimer = null;     // 轮询定时器
let logSSE = null;        // SSE 连接
let _selectGen = 0;       // 竞态守卫计数器
```

---

## 3. 渲染管线

### 3.1 渲染函数清单

| 函数 | 目标 DOM | 触发时机 | 复杂度 |
|------|----------|----------|--------|
| `renderTaskList` | `.sidebar` | 任务列表变化 | O(n) n=任务数 |
| `renderPipeline` | `.pipeline` + `.agent-flow` | 消息更新 | O(n) n=消息数 |
| `renderTaskBrief` | `.task-brief` | 消息更新 | O(1) tagIndex |
| `renderAgentFlow` | `.agent-flow` | 消息更新 | O(1) tagIndex |
| `renderTokenDash` | `.token-dash` | 消息更新 | O(n) n=token消息数 |
| `renderLoopBar` | `.loop-bar` | 消息更新 | O(n) |
| `renderResults` | `.center-result` + `.results` | 结果类消息更新 | O(n) |
| `renderCenterResult` | `.center-result-body` | tab切换/结果更新 | O(n) |

### 3.2 渲染优化策略

1. **竞态守卫**：`_selectGen` 计数器，快速切换任务时丢弃过期响应
2. **独立 try-catch**：每个渲染函数独立捕获错误，防止级联失败
3. **增量渲染**：轮询时只对包含新数据的面板执行重渲染
4. **tagIndex**：构建 `{tag: msg}` 索引，O(1) 查找替代 O(n) 遍历
5. **iframe 缓存**：chart 内容未变时跳过重建
6. **日志 DOM 上限**：最多保留 500 行，超出自动移除旧行

---

## 4. 品牌标识系统

### 4.1 Wordmark

```
α-lpha  ——  金色渐变 α + 白色 lpha + 金色上标 1
```

### 4.2 V 徽章（SVG）

6 根 K 线构成的 V 形反转形态：
- K1-K2：绿色下跌（左臂下降）
- K3：红色 doji（V 底）
- K4-K6：红色上涨（右臂上升，K6 最高点）
- K6 上方：金色 V 字（窄角度 < 45°，发光效果）

### 4.3 色彩系统

```css
--bg:     #0F1115    /* 深炭黑底 */
--surface:#161A21    /* 面板背景 */
--ink:    #F0F0F0    /* 主文字 */
--gold:   #F5B800    /* 品牌金 */
--up:     #E03A3A    /* 涨红（中国市场） */
--down:   #00B050    /* 跌绿 */
--line:   #2A2D35    /* 分割线 */
```

---

## 5. 已知优化方向（待确认）

| 编号 | 方向 | 优先级 | 说明 |
|------|------|--------|------|
| OPT-1 | 虚拟滚动日志 | 中 | 超过 500 行时可用虚拟列表替代截断 |
| OPT-2 | WebSocket 替代轮询 | 中 | 减少无效请求，但需后端改造 |
| OPT-3 | 消息分页加载 | 低 | trace 很大时按 loop 分页 |
| OPT-4 | Web Worker 处理大数据 | 低 | escapeHtml/JSON.parse 放入 Worker |
| OPT-5 | CSS 拆分 | 低 | 当前内联在 HTML 中，可提取为独立文件 |
