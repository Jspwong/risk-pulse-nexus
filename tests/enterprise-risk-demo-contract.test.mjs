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
    assert.match(src, /geopolitical:\s*'地缘政治风险'/);
    assert.match(src, /regulatory:\s*'合规监管风险'/);
    assert.match(src, /supply_chain:\s*'供应链风险'/);
    assert.match(src, /financial_fx:\s*'汇率风险'/);
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
    assert.match(src, /renderSelectedFlow/);
    assert.match(src, /Selected Card Closed Loop/);
    assert.match(src, /感知层/);
    assert.match(src, /识别层/);
    assert.match(src, /传导层/);
    assert.match(src, /响应层/);
    assert.match(src, /evidenceSources/);
    assert.match(src, /er-transmission-list/);
    assert.doesNotMatch(src, /renderLoopStep/);
    assert.doesNotMatch(src, /Internal Mapping · Selected Trigger/);
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
    assert.match(service, /规则层仅作为候选生成和失败兜底/);
    assert.match(loader, /fetchEnterpriseRiskAgentBatch/);
    assert.match(loader, /markEnterpriseRiskAgentRunning/);
    assert.match(loader, /markEnterpriseRiskAgentFallback/);
    assert.match(panel, /Qwen Identification Agent/);
    assert.match(panel, /Qwen Transmission Agent/);
    assert.match(client, /mode:\s*'batch_closed_loop'/);
  });
});
