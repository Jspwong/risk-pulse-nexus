// Non-sebuf: 返回 XML/HTML，保持为独立 Vercel Function
/**
 * 社交平台爬虫专用 Story 页面
 * 返回带有 og:image 和 twitter:card 的 HTML Meta 标签
 * Twitter / Facebook / LinkedIn 爬虫访问这里
 * 普通用户则会被重定向到 SPA 页面
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

const BOT_UA =
  /twitterbot|facebookexternalhit|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|redditbot|googlebot/i;

export default function handler(req, res) {
  const url = new URL(req.url, 'https://worldmonitor.app');

  const countryCode = (url.searchParams.get('c') || '').toUpperCase();

  const type = url.searchParams.get('t') || 'ciianalysis';

  const ts = url.searchParams.get('ts') || '';

  const score = url.searchParams.get('s') || '';

  const level = url.searchParams.get('l') || '';

  const ua = req.headers['user-agent'] || '';

  const isBot = BOT_UA.test(ua);

  const baseUrl = 'https://worldmonitor.app';

  const spaUrl =
    `${baseUrl}/?c=${countryCode}&t=${type}` +
    `${ts ? `&ts=${ts}` : ''}`;

  // 普通用户 → 重定向到 SPA 页面
  if (!isBot) {
    res.writeHead(302, {
      Location: spaUrl,
    });

    res.end();

    return;
  }

  // 爬虫 → 返回 Meta 标签页面
  const countryName =
    COUNTRY_NAMES[countryCode] ||
    countryCode ||
    '全球';

  const title =
    `${countryName} 情报简报 | World Monitor`;

  const description =
    `${countryName} 实时局势分析。包含国家不稳定指数、军事态势、威胁等级以及预测市场数据。免费开源的全球地缘政治情报平台。`;

  const imageParams =
    `c=${countryCode}&t=${type}` +
    `${score ? `&s=${score}` : ''}` +
    `${level ? `&l=${level}` : ''}`;

  const imageUrl =
    `${baseUrl}/api/og-story?${imageParams}`;

  const storyUrl =
    `${baseUrl}/api/story?c=${countryCode}&t=${type}` +
    `${ts ? `&ts=${ts}` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>

  <title>${esc(title)}</title>

  <meta
    name="description"
    content="${esc(description)}"
  />

  <!-- Open Graph -->
  <meta property="og:type" content="article"/>

  <meta
    property="og:title"
    content="${esc(title)}"
  />

  <meta
    property="og:description"
    content="${esc(description)}"
  />

  <meta
    property="og:image"
    content="${esc(imageUrl)}"
  />

  <meta property="og:image:width" content="1200"/>

  <meta property="og:image:height" content="630"/>

  <meta
    property="og:url"
    content="${esc(storyUrl)}"
  />

  <meta
    property="og:site_name"
    content="World Monitor"
  />

  <!-- Twitter Card -->
  <meta
    name="twitter:card"
    content="summary_large_image"
  />

  <meta
    name="twitter:site"
    content="@WorldMonitorApp"
  />

  <meta
    name="twitter:title"
    content="${esc(title)}"
  />

  <meta
    name="twitter:description"
    content="${esc(description)}"
  />

  <meta
    name="twitter:image"
    content="${esc(imageUrl)}"
  />

  <link
    rel="canonical"
    href="${esc(storyUrl)}"
  />
</head>

<body>
  <h1>${esc(title)}</h1>

  <p>${esc(description)}</p>

  <p>
    <a href="${esc(spaUrl)}">
      查看实时分析
    </a>
  </p>
</body>
</html>`;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'public, max-age=300, s-maxage=300, stale-while-revalidate=60'
  );

  res.status(200).send(html);
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}