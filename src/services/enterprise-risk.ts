import { NEW_ENERGY_EXPORTER_PROFILE } from '@/config/enterprise-risk-profile';
import type {
  EnterpriseAlert,
  EnterpriseDepartment,
  EnterpriseInternalImpact,
  EnterpriseReportSummary,
  EnterpriseRiskAssessment,
  EnterpriseRiskEvent,
  EnterpriseRiskInputs,
  EnterpriseRiskPriority,
  EnterpriseRiskTag,
  EnterpriseSourceCoverage,
  EnterpriseTask,
} from '@/types/enterprise-risk';
import type { EnterpriseRiskAgentBatchResult, EnterpriseRiskAgentTransmission } from '@/services/enterprise-risk-agent-client';
import type { ClusteredEvent, NewsItem } from '@/types';
import type { DataSourceId } from '@/services/data-freshness';
import { dataFreshness } from '@/services/data-freshness';
import type { ChokepointInfo, CriticalMineral, ShippingIndex } from '@/services/supply-chain';
import { inferGeoHubsFromTitle } from '@/services/geo-hub-index';
import { tokenizeForMatch, matchKeyword } from '@/utils/keyword-match';

const PROFILE = NEW_ENERGY_EXPORTER_PROFILE;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_LIVE_APPENDIX = 5;
const LIVE_EVENT_WINDOW_MS = 7 * DAY_MS;

const TAG_LABELS: Record<EnterpriseRiskTag, string> = {
  geopolitical: '地缘政治风险',
  regulatory: '合规监管风险',
  supply_chain: '供应链风险',
  financial_fx: '汇率风险',
};

const TAG_KEYWORDS: Record<EnterpriseRiskTag, string[]> = {
  geopolitical: ['war', 'conflict', 'attack', 'sanction', 'export control', 'red sea', 'suez', 'malacca', 'border', 'protest', 'geopolitical'],
  regulatory: ['cbam', 'carbon border', 'tariff', 'duties', 'regulation', 'battery regulation', 'customs', 'probe', 'investigation', 'emissions', 'audit', 'certification', 'iso 14064', 'reach', 'rohs', 'declaration', 'traceability', 'forced labor', 'due diligence'],
  supply_chain: ['supplier', 'supply chain', 'shortage', 'critical mineral', 'lithium', 'aluminum', 'aluminium', 'nickel', 'factory', 'manufacturing', 'strike', 'shutdown', 'production', 'port', 'shipping', 'freight', 'container', 'reroute', 'rail', 'airport', 'logistics', 'typhoon', 'flood', 'earthquake', 'wildfire', 'storm', 'drought'],
  financial_fx: ['yuan', 'renminbi', 'euro', 'eur', 'vnd', 'dong', 'baht', 'rupiah', 'currency', 'fx', 'exchange rate', 'central bank', 'inflation', 'margin', 'hedge', 'premium', 'working capital', 'receivable', 'cost', 'freight rate', 'price', 'rate hike', 'bond yield'],
};

const LIVE_CONTEXT_KEYWORDS = [
  'alert', 'attack', 'ban', 'blocked', 'border', 'central bank', 'compliance',
  'conflict', 'container', 'cost', 'customs', 'delay', 'disruption', 'drought',
  'earthquake', 'export', 'factory', 'flood', 'freight', 'inflation', 'logistics',
  'port', 'price', 'probe', 'protest', 'rate', 'regulation', 'reroute', 'risk',
  'sanction', 'shipping', 'shortage', 'strike', 'storm', 'supplier', 'tariff',
  'trade', 'transport', 'typhoon', 'war', 'wildfire',
];

const ROUTE_KEYWORDS: Array<{ routeIds: string[]; label: string; steps: string[]; keywords: string[] }> = [
  {
    routeIds: ['china-europe-suez'],
    label: 'China export base -> Suez/Red Sea corridor -> Rotterdam/Hamburg -> Europe battery tray line',
    steps: ['China export base', 'Suez / Red Sea corridor', 'Rotterdam / Hamburg', '欧洲电池托盘出口线'],
    keywords: ['red sea', 'suez', 'rotterdam', 'hamburg', 'europe', 'eu', 'cbam'],
  },
  {
    routeIds: ['china-europe-suez', 'asia-europe-cape'],
    label: 'Asia-Europe shipping lane -> European customer delivery window',
    steps: ['Asia-Europe shipping lane', 'Chokepoint risk', 'European port intake', '欧洲电池托盘出口线'],
    keywords: ['shipping', 'freight', 'container', 'reroute', 'delay'],
  },
  {
    routeIds: ['intra-asia-container'],
    label: 'Intra-Asia supplier lane -> Southeast Asia assembly suppliers',
    steps: ['Intra-Asia supplier lane', 'Singapore / Malacca corridor', 'Southeast Asia supplier base', '东南亚储能结构件供应线'],
    keywords: ['malacca', 'singapore', 'vietnam', 'thailand', 'indonesia', 'ho chi minh', 'laem chabang', 'jakarta'],
  },
];

const MARKET_KEYWORDS: Record<string, string[]> = {
  EU: ['eu', 'europe', 'european', 'germany', 'netherlands', 'rotterdam', 'hamburg', 'antwerp', 'cbam', 'suez', 'red sea'],
  Germany: ['germany', 'german', 'hamburg', 'duisburg'],
  Netherlands: ['netherlands', 'dutch', 'rotterdam'],
  Vietnam: ['vietnam', 'vnd', 'dong', 'ho chi minh', 'saigon', 'hanoi', 'hai phong'],
  Thailand: ['thailand', 'thai', 'baht', 'laem chabang', 'bangkok'],
  Indonesia: ['indonesia', 'rupiah', 'jakarta', 'surabaya', 'batam'],
};

const LOCATION_HINTS: Array<{ label: string; lat: number; lon: number; zoom: number; keywords: string[] }> = [
  { label: 'Red Sea', lat: 20.0, lon: 38.0, zoom: 4.6, keywords: ['red sea'] },
  { label: 'Bab el-Mandeb', lat: 12.7, lon: 43.3, zoom: 5.2, keywords: ['bab el-mandeb', 'bab al-mandab'] },
  { label: 'Suez Canal', lat: 30.6, lon: 32.3, zoom: 5.2, keywords: ['suez canal', 'suez'] },
  { label: 'Port of Rotterdam', lat: 51.95, lon: 4.14, zoom: 6.5, keywords: ['rotterdam', 'port of rotterdam'] },
  { label: 'Port of Hamburg', lat: 53.54, lon: 9.99, zoom: 6.5, keywords: ['hamburg', 'port of hamburg'] },
  { label: 'Port of Antwerp-Bruges', lat: 51.28, lon: 4.27, zoom: 6.4, keywords: ['antwerp', 'port of antwerp', 'antwerp-bruges'] },
  { label: 'Duisburg logistics hub', lat: 51.43, lon: 6.76, zoom: 6.4, keywords: ['duisburg'] },
  { label: 'Piraeus port', lat: 37.94, lon: 23.64, zoom: 6.3, keywords: ['piraeus', 'port of piraeus'] },
  { label: 'Strait of Malacca', lat: 2.6, lon: 101.0, zoom: 5.2, keywords: ['malacca', 'strait of malacca'] },
  { label: 'Singapore port', lat: 1.26, lon: 103.82, zoom: 6.4, keywords: ['singapore port', 'port of singapore', 'singapore'] },
  { label: 'Port Klang', lat: 3.0, lon: 101.39, zoom: 6.2, keywords: ['port klang', 'klang'] },
  { label: 'Laem Chabang port', lat: 13.08, lon: 100.9, zoom: 6.3, keywords: ['laem chabang'] },
  { label: 'Bangkok', lat: 13.76, lon: 100.5, zoom: 6.1, keywords: ['bangkok'] },
  { label: 'Ho Chi Minh City manufacturing corridor', lat: 10.78, lon: 106.7, zoom: 6.0, keywords: ['ho chi minh', 'saigon'] },
  { label: 'Hanoi', lat: 21.03, lon: 105.85, zoom: 6.1, keywords: ['hanoi'] },
  { label: 'Hai Phong port', lat: 20.86, lon: 106.68, zoom: 6.2, keywords: ['hai phong', 'haiphong'] },
  { label: 'Jakarta', lat: -6.2, lon: 106.8, zoom: 5.8, keywords: ['jakarta'] },
  { label: 'Surabaya port', lat: -7.22, lon: 112.73, zoom: 6.0, keywords: ['surabaya', 'tanjung perak'] },
  { label: 'Batam manufacturing zone', lat: 1.13, lon: 104.05, zoom: 6.1, keywords: ['batam'] },
  { label: 'Brussels / European Commission', lat: 50.85, lon: 4.35, zoom: 5.4, keywords: ['brussels', 'european commission'] },
  { label: 'Shanghai export base', lat: 31.23, lon: 121.47, zoom: 5.8, keywords: ['shanghai'] },
  { label: 'Ningbo-Zhoushan port', lat: 29.87, lon: 121.55, zoom: 6.0, keywords: ['ningbo', 'zhoushan', 'ningbo-zhoushan'] },
  { label: 'Shenzhen export base', lat: 22.54, lon: 114.06, zoom: 6.0, keywords: ['shenzhen'] },
  { label: 'Guangzhou manufacturing base', lat: 23.13, lon: 113.26, zoom: 6.0, keywords: ['guangzhou'] },
  { label: 'Qingdao port', lat: 36.07, lon: 120.38, zoom: 6.0, keywords: ['qingdao'] },
  { label: 'Tianjin port', lat: 39.0, lon: 117.75, zoom: 6.0, keywords: ['tianjin'] },
];

