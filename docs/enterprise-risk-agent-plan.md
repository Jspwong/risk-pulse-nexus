# Enterprise Risk Agent Implementation Plan

## Goal

Replace the current rule-only "识别层" and "传导层" with two Qwen-backed agents while keeping the existing deterministic rules only as candidate generation and fallback.

The demo experience should still feel stable:

1. The first screen renders from local candidate rules so the panel is never blank.
2. Qwen is then called in `batch_closed_loop` mode and becomes the primary output for 识别层 and 传导层.
3. If the Qwen agent fails, times out, or returns malformed JSON, the rule output remains unchanged.

## Current State

### 识别层 today

Main file: `src/services/enterprise-risk.ts`

Current identification is deterministic and client-side:

- `classifyTags(text)` maps trigger text to the four UI risk tags.
- `weightedScore(baseScore, tags)` applies profile weights.
- `priorityFromScore(score)` maps score to `P1 | P2 | P3`.
- `buildExplanation(...)` produces trigger, priority, mapping, and data-quality explanations.

Pros:

- Fast and stable.
- Works offline.
- No API key or network dependency.

Limits:

- Keyword matching cannot reason about indirect relevance.
- It cannot explain why a weak but important article matters to the enterprise scenario unless terms match the static dictionaries.
- Multi-source evidence quality is rule-scored, not analyst-scored.

### 传导层 today

Main file: `src/services/enterprise-risk.ts`

Current transmission is also deterministic:

- `buildImpactPath(text, markets)` maps known route keywords into route steps.
- `resolveBusinessLines(event)` matches affected markets, route exposure, products, and regulatory fallback.
- `buildImpacts(events)` expands tags into department actions using `DEPARTMENT_RULES`.
- `buildTasks(impacts)` turns impacts into response tasks.

Pros:

- Predictable and low risk.
- Easy to test.
- Always maps demo events.

Limits:

- Every mapping uses the first matched business line.
- Department actions are generic.
- It cannot reason that one event should affect multiple business lines differently.

## Proposed Architecture

Use two Qwen-backed agents behind one server endpoint:

```text
Browser SPA
  └─ local rule assessment renders immediately as candidate/fallback
       └─ POST /api/enterprise-risk-agent (batch_closed_loop)
            ├─ identification agent
            └─ transmission agent
                 └─ normalized JSON replaces identification + transmission data
```

The Qwen API key stays server-side. The browser never receives the key.

## New Entry Point

File: `api/enterprise-risk-agent.js`

Modes:

- `identify`: only classify tags, priority, severity, and explanation.
- `transmit`: only map identified risk into business lines, departments, route path, and tasks.
- `closed_loop`: run both agents in one call and return both sections.
- `batch_closed_loop`: run both agents for every visible enterprise-risk card and return one result per event.

Health/config check:

```bash
curl http://localhost:5173/api/enterprise-risk-agent
```

Request shape:

```json
{
  "mode": "closed_loop",
  "event": {
    "id": "demo-cbam-red-sea-001",
    "title": "EU CBAM reporting window tightens while Red Sea rerouting adds transit delay",
    "summary": "...",
    "source": "European Commission",
    "tags": ["regulatory", "supply_chain"]
  },
  "profile": {
    "companyName": "...",
    "businessLines": []
  },
  "currentRuleOutput": {
    "identification": {},
    "impacts": []
  }
}
```

Response shape:

```json
{
  "ok": true,
  "mode": "closed_loop",
  "provider": "qwen",
  "model": "qwen-plus",
  "result": {
    "identification": {
      "riskTags": ["regulatory", "supply_chain", "geopolitical"],
      "priority": "P1",
      "severityScore": 88,
      "confidence": 0.83,
      "triggerBasis": [],
      "priorityBasis": [],
      "dataQuality": []
    },
    "transmission": {
      "impactPath": {
        "routeIds": [],
        "label": "",
        "steps": []
      },
      "businessMappings": [],
      "mappingBasis": [],
      "responseTasks": []
    }
  }
}
```

## Environment Variables

Set in `.env.local` for local dev or in Vercel/Railway environment settings for deployment.

