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
    title: '地缘政治风险',
    icon: '🌐',
    score: 72,
    delta: +8,
    items: [
      { label: '中东局势紧张度', value: '高', trend: 'up', severity: 'critical' },
      { label: '俄乌冲突影响', value: '持续', trend: 'stable', severity: 'high' },
      { label: '台海贸易通道', value: '关注', trend: 'up', severity: 'high' },
      { label: '东南亚政治稳定', value: '中等', trend: 'stable', severity: 'medium' },
    ],
  },
  {
    id: 'supply-chain',
    title: '供应链中断',
    icon: '🔗',
    score: 58,
    delta: -4,
    items: [
      { label: '红海航运绕行', value: '仍在持续', trend: 'stable', severity: 'critical' },
      { label: '关键原材料库存', value: '偏低 (-12%)', trend: 'down', severity: 'high' },
      { label: '港口拥堵指数', value: '上海/宁波', trend: 'up', severity: 'medium' },
      { label: '物流成本指数', value: '+23% YoY', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'compliance',
    title: '合规政策变化',
    icon: '📋',
    score: 45,
    delta: +12,
    items: [
      { label: '欧盟碳边境税 CBAM', value: '2026年全面实施', trend: 'up', severity: 'critical' },
      { label: '美国出口管制更新', value: '芯片/AI设备', trend: 'up', severity: 'high' },
      { label: '目标市场劳工法规', value: '3项待审', trend: 'stable', severity: 'medium' },
      { label: '数据本地化要求', value: '印度/越南', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'fx',
    title: '汇率异动',
    icon: '💱',
    score: 38,
    delta: -6,
    items: [
      { label: 'USD/CNY 波动', value: '7.24 ±0.08', trend: 'stable', severity: 'medium' },
      { label: '越南盾 VND', value: '-3.2% MTD', trend: 'down', severity: 'high' },
      { label: '印度卢比 INR', value: '-1.8% MTD', trend: 'down', severity: 'medium' },
      { label: '欧元 EUR/USD', value: '1.082 稳定', trend: 'stable', severity: 'low' },
    ],
  },
];

// Simulated live risk event feed
const EVENT_POOL: Omit<RiskEvent, 'time'>[] = [
  { category: '地缘政治', categoryColor: '#ef4444', message: '中东局势升级 — 霍尔木兹海峡通行风险上升', level: 'critical' },
  { category: '供应链', categoryColor: '#f97316', message: '红海绕行导致欧洲航线延误 +14天', level: 'high' },
  { category: '合规', categoryColor: '#eab308', message: 'CBAM碳关税申报窗口开启，越南工厂需提交碳排放数据', level: 'high' },
  { category: '汇率', categoryColor: '#22d3a0', message: 'VND单日跌幅超1.2%，越南工厂结汇敞口扩大', level: 'medium' },
  { category: '地缘政治', categoryColor: '#ef4444', message: '东南亚多国大选临近，政策不确定性上升', level: 'high' },
  { category: '供应链', categoryColor: '#f97316', message: '宁波港集装箱积压指数达近6个月高点', level: 'high' },
  { category: '合规', categoryColor: '#eab308', message: '印度数据本地化新规生效，系统合规改造需在90天内完成', level: 'critical' },
  { category: '汇率', categoryColor: '#22d3a0', message: 'INR兑美元跌破84关口，印度子公司利润折算受压', level: 'medium' },
  { category: '地缘政治', categoryColor: '#ef4444', message: '美国对华出口管制清单扩容，新增12类工业设备', level: 'critical' },
  { category: '供应链', categoryColor: '#f97316', message: '锂矿原材料现货价格周涨幅+8.3%，库存告急', level: 'critical' },
  { category: '合规', categoryColor: '#eab308', message: '欧盟CSRD企业可持续发展报告要求延伸至供应商', level: 'medium' },
  { category: '汇率', categoryColor: '#22d3a0', message: 'EUR/USD突破1.09，欧洲应收账款汇兑收益改善', level: 'medium' },
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
      title: '企业内部风险映射',
      className: 'panel-wide',
      closable: true,
      collapsible: true,
      infoTooltip: '<strong>企业内部风险映射</strong> 针对先进制造业出海企业，实时聚合地缘政治、供应链、合规政策与汇率四大维度风险信号，辅助管理层快速研判海外运营风险敞口。',
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
      <span class="risk-feed-title">实时风险事件流</span>
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
      feedList.appendChild(this.buildEventRow(EVENT_POOL[idx], false));
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
