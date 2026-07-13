# Multialpha WebUI 技术方案文档

> 后端：Flask 开发服务器（`rdagent/log/ui/app.py`）
> 前端：单文件 SPA（`git_ignore_folder/static/multialpha.html`）
> 数据层：pickle 文件 + WebStorage（`rdagent/log/ui/storage.py`）

---

## 1. 后端 API 规格

### 1.1 Trace 列表

```
GET /traces
→ ["Finance Whole Pipeline/funny-stream", "Finance Data Building/test-1", ...]
```

### 1.2 Trace 消息

```
POST /trace
Body: { "id": "scenario/name", "all": true|false, "reset": true|false }

all=true:  返回全部消息（首次加载）
all=false: 返回上次请求以来的新消息（增量轮询）
reset=true: 重置读取指针

→ [
    {
      "tag": "research.hypothesis",
      "timestamp": "2025-07-12T10:00:00",
      "loop_id": "0",
      "content": { ... }  // dict 或 JSON string
    },
    ...
  ]
```

### 1.3 Token Cost 消息

```json
{
  "tag": "token_cost",
  "timestamp": "2025-07-12T10:00:01",
  "loop_id": "0",
  "content": {
    "model": "openai/glm-5-turbo",
    "prompt_tokens": 2135,
    "completion_tokens": 135,
    "total_tokens": 2270,
    "cost": 0.0,
    "accumulated_prompt_tokens": 54689,
    "accumulated_completion_tokens": 4481,
    "accumulated_cost": 0.0,
    "call_count": 26
  }
}
```

**NaN 安全**：`storage.py` 中 `_obj_to_json()` 对 NaN/Inf 值替换为 0.0，避免 JSON 序列化非法字符。

### 1.4 SSE 日志流

```
GET /stream/<trace_id>
Accept: text/event-stream

→ data: {"line": "INFO: Starting loop 0..."}\n\n
  data: {"line": "CODE: Generating factor..."}\n\n
  ...
```

### 1.5 任务控制

```
POST /control
Body: { "id": "scenario/name", "action": "pause"|"resume"|"stop" }
```

---

## 2. 前端技术栈

| 层面 | 选型 | 理由 |
|------|------|------|
| 框架 | 无框架，原生 JS | 零构建，部署简单 |
| 样式 | 内联 CSS + CSS 变量 | 设计系统统一管理 |
| 图表 | iframe + ECharts/Plotly | 隔离样式，独立渲染 |
| 字体 | JetBrains Mono + Inter | 量化终端风格 |
| 图标 | 内联 SVG | 无外部依赖 |
| 字体加载 | Google Fonts + 本地 fallback | 首屏不阻塞 |

---

## 3. 性能优化清单

### 3.1 已实施优化

| 编号 | 优化项 | 实施方式 | 效果 |
|------|--------|----------|------|
| P-01 | 增量条件渲染 | 轮询时只重渲染有新数据的面板 | 减少 60% DOM 操作 |
| P-02 | 日志 DOM 上限 | 最多保留 500 行，FIFO 移除 | 防止内存泄漏 |
| P-03 | iframe 内容缓存 | `data-hash` 检测，未变跳过 | 避免 ECharts 重绘 |
| P-04 | 滚动节流 | `requestAnimationFrame` 合并 | 消除强制 reflow |
| P-05 | escapeHtml 单次正则 | 查表替代 4 次 replace | 减少 75% 正则调用 |
| P-06 | tagIndex O(1) 查找 | 预建 `{tag: msg}` 索引 | 消除 O(n×agents) 遍历 |
| P-07 | 竞态守卫 | `_selectGen` 计数器 | 防止快速切换的数据串扰 |
| P-08 | 独立 try-catch | 每个渲染函数独立捕获 | 防止级联渲染失败 |
| P-09 | NaN 安全序列化 | 后端过滤 NaN/Inf | 修复 JSON.parse 报错 |
| P-10 | 条件任务列表刷新 | 状态变化时才刷新 | 减少无效 DOM 操作 |

### 3.2 性能指标基线

