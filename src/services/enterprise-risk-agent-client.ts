import type {
  EnterpriseRiskAssessment,
  EnterpriseRiskEvent,
  EnterpriseRiskPriority,
  EnterpriseRiskProfile,
  EnterpriseRiskTag,
  EnterpriseTask,
} from '@/types/enterprise-risk';

export interface EnterpriseRiskAgentIdentification {
  riskTags: EnterpriseRiskTag[];
  priority: EnterpriseRiskPriority;
  severityScore: number;
  confidence: number;
  triggerBasis: string[];
  priorityBasis: string[];
  dataQuality: string[];
}

export interface EnterpriseRiskAgentTransmission {
  impactPath: {
    routeIds: string[];
    label: string;
    steps: string[];
  };
  businessMappings: Array<{
    businessLineId: string;
    businessLineName: string;
    department: string;
    impact: string;
    action: string;
    priority: EnterpriseRiskPriority;
    score: number;
    confidence: number;
  }>;
  mappingBasis: string[];
  responseTasks: Array<{
    department: string;
    title: string;
    priority: EnterpriseRiskPriority;
    dueInDays: number;
  }>;
}

export interface EnterpriseRiskAgentEventResult {
  eventId: string;
  identification: EnterpriseRiskAgentIdentification;
  transmission: EnterpriseRiskAgentTransmission;
  model?: string;
}

export interface EnterpriseRiskAgentBatchResult {
  provider: 'qwen';
  model?: string;
  events: EnterpriseRiskAgentEventResult[];
}

interface EnterpriseRiskClosedLoopResult {
  provider: 'qwen';
  model?: string;
  identification: EnterpriseRiskAgentIdentification;
  transmission: EnterpriseRiskAgentTransmission;
}

function compactEvent(event: EnterpriseRiskEvent) {
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    source: event.source,
    sourceType: event.sourceType,
    occurredAt: event.occurredAt,
    countries: event.countries,
    affectedMarkets: event.affectedMarkets,
    link: event.link,
    evidenceSources: event.evidenceSources?.slice(0, 3),
    isDemoSeed: event.isDemoSeed,
  };
}

function compactProfile(profile: EnterpriseRiskProfile) {
  return {
    scenarioName: profile.scenarioName,
    primaryNarrative: profile.primaryNarrative,
    targetMarkets: profile.targetMarkets,
    criticalCertifications: profile.criticalCertifications,
    affectedDepartments: profile.affectedDepartments,
    businessLines: profile.businessLines.map(line => ({
      id: line.id,
      name: line.name,
      products: line.products,
      targetMarkets: line.targetMarkets,
      routeExposure: line.routeExposure,
      revenueAtRiskUsd: line.revenueAtRiskUsd,
    })),
  };
}

function requestCacheKey(assessment: EnterpriseRiskAssessment): string {
  return `v7-department-coverage:${assessment.events
    .slice(0, 7)
    .map(event => `${event.id}:${event.title}:${event.summary.slice(0, 160)}`)
    .join('|')}`;
}

const agentResultCache = new Map<string, EnterpriseRiskAgentBatchResult>();

