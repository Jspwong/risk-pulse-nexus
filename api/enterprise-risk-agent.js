import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen-plus';
const ALLOWED_TAGS = ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx'];
const MAX_RISK_TAGS = 3;
const ALLOWED_PRIORITIES = ['P1', 'P2', 'P3'];
const ALLOWED_ROI_TEMPLATES = ['regulatory', 'supply_chain', 'financial_fx', 'geopolitical'];
const ALLOWED_ROI_UNITS = ['usd', 'probability', 'percentage', 'days', 'count', 'tonnes_co2e', 'usd_per_day', 'multiple'];
const ALLOWED_ROI_KEYS = ['exposureBaseUsd', 'eventProbability', 'lossGivenEventPct', 'detectionHitRate', 'mitigationEffectiveness', 'annualSystemCostUsd'];
const ROI_KEY_UNITS = {
  exposureBaseUsd: 'usd',
  eventProbability: 'probability',
  lossGivenEventPct: 'percentage',
  detectionHitRate: 'probability',
  mitigationEffectiveness: 'percentage',
  annualSystemCostUsd: 'usd',
};
const AGENT_PROMPT_VERSION = 'v8-max-3-risk-tags';
const AGENT_CACHE_TTL_MS = 30 * 60 * 1000;
const QWEN_TIMEOUT_MS = 45_000;
const agentCache = new Map();

function json(req, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req, 'GET, POST, OPTIONS'),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function qwenConfig() {
  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
  const baseUrl = (process.env.QWEN_API_BASE_URL || process.env.DASHSCOPE_BASE_URL || process.env.DASHSCOPE_API_BASE_URL || DEFAULT_QWEN_BASE_URL).replace(/\/+$/, '');
  const model = process.env.QWEN_MODEL || process.env.DASHSCOPE_MODEL || DEFAULT_QWEN_MODEL;
  const enabled = process.env.ENTERPRISE_RISK_AGENT_ENABLED === '1';
  return {
    apiKey,
    baseUrl,
    model,
    enabled,
    endpoint: `${baseUrl}/chat/completions`,
  };
}

function checkDemoKey(req) {
  const required = process.env.ENTERPRISE_RISK_AGENT_KEY;
  if (!required) return true;
  return req.headers.get('x-enterprise-risk-agent-key') === required;
}

function compact(value, maxLen = 9_000) {
  const text = JSON.stringify(value);
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}\n...truncated`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function cacheKeyFor(payload, cfg) {
  const input = stableStringify({
    model: cfg.model,
    promptVersion: AGENT_PROMPT_VERSION,
    mode: payload.mode,
    event: payload.event,
    events: payload.events,
    profile: payload.profile,
    constraints: payload.constraints,
  });
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function getCachedAgentResult(key) {
  const cached = agentCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > AGENT_CACHE_TTL_MS) {
    agentCache.delete(key);
    return null;
  }
  return {
    ...cached.result,
    cached: true,
  };
}

function setCachedAgentResult(key, result) {
  if (agentCache.size > 80) {
    const oldestKey = agentCache.keys().next().value;
    if (oldestKey) agentCache.delete(oldestKey);
  }
  agentCache.set(key, { createdAt: Date.now(), result });
}

function systemPrompt(mode) {
  const common = [
    'You are the Enterprise Risk Agent for WorldMonitor.',
    'Return ONLY valid JSON. Do not use markdown.',
    'Allowed riskTags are exactly: geopolitical, regulatory, supply_chain, financial_fx.',
    'Allowed priority values are exactly: P1, P2, P3.',
    'Use Chinese for analyst-facing explanations, but keep enum fields in English.',
    'Do not invent evidence. If evidence is weak, lower confidence and say why in dataQuality.',
  ].join('\n');

  if (mode === 'batch_closed_loop') {
    return `${common}

