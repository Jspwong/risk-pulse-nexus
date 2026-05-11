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
const MAX_LIVE_APPENDIX = 4;
const LIVE_EVENT_WINDOW_MS = 7 * DAY_MS;
const MIN_AXIS_COVERAGE_SCORE = 52;
const MIN_BUSINESS_TRANSMISSION_SCORE = 38;
const MIN_SEA_COVERAGE_SCORE = 46;

const TAG_LABELS: Record<EnterpriseRiskTag, string> = {
  geopolitical: 'Geopolitical Risk',
  regulatory: 'Regulatory Risk',
  supply_chain: 'Supply Chain Risk',
  financial_fx: 'FX Risk',
};

const TAG_KEYWORDS: Record<EnterpriseRiskTag, string[]> = {
  geopolitical: ['war', 'conflict', 'attack', 'sanction', 'export control', 'red sea', 'suez', 'malacca', 'strait of hormuz', 'border', 'protest', 'geopolitical'],
  regulatory: ['cbam', 'carbon border', 'tariff', 'duties', 'regulation', 'battery regulation', 'customs', 'probe', 'investigation', 'emissions', 'audit', 'certification', 'iso 14064', 'reach', 'rohs', 'declaration', 'traceability', 'forced labor', 'due diligence'],
  supply_chain: ['supplier', 'supply chain', 'shortage', 'critical mineral', 'lithium', 'aluminum', 'aluminium', 'nickel', 'factory', 'manufacturing', 'strike', 'shutdown', 'production', 'port', 'shipping', 'freight', 'container', 'reroute', 'rail', 'airport', 'logistics', 'red sea', 'suez', 'malacca', 'strait of hormuz', 'typhoon', 'flood', 'earthquake', 'wildfire', 'storm', 'drought'],
  financial_fx: ['yuan', 'renminbi', 'euro', 'eur', 'vnd', 'dong', 'baht', 'rupiah', 'currency', 'fx', 'exchange rate', 'central bank', 'inflation', 'margin', 'hedge', 'premium', 'working capital', 'receivable', 'cost', 'freight rate', 'price', 'rate hike', 'bond yield'],
};

const LIVE_RISK_AXIS_ORDER: EnterpriseRiskTag[] = ['regulatory', 'supply_chain', 'financial_fx', 'geopolitical'];
const SEA_MARKETS = new Set(['Vietnam', 'Thailand', 'Indonesia']);

const BUSINESS_AXIS_IMPACT_WEIGHTS: Record<EnterpriseRiskTag, number> = {
  regulatory: 18,
  supply_chain: 16,
  financial_fx: 14,
  geopolitical: 12,
};

const SOURCE_CONFIDENCE_BASE: Record<EnterpriseRiskEvent['sourceType'], number> = {
  cross_source: 16,
  cluster: 15,
  supply_chain: 14,
  market: 12,
  news: 10,
  demo_seed: 10,
};

const BUSINESS_SIGNAL_RULES: Array<{ score: number; keywords: string[] }> = [
  {
    score: 18,
    keywords: [
      'cbam', 'carbon border', 'embedded emissions', 'eu battery regulation',
      'battery regulation', 'eu customs', 'iso 14064', 'reach', 'rohs',
      'due diligence', 'traceability',
    ],
  },
  {
    score: 16,
    keywords: [
      'red sea', 'suez', 'strait of hormuz', 'malacca', 'panama canal',
      'shipping', 'freight', 'container', 'reroute', 'port', 'logistics',
    ],
  },
  {
    score: 14,
    keywords: [
      'vietnam', 'vnd', 'dong', 'thailand', 'baht', 'indonesia', 'rupiah',
      'ho chi minh', 'hai phong', 'laem chabang', 'jakarta', 'surabaya',
    ],
  },
  {
    score: 13,
    keywords: [
      'euro', 'eur', 'yuan', 'renminbi', 'rmb', 'cny', 'cnh', 'currency',
      'fx', 'exchange rate', 'hedge', 'receivable', 'margin',
    ],
  },
  {
    score: 10,
    keywords: [
      'battery tray', 'ev battery enclosure', 'aluminum casting',
      'energy storage cabinet', 'bms housing', 'new energy', 'ev',
      'battery', 'aluminum', 'aluminium', 'lithium', 'nickel', 'cobalt',
      'rare earth', 'critical mineral',
    ],
  },
];

const PRODUCT_COMPONENT_KEYWORDS = [
  'battery tray', 'ev battery enclosure', 'battery enclosure', 'aluminum casting',
  'aluminium casting', 'energy storage cabinet', 'sheet metal enclosure',
  'bms housing', 'new energy component', 'new energy', 'ev battery',
  'battery', 'ev', 'electric vehicle', 'storage component',
];

const INPUT_MATERIAL_KEYWORDS = [
  'aluminum', 'aluminium', 'lithium', 'nickel', 'cobalt', 'graphite',
  'rare earth', 'critical mineral', 'battery metal',
];

const HARD_COMPLIANCE_KEYWORDS = [
  'cbam', 'carbon border', 'embedded emissions', 'eu battery regulation',
  'battery regulation', 'eu customs', 'customs declaration', 'iso 14064',
  'reach', 'rohs', 'supplier carbon factor', 'emissions data',
  'traceability', 'forced labor', 'due diligence',
];

const WEAK_POLICY_KEYWORDS = [
  'tariff', 'duties', 'regulation', 'rules', 'consumer rules',
  'trade policy', 'probe', 'investigation',
];

const ROUTE_CHAIN_KEYWORDS = [
  'red sea', 'suez', 'suez canal', 'rotterdam', 'hamburg', 'antwerp',
  'malacca', 'strait of malacca', 'singapore', 'port of singapore',
  'ho chi minh', 'hai phong', 'laem chabang', 'jakarta', 'surabaya',
  'port', 'shipping', 'freight', 'container', 'reroute', 'logistics',
];

const INDIRECT_ENERGY_ROUTE_KEYWORDS = [
  'strait of hormuz', 'hormuz', 'oil price', 'crude', 'fuel', 'bunker fuel',
];

const FX_TRANSMISSION_KEYWORDS = [
  'euro', 'eur', 'yuan', 'renminbi', 'rmb', 'cny', 'cnh', 'vnd',
  'dong', 'baht', 'rupiah', 'currency', 'fx', 'exchange rate',
  'hedge', 'receivable', 'receivables', 'margin', 'quote', 'premium',
  'working capital',
];