const BROAD_GEO_KEYWORDS = new Set([
  'china',
  'chinese',
  'europe',
  'european',
  'german',
  'germany',
  'india',
  'indian',
  'indonesia',
  'indonesian',
  'netherlands',
  'thai',
  'thailand',
  'vietnam',
  'vietnamese',
]);

const DEPARTMENT_RULES: Array<{
  tags: EnterpriseRiskTag[];
  department: EnterpriseDepartment;
  action: string;
}> = [
  {
    tags: ['regulatory'],
    department: 'Compliance',
    action: '核对 CBAM 申报口径、供应商碳因子和目标市场认证清单',
  },
  {
    tags: ['financial_fx'],
    department: 'Finance',
    action: '复核欧元/东南亚货币敞口、远期锁汇和应收账款敏感性',
  },
  {
    tags: ['supply_chain'],
    department: 'Supply Chain',
    action: '评估关键航线、港口拥堵和替代物流方案',
  },
  {
    tags: ['regulatory', 'supply_chain'],
    department: 'Sales',
    action: '同步客户交付风险、价格条款和可能的延期窗口',
  },
  {
    tags: ['supply_chain', 'regulatory'],
    department: 'Operations',
    action: '检查安全库存、排产缓冲和供应商数据提交节奏',
  },
];

const DEMO_EVENTS: EnterpriseRiskEvent[] = [
  {
    id: 'demo-cbam-red-sea-001',
    title: 'EU CBAM reporting window tightens while Red Sea rerouting adds transit delay',
    source: 'Demo seed: WorldMonitor scenario',
    sourceType: 'demo_seed',
    summary: '欧盟 CBAM 申报窗口收紧，同时红海/苏伊士绕行增加欧洲交付周期，影响电池托盘和铝压铸件出口线。',
    occurredAt: Date.now() - 6 * MINUTE_MS,
    tags: ['regulatory', 'supply_chain', 'geopolitical'],
    countries: ['EU', 'DE', 'NL'],
    affectedMarkets: ['EU', 'Germany', 'Netherlands'],
    severityScore: 88,
    priority: 'P1',
    link: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
    location: {
      lat: 22.5,
      lon: 38.5,
      label: 'Red Sea / Suez corridor',
      zoom: 4.2,
      resolution: 'place_match',
      source: 'curated_gazetteer',
      matchedText: 'red sea',
      confidence: 0.98,
    },
    impactPath: {
      routeIds: ['china-europe-suez'],
      label: 'China export base -> Suez/Red Sea corridor -> Rotterdam/Hamburg -> Europe battery tray line',
      steps: ['China export base', 'Red Sea / Suez corridor', 'Rotterdam / Hamburg', '欧洲电池托盘出口线'],
    },
    explanation: {
      triggerBasis: ['Scenario keywords: cbam, red sea, suez', '监管: cbam', '供应链: red sea, suez'],
      priorityBasis: ['Severity score 88 -> P1', 'Pinned demo event is calibrated as immediate because regulation and supply-chain risk co-fire'],
      mappingBasis: ['Affected markets: EU, Germany, Netherlands', 'Business path: China export base -> Suez/Red Sea corridor -> Rotterdam/Hamburg -> Europe battery tray line'],
      dataQuality: ['Pinned demo storyline', 'Map target from curated_gazetteer: Red Sea / Suez corridor'],
    },
    evidenceSources: [{
      title: 'Carbon Border Adjustment Mechanism guidance and reporting obligations',
      source: 'European Commission',
      link: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
      reason: 'Official CBAM policy source used as the demo baseline for the compliance trigger.',
    }],
    isDemoSeed: true,
  },
  {
    id: 'demo-vnd-fx-002',
    title: 'Ho Chi Minh City assembly suppliers face Vietnam dong volatility',
    source: 'Demo seed: FX monitor',
    sourceType: 'demo_seed',
    summary: '越南盾波动放大东南亚储能结构件供应线的采购和回款敞口，需要财务与销售联合更新报价假设。',
    occurredAt: Date.now() - 18 * MINUTE_MS,
    tags: ['financial_fx', 'supply_chain'],
    countries: ['VN'],
    affectedMarkets: ['Vietnam'],
    severityScore: 61,
    priority: 'P2',
    link: 'https://www.sbv.gov.vn/webcenter/portal/en/home/sbv',
    location: {
      lat: 10.78,
      lon: 106.7,
      label: 'Ho Chi Minh City manufacturing corridor',
      zoom: 5.5,
      resolution: 'place_match',
      source: 'curated_gazetteer',
      matchedText: 'ho chi minh',
      confidence: 0.98,
    },
    impactPath: {
      routeIds: ['intra-asia-container'],
      label: 'Intra-Asia supplier lane -> Southeast Asia assembly suppliers',
      steps: ['Intra-Asia supplier lane', 'Vietnam supplier base', '东南亚储能结构件供应线'],
    },
    explanation: {
      triggerBasis: ['Scenario keywords: vietnam, vnd', '汇率: vnd, dong, cost'],
      priorityBasis: ['Severity score 61 -> P2', 'FX exposure is material but not an immediate P1 operational stop'],
      mappingBasis: ['Affected markets: Vietnam', 'Business path: Intra-Asia supplier lane -> Southeast Asia assembly suppliers'],
      dataQuality: ['Pinned demo storyline', 'Map target from curated_gazetteer: Ho Chi Minh City manufacturing corridor'],
    },
    evidenceSources: [{
      title: 'State Bank of Vietnam official information portal',
      source: 'State Bank of Vietnam',
      link: 'https://www.sbv.gov.vn/webcenter/portal/en/home/sbv',
      reason: 'Official central bank source for Vietnam dong and monetary policy monitoring.',
    }],
    isDemoSeed: true,
  },
];

type EnterpriseCrossSourceSignal = NonNullable<NonNullable<EnterpriseRiskInputs['crossSourceSignals']>['signals']>[number];

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function evidenceFromNewsItem(item: NewsItem, reason: string): NonNullable<EnterpriseRiskEvent['evidenceSources']>[number] {
  return {
    title: item.title,
    source: item.source,
    link: item.link,
    publishedAt: item.pubDate.getTime(),
    reason,
  };
}

function evidenceFromCluster(cluster: ClusteredEvent, reason: string): NonNullable<EnterpriseRiskEvent['evidenceSources']>[number] {
  return {
    title: cluster.primaryTitle,
    source: cluster.primarySource,
    link: cluster.primaryLink,
    publishedAt: cluster.lastUpdated.getTime(),
    reason,
  };
}

