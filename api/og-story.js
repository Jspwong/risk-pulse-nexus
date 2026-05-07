// Non-sebuf: 返回 XML/HTML，保持为独立 Vercel Function
/**
 * 动态 OG 图片生成器（用于 Story 分享）
 * 返回 SVG 图片（1200x630）
 * 用于社交平台分享时显示的情报卡片预览
 */

const COUNTRY_NAMES = {
  UA: '乌克兰',
  RU: '俄罗斯',
  CN: '中国',
  US: '美国',
  IR: '伊朗',
  IL: '以色列',
  TW: '中国台湾',
  KP: '朝鲜',
  SA: '沙特阿拉伯',
  TR: '土耳其',
  PL: '波兰',
  DE: '德国',
  FR: '法国',
  GB: '英国',
  IN: '印度',
  PK: '巴基斯坦',
  SY: '叙利亚',
  YE: '也门',
  MM: '缅甸',
  VE: '委内瑞拉',
};

const LEVEL_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  elevated: '#eab308',
  normal: '#22c55e',
  low: '#3b82f6',
};

const LEVEL_LABELS = {
  critical: '严重不稳定',
  high: '高风险不稳定',
  elevated: '风险升高',
  normal: '整体稳定',
  low: '低风险',
};

function normalizeLevel(rawLevel) {
  const level = String(rawLevel || '').toLowerCase();

  return Object.hasOwn(LEVEL_COLORS, level)
    ? level
    : 'normal';
}