Task: run the identification agent and transmission agent for EVERY event in the input batch.
Use the currentRuleOutput as candidate context, but your output is the authoritative identification and transmission layer.
Return one result object per input event. Preserve each eventId exactly.
JSON schema:
{
  "events": [
    {
      "eventId": "demo-cbam-red-sea-001",
      "identification": {
        "riskTags": ["regulatory"],
        "priority": "P2",
        "severityScore": 0,
        "confidence": 0.0,
        "triggerBasis": ["..."],
        "priorityBasis": ["..."],
        "dataQuality": ["..."]
      },
      "transmission": {
        "impactPath": {
          "routeIds": ["china-europe-suez"],
          "label": "...",
          "steps": ["外部事件", "业务链路", "受影响业务线"]
        },
        "businessMappings": [
          {
            "businessLineId": "...",
            "businessLineName": "...",
            "department": "Compliance",
            "impact": "...",
            "action": "...",
            "priority": "P2",
            "score": 0,
            "confidence": 0.0
          }
        ],
        "mappingBasis": ["..."],
        "responseTasks": [
          {
            "department": "Compliance",
            "title": "...",
            "priority": "P2",
            "dueInDays": 3
          }
        ]
      }
    }
  ]
}`;
  }

  if (mode === 'identify') {
    return `${common}

Task: act as the identification agent.
Classify the external trigger into the four enterprise risk tags, assign priority, severityScore, and explain the trigger basis.
JSON schema:
{
  "riskTags": ["regulatory"],
  "priority": "P2",
  "severityScore": 0,
  "confidence": 0.0,
  "triggerBasis": ["..."],
  "priorityBasis": ["..."],
  "dataQuality": ["..."]
}`;
  }

  if (mode === 'transmit') {
    return `${common}

Task: act as the transmission agent.
Map the identified risk into the company's business lines, route exposure, departments, actions, and response tasks.
JSON schema:
{
  "impactPath": {
    "routeIds": ["china-europe-suez"],
    "label": "...",
    "steps": ["外部事件", "业务链路", "受影响业务线"]
  },
  "businessMappings": [
    {
      "businessLineId": "...",
      "businessLineName": "...",
      "department": "Compliance",
      "impact": "...",
      "action": "...",
      "priority": "P2",
      "score": 0,
      "confidence": 0.0
    }
  ],
  "mappingBasis": ["..."],
  "responseTasks": [
    {
      "department": "Compliance",
      "title": "...",
      "priority": "P2",
      "dueInDays": 3
    }
  ]
}`;
  }

  return `${common}

Task: run two agents in sequence:
1. identificationAgent classifies the external trigger.
2. transmissionAgent maps the trigger into internal business impact and response.
JSON schema:
{
  "identification": {
    "riskTags": ["regulatory"],
    "priority": "P2",
    "severityScore": 0,
    "confidence": 0.0,
    "triggerBasis": ["..."],
    "priorityBasis": ["..."],
    "dataQuality": ["..."]
  },
  "transmission": {
    "impactPath": {
      "routeIds": ["china-europe-suez"],
      "label": "...",
      "steps": ["外部事件", "业务链路", "受影响业务线"]
    },
    "businessMappings": [
      {
        "businessLineId": "...",
        "businessLineName": "...",
        "department": "Compliance",
        "impact": "...",
        "action": "...",
        "priority": "P2",
        "score": 0,
        "confidence": 0.0
      }
    ],
    "mappingBasis": ["..."],
    "responseTasks": [
      {
        "department": "Compliance",
        "title": "...",
        "priority": "P2",
        "dueInDays": 3
      }
    ]
  }
}`;
}

function userPrompt(payload) {
  const input = {
    mode: payload.mode,
    event: payload.event,
    events: Array.isArray(payload.events) ? payload.events : undefined,
    profile: payload.profile,
    constraints: payload.constraints,
  };

  return [
    'Analyze this input. Use only provided event/profile facts.',
    compact(input),
  ].join('\n');
}

function systemPromptV2(mode) {
  const common = [
    'You are WorldMonitor Enterprise Risk Agent. Return ONLY compact JSON.',
    'Analyze independently from event text/source/evidence/profile; do not copy rule candidates.',
    'riskTags is multi-label: include every materially applicable tag, usually 1-3, max 3. Do not output only the primary tag when secondary transmission is real.',
    'Tags only: geopolitical, regulatory, supply_chain, financial_fx. Priority only: P1,P2,P3.',
    'Tag guide: geopolitical=conflict/sanctions/chokepoint security/export controls; regulatory=CBAM/customs/tariff/reporting/certification; supply_chain=port/shipping/freight/supplier/material/production delay; financial_fx=FX/rates/inflation/commodity/freight cost/margin/receivables/hedging.',
    'Departments only: Compliance, Finance, Supply Chain, Sales, Operations.',
    'Chinese explanations, English enum fields. No invented evidence; weak evidence => lower confidence.',
    'Rubric: P1 direct near-term compliance/shipment/revenue impact; P2 plausible action within days; P3 indirect context.',
    'Score: P1 80-100, P2 55-79, P3 20-54. Mapping score 10-100, never 0 for relevant events.',
    'Use only businessLineId values in profile.businessLines. Output every necessary mapping; usually 1-4, max 6. Do not omit a clearly affected line.',
    'Each string max 40 Chinese chars. Max 3 basis items and 4 tasks per event.',
  ].join('\n');

  const identification = '"identification":{"riskTags":["regulatory"],"priority":"P2","severityScore":72,"confidence":0.82,"triggerBasis":["具体触发依据"],"priorityBasis":["优先级依据"],"dataQuality":["来源质量"]}';
  const transmission = '"transmission":{"impactPath":{"routeIds":["china-europe-suez"],"label":"事件-链路-业务线","steps":["外部事件","受影响链路","业务线","部门动作"]},"businessMappings":[{"businessLineId":"existing-profile-id","businessLineName":"业务线名称","department":"Compliance","impact":"具体影响","action":"具体动作","priority":"P2","score":72,"confidence":0.82}],"mappingBasis":["映射依据"],"responseTasks":[{"department":"Compliance","title":"具体任务","priority":"P2","dueInDays":3}]}';

  if (mode === 'batch_closed_loop') {
    return `${common}
