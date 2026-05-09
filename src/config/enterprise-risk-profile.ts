import type { EnterpriseRiskProfile } from '@/types/enterprise-risk';

export const NEW_ENERGY_EXPORTER_PROFILE: EnterpriseRiskProfile = {
  id: 'longyuan-new-energy-components',
  companyName: '龙远新能源零部件有限公司',
  scenarioName: '新能源零部件出海风险闭环',
  primaryNarrative: '中国新能源零部件企业向欧洲与东南亚交付电池托盘、铝压铸件和储能结构件。',
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
      name: '欧洲电池托盘出口线',
      products: ['battery tray', 'aluminum casting', 'EV battery enclosure'],
      exportSharePct: 42,
      targetMarkets: ['EU', 'Germany', 'Netherlands'],
      routeExposure: ['Suez', 'Red Sea', 'Rotterdam', 'Hamburg'],
      revenueAtRiskUsd: 18_500_000,
    },
    {
      id: 'storage-structures-sea',
      name: '东南亚储能结构件供应线',
      products: ['energy storage cabinet', 'sheet metal enclosure', 'BMS housing'],
      exportSharePct: 16,
      targetMarkets: ['Vietnam', 'Thailand', 'Indonesia'],
      routeExposure: ['Malacca', 'Singapore', 'Ho Chi Minh City', 'Laem Chabang'],
      revenueAtRiskUsd: 7_200_000,
    },
    {
      id: 'cbam-compliance-program',
      name: 'CBAM/碳数据合规项目',
      products: ['embedded emissions data', 'supplier carbon factor', 'customs declaration'],
      exportSharePct: 10,
      targetMarkets: ['EU', 'Germany', 'Netherlands'],
      routeExposure: ['EU customs', 'CBAM registry'],
      revenueAtRiskUsd: 5_400_000,
    },
  ],
  demoMode: {
    enabled: true,
    label: 'Demo 主线固定保留，Live 外部事件以真实输入追加展示。',
  },
};
