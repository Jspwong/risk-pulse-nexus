import { Panel } from './Panel';
import type {
  EnterpriseAlert,
  EnterpriseInternalImpact,
  EnterpriseReportSummary,
  EnterpriseRoiAssumptionLine,
  EnterpriseRoiAssumptionPack,
  EnterpriseRoiAssumptions,
  EnterpriseRoiMode,
  EnterpriseRiskAssessment,
  EnterpriseRiskEvent,
  EnterpriseRiskTag,
  EnterpriseTask,
  EnterpriseTaskStatus,
} from '@/types/enterprise-risk';
import { buildEnterpriseRoiSimulation, enterpriseRiskTagLabel } from '@/services/enterprise-risk';
import {
  ENTERPRISE_RISK_FIRST_DEMO_EVENT_ID,
  enterpriseRiskRoiTagsForEvent,
} from '@/services/enterprise-risk';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import {
  enterpriseRiskPriorityClass,
  hasReliableEnterpriseRiskMapTarget,
} from './enterprise-risk-rendering';

function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

function formatTemplate(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatAssumptionValue(line: EnterpriseRoiAssumptionLine): string {
  if (line.unit === 'usd') return formatUsd(line.value);
  if (line.unit === 'probability' || line.unit === 'percentage') return formatPercent(line.value * 100);
  if (line.unit === 'days') return `${Math.round(line.value)}d`;
  if (line.unit === 'usd_per_day') return `${formatUsd(line.value)}/d`;
  if (line.unit === 'tonnes_co2e') return `${Math.round(line.value).toLocaleString()} tCO2e`;
  if (line.unit === 'multiple') return `${line.value.toFixed(2)}x`;
  return Math.round(line.value).toLocaleString();
}

export class EnterpriseRiskPanel extends Panel {
  private assessment: EnterpriseRiskAssessment | null = null;
  private selectedEventId: string | null = null;
  private acknowledgedAlertIds = new Set<string>();
  private taskStatusOverrides = new Map<string, EnterpriseTaskStatus>();
  private roiMode: EnterpriseRoiMode = 'base';
  private roiHorizonDays: EnterpriseRoiAssumptions['horizonDays'] = 365;
  private roiMitigationIntensity = 0.6;
  private roiCorrelationHaircutPct = 10;
  private roiSandboxCollapsed = false;
  private disabledRoiTags = new Set<EnterpriseRiskTag>();
  private readonly acknowledgedStorageKey = 'wm.enterpriseRisk.acknowledgedAlerts';
  private readonly taskStorageKey = 'wm.enterpriseRisk.taskStatusOverrides';
  private readonly roiStorageKey = 'wm.enterpriseRisk.roiSandbox';

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
    this.content.addEventListener('input', (event) => this.handleInput(event));
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

  public selectEventById(eventId: string | null): void {
    this.selectEvent(eventId);
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
    const modeledTasks = visibleTasks.map(task => ({ ...task, status: this.getTaskStatus(task) }));
    const selectedReport = this.buildSelectedReport(assessment.report, selectedEvent, visibleImpacts, modeledTasks);

    this.setContent(`
      <div class="enterprise-risk-v2">
        <div class="er-hero">
          <div class="er-hero-main">
            <div class="er-kicker">Clickable closed loop - ${escapeHtml(assessment.profile.scenarioName)}</div>
            <h3>${escapeHtml(assessment.profile.companyName)}</h3>
            <p>${escapeHtml(assessment.profile.primaryNarrative)}</p>
          </div>
          ${this.renderRoiCockpit(selectedReport)}
        </div>

        <div class="er-demo-banner">
          Demo baseline + live cards; live signals fill in as data arrives.
          <span class="er-agent-status er-agent-${escapeHtml(assessment.agentWorkflow.status)}">
            <b>Qwen: ${escapeHtml(this.formatWorkflowStatus(assessment.agentWorkflow.status))} mode for live assumptions</b>
          </span>
          ${this.renderRoiAgentStatus(assessment)}
        </div>

        ${this.renderRoiSandbox(selectedReport)}

        ${selectedEvent ? this.renderSelectedFlow(selectedEvent, visibleImpacts, visibleAlerts, modeledTasks, selectedReport) : ''}

        <div class="er-footer">
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
      this.element.dispatchEvent(new CustomEvent('wm:enterprise-risk-open-events', { bubbles: true }));
      return;
    }
    if (action === 'toggle-roi-sandbox') {
      this.roiSandboxCollapsed = !this.roiSandboxCollapsed;
      this.persistRoiSandbox();
      const sandbox = target.closest<HTMLElement>('.er-roi-sandbox');
      const body = sandbox?.querySelector<HTMLElement>('.er-roi-collapsible');
      const toggle = target.closest<HTMLButtonElement>('[data-er-action="toggle-roi-sandbox"]');
      sandbox?.classList.toggle('is-collapsed', this.roiSandboxCollapsed);
      body?.classList.toggle('hidden', this.roiSandboxCollapsed);
      if (toggle) {
        toggle.textContent = this.roiSandboxCollapsed ? 'Expand' : 'Collapse';
        toggle.setAttribute('aria-expanded', this.roiSandboxCollapsed ? 'false' : 'true');
      }
      return;
    }
    if (action === 'roi-mode') {
      const mode = target.closest<HTMLElement>('[data-er-mode]')?.dataset.erMode;
      if (mode === 'base' || mode === 'stress') {
        this.roiMode = mode;
        this.persistRoiSandbox();
        this.render();
      }
      return;
    }
    if (action === 'roi-horizon') {
      const horizon = Number(target.closest<HTMLElement>('[data-er-horizon]')?.dataset.erHorizon);
      if (horizon === 90 || horizon === 365) {
        this.roiHorizonDays = horizon;
        this.persistRoiSandbox();
        this.render();
      }
      return;
    }
    if (action === 'roi-toggle-tag') {
      const tag = target.closest<HTMLElement>('[data-er-tag]')?.dataset.erTag as EnterpriseRiskTag | undefined;
      if (tag && ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx'].includes(tag)) {
        if (this.disabledRoiTags.has(tag)) this.disabledRoiTags.delete(tag);
        else this.disabledRoiTags.add(tag);
        this.persistRoiSandbox();
        this.render();
      }
      return;
    }
    if (action === 'select-p1') {
      const p1 = this.assessment?.events.find(item => item.priority === 'P1');
      if (p1) this.selectEvent(p1.id);
    }
  }

  private handleInput(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-er-roi-input]');
    if (!input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    if (input.dataset.erRoiInput === 'intensity') {
      this.roiMitigationIntensity = Math.max(0.25, Math.min(1, value / 100));
    } else if (input.dataset.erRoiInput === 'haircut') {
      this.roiCorrelationHaircutPct = Math.max(0, Math.min(40, value));
    } else {
      return;
    }
    this.persistRoiSandbox();
    this.render();
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
        location: hasReliableEnterpriseRiskMapTarget(selected) ? selected.location : undefined,
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

  private getRoiAssumptions(): EnterpriseRoiAssumptions {
    return {
      mode: this.roiMode,
      horizonDays: this.roiHorizonDays,
      mitigationIntensity: this.roiMitigationIntensity,
      correlationHaircutPct: this.roiCorrelationHaircutPct,
      disabledTags: Array.from(this.disabledRoiTags),
      roiAssumptionPacks: this.assessment?.roiAssumptionPacks ?? {},
    };
  }

  private formatWorkflowStatus(status: EnterpriseRiskAssessment['agentWorkflow']['status']): string {
    if (status === 'applied') return 'Complete';
    if (status === 'running') return 'Working';
    if (status === 'fallback') return 'Fallback';
    return 'Pending';
  }

  private renderQwenPill(label: string): string {
    return `<span class="er-agent-badge er-agent-qwen-pill" aria-label="${escapeHtml(label)}">Qwen</span>`;
  }

  private renderOnnxPill(label: string): string {
    return `<span class="er-agent-badge er-agent-onnx-pill" aria-label="${escapeHtml(label)}">ONNX</span>`;
  }

  private renderResponseTask(task: EnterpriseTask): string {
    const prefix = `${task.department}:`;
    const title = task.title.startsWith(prefix) ? task.title.slice(prefix.length).trim() : task.title;
    return `
      <li>
        <b>${escapeHtml(task.department)}</b>
        <span>${escapeHtml(title)}</span>
      </li>
    `;
  }

  private renderRoiAgentStatus(assessment: EnterpriseRiskAssessment): string {
    const roiEvent = assessment.events.find(event => event.id === ENTERPRISE_RISK_FIRST_DEMO_EVENT_ID)
      ?? assessment.events.find(event => enterpriseRiskRoiTagsForEvent(event).length > 0);
    if (!roiEvent) return '';
    const roiTags = enterpriseRiskRoiTagsForEvent(roiEvent);
    if (!roiTags.length) return '';
    const packs = assessment.roiAssumptionPacks ?? {};
    const completedTags = roiTags.filter(tag => packs[`${roiEvent.id}:${tag}`]?.generatedBy === 'qwen_agent');
    const detail = roiTags.map(enterpriseRiskTagLabel).join(' / ');
    const complete = completedTags.length === roiTags.length;
    const statusText = complete ? 'Complete' : 'Working';
    const qwenPill = complete ? ` ${this.renderQwenPill('Qwen ROI Agent')}` : '';
    return `
      <span class="er-agent-status er-agent-roi ${complete ? 'er-agent-applied' : 'er-agent-running'}">
        <b>ROI: ${statusText}${qwenPill} on ${completedTags.length}/${roiTags.length} axes</b>
        <span>${escapeHtml(detail)}</span>
      </span>
    `;
  }

  private renderRoiCockpit(report: EnterpriseReportSummary): string {
    const impact = report.financialImpact;
    const roiClass = impact.compositeRoiPct >= 0
      ? 'er-roi-positive er-roi-kpi-highlight'
      : 'er-roi-negative er-roi-kpi-negative-highlight';
    return `
      <div class="er-roi-cockpit" aria-label="ROI simulation summary">
        <button class="er-roi-kpi er-roi-kpi-loss" type="button" data-er-action="focus-report">
          <span>${formatUsd(impact.expectedLossUsd)}</span>
          <label>Expected loss</label>
        </button>
        <button class="er-roi-kpi er-roi-kpi-save er-roi-kpi-highlight" type="button" data-er-action="focus-report">
          <span>${formatUsd(impact.expectedSavingUsd)}</span>
          <label>Expected savings</label>
        </button>
        <button class="er-roi-kpi" type="button" data-er-action="focus-report">
          <span>${formatUsd(impact.mitigationCostUsd)}</span>
          <label>System cost</label>
        </button>
        <button class="er-roi-kpi ${impact.netSavingUsd >= 0 ? 'er-roi-positive' : 'er-roi-negative'}" type="button" data-er-action="focus-report">
          <span>${formatUsd(impact.netSavingUsd)}</span>
          <label>Net savings</label>
        </button>
        <button class="er-roi-kpi ${roiClass}" type="button" data-er-action="focus-report">
          <span>${formatPercent(impact.compositeRoiPct)}</span>
          <label>Composite ROI</label>
        </button>
      </div>
    `;
  }

  private renderRoiSandbox(report: EnterpriseReportSummary): string {
    const impact = report.financialImpact;
    const simulation = impact.simulation;
    const intensityPct = Math.round(this.roiMitigationIntensity * 100);
    const modeButton = (mode: EnterpriseRoiMode, label: string) => `
      <button class="er-roi-segment${this.roiMode === mode ? ' active' : ''}" type="button" data-er-action="roi-mode" data-er-mode="${mode}">${label}</button>
    `;
    const horizonButton = (days: EnterpriseRoiAssumptions['horizonDays']) => `
      <button class="er-roi-segment${this.roiHorizonDays === days ? ' active' : ''}" type="button" data-er-action="roi-horizon" data-er-horizon="${days}">${days === 365 ? '1y' : `${days}d`}</button>
    `;
    const bodyHidden = this.roiSandboxCollapsed ? ' hidden' : '';
    return `
      <section class="er-roi-sandbox${this.roiSandboxCollapsed ? ' is-collapsed' : ''}" id="enterpriseRiskReport">
        <div class="er-roi-sandbox-head">
          <div class="er-section-title">Triggered Risk ROI Simulation Sandbox</div>
          <button class="er-mini-action er-roi-collapse-toggle" type="button" data-er-action="toggle-roi-sandbox" aria-expanded="${this.roiSandboxCollapsed ? 'false' : 'true'}">
            ${this.roiSandboxCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
        <div class="er-roi-collapsible${bodyHidden}">
          <div class="er-roi-terminal-head">
            <div>
              <strong>${formatUsd(impact.expectedSavingUsd)}</strong>
              <span>expected savings after ${this.roiCorrelationHaircutPct}% correlation haircut</span>
            </div>
            <div>
              <strong class="${impact.compositeRoiPct >= 0 ? 'er-roi-positive' : 'er-roi-negative'}">${formatPercent(impact.compositeRoiPct)}</strong>
              <span>composite ROI across ${simulation.scenarioCount} active risk axes</span>
            </div>
          </div>
          <div class="er-roi-controls">
            <div class="er-roi-control">
              <label>Scenario mode</label>
              <div class="er-roi-segments">${modeButton('base', 'Base')}${modeButton('stress', 'Stress')}</div>
            </div>
            <div class="er-roi-control">
              <label>Time horizon</label>
              <div class="er-roi-segments">${horizonButton(90)}${horizonButton(365)}</div>
            </div>
            <div class="er-roi-control">
              <label>Mitigation intensity <b>${intensityPct}%</b></label>
              <input type="range" min="25" max="100" step="5" value="${intensityPct}" data-er-roi-input="intensity" aria-label="Mitigation intensity">
            </div>
            <div class="er-roi-control">
              <label>Correlation haircut <b>${this.roiCorrelationHaircutPct}%</b></label>
              <input type="range" min="0" max="40" step="5" value="${this.roiCorrelationHaircutPct}" data-er-roi-input="haircut" aria-label="Correlation haircut">
            </div>
          </div>
          <div class="er-risk-scenario-table" role="table" aria-label="Risk scenario ROI table">
            <div class="er-scenario-head" role="row">
              <span>Risk axis</span>
              <span>Prob.</span>
              <span>Exposure</span>
              <span>Base loss</span>
              <span>Residual</span>
              <span>Saving</span>
              <span>Cost</span>
              <span>Net</span>
              <span>ROI</span>
            </div>
            ${simulation.scenarios.map(scenario => this.renderRoiScenarioRow(scenario)).join('')}
          </div>
          <div class="er-roi-ledger-wrap">
          ${this.renderRoiAssumptionLedger(impact.assumptionPacks)}
          </div>
        </div>
      </section>
    `;
  }

  private renderRoiScenarioRow(scenario: EnterpriseReportSummary['financialImpact']['scenarios'][number]): string {
    const roiClass = scenario.roiPct >= 0 ? 'er-roi-positive' : 'er-roi-negative';
    const axisClass = `er-risk-${scenario.tag.replace(/_/g, '-')}`;
    const driverTitle = scenario.drivers.join(' | ');
    return `
      <div class="er-scenario-row ${scenario.active ? '' : 'is-disabled'} ${axisClass}" role="row" title="${escapeHtml(driverTitle)}">
        <button class="er-axis-toggle" type="button" data-er-action="roi-toggle-tag" data-er-tag="${escapeHtml(scenario.tag)}">
          <i></i>
          <span>${escapeHtml(scenario.label)}</span>
        </button>
        <span>${formatPercent(scenario.probabilityPct)}</span>
        <span class="er-roi-exposure">${formatUsd(scenario.grossExposureUsd)}</span>
        <span>${formatUsd(scenario.baselineLossUsd)}</span>
        <span>${formatUsd(scenario.residualLossUsd)}</span>
        <span class="er-roi-saving">${formatUsd(scenario.expectedSavingUsd)}</span>
        <span>${formatUsd(scenario.mitigationCostUsd)}</span>
        <span class="${scenario.netSavingUsd < 0 ? 'er-roi-negative' : ''}">${formatUsd(scenario.netSavingUsd)}</span>
        <span class="er-roi-axis-roi ${roiClass}">${formatPercent(scenario.roiPct)}</span>
      </div>
    `;
  }

  private renderRoiAssumptionLedger(packs: EnterpriseRoiAssumptionPack[]): string {
    if (!packs.length) return '';
    const uniquePacks = Array.from(new Map(packs.map(pack => [`${pack.eventId}:${pack.template}:${pack.generatedBy}`, pack])).values());
    return `
      <div class="er-roi-assumption-ledger" aria-label="ROI assumption ledger">
        ${uniquePacks.slice(0, 4).map(pack => `
          <div class="er-roi-assumption-pack">
            <div class="er-roi-assumption-head">
              <strong>${escapeHtml(formatTemplate(pack.template))}</strong>
              <span>${escapeHtml(pack.generatedBy === 'qwen_agent' ? 'Qwen assumptions' : 'Deterministic fallback')} - ${(pack.confidence * 100).toFixed(0)}%</span>
            </div>
            <div class="er-roi-assumption-rows">
              ${pack.assumptions
                .filter(line => ['exposureBaseUsd', 'eventProbability', 'detectionHitRate', 'mitigationEffectiveness', 'annualSystemCostUsd'].includes(line.key))
                .slice(0, 5)
                .map(line => this.renderRoiAssumptionRow(line))
                .join('')}
            </div>
            <div class="er-roi-assumption-refs">${escapeHtml(pack.references.slice(0, 2).join(' / ') || 'Open FAIR / NIST SP 800-30')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderRoiAssumptionRow(line: EnterpriseRoiAssumptionLine): string {
    const source = line.sourceUrl
      ? `<a href="${sanitizeUrl(line.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(line.source)}</a>`
      : escapeHtml(line.source);
    return `
      <div class="er-roi-assumption-row">
        <span>${escapeHtml(line.label)}</span>
        <b>${escapeHtml(formatAssumptionValue(line))}</b>
        <small>${source} - confidence ${(line.confidence * 100).toFixed(0)}%</small>
      </div>
    `;
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
    const simulation = buildEnterpriseRoiSimulation(selectedEvent, impacts, tasks, this.getRoiAssumptions());
    return {
      ...baseReport,
      id: `report-${selectedEvent.id}`,
      eventSummary: selectedEvent.summary,
      internalImpact: `${selectedEvent.priority} event mapped to ${departments.join(' / ') || 'Risk Office'}, affecting ${businessLines.join(' / ') || 'priority business lines'}.`,
      recommendedActions: recommendations.length ? recommendations : ['Continue monitoring this event and review internal ROI after the next data refresh.'],
      financialImpact: {
        exposureUsd: simulation.totalExposureUsd,
        expectedLossUsd: simulation.expectedLossUsd,
        expectedSavingUsd: simulation.expectedSavingUsd,
        mitigationCostUsd: simulation.mitigationCostUsd,
        netSavingUsd: simulation.netSavingUsd,
        compositeRoiPct: simulation.compositeRoiPct,
        scenarios: simulation.scenarios,
        simulation,
        assumptionPacks: simulation.assumptionPacks,
        estimate: `FAIR-lite ROI sandbox: ${formatUsd(simulation.expectedSavingUsd)} expected savings against ${formatUsd(simulation.mitigationCostUsd)} system cost; composite ROI ${simulation.compositeRoiPct}%.`,
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
      const rawRoi = window.localStorage.getItem(this.roiStorageKey);
      if (rawRoi) {
        const state = JSON.parse(rawRoi);
        if (state && typeof state === 'object') {
          if (state.mode === 'base' || state.mode === 'stress') this.roiMode = state.mode;
          else if (state.mode === 'aggressive') this.roiMode = 'stress';
          else if (state.mode === 'conservative') this.roiMode = 'base';
          if (state.horizonDays === 90 || state.horizonDays === 365) this.roiHorizonDays = state.horizonDays;
          else if (state.horizonDays === 30 || state.horizonDays === 180) this.roiHorizonDays = 90;
          if (typeof state.mitigationIntensity === 'number') this.roiMitigationIntensity = Math.max(0.25, Math.min(1, state.mitigationIntensity));
          if (typeof state.correlationHaircutPct === 'number') this.roiCorrelationHaircutPct = Math.max(0, Math.min(40, state.correlationHaircutPct));
          if (typeof state.collapsed === 'boolean') this.roiSandboxCollapsed = state.collapsed;
          if (Array.isArray(state.disabledTags)) {
            this.disabledRoiTags = new Set(state.disabledTags.filter((tag: unknown): tag is EnterpriseRiskTag => {
              return typeof tag === 'string' && ['geopolitical', 'regulatory', 'supply_chain', 'financial_fx'].includes(tag);
            }));
          }
        }
      }
    } catch {
      this.acknowledgedAlertIds = new Set<string>();
      this.taskStatusOverrides = new Map<string, EnterpriseTaskStatus>();
      this.disabledRoiTags = new Set<EnterpriseRiskTag>();
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

  private persistRoiSandbox(): void {
    try {
      window.localStorage.setItem(this.roiStorageKey, JSON.stringify({
        mode: this.roiMode,
        horizonDays: this.roiHorizonDays,
        mitigationIntensity: this.roiMitigationIntensity,
        correlationHaircutPct: this.roiCorrelationHaircutPct,
        collapsed: this.roiSandboxCollapsed,
        disabledTags: Array.from(this.disabledRoiTags),
      }));
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
      ? `Qwen output${event.agent.model ? ` - ${event.agent.model}` : ''}${event.agent.confidence != null ? ` - confidence ${(event.agent.confidence * 100).toFixed(0)}%` : ''}`
      : 'Rule fallback waiting for Qwen output';
    const transmissionLine = event.agent?.transmissionSource === 'qwen_agent'
      ? `Qwen transmission mapped ${impacts.length} internal item(s)`
      : 'Rule fallback transmission candidate';
    const identificationBadge = event.agent?.identificationSource === 'qwen_agent'
      ? this.renderQwenPill('Qwen Identification Agent')
      : '';
    const transmissionBadge = event.agent?.transmissionSource === 'qwen_agent'
      ? this.renderQwenPill('Qwen Transmission Agent')
      : '';
    const responseBadge = tasks.some(task => task.source === 'qwen_agent')
      ? this.renderQwenPill('Qwen Response Agent')
      : '';
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
      ? `<div class="er-transmission-route">${event.impactPath.steps.map(step => `<span>${escapeHtml(step)}</span>`).join('<b>-></b>')}</div>`
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
            <strong class="er-flow-title">Perception Layer ${this.renderOnnxPill('Browser ONNX Perception Model')}</strong>
            <p>${escapeHtml(event.title)}</p>
            <ul class="er-evidence-list">${evidenceHtml}</ul>
          </div>
          <div class="er-flow-card">
            <span class="er-flow-index">2</span>
            <strong class="er-flow-title">Identification Layer ${identificationBadge}</strong>
            <p class="er-agent-output">${escapeHtml(agentLine)}</p>
            <p>${escapeHtml(event.tags.map(enterpriseRiskTagLabel).join(' / '))} - ${escapeHtml(event.priority)} - score ${event.severityScore}</p>
            <ul>${event.explanation.triggerBasis.slice(0, 4).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
          <div class="er-flow-card">
            <span class="er-flow-index">3</span>
            <strong class="er-flow-title">Transmission Layer ${transmissionBadge}</strong>
            <p class="er-agent-output">${escapeHtml(transmissionLine)}</p>
            ${routeHtml}
            <ul class="er-transmission-list">${impactHtml}</ul>
          </div>
          <div class="er-flow-card er-flow-response">
            <span class="er-flow-index">4</span>
            <strong class="er-flow-title">Response Layer ${responseBadge}</strong>
            <p class="er-response-summary">${escapeHtml(alerts.length ? alerts[0]!.message : report.financialImpact.estimate)}</p>
            <ul class="er-response-list">${tasks.slice(0, 4).map(task => this.renderResponseTask(task)).join('') || '<li><b>Monitor</b><span>Refresh assessment.</span></li>'}</ul>
          </div>
        </div>
      </section>
    `;
  }

  private renderAlert(alert: EnterpriseAlert): string {
    const acknowledged = this.acknowledgedAlertIds.has(alert.id);
    return `
      <div class="er-alert er-card-priority-${enterpriseRiskPriorityClass(alert.priority)}${acknowledged ? ' er-acknowledged' : ''}">
        <div class="er-row-top">
          <span class="er-priority ${enterpriseRiskPriorityClass(alert.priority)}">${escapeHtml(alert.priority)}</span>
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
          <p>${escapeHtml(task.department)} - due ${escapeHtml(task.dueDate)}</p>
        </div>
        <span class="er-priority ${enterpriseRiskPriorityClass(task.priority)}">${escapeHtml(task.priority)}</span>
      </div>
    `;
  }
}