| 指标 | 优化前 | 优化后 | 测量方式 |
|------|--------|--------|----------|
| 5s 轮询 DOM 操作 | 5 次全量重渲染 | 1-2 次增量渲染 | DevTools Performance |
| 日志 1000 行后 | 明显卡顿 | 流畅（500 行上限） | 手动滚动测试 |
| 快速切换任务 | 数据串扰/白屏 | 正确渲染 | 连续点击 3 个任务 |
| Token 看板 | 闪现后消失 | 持续显示 | 切换任务观察 |

---

## 4. CSS 布局方案

### 4.1 Flex 高度链（核心原则）

```css
/* 所有弹性容器必须遵循 */
.container {
  flex: 1;
  min-height: 0;     /* 允许收缩 */
  overflow-y: auto;   /* 或 hidden，取决于是否为滚动容器 */
}
```

**禁止**：`height: 100%`（百分比高度依赖父级确定高度，在 flex stretch 场景下脆弱）

### 4.2 滚动容器层级

```
body (overflow:hidden)
  └─ .center (overflow-y:auto)     ← 主滚动容器
    └─ .center-result-body (overflow-y:auto) ← 次级滚动（可选）
```

### 4.3 响应式断点

| 断点 | 宽度 | 变化 |
|------|------|------|
| Desktop | >1200px | 三栏 sidebar+center+results |
| Tablet | 768-1200px | results 缩窄至 300px |
| Mobile | <768px | 单栏，sidebar/results 变浮层 |

---

## 5. 部署配置

### 5.1 环境变量

```bash
export UI_STATIC_PATH=/path/to/static           # 静态文件目录
export UI_TRACE_FOLDER=/path/to/traces           # trace 数据目录
export PYTHONPATH=/path/to/rdagent:$PYTHONPATH   # Python 包路径
```

### 5.2 启动脚本

```bash
# start_webui.sh
cd /home/zxh/quant_projects/rdagent
export UI_STATIC_PATH=$(pwd)/git_ignore_folder/static
export UI_TRACE_FOLDER=$(pwd)/traces
export PYTHONPATH=$(pwd):$PYTHONPATH
python webui_main.py
# → * Running on http://127.0.0.1:19899
```

### 5.3 SSH 隧道访问

```bash
# 本地执行
ssh -N -L 19900:localhost:19899 user@server
# 浏览器打开 http://localhost:19900/multialpha.html
```

---

## 6. 测试清单

### 6.1 功能测试

- [ ] 首页 Landing 正确渲染（hero、ticker tape、stats）
- [ ] 点击任务 → 正确加载详情页
- [ ] Pipeline 流程条正确显示各阶段状态
- [ ] Token 看板持续显示（切换任务不消失）
- [ ] Loop Bar 切换 loop 过滤正确
- [ ] 因子/图表/代码/结论 Tab 切换正常
- [ ] 日志流实时追加（SSE 连接正常）
- [ ] 暂停/恢复/停止按钮工作正常
- [ ] 返回首页 → 重新进入任务，状态正确

### 6.2 性能测试

- [ ] 连续切换 5 个任务，无明显卡顿
- [ ] 长时间停留（10 分钟），无内存泄漏
- [ ] 停留在图表 Tab，5 秒轮询不触发 iframe 重建
- [ ] 日志超过 500 行，滚动流畅

### 6.3 布局测试

- [ ] 任务详情页可上下滚动
- [ ] 首页可上下滚动
- [ ] 图表 Tab 内容完整可见
- [ ] 窗口缩小时布局不崩

---

## 7. 待确认事项

| 编号 | 事项 | 影响 | 建议 |
|------|------|------|------|
| TODO-1 | 日志虚拟滚动 | 超 500 行被截断 | 如需查看完整历史日志，考虑虚拟列表 |
| TODO-2 | WebSocket 替代轮询 | 减少无效请求 | 需后端改造，优先级中 |
| TODO-3 | trace 消息分页 | 大 trace 首次加载慢 | 按 loop 分页加载 |
| TODO-4 | CSS 提取为独立文件 | 可维护性 | 当前内联，迁移简单 |