```bash
ENTERPRISE_RISK_AGENT_ENABLED=1
ENTERPRISE_RISK_AGENT_KEY=
DASHSCOPE_API_KEY=<your DashScope key>
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

Supported aliases:

- `QWEN_API_KEY` or `DASHSCOPE_API_KEY`
- `QWEN_API_BASE_URL`, `DASHSCOPE_BASE_URL`, or `DASHSCOPE_API_BASE_URL`
- `QWEN_MODEL` or `DASHSCOPE_MODEL`

The endpoint follows DashScope's OpenAI-compatible chat completions pattern: region-specific base URL plus `/chat/completions`, with the API key sent as a bearer token. See Alibaba Cloud's Qwen API reference and first-call guide.

## Agent Responsibilities

### Identification Agent

Inputs:

- Event title, summary, source, source link, evidence sources.
- Current rule tags and score.
- Allowed tags.
- Scenario profile.

Outputs:

- `riskTags`: only `geopolitical`, `regulatory`, `supply_chain`, `financial_fx`.
- `priority`: `P1 | P2 | P3`.
- `severityScore`: 0-100.
- `confidence`: 0-1.
- `triggerBasis`: concise evidence-backed reasons.
- `priorityBasis`: why this priority.
- `dataQuality`: source quality, freshness, uncertainty.

Merge rule:

- Agent can raise/lower tags only inside the four-tag set.
- Agent priority can override rule priority when confidence >= 0.65.
- If confidence < 0.65, keep rule priority and append agent notes as explanation.

### Transmission Agent

Inputs:

- Event after identification.
- Enterprise profile business lines.
- Current rule impact path and impacts.
- Existing `DEPARTMENT_RULES`.

Outputs:

- `impactPath`: route IDs, display label, and steps.
- `businessMappings`: business line, department, impact, action, priority, score.
- `mappingBasis`: why this business line and department were selected.
- `responseTasks`: suggested tasks by department.

Merge rule:

- Only accept business line IDs that exist in profile.
- Unknown line IDs can be displayed as analyst notes but should not replace canonical internal mappings.
- Cap mappings to 6 for UI readability.
- If the agent returns no valid mapping, keep `buildImpacts()` output.

## Recommended Integration Steps

### Phase 1: Endpoint only

Status: done.

- Add `/api/enterprise-risk-agent`.
- Add Qwen/DashScope env placeholders.
- Keep UI unchanged.

### Phase 2: Manual smoke button or dev-only console call

Status: superseded by full async enrichment.

### Phase 3: Optional enrichment service

Status: done.

Implemented file: `src/services/enterprise-risk-agent-client.ts`

Current behavior:

- `fetchEnterpriseRiskAgentBatch(assessment)`
- timeout around 12s
- no throw; returns `null` on failure

### Phase 4: Full async enrichment

Status: done.

Implemented in `src/app/data-loader.ts`:

1. Render local candidate assessment immediately.
2. Mark agent workflow as `running`.
3. Call `/api/enterprise-risk-agent` with `batch_closed_loop`.
4. Apply successful output through `applyEnterpriseRiskAgentResult()`.
4. Re-render the panel.

This avoids blocking page load.

### Phase 5: Cache

Add a server-side cache key:

```text
enterprise-risk-agent:v1:{eventId}:{eventTitleHash}:{profileVersion}
```

Cache TTL:

- Demo seed: 24h.
- Live news: 30-60m.

## Demo Behavior

Best demo narrative:

1. 感知层: "真实新闻/官方来源被采集。"
2. 识别层: "Qwen 识别 Agent 只允许输出 4 类风险，防止标签发散。"
3. 传导层: "Qwen 传导 Agent 把外部事件映射到业务线、部门动作和物流/市场链路。"
4. 响应层: "响应任务由 Agent 传导结果生成，规则层只在失败时兜底。"

This is more credible than saying the UI is fully autonomous: it is a controlled agent workflow with deterministic fallback.

## Guardrails

- Never expose Qwen/DashScope key as `VITE_*`.
- Server endpoint must return `no-store`.
- The agent response is normalized before reaching UI.
- Unknown tags are dropped.
- Unknown priorities fall back to `P3`.
- No evidence invention: the prompt asks the model to lower confidence when evidence is weak.
- Demo should pin the CBAM event even if Qwen is unavailable.

## References

- Alibaba Cloud Qwen API reference: https://www.alibabacloud.com/help/doc-detail/2712576.html
- Alibaba Cloud first Qwen API call guide: https://www.alibabacloud.com/help/doc-detail/2840915.html