function pickBestCbamSource(inputs: EnterpriseRiskInputs): NonNullable<EnterpriseRiskEvent['evidenceSources']>[number] {
  const candidates = [
    ...inputs.news.map(item => ({
      evidence: evidenceFromNewsItem(item, 'Best live CBAM-related news source found in RSS inputs.'),
      text: `${item.title} ${item.snippet ?? ''} ${item.source}`,
      sourceCount: item.corroborationCount ?? item.storyMeta?.sourceCount ?? 1,
      score: item.importanceScore ?? 0,
      ts: item.pubDate.getTime(),
    })),
    ...inputs.clusters.map(cluster => ({
      evidence: evidenceFromCluster(cluster, 'Best live CBAM-related clustered source found in news clusters.'),
      text: `${cluster.primaryTitle} ${cluster.primarySource} ${cluster.topSources.map(s => s.name).join(' ')}`,
      sourceCount: cluster.sourceCount,
      score: cluster.sourceCount * 12 + (cluster.isAlert ? 20 : 0),
      ts: cluster.lastUpdated.getTime(),
    })),
  ]
    .filter(candidate => isWithinLiveWindow(candidate.ts))
    .filter(candidate => /\b(cbam|carbon border|carbon border adjustment|embedded emissions|battery regulation|eu customs)\b/i.test(candidate.text));

  candidates.sort((a, b) =>
    b.sourceCount - a.sourceCount ||
    b.score - a.score ||
    b.ts - a.ts,
  );

  return candidates[0]?.evidence ?? {
    title: 'Carbon Border Adjustment Mechanism guidance and reporting obligations',
    source: 'European Commission',
    link: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
    reason: 'Official CBAM policy source used when no fresher live CBAM article is available.',
  };
}

function attachCbamEvidence(events: EnterpriseRiskEvent[], inputs: EnterpriseRiskInputs): EnterpriseRiskEvent[] {
  const cbamEvidence = pickBestCbamSource(inputs);
  return events.map(event => {
    const isCbam = /\b(cbam|carbon border|embedded emissions)\b/i.test(`${event.title} ${event.summary}`)
      || event.id.includes('cbam');
    if (!isCbam) return event;
    const existing = event.evidenceSources ?? [];
    if (existing.some(source => source.link && source.link === cbamEvidence.link)) return event;
    return {
      ...event,
      evidenceSources: [cbamEvidence, ...existing].slice(0, 3),
      explanation: {
        ...event.explanation,
        dataQuality: [
          ...event.explanation.dataQuality,
          `Best evidence source: ${cbamEvidence.source} - ${cbamEvidence.title}`,
        ],
      },
    };
  });
}

function topKeywordHits(text: string, keywords: string[], limit = 4): string[] {
  const lower = normalizeText(text);
  return keywords.filter(keyword => lower.includes(keyword)).slice(0, limit);
}

function priorityFromScore(score: number): EnterpriseRiskPriority {
  if (score >= 78) return 'P1';
  if (score >= 52) return 'P2';
  return 'P3';
}

function priorityFromLiveEvent(text: string, score: number): EnterpriseRiskPriority {
  if (score >= 82 && isScenarioRelevant(text)) return 'P1';
  if (score >= 56) return 'P2';
  return 'P3';
}

function scorePriority(priority: EnterpriseRiskPriority): number {
  return priority === 'P1' ? 3 : priority === 'P2' ? 2 : 1;
}

function maxPriority(a: EnterpriseRiskPriority, b: EnterpriseRiskPriority): EnterpriseRiskPriority {
  return scorePriority(a) >= scorePriority(b) ? a : b;
}

function agentStatus(
  status: EnterpriseRiskAssessment['agentWorkflow']['status'],
  detail: string,
  enrichedEventCount = 0,
  model?: string,
): EnterpriseRiskAssessment['agentWorkflow'] {
  return {
    status,
    provider: 'qwen',
    model,
    enrichedEventCount,
    detail,
    updatedAt: Date.now(),
  };
}

function classifyTags(text: string): EnterpriseRiskTag[] {
  const lower = normalizeText(text);
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, words]) => words.some(word => lower.includes(word)))
    .map(([tag]) => tag as EnterpriseRiskTag);
  return unique(tags);
}

function tagEvidence(text: string, tags: EnterpriseRiskTag[]): string[] {
  const evidence: string[] = [];
  for (const tag of tags) {
    const hits = topKeywordHits(text, TAG_KEYWORDS[tag] ?? [], 3);
    if (hits.length) evidence.push(`${TAG_LABELS[tag]}: ${hits.join(', ')}`);
  }
  return evidence;
}

function inferMarkets(text: string): string[] {
  const lower = normalizeText(text);
  const markets = Object.entries(MARKET_KEYWORDS)
    .filter(([, words]) => words.some(word => lower.includes(word)))
    .map(([market]) => market);
  return unique(markets);
}

function countryHints(text: string): string[] {
  const lower = normalizeText(text);
  const hints: string[] = [];
  if (/\b(eu|europe|european|germany|german|netherlands|dutch)\b/.test(lower)) hints.push('EU');
  if (/\b(vietnam|vnd|dong)\b/.test(lower)) hints.push('VN');
  if (/\b(thailand|thai|baht)\b/.test(lower)) hints.push('TH');
  if (/\b(indonesia|rupiah)\b/.test(lower)) hints.push('ID');
  if (/\b(china|chinese|rmb|yuan|renminbi)\b/.test(lower)) hints.push('CN');
  return unique(hints);
}

function inferLocationFromText(text: string): EnterpriseRiskEvent['location'] | undefined {
  const tokens = tokenizeForMatch(text);
  for (const hint of LOCATION_HINTS) {
    const matchedText = hint.keywords.find(keyword => matchKeyword(tokens, keyword));
    if (!matchedText) continue;
    return {
      lat: hint.lat,
      lon: hint.lon,
      label: hint.label,
      zoom: hint.zoom,
      resolution: 'place_match',
      source: 'curated_gazetteer',
      matchedText,
      confidence: 0.96,
    };
  }

  const hubMatch = inferGeoHubsFromTitle(text).find(match => {
    const keyword = match.matchedKeyword.toLowerCase();
    return match.confidence >= 0.75 && !BROAD_GEO_KEYWORDS.has(keyword);
  });
  if (!hubMatch) return undefined;
  return {
    lat: hubMatch.hub.lat,
    lon: hubMatch.hub.lon,
    label: hubMatch.hub.name,
    zoom: hubMatch.hub.type === 'strategic' || hubMatch.hub.type === 'conflict' ? 5.0 : 5.8,
    resolution: 'place_match',
    source: 'geo_hub_index',
    matchedText: hubMatch.matchedKeyword,
    confidence: hubMatch.confidence,
  };
}

function inferLocation(text: string, coordinates?: { lat?: number; lon?: number; label?: string; zoom?: number }): EnterpriseRiskEvent['location'] | undefined {
  const lat = coordinates?.lat;
  const lon = coordinates?.lon;
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon)) {
    return {
      lat,
      lon,
      label: coordinates?.label || 'External event',
      zoom: coordinates?.zoom,
      resolution: 'feed_coordinate',
      source: 'feed',
      confidence: 1,
    };
  }

  return inferLocationFromText(text);
}

function isScenarioRelevant(text: string): boolean {
  const lower = normalizeText(text);
  const scenarioTerms = [
    'cbam', 'battery', 'ev', 'new energy', 'aluminum', 'aluminium', 'lithium', 'supply chain',
    'suez', 'red sea', 'malacca', 'port', 'shipping', 'freight', 'vietnam', 'thailand',
    'indonesia', 'europe', 'eu', 'euro', 'vnd', 'dong', 'carbon',
  ];
  return scenarioTerms.some(term => lower.includes(term));
}

function isWithinLiveWindow(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp >= Date.now() - LIVE_EVENT_WINDOW_MS;
}

function liveWindowLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Timestamp unavailable';
  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / DAY_MS));
  return ageDays === 0 ? 'Published within the last 24h' : `Published ${ageDays} day(s) ago, inside the 7-day live window`;
}

