import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const url = event.queryStringParameters?.['url'];

  if (!url || !url.startsWith('http')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid URL' }),
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    const text = await response.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