async function postEnterpriseRiskAgent(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown | null> {
  const response = await fetch('/api/enterprise-risk-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    console.warn('[EnterpriseRiskAgent] response was not JSON', text.slice(0, 300));
    return null;
  }

  if (!response.ok) {
    console.warn('[EnterpriseRiskAgent] request failed', response.status, payload ?? text.slice(0, 300));
    return null;
  }

  if (!payload?.ok) {
    console.warn('[EnterpriseRiskAgent] response not ok', payload);
    return null;
  }

  return payload;
}

function normalizeClosedLoopPayload(payload: any): EnterpriseRiskClosedLoopResult | null {
  const result = payload?.result;
  if (!result?.identification || !result?.transmission) return null;
  return {
    provider: 'qwen',
    model: typeof payload.model === 'string' ? payload.model : undefined,
    identification: result.identification,
    transmission: result.transmission,
  };
}

async function fetchEnterpriseRiskAgentSingle(
  assessment: EnterpriseRiskAssessment,
  event: EnterpriseRiskEvent,
  options: { timeoutMs?: number } = {},
): Promise<EnterpriseRiskAgentEventResult | null> {
  const timeoutMs = options.timeoutMs ?? 14_000;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = await postEnterpriseRiskAgent({
      mode: 'closed_loop',
      event: compactEvent(event),
      profile: compactProfile(assessment.profile),
      constraints: {
        allowedRiskTags: ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx'],
        allowedPriorities: ['P1', 'P2', 'P3'],
        maxBusinessMappingsPerEvent: 6,
        maxResponseTasksPerEvent: 4,
        maxBasisItems: 3,
        preserveEventIds: true,
        analyzeIndependently: true,
        doNotCopyRuleCandidate: true,
      },
    }, controller.signal);
    const result = normalizeClosedLoopPayload(payload);
    if (!result) {
      console.warn('[EnterpriseRiskAgent] single response invalid', { eventId: event.id, payload });
      return null;
    }
    return {
      eventId: event.id,
      identification: result.identification,
      transmission: result.transmission,
      model: result.model,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchEnterpriseRiskAgentBatch(
  assessment: EnterpriseRiskAssessment,
  options: { timeoutMs?: number } = {},
): Promise<EnterpriseRiskAgentBatchResult | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const requestedEvents = assessment.events.slice(0, 7);
  const cacheKey = requestCacheKey(assessment);
  const cached = agentResultCache.get(cacheKey);
  if (cached) return cached;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const batchPayload = await postEnterpriseRiskAgent({
      mode: 'batch_closed_loop',
      events: requestedEvents.map(compactEvent),
      profile: compactProfile(assessment.profile),
      constraints: {
        allowedRiskTags: ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx'],
        allowedPriorities: ['P1', 'P2', 'P3'],
        maxBusinessMappingsPerEvent: 6,
        maxResponseTasksPerEvent: 4,
        maxBasisItems: 3,
        preserveEventIds: true,
        analyzeIndependently: true,
        doNotCopyRuleCandidate: true,
      },
    }, controller.signal) as any;

    if (Array.isArray(batchPayload?.result?.events) && batchPayload.result.events.length) {
      const returnedIds = new Set(batchPayload.result.events.map((event: EnterpriseRiskAgentEventResult) => event.eventId));
      const missingEvents = requestedEvents.filter(event => !returnedIds.has(event.id));
      const recovered = missingEvents.length
        ? (await Promise.allSettled(missingEvents.map(event => fetchEnterpriseRiskAgentSingle(assessment, event))))
          .map(result => result.status === 'fulfilled' ? result.value : null)
          .filter((result): result is EnterpriseRiskAgentEventResult => Boolean(result))
        : [];
      console.info('[EnterpriseRiskAgent] batch coverage', {
        requested: requestedEvents.length,
        returned: batchPayload.result.events.length,
        recovered: recovered.length,
      });
      const result: EnterpriseRiskAgentBatchResult = {
        provider: 'qwen',
        model: typeof batchPayload.model === 'string' ? batchPayload.model : undefined,
        events: [...batchPayload.result.events, ...recovered],
      };
      agentResultCache.set(cacheKey, result);
      return result;
    }

    console.warn('[EnterpriseRiskAgent] batch response invalid; trying per-card recovery', batchPayload);
    const recovered = (await Promise.allSettled(
      requestedEvents.map(event => fetchEnterpriseRiskAgentSingle(assessment, event)),
    ))
      .map(result => result.status === 'fulfilled' ? result.value : null)
      .filter((result): result is EnterpriseRiskAgentEventResult => Boolean(result));
    if (!recovered.length) return null;
    const result: EnterpriseRiskAgentBatchResult = {
      provider: 'qwen',
      events: recovered,
      model: recovered.find(event => event.model)?.model,
    };
    agentResultCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('[EnterpriseRiskAgent] request error', error);
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function tasksFromAgentTransmission(
  eventId: string,
  transmission: EnterpriseRiskAgentTransmission,
  fallbackDueDate: (priority: EnterpriseRiskPriority) => string,
): EnterpriseTask[] {
  return transmission.responseTasks
    .filter(task => task.title && task.department)
    .slice(0, 6)
    .map((task, index) => ({
      id: `agent-task-${eventId}-${index}`,
      title: task.title,
      department: task.department as EnterpriseTask['department'],
      dueDate: fallbackDueDate(task.priority),
      priority: task.priority,
      status: task.priority === 'P1' ? 'open' : 'watching',
      sourceEventId: eventId,
      source: 'qwen_agent',
    }));
}