const FX_MARKET_KEYWORDS = [
  'euro', 'eur', 'yuan', 'renminbi', 'rmb', 'cny', 'cnh', 'vnd',
  'dong', 'baht', 'rupiah', 'currency', 'fx', 'forex', 'exchange rate',
  'foreign exchange',
];

const FX_ENTERPRISE_TRANSMISSION_KEYWORDS = [
  'hedge', 'hedging', 'receivable', 'receivables', 'margin', 'export margin',
  'quote', 'quotation', 'pricing', 'working capital', 'supplier payment',
  'payment terms', 'procurement', 'input cost', 'input costs', 'shipment',
  'shipments', 'contract', 'contracts', 'export contract', 'export contracts',
  'supplier', 'factory', 'manufacturing', 'logistics', 'freight', 'exporter',
  'exporters',
];

const SUPPLY_OPERATION_KEYWORDS = [
  'supplier', 'supply chain', 'shortage', 'factory', 'manufacturing',
  'production', 'shutdown', 'strike', 'port', 'shipping', 'freight',
  'container', 'reroute', 'logistics', 'delay', 'congestion',
  'supply concentration', 'input cost', 'input costs',
];

const GEOPOLITICAL_TRIGGER_KEYWORDS = [
  'war', 'conflict', 'attack', 'sanction', 'export control', 'trade restriction',
  'red sea', 'suez', 'malacca', 'strait of hormuz', 'border', 'protest',
  'blocked', 'ban', 'force majeure',
];

const GENERIC_LOW_TRANSMISSION_PATTERNS = [
  /\bweek in review\b/,
  /\bbig oil\b/,
  /\bproject freedom\b/,
  /\bconsumer rules?\b/,
  /\bus businesses?\b/,
  /\btrump tariffs?\b/,
  /\bcarmakers?\b(?!.*\b(ev|electric vehicle|battery|aluminum|aluminium|component|supply|supplier)\b)/,
  /\boil price\b(?!.*\b(freight|shipping|suez|red sea|malacca|container|export margin|fuel surcharge)\b)/,
  /\b(tourism|tourist|holiday|arrivals?|hotel|resort)\b(?!.*\b(port|shipping|freight|supplier|factory|manufacturing|export|logistics|currency|fx|exchange rate|dong|baht|rupiah|battery|component|nickel)\b)/,
];

const GENERIC_FX_MARKET_QUOTE_PATTERNS = [
  /\btradingview\b/,
  /\b(?:gold|silver|forex|fx|currency|exchange)\s+(?:rates?|prices?|quotes?)\b/,
  /\b(?:exchange|currency|forex)\s+rate\s+(?:today|forecast|chart|converter)\b/,
  /\b(?:usd|eur|cny|vnd|thb|idr)\s*[/.-]\s*(?:usd|eur|cny|vnd|thb|idr)\b.*\b(?:chart|quote|rate)\b/,
  /\b(?:dong|baht|rupiah|vnd|thb|idr)\b.*\b(?:gold|silver)\s+rates?\b/,
  /\b(?:rates?|prices?)\s*[-:]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/,
];

const STATIC_REFERENCE_CONTENT_PATTERNS = [
  /\bbritannica\b/,
  /\bwikipedia\b/,
  /\bencyclop(?:a|e)dia\b/,
  /\binvestopedia\b/,
  /\b(?:explainer|explained|guide|overview|definition|history|backgrounder)\b/,
  /\bwhat (?:is|are)\b/,
];

const CONCRETE_LIVE_TRIGGER_PATTERNS = [
  /\b(?:announce|announces|announced|approve|approves|approved|adopt|adopts|adopted|begin|begins|began|block|blocked|blocks)\b/,
  /\b(?:delay|delays|delayed|disrupt|disrupts|disrupted|halt|halts|halted|impose|imposes|imposed|launch|launches|launched)\b/,
  /\b(?:raise|raises|raised|reroute|reroutes|rerouted|restrict|restricts|restricted|resume|resumes|resumed|strike|strikes|struck)\b/,
  /\b(?:tighten|tightens|tightened|warn|warns|warned|probe|investigation|audit|deadline|customs check|sanction|tariff increase)\b/,
  /\b(?:attack|shutdown|force majeure|export control|new rule|new regulation|effective date|compliance deadline)\b/,
];

const DEDUPE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in',
  'into', 'is', 'it', 'new', 'of', 'on', 'over', 'the', 'to', 'while',
  'with', 'after', 'amid', 'about', 'latest', 'update', 'updates',
  'says', 'said', 'report', 'reports', 'source', 'sources', 'clustered',
  'financial', 'times', 'reuters', 'aol', 'com', 'ft', 'ap', 'bloomberg',
  'calls', 'call', 'warned', 'warns', 'response', 'responded', 'proposal',
]);

const DEDUPE_KEY_PHRASES = [
  'totally unacceptable',
  'ceasefire proposal',
  'peace proposal',
  'maritime security',
  'strait of hormuz',
  'iran war',
  'taiwan defence delay',
  'defence delay',
  'cbam embedded emissions',
  'carbon border',
  'red sea reroute',
  'red sea rerouting',
  'suez reroute',
  'suez rerouting',
  'vietnam dong',
  'exchange rate',
  'freight fuel surcharge',
];

const LIVE_CONTEXT_KEYWORDS = [
  'alert', 'attack', 'ban', 'blocked', 'border', 'central bank', 'compliance',
  'conflict', 'container', 'cost', 'customs', 'delay', 'disruption', 'drought',
  'earthquake', 'export', 'factory', 'flood', 'freight', 'inflation', 'logistics',
  'port', 'price', 'probe', 'protest', 'rate', 'regulation', 'reroute', 'risk',
  'sanction', 'shipping', 'shortage', 'strike', 'storm', 'supplier', 'tariff',
  'trade', 'transport', 'typhoon', 'war', 'wildfire',
];

const ENTERPRISE_RISK_REQUIRED_KEYWORDS = [
  'cbam', 'carbon border', 'embedded emissions', 'battery', 'ev', 'new energy',
  'aluminum', 'aluminium', 'lithium', 'nickel', 'cobalt', 'rare earth', 'critical mineral',
  'supply chain', 'supplier', 'factory', 'manufacturing', 'production', 'shutdown',
  'port', 'shipping', 'freight', 'container', 'reroute', 'logistics', 'suez', 'red sea',
  'malacca', 'strait of hormuz', 'panama canal', 'tariff', 'customs', 'export control',
  'trade restriction', 'sanction', 'regulation', 'audit', 'certification', 'due diligence',
  'euro', 'eur', 'yuan', 'renminbi', 'vnd', 'dong', 'baht', 'rupiah', 'currency', 'fx',
  'exchange rate', 'freight rate',
];

