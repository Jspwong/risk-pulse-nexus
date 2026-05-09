import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type {
  ChokepointInfo,
  CriticalMineral,
  GetShippingStressResponse,
  ShippingIndex,
} from '@/services/supply-chain';

export type EnterpriseRiskTag =
  | 'geopolitical'
  | 'regulatory'
  | 'supply_chain'
  | 'financial_fx';

export type EnterpriseRiskPriority = 'P1' | 'P2' | 'P3';
export type EnterpriseTaskStatus = 'open' | 'in_progress' | 'watching' | 'done';
export type EnterpriseDepartment = 'Compliance' | 'Finance' | 'Supply Chain' | 'Sales' | 'Operations';
export type EnterpriseRiskAgentLayerSource = 'qwen_agent' | 'rule_fallback';

export interface EnterpriseBusinessLine {
  id: string;
  name: string;
  products: string[];
  exportSharePct: number;
  targetMarkets: string[];
  routeExposure: string[];
  revenueAtRiskUsd: number;
}

export interface EnterpriseRiskProfile {
  id: string;
  companyName: string;
  scenarioName: string;
  primaryNarrative: string;
  targetMarkets: string[];
  exportSharePct: number;
  criticalCertifications: string[];
  affectedDepartments: EnterpriseDepartment[];
  riskWeights: Record<EnterpriseRiskTag, number>;
  businessLines: EnterpriseBusinessLine[];
  demoMode: {
    enabled: boolean;
    label: string;
  };
}

export interface EnterpriseRiskEvent {
  id: string;
  title: string;
  source: string;
  sourceType: 'news' | 'cluster' | 'cross_source' | 'supply_chain' | 'market' | 'demo_seed';
  summary: string;
  occurredAt: number;
  tags: EnterpriseRiskTag[];
  countries: string[];
  affectedMarkets: string[];
  severityScore: number;
  priority: EnterpriseRiskPriority;
  link?: string;
  evidenceSources?: Array<{
    title: string;
    source: string;
    link?: string;
    publishedAt?: number;
    reason: string;
  }>;
  location?: {
    lat: number;
    lon: number;
    label: string;
    zoom?: number;
    resolution?: 'feed_coordinate' | 'place_match';
    source?: 'feed' | 'curated_gazetteer' | 'geo_hub_index';
    matchedText?: string;
    confidence?: number;
  };
  explanation: {
    triggerBasis: string[];
    priorityBasis: string[];
    mappingBasis: string[];
    dataQuality: string[];
  };
  impactPath?: {
    routeIds: string[];
    label: string;
    steps: string[];
  };
  agent?: {
    identificationSource: EnterpriseRiskAgentLayerSource;
    transmissionSource: EnterpriseRiskAgentLayerSource;
    confidence?: number;
    provider?: string;
    model?: string;
    appliedAt?: number;
  };
  isDemoSeed: boolean;
}

export interface EnterpriseInternalImpact {
  id: string;
  eventId: string;
  businessLineId: string;
  businessLineName: string;
  department: EnterpriseDepartment;
  action: string;
  impact: string;
  priority: EnterpriseRiskPriority;
  score: number;
  source?: EnterpriseRiskAgentLayerSource;
  confidence?: number;
}

export interface EnterpriseAlert {
  id: string;
  eventId: string;
  title: string;
  priority: EnterpriseRiskPriority;
  message: string;
  departments: EnterpriseDepartment[];
  triggeredAt: number;
  acknowledged: boolean;
}

export interface EnterpriseTask {
  id: string;
  title: string;
  department: EnterpriseDepartment;
  dueDate: string;
  priority: EnterpriseRiskPriority;
  status: EnterpriseTaskStatus;
  sourceEventId: string;
  source?: EnterpriseRiskAgentLayerSource;
}

export interface EnterpriseReportSummary {
  id: string;
  generatedAt: number;
  eventSummary: string;
  internalImpact: string;
  recommendedActions: string[];
  financialImpact: {
    exposureUsd: number;
    estimate: string;
    confidence: 'demo_estimate' | 'modeled';
  };
}

export interface EnterpriseSourceCoverage {
  id: string;
  label: string;
  status: 'live' | 'stale' | 'missing' | 'demo';
  detail: string;
}

export interface EnterpriseRiskAssessment {
  profile: EnterpriseRiskProfile;
  generatedAt: number;
  narrativeWindowMinutes: number;
  events: EnterpriseRiskEvent[];
  impacts: EnterpriseInternalImpact[];
  alerts: EnterpriseAlert[];
  tasks: EnterpriseTask[];
  report: EnterpriseReportSummary;
  sourceCoverage: EnterpriseSourceCoverage[];
  demoSeedUsed: boolean;
  demoStoryPinned: boolean;
  liveEventCount: number;
  locationPolicy: 'feed_or_explicit_place_only';
  agentWorkflow: {
    status: 'candidate' | 'running' | 'applied' | 'fallback';
    provider: 'qwen';
    model?: string;
    enrichedEventCount: number;
    detail: string;
    updatedAt?: number;
  };
  reusedCapabilities: string[];
  gaps: string[];
}

export interface EnterpriseRiskInputs {
  news: NewsItem[];
  clusters: ClusteredEvent[];
  crossSourceSignals?: {
    signals?: Array<{
      id: string;
      type: string;
      theater: string;
      summary: string;
      severity: string;
      severityScore: number;
      detectedAt: number;
      contributingTypes?: string[];
      signalCount?: number;
    }>;
    evaluatedAt?: number;
  } | null;
  supplyChain?: {
    shippingIndices?: ShippingIndex[];
    chokepoints?: ChokepointInfo[];
    minerals?: CriticalMineral[];
    shippingStress?: GetShippingStressResponse | null;
  };
  markets?: MarketData[];
}