function isLiveContextRelevant(text: string): boolean {
  const lower = normalizeText(text);
  if (isScenarioRelevant(text)) return true;
  return LIVE_CONTEXT_KEYWORDS.some(term => lower.includes(term));
}

function fallbackLiveTags(text: string): EnterpriseRiskTag[] {
  const lower = normalizeText(text);
  const tags = classifyTags(text);
  if (tags.length) return tags;
  if (/\b(war|conflict|attack|border|sanction|export control|red sea|suez|malacca)\b/.test(lower)) return ['geopolitical', 'supply_chain'];
  if (/\b(port|shipping|freight|container|rail|airport|logistics|reroute|delay|storm|flood|earthquake|wildfire|typhoon|hurricane|cyclone|drought)\b/.test(lower)) return ['supply_chain'];
  if (/\b(tariff|customs|sanction|ban|regulation|probe|investigation|export|emissions|audit|certification|due diligence)\b/.test(lower)) return ['regulatory'];
  if (/\b(rate|currency|inflation|price|cost|central bank|yield|margin|hedge)\b/.test(lower)) return ['financial_fx'];
  if (/\b(strike|shortage|factory|supplier|production|shutdown)\b/.test(lower)) return ['supply_chain'];
  return ['supply_chain'];
}

function liveContextScore(text: string, baseScore: number): number {
  const lower = normalizeText(text);
  const scenarioRelevant = isScenarioRelevant(text);
  let score = Math.min(baseScore, scenarioRelevant ? 74 : 58);
  if (scenarioRelevant) score += 12;
  for (const keyword of LIVE_CONTEXT_KEYWORDS) {
    if (lower.includes(keyword)) score += scenarioRelevant ? 2.5 : 1.5;
  }
  if (inferLocationFromText(text)) score += 3;
  return Math.max(32, Math.min(scenarioRelevant ? 86 : 74, Math.round(score)));
}

function buildImpactPath(text: string, markets: string[] = []): EnterpriseRiskEvent['impactPath'] | undefined {
  const combined = `${text} ${markets.join(' ')}`;
  const tokens = tokenizeForMatch(combined);
  const route = ROUTE_KEYWORDS.find(candidate => candidate.keywords.some(keyword => matchKeyword(tokens, keyword)));
  if (!route) return undefined;
  return {
    routeIds: route.routeIds,
    label: route.label,
    steps: route.steps,
  };
}

function priorityBasisFor(text: string, score: number, priority: EnterpriseRiskPriority, sourceType: EnterpriseRiskEvent['sourceType']): string[] {
  const basis = [`Severity score ${score} -> ${priority}`];
  if (sourceType === 'news' || sourceType === 'cluster') {
    basis.push(isScenarioRelevant(text)
      ? 'P1 requires score >= 82 and direct scenario relevance for live news/clusters'
      : 'Generic live context is capped below P1 unless it is directly scenario-relevant');
  } else {
    basis.push('Structured supply-chain / signal sources use the standard 78/52 thresholds');
  }
  return basis;
}

function buildExplanation(params: {
  text: string;
  tags: EnterpriseRiskTag[];
  priority: EnterpriseRiskPriority;
  score: number;
  sourceType: EnterpriseRiskEvent['sourceType'];
  occurredAt: number;
  location?: EnterpriseRiskEvent['location'];
  markets: string[];
  impactPath?: EnterpriseRiskEvent['impactPath'];
}): EnterpriseRiskEvent['explanation'] {
  const scenarioHits = topKeywordHits(params.text, [
    'cbam', 'battery', 'ev', 'aluminum', 'lithium', 'supply chain', 'suez', 'red sea',
    'malacca', 'port', 'shipping', 'freight', 'vietnam', 'thailand', 'indonesia',
    'europe', 'eu', 'euro', 'vnd', 'carbon',
  ], 5);
  const liveHits = topKeywordHits(params.text, LIVE_CONTEXT_KEYWORDS, 5);
  const triggerBasis = [
    ...(scenarioHits.length ? [`Scenario keywords: ${scenarioHits.join(', ')}`] : []),
    ...(liveHits.length ? [`Live risk keywords: ${liveHits.join(', ')}`] : []),
    ...tagEvidence(params.text, params.tags),
  ];
  const mappingBasis = [
    params.markets.length ? `Affected markets: ${params.markets.join(', ')}` : 'No exact market hit; mapped by tags and business-line exposure',
    params.impactPath ? `Business path: ${params.impactPath.label}` : 'No route path highlighted; department mapping still follows risk tags',
  ];
  return {
    triggerBasis: triggerBasis.length ? triggerBasis : ['Accepted from structured source score and risk tags'],
    priorityBasis: priorityBasisFor(params.text, params.score, params.priority, params.sourceType),
    mappingBasis,
    dataQuality: [
      params.sourceType === 'demo_seed' ? 'Pinned demo storyline' : liveWindowLabel(params.occurredAt),
      params.location
        ? `Map target from ${params.location.source ?? params.location.resolution ?? 'location match'}: ${params.location.label}`
        : 'No map jump: source has no coordinates or explicit place match',
    ],
  };
}

function threatScore(item: NewsItem | ClusteredEvent): number {
  const threat = item.threat;
  if (!threat) return 36;
  const base = { critical: 92, high: 74, medium: 54, low: 34, info: 18 }[threat.level] ?? 36;
  return Math.round(base * Math.max(0.45, threat.confidence ?? 0.8));
}

function weightedScore(baseScore: number, tags: EnterpriseRiskTag[]): number {
  if (tags.length === 0) return baseScore;
  const multiplier = tags.reduce((sum, tag) => sum + (PROFILE.riskWeights[tag] ?? 1), 0) / tags.length;
  return Math.max(1, Math.min(100, Math.round(baseScore * multiplier)));
}

function eventFromNews(item: NewsItem): EnterpriseRiskEvent | null {
  const text = `${item.title} ${item.snippet ?? ''} ${item.source}`;
  const occurredAt = item.pubDate.getTime();
  if (!isWithinLiveWindow(occurredAt)) return null;
  if (!isLiveContextRelevant(text)) return null;
  const tags = fallbackLiveTags(text);
  const markets = inferMarkets(text);
  const score = weightedScore(
    liveContextScore(text, Math.max(threatScore(item), item.importanceScore ?? 0, item.isAlert ? 66 : 0)),
    tags,
  );
  const priority = priorityFromLiveEvent(text, score);
  const location = inferLocation(text, item.lat != null && item.lon != null ? { lat: item.lat, lon: item.lon, label: item.locationName || item.title, zoom: 5.2 } : undefined);
  const impactPath = buildImpactPath(text, markets);
  return {
    id: `news-${stableHash(`${item.source}|${item.title}|${item.pubDate.getTime()}`)}`,
    title: item.title,
    source: item.source,
    sourceType: 'news',
    summary: item.snippet || item.title,
    occurredAt,
    tags,
    countries: countryHints(text),
    affectedMarkets: markets,
    severityScore: score,
    priority,
    link: item.link,
    evidenceSources: [evidenceFromNewsItem(item, 'Original live headline used by the enterprise risk classifier.')],
    location,
    impactPath,
    explanation: buildExplanation({ text, tags, priority, score, sourceType: 'news', occurredAt, location, markets, impactPath }),
    isDemoSeed: false,
  };
}