Task: independently analyze EVERY event. Preserve eventId exactly. Output count must equal input events count.
Schema: {"events":[{"eventId":"input-event-id",${identification},${transmission}}]}`;
  }
  if (mode === 'identify') {
    return `${common}
Task: identify this event independently.
Schema: {"riskTags":["regulatory"],"priority":"P2","severityScore":72,"confidence":0.82,"triggerBasis":["具体触发依据"],"priorityBasis":["优先级依据"],"dataQuality":["来源质量"]}`;
  }
  if (mode === 'transmit') {
    return `${common}
Task: map this event independently into internal impact.
Schema: {${transmission}}`;
  }
  return `${common}
Task: run identification then transmission for this event.
Schema: {${identification},${transmission}}`;
}

function systemPromptV3(mode) {
  const common = [
    'You are WorldMonitor Enterprise Risk Agent. Return ONLY valid compact JSON.',
    'Analyze independently from event text, source, evidence, and profile. Never copy rule candidates.',
    'riskTags is multi-label: include all material tags, usually 1-3, max 3.',
    'Tags only: geopolitical, regulatory, supply_chain, financial_fx. Priority only: P1,P2,P3.',
    'Tag guide: geopolitical=conflict sanctions chokepoint-security export-controls; regulatory=CBAM customs tariff reporting certification; supply_chain=port shipping freight supplier material production delay; financial_fx=FX rates inflation commodity freight-cost margin receivable hedge.',
    'Departments only: Compliance, Finance, Supply Chain, Sales, Operations.',
    'Department coverage: regulatory must include Compliance; supply_chain must include Supply Chain; financial_fx must include Finance; geopolitical should include Operations or Supply Chain when routes/ports/security are involved.',
    'If riskTags contains both regulatory and supply_chain, businessMappings must include at least one Compliance mapping and one Supply Chain mapping unless evidence clearly shows no operational exposure.',
    'Explanations may be Chinese, but JSON keys and enum values stay English.',
    'P1=direct near-term compliance/shipment/revenue impact. P2=action needed within days. P3=indirect context.',
    'Score ranges: P1 80-100, P2 55-79, P3 20-54. Mapping score 10-100.',
    'Use only businessLineId values from profile.businessLines. Output every necessary mapping, usually 1-4, max 6.',
    'impactPath.steps must be concrete words from this event/profile. Never output placeholders like external event, affected route, business line, department action, concrete trigger.',
    'Max 3 basis items and 4 tasks per event.',
  ].join('\n');
  const identification = '"identification":{"riskTags":["regulatory","supply_chain"],"priority":"P2","severityScore":72,"confidence":0.82,"triggerBasis":["reason"],"priorityBasis":["priority reason"],"dataQuality":["source quality"]}';
  const transmission = '"transmission":{"impactPath":{"routeIds":[],"label":"short concrete path","steps":["event-specific trigger","event-specific route or market","event-specific business line","event-specific action"]},"businessMappings":[{"businessLineId":"existing-profile-id","businessLineName":"business line name","department":"Compliance","impact":"specific impact","action":"specific action","priority":"P2","score":72,"confidence":0.82}],"mappingBasis":["mapping reason"],"responseTasks":[{"department":"Compliance","title":"specific task","priority":"P2","dueInDays":3}]}';
  if (mode === 'batch_closed_loop') {
    return `${common}
