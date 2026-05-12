import type { EnterpriseRiskProfile } from '@/types/enterprise-risk';

export const NEW_ENERGY_EXPORTER_PROFILE: EnterpriseRiskProfile = {
  id: 'longyuan-new-energy-components',
  companyName: 'Longyuan New Energy Components Co., Ltd.',
  scenarioName: 'New Energy Components Export Risk Closed Loop',
  primaryNarrative: 'A China-based new energy components exporter delivering battery trays, aluminum die-cast parts, and energy storage structures to Europe and Southeast Asia.',
  targetMarkets: ['EU', 'Germany', 'Netherlands', 'Vietnam', 'Thailand', 'Indonesia'],
  exportSharePct: 68,
  criticalCertifications: ['CBAM embedded emissions', 'EU Battery Regulation', 'ISO 14064', 'IATF 16949', 'REACH/RoHS'],
  affectedDepartments: ['Compliance', 'Finance', 'Supply Chain', 'Sales', 'Operations'],
  riskWeights: {
    geopolitical: 1.15,
    regulatory: 1.25,
    supply_chain: 1.2,
    financial_fx: 1.05,
  },
  businessLines: [
    {
      id: 'battery-trays-eu',
      name: 'Europe Battery Tray Export Line',
      products: ['battery tray', 'aluminum casting', 'EV battery enclosure'],
      exportSharePct: 42,
      targetMarkets: ['EU', 'Germany', 'Netherlands'],
      routeExposure: ['Suez', 'Red Sea', 'Rotterdam', 'Hamburg'],
      revenueAtRiskUsd: 18_500_000,
    },
    {
      id: 'storage-structures-sea',
      name: 'Southeast Asia Energy Storage Structures Supply Line',
      products: ['energy storage cabinet', 'sheet metal enclosure', 'BMS housing'],
      exportSharePct: 16,
      targetMarkets: ['Vietnam', 'Thailand', 'Indonesia'],
      routeExposure: ['Malacca', 'Singapore', 'Ho Chi Minh City', 'Laem Chabang'],
      revenueAtRiskUsd: 7_200_000,
    },
    {
      id: 'cbam-compliance-program',
      name: 'CBAM / Carbon Data Compliance Program',
      products: ['embedded emissions data', 'supplier carbon factor', 'customs declaration'],
      exportSharePct: 10,
      targetMarkets: ['EU', 'Germany', 'Netherlands'],
      routeExposure: ['EU customs', 'CBAM registry'],
      revenueAtRiskUsd: 5_400_000,
    },
  ],
  demoMode: {
    enabled: true,
    label: 'Demo baseline remains pinned while live external events are appended from real inputs.',
  },
};