const LOW_ENTERPRISE_SIGNAL_PATTERNS = [
  /\bdenaturaliz\w*\b/,
  /\bsexual abuse\b/,
  /\bwar crimes?\b/,
  /\bespionage\b/,
  /\bterrorist support\b/,
  /\bconcealing\b/,
  /\bjustice department\b/,
  /\bdepartment of justice\b/,
];

const ROUTE_KEYWORDS: Array<{ routeIds: string[]; label: string; steps: string[]; keywords: string[] }> = [
  {
    routeIds: ['china-europe-suez'],
    label: 'China export base -> Suez/Red Sea corridor -> Rotterdam/Hamburg -> Europe battery tray line',
    steps: ['China export base', 'Suez / Red Sea corridor', 'Rotterdam / Hamburg', 'Europe battery tray export line'],
    keywords: ['red sea', 'suez', 'rotterdam', 'hamburg', 'europe', 'eu', 'cbam'],
  },
  {
    routeIds: ['china-europe-suez', 'asia-europe-cape'],
    label: 'Asia-Europe shipping lane -> European customer delivery window',
    steps: ['Asia-Europe shipping lane', 'Chokepoint risk', 'European port intake', 'Europe battery tray export line'],
    keywords: ['shipping', 'freight', 'container', 'reroute', 'delay'],
  },
  {
    routeIds: ['vietnam-supplier-corridor'],
    label: 'Ho Chi Minh City supplier base -> Hai Phong / Vietnam manufacturing corridor',
    steps: ['Ho Chi Minh City supplier base', 'Cat Lai container gateway', 'Vietnam manufacturing corridor', 'Hai Phong export gateway'],
    keywords: ['vietnam', 'vnd', 'dong', 'ho chi minh', 'saigon', 'hanoi', 'hai phong'],
  },
  {
    routeIds: ['intra-asia-container'],
    label: 'Intra-Asia supplier lane -> Southeast Asia assembly suppliers',
    steps: ['Intra-Asia supplier lane', 'Singapore / Malacca corridor', 'Southeast Asia supplier base', 'Southeast Asia storage component supply line'],
    keywords: ['malacca', 'singapore', 'thailand', 'indonesia', 'laem chabang', 'jakarta'],
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
    action: 'Review CBAM reporting path, supplier carbon factors, and target-market certification list',
  },
  {
    tags: ['financial_fx'],
    department: 'Finance',
    action: 'Review EUR and Southeast Asia currency exposure, hedging, and receivables sensitivity',
  },
  {
    tags: ['supply_chain'],
    department: 'Supply Chain',
    action: 'Assess route exposure, port congestion, and alternate logistics options',
  },
  {
    tags: ['regulatory', 'supply_chain'],
    department: 'Sales',
    action: 'Align customer delivery risk, pricing terms, and possible extension windows',
  },
  {
    tags: ['supply_chain', 'regulatory'],
    department: 'Operations',
    action: 'Check safety stock, production buffers, and supplier data submission cadence',
  },
];

