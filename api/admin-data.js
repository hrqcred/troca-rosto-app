const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY || 'troca2026';

async function redis(cmd) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return { result: null };
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  return res.json();
}

async function redisPipeline(cmds) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];
  const res = await fetch(UPSTASH_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  return res.json();
}

function getDates(days) {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const dates = getDates(days);
  const action = req.query.action || 'overview';

  try {
    if (action === 'overview') {
      // Get funnel data for each date
      const cmds = [];
      for (const d of dates) {
        cmds.push(['HGETALL', `funnel:${d}`]);
      }
      const results = await redisPipeline(cmds);

      const steps = ['page_view', 'demo_start', 'swap_on', 'demo_locked', 'checkout_view', 'form_filled', 'pix_generated', 'sale'];
      const totals = {};
      steps.forEach(s => totals[s] = 0);
      const perDay = {};

      dates.forEach((d, i) => {
        const r = results[i]?.result;
        const dayData = {};
        steps.forEach(s => dayData[s] = 0);
        if (r && Array.isArray(r)) {
          for (let j = 0; j < r.length; j += 2) {
            const k = r[j], v = parseInt(r[j + 1]) || 0;
            if (totals.hasOwnProperty(k)) {
              totals[k] += v;
              dayData[k] = v;
            }
          }
        }
        perDay[d] = dayData;
      });

      return res.status(200).json({ totals, perDay, dates, steps });
    }

    if (action === 'utm') {
      const cmds = [];
      for (const d of dates) {
        cmds.push(['HGETALL', `utm:${d}`]);
      }
      const results = await redisPipeline(cmds);

      const utmTotals = {};
      dates.forEach((d, i) => {
        const r = results[i]?.result;
        if (r && Array.isArray(r)) {
          for (let j = 0; j < r.length; j += 2) {
            const k = r[j], v = parseInt(r[j + 1]) || 0;
            utmTotals[k] = (utmTotals[k] || 0) + v;
          }
        }
      });

      // Get UTM funnel breakdown for top sources
      const utmFunnels = {};
      const topUtms = Object.entries(utmTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (topUtms.length > 0) {
        const funnelCmds = [];
        for (const [utmKey] of topUtms) {
          for (const d of dates) {
            funnelCmds.push(['HGETALL', `utm_funnel:${d}:${utmKey}`]);
          }
        }
        const funnelResults = await redisPipeline(funnelCmds);
        let idx = 0;
        for (const [utmKey] of topUtms) {
          utmFunnels[utmKey] = {};
          for (let di = 0; di < dates.length; di++) {
            const r = funnelResults[idx]?.result;
            if (r && Array.isArray(r)) {
              for (let j = 0; j < r.length; j += 2) {
                const k = r[j], v = parseInt(r[j + 1]) || 0;
                utmFunnels[utmKey][k] = (utmFunnels[utmKey][k] || 0) + v;
              }
            }
            idx++;
          }
        }
      }

      return res.status(200).json({ utmTotals, utmFunnels });
    }

    if (action === 'leads') {
      const d = req.query.date || dates[0];
      const vids = (await redis(['SMEMBERS', `leads:${d}`])).result || [];
      const leads = [];

      if (vids.length > 0) {
        const cmds = vids.slice(0, 100).map(vid => ['LRANGE', `lead:${vid}`, 0, -1]);
        const results = await redisPipeline(cmds);
        vids.slice(0, 100).forEach((vid, i) => {
          const events = (results[i]?.result || []).map(e => JSON.parse(e));
          const lastEvent = events[events.length - 1];
          const firstEvent = events[0];
          leads.push({
            vid: vid.slice(0, 8),
            email: events.find(e => e.email)?.email || null,
            events: events.map(e => e.event),
            lastStep: lastEvent?.event,
            enteredAt: new Date(firstEvent?.ts).toLocaleTimeString('pt-BR'),
            duration: lastEvent && firstEvent ? Math.round((lastEvent.ts - firstEvent.ts) / 1000) + 's' : '-'
          });
        });
      }

      leads.sort((a, b) => b.events.length - a.events.length);
      return res.status(200).json({ leads, date: d });
    }

    if (action === 'sales') {
      const allSales = [];
      const cmds = dates.map(d => ['LRANGE', `sales:${d}`, 0, -1]);
      const results = await redisPipeline(cmds);
      dates.forEach((d, i) => {
        const entries = results[i]?.result || [];
        entries.forEach(e => {
          const sale = JSON.parse(e);
          sale.date = d;
          allSales.push(sale);
        });
      });
      allSales.sort((a, b) => b.ts - a.ts);
      return res.status(200).json({ sales: allSales });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