Task: analyze every input event. Output exactly one events[] item per input event. Preserve each eventId exactly.
Schema: {"events":[{"eventId":"input-event-id",${identification},${transmission}}]}`;
  }
  if (mode === 'identify') {
    return `${common}
Task: identify this event.
Schema: {"riskTags":["regulatory","supply_chain"],"priority":"P2","severityScore":72,"confidence":0.82,"triggerBasis":["reason"],"priorityBasis":["priority reason"],"dataQuality":["source quality"]}`;
  }
  if (mode === 'transmit') {
    return `${common}
Task: map this event into internal impact.
Schema: {${transmission}}`;
  }
  if (mode === 'roi_assumptions') {
    return `${common}
Task: act only as the ROI assumption agent. Do not calculate ROI, expected savings, net savings, or final financial output.
Use Open FAIR as the risk quantification frame and NIST SP 800-30 for likelihood/control-effect assumptions.
Pick exactly one template, matching the top-level risk axis: regulatory, supply_chain, financial_fx, geopolitical.
If input.constraints.targetTemplate is provided, use that exact template and analyze only that risk axis.
Return bounded assumptions only. Values for probability and percentage must be decimals from 0 to 1.
Required assumption keys: exposureBaseUsd, eventProbability, lossGivenEventPct, detectionHitRate, mitigationEffectiveness, annualSystemCostUsd.
Use line-level confidence by evidence quality; do not copy the same confidence to every assumption unless evidence quality is truly identical.
Return all required assumptions for the requested targetTemplate in this call. Do not omit an axis-specific pack when targetTemplate is provided.
Preserve the input event.id exactly as eventId.
Use only provided event/profile/evidence facts; weak evidence lowers confidence.
Schema: {"eventId":"demo-cbam-red-sea-001","template":"regulatory","version":"fair-lite-v1-qwen-assisted","confidence":0.72,"assumptions":[{"key":"exposureBaseUsd","label":"Exposure magnitude","value":2600000,"low":1600000,"high":3600000,"unit":"usd","source":"provided profile/evidence","sourceUrl":"","confidence":0.72,"locked":false}],"rationale":["why assumptions fit"],"references":["Open FAIR","NIST SP 800-30"]}`;
  }
  return `${common}