const DEMO_EVENTS: EnterpriseRiskEvent[] = [
  {
    id: 'demo-cbam-red-sea-001',
    title: 'EU CBAM reporting window tightens while Red Sea rerouting adds transit delay',
    source: 'CBAM',
    sourceType: 'supply_chain',
    summary: 'EU CBAM reporting windows tighten while Red Sea / Suez rerouting lengthens European delivery cycles for battery tray and aluminum die-casting export lines.',
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
      steps: ['China export base', 'Red Sea / Suez corridor', 'Rotterdam / Hamburg', 'Europe battery tray export line'],
    },
    explanation: {
      triggerBasis: ['Scenario keywords: cbam, red sea, suez', 'Regulatory: cbam', 'Supply chain: red sea, suez'],
      priorityBasis: ['Severity score 88 -> P1', 'Pinned demo event is calibrated as immediate because regulation and supply-chain risk co-fire'],
      mappingBasis: ['Affected markets: EU, Germany, Netherlands', 'Business path: China export base -> Suez/Red Sea corridor -> Rotterdam/Hamburg -> Europe battery tray line'],
      dataQuality: ['Pinned demo scenario', 'Map target from curated_gazetteer: Red Sea / Suez corridor'],
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
    source: 'FX',
    sourceType: 'supply_chain',
    summary: 'Vietnam dong volatility increases procurement and receivables exposure for Vietnam storage-component suppliers, requiring Finance and Sales to update quotation assumptions.',
    occurredAt: Date.now() - 18 * MINUTE_MS,
    tags: ['financial_fx', 'supply_chain'],
    countries: ['VN'],
    affectedMarkets: ['Vietnam'],
    severityScore: 61,
    priority: 'P2',
    link: 'https://www.theedgesingapore.com/news/currencies/vietnam-ready-act-stabilise-dong-will-boost-liquidity',
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
      routeIds: ['vietnam-supplier-corridor'],
      label: 'Ho Chi Minh City supplier base -> Hai Phong / Vietnam manufacturing corridor',
      steps: ['Ho Chi Minh City supplier base', 'Cat Lai container gateway', 'Vietnam manufacturing corridor', 'Hai Phong export gateway'],
    },
    explanation: {
      triggerBasis: ['Scenario keywords: vietnam, vnd', 'FX: vnd, dong, cost'],
      priorityBasis: ['Severity score 61 -> P2', 'FX exposure is material but not an immediate P1 operational stop'],
      mappingBasis: ['Affected markets: Vietnam', 'Business path: Ho Chi Minh City supplier base -> Hai Phong / Vietnam manufacturing corridor'],
      dataQuality: ['Pinned demo scenario', 'Map target from curated_gazetteer: Ho Chi Minh City manufacturing corridor'],
    },
    evidenceSources: [{
      title: "Vietnam's gig workers slammed by rising fuel costs amid fallout of Iran war",
      source: 'Al Jazeera',
      link: 'https://www.aljazeera.com/economy/2026/4/6/vietnams-gig-workers-slammed-by-rising-fuel-costs-amid-fallout-of-iran-war',
      reason: 'Recent reporting on cost pressures in Ho Chi Minh City that can affect local suppliers and logistics; used as an open-source match for the demo headline.',
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
  const lower = normalizeText(text);
  const directShock = /\b(attack|blocked|shutdown|strike|ban|sanction|export control|reroute|force majeure)\b/.test(lower);
  const routeOrCompliance = /\b(cbam|carbon border|suez|red sea|strait of hormuz|malacca|port|shipping|freight|tariff|customs|battery|lithium|critical mineral)\b/.test(lower);
  if (score >= 86 && directShock && routeOrCompliance) return 'P1';
  if (score >= 58) return 'P2';
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
  return ENTERPRISE_RISK_REQUIRED_KEYWORDS.some(term => lower.includes(term))
    || PROFILE.targetMarkets.some(market => lower.includes(market.toLowerCase()))
    || PROFILE.criticalCertifications.some(cert => lower.includes(cert.toLowerCase()));
}

function hasLowEnterpriseSignal(text: string): boolean {
  const lower = normalizeText(text);
  return LOW_ENTERPRISE_SIGNAL_PATTERNS.some(pattern => pattern.test(lower));
}

function enterpriseSignalStrength(text: string): number {
  const lower = normalizeText(text);
  let score = 0;
  for (const keyword of ENTERPRISE_RISK_REQUIRED_KEYWORDS) {
    if (lower.includes(keyword)) score += 1;
  }
  if (buildImpactPath(text)) score += 3;
  if (inferMarkets(text).length > 0) score += 2;
  if (/\b(cbam|carbon border|embedded emissions|tariff|customs|export control|trade restriction)\b/.test(lower)) score += 3;
  if (/\b(port|shipping|freight|container|reroute|suez|red sea|malacca|strait of hormuz|panama canal)\b/.test(lower)) score += 3;
  if (/\b(battery|ev|lithium|nickel|cobalt|rare earth|critical mineral|aluminum|aluminium)\b/.test(lower)) score += 2;
  if (/\b(euro|eur|yuan|renminbi|vnd|dong|baht|rupiah|currency|fx|exchange rate|freight rate)\b/.test(lower)) score += 2;
  if (hasLowEnterpriseSignal(text)) score -= 5;
  return score;
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
  if (isStaticReferenceContent(text)) return false;
  if (isGenericFxMarketQuote(text) && !hasEnterpriseFxTransmission(text)) return false;
  if (hasLowEnterpriseSignal(text) && enterpriseSignalStrength(text) < 6) return false;
  if (enterpriseSignalStrength(text) < 4) return false;
  if (businessTransmissionScore(text) < MIN_BUSINESS_TRANSMISSION_SCORE) return false;
  return isScenarioRelevant(text)
    && LIVE_CONTEXT_KEYWORDS.some(term => lower.includes(term));
}

function fallbackLiveTags(text: string): EnterpriseRiskTag[] {
  const lower = normalizeText(text);
  if (/\b(red sea|suez|malacca|strait of hormuz|hormuz|attack|blocked|sanction|export control|war|conflict)\b/.test(lower)) {
    const tags: EnterpriseRiskTag[] = ['geopolitical', 'supply_chain'];
    if (/\b(tariff|customs|cbam|carbon border|battery regulation|export control|trade restriction)\b/.test(lower)) tags.push('regulatory');
    if (/\b(euro|eur|yuan|renminbi|rmb|cny|cnh|vnd|dong|baht|rupiah|currency|fx|exchange rate|hedge|receivable|margin)\b/.test(lower)) tags.push('financial_fx');
    return unique(tags);
  }
  if (/\b(cbam|carbon border|embedded emissions|battery regulation|customs|tariff|duties|regulation|probe|investigation|audit|certification|due diligence|traceability)\b/.test(lower)) {
    const tags: EnterpriseRiskTag[] = ['regulatory'];
    if (/\b(port|shipping|freight|container|supplier|supply chain|factory|production|battery|aluminum|aluminium|lithium|critical mineral)\b/.test(lower)) tags.push('supply_chain');
    if (/\b(euro|eur|yuan|renminbi|rmb|cny|cnh|vnd|dong|baht|rupiah|currency|fx|exchange rate|hedge|receivable|margin)\b/.test(lower)) tags.push('financial_fx');
    return unique(tags);
  }
  if (/\b(euro|eur|yuan|renminbi|rmb|cny|cnh|vnd|dong|baht|rupiah|currency|fx|exchange rate|hedge|receivable|margin)\b/.test(lower)) {
    const tags: EnterpriseRiskTag[] = ['financial_fx'];
    if (/\b(port|shipping|freight|container|supplier|supply chain|factory|production)\b/.test(lower)) tags.push('supply_chain');
    return unique(tags);
  }
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
  let score = Math.min(baseScore, scenarioRelevant ? 66 : 46);
  if (scenarioRelevant) score += 8;
  for (const keyword of LIVE_CONTEXT_KEYWORDS) {
    if (lower.includes(keyword)) score += scenarioRelevant ? 1.6 : 0.8;
  }
  if (inferLocationFromText(text)) score += 3;
  return Math.max(30, Math.min(scenarioRelevant ? 84 : 62, Math.round(score)));
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
      params.sourceType === 'demo_seed' ? 'Pinned demo scenario' : liveWindowLabel(params.occurredAt),
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
  const location = inferLocation(text, item.lat != null && item.lon != null ? { lat: item.lat, lon: item.lon, label: item.locationName || item.source, zoom: 5.2 } : undefined);
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
  const location = inferLocation(text, cluster.lat != null && cluster.lon != null ? { lat: cluster.lat, lon: cluster.lon, label: cluster.primarySource, zoom: 5.2 } : undefined);
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

function scoreClamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function eventBusinessText(event: EnterpriseRiskEvent): string {
  return [
    event.title,
    event.summary,
    event.source,
    event.tags.join(' '),
    event.countries.join(' '),
    event.affectedMarkets.join(' '),
    event.impactPath?.label ?? '',
    ...(event.impactPath?.steps ?? []),
  ].join(' ');
}

function keywordHitCount(text: string, keywords: string[]): number {
  const tokens = tokenizeForMatch(text);
  return keywords.filter(keyword => matchKeyword(tokens, keyword)).length;
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywordHitCount(text, keywords) > 0;
}

function hasEnterpriseFxTransmission(text: string): boolean {
  const lower = normalizeText(text);
  return hasKeyword(text, FX_ENTERPRISE_TRANSMISSION_KEYWORDS)
    || /\b(export|exports|exporter|exporters|supplier|suppliers|factory|manufacturing|procurement|shipment|shipments|contract|contracts|receivable|receivables|margin|hedge|hedging|quote|quotation|pricing|working capital|payment terms|input costs?|freight|logistics)\b/.test(lower);
}

function isGenericFxMarketQuote(text: string): boolean {
  const lower = normalizeText(text);
  if (!hasKeyword(text, FX_MARKET_KEYWORDS)) return false;
  return GENERIC_FX_MARKET_QUOTE_PATTERNS.some(pattern => pattern.test(lower));
}

function hasConcreteLiveTrigger(text: string): boolean {
  const lower = normalizeText(text);
  return CONCRETE_LIVE_TRIGGER_PATTERNS.some(pattern => pattern.test(lower));
}

function isStaticReferenceContent(text: string): boolean {
  const lower = normalizeText(text);
  if (!STATIC_REFERENCE_CONTENT_PATTERNS.some(pattern => pattern.test(lower))) return false;
  return !hasConcreteLiveTrigger(text);
}

function matchesMarket(text: string, market: string): boolean {
  const tokens = tokenizeForMatch(text);
  return matchKeyword(tokens, market)
    || (MARKET_KEYWORDS[market] ?? []).some(keyword => matchKeyword(tokens, keyword));
}

function businessTransmissionScore(text: string, event?: EnterpriseRiskEvent): number {
  const lower = normalizeText(text);
  const markets = event?.affectedMarkets.length ? event.affectedMarkets : inferMarkets(text);
  const targetMarketCount = PROFILE.targetMarkets.filter(market =>
    markets.includes(market) || matchesMarket(text, market),
  ).length;
  const hasTargetMarket = targetMarketCount > 0;
  const hasEuMarket = markets.some(market => ['EU', 'Germany', 'Netherlands'].includes(market))
    || ['EU', 'Germany', 'Netherlands'].some(market => matchesMarket(text, market));
  const hasSeaMarket = markets.some(market => ['Vietnam', 'Thailand', 'Indonesia'].includes(market))
    || ['Vietnam', 'Thailand', 'Indonesia'].some(market => matchesMarket(text, market));

  const hasProduct = hasKeyword(text, PRODUCT_COMPONENT_KEYWORDS);
  const hasMaterial = hasKeyword(text, INPUT_MATERIAL_KEYWORDS);
  const hasHardCompliance = hasKeyword(text, HARD_COMPLIANCE_KEYWORDS);
  const hasWeakPolicy = hasKeyword(text, WEAK_POLICY_KEYWORDS);
  const hasRoute = hasKeyword(text, ROUTE_CHAIN_KEYWORDS) || Boolean(buildImpactPath(text, markets));
  const hasIndirectEnergyRoute = hasKeyword(text, INDIRECT_ENERGY_ROUTE_KEYWORDS);
  const hasFx = hasKeyword(text, FX_MARKET_KEYWORDS);
  const hasEnterpriseFx = hasFx && hasEnterpriseFxTransmission(text);
  const isGenericFxQuote = isGenericFxMarketQuote(text) && !hasEnterpriseFx;
  const hasSupplyOperation = hasKeyword(text, SUPPLY_OPERATION_KEYWORDS);
  const hasGeoTrigger = hasKeyword(text, GEOPOLITICAL_TRIGGER_KEYWORDS);

  let score = 0;
  if (hasProduct) score += 22;
  if (hasMaterial) score += 16;
  if (hasTargetMarket) score += Math.min(18, targetMarketCount * 6);
  if (hasEuMarket) score += 7;
  if (hasSeaMarket) score += 7;
  if (hasHardCompliance) score += hasEuMarket || hasProduct || hasMaterial ? 30 : 18;
  if (hasRoute) score += hasTargetMarket || hasSupplyOperation ? 24 : 12;
  if (hasEnterpriseFx) score += hasTargetMarket || hasSupplyOperation ? 24 : 16;
  else if (hasFx) score += hasSupplyOperation || hasRoute ? 6 : 0;
  if (hasSupplyOperation) score += hasProduct || hasMaterial || hasRoute || hasTargetMarket ? 18 : 8;
  if (hasGeoTrigger) score += hasRoute || hasSupplyOperation || hasTargetMarket ? 16 : 6;
  if (hasIndirectEnergyRoute) score += hasRoute || hasSupplyOperation ? 12 : 4;
  if (event?.impactPath) score += 16;
  if ((event?.sourceType === 'supply_chain' || event?.sourceType === 'market') && hasTargetMarket) score += 8;

  if (hasWeakPolicy && !(hasHardCompliance || hasProduct || hasMaterial || hasRoute || hasEnterpriseFx)) score -= 20;
  if (isGenericFxQuote) score -= 36;
  if (isStaticReferenceContent(text)) score -= 42;
  if (GENERIC_LOW_TRANSMISSION_PATTERNS.some(pattern => pattern.test(lower))) score -= 26;
  if (hasLowEnterpriseSignal(text)) score -= 28;

  const concreteNodes = [
    hasProduct,
    hasMaterial,
    hasTargetMarket,
    hasHardCompliance,
    hasRoute,
    hasSupplyOperation,
    hasEnterpriseFx,
    hasGeoTrigger,
  ].filter(Boolean).length;
  if (concreteNodes < 2) score -= 18;

  return scoreClamp(score);
}

function hasBusinessTransmission(event: EnterpriseRiskEvent): boolean {
  return businessTransmissionScore(eventBusinessText(event), event) >= MIN_BUSINESS_TRANSMISSION_SCORE;
}

function isSoutheastAsiaBusinessEvent(event: EnterpriseRiskEvent): boolean {
  const text = eventBusinessText(event);
  const lower = normalizeText(text);
  const markets = eventMarketSet(event);
  const marketHit = Array.from(SEA_MARKETS).some(market => markets.has(market) || matchesMarket(text, market));
  const routeHit = /\b(vietnam|vnd|dong|thailand|baht|indonesia|rupiah|malacca|singapore|ho chi minh|hanoi|hai phong|laem chabang|bangkok|jakarta|surabaya|batam)\b/.test(lower);
  if (isStaticReferenceContent(text)) return false;
  if (isGenericFxMarketQuote(text) && !hasEnterpriseFxTransmission(text)) return false;
  return (marketHit || routeHit)
    && businessTransmissionScore(text, event) >= MIN_SEA_COVERAGE_SCORE;
}

function businessScenarioFitScore(event: EnterpriseRiskEvent): number {
  const text = eventBusinessText(event);
  const lower = normalizeText(text);
  let score = 0;
  for (const rule of BUSINESS_SIGNAL_RULES) {
    if (keywordHitCount(text, rule.keywords) > 0) score += rule.score;
  }

  const targetMarketHits = PROFILE.targetMarkets.filter(market =>
    event.affectedMarkets.includes(market) || matchesMarket(text, market),
  );
  score += Math.min(16, targetMarketHits.length * 4);

  const certificationHits = PROFILE.criticalCertifications.filter(cert =>
    lower.includes(cert.toLowerCase()) || keywordHitCount(text, cert.split(/[/-]/)) > 0,
  );
  score += Math.min(18, certificationHits.length * 6);

  if (event.impactPath) score += 12;
  else if (buildImpactPath(text, event.affectedMarkets)) score += 10;
  if (isScenarioRelevant(text)) score += 8;
  score += businessTransmissionScore(text, event) * 0.42;
  return scoreClamp(score);
}

function matchedBusinessLines(event: EnterpriseRiskEvent): typeof PROFILE.businessLines {
  const text = eventBusinessText(event);
  const tokens = tokenizeForMatch(text);
  return PROFILE.businessLines.filter(line => {
    const targetMarketHit = line.targetMarkets.some(market =>
      event.affectedMarkets.includes(market) || matchesMarket(text, market),
    );
    const productHit = line.products.some(product => matchKeyword(tokens, product));
    const routeHit = line.routeExposure.some(route => matchKeyword(tokens, route));
    return targetMarketHit || productHit || routeHit;
  });
}

function businessLineExposureScore(event: EnterpriseRiskEvent): number {
  const lines = matchedBusinessLines(event);
  if (lines.length === 0) return isScenarioRelevant(eventBusinessText(event)) ? 12 : 0;

  const totalRevenue = PROFILE.businessLines.reduce((sum, line) => sum + line.revenueAtRiskUsd, 0);
  const totalExportShare = Math.max(1, PROFILE.exportSharePct);
  const matchedRevenue = lines.reduce((sum, line) => sum + line.revenueAtRiskUsd, 0);
  const matchedExportShare = lines.reduce((sum, line) => sum + line.exportSharePct, 0);
  const revenueScore = totalRevenue > 0 ? (matchedRevenue / totalRevenue) * 62 : 0;
  const exportShareScore = (matchedExportShare / totalExportShare) * 28;
  const lineCoverageScore = Math.min(10, lines.length * 5);
  return scoreClamp(revenueScore + exportShareScore + lineCoverageScore);
}

function riskAxisImpactScore(event: EnterpriseRiskEvent): number {
  const tags = unique(event.tags);
  let score = tags.reduce((sum, tag) => sum + BUSINESS_AXIS_IMPACT_WEIGHTS[tag], 0) * 2;
  if (tags.includes('regulatory') && tags.includes('supply_chain')) score += 10;
  if (tags.includes('supply_chain') && tags.includes('geopolitical')) score += 8;
  if (tags.includes('financial_fx') && tags.includes('supply_chain')) score += 6;
  if (tags.includes('financial_fx') && tags.includes('regulatory')) score += 4;
  return scoreClamp(score);
}

function sourceConfidenceScore(event: EnterpriseRiskEvent): number {
  const sourceCount = Number(event.summary.match(/\b(\d+)\s+(?:source|stream)/i)?.[1] ?? 1);
  const evidenceCount = event.evidenceSources?.length ?? 0;
  const base = SOURCE_CONFIDENCE_BASE[event.sourceType] ?? 10;
  return scoreClamp(
    base * 4.2
    + Math.min(12, Math.max(0, sourceCount - 1) * 3)
    + Math.min(8, evidenceCount * 2)
    + (event.link ? 4 : 0),
  );
}

function businessImpactScore(event: EnterpriseRiskEvent): number {
  return scoreClamp(
    event.severityScore * 0.32
    + businessScenarioFitScore(event) * 0.28
    + businessLineExposureScore(event) * 0.22
    + riskAxisImpactScore(event) * 0.10
    + sourceConfidenceScore(event) * 0.08,
  );
}

function liveRiskAxisScore(event: EnterpriseRiskEvent, axis: EnterpriseRiskTag): number {
  const text = eventBusinessText(event);
  const lower = normalizeText(text);
  let score = event.tags.includes(axis) ? 45 : 0;
  score += Math.min(30, keywordHitCount(text, TAG_KEYWORDS[axis]) * 10);

  if (axis === 'regulatory' && /\b(cbam|carbon border|embedded emissions|battery regulation|customs|tariff|due diligence|traceability)\b/.test(lower)) score += 25;
  if (axis === 'supply_chain' && /\b(red sea|suez|malacca|port|shipping|freight|container|reroute|factory|supplier|critical mineral)\b/.test(lower)) score += 25;
  if (axis === 'financial_fx' && /\b(euro|eur|yuan|renminbi|rmb|cny|cnh|vnd|dong|baht|rupiah|currency|fx|exchange rate|hedge|receivable|margin)\b/.test(lower)) score += 25;
  if (axis === 'geopolitical' && /\b(war|conflict|attack|sanction|export control|red sea|suez|malacca|border|protest)\b/.test(lower)) score += 25;

  return scoreClamp(score);
}

function liveRiskCoverageAxes(event: EnterpriseRiskEvent): EnterpriseRiskTag[] {
  return LIVE_RISK_AXIS_ORDER.filter(axis => liveRiskAxisScore(event, axis) >= MIN_AXIS_COVERAGE_SCORE);
}

function compareLiveEvents(a: EnterpriseRiskEvent, b: EnterpriseRiskEvent): number {
  return businessImpactScore(b) - businessImpactScore(a)
    || b.severityScore - a.severityScore
    || riskAxisImpactScore(b) - riskAxisImpactScore(a)
    || scorePriority(b.priority) - scorePriority(a.priority)
    || sourceConfidenceScore(b) - sourceConfidenceScore(a)
    || a.title.localeCompare(b.title);
}

function exactDedupeKey(event: EnterpriseRiskEvent): string {
  return normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96);
}

function dedupeText(event: EnterpriseRiskEvent): string {
  return normalizeText(`${event.title} ${event.summary}`);
}

function normalizeDedupeText(value: string): string {
  return normalizeText(value)
    .replace(/\b(financial times|reuters|aol\.com|associated press|ap news|bloomberg|ft)\b/g, ' ')
    .replace(/\bclustered from \d+ sources?.*$/g, ' ')
    .replace(/['"“”‘’]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeTokenSet(value: string): Set<string> {
  const tokens = tokenizeForMatch(normalizeDedupeText(value));
  return new Set(tokens.ordered.filter(token =>
    token.length >= 3
    && !DEDUPE_STOP_WORDS.has(token)
    && !/^\d+$/.test(token),
  ));
}

function dedupeTokens(event: EnterpriseRiskEvent): Set<string> {
  return dedupeTokenSet(dedupeText(event));
}

function titleDedupeTokens(event: EnterpriseRiskEvent): Set<string> {
  return dedupeTokenSet(event.title);
}

function eventPhraseSet(event: EnterpriseRiskEvent): Set<string> {
  const text = normalizeDedupeText(dedupeText(event));
  return new Set(DEDUPE_KEY_PHRASES.filter(phrase => text.includes(phrase)));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function hasSetOverlap<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function eventMarketSet(event: EnterpriseRiskEvent): Set<string> {
  return new Set([
    ...event.affectedMarkets,
    ...inferMarkets(eventBusinessText(event)),
    ...event.countries,
  ]);
}

function eventRouteSet(event: EnterpriseRiskEvent): Set<string> {
  return new Set(event.impactPath?.routeIds ?? []);
}

function similarBusinessEvent(a: EnterpriseRiskEvent, b: EnterpriseRiskEvent): boolean {
  if (exactDedupeKey(a) === exactDedupeKey(b)) return true;

  const aTokens = dedupeTokens(a);
  const bTokens = dedupeTokens(b);
  const tokenSimilarity = jaccardSimilarity(aTokens, bTokens);
  const titleSimilarity = jaccardSimilarity(titleDedupeTokens(a), titleDedupeTokens(b));
  const sharedPhrases = hasSetOverlap(eventPhraseSet(a), eventPhraseSet(b));
  const sharedAxes = hasSetOverlap(new Set(liveRiskCoverageAxes(a)), new Set(liveRiskCoverageAxes(b)));
  const sharedMarkets = hasSetOverlap(eventMarketSet(a), eventMarketSet(b));
  const sharedRoutes = hasSetOverlap(eventRouteSet(a), eventRouteSet(b));

  if (titleSimilarity >= 0.58) return true;
  if (titleSimilarity >= 0.42 && (sharedAxes || sharedMarkets || sharedRoutes || sharedPhrases)) return true;
  if (sharedPhrases && titleSimilarity >= 0.24 && (sharedAxes || sharedMarkets || sharedRoutes)) return true;
  if (sharedPhrases && tokenSimilarity >= 0.24 && (sharedAxes || sharedMarkets || sharedRoutes)) return true;
  if (tokenSimilarity >= 0.58) return true;
  if (tokenSimilarity >= 0.42 && (sharedAxes || sharedMarkets || sharedRoutes)) return true;
  if (tokenSimilarity >= 0.30 && sharedAxes && (sharedMarkets || sharedRoutes)) return true;

  const aBusinessText = eventBusinessText(a);
  const bBusinessText = eventBusinessText(b);
  const sharedHardCompliance = hasKeyword(aBusinessText, HARD_COMPLIANCE_KEYWORDS)
    && hasKeyword(bBusinessText, HARD_COMPLIANCE_KEYWORDS);
  const sharedRouteChain = hasKeyword(aBusinessText, ROUTE_CHAIN_KEYWORDS)
    && hasKeyword(bBusinessText, ROUTE_CHAIN_KEYWORDS);
  const sharedFxTransmission = hasKeyword(aBusinessText, FX_TRANSMISSION_KEYWORDS)
    && hasKeyword(bBusinessText, FX_TRANSMISSION_KEYWORDS);

  return tokenSimilarity >= 0.34
    && (sharedHardCompliance || sharedRouteChain || sharedFxTransmission)
    && (sharedMarkets || sharedRoutes || sharedAxes);
}

function dedupeEvents(events: EnterpriseRiskEvent[]): EnterpriseRiskEvent[] {
  const deduped: EnterpriseRiskEvent[] = [];
  for (const event of [...events].sort(compareLiveEvents)) {
    if (deduped.some(existing => similarBusinessEvent(existing, event))) continue;
    deduped.push(event);
  }
  return deduped;
}

function sortLiveEvents(events: EnterpriseRiskEvent[]): EnterpriseRiskEvent[] {
  return [...events].sort(compareLiveEvents);
}

function selectLiveEvents(events: EnterpriseRiskEvent[], limit: number): EnterpriseRiskEvent[] {
  const ranked = sortLiveEvents(events).filter(hasBusinessTransmission);
  const selected: EnterpriseRiskEvent[] = [];
  const selectedIds = new Set<string>();
  const coveredAxes = new Set<EnterpriseRiskTag>();

  const add = (event: EnterpriseRiskEvent) => {
    if (selectedIds.has(event.id) || selected.length >= limit) return;
    selected.push(event);
    selectedIds.add(event.id);
    for (const axis of liveRiskCoverageAxes(event)) coveredAxes.add(axis);
  };

  if (ranked[0]) add(ranked[0]);

  if (!selected.some(isSoutheastAsiaBusinessEvent)) {
    const seaCandidate = ranked.find(event =>
      !selectedIds.has(event.id)
      && isSoutheastAsiaBusinessEvent(event),
    );
    if (seaCandidate) add(seaCandidate);
  }

  for (const axis of LIVE_RISK_AXIS_ORDER) {
    if (selected.length >= limit || coveredAxes.has(axis)) continue;
    const candidate = ranked.find(event =>
      !selectedIds.has(event.id)
      && businessImpactScore(event) >= MIN_AXIS_COVERAGE_SCORE
      && liveRiskAxisScore(event, axis) >= MIN_AXIS_COVERAGE_SCORE,
    );
    if (candidate) add(candidate);
  }

  for (const event of ranked) {
    if (selected.length >= limit) break;
    add(event);
  }

  return sortLiveEvents(selected);
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
        impact: `${event.priority} ${tagLabel} affects ${line.name}`,
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
        title: event.priority === 'P1' ? 'High-priority internal alert' : 'Business-line risk notice',
        priority: event.priority,
        message: `${event.title} -> ${departments.join(' / ') || 'Risk Office'} response started`,
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
    internalImpact: `${lead.priority} event mapped to ${departments.join(' / ') || 'Risk Office'}, affecting ${businessLines.join(' / ') || 'priority business lines'}.`,
    recommendedActions: recommendations.length ? recommendations : ['Maintain monitoring and review business-line exposure after the next refresh.'],
    financialImpact: {
      exposureUsd: exposure,
      estimate: `Estimated short-term revenue/cost exposure: ${formatUsd(exposure)}.`, 
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
        action: mapping.action || `${department}: review exposure and response owner for ${event.title}`,
        impact: mapping.impact || `${event.priority} Agent mapping affects ${line.name}`,
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
  const routeIds = transmission.impactPath.routeIds.length
    ? transmission.impactPath.routeIds
    : (event.impactPath?.routeIds ?? []);
  if (transmission.impactPath.steps.length && !isGenericAgentImpactPath(transmission.impactPath)) {
    return {
      ...transmission.impactPath,
      routeIds,
    };
  }
  const firstMapping = transmission.businessMappings[0];
  if (!firstMapping) return event.impactPath;
  const line = PROFILE.businessLines.find(item => item.id === firstMapping.businessLineId || item.name === firstMapping.businessLineName);
  const route = transmission.impactPath.label && !isGenericAgentImpactPath(transmission.impactPath)
    ? transmission.impactPath.label
    : line?.routeExposure[0] ?? event.affectedMarkets[0] ?? 'enterprise exposure';
  return {
    routeIds,
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
      id: 'demo-scenario',
      label: 'Demo scenario',
      status: demoStoryPinned ? 'demo' : 'missing',
      detail: `${PROFILE.demoMode.label} currently appended ${liveEventCount} live external event(s).`,
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
  const seaFxMarkets = [
    {
      market: inputs.markets?.find(m => /VND|DONG|VIETNAM/i.test(`${m.symbol} ${m.name}`)),
      country: 'VN',
      affectedMarkets: ['Vietnam'],
      text: 'VND Vietnam dong Ho Chi Minh suppliers export margin receivables',
      summary: 'Vietnam dong movement can alter supplier payment terms, export margin, and hedge ratios for Ho Chi Minh / Hai Phong-linked shipments.',
    },
    {
      market: inputs.markets?.find(m => /THB|BAHT|THAILAND/i.test(`${m.symbol} ${m.name}`)),
      country: 'TH',
      affectedMarkets: ['Thailand'],
      text: 'THB Thai baht Laem Chabang suppliers export margin receivables',
      summary: 'Thai baht movement can shift quotation assumptions for Thailand supplier lanes and Laem Chabang logistics exposure.',
    },
    {
      market: inputs.markets?.find(m => /IDR|RUPIAH|INDONESIA/i.test(`${m.symbol} ${m.name}`)),
      country: 'ID',
      affectedMarkets: ['Indonesia'],
      text: 'IDR Indonesian rupiah Indonesia nickel battery material export margin',
      summary: 'Indonesian rupiah movement can affect nickel-linked input costs and Southeast Asia supplier margin assumptions.',
    },
  ];
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

  for (const item of seaFxMarkets) {
    const market = item.market;
    if (market?.change == null || Math.abs(market.change) <= 0.8) continue;
    const tags: EnterpriseRiskTag[] = ['financial_fx', 'supply_chain'];
    const score = weightedScore(53 + Math.abs(market.change) * 5, tags);
    const priority: EnterpriseRiskPriority = 'P2';
    const location = inferLocation(item.text);
    const impactPath = buildImpactPath(item.text, item.affectedMarkets);
    events.push({
      id: `market-${stableHash(market.symbol)}`,
      title: `${market.display || market.symbol} changed ${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)}%`,
      source: 'Markets',
      sourceType: 'market',
      summary: item.summary,
      occurredAt: Date.now(),
      tags,
      countries: [item.country],
      affectedMarkets: item.affectedMarkets,
      severityScore: score,
      priority,
      location,
      impactPath,
      explanation: buildExplanation({ text: item.text, tags, priority, score, sourceType: 'market', occurredAt: Date.now(), location, markets: item.affectedMarkets, impactPath }),
      isDemoSeed: false,
    });
  }

  return sortLiveEvents(dedupeEvents(events));
}

export function buildEnterpriseRiskAssessment(inputs: EnterpriseRiskInputs): EnterpriseRiskAssessment {
  const demoTitles = new Set(DEMO_EVENTS.map(event => normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96)));
  const liveCandidates = collectEvents(inputs).filter(event => {
    const key = normalizeText(event.title).replace(/[^\w\s]/g, '').slice(0, 96);
    return !demoTitles.has(key);
  });
  const liveAppendix = selectLiveEvents(liveCandidates, MAX_LIVE_APPENDIX);
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
      'Rule layer has generated candidate events; waiting for Qwen identification and transmission agents to override.',
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
      'Map jump uses feed coordinates or explicit place matches only; no country or market-level fallback targeting.',
      'Financial exposure is a POC estimate based on business-line revenue and event severity; real ERP ledger data is not connected yet.',
      'Task status and alert acknowledgement are persisted locally in the browser; production workflow approvals are not connected yet.',
    ],
  };
}

export function markEnterpriseRiskAgentRunning(assessment: EnterpriseRiskAssessment): EnterpriseRiskAssessment {
  return {
    ...assessment,
    agentWorkflow: agentStatus(
      'running',
      'Qwen identification and transmission agents are analyzing all demo/live cards.',
      0,
      assessment.agentWorkflow.model,
    ),
  };
}

export function markEnterpriseRiskAgentFallback(assessment: EnterpriseRiskAssessment, detail = 'Qwen Agent returned no usable result; keeping rule candidates as fallback.'): EnterpriseRiskAssessment {
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
      `Qwen Agent applied identification and transmission to ${enrichedEventCount} card(s).`,
      enrichedEventCount,
      agentResult.model,
    ),
    reusedCapabilities: [
      'Qwen identification agent',
      'Qwen transmission agent',
      ...assessment.reusedCapabilities.filter(item => !item.includes('Chat Analyst')),
    ],
    gaps: [
      'Qwen Agent is the primary output for identification and transmission; rule layer is only candidate generation and failure fallback.',
      ...assessment.gaps.filter(gap => !gap.includes('rule layer')),
    ],
  };
}

export function enterpriseRiskTagLabel(tag: EnterpriseRiskTag): string {
  return TAG_LABELS[tag];
}

export function enterprisePriorityRank(priority: EnterpriseRiskPriority): number {
  return scorePriority(priority);
}
