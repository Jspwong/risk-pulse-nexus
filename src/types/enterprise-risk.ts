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
export type EnterpriseRoiMode = 'base' | 'stress';
export type EnterpriseRoiTemplate = EnterpriseRiskTag;
export type EnterpriseRoiAssumptionUnit =
  | 'usd'
  | 'probability'
  | 'percentage'
  | 'days'
  | 'count'
  | 'tonnes_co2e'
  | 'usd_per_day'
  | 'multiple';

export interface EnterpriseRoiAssumptionLine {
  key: string;
  label: string;
  value: number;
  low?: number;
  high?: number;
  unit: EnterpriseRoiAssumptionUnit;
  source: string;
  sourceUrl?: string;
  confidence: number;
  locked?: boolean;
}

export interface EnterpriseRoiAssumptionPack {
  eventId: string;
  template: EnterpriseRoiTemplate;
  version: string;
  generatedBy: 'deterministic' | 'qwen_agent';
  confidence: number;
  assumptions: EnterpriseRoiAssumptionLine[];
  rationale: string[];
  references: string[];
}

export interface EnterpriseRoiAssumptions {
  mode: EnterpriseRoiMode;
  horizonDays: 90 | 365;
  mitigationIntensity: number;
  correlationHaircutPct: number;
  disabledTags?: EnterpriseRiskTag[];
  roiAssumptionPacks?: Record<string, EnterpriseRoiAssumptionPack>;
}

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

export interface EnterpriseRoiScenario {
  tag: EnterpriseRiskTag;
  label: string;
  template: EnterpriseRoiTemplate;
  active: boolean;
  triggered: boolean;
  probabilityPct: number;
  grossExposureUsd: number;
  baselineLossUsd: number;
  residualLossUsd: number;
  expectedLossUsd: number;
  preventablePct: number;
  expectedSavingUsd: number;
  mitigationCostUsd: number;
  netSavingUsd: number;
  roiPct: number;
  confidence: 'demo_estimate' | 'modeled';
  drivers: string[];
  departments: EnterpriseDepartment[];
  assumptionPack: EnterpriseRoiAssumptionPack;
}

export interface EnterpriseRoiSimulation {
  eventId: string;
  totalExposureUsd: number;
  expectedLossUsd: number;
  expectedSavingUsd: number;
  mitigationCostUsd: number;
  netSavingUsd: number;
  compositeRoiPct: number;
  scenarioCount: number;
  scenarios: EnterpriseRoiScenario[];
  assumptionPacks: EnterpriseRoiAssumptionPack[];
  modelVersion: string;
}

export interface EnterpriseReportSummary {
  id: string;
  generatedAt: number;
  eventSummary: string;
  internalImpact: string;
  recommendedActions: string[];
  financialImpact: {
    exposureUsd: number;
    expectedLossUsd: number;
    expectedSavingUsd: number;
    mitigationCostUsd: number;
    netSavingUsd: number;
    compositeRoiPct: number;
    scenarios: EnterpriseRoiScenario[];
    simulation: EnterpriseRoiSimulation;
    assumptionPacks: EnterpriseRoiAssumptionPack[];
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
  roiAssumptionPacks?: Record<string, EnterpriseRoiAssumptionPack>;
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