function eventFromCluster(cluster: ClusteredEvent): EnterpriseRiskEvent | null {
  const text = `${cluster.primaryTitle} ${cluster.topSources.map(s => s.name).join(' ')}`;
  const occurredAt = cluster.lastUpdated.getTime();
  if (!isWithinLiveWindow(occurredAt)) return null;
  if (!isLiveContextRelevant(text)) return null;
  const tags = fallbackLiveTags(text);
  const score = weightedScore(
    liveContextScore(text, Math.max(threatScore(cluster), cluster.sourceCount * 8, cluster.isAlert ? 70 : 0)),
    tags,
  );
  const priority = priorityFromLiveEvent(text, score);
  const markets = inferMarkets(text);
  const location = inferLocation(text, cluster.lat != null && cluster.lon != null ? { lat: cluster.lat, lon: cluster.lon, label: cluster.primaryTitle, zoom: 5.2 } : undefined);
  const impactPath = buildImpactPath(text, markets);
  return {
    id: `cluster-${cluster.id}`,
    title: cluster.primaryTitle,
    source: cluster.primarySource,
    sourceType: 'cluster',
    summary: `Clustered from ${cluster.sourceCount} source${cluster.sourceCount === 1 ? '' : 's'}; latest update ${cluster.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
    occurredAt,
    tags,
    countries: countryHints(text),
    affectedMarkets: markets,
    severityScore: score,
    priority,
    link: cluster.primaryLink,
    evidenceSources: [
      evidenceFromCluster(cluster, `Primary article from a ${cluster.sourceCount}-source live cluster.`),
      ...cluster.topSources
        .filter(source => source.name !== cluster.primarySource)
        .slice(0, 2)
        .map(source => ({
          title: cluster.primaryTitle,
          source: source.name,
          link: source.url,
          publishedAt: cluster.lastUpdated.getTime(),
          reason: 'Additional source in the same live cluster.',
        })),
    ],
    location,
    impactPath,
    explanation: buildExplanation({ text, tags, priority, score, sourceType: 'cluster', occurredAt, location, markets, impactPath }),
    isDemoSeed: false,
  };
}

function eventFromSignal(signal: EnterpriseCrossSourceSignal): EnterpriseRiskEvent | null {
  const text = `${signal.type} ${signal.theater} ${signal.summary} ${(signal.contributingTypes ?? []).join(' ')}`;
  if (!isWithinLiveWindow(signal.detectedAt)) return null;
  const tags = classifyTags(text);
  if (!isScenarioRelevant(text) && !text.toLowerCase().includes('shipping')) return null;
  const severityBoost = signal.severity.includes('CRITICAL') ? 94
    : signal.severity.includes('HIGH') ? 78
      : signal.severity.includes('MEDIUM') ? 58
        : 38;
  const score = weightedScore(Math.max(severityBoost, signal.severityScore), tags.length ? tags : ['supply_chain']);
  const resolvedTags = tags.length ? tags : ['supply_chain'] as EnterpriseRiskTag[];
  const priority = priorityFromScore(score);
  const markets = inferMarkets(text);
  const location = inferLocation(text);
  const impactPath = buildImpactPath(text, markets);
  return {
    id: `signal-${signal.id}`,
    title: signal.summary,
    source: 'Cross-Source Signals',
    sourceType: 'cross_source',
    summary: `${signal.theater} co-fire signal across ${signal.signalCount ?? 1} stream(s).`,
    occurredAt: signal.detectedAt,
    tags: resolvedTags,
    countries: countryHints(text),
    affectedMarkets: markets,
    severityScore: score,
    priority,
    location,
    impactPath,
    explanation: buildExplanation({ text, tags: resolvedTags, priority, score, sourceType: 'cross_source', occurredAt: signal.detectedAt, location, markets, impactPath }),
    isDemoSeed: false,
  };
}

function eventFromChokepoint(cp: ChokepointInfo): EnterpriseRiskEvent | null {
  const text = `${cp.name} ${cp.status} ${cp.warRiskTier ?? ''} ${cp.transitSummary?.riskReportAction ?? ''}`;
  if (!isScenarioRelevant(text) && cp.disruptionScore < 35) return null;
  const transitRisk = cp.transitSummary?.disruptionPct ?? 0;
  const tags: EnterpriseRiskTag[] = ['supply_chain', 'financial_fx'];
  const score = weightedScore(Math.max(cp.disruptionScore, transitRisk * 6), tags);
  if (score < 45) return null;
  const priority = priorityFromScore(score);
  const markets = inferMarkets(text);
  const location = inferLocation(text, { lat: cp.lat, lon: cp.lon, label: cp.name, zoom: 5.2 });
  const impactPath = buildImpactPath(text, markets);
  return {
    id: `chokepoint-${stableHash(cp.id || cp.name)}`,
    title: `${cp.name} transport disruption score ${Math.round(cp.disruptionScore)}`,
    source: 'Supply Chain Intelligence',
    sourceType: 'supply_chain',
    summary: cp.transitSummary?.riskReportAction || `${cp.name} status is ${cp.status}; war-risk tier ${cp.warRiskTier ?? 'normal'}.`,
    occurredAt: Date.now(),
    tags,
    countries: countryHints(text),
    affectedMarkets: markets,
    severityScore: score,
    priority,
    location,
    impactPath,
    explanation: buildExplanation({ text, tags, priority, score, sourceType: 'supply_chain', occurredAt: Date.now(), location, markets, impactPath }),
    isDemoSeed: false,
  };
}

function eventFromShippingIndex(index: ShippingIndex): EnterpriseRiskEvent | null {
  const text = `${index.indexId} ${index.name}`;
  if (!Number.isFinite(index.changePct) || Math.abs(index.changePct) < 8) return null;
  const tags: EnterpriseRiskTag[] = ['supply_chain', 'financial_fx'];
  const score = weightedScore(Math.min(84, 42 + Math.abs(index.changePct) * 2.4), tags);
  const priority = priorityFromScore(score);
  const markets = inferMarkets(text);
  const location = inferLocation(text);
  const impactPath = buildImpactPath(text, markets);
  return {
    id: `shipping-${stableHash(`${index.indexId}|${index.currentValue}|${index.changePct}`)}`,
    title: `${index.name} moved ${index.changePct >= 0 ? '+' : ''}${index.changePct.toFixed(1)}%`,
    source: 'Supply Chain Intelligence',
    sourceType: 'supply_chain',
    summary: `Freight index at ${index.currentValue.toFixed(0)} ${index.unit}; cost pass-through risk for export lanes.`,
    occurredAt: Date.now(),
    tags,
    countries: [],
    affectedMarkets: markets,
    severityScore: score,
    priority,
    location,
    impactPath,
    explanation: buildExplanation({ text, tags, priority, score, sourceType: 'supply_chain', occurredAt: Date.now(), location, markets, impactPath }),
    isDemoSeed: false,
  };
}

function eventFromMineral(mineral: CriticalMineral): EnterpriseRiskEvent | null {
  const relevant = /lithium|aluminum|aluminium|nickel|cobalt|graphite/i.test(mineral.mineral);
  if (!relevant || !['critical', 'high'].includes(mineral.riskRating)) return null;
  const text = `${mineral.mineral} ${mineral.topProducers.map(p => p.country).join(' ')}`;
  const tags: EnterpriseRiskTag[] = ['supply_chain', 'financial_fx'];
  const score = weightedScore(mineral.riskRating === 'critical' ? 82 : 66, tags);
  const priority = priorityFromScore(score);
  const location = inferLocation(text);
  return {
    id: `mineral-${stableHash(mineral.mineral)}`,
    title: `${mineral.mineral} supply concentration risk is ${mineral.riskRating}`,
    source: 'Critical Minerals',
    sourceType: 'supply_chain',
    summary: `Top producer concentration HHI ${mineral.hhi.toFixed(0)}; relevant to battery tray and aluminum casting input costs.`,
    occurredAt: Date.now(),
    tags,
    countries: mineral.topProducers.slice(0, 3).map(p => p.country),
    affectedMarkets: [],
    severityScore: score,
    priority,
    location,
    explanation: buildExplanation({ text, tags, priority, score, sourceType: 'supply_chain', occurredAt: Date.now(), location, markets: [] }),
    isDemoSeed: false,
  };
}

function dedupeEvents(events: EnterpriseRiskEvent[]): EnterpriseRiskEvent[] {
  const seen = new Set<string>();
  return events
    .sort((a, b) => b.severityScore - a.severityScore || b.occurredAt - a.occurredAt)
    .filter(event => {
      const key = normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sortLiveEvents(events: EnterpriseRiskEvent[]): EnterpriseRiskEvent[] {
  return [...events].sort((a, b) => {
    const aScenario = isScenarioRelevant(`${a.title} ${a.summary}`) ? 1 : 0;
    const bScenario = isScenarioRelevant(`${b.title} ${b.summary}`) ? 1 : 0;
    const aLocated = a.location ? 1 : 0;
    const bLocated = b.location ? 1 : 0;
    return bScenario - aScenario
      || b.severityScore - a.severityScore
      || scorePriority(b.priority) - scorePriority(a.priority)
      || bLocated - aLocated
      || b.occurredAt - a.occurredAt;
  });
}

function resolveBusinessLines(event: EnterpriseRiskEvent): typeof PROFILE.businessLines {
  const text = normalizeText(`${event.title} ${event.summary} ${event.affectedMarkets.join(' ')} ${event.tags.join(' ')}`);
  const matches = PROFILE.businessLines.filter(line => {
    return line.targetMarkets.some(market => event.affectedMarkets.includes(market))
      || line.routeExposure.some(route => text.includes(route.toLowerCase()))
      || line.products.some(product => text.includes(product.toLowerCase()));
  });
  if (matches.length) return matches;
  if (event.tags.includes('regulatory')) {
    return PROFILE.businessLines.filter(line => line.id === 'cbam-compliance-program');
  }
  return PROFILE.businessLines.slice(0, 2);
}

function buildImpacts(events: EnterpriseRiskEvent[]): EnterpriseInternalImpact[] {
  const impacts: EnterpriseInternalImpact[] = [];
  for (const event of events) {
    const lines = resolveBusinessLines(event);
    for (const rule of DEPARTMENT_RULES) {
      if (!rule.tags.some(tag => event.tags.includes(tag))) continue;
      const line = lines[0] ?? PROFILE.businessLines[0]!;
      const tagLabel = TAG_LABELS[event.tags[0] ?? 'supply_chain'];
      impacts.push({
        id: `impact-${event.id}-${rule.department.replace(/\s+/g, '-').toLowerCase()}`,
        eventId: event.id,
        businessLineId: line.id,
        businessLineName: line.name,
        department: rule.department,
        action: rule.action,
        impact: `${event.priority} ${tagLabel}风险影响${line.name}`,
        priority: event.priority,
        score: event.severityScore,
      });
    }
  }
  return impacts.sort((a, b) => scorePriority(b.priority) - scorePriority(a.priority) || b.score - a.score);
}

function buildAlerts(events: EnterpriseRiskEvent[], impacts: EnterpriseInternalImpact[]): EnterpriseAlert[] {
  return events
    .filter(event => event.priority !== 'P3')
    .slice(0, 6)
    .map(event => {
      const eventImpacts = impacts.filter(impact => impact.eventId === event.id);
      const departments = unique(eventImpacts.map(impact => impact.department));
      return {
        id: `alert-${event.id}`,
        eventId: event.id,
        title: event.priority === 'P1' ? '高优先级内部预警' : '业务线风险提醒',
        priority: event.priority,
        message: `${event.title} -> ${departments.join(' / ') || 'Risk Office'} 启动响应`,
        departments,
        triggeredAt: Date.now(),
        acknowledged: false,
      };
    });
}

function dueDate(priority: EnterpriseRiskPriority): string {
  const offset = priority === 'P1' ? 1 : priority === 'P2' ? 3 : 7;
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

function buildTasks(impacts: EnterpriseInternalImpact[]): EnterpriseTask[] {
  const seen = new Set<string>();
  const tasks: EnterpriseTask[] = [];
  for (const impact of impacts) {
    if (impact.priority === 'P3') continue;
    const key = `${impact.eventId}|${impact.department}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      id: `task-${stableHash(key)}`,
      title: `${impact.department}: ${impact.action}`,
      department: impact.department,
      dueDate: dueDate(impact.priority),
      priority: impact.priority,
      status: impact.priority === 'P1' ? 'open' : 'watching',
      sourceEventId: impact.eventId,
      source: impact.source ?? 'rule_fallback',
    });
  }
  return tasks.slice(0, 12);
}

