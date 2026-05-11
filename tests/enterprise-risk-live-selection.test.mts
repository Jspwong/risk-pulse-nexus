import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEnterpriseRiskAssessment } from '@/services/enterprise-risk';
import type { EnterpriseRiskInputs } from '@/types/enterprise-risk';
import type { ClusteredEvent, NewsItem } from '@/types';

if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as typeof globalThis & { CustomEvent: typeof CustomEvent }).CustomEvent = class CustomEvent<T = unknown> {
    readonly type: string;
    readonly detail: T | undefined;

    constructor(type: string, init?: CustomEventInit<T>) {
      this.type = type;
      this.detail = init?.detail;
    }
  } as typeof CustomEvent;
}

(globalThis as typeof globalThis & { document: { dispatchEvent: () => boolean } }).document = {
  dispatchEvent: () => true,
};

function news(title: string, snippet = title): NewsItem {
  return {
    source: 'Selection Fixture',
    title,
    link: `https://example.test/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    pubDate: new Date(Date.now() - 30 * 60_000),
    isAlert: true,
    threat: {
      level: 'high',
      category: 'economic',
      confidence: 0.88,
      source: 'keyword',
    },
    importanceScore: 72,
    corroborationCount: 2,
    storyMeta: {
      firstSeen: Date.now() - 45 * 60_000,
      mentionCount: 3,
      sourceCount: 2,
      phase: 'developing',
    },
    snippet,
  };
}

function cluster(primaryTitle: string, primarySource = 'Vietnam Manufacturing'): ClusteredEvent {
  const item = news(primaryTitle);
  return {
    id: `cluster-${primaryTitle.toLowerCase().replace(/\s+/g, '-')}`,
    primaryTitle,
    primarySource,
    primaryLink: `https://example.test/${encodeURIComponent(primaryTitle.toLowerCase().replace(/\s+/g, '-'))}`,
    sourceCount: 1,
    topSources: [{ name: primarySource, tier: 2, url: `https://example.test/${primarySource}` }],
    allItems: [item],
    firstSeen: new Date(Date.now() - 45 * 60_000),
    lastUpdated: new Date(Date.now() - 30 * 60_000),
    isAlert: true,
    threat: {
      level: 'medium',
      category: 'economic',
      confidence: 0.72,
      source: 'keyword',
    },
  };
}