Task: identify and map this event.
Schema: {${identification},${transmission}}`;
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('agent_response_not_json');
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function list(value, max = 6) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, max)
    : [];
}

function normalizeIdentification(value) {
  const tags = Array.isArray(value?.riskTags)
    ? value.riskTags.filter(tag => ALLOWED_TAGS.includes(tag))
    : [];
  const priority = ALLOWED_PRIORITIES.includes(value?.priority) ? value.priority : 'P3';
  return {
    riskTags: tags.length ? Array.from(new Set(tags)).slice(0, MAX_RISK_TAGS) : ['supply_chain'],
    priority,
    severityScore: Math.round(clampNumber(value?.severityScore, 0, 100, priority === 'P1' ? 82 : priority === 'P2' ? 58 : 35)),
    confidence: clampNumber(value?.confidence, 0, 1, 0.45),
    triggerBasis: list(value?.triggerBasis, 3),
    priorityBasis: list(value?.priorityBasis, 3),
    dataQuality: list(value?.dataQuality, 3),
  };
}

function normalizeTransmission(value) {
  const mappings = Array.isArray(value?.businessMappings) ? value.businessMappings : [];
  const tasks = Array.isArray(value?.responseTasks) ? value.responseTasks : [];
  const path = value?.impactPath && typeof value.impactPath === 'object' ? value.impactPath : {};
  return {
    impactPath: {
      routeIds: list(path.routeIds, 4),
      label: typeof path.label === 'string' ? path.label.slice(0, 180) : '',
      steps: list(path.steps, 6),
    },
    businessMappings: mappings.slice(0, 6).map((item) => ({
      businessLineId: typeof item.businessLineId === 'string' ? item.businessLineId.slice(0, 120) : '',
      businessLineName: typeof item.businessLineName === 'string' ? item.businessLineName.slice(0, 160) : '',
      department: typeof item.department === 'string' ? item.department.slice(0, 80) : 'Risk Office',
      impact: typeof item.impact === 'string' ? item.impact.slice(0, 220) : '',
      action: typeof item.action === 'string' ? item.action.slice(0, 220) : '',
      priority: ALLOWED_PRIORITIES.includes(item.priority) ? item.priority : 'P3',
      score: Math.round(clampNumber(item.score, 0, 100, 40)),
      confidence: clampNumber(item.confidence, 0, 1, 0.45),
    })),
    mappingBasis: list(value?.mappingBasis, 3),
    responseTasks: tasks.slice(0, 4).map((item) => ({
      department: typeof item.department === 'string' ? item.department.slice(0, 80) : 'Risk Office',
      title: typeof item.title === 'string' ? item.title.slice(0, 180) : '',
      priority: ALLOWED_PRIORITIES.includes(item.priority) ? item.priority : 'P3',
      dueInDays: Math.round(clampNumber(item.dueInDays, 0, 30, 7)),
    })),
  };
}

function normalizeRoiAssumptionLine(value) {
  const key = typeof value?.key === 'string' ? value.key : '';
  const unit = ROI_KEY_UNITS[key] || (ALLOWED_ROI_UNITS.includes(value?.unit) ? value.unit : 'usd');
  const n = clampNumber(value?.value, 0, unit === 'usd' || unit === 'usd_per_day' ? 100_000_000 : 1_000_000, 0);
  const max = unit === 'probability' || unit === 'percentage' ? 1 : unit === 'usd' || unit === 'usd_per_day' ? 100_000_000 : 1_000_000;
  const normalizedValue = unit === 'probability' || unit === 'percentage'
    ? clampNumber(n > 1 ? n / 100 : n, 0, 1, 0)
    : clampNumber(n, 0, max, 0);
  return {
    key,
    label: typeof value?.label === 'string' ? value.label.slice(0, 80) : key,
    value: normalizedValue,
    low: value?.low == null ? undefined : clampNumber((unit === 'probability' || unit === 'percentage') && value.low > 1 ? value.low / 100 : value.low, 0, max, undefined),
    high: value?.high == null ? undefined : clampNumber((unit === 'probability' || unit === 'percentage') && value.high > 1 ? value.high / 100 : value.high, 0, max, undefined),
    unit,
    source: typeof value?.source === 'string' ? value.source.slice(0, 180) : 'Qwen assumption agent',
    sourceUrl: typeof value?.sourceUrl === 'string' ? value.sourceUrl.slice(0, 260) : undefined,
    confidence: clampNumber(value?.confidence, 0, 1, 0.45),
    locked: Boolean(value?.locked),
  };
}

function normalizeRoiAssumptions(value) {
  const template = ALLOWED_ROI_TEMPLATES.includes(value?.template) ? value.template : 'regulatory';
  const assumptions = Array.isArray(value?.assumptions)
    ? value.assumptions
      .map(normalizeRoiAssumptionLine)
      .filter(item => ALLOWED_ROI_KEYS.includes(item.key))
      .slice(0, 8)
    : [];
  return {
    eventId: typeof value?.eventId === 'string' ? value.eventId.slice(0, 180) : '',
    template,
    version: typeof value?.version === 'string' ? value.version.slice(0, 80) : 'fair-lite-v1-qwen-assisted',
    confidence: clampNumber(value?.confidence, 0, 1, 0.45),
    assumptions,
    rationale: list(value?.rationale, 4),
    references: list(value?.references, 6),
  };
}

function normalizeResult(mode, raw) {
  if (mode === 'identify') return normalizeIdentification(raw);
  if (mode === 'transmit') return normalizeTransmission(raw);
  if (mode === 'roi_assumptions') return normalizeRoiAssumptions(raw);
  if (mode === 'batch_closed_loop') {
    const events = Array.isArray(raw?.events) ? raw.events : [];
    return {
      events: events.slice(0, 8).map((item) => ({
        eventId: typeof item.eventId === 'string' ? item.eventId.slice(0, 180) : '',
        identification: normalizeIdentification(item.identification),
        transmission: normalizeTransmission(item.transmission),
      })).filter(item => item.eventId),
    };
  }
  return {
    identification: normalizeIdentification(raw?.identification),
    transmission: normalizeTransmission(raw?.transmission),
  };
}

async function callQwen(payload, cfg) {
  const mode = ['identify', 'transmit', 'closed_loop', 'batch_closed_loop', 'roi_assumptions'].includes(payload.mode) ? payload.mode : 'closed_loop';
  const cacheKey = await cacheKeyFor({ ...payload, mode }, cfg);
  const cached = getCachedAgentResult(cacheKey);
  if (cached) return cached;
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPromptV3(mode) },
      { role: 'user', content: userPrompt({ ...payload, mode }) },
    ],
    temperature: 0.05,
    max_tokens: mode === 'batch_closed_loop' ? 4200 : mode === 'roi_assumptions' ? 3200 : 1400,
  };

  if (process.env.QWEN_ENABLE_THINKING !== '1') body.enable_thinking = false;
  if (process.env.QWEN_JSON_MODE !== '0') body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
  try {
    let response = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'WorldMonitor/enterprise-risk-agent',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let text = await response.text();
    if (!response.ok && body.response_format && /response_format|json_object/i.test(text)) {
      delete body.response_format;
      response = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'WorldMonitor/enterprise-risk-agent',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: 'qwen_request_failed',
        detail: text.slice(0, 600),
      };
    }
    const jsonBody = JSON.parse(text);
    const content = jsonBody?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObject(content);
    const result = {
      ok: true,
      mode,
      provider: 'qwen',
      model: jsonBody.model || cfg.model,
      result: normalizeResult(mode, parsed),
      usage: jsonBody.usage || null,
    };
    setCachedAgentResult(cacheKey, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: getCorsHeaders(req, 'GET, POST, OPTIONS') });
  if (isDisallowedOrigin(req)) return json(req, 403, { ok: false, error: 'origin_not_allowed' });

  const cfg = qwenConfig();
  if (req.method === 'GET') {
    return json(req, 200, {
      ok: true,
      configured: Boolean(cfg.apiKey),
      enabled: cfg.enabled,
      provider: 'qwen',
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      modes: ['identify', 'transmit', 'closed_loop', 'batch_closed_loop', 'roi_assumptions'],
    });
  }

  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method_not_allowed' });
  if (!cfg.enabled) return json(req, 503, { ok: false, error: 'enterprise_risk_agent_disabled' });
  if (!cfg.apiKey) return json(req, 503, { ok: false, error: 'qwen_api_key_missing' });
  if (!checkDemoKey(req)) return json(req, 401, { ok: false, error: 'agent_key_required' });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid_json' });
  }

  if (!payload || typeof payload !== 'object' || (!payload.event && !Array.isArray(payload.events))) {
    return json(req, 400, { ok: false, error: 'missing_event' });
  }

  try {
    const result = await callQwen(payload, cfg);
    return json(req, result.ok ? 200 : 502, result);
  } catch (error) {
    return json(req, 502, {
      ok: false,
      error: error?.name === 'AbortError' ? 'qwen_timeout' : 'agent_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
