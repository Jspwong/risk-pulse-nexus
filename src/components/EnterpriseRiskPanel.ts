import { Panel } from './Panel';

interface RiskItem {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface RiskCategory {
  id: string;
  title: string;
  icon: string;
  score: number;       // 0-100
  delta: number;       // change vs last week
  items: RiskItem[];
}

interface RiskEvent {
  time: string;
  category: string;
  categoryColor: string;
  message: string;
  level: 'critical' | 'high' | 'medium';
}

// Simulated enterprise risk data for demo
const RISK_DATA: RiskCategory[] = [
  {
    id: 'geopolitical',
    title: 'Geopolitical Risk',
    icon: '🌐',
    score: 72,
    delta: +8,
    items: [
      { label: 'Middle East Tension', value: 'High', trend: 'up', severity: 'critical' },
      { label: 'Russia-Ukraine Impact', value: 'Ongoing', trend: 'stable', severity: 'high' },
      { label: 'Taiwan Strait Trade Route', value: 'Watch', trend: 'up', severity: 'high' },
      { label: 'SE Asia Political Stability', value: 'Moderate', trend: 'stable', severity: 'medium' },
    ],
  },
  {
    id: 'supply-chain',
    title: 'Supply Chain Disruption',
    icon: '🔗',
    score: 58,
    delta: -4,
    items: [
      { label: 'Red Sea Rerouting', value: 'Ongoing', trend: 'stable', severity: 'critical' },
      { label: 'Key Raw Material Stock', value: 'Low (-12%)', trend: 'down', severity: 'high' },
      { label: 'Port Congestion Index', value: 'Shanghai/Ningbo', trend: 'up', severity: 'medium' },
      { label: 'Logistics Cost Index', value: '+23% YoY', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance & Policy',
    icon: '📋',
    score: 45,
    delta: +12,
    items: [
      { label: 'EU Carbon Border Tax CBAM', value: 'Full rollout 2026', trend: 'up', severity: 'critical' },
      { label: 'US Export Control Update', value: 'Chips/AI Equipment', trend: 'up', severity: 'high' },
      { label: 'Target Market Labor Laws', value: '3 Pending Review', trend: 'stable', severity: 'medium' },
      { label: 'Data Localization Requirements', value: 'India/Vietnam', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'fx',
    title: 'FX Volatility',
    icon: '💱',
    score: 38,
    delta: -6,
    items: [
      { label: 'USD/CNY Volatility', value: '7.24 ±0.08', trend: 'stable', severity: 'medium' },
      { label: 'Vietnamese Dong VND', value: '-3.2% MTD', trend: 'down', severity: 'high' },
      { label: 'Indian Rupee INR', value: '-1.8% MTD', trend: 'down', severity: 'medium' },
      { label: 'Euro EUR/USD', value: '1.082 Stable', trend: 'stable', severity: 'low' },
    ],
  },
];

// Simulated live risk event feed
const EVENT_POOL: Omit<RiskEvent, 'time'>[] = [
  { category: 'Geopolitical', categoryColor: '#ef4444', message: 'Middle East escalation — Strait of Hormuz transit risk rising', level: 'critical' },
  { category: 'Supply Chain', categoryColor: '#f97316', message: 'Red Sea rerouting causes +14-day delays on Europe routes', level: 'high' },
  { category: 'Compliance', categoryColor: '#eab308', message: 'CBAM carbon tariff filing window open — Vietnam factories must submit emissions data', level: 'high' },
  { category: 'FX', categoryColor: '#22d3a0', message: 'VND fell >1.2% intraday — Vietnam factory FX exposure widening', level: 'medium' },
  { category: 'Geopolitical', categoryColor: '#ef4444', message: 'Multiple SE Asia elections approaching — policy uncertainty rising', level: 'high' },
  { category: 'Supply Chain', categoryColor: '#f97316', message: 'Ningbo port container backlog index hits 6-month high', level: 'high' },
  { category: 'Compliance', categoryColor: '#eab308', message: 'India data localization rules in effect — systems must comply within 90 days', level: 'critical' },
  { category: 'FX', categoryColor: '#22d3a0', message: 'INR breaks 84 vs USD — India subsidiary profit repatriation under pressure', level: 'medium' },
  { category: 'Geopolitical', categoryColor: '#ef4444', message: 'US export control list expanded — 12 new industrial equipment categories added', level: 'critical' },
  { category: 'Supply Chain', categoryColor: '#f97316', message: 'Lithium spot price +8.3% WoW — inventory critically low', level: 'critical' },
  { category: 'Compliance', categoryColor: '#eab308', message: 'EU CSRD sustainability reporting requirements extended to suppliers', level: 'medium' },
  { category: 'FX', categoryColor: '#22d3a0', message: 'EUR/USD breaks 1.09 — European receivables FX gains improving', level: 'medium' },
];

function severityColor(s: RiskItem['severity']): string {
  return { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' }[s];
}

function scoreColor(score: number): string {
  if (score >= 70) return '#ef4444';
  if (score >= 50) return '#f97316';
  if (score >= 30) return '#eab308';
  return '#22c55e';
}

function trendArrow(trend: RiskItem['trend']): string {
  return { up: '↑', down: '↓', stable: '→' }[trend];
}

function deltaLabel(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// Animate a number counting up from 0 to target
function animateCount(el: HTMLElement, target: number, duration = 900): void {
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export class EnterpriseRiskPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private eventTimer: ReturnType<typeof setInterval> | null = null;
  private feedEl: HTMLElement | null = null;
  private eventIndex = 0;

  constructor() {
    super({
      id: 'live-webcams',
      title: 'Enterprise Risk Map',
      className: 'panel-wide',
      closable: true,
      collapsible: true,
      infoTooltip: '<strong>Enterprise Risk Map</strong> Real-time aggregation of geopolitical, supply chain, compliance, and FX risk signals for advanced manufacturing companies operating overseas.',
    });
    this.render();
    // Refresh cards every 60s
    this.refreshTimer = setInterval(() => this.refreshCards(), 60_000);
    // Push a new event every 2.5s
    this.eventTimer = setInterval(() => this.pushEvent(), 2_500);
  }

  private render(): void {
    this.content.innerHTML = '';
    this.content.className = 'panel-content enterprise-risk-content';

    // ── Risk cards grid ──────────────────────────────────────────
    const grid = document.createElement('div');
    grid.className = 'enterprise-risk-grid';
    for (const cat of RISK_DATA) {
      grid.appendChild(this.buildCard(cat));
    }
    this.content.appendChild(grid);

    // ── Live event feed ──────────────────────────────────────────
    const feedSection = document.createElement('div');
    feedSection.className = 'risk-feed-section';

    const feedHeader = document.createElement('div');
    feedHeader.className = 'risk-feed-header';
    feedHeader.innerHTML = `
      <span class="risk-feed-pulse"></span>
      <span class="risk-feed-title">Live Risk Event Feed</span>
      <span class="risk-feed-badge">LIVE</span>
    `;

    const feedList = document.createElement('div');
    feedList.className = 'risk-feed-list';
    this.feedEl = feedList;

    feedSection.appendChild(feedHeader);
    feedSection.appendChild(feedList);
    this.content.appendChild(feedSection);

    // Seed with 3 initial events (no animation, instant)
    for (let i = 0; i < 3; i++) {
      const idx = (EVENT_POOL.length - 3 + i) % EVENT_POOL.length;
      const ev = EVENT_POOL[idx];
      if (ev) feedList.appendChild(this.buildEventRow(ev, false));
    }
    this.eventIndex = 0;
  }

  private buildCard(cat: RiskCategory): HTMLElement {
    const card = document.createElement('div');
    card.className = 'enterprise-risk-card';

    const color = scoreColor(cat.score);
    const deltaStr = deltaLabel(cat.delta);
    const deltaClass = cat.delta > 0 ? 'risk-delta-up' : cat.delta < 0 ? 'risk-delta-down' : 'risk-delta-stable';

    // Header
    const header = document.createElement('div');
    header.className = 'enterprise-risk-card-header';

    const scoreEl = document.createElement('span');
    scoreEl.className = 'enterprise-risk-score';
    scoreEl.style.color = color;
    scoreEl.textContent = '0';

    header.innerHTML = `
      <span class="enterprise-risk-icon">${cat.icon}</span>
      <span class="enterprise-risk-title">${cat.title}</span>
    `;
    header.appendChild(scoreEl);
    header.insertAdjacentHTML('beforeend', `<span class="enterprise-risk-delta ${deltaClass}">${deltaStr}</span>`);

    // Score bar — starts at 0, animates to target
    const barWrap = document.createElement('div');
    barWrap.className = 'enterprise-risk-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'enterprise-risk-bar';
    bar.style.width = '0%';
    bar.style.background = color;
    barWrap.appendChild(bar);

    // Items list
    const list = document.createElement('ul');
    list.className = 'enterprise-risk-items';
    for (const item of cat.items) {
      const li = document.createElement('li');
      li.className = 'enterprise-risk-item';
      li.innerHTML = `
        <span class="enterprise-risk-dot" style="background:${severityColor(item.severity)}"></span>
        <span class="enterprise-risk-item-label">${item.label}</span>
        <span class="enterprise-risk-item-value">${trendArrow(item.trend)} ${item.value}</span>
      `;
      list.appendChild(li);
    }

    card.appendChild(header);
    card.appendChild(barWrap);
    card.appendChild(list);

    // Trigger animations after paint
    requestAnimationFrame(() => {
      animateCount(scoreEl, cat.score, 1000);
      // Bar grows with CSS transition
      bar.style.transition = 'width 1s cubic-bezier(0.22, 1, 0.36, 1)';
      bar.style.width = `${cat.score}%`;
    });

    return card;
  }

  // Re-render only the cards (not the feed) on 60s refresh
  private refreshCards(): void {
    const grid = this.content.querySelector('.enterprise-risk-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const cat of RISK_DATA) {
      grid.appendChild(this.buildCard(cat));
    }
  }

  private buildEventRow(ev: Omit<RiskEvent, 'time'>, animate: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'risk-feed-row' + (animate ? ' risk-feed-row-enter' : '');

    const levelDot = document.createElement('span');
    levelDot.className = 'risk-feed-dot';
    levelDot.style.background = ev.categoryColor;
    if (ev.level === 'critical') levelDot.classList.add('risk-feed-dot-pulse');

    const time = document.createElement('span');
    time.className = 'risk-feed-time';
    time.textContent = nowHHMM();

    const cat = document.createElement('span');
    cat.className = 'risk-feed-cat';
    cat.style.color = ev.categoryColor;
    cat.textContent = `[${ev.category}]`;

    const msg = document.createElement('span');
    msg.className = 'risk-feed-msg';
    msg.textContent = ev.message;

    row.appendChild(levelDot);
    row.appendChild(time);
    row.appendChild(cat);
    row.appendChild(msg);
    return row;
  }

  private pushEvent(): void {
    if (!this.feedEl) return;
    const ev = EVENT_POOL[this.eventIndex % EVENT_POOL.length];
    if (!ev) return;
    this.eventIndex++;

    const row = this.buildEventRow(ev, true);
    this.feedEl.insertBefore(row, this.feedEl.firstChild);

    // Trim to max 8 rows
    while (this.feedEl.children.length > 8) {
      this.feedEl.removeChild(this.feedEl.lastChild!);
    }
  }

  public destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.eventTimer) { clearInterval(this.eventTimer); this.eventTimer = null; }
    super.destroy();
  }
}