function estimateExposure(events: EnterpriseRiskEvent[]): number {
  const lineIds = new Set<string>();
  for (const event of events.slice(0, 4)) {
    for (const line of resolveBusinessLines(event)) lineIds.add(line.id);
  }
  const exposure = PROFILE.businessLines
    .filter(line => lineIds.has(line.id))
    .reduce((sum, line) => sum + line.revenueAtRiskUsd, 0);
  const severityFactor = Math.max(0.18, Math.min(0.62, (events[0]?.severityScore ?? 50) / 160));
  return Math.round(exposure * severityFactor);
}

function buildReport(
  events: EnterpriseRiskEvent[],
  impacts: EnterpriseInternalImpact[],
  tasks: EnterpriseTask[],
): EnterpriseReportSummary {
  const lead = events[0] ?? DEMO_EVENTS[0]!;
  const departments = unique(impacts.slice(0, 8).map(impact => impact.department));
  const businessLines = unique(impacts.map(impact => impact.businessLineName)).slice(0, 3);
  const exposure = estimateExposure(events);
  const recommendations = tasks.slice(0, 5).map(task => task.title);
  return {
    id: `report-${stableHash(`${lead.id}|${Date.now()}`)}`,
    generatedAt: Date.now(),
    eventSummary: lead.summary,
    internalImpact: `${lead.priority} 事件已映射到 ${departments.join('、') || '风险办公室'}，影响 ${businessLines.join('、') || '重点业务线'}。`,
    recommendedActions: recommendations.length ? recommendations : ['保持监控，并在下一轮刷新后复核业务线敞口。'],
    financialImpact: {
      exposureUsd: exposure,
      estimate: `按受影响业务线收入和事件强度估算，短期收入/成本敞口约 ${formatUsd(exposure)}。`,
      confidence: events.some(event => event.isDemoSeed) ? 'demo_estimate' : 'modeled',
    },
  };
}

function normalizeAgentDepartment(value: string): EnterpriseDepartment {
  const allowed: EnterpriseDepartment[] = ['Compliance', 'Finance', 'Supply Chain', 'Sales', 'Operations'];
  return allowed.find(department => department.toLowerCase() === value.toLowerCase()) ?? 'Operations';
}

function requiredDepartmentsForTags(tags: EnterpriseRiskTag[]): EnterpriseDepartment[] {
  const departments: EnterpriseDepartment[] = [];
  if (tags.includes('regulatory')) departments.push('Compliance');
  if (tags.includes('supply_chain')) departments.push('Supply Chain');
  if (tags.includes('financial_fx')) departments.push('Finance');
  if (tags.includes('geopolitical') && (tags.includes('supply_chain') || tags.includes('regulatory'))) departments.push('Operations');
  return unique(departments);
}

function buildAgentImpactsForEvent(
  event: EnterpriseRiskEvent,
  transmission: EnterpriseRiskAgentTransmission,
): EnterpriseInternalImpact[] {
  const validLines = new Map(PROFILE.businessLines.map(line => [line.id, line]));
  const fallbackLine = resolveBusinessLines(event)[0] ?? PROFILE.businessLines[0]!;
  const impacts = transmission.businessMappings
    .slice(0, 6)
    .map((mapping, index): EnterpriseInternalImpact => {
      const line = validLines.get(mapping.businessLineId)
        ?? PROFILE.businessLines.find(item => item.name === mapping.businessLineName)
        ?? fallbackLine;
      const department = normalizeAgentDepartment(mapping.department);
      return {
        id: `agent-impact-${event.id}-${index}`,
        eventId: event.id,
        businessLineId: line.id,
        businessLineName: mapping.businessLineName || line.name,
        department,
        action: mapping.action || `${department}: 复核该风险事件的业务影响和响应动作`,
        impact: mapping.impact || `${event.priority} Agent 识别风险影响${line.name}`,
        priority: mapping.priority,
        score: mapping.score,
        source: 'qwen_agent',
        confidence: mapping.confidence,
      };
    });
  const existingDepartments = new Set(impacts.map(impact => impact.department));
  for (const department of requiredDepartmentsForTags(event.tags)) {
    if (existingDepartments.has(department) || impacts.length >= 6) continue;
    const rule = DEPARTMENT_RULES.find(item => item.department === department && item.tags.some(tag => event.tags.includes(tag)));
    const line = resolveBusinessLines(event)[0] ?? fallbackLine;
    impacts.push({
      id: `agent-impact-${event.id}-coverage-${department.replace(/\s+/g, '-').toLowerCase()}`,
      eventId: event.id,
      businessLineId: line.id,
      businessLineName: line.name,
      department,
      action: rule?.action ?? `${department}: review ${event.title}`,
      impact: `${enterpriseRiskTagLabel(event.tags[0] ?? 'supply_chain')} requires ${department} transmission coverage`,
      priority: event.priority,
      score: event.severityScore,
      source: 'qwen_agent',
      confidence: 0.62,
    });
    existingDepartments.add(department);
  }
  return impacts;
}

