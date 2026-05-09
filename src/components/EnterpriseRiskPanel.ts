import { Panel } from './Panel';
import type {
  EnterpriseAlert,
  EnterpriseInternalImpact,
  EnterpriseReportSummary,
  EnterpriseRiskAssessment,
  EnterpriseRiskEvent,
  EnterpriseRiskPriority,
  EnterpriseTask,
  EnterpriseTaskStatus,
} from '@/types/enterprise-risk';
import { enterpriseRiskTagLabel } from '@/services/enterprise-risk';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

function priorityClass(priority: EnterpriseRiskPriority): string {
  return priority.toLowerCase();
}

function priorityLabel(priority: EnterpriseRiskPriority): string {
  return priority === 'P1' ? 'P1 Immediate' : priority === 'P2' ? 'P2 Watch' : 'P3 Monitor';
}

function relativeAge(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function estimateEventExposure(event: EnterpriseRiskEvent, impacts: EnterpriseInternalImpact[]): number {
  const baseByPriority = event.priority === 'P1' ? 7_200_000 : event.priority === 'P2' ? 3_600_000 : 1_200_000;
  const departmentFactor = Math.max(1, new Set(impacts.map(impact => impact.department)).size) * 0.18;
  const severityFactor = Math.max(0.3, Math.min(1.15, event.severityScore / 90));
  return Math.round(baseByPriority * departmentFactor * severityFactor);
}

export class EnterpriseRiskPanel extends Panel {
  private assessment: EnterpriseRiskAssessment | null = null;
  private selectedEventId: string | null = null;
  private acknowledgedAlertIds = new Set<string>();
  private taskStatusOverrides = new Map<string, EnterpriseTaskStatus>();
  private readonly acknowledgedStorageKey = 'wm.enterpriseRisk.acknowledgedAlerts';
  private readonly taskStorageKey = 'wm.enterpriseRisk.taskStatusOverrides';

  constructor() {
    super({
      id: 'enterprise-risk',
      title: 'Enterprise Risk Immunity Center',
      className: 'panel-wide col-span-3 enterprise-risk-panel-shell',
      defaultRowSpan: 3,
      closable: true,
      collapsible: true,
      infoTooltip: 'Maps external news, cross-source signals, supply-chain and market data into internal alerts, tasks and report summaries.',
    });
    this.content.addEventListener('click', (event) => this.handleClick(event));
    this.content.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.loadInteractionState();
    this.showLoading('Linking external signals to enterprise response...');
  }

  public setAssessment(assessment: EnterpriseRiskAssessment): void {
    this.assessment = assessment;
    if (!assessment.events.some(event => event.id === this.selectedEventId)) {
      this.selectedEventId = assessment.events[0]?.id ?? null;
    }
    this.setCount?.(assessment.alerts.length);
    const top = assessment.events[0]?.priority;
    this.setSeverity(top === 'P1' ? 'critical' : top === 'P2' ? 'high' : 'medium');
    this.render();
  }

  private render(): void {
    if (!this.assessment) {
      this.showLoading('Waiting for enterprise risk assessment...');
      return;
    }

    const { assessment } = this;
    const selectedEvent = this.getSelectedEvent();
    const visibleImpacts = this.getVisibleImpacts();
    const visibleAlerts = this.getVisibleAlerts();
    const visibleTasks = this.getVisibleTasks();
    const selectedReport = this.buildSelectedReport(assessment.report, selectedEvent, visibleImpacts, visibleTasks);
    const pinnedEvents = assessment.events.filter(event => event.isDemoSeed);
    const liveEvents = assessment.events.filter(event => !event.isDemoSeed);
    const rssCoverage = assessment.sourceCoverage.find(source => source.id === 'rss');
    const p1Count = assessment.alerts.filter(alert => alert.priority === 'P1').length;
    const activeTaskCount = assessment.tasks.filter(task => this.getTaskStatus(task) !== 'done').length;
    const liveSources = assessment.sourceCoverage.filter(source => source.status === 'live').length;

    this.setContent(`
      <div class="enterprise-risk-v2">
        <div class="er-hero">
          <div class="er-hero-main">
            <div class="er-kicker">Clickable closed loop · ${escapeHtml(assessment.profile.scenarioName)}</div>
            <h3>${escapeHtml(assessment.profile.companyName)}</h3>
            <p>${escapeHtml(assessment.profile.primaryNarrative)}</p>
          </div>
          <div class="er-hero-metrics">
            <button class="er-metric er-metric-hot" type="button" data-er-action="select-p1"><span>${p1Count}</span><label>P1 alerts</label></button>
            <button class="er-metric" type="button" data-er-action="focus-tasks"><span>${activeTaskCount}</span><label>active tasks</label></button>
            <button class="er-metric" type="button" data-er-action="focus-report"><span>${formatUsd(selectedReport.financialImpact.exposureUsd)}</span><label>exposure</label></button>
            <div class="er-metric"><span>${liveSources}/${assessment.sourceCoverage.length}</span><label>live sources</label></div>
          </div>
        </div>

        <div class="er-demo-banner">
          Demo 主线固定保留；Live 外部事件最多追加 5 条。识别层和传导层由 Qwen Agent 接管，规则层仅作为候选和失败兜底。
          <span class="er-agent-status er-agent-${escapeHtml(assessment.agentWorkflow.status)}">${escapeHtml(assessment.agentWorkflow.detail)}</span>
        </div>

        ${selectedEvent ? this.renderSelectedFlow(selectedEvent, visibleImpacts, visibleAlerts, visibleTasks, selectedReport) : ''}

        <div class="er-report" id="enterpriseRiskReport">
          <div class="er-section-title">Auto Report Summary</div>
          ${selectedEvent ? `<div class="er-selected-context">Selected trigger: <strong>${escapeHtml(selectedEvent.title)}</strong></div>` : ''}
          <div class="er-report-grid">
            <div><strong>Event summary</strong><p>${escapeHtml(selectedReport.eventSummary)}</p></div>
            <div><strong>Internal impact</strong><p>${escapeHtml(selectedReport.internalImpact)}</p></div>
            <div><strong>Recommended actions</strong><ul>${selectedReport.recommendedActions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul></div>
            <div><strong>Financial impact</strong><p>${escapeHtml(selectedReport.financialImpact.estimate)} <span class="er-confidence">${escapeHtml(selectedReport.financialImpact.confidence)}</span></p></div>
          </div>
        </div>

        <section class="er-section er-section-events er-events-full">
          <div class="er-event-list-head">
            <div>
              <div class="er-section-title">Event List</div>
              <div class="er-event-list-subtitle">Pinned demo storyline + live external context</div>
            </div>
            <span>${assessment.events.length} cards</span>
          </div>
          <div class="er-event-list-grid">
            ${pinnedEvents.map(event => this.renderEvent(event)).join('')}
            ${liveEvents.length ? liveEvents.map(event => this.renderEvent(event)).join('') : `<div class="er-empty">No live risk candidates yet. ${escapeHtml(rssCoverage?.detail ?? 'External feeds are still loading.')}</div>`}
          </div>
        </section>

        <div class="er-footer">
          <div class="er-source-strip">
            ${assessment.sourceCoverage.map(source => `
              <span class="er-source er-source-${source.status}" title="${escapeHtml(source.detail)}">
                ${escapeHtml(source.label)}
              </span>
            `).join('')}
          </div>
          <button class="er-focus-report" type="button" data-er-action="focus-report">Focus report</button>
          <div class="er-updated">Generated ${new Date(assessment.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    `);
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('.er-why')) return;

    const eventCard = target.closest<HTMLElement>('[data-er-event-id]');
    if (eventCard && !target.closest('a,button')) {
      this.selectEvent(eventCard.dataset.erEventId ?? null);
      return;
    }

    const alertButton = target.closest<HTMLButtonElement>('[data-er-alert-id]');
    if (alertButton) {
      const alertId = alertButton.dataset.erAlertId;
      if (alertId) {
        if (this.acknowledgedAlertIds.has(alertId)) this.acknowledgedAlertIds.delete(alertId);
        else this.acknowledgedAlertIds.add(alertId);
        this.persistAcknowledgedAlerts();
        this.render();
      }
      return;
    }

    const taskButton = target.closest<HTMLButtonElement>('[data-er-task-id]');
    if (taskButton) {
      const taskId = taskButton.dataset.erTaskId;
      const baseTask = this.assessment?.tasks.find(task => task.id === taskId);
      if (taskId && baseTask) {
        this.taskStatusOverrides.set(taskId, this.nextTaskStatus(this.getTaskStatus(baseTask)));
        this.persistTaskStatuses();
        this.render();
      }
      return;
    }

    const action = target.closest<HTMLElement>('[data-er-action]')?.dataset.erAction;
    if (action === 'focus-report') {
      this.content.querySelector('#enterpriseRiskReport')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (action === 'focus-tasks') {
      this.content.querySelector('.er-events-full')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (action === 'select-p1') {
      const p1 = this.assessment?.events.find(item => item.priority === 'P1');
      if (p1) this.selectEvent(p1.id);
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    if (target.closest('a,button,.er-why')) return;
    const eventCard = target.closest<HTMLElement>('[data-er-event-id]');
    if (!eventCard) return;
    event.preventDefault();
    this.selectEvent(eventCard.dataset.erEventId ?? null);
  }

  private selectEvent(eventId: string | null): void {
    this.selectedEventId = eventId;
    this.dispatchSelectedEventLocation();
    this.render();
  }

  private dispatchSelectedEventLocation(): void {
    const selected = this.getSelectedEvent();
    if (!selected) return;
    this.element.dispatchEvent(new CustomEvent('wm:enterprise-risk-focus-location', {
      bubbles: true,
      detail: {
        eventId: selected.id,
        title: selected.title,
        location: selected.location,
        impactPath: selected.impactPath,
      },
    }));
  }

  private getSelectedEvent(): EnterpriseRiskEvent | null {
    if (!this.assessment) return null;
    return this.assessment.events.find(event => event.id === this.selectedEventId) ?? this.assessment.events[0] ?? null;
  }

  private getVisibleImpacts(): EnterpriseInternalImpact[] {
    if (!this.assessment) return [];
    const selected = this.getSelectedEvent();
    if (!selected) return this.assessment.impacts;
    return this.assessment.impacts.filter(impact => impact.eventId === selected.id);
  }

  private getVisibleAlerts(): EnterpriseAlert[] {
    if (!this.assessment) return [];
    const selected = this.getSelectedEvent();
    if (!selected) return this.assessment.alerts;
    return this.assessment.alerts.filter(alert => alert.eventId === selected.id);
  }

  private getVisibleTasks(): EnterpriseTask[] {
    if (!this.assessment) return [];
    const selected = this.getSelectedEvent();
    if (!selected) return this.assessment.tasks;
    return this.assessment.tasks.filter(task => task.sourceEventId === selected.id);
  }

  private getTaskStatus(task: EnterpriseTask): EnterpriseTaskStatus {
    return this.taskStatusOverrides.get(task.id) ?? task.status;
  }

  private nextTaskStatus(status: EnterpriseTaskStatus): EnterpriseTaskStatus {
    if (status === 'open') return 'in_progress';
    if (status === 'in_progress') return 'done';
    if (status === 'watching') return 'open';
    return 'open';
  }

  private buildSelectedReport(
    baseReport: EnterpriseReportSummary,
    selectedEvent: EnterpriseRiskEvent | null,
    impacts: EnterpriseInternalImpact[],
    tasks: EnterpriseTask[],
  ): EnterpriseReportSummary {
    if (!selectedEvent) return baseReport;
    const departments = Array.from(new Set(impacts.map(impact => impact.department)));
    const businessLines = Array.from(new Set(impacts.map(impact => impact.businessLineName)));
    const recommendations = tasks.length
      ? tasks.slice(0, 5).map(task => task.title)
      : impacts.slice(0, 4).map(impact => `${impact.department}: ${impact.action}`);
    const exposure = estimateEventExposure(selectedEvent, impacts);
    return {
      ...baseReport,
      id: `report-${selectedEvent.id}`,
      eventSummary: selectedEvent.summary,
      internalImpact: `${selectedEvent.priority} 事件映射到 ${departments.join('、') || '风险办公室'}，影响 ${businessLines.join('、') || '重点业务线'}。`,
      recommendedActions: recommendations.length ? recommendations : ['继续监控该事件，并在下一次数据刷新后复核内部敞口。'],
      financialImpact: {
        exposureUsd: exposure,
        estimate: `按所选事件强度、部门覆盖和业务线敞口估算，短期影响约 ${formatUsd(exposure)}。`,
        confidence: selectedEvent.isDemoSeed ? 'demo_estimate' : 'modeled',
      },
    };
  }

  private loadInteractionState(): void {
    try {
      const rawAlerts = window.localStorage.getItem(this.acknowledgedStorageKey);
      if (rawAlerts) {
        const ids = JSON.parse(rawAlerts);
        if (Array.isArray(ids)) this.acknowledgedAlertIds = new Set(ids.filter((id): id is string => typeof id === 'string'));
      }
      const rawTasks = window.localStorage.getItem(this.taskStorageKey);
      if (rawTasks) {
        const entries = JSON.parse(rawTasks);
        if (Array.isArray(entries)) {
          this.taskStatusOverrides = new Map(entries.filter((entry): entry is [string, EnterpriseTaskStatus] => {
            return Array.isArray(entry)
              && typeof entry[0] === 'string'
              && ['open', 'in_progress', 'watching', 'done'].includes(entry[1]);
          }));
        }
      }
    } catch {
      this.acknowledgedAlertIds = new Set<string>();
      this.taskStatusOverrides = new Map<string, EnterpriseTaskStatus>();
    }
  }

  private persistAcknowledgedAlerts(): void {
    try {
      window.localStorage.setItem(this.acknowledgedStorageKey, JSON.stringify(Array.from(this.acknowledgedAlertIds)));
    } catch {
      // Local persistence is best-effort for the POC UI.
    }
  }

  private persistTaskStatuses(): void {
    try {
      window.localStorage.setItem(this.taskStorageKey, JSON.stringify(Array.from(this.taskStatusOverrides.entries())));
    } catch {
      // Local persistence is best-effort for the POC UI.
    }
  }

  private renderSelectedFlow(
    event: EnterpriseRiskEvent,
    impacts: EnterpriseInternalImpact[],
    alerts: EnterpriseAlert[],
    tasks: EnterpriseTask[],
    report: EnterpriseReportSummary,
  ): string {
    const agentLine = event.agent?.identificationSource === 'qwen_agent'
      ? `Qwen output${event.agent.model ? ` · ${event.agent.model}` : ''}${event.agent.confidence != null ? ` · confidence ${(event.agent.confidence * 100).toFixed(0)}%` : ''}`
      : 'Rule fallback waiting for Qwen output';
    const transmissionLine = event.agent?.transmissionSource === 'qwen_agent'
      ? `Qwen transmission mapped ${impacts.length} internal item(s)`
      : 'Rule fallback transmission candidate';
    const evidence = event.evidenceSources?.slice(0, 3) ?? [];
    const evidenceHtml = evidence.length
      ? evidence.map(source => {
        const link = source.link ? sanitizeUrl(source.link) : '';
        const title = `${source.source}: ${source.title}`;
        return link
          ? `<li><a href="${link}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a><span>${escapeHtml(source.reason)}</span></li>`
          : `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(source.reason)}</span></li>`;
      }).join('')
      : '<li><strong>No external source link</strong><span>Structured internal signal or demo seed.</span></li>';
    const routeHtml = event.impactPath?.steps.length
      ? `<div class="er-transmission-route">${event.impactPath.steps.map(step => `<span>${escapeHtml(step)}</span>`).join('<b>→</b>')}</div>`
      : '<p>No route path mapped yet.</p>';
    const impactHtml = impacts.length
      ? impacts.slice(0, 6).map(impact => `
        <li>
          <strong>${escapeHtml(impact.businessLineName)}</strong>
          <span>${escapeHtml(impact.department)}: ${escapeHtml(impact.action)}</span>
        </li>
      `).join('')
      : '<li><strong>No internal mapping yet</strong><span>Waiting for business-line rules.</span></li>';

    return `
      <section class="er-selected-flow">
        <div class="er-section-title">Selected Card Closed Loop</div>
        <div class="er-flow-grid">
          <div class="er-flow-card">
            <span class="er-flow-index">1</span>
            <strong>感知层 · Sensing</strong>
            <p>${escapeHtml(event.title)}</p>
            <ul class="er-evidence-list">${evidenceHtml}</ul>
          </div>
          <div class="er-flow-card">
            <span class="er-flow-index">2</span>
            <strong>识别层 · Qwen Identification Agent</strong>
            <p class="er-agent-output">${escapeHtml(agentLine)}</p>
            <p>${escapeHtml(event.tags.map(enterpriseRiskTagLabel).join(' / '))} · ${escapeHtml(event.priority)} · score ${event.severityScore}</p>
            <ul>${event.explanation.triggerBasis.slice(0, 4).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
          <div class="er-flow-card">
            <span class="er-flow-index">3</span>
            <strong>传导层 · Qwen Transmission Agent</strong>
            <p class="er-agent-output">${escapeHtml(transmissionLine)}</p>
            ${routeHtml}
            <ul class="er-transmission-list">${impactHtml}</ul>
          </div>
          <div class="er-flow-card">
            <span class="er-flow-index">4</span>
            <strong>响应层 · Response</strong>
            <p>${escapeHtml(alerts.length ? alerts[0]!.message : report.financialImpact.estimate)}</p>
            <ul>${tasks.slice(0, 4).map(task => `<li>${escapeHtml(task.department)}: ${escapeHtml(task.title)}</li>`).join('') || '<li>Monitor and refresh assessment.</li>'}</ul>
          </div>
        </div>
      </section>
    `;
  }

  private renderEvent(event: EnterpriseRiskEvent): string {
    const tags = event.tags.map(tag => `<span>${escapeHtml(enterpriseRiskTagLabel(tag))}</span>`).join('');
    const link = event.link ? sanitizeUrl(event.link) : '';
    const isSelected = event.id === this.getSelectedEvent()?.id;
    const sourceLink = link ? ` <a class="er-source-link" href="${link}" target="_blank" rel="noopener noreferrer" title="Open original source">Open source</a>` : '';
    const mapHint = event.location ? `<div class="er-map-hint">Map target: ${escapeHtml(event.location.label)}</div>` : '';
    const agentBadge = event.agent?.identificationSource === 'qwen_agent'
      ? `<span class="er-agent-badge">Qwen refined${event.agent.confidence != null ? ` · ${(event.agent.confidence * 100).toFixed(0)}%` : ''}</span>`
      : '<span class="er-agent-badge er-agent-fallback">rule fallback</span>';
    return `
      <article class="er-event er-card-priority-${priorityClass(event.priority)}${isSelected ? ' er-selected' : ''}" data-er-event-id="${escapeHtml(event.id)}" role="button" tabindex="0">
        <div class="er-row-top">
          <span class="er-priority ${priorityClass(event.priority)}">${priorityLabel(event.priority)}</span>
          <span class="er-age">${isSelected ? 'selected' : escapeHtml(relativeAge(event.occurredAt))}</span>
        </div>
        ${agentBadge}
        <div class="er-event-title">${escapeHtml(event.title)}</div>
        <div class="er-event-summary">${escapeHtml(event.summary)}</div>
        <div class="er-tags">${tags}</div>
        ${mapHint}
        ${this.renderWhy(event)}
        <div class="er-source-line">${escapeHtml(event.source)} · ${escapeHtml(event.sourceType.replace(/_/g, ' '))}${event.isDemoSeed ? ' · demo seed' : ''}${sourceLink}</div>
      </article>
    `;
  }

  private renderWhy(event: EnterpriseRiskEvent): string {
    const rows: Array<[string, string[]]> = [
      ['Trigger', event.explanation.triggerBasis],
      ['Priority', event.explanation.priorityBasis],
      ['Mapping', event.explanation.mappingBasis],
      ['Data', event.explanation.dataQuality],
    ];
    return `
      <details class="er-why">
        <summary>Why this alert</summary>
        ${rows.map(([label, items]) => `
          <div class="er-why-row">
            <strong>${escapeHtml(label)}</strong>
            <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
        `).join('')}
      </details>
    `;
  }

  private renderAlert(alert: EnterpriseAlert): string {
    const acknowledged = this.acknowledgedAlertIds.has(alert.id);
    return `
      <div class="er-alert er-card-priority-${priorityClass(alert.priority)}${acknowledged ? ' er-acknowledged' : ''}">
        <div class="er-row-top">
          <span class="er-priority ${priorityClass(alert.priority)}">${escapeHtml(alert.priority)}</span>
          <button class="er-mini-action" type="button" data-er-alert-id="${escapeHtml(alert.id)}">${acknowledged ? 'Undo ack' : 'Acknowledge'}</button>
        </div>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(alert.message)}</p>
        <div class="er-tags">${alert.departments.map(dep => `<span>${escapeHtml(dep)}</span>`).join('')}</div>
      </div>
    `;
  }

  private renderTask(task: EnterpriseTask): string {
    const status = this.getTaskStatus(task);
    return `
      <div class="er-task">
        <button class="er-task-status er-task-status-btn" type="button" data-er-task-id="${escapeHtml(task.id)}">${escapeHtml(status.replace(/_/g, ' '))}</button>
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <p>${escapeHtml(task.department)} · due ${escapeHtml(task.dueDate)}</p>
        </div>
        <span class="er-priority ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
      </div>
    `;
  }
}
