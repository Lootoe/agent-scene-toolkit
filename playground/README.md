# @lilo-agent/core Playground

调试面板，用于体验和测试 `@lilo-agent/core` 的单 Agent 和多 Agent 功能。

## 快速开始

### 1. 安装依赖

```bash
cd playground
npm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```bash
# LLM 配置
LLM_BASE_URL=https://api3.wlai.vip/v1
LLM_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini

# Agent 模式（可选，默认 multi）
AGENT_MODE=multi  # 'single' | 'multi'

# 服务端口（可选，默认 3001）
PORT=3001
```

### 3. 启动服务

```bash
npm run dev
```

访问 `http://localhost:3001/playground`

---

## 功能演示

### 单 Agent 模式（`AGENT_MODE=single`）

**角色**：assistant（喵呜）— 全能 AI 助手

**示例对话**：
- "帮我计算 12345 * 67890"
- "搜索一下 LangChain 的最新版本"
- "写一个 hello.txt 文件，内容是 Hello World"

### 多 Agent 模式（`AGENT_MODE=multi`，默认）

**角色**：
- **director**（导演/主管）— Supervisor，负责任务分析与分派
- **researcher**（研究员）— Worker，负责信息检索
- **coder**（程序员）— Worker，负责计算与文件操作

**示例对话**：

1. **触发 handoff（任务分派）**：
   ```
   帮我搜索一下 FAANG 公司的员工数量，然后计算总和
   ```
   - director 分析任务 → handoff 给 researcher 搜索
   - researcher 完成搜索 → 返回 director
   - director 分派计算任务 → handoff 给 coder
   - coder 使用 calculator 工具计算 → 返回 director
   - director 汇总结果并回答

2. **观察 agent 事件**：
   - 右侧事件日志会显示 `handoff` 事件（from → to）
   - 每次 agent 切换时会显示 `agent` 事件（当前回答的 agent name）
   - 对话区左上角会实时显示当前 agent 名称

3. **观察 onToolEnd 生命周期**：
   - 服务器控制台会打印 `[onToolEnd] toolName: result`
   - 验证 Scene.onToolEnd 回调在工具调用完成后正确触发

---

## UI 功能说明

### 左侧配置面板
- **STATUS**：连接状态（绿点=已连接）+ 模式信息（single/multi-agent）
- **SESSION**：当前 threadId，点击 `+` 新建会话
- **AGENT**：显示所有 agent（单 Agent 模式 1 个，多 Agent 模式 3 个）
- **SCENE**：当前场景（playground）
- **CONTEXT**：场景上下文 JSON（如 `{"env":"local"}`）

### 中间对话区
- **用户消息**：右对齐蓝色气泡
- **AI 消息**：左对齐，顶部显示当前 agent 名称
- **工具卡片**：折叠展示工具调用（INPUT/OUTPUT）
- **Handoff 分隔线**：显示 agent 切换（from → to）
- **错误提示**：红色边框卡片

### 右侧事件日志
- **类型过滤**：点击顶部标签过滤事件类型
- **事件详情**：点击事件展开查看完整 JSON payload
- **类型色彩**：
  - `text` — 蓝色
  - `tool_start` — 橙色
  - `tool_end` — 绿色
  - `handoff` — 紫色（多 Agent 专属）
  - `agent` — 青色（多 Agent 专属）
  - `error` — 红色
  - `done` — 灰色

---

## 工具说明

Playground 内置 3 个演示工具（所有 agent 共享）：

| 工具 | 说明 | 示例 |
|------|------|------|
| `calculator` | 数学计算 | "计算 123 * 456" |
| `web_search` | 模拟网络搜索 | "搜索 LangChain" |
| `file_write` | 模拟文件写入 | "写一个 test.txt 文件" |

---

## 验收标准对照

| # | 验收项 | 验证方式 |
|---|--------|---------|
| 1 | 配置 `supervisor` 后自动启用多 Agent | 设置 `AGENT_MODE=multi`，观察启动日志显示 supervisor |
| 2 | Supervisor 根据任务自动 handoff | 发送复合任务，观察右侧日志出现 `handoff` 事件 |
| 3 | 流中包含 `handoff` 和 `agent` 事件 | 右侧事件日志中可见紫色 `handoff` 和青色 `agent` 标签 |
| 4 | Scene.onToolEnd 正确触发 | 服务器控制台打印 `[onToolEnd] toolName: ...` |

---

## 故障排查

### 服务器无法启动
- 检查 `.env` 文件是否存在且配置正确
- 确认 `LLM_API_KEY` 已设置
- 检查端口 3001 是否被占用

### 对话无响应
- 打开浏览器开发者工具查看网络请求
- 检查服务器控制台是否有错误日志
- 确认 LLM API 可访问（点击左侧 STATUS 区域测试连接）

### 多 Agent 模式未生效
- 确认 `.env` 中 `AGENT_MODE=multi`
- 重启服务器
- 检查启动日志是否显示 `supervisor: director`