function buildAgentTasksForEvent(
  eventId: string,
  transmission: EnterpriseRiskAgentTransmission,
): EnterpriseTask[] {
  return transmission.responseTasks
    .filter(task => task.title && task.department)
    .slice(0, 6)
    .map((task, index) => ({
      id: `agent-task-${eventId}-${index}`,
      title: task.title,
      department: normalizeAgentDepartment(task.department),
      dueDate: dueDate(task.priority),
      priority: task.priority,
      status: task.priority === 'P1' ? 'open' : 'watching',
      sourceEventId: eventId,
      source: 'qwen_agent' as const,
    }));
}

function isGenericAgentImpactPath(path: EnterpriseRiskAgentTransmission['impactPath'] | undefined): boolean {
  const text = `${path?.label ?? ''} ${(path?.steps ?? []).join(' ')}`.toLowerCase();
  return /\b(external event|affected route|business line|department action|concrete trigger|concrete route|concrete business|event-route-business)\b/.test(text);
}

function buildConcreteAgentImpactPath(
  event: EnterpriseRiskEvent,
  transmission: EnterpriseRiskAgentTransmission,
): EnterpriseRiskEvent['impactPath'] | undefined {
  if (transmission.impactPath.steps.length && !isGenericAgentImpactPath(transmission.impactPath)) {
    return transmission.impactPath;
  }
  const firstMapping = transmission.businessMappings[0];
  if (!firstMapping) return event.impactPath;
  const line = PROFILE.businessLines.find(item => item.id === firstMapping.businessLineId || item.name === firstMapping.businessLineName);
  const route = transmission.impactPath.label && !isGenericAgentImpactPath(transmission.impactPath)
    ? transmission.impactPath.label
    : line?.routeExposure[0] ?? event.affectedMarkets[0] ?? 'enterprise exposure';
  return {
    routeIds: transmission.impactPath.routeIds.length ? transmission.impactPath.routeIds : (event.impactPath?.routeIds ?? []),
    label: `${event.title} -> ${line?.name ?? (firstMapping.businessLineName || 'affected business line')}`,
    steps: [
      event.title,
      route,
      line?.name ?? (firstMapping.businessLineName || 'affected business line'),
      `${normalizeAgentDepartment(firstMapping.department)}: ${firstMapping.action || 'review response'}`,
    ],
  };
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function sourceStatus(sourceId: DataSourceId): EnterpriseSourceCoverage['status'] {
  const status = dataFreshness.getSource(sourceId)?.status;
  if (status === 'fresh' || status === 'stale') return 'live';
  if (status === 'very_stale') return 'stale';
  return 'missing';
}

function buildCoverage(demoStoryPinned: boolean, liveEventCount: number, inputs: EnterpriseRiskInputs): EnterpriseSourceCoverage[] {
  return [
    {
      id: 'rss',
      label: 'RSS / Breaking News',
      status: sourceStatus('rss'),
      detail: `${inputs.news.length} external headline(s) scanned`,
    },
    {
      id: 'gdelt',
      label: 'ML clustering / GDELT',
      status: sourceStatus('gdelt'),
      detail: `${inputs.clusters.length} cluster(s) available`,
    },
    {
      id: 'cross-source',
      label: 'Cross-Source Signals',
      status: inputs.crossSourceSignals?.signals?.length ? 'live' : 'missing',
      detail: `${inputs.crossSourceSignals?.signals?.length ?? 0} composite signal(s)`,
    },
    {
      id: 'supply-chain',
      label: 'Supply Chain',
      status: sourceStatus('supply_chain'),
      detail: `${inputs.supplyChain?.chokepoints?.length ?? 0} chokepoint(s), ${inputs.supplyChain?.shippingIndices?.length ?? 0} freight index item(s)`,
    },
    {
      id: 'demo-storyline',
      label: 'Demo storyline',
      status: demoStoryPinned ? 'demo' : 'missing',
      detail: `${PROFILE.demoMode.label} 当前追加 ${liveEventCount} 条 live 外部事件。`,
    },
  ];
}

function collectEvents(inputs: EnterpriseRiskInputs): EnterpriseRiskEvent[] {
  const events: EnterpriseRiskEvent[] = [];
  events.push(...inputs.clusters.map(eventFromCluster).filter((e): e is EnterpriseRiskEvent => Boolean(e)));
  events.push(...inputs.news.map(eventFromNews).filter((e): e is EnterpriseRiskEvent => Boolean(e)));
  events.push(...(inputs.crossSourceSignals?.signals ?? []).map(eventFromSignal).filter((e): e is EnterpriseRiskEvent => Boolean(e)));
  events.push(...(inputs.supplyChain?.chokepoints ?? []).map(eventFromChokepoint).filter((e): e is EnterpriseRiskEvent => Boolean(e)));
  events.push(...(inputs.supplyChain?.shippingIndices ?? []).map(eventFromShippingIndex).filter((e): e is EnterpriseRiskEvent => Boolean(e)));
  events.push(...(inputs.supplyChain?.minerals ?? []).map(eventFromMineral).filter((e): e is EnterpriseRiskEvent => Boolean(e)));

  const eur = inputs.markets?.find(m => /EUR|EURO/i.test(`${m.symbol} ${m.name}`));
  const cny = inputs.markets?.find(m => /CNY|CNH|YUAN|RMB/i.test(`${m.symbol} ${m.name}`));
  if (eur?.change != null && Math.abs(eur.change) > 0.8) {
    const text = `${eur.display || eur.symbol} EUR euro European receivables exposure`;
    const tags: EnterpriseRiskTag[] = ['financial_fx'];
    const score = weightedScore(54 + Math.abs(eur.change) * 5, tags);
    const priority: EnterpriseRiskPriority = 'P2';
    const markets = ['EU'];
    events.push({
      id: `market-${stableHash(eur.symbol)}`,
      title: `${eur.display || eur.symbol} changed ${eur.change >= 0 ? '+' : ''}${eur.change.toFixed(2)}%`,
      source: 'Markets',
      sourceType: 'market',
      summary: 'FX move can alter EUR receivable value and quote margin for European export contracts.',
      occurredAt: Date.now(),
      tags,
      countries: ['EU'],
      affectedMarkets: markets,
      severityScore: score,
      priority,
      explanation: buildExplanation({ text, tags, priority, score, sourceType: 'market', occurredAt: Date.now(), markets }),
      isDemoSeed: false,
    });
  }
  if (cny?.change != null && Math.abs(cny.change) > 0.8) {
    const text = `${cny.display || cny.symbol} RMB yuan export margin Vietnam Europe`;
    const tags: EnterpriseRiskTag[] = ['financial_fx'];
    const score = weightedScore(52 + Math.abs(cny.change) * 5, tags);
    const priority: EnterpriseRiskPriority = 'P2';
    const markets = ['EU', 'Vietnam'];
    events.push({
      id: `market-${stableHash(cny.symbol)}`,
      title: `${cny.display || cny.symbol} changed ${cny.change >= 0 ? '+' : ''}${cny.change.toFixed(2)}%`,
      source: 'Markets',
      sourceType: 'market',
      summary: 'RMB movement changes export margin assumptions and hedge ratio for overseas shipments.',
      occurredAt: Date.now(),
      tags,
      countries: ['CN'],
      affectedMarkets: markets,
      severityScore: score,
      priority,
      explanation: buildExplanation({ text, tags, priority, score, sourceType: 'market', occurredAt: Date.now(), markets }),
      isDemoSeed: false,
    });
  }

  return sortLiveEvents(dedupeEvents(events));
}

export function buildEnterpriseRiskAssessment(inputs: EnterpriseRiskInputs): EnterpriseRiskAssessment {
  const liveEvents = collectEvents(inputs).slice(0, MAX_LIVE_APPENDIX);
  const demoTitles = new Set(DEMO_EVENTS.map(event => normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96)));
  const liveAppendix = liveEvents.filter(event => {
    const key = normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96);
    return !demoTitles.has(key);
  });
  const events = attachCbamEvidence(
    [...DEMO_EVENTS, ...liveAppendix].slice(0, DEMO_EVENTS.length + MAX_LIVE_APPENDIX),
    inputs,
  );
  const demoStoryPinned = true;
  const liveEventCount = liveAppendix.length;
  const impacts = buildImpacts(events);
  const alerts = buildAlerts(events, impacts);
  const tasks = buildTasks(impacts);
  const report = buildReport(events, impacts, tasks);
  const topPriority = events.reduce<EnterpriseRiskPriority>((priority, event) => maxPriority(priority, event.priority), 'P3');

  document.dispatchEvent(new CustomEvent('wm:enterprise-risk-updated', {
    detail: {
      priority: topPriority,
      alertCount: alerts.length,
      demoSeedUsed: demoStoryPinned,
      demoStoryPinned,
      liveEventCount,
      locationPolicy: 'feed_or_explicit_place_only',
    },
  }));

  return {
    profile: PROFILE,
    generatedAt: Date.now(),
    narrativeWindowMinutes: 2,
    events,
    impacts,
    alerts,
    tasks,
    report,
    sourceCoverage: buildCoverage(demoStoryPinned, liveEventCount, inputs),
    demoSeedUsed: demoStoryPinned,
    demoStoryPinned,
    liveEventCount,
    locationPolicy: 'feed_or_explicit_place_only',
    agentWorkflow: agentStatus(
      'candidate',
      '规则层已生成候选事件，等待 Qwen 识别 Agent 和传导 Agent 覆盖。',
      0,
    ),
    reusedCapabilities: [
      'RSS / Breaking News',
      'ML clustering',
      'Cross-Source Signals',
      'Supply Chain chokepoints',
      'Market data',
      'Data Freshness',
      'Chat Analyst explanation layer',
    ],
    gaps: [
      '地图跳转只使用 feed 坐标或显式地名匹配，不做国家/市场级兜底定位。',
      '财务敞口是基于业务线收入和事件强度的 POC 估算，尚未接入真实 ERP 台账。',
      '任务状态和告警确认已在浏览器本地持久化，生产级工作流审批尚未接入。',
    ],
  };
}