describe('enterprise risk live appendix selection', () => {
  it('prefers concrete new-energy export transmission over generic tariff and oil headlines', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('European carmakers take EUR8bn hit from Trump tariffs'),
        news('Week in review: Big oil bets, jobs and tariffs'),
        news('US businesses urge Trump to intervene over new EU consumer rules'),
        news('Oil price edges lower as Trump pauses Strait of Hormuz Project Freedom'),
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
      ],
      clusters: [],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.ok(liveTitles.some(title => title.includes('CBAM embedded emissions')));
    assert.ok(liveTitles.some(title => title.includes('Red Sea Suez')));
    assert.ok(liveTitles.some(title => title.includes('Vietnam dong VND')));
    assert.ok(liveTitles.some(title => title.includes('freight fuel surcharge')));

    assert.equal(liveTitles.some(title => title.includes('Trump tariffs')), false);
    assert.equal(liveTitles.some(title => title.includes('consumer rules')), false);
    assert.equal(liveTitles.some(title => title.includes('Oil price edges lower')), false);
    assert.equal(liveTitles.some(title => title.includes('Week in review')), false);
  });

  it('deduplicates similar live events across sources and wording variants', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news(
          'EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters - Reuters',
          'European customs teams tighten CBAM embedded emissions checks for aluminum battery tray exporters.',
        ),
        news(
          'Battery tray exporters face EU carbon border emissions audit deadline - Financial Times',
          'CBAM customs declaration pressure rises for aluminum battery tray export contracts into Europe.',
        ),
        news(
          'Red Sea Suez container reroute delays battery tray exports to Rotterdam - Reuters',
          'Suez and Red Sea rerouting delays Asia-Europe container freight for battery tray exports.',
        ),
        news(
          'Asia-Europe freight delays widen as Red Sea rerouting hits Rotterdam battery tray cargo - FT',
          'Red Sea Suez reroute pressure delays container freight for Europe battery tray cargo.',
        ),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
      ],
      clusters: [],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.equal(liveTitles.filter(title => /CBAM|carbon border/i.test(title)).length, 1);
    assert.equal(liveTitles.filter(title => /Red Sea|rerout/i.test(title)).length, 1);
    assert.ok(liveTitles.some(title => title.includes('Vietnam dong VND')));
    assert.ok(liveTitles.some(title => title.includes('freight fuel surcharge')));
  });

  it('deduplicates same Iran proposal story when one card has a longer maritime summary', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news(
          "Trump says Iran response to US ceasefire proposal 'totally unacceptable'",
          'Iran warned against a French-British effort to support maritime security in the Strait of Hormuz, raising freight fuel surcharge risk for Asia-Europe container exports.',
        ),
        news(
          "Trump calls Iran's response to US peace proposal 'totally unacceptable'",
          'Iran rejected the latest US peace proposal, keeping Strait of Hormuz maritime security and shipping risk in focus for export freight.',
        ),
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
      ],
      clusters: [],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.filter(title => /totally unacceptable/i.test(title)).length, 1);
  });

  it('keeps one Southeast Asia card when it has concrete enterprise transmission', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
        news('European battery regulation traceability audit affects aluminum EV battery enclosure customs filings'),
        news(
          'Ho Chi Minh suppliers warn Vietnam dong move will squeeze storage cabinet export margin',
          'Vietnam VND volatility affects Ho Chi Minh suppliers, Hai Phong logistics, receivables, and export margin for energy storage cabinet components.',
        ),
        news(
          'Vietnam dong, gold rates - May 8 - TradingView',
          'Vietnam dong and gold rates market quote from TradingView.',
        ),
        news(
          'Bangkok tourism arrivals rise before regional holiday',
          'Thailand tourism demand rises before a regional holiday period.',
        ),
      ],
      clusters: [],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.ok(liveTitles.some(title => /Ho Chi Minh|Vietnam dong/i.test(title)));
    assert.equal(liveTitles.some(title => /TradingView|gold rates/i.test(title)), false);
    assert.equal(liveTitles.some(title => /tourism arrivals/i.test(title)), false);
  });

  it('rejects static reference pages even when clustered under a relevant feed', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
      ],
      clusters: [
        cluster('World Trade Organization | International Trade Rules & Regulations - Britannica'),
      ],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.equal(liveTitles.some(title => /Britannica|World Trade Organization/i.test(title)), false);
  });

  it('uses clustered article snippets so generic cluster titles do not hide real route shocks', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
      ],
      clusters: [{
        ...cluster('Companies brace after latest security talks', 'Global Wire'),
        allItems: [
          news(
            'Companies brace after latest security talks',
            'Iran warned over maritime security in the Strait of Hormuz, raising freight fuel surcharge risk for Asia-Europe container exports.',
          ),
        ],
      }],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.ok(liveTitles.some(title => /security talks/i.test(title)));
  });

  it('does not reserve a slot for a weak Southeast Asia headline when stronger axes are available', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
        news('European battery regulation traceability audit affects aluminum EV battery enclosure customs filings'),
        news(
          'Bangkok port tourism logistics delay hits regional holiday transfers',
          'Thailand tourism and airport transfers face a delay during the regional holiday period.',
        ),
      ],
      clusters: [],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.equal(liveTitles.some(title => /tourism logistics/i.test(title)), false);
  });

  it('rejects macro commodity and inflation headlines without direct enterprise transmission', () => {
    const inputs: EnterpriseRiskInputs = {
      news: [
        news('EU CBAM embedded emissions audit deadline raises customs risk for aluminum battery tray exporters'),
        news('Red Sea Suez container reroute delays battery tray exports to Rotterdam'),
        news('Strait of Hormuz attack raises freight fuel surcharge for Asia-Europe container exports'),
        news('Vietnam dong VND exchange rate move squeezes Ho Chi Minh suppliers export margin'),
      ],
      clusters: [
        cluster('China energy imports drop in April amid Iran war as fuel exports hit decade low - Reuters', 'Reuters Energy'),
        cluster('Gold slips as war uncertainty clouds interest rate outlook - Reuters', 'Reuters US'),
        cluster('Indonesia delays plan to impose higher royalties, export duties on minerals - Reuters', 'Reuters Indonesia'),
        cluster("China's factory inflation hits 45-month high on energy price shock - Reuters", 'Reuters China'),
      ],
    };

    const assessment = buildEnterpriseRiskAssessment(inputs);
    const liveTitles = assessment.events
      .filter(event => !event.isDemoSeed)
      .map(event => event.title);

    assert.equal(liveTitles.length, 4);
    assert.equal(liveTitles.some(title => /energy imports drop/i.test(title)), false);
    assert.equal(liveTitles.some(title => /Gold slips/i.test(title)), false);
    assert.equal(liveTitles.some(title => /royalties.*minerals/i.test(title)), false);
    assert.equal(liveTitles.some(title => /factory inflation/i.test(title)), false);
  });
});
