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
  delta: number;       // 与上周相比变化
  items: RiskItem[];
}

interface RiskEvent {
  time: string;
  category: string;
  categoryColor: string;
  message: string;
  level: 'critical' | 'high' | 'medium';
}

// 模拟企业风险数据
const RISK_DATA: RiskCategory[] = [
  {
    id: 'geopolitical',
    title: '地缘政治风险',
    icon: '🌐',
    score: 72,
    delta: +8,
    items: [
      { label: '中东局势紧张', value: '高风险', trend: 'up', severity: 'critical' },
      { label: '俄乌冲突影响', value: '持续中', trend: 'stable', severity: 'high' },
      { label: '台海贸易航线', value: '需关注', trend: 'up', severity: 'high' },
      { label: '东南亚政治稳定性', value: '中等', trend: 'stable', severity: 'medium' },
    ],
  },
  {
    id: 'supply-chain',
    title: '供应链中断风险',
    icon: '🔗',
    score: 58,
    delta: -4,
    items: [
      { label: '红海航线绕行', value: '持续中', trend: 'stable', severity: 'critical' },
      { label: '关键原材料库存', value: '低（-12%）', trend: 'down', severity: 'high' },
      { label: '港口拥堵指数', value: '上海/宁波', trend: 'up', severity: 'medium' },
      { label: '物流成本指数', value: '同比 +23%', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'compliance',
    title: '合规与政策风险',
    icon: '📋',
    score: 45,
    delta: +12,
    items: [
      { label: '欧盟CBAM碳边境税', value: '2026全面实施', trend: 'up', severity: 'critical' },
      { label: '美国出口管制更新', value: '芯片/AI设备', trend: 'up', severity: 'high' },
      { label: '目标市场劳动法', value: '3项待审核', trend: 'stable', severity: 'medium' },
      { label: '数据本地化要求', value: '印度/越南', trend: 'up', severity: 'medium' },
    ],
  },
  {
    id: 'fx',
    title: '汇率波动风险',
    icon: '💱',
    score: 38,
    delta: -6,
    items: [
      { label: '美元/人民币波动', value: '7.24 ±0.08', trend: 'stable', severity: 'medium' },
      { label: '越南盾 VND', value: '本月 -3.2%', trend: 'down', severity: 'high' },
      { label: '印度卢比 INR', value: '本月 -1.8%', trend: 'down', severity: 'medium' },
      { label: '欧元 EUR/USD', value: '1.082 稳定', trend: 'stable', severity: 'low' },
    ],
  },
];

// 模拟实时风险事件流
const EVENT_POOL: Omit<RiskEvent, 'time'>[] = [
  { category: '地缘政治', categoryColor: '#ef4444', message: '中东局势升级 —— 霍尔木兹海峡运输风险上升', level: 'critical' },
  { category: '供应链', categoryColor: '#f97316', message: '红海绕行导致欧洲航线延误增加14天', level: 'high' },
  { category: '合规政策', categoryColor: '#eab308', message: 'CBAM碳关税申报窗口开启 —— 越南工厂需提交排放数据', level: 'high' },
  { category: '汇率风险', categoryColor: '#22d3a0', message: '越南盾日内跌超1.2% —— 工厂汇率敞口扩大', level: 'medium' },
  { category: '地缘政治', categoryColor: '#ef4444', message: '东南亚多国临近选举 —— 政策不确定性上升', level: 'high' },
  { category: '供应链', categoryColor: '#f97316', message: '宁波港集装箱积压指数创六个月新高', level: 'high' },
  { category: '合规政策', categoryColor: '#eab308', message: '印度数据本地化法规生效 —— 系统需在90天内完成整改', level: 'critical' },
  { category: '汇率风险', categoryColor: '#22d3a0', message: '印度卢比跌破84兑美元 —— 海外利润回流承压', level: 'medium' },
  { category: '地缘政治', categoryColor: '#ef4444', message: '美国扩大出口管制名单 —— 新增12类工业设备', level: 'critical' },
  { category: '供应链', categoryColor: '#f97316', message: '锂现货价格周涨8.3% —— 库存告急', level: 'critical' },
  { category: '合规政策', categoryColor: '#eab308', message: '欧盟CSRD可持续披露要求扩展至供应商', level: 'medium' },
  { category: '汇率风险', categoryColor: '#22d3a0', message: 'EUR/USD突破1.09 —— 欧洲应收账款汇兑收益改善', level: 'medium' },
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

// 数字动态增长动画
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
      title: '企业风险地图',
      className: 'panel-wide',
      closable: true,
      collapsible: true,
      infoTooltip:
        '<strong>企业风险地图</strong> 实时聚合地缘政治、供应链、合规政策及汇率风险信号，用于海外先进制造企业风险监测。',
    });

    this.render();

    // 每60秒刷新卡片
    this.refreshTimer = setInterval(() => this.refreshCards(), 60_000);

    // 每2.5秒推送一个新事件
    this.eventTimer = setInterval(() => this.pushEvent(), 2_500);
  }

  private render(): void {
    this.content.innerHTML = '';
    this.content.className = 'panel-content enterprise-risk-content';

    // 风险卡片区域
    const grid = document.createElement('div');
    grid.className = 'enterprise-risk-grid';

    for (const cat of RISK_DATA) {
      grid.appendChild(this.buildCard(cat));
    }

    this.content.appendChild(grid);

    // 实时事件流
    const feedSection = document.createElement('div');
    feedSection.className = 'risk-feed-section';

    const feedHeader = document.createElement('div');
    feedHeader.className = 'risk-feed-header';

    feedHeader.innerHTML = `
      <span class="risk-feed-pulse"></span>
      <span class="risk-feed-title">实时风险事件流</span>
      <span class="risk-feed-badge">实时</span>
    `;

    const feedList = document.createElement('div');
    feedList.className = 'risk-feed-list';

    this.feedEl = feedList;

    feedSection.appendChild(feedHeader);
    feedSection.appendChild(feedList);

    this.content.appendChild(feedSection);

    // 初始化3条事件
    for (let i = 0; i < 3; i++) {
      const idx = (EVENT_POOL.length - 3 + i) % EVENT_POOL.length;
      const ev = EVENT_POOL[idx];

      if (ev) {
        feedList.appendChild(this.buildEventRow(ev, false));
      }
    }

    this.eventIndex = 0;
  }

  private buildCard(cat: RiskCategory): HTMLElement {
    const card = document.createElement('div');
    card.className = 'enterprise-risk-card';

    const color = scoreColor(cat.score);

    const deltaStr = deltaLabel(cat.delta);

    const deltaClass =
      cat.delta > 0
        ? 'risk-delta-up'
        : cat.delta < 0
        ? 'risk-delta-down'
        : 'risk-delta-stable';

    // 卡片头部
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

    header.insertAdjacentHTML(
      'beforeend',
      `<span class="enterprise-risk-delta ${deltaClass}">${deltaStr}</span>`
    );

    // 风险进度条
    const barWrap = document.createElement('div');
    barWrap.className = 'enterprise-risk-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'enterprise-risk-bar';
    bar.style.width = '0%';
    bar.style.background = color;

    barWrap.appendChild(bar);

    // 风险项列表
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

    // 动画效果
    requestAnimationFrame(() => {
      animateCount(scoreEl, cat.score, 1000);

      bar.style.transition =
        'width 1s cubic-bezier(0.22, 1, 0.36, 1)';

      bar.style.width = `${cat.score}%`;
    });

    return card;
  }

  // 仅刷新卡片
  private refreshCards(): void {
    const grid = this.content.querySelector('.enterprise-risk-grid');

    if (!grid) return;

    grid.innerHTML = '';

    for (const cat of RISK_DATA) {
      grid.appendChild(this.buildCard(cat));
    }
  }

  private buildEventRow(
    ev: Omit<RiskEvent, 'time'>,
    animate: boolean
  ): HTMLElement {
    const row = document.createElement('div');

    row.className =
      'risk-feed-row' + (animate ? ' risk-feed-row-enter' : '');

    const levelDot = document.createElement('span');
    levelDot.className = 'risk-feed-dot';
    levelDot.style.background = ev.categoryColor;

    if (ev.level === 'critical') {
      levelDot.classList.add('risk-feed-dot-pulse');
    }

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

    // 最多保留8条
    while (this.feedEl.children.length > 8) {
      this.feedEl.removeChild(this.feedEl.lastChild!);
    }
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.eventTimer) {
      clearInterval(this.eventTimer);
      this.eventTimer = null;
    }

    super.destroy();
  }
}