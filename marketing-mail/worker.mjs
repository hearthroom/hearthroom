import PostalMime from 'postal-mime';

const RECIPIENT = 'suki@sukisuki.ai';
const RETENTION_MS = 30 * 86400000;
const MAX_BYTES = 1024 * 1024;
const MAX_TEXT = 128 * 1024;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const event = outcome => console.log(JSON.stringify({ event: 'marketing_mail', outcome }));

function linksFrom(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"']+/g) || []).map(value => value.replace(/&amp;/g, '&'))) ].slice(0, 50);
}

async function recent(env, limit) {
  // Reverse timestamp keys make the newest messages first without scanning the bucket.
  const result = await env.MAIL.list({ prefix: 'mail/', limit, include: ['customMetadata'] });
  const cutoff = Date.now() - RETENTION_MS;
  return result.objects.filter(o => Date.parse(o.customMetadata?.receivedAt) > cutoff)
    .sort((a, b) => Date.parse(b.customMetadata.receivedAt) - Date.parse(a.customMetadata.receivedAt));
}

export default {
  async email(message, env) {
    // Envelope recipient is authoritative; case variants are the same mailbox, plus aliases are not.
    if (message.to.toLowerCase() !== RECIPIENT) { message.setReject('Unsupported recipient'); event('rejected'); return; }
    if (!env.FORWARD_TO) throw new Error('Forward destination is not configured');
    try { await message.forward(env.FORWARD_TO); }
    catch { event('forward_failed'); throw new Error('Mail forwarding failed'); }
    event('forwarded');
    try {
      if (message.rawSize > MAX_BYTES) { event('oversized'); return; }
      const raw = await new Response(message.raw).arrayBuffer();
      if (raw.byteLength > MAX_BYTES) { event('oversized'); return; }
      const parsed = await PostalMime.parse(raw);
      const receivedAt = new Date().toISOString();
      const text = (parsed.text || (parsed.html || '').replace(/<[^>]*>/g, ' ')).slice(0, MAX_TEXT);
      const mail = { from: (parsed.from?.address || message.from).slice(0, 2000),
        fromName: (parsed.from?.name || '').slice(0, 2000), envelopeFrom: message.from,
        subject: (parsed.subject || '').slice(0, 2000), receivedAt, text,
        links: linksFrom(text + '\n' + (parsed.html || '').slice(0, MAX_TEXT)) };
      const key = `mail/${String(9999999999999 - Date.now()).padStart(13, '0')}-${crypto.randomUUID()}.json`;
      await env.MAIL.put(key, JSON.stringify(mail), { customMetadata: { receivedAt }, httpMetadata: { contentType: 'application/json' } });
      event('archived');
    } catch { event('archive_failed'); } // Gmail delivery has succeeded; never retry it due to archive failure.
  },
  async fetch(request, env) {
    // No public inbox, cache, write endpoint, CORS or redirect.
    if (!env.READ_TOKEN || env.READ_TOKEN.length < 32 || request.headers.get('authorization') !== `Bearer ${env.READ_TOKEN}`) return json({ error: 'Unauthorized' }, 401);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const url = new URL(request.url);
    if (url.pathname === '/metrics') {
      try {
        const newest = (await recent(env, 1))[0];
        return new Response(`# TYPE suki_marketing_mail_archive_available gauge\nsuki_marketing_mail_archive_available 1\n# TYPE suki_marketing_mail_latest_received_timestamp_seconds gauge\nsuki_marketing_mail_latest_received_timestamp_seconds ${newest ? Date.parse(newest.customMetadata.receivedAt) / 1000 : 0}\n`, { headers: { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' } });
      } catch { return new Response('suki_marketing_mail_archive_available 0\n', { status: 503, headers: { 'cache-control': 'no-store' } }); }
    }
    if (url.pathname !== '/messages') return json({ error: 'Not found' }, 404);
    const value = url.searchParams.get('limit') ?? '5';
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(value)) return json({ error: 'limit must be 1..20' }, 400);
    try {
      const messages = [];
      for (const item of await recent(env, Number(value))) {
        const object = await env.MAIL.get(item.key);
        if (object) messages.push(await object.json());
      }
      return json({ messages });
    } catch { event('read_failed'); return json({ error: 'Archive unavailable' }, 503); }
  },
};