export default function handler(req, res) {
  const url = new URL(
    req.url,
    'https://worldmonitor.app'
  );

  const countryCode = (
    url.searchParams.get('c') || ''
  ).toUpperCase();

  const type =
    url.searchParams.get('t') || 'ciianalysis';

  const score = url.searchParams.get('s');

  const level = normalizeLevel(
    url.searchParams.get('l')
  );

  const countryName =
    COUNTRY_NAMES[countryCode] ||
    countryCode ||
    '全球';

  const levelColor =
    LEVEL_COLORS[level] || '#eab308';

  const levelLabel =
    LEVEL_LABELS[level] || '监测中';

  const parsedScore = score
    ? Number.parseInt(score, 10)
    : Number.NaN;

  const scoreNum = Number.isFinite(parsedScore)
    ? Math.max(0, Math.min(100, parsedScore))
    : null;

  const dateStr = new Date()
    .toISOString()
    .slice(0, 10);

  // 分数半圆仪表盘
  const arcRadius = 90;

  const arcCx = 960;

  const arcCy = 340;

  const scoreAngle =
    scoreNum !== null
      ? (scoreNum / 100) * Math.PI
      : 0;

  const arcEndX =
    arcCx - arcRadius * Math.cos(scoreAngle);

  const arcEndY =
    arcCy - arcRadius * Math.sin(scoreAngle);

  const largeArc = scoreNum > 50 ? 1 : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0c0c18"/>
      <stop offset="100%" stop-color="#0a0a12"/>
    </linearGradient>

    <linearGradient id="sidebar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${levelColor}"/>
      <stop offset="100%" stop-color="${levelColor}88"/>
    </linearGradient>
  </defs>

  <!-- 背景 -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- 左侧强调色边栏 -->
  <rect x="0" y="0" width="8" height="630" fill="url(#sidebar)"/>

  <!-- 顶部强调线 -->
  <rect
    x="8"
    y="0"
    width="1192"
    height="3"
    fill="${levelColor}"
    opacity="0.4"
  />

  <!-- 网格背景 -->
  <g opacity="0.03">
    ${Array.from(
      { length: 30 },
      (_, i) =>
        `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="630" stroke="#fff" stroke-width="1"/>`
    ).join('\n')}

    ${Array.from(
      { length: 16 },
      (_, i) =>
        `<line x1="0" y1="${i * 40}" x2="1200" y2="${i * 40}" stroke="#fff" stroke-width="1"/>`
    ).join('\n')}
  </g>

  <!-- 品牌 -->
  <text
    x="60"
    y="56"
    font-family="system-ui, sans-serif"
    font-size="18"
    font-weight="700"
    fill="${levelColor}"
    letter-spacing="6"
  >
    WORLDMONITOR
  </text>

  <!-- 状态标签 -->
  <rect
    x="290"
    y="38"
    width="${levelLabel.length * 18 + 24}"
    height="26"
    rx="13"
    fill="${levelColor}"
    opacity="0.15"
  />

  <text
    x="${290 + (levelLabel.length * 18 + 24) / 2}"
    y="56"
    font-family="system-ui, sans-serif"
    font-size="13"
    font-weight="700"
    fill="${levelColor}"
    text-anchor="middle"
  >
    ${levelLabel}
  </text>

  <!-- 日期 -->
  <text
    x="1140"
    y="56"
    font-family="system-ui, sans-serif"
    font-size="16"
    fill="#666"
    text-anchor="end"
  >
    ${dateStr}
  </text>

  <!-- 分隔线 -->
  <line
    x1="60"
    y1="76"
    x2="1140"
    y2="76"
    stroke="#222"
    stroke-width="1"
  />

  <!-- 国家名称 -->
  <text
    x="60"
    y="160"
    font-family="system-ui, sans-serif"
    font-size="82"
    font-weight="800"
    fill="#ffffff"
    letter-spacing="-1"
  >
    ${escapeXml(countryName.toUpperCase())}
  </text>

  <!-- 国家代码 -->
  <rect
    x="1060"
    y="120"
    width="80"
    height="44"
    rx="8"
    fill="rgba(255,255,255,0.08)"
    stroke="${levelColor}"
    stroke-width="1"
    stroke-opacity="0.3"
  />

  <text
    x="1100"
    y="150"
    font-family="system-ui, sans-serif"
    font-size="24"
    font-weight="700"
    fill="#aaa"
    text-anchor="middle"
  >
    ${escapeXml(countryCode)}
  </text>

  <!-- 副标题 -->
  <text
    x="60"
    y="200"
    font-family="system-ui, sans-serif"
    font-size="22"
    fill="#666"
    letter-spacing="3"
  >
    全球情报简报
  </text>

  ${
    scoreNum !== null
      ? `
  <!-- 左侧：指数信息 -->
  <text
    x="60"
    y="310"
    font-family="system-ui, sans-serif"
    font-size="120"
    font-weight="800"
    fill="${levelColor}"
  >
    ${scoreNum}
  </text>

  <text
    x="${60 + String(scoreNum).length * 68}"
    y="310"
    font-family="system-ui, sans-serif"
    font-size="48"
    fill="#555"
  >
    /100
  </text>

  <text
    x="60"
    y="345"
    font-family="system-ui, sans-serif"
    font-size="18"
    fill="#777"
    letter-spacing="4"
  >
    国家不稳定指数
  </text>

  <!-- 分数条 -->
  <rect
    x="60"
    y="370"
    width="560"
    height="12"
    rx="6"
    fill="#1a1a2e"
  />

  <rect
    x="60"
    y="370"
    width="${Math.min(scoreNum, 100) * 5.6}"
    height="12"
    rx="6"
    fill="${levelColor}"
  />

  <!-- 刻度 -->
  <line x1="200" y1="370" x2="200" y2="382" stroke="#333"/>
  <line x1="340" y1="370" x2="340" y2="382" stroke="#333"/>
  <line x1="480" y1="370" x2="480" y2="382" stroke="#333"/>

  <text x="60" y="402" font-size="12" fill="#555">0</text>
  <text x="197" y="402" font-size="12" fill="#555">25</text>
  <text x="334" y="402" font-size="12" fill="#555">50</text>
  <text x="474" y="402" font-size="12" fill="#555">75</text>
  <text x="600" y="402" font-size="12" fill="#555">100</text>

  <!-- 右侧：仪表盘 -->
  <path
    d="M ${arcCx - arcRadius},${arcCy}
       A ${arcRadius} ${arcRadius} 0 1 1 ${arcCx + arcRadius},${arcCy}"
    fill="none"
    stroke="#1a1a2e"
    stroke-width="16"
    stroke-linecap="round"
  />

  ${
    scoreNum > 0
      ? `
  <path
    d="M ${arcCx + arcRadius},${arcCy}
       A ${arcRadius} ${arcRadius} 0 ${largeArc} 0 ${arcEndX.toFixed(1)},${arcEndY.toFixed(1)}"
    fill="none"
    stroke="${levelColor}"
    stroke-width="16"
    stroke-linecap="round"
  />
  `
      : ''
  }

  <text
    x="${arcCx}"
    y="${arcCy - 20}"
    font-family="system-ui, sans-serif"
    font-size="52"
    font-weight="800"
    fill="${levelColor}"
    text-anchor="middle"
  >
    ${scoreNum}
  </text>

  <text
    x="${arcCx}"
    y="${arcCy + 10}"
    font-size="18"
    fill="#888"
    text-anchor="middle"
  >
    /100
  </text>

  <!-- 风险等级 -->
  <rect
    x="${arcCx - (level.length * 10 + 20) / 2}"
    y="${arcCy + 24}"
    width="${level.length * 10 + 20}"
    height="30"
    rx="6"
    fill="${levelColor}"
  />

  <text
    x="${arcCx}"
    y="${arcCy + 45}"
    font-size="16"
    font-weight="700"
    fill="#fff"
    text-anchor="middle"
  >
    ${level.toUpperCase()}
  </text>

  <!-- 数据标签 -->
  <line
    x1="60"
    y1="430"
    x2="1140"
    y2="430"
    stroke="#222"
  />

  <rect x="60" y="448" width="10" height="10" fill="#ef4444"/>
  <text x="80" y="458" font-size="15" fill="#aaa">
    威胁等级
  </text>

  <rect x="260" y="448" width="10" height="10" fill="#f97316"/>
  <text x="280" y="458" font-size="15" fill="#aaa">
    军事态势
  </text>

  <rect x="440" y="448" width="10" height="10" fill="#eab308"/>
  <text x="460" y="458" font-size="15" fill="#aaa">
    预测市场
  </text>

  <rect x="650" y="448" width="10" height="10" fill="#8b5cf6"/>
  <text x="670" y="458" font-size="15" fill="#aaa">
    信号收敛
  </text>

  <rect x="860" y="448" width="10" height="10" fill="#3b82f6"/>
  <text x="880" y="458" font-size="15" fill="#aaa">
    活跃信号
  </text>
  `
      : `
  <!-- 无分数时 -->
  <text
    x="60"
    y="290"
    font-family="system-ui, sans-serif"
    font-size="40"
    fill="#ddd"
    font-weight="600"
  >
    实时全球情报分析
  </text>
  `
  }

  <!-- 底部区域 -->
  <rect
    x="0"
    y="490"
    width="1200"
    height="140"
    fill="#080810"
  />

  <line
    x1="0"
    y1="490"
    x2="1200"
    y2="490"
    stroke="#222"
  />

  <!-- Logo -->
  <circle
    cx="92"
    cy="545"
    r="24"
    fill="none"
    stroke="${levelColor}"
    stroke-width="2"
  />

  <text
    x="92"
    y="551"
    font-size="18"
    font-weight="800"
    fill="${levelColor}"
    text-anchor="middle"
  >
    W
  </text>

  <text
    x="130"
    y="538"
    font-size="22"
    font-weight="700"
    fill="#ddd"
    letter-spacing="3"
  >
    WORLDMONITOR
  </text>

  <text
    x="130"
    y="562"
    font-size="15"
    fill="#777"
  >
    实时全球情报监测平台
  </text>

  <!-- 按钮 -->
  <rect
    x="920"
    y="524"
    width="220"
    height="42"
    rx="21"
    fill="${levelColor}"
  />

  <text
    x="1030"
    y="551"
    font-size="16"
    font-weight="700"
    fill="#fff"
    text-anchor="middle"
  >
    查看完整简报 →
  </text>

  <!-- 底部信息 -->
  <text
    x="60"
    y="610"
    font-size="14"
    fill="#555"
  >
    worldmonitor.app · ${dateStr} · 免费开源
  </text>

</svg>`;

  res.setHeader(
    'Content-Type',
    'image/svg+xml'
  );

  res.setHeader(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600'
  );

  res.status(200).send(svg);
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}