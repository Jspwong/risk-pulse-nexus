import type { EnterpriseRiskEvent, EnterpriseRiskPriority } from '@/types/enterprise-risk';
import { enterpriseRiskTagLabel } from '@/services/enterprise-risk';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

export function enterpriseRiskPriorityClass(priority: EnterpriseRiskPriority): string {
  return priority.toLowerCase();
}

export function enterpriseRiskPriorityLabel(priority: EnterpriseRiskPriority): string {
  return priority === 'P1' ? 'P1 Immediate' : priority === 'P2' ? 'P2 Watch' : 'P3 Monitor';
}

export function enterpriseRiskRelativeAge(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function hasReliableEnterpriseRiskMapTarget(event: EnterpriseRiskEvent): boolean {
  return !!event.location && event.location.source !== 'feed' && event.location.resolution !== 'feed_coordinate';
}

export function renderEnterpriseRiskWhy(event: EnterpriseRiskEvent): string {
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

export function renderEnterpriseRiskEvent(event: EnterpriseRiskEvent, selectedEventId: string | null): string {
  const tags = event.tags.map(tag => `<span>${escapeHtml(enterpriseRiskTagLabel(tag))}</span>`).join('');
  const link = event.link ? sanitizeUrl(event.link) : '';
  const isSelected = event.id === selectedEventId;
  const sourceLink = link ? ` <a class="er-source-link" href="${link}" target="_blank" rel="noopener noreferrer" title="Open original source">Open source</a>` : '';
  const mapHint = hasReliableEnterpriseRiskMapTarget(event) ? `<div class="er-map-hint">Map target: ${escapeHtml(event.location!.label)}</div>` : '';
  const agentBadge = event.agent?.identificationSource === 'qwen_agent'
    ? `<span class="er-agent-badge">Qwen refined${event.agent.confidence != null ? ` - ${(event.agent.confidence * 100).toFixed(0)}%` : ''}</span>`
    : '<span class="er-agent-badge er-agent-fallback">Rule fallback</span>';
  return `
    <article class="er-event er-card-priority-${enterpriseRiskPriorityClass(event.priority)}${isSelected ? ' er-selected' : ''}" data-er-event-id="${escapeHtml(event.id)}" role="button" tabindex="0">
      <div class="er-row-top">
        <div class="er-row-badges">
          <span class="er-priority ${enterpriseRiskPriorityClass(event.priority)}">${enterpriseRiskPriorityLabel(event.priority)}</span>
          ${agentBadge}
        </div>
        <span class="er-age">${isSelected ? 'selected' : escapeHtml(enterpriseRiskRelativeAge(event.occurredAt))}</span>
      </div>
      <div class="er-event-title">${escapeHtml(event.title)}</div>
      <div class="er-event-summary">${escapeHtml(event.summary)}</div>
      <div class="er-tags">${tags}</div>
      ${mapHint}
      ${renderEnterpriseRiskWhy(event)}
      <div class="er-source-line">${escapeHtml(event.source)} - ${escapeHtml(event.sourceType.replace(/_/g, ' '))}${event.isDemoSeed ? ' - demo seed' : ''}${sourceLink}</div>
    </article>
  `;
}