export function markEnterpriseRiskAgentRunning(assessment: EnterpriseRiskAssessment): EnterpriseRiskAssessment {
  return {
    ...assessment,
    agentWorkflow: agentStatus(
      'running',
      'Qwen 识别 Agent 和传导 Agent 正在分析所选 demo/live 卡片。',
      0,
      assessment.agentWorkflow.model,
    ),
  };
}

export function markEnterpriseRiskAgentFallback(assessment: EnterpriseRiskAssessment, detail = 'Qwen Agent 未返回可用结果，保留规则候选作为兜底。'): EnterpriseRiskAssessment {
  return {
    ...assessment,
    agentWorkflow: agentStatus('fallback', detail, 0, assessment.agentWorkflow.model),
  };
}

export function applyEnterpriseRiskAgentResult(
  assessment: EnterpriseRiskAssessment,
  agentResult: EnterpriseRiskAgentBatchResult,
): EnterpriseRiskAssessment {
  const byId = new Map(agentResult.events.map(event => [event.eventId, event]));
  const appliedAt = Date.now();
  let enrichedEventCount = 0;
  const events = assessment.events.map(event => {
    const agentEvent = byId.get(event.id);
    if (!agentEvent) {
      return {
        ...event,
        agent: {
          identificationSource: 'rule_fallback' as const,
          transmissionSource: 'rule_fallback' as const,
        },
      };
    }
    enrichedEventCount += 1;
    const identification = agentEvent.identification;
    const transmission = agentEvent.transmission;
    const impactPath = buildConcreteAgentImpactPath(event, transmission);
    return {
      ...event,
      tags: identification.riskTags,
      priority: identification.priority,
      severityScore: identification.severityScore,
      impactPath,
      explanation: {
        triggerBasis: identification.triggerBasis.length ? identification.triggerBasis : event.explanation.triggerBasis,
        priorityBasis: identification.priorityBasis.length ? identification.priorityBasis : event.explanation.priorityBasis,
        mappingBasis: transmission.mappingBasis.length ? transmission.mappingBasis : event.explanation.mappingBasis,
        dataQuality: [
          ...(identification.dataQuality.length ? identification.dataQuality : event.explanation.dataQuality),
          `Qwen Agent confidence ${(identification.confidence * 100).toFixed(0)}%`,
        ],
      },
      agent: {
        identificationSource: 'qwen_agent' as const,
        transmissionSource: 'qwen_agent' as const,
        confidence: identification.confidence,
        provider: agentResult.provider,
        model: agentEvent.model ?? agentResult.model,
        appliedAt,
      },
    };
  });

  const agentImpacts: EnterpriseInternalImpact[] = [];
  const agentTasks: EnterpriseTask[] = [];
  for (const event of events) {
    const agentEvent = byId.get(event.id);
    if (!agentEvent) continue;
    const impacts = buildAgentImpactsForEvent(event, agentEvent.transmission);
    agentImpacts.push(...(impacts.length ? impacts : assessment.impacts.filter(impact => impact.eventId === event.id)));
    agentTasks.push(...buildAgentTasksForEvent(event.id, agentEvent.transmission));
  }

  const fallbackImpacts = assessment.impacts
    .filter(impact => !byId.has(impact.eventId))
    .map(impact => ({ ...impact, source: 'rule_fallback' as const }));
  const impacts = [...agentImpacts, ...fallbackImpacts]
    .sort((a, b) => scorePriority(b.priority) - scorePriority(a.priority) || b.score - a.score);
  const fallbackTasks = buildTasks(fallbackImpacts);
  const tasks = [...agentTasks, ...fallbackTasks].slice(0, 16);
  const alerts = buildAlerts(events, impacts);
  const report = buildReport(events, impacts, tasks);
  const topPriority = events.reduce<EnterpriseRiskPriority>((priority, event) => maxPriority(priority, event.priority), 'P3');

  document.dispatchEvent(new CustomEvent('wm:enterprise-risk-updated', {
    detail: {
      priority: topPriority,
      alertCount: alerts.length,
      demoSeedUsed: assessment.demoStoryPinned,
      demoStoryPinned: assessment.demoStoryPinned,
      liveEventCount: assessment.liveEventCount,
      locationPolicy: assessment.locationPolicy,
      agentWorkflow: 'qwen_agent',
    },
  }));

  return {
    ...assessment,
    generatedAt: Date.now(),
    events,
    impacts,
    alerts,
    tasks,
    report,
    agentWorkflow: agentStatus(
      'applied',
      `Qwen Agent 已接管识别层和传导层，覆盖 ${enrichedEventCount} 张卡片。`,
      enrichedEventCount,
      agentResult.model,
    ),
    reusedCapabilities: [
      'Qwen identification agent',
      'Qwen transmission agent',
      ...assessment.reusedCapabilities.filter(item => !item.includes('Chat Analyst')),
    ],
    gaps: [
      'Qwen Agent 是识别层和传导层主输出；规则层仅作为候选生成和失败兜底。',
      ...assessment.gaps.filter(gap => !gap.includes('任务状态和告警确认')),
    ],
  };
}

export function enterpriseRiskTagLabel(tag: EnterpriseRiskTag): string {
  return TAG_LABELS[tag];
}

export function enterprisePriorityRank(priority: EnterpriseRiskPriority): number {
  return scorePriority(priority);
}
