/**
 * Cloudflare Pages Function: /rss-proxy
 *
 * Server-side RSS proxy — fetches an RSS feed and returns JSON.
 * Bypasses CORS restrictions that prevent direct browser fetch.
 *
 * Usage: GET /rss-proxy?url=<encoded-rss-url>&count=30
 *
 * Returns:
 *   { status: "ok", items: [...] }
 *   { status: "error", message: "..." }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const MAX_ITEMS = 50;
const FETCH_TIMEOUT_MS = 8000;

export async function onRequestGet(context) {
  const { request } = context;
  const { searchParams } = new URL(request.url);
  const rssUrl = searchParams.get('url');
  const count  = Math.min(parseInt(searchParams.get('count') || '30', 10), MAX_ITEMS);

  if (!rssUrl) {
    return json({ status: 'error', message: 'Missing ?url= parameter' }, 400);
  }

  // Allow only http(s) URLs
  let parsed;
  try {
    parsed = new URL(rssUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return json({ status: 'error', message: 'Invalid URL' }, 400);
  }

  // Fetch with timeout
  let rssText;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(rssUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'trump-monitor-rss-proxy/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return json({ status: 'error', message: `Upstream ${res.status}` }, 502);
    rssText = await res.text();
  } catch (err) {
    return json({ status: 'error', message: `Fetch failed: ${err.message}` }, 502);
  }

  // Parse XML
  let items;
  try {
    items = parseRss(rssText, count);
  } catch (err) {
    return json({ status: 'error', message: `XML parse failed: ${err.message}` }, 502);
  }

  return json({ status: 'ok', items }, 200, {
    'Cache-Control': 'public, max-age=300', // cache 5 min at edge
  });
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...extra },
  });
}

/**
 * Minimal RSS/Atom XML parser using regex — no DOM parser needed in Workers.
 * Handles RSS 2.0 and Atom 1.0.
 */
function parseRss(xml, count) {
  const items = [];

  // Detect Atom vs RSS
  const isAtom = /<feed[\s>]/i.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';

  const itemRe = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, 'gi');
  let m;

  while ((m = itemRe.exec(xml)) !== null && items.length < count) {
    const block = m[1];

    const title   = extractTag(block, 'title');
    const link    = extractLink(block, isAtom);
    const pubDate = extractPubDate(block, isAtom);
    const desc    = extractDesc(block, isAtom);

    if (!title || !link) continue;

    items.push({ title, link, pubDate, description: desc });
  }

  return items;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return decodeEntities(stripCdata(m[1]).trim());
}

function extractLink(block, isAtom) {
  if (isAtom) {
    // <link href="..." rel="alternate"/> or <link href="..."/>
    const m = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*(?:rel=["']alternate["'][^>]*)?\/?>/i)
           || block.match(/<link[^>]*rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*\/?>/i)
           || block.match(/<link[^>]+href=["']([^"']+)["']/i);
    return m ? m[1] : '';
  }
  // RSS: <link>url</link> (sometimes inside CDATA)
  const m = block.match(/<link>([^<]+)<\/link>/i)
         || block.match(/<link><!\[CDATA\[([^\]]+)\]\]><\/link>/i);
  return m ? m[1].trim() : '';
}

function extractPubDate(block, isAtom) {
  if (isAtom) {
    const m = block.match(/<(?:published|updated)>([^<]+)<\/(?:published|updated)>/i);
    return m ? m[1].trim() : new Date().toISOString();
  }
  const m = block.match(/<pubDate>([^<]+)<\/pubDate>/i);
  return m ? m[1].trim() : new Date().toUTCString();
}

function extractDesc(block, isAtom) {
  if (isAtom) {
    const m = block.match(/<(?:summary|content)(?:[^>]*)>([\s\S]*?)<\/(?:summary|content)>/i);
    return m ? decodeEntities(stripCdata(stripHtml(m[1]))).trim().slice(0, 300) : '';
  }
  const m = block.match(/<description>([\s\S]*?)<\/description>/i);
  return m ? decodeEntities(stripCdata(stripHtml(m[1]))).trim().slice(0, 300) : '';
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
