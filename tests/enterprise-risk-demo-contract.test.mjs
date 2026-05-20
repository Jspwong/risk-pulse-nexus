import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('enterprise risk demo contract', () => {
  it('exposes only the four demo risk tags in the UI-facing type', () => {
    const src = read('src/types/enterprise-risk.ts');
    const union = src.match(/export type EnterpriseRiskTag =([\s\S]*?);/);
    assert.ok(union, 'EnterpriseRiskTag union is missing');

    const tags = Array.from(union[1].matchAll(/'([^']+)'/g), match => match[1]);
    assert.deepEqual(tags, ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx']);
    assert.equal(tags.includes('disaster'), false);
    assert.equal(tags.includes('transport'), false);
    assert.equal(tags.includes('compliance'), false);
    assert.equal(tags.includes('financial_exposure'), false);
    assert.equal(tags.includes('fx'), false);
  });

  it('keeps the enterprise profile weights aligned to the four tags', () => {
    const src = read('src/config/enterprise-risk-profile.ts');
    const weights = src.match(/riskWeights:\s*\{([\s\S]*?)\},/);
    assert.ok(weights, 'riskWeights block is missing');

    const keys = Array.from(weights[1].matchAll(/^\s+([a-z_]+):/gm), match => match[1]);
    assert.deepEqual(keys, ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx']);
  });

  it('uses demo-ready labels for the four visible risk tags', () => {
    const src = read('src/services/enterprise-risk.ts');
    assert.match(src, /geopolitical:\s*'Geopolitical Risk'/);
    assert.match(src, /regulatory:\s*'Regulatory Risk'/);
    assert.match(src, /supply_chain:\s*'Supply Chain Risk'/);
    assert.match(src, /financial_fx:\s*'FX Risk'/);
  });

  it('attaches a credible CBAM source with official fallback', () => {
    const src = read('src/services/enterprise-risk.ts');
    assert.match(src, /pickBestCbamSource/);
    assert.match(src, /Best live CBAM-related news source found in RSS inputs/);
    assert.match(src, /taxation-customs\.ec\.europa\.eu\/carbon-border-adjustment-mechanism_en/);
    assert.match(src, /attachCbamEvidence/);
  });

  it('renders the selected card as a four-layer closed loop', () => {
    const src = read('src/components/EnterpriseRiskPanel.ts');
    assert.match(src, /Perception Layer/);
    assert.match(src, /Identification Layer/);
    assert.match(src, /Transmission Layer/);
    assert.match(src, /Response Layer/);
    assert.match(src, /Qwen Identification Agent/);
    assert.match(src, /Qwen Transmission Agent/);
    assert.match(src, /evidenceSources/);
    assert.match(src, /er-transmission-list/);
    assert.doesNotMatch(src, /renderLoopStep/);
    assert.doesNotMatch(src, /Internal Mapping - Selected Trigger/);
  });

  it('models selected-event financial exposure only for triggered ROI axes without Qwen dependency', () => {
    const types = read('src/types/enterprise-risk.ts');
    const service = read('src/services/enterprise-risk.ts');
    const panel = read('src/components/EnterpriseRiskPanel.ts');

    assert.match(types, /export interface EnterpriseRoiScenario/);
    assert.match(types, /export interface EnterpriseRoiSimulation/);
    assert.match(types, /expectedSavingUsd: number/);
    assert.match(types, /mitigationCostUsd: number/);
    assert.match(types, /compositeRoiPct: number/);

    assert.match(service, /ENTERPRISE_ROI_RISK_ORDER:\s*EnterpriseRiskTag\[\]\s*=\s*\['regulatory', 'supply_chain', 'financial_fx', 'geopolitical'\]/);
    assert.match(service, /buildEnterpriseRoiSimulation/);
    assert.match(service, /const triggeredTags = ENTERPRISE_ROI_RISK_ORDER\.filter\(tag => event\.tags\.includes\(tag\)\)/);
    assert.match(service, /mitigationCostUsd > 0 \? Math\.round\(\(netSavingUsd \/ mitigationCostUsd\) \* 100\) : 0/);
    assert.doesNotMatch(service.match(/function buildEnterpriseRoiScenario[\s\S]*?\n\}/)?.[0] ?? '', /qwen_agent|DASHSCOPE/);
    assert.doesNotMatch(service, /secondary stress scenario/);

    assert.match(panel, /Triggered Risk ROI Simulation Sandbox/);
    assert.match(panel, /Expected savings/);
    assert.match(panel, /Composite ROI/);
    assert.match(panel, /er-roi-kpi-negative-highlight/);
    assert.match(panel, /data-er-action="roi-mode"/);
    assert.match(panel, /data-er-action="roi-toggle-tag"/);
    assert.match(panel, /buildEnterpriseRoiSimulation\(selectedEvent, impacts, tasks, this\.getRoiAssumptions\(\)\)/);
    assert.doesNotMatch(panel, /latent/);
    assert.doesNotMatch(panel, /triggered/);
  });

  it('provides a server-side Qwen entry point for identification and transmission agents', () => {
    const api = read('api/enterprise-risk-agent.js');
    const plan = read('docs/enterprise-risk-agent-plan.md');
    const exceptions = read('api/api-route-exceptions.json');

    assert.match(api, /DASHSCOPE_API_KEY/);
    assert.match(api, /DASHSCOPE_BASE_URL/);
    assert.match(api, /\/chat\/completions/);
    assert.match(api, /identify/);
    assert.match(api, /transmit/);
    assert.match(api, /closed_loop/);
    assert.match(api, /batch_closed_loop/);
    assert.match(api, /geopolitical', 'regulatory', 'supply_chain', 'financial_fx/);
    assert.match(api, /const MAX_RISK_TAGS = 3/);
    assert.match(api, /max 3/);
    assert.match(api, /slice\(0, MAX_RISK_TAGS\)/);
    assert.match(api, /const QWEN_TIMEOUT_MS = 90_000/);
    assert.match(api, /mode === 'roi_assumptions' \? 3200/);
    assert.doesNotMatch(api, /VITE_(?:QWEN|DASHSCOPE)/);

    assert.match(plan, /ENTERPRISE_RISK_AGENT_ENABLED=1/);
    assert.match(plan, /DASHSCOPE_BASE_URL=https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1/);
    assert.doesNotMatch(plan, /VITE_(?:QWEN|DASHSCOPE)/);

    assert.match(exceptions, /api\/enterprise-risk-agent\.js/);
  });

  it('uses Qwen as the primary identification and transmission layer with rule fallback only', () => {
    const service = read('src/services/enterprise-risk.ts');
    const loader = read('src/app/data-loader.ts');
    const panel = read('src/components/EnterpriseRiskPanel.ts');
    const client = read('src/services/enterprise-risk-agent-client.ts');

    assert.match(service, /applyEnterpriseRiskAgentResult/);
    assert.match(service, /identificationSource:\s*'qwen_agent'/);
    assert.match(service, /transmissionSource:\s*'qwen_agent'/);
    assert.match(service, /rule layer is only candidate generation and failure fallback/);
    assert.match(loader, /fetchEnterpriseRiskAgentBatch/);
    assert.match(loader, /markEnterpriseRiskAgentRunning/);
    assert.match(loader, /markEnterpriseRiskAgentFallback/);
    assert.match(loader, /events\.filter\(event => enterpriseRiskRoiTagsForEvent\(event\)\.length > 0\)/);
    assert.doesNotMatch(loader, /return events\.slice\(0,\s*4\)/);
    assert.match(loader, /selectEnterpriseRiskRoiAssumptionTargets/);
    assert.match(loader, /ENTERPRISE_RISK_ROI_REQUEST_CONCURRENCY = 3/);
    assert.match(loader, /ENTERPRISE_RISK_ROI_REQUEST_RETRIES = 1/);
    assert.match(client, /maxRiskTagsPerEvent:\s*3/);
    assert.match(client, /const QWEN_AGENT_ROI_TIMEOUT_MS = 60_000/);
    assert.match(client, /requireOnePackForEveryRequestedTag:\s*true/);
    assert.match(panel, /Qwen Identification Agent/);
    assert.match(panel, /Qwen Transmission Agent/);
    assert.match(client, /mode:\s*'batch_closed_loop'/);
  });

  it('uses seven-day upstream news windows for enterprise-risk live candidates', () => {
    const clientRss = read('src/services/rss.ts');
    const serverDigest = read('server/worldmonitor/news/v1/list-feed-digest.ts');
    const clientFeeds = read('src/config/feeds.ts');
    const serverFeeds = read('server/worldmonitor/news/v1/_feeds.ts');
    const loader = read('src/app/data-loader.ts');

    assert.match(clientRss, /const FEED_LOOKBACK_MS = 3 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(clientRss, /const MAX_ITEMS_PER_FEED = 15/);
    assert.match(clientRss, /const MAX_ITEMS_PER_CATEGORY = 60/);
    assert.match(clientRss, /feed:v3-3d/);

    assert.match(serverDigest, /const ITEMS_PER_FEED = 15/);
    assert.match(serverDigest, /const MAX_ITEMS_PER_CATEGORY = 60/);
    assert.match(serverDigest, /const hours = Number\.isInteger\(raw\) && raw > 0 \? raw : 168/);
    assert.match(serverDigest, /rss:feed:v5-3d/);
    assert.match(serverDigest, /news:digest:v3-3d/);
    assert.match(loader, /digest:last-good:v3-3d/);
    assert.match(loader, /refreshEnterpriseRiskAssessment\(\{ runAgent: !this\.isBulkLoading \}\)/);

    assert.doesNotMatch(clientFeeds, /when:[1-2]d|when:[8-9]d/);
    assert.doesNotMatch(serverFeeds, /when:[1-2]d|when:[8-9]d/);
  });

  it('filters live cards for enterprise relevance and avoids weak map targets', () => {
    const service = read('src/services/enterprise-risk.ts');
    const loader = read('src/app/data-loader.ts');
    const panel = read('src/components/EnterpriseRiskPanel.ts');

    assert.match(service, /ENTERPRISE_RISK_REQUIRED_KEYWORDS/);
    assert.match(service, /LOW_ENTERPRISE_SIGNAL_PATTERNS/);
    assert.match(service, /denaturaliz/);
    assert.match(service, /terrorist support/);
    assert.match(service, /enterpriseSignalStrength/);
    assert.match(service, /signalStrength < 3 && transmissionScore < MIN_BUSINESS_TRANSMISSION_SCORE \+ 10/);
    assert.match(service, /hasLowEnterpriseSignal\(text\) && signalStrength < 6/);
    assert.match(service, /clusterContextText/);
    assert.match(service, /score >= 86 && directShock && routeOrCompliance/);
    assert.match(service, /Math\.min\(scenarioRelevant \? 84 : 62/);
    assert.match(service, /const eventRouteIds = event\.impactPath\?\.routeIds \?\? \[\]/);
    assert.match(service, /const routeIds = eventRouteIds\.length \? eventRouteIds : transmission\.impactPath\.routeIds/);

    assert.match(loader, /ENTERPRISE_RISK_FAST_NEWS_CATEGORIES/);
    assert.match(loader, /shouldUsePerFeedFallbackForCategory/);
    assert.match(loader, /categories\.sort/);

    const rendering = read('src/components/enterprise-risk-rendering.ts');
    assert.match(panel, /hasReliableEnterpriseRiskMapTarget/);
    assert.match(rendering, /source !== 'feed'/);
    assert.match(rendering, /resolution !== 'feed_coordinate'/);
  });

  it('ranks live appendix cards by enterprise business impact with risk-axis coverage', () => {
    const service = read('src/services/enterprise-risk.ts');
    const compareBody = service.match(/function compareLiveEvents[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(service, /businessImpactScore/);
    assert.match(service, /businessScenarioFitScore/);
    assert.match(service, /businessTransmissionScore/);
    assert.match(service, /businessLineExposureScore/);
    assert.match(service, /riskAxisImpactScore/);
    assert.match(service, /sourceConfidenceScore/);
    assert.match(service, /MIN_BUSINESS_TRANSMISSION_SCORE/);
    assert.match(service, /GENERIC_LOW_TRANSMISSION_PATTERNS/);
    assert.match(service, /PRODUCT_COMPONENT_KEYWORDS/);
    assert.match(service, /HARD_COMPLIANCE_KEYWORDS/);
    assert.match(service, /FX_TRANSMISSION_KEYWORDS/);
    assert.match(service, /transmissionScore >= MIN_BUSINESS_TRANSMISSION_SCORE/);
    assert.match(service, /MIN_SEA_IMPACT_SCORE/);
    assert.match(service, /filter\(hasBusinessTransmission\)/);
    assert.match(service, /selectLiveEvents/);
    assert.match(service, /LIVE_RISK_AXIS_ORDER:\s*EnterpriseRiskTag\[\]\s*=\s*\['regulatory', 'supply_chain', 'financial_fx', 'geopolitical'\]/);
    assert.match(service, /businessImpactScore\(event\) >= MIN_AXIS_COVERAGE_SCORE/);
    assert.match(service, /liveRiskAxisScore\(event, axis\) >= MIN_AXIS_COVERAGE_SCORE/);
    assert.match(service, /const liveAppendix = selectLiveEvents\(liveCandidates, MAX_LIVE_APPENDIX\)/);
    assert.match(service, /consumer rules\?/);
    assert.match(service, /trump tariffs\?/);
    assert.match(service, /oil price\\b\(\?!\.\*\\b\(freight\|shipping\|suez\|red sea\|malacca\|container\|export margin\|fuel surcharge\)\\b\)/);

    assert.ok(compareBody, 'compareLiveEvents function is missing');
    assert.doesNotMatch(compareBody, /occurredAt/);
    assert.doesNotMatch(compareBody, /location/);
  });

  it('keeps Qwen batch enrichment alive across local refreshes', () => {
    const loader = read('src/app/data-loader.ts');
    const client = read('src/services/enterprise-risk-agent-client.ts');

    assert.match(loader, /if \(!options\.runAgent \|\| assessment\.events\.length === 0\) return;\s+const runId = \+\+this\.enterpriseRiskAgentRunId/s);
    assert.match(client, /const requestedEvents = assessment\.events\.slice\(0, 7\)/);
    assert.match(client, /fetchEnterpriseRiskAgentSingle\(assessment, event\)/);
    assert.doesNotMatch(client, /fetchEnterpriseRiskAgentSingle\(assessment, event, controller\.signal\)/);
    assert.match(client, /batch coverage/);
  });

  it('feeds enterprise risk with Southeast Asia supply-chain coverage', () => {
    const serverFeeds = read('server/worldmonitor/news/v1/_feeds.ts');
    const loader = read('src/app/data-loader.ts');
    const service = read('src/services/enterprise-risk.ts');

    assert.match(serverFeeds, /'southeast-asia'/);
    assert.match(serverFeeds, /SEA Export Supply Chain/);
    assert.match(serverFeeds, /Vietnam Manufacturing/);
    assert.match(serverFeeds, /Thailand Manufacturing/);
    assert.match(serverFeeds, /Indonesia EV Materials/);
    assert.match(serverFeeds, /Malacca Shipping/);
    assert.match(loader, /'southeast-asia'/);
    assert.match(service, /isSoutheastAsiaBusinessEvent/);
    assert.match(service, /MIN_SEA_COVERAGE_SCORE/);
    assert.match(service, /MAX_SEA_LIVE_EVENTS = 1/);
    assert.match(service, /selectedSeaCount >= MAX_SEA_LIVE_EVENTS/);
  });
});
