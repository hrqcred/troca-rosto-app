const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  return res.json();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { event, vid, utm, email, amount } = req.body;
    if (!event || !vid) return res.status(400).json({ error: 'Missing event or vid' });

    const d = today();
    const ts = Date.now();

    // Increment funnel counter
    await redis(['HINCRBY', `funnel:${d}`, event, 1]);

    // Track UTM source
    if (utm && utm.source) {
      const utmKey = [utm.source, utm.medium || '', utm.campaign || '', utm.content || ''].join('|');
      await redis(['HINCRBY', `utm:${d}`, utmKey, 1]);
      await redis(['HINCRBY', `utm_funnel:${d}:${utmKey}`, event, 1]);
    }

    // Store lead event
    const entry = JSON.stringify({ event, vid, utm: utm || null, email: email || null, amount: amount || null, ts });
    await redis(['LPUSH', `events:${d}`, entry]);

    // Keep list of active dates
    await redis(['SADD', 'dates', d]);

    // Track individual lead journey
    await redis(['RPUSH', `lead:${vid}`, JSON.stringify({ event, ts, email, amount })]);
    await redis(['SADD', `leads:${d}`, vid]);

    // If sale, store separately
    if (event === 'sale') {
      const saleEntry = JSON.stringify({ vid, utm: utm || null, email: email || null, amount, ts });
      await redis(['LPUSH', `sales:${d}`, saleEntry]);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true });
  }
};
