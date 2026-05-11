import { Panel } from './Panel';
import type { EnterpriseRiskAssessment } from '@/types/enterprise-risk';
import { escapeHtml } from '@/utils/sanitize';
import { renderEnterpriseRiskEvent } from './enterprise-risk-rendering';

export class EnterpriseRiskEventListPanel extends Panel {
  private assessment: EnterpriseRiskAssessment | null = null;
  private selectedEventId: string | null = null;
  private onEventSelect?: (eventId: string | null) => void;

  constructor() {
    super({
      id: 'enterprise-risk-events',
      title: 'Event List',
      className: 'panel-wide col-span-3 enterprise-risk-events-panel-shell',
      defaultRowSpan: 2,
      closable: true,
      collapsible: true,
      infoTooltip: 'Pinned demo scenario and live external risk candidates from the Enterprise Risk Immunity Center.',
    });
    this.content.addEventListener('click', (event) => this.handleClick(event));
    this.content.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.showLoading('Waiting for enterprise risk events...');
  }

  public setEventSelectionHandler(handler: (eventId: string | null) => void): void {
    this.onEventSelect = handler;
  }

  public setSelectedEventId(eventId: string | null): void {
    this.selectedEventId = eventId;
    this.render();
  }

  public setAssessment(assessment: EnterpriseRiskAssessment): void {
    this.assessment = assessment;
    if (!assessment.events.some(event => event.id === this.selectedEventId)) {
      this.selectedEventId = assessment.events[0]?.id ?? null;
    }
    this.setCount?.(assessment.events.length);
    const top = assessment.events[0]?.priority;
    this.setSeverity(top === 'P1' ? 'critical' : top === 'P2' ? 'high' : 'medium');
    this.render();
  }

  private render(): void {
    if (!this.assessment) {
      this.showLoading('Waiting for enterprise risk events...');
      return;
    }

    const pinnedEvents = this.assessment.events.filter(event => event.isDemoSeed);
    const liveEvents = this.assessment.events.filter(event => !event.isDemoSeed);
    const rssCoverage = this.assessment.sourceCoverage.find(source => source.id === 'rss');

    this.setContent(`
      <div class="enterprise-risk-v2 enterprise-risk-events-v2">
        <section class="er-section er-section-events er-events-full">
          <div class="er-event-list-head">
            <div>
              <div class="er-section-title">Event List</div>
              <div class="er-event-list-subtitle">Pinned demo scenario + live external context</div>
            </div>
            <span>${this.assessment.events.length} cards</span>
          </div>
          <div class="er-event-list-grid">
            ${pinnedEvents.map(event => renderEnterpriseRiskEvent(event, this.selectedEventId)).join('')}
            ${liveEvents.length ? liveEvents.map(event => renderEnterpriseRiskEvent(event, this.selectedEventId)).join('') : `<div class="er-empty">No live risk candidates yet. ${escapeHtml(rssCoverage?.detail ?? 'External feeds are still loading.')}</div>`}
          </div>
        </section>
      </div>
    `);
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('.er-why')) return;
    const eventCard = target.closest<HTMLElement>('[data-er-event-id]');
    if (!eventCard || target.closest('a,button')) return;
    this.selectEvent(eventCard.dataset.erEventId ?? null);
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
    this.render();
    this.onEventSelect?.(eventId);
  }
}
