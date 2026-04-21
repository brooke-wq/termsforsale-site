const { complete } = require('./_claude');
const { postNote, sendSmsToBrooke, sendEmailToContact } = require('./_ghl');

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_DB_ID = 'a3c0a38fd9294d758dedabab2548ff29';
const RENTCAST_BASE = 'https://api.rentcast.io/v1';
const BROOKE_CONTACT_ID = process.env.BROOKE_CONTACT_ID || '1HMBtAv9EuTlJa5EekAL';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const CLAUDE_SYSTEM = `You are a concise real-estate wholesale operator writing dispo narrative for a creative-finance deal. You will be handed a JSON blob with deal basics (address, beds/baths/sqft/year, asking price, deal type, entry fee) plus enrichment pulled from RentCast (property record, AVM value, AVM rent, top comps) and HUD Fair Market Rents.

Your job: turn that blob into a short, honest write-up for Terms For Sale's internal deal package. Buyers are wholesalers, landlords, and BRRRR operators.

Output strict JSON with exactly these keys:
- \`hook\` — ONE sentence, 180 characters or fewer. Lead with the numeric angle. No hype words. No exclamation points.
- \`whyExists\` — 1 to 2 sentences on the owner's likely motivation and creative-finance angle.
- \`strategies\` — 2 to 4 bullet strategies joined with \\n. Each bullet starts with a verb.
- \`buyerFitYes\` — 1 to 2 sentences describing the ideal buyer specifically.
- \`redFlags\` — 0 to 3 bullets joined with \\n, or empty string "" if none.
- \`confidence\` — "High", "Medium", or "Low". High = AVM + comps + HUD all populated and agree within 10%. Medium = AVM present but comps sparse. Low = missing AVM or HUD or fewer than 2 comps.`;

function notionHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function prop(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  switch (p.type) {
    case 'rich_text': return (p.rich_text || []).map(r => r.plain_text).join('') || null;
    case 'title':     return (p.title || []).map(r => r.plain_text).join('') || null;
    case 'number':    return p.number != null ? p.number : null;
    case 'select':    return p.select ? p.select.name : null;
    case 'status':    return p.status ? p.status.name : null;
    case 'date':      return p.date ? p.date.start : null;
    case 'url':       return p.url || null;
    case 'checkbox':  return p.checkbox;
    default:          return null;
  }
}

async function patchNotion(token, pageId, properties) {
  let props = { ...properties };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(NOTION_BASE + '/pages/' + pageId, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ properties: props })
    });
    if (res.status === 200) return { ok: true };
    const errStr = await res.text().catch(() => '');
    const toDrop = new Set();
    const notAProp = errStr.match(/`?([^`"]+?)`? is not a property that exists/g) || [];
    notAProp.forEach(m => {
      const name = m.replace(/`/g, '').replace(/\s+is not a property that exists\.?/, '').trim();
      if (name && props[name]) toDrop.add(name);
    });
    const typeMismatch = errStr.match(/([A-Za-z][A-Za-z0-9 _\-/]+?) is expected to be [a-z_]+/g) || [];
    typeMismatch.forEach(m => {
      const name = m.replace(/\s+is expected to be.+$/, '').trim();
      if (name && props[name]) toDrop.add(name);
    });
    if (toDrop.size) {
      toDrop.forEach(name => delete props[name]);
      if (!Object.keys(props).length) return { ok: false, error: 'all props dropped', lastError: errStr.slice(0, 200) };
      continue;
    }
    return { ok: false, status: res.status, error: errStr.slice(0, 200) };
  }
  return { ok: false, error: 'max retries' };
}

async function fetchRentcastProperty(apiKey, address, city, state, zipCode) {
  const params = new URLSearchParams({ address, city, state, zipCode });
  const res = await fetch(RENTCAST_BASE + '/properties?' + params.toString(), {
    headers: { 'X-Api-Key': apiKey }
  });
  if (!res.ok) throw new Error('RentCast property ' + res.status);
  return res.json();
}

async function fetchRentcastAvmValue(apiKey, address, city, state, zipCode) {
  const params = new URLSearchParams({ address, city, state, zipCode });
  const res = await fetch(RENTCAST_BASE + '/avm/value?' + params.toString(), {
    headers: { 'X-Api-Key': apiKey }
  });
  if (!res.ok) throw new Error('RentCast AVM value ' + res.status);
  return res.json();
}

async function fetchRentcastAvmRent(apiKey, address, city, state, zipCode) {
  const params = new URLSearchParams({ address, city, state, zipCode });
  const res = await fetch(RENTCAST_BASE + '/avm/rent/long-term?' + params.toString(), {
    headers: { 'X-Api-Key': apiKey }
  });
  if (!res.ok) throw new Error('RentCast AVM rent ' + res.status);
  return res.json();
}

async function fetchHudFmr(state, city, beds) {
  const params = new URLSearchParams({ state, city, beds: String(beds || 3) });
  const res = await fetch('https://termsforsale.com/api/hud-fmr?' + params.toString());
  if (!res.ok) throw new Error('HUD FMR ' + res.status);
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const authToken = process.env.AUTOENRICH_AUTH_TOKEN;
    if (!authToken) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'AUTOENRICH_AUTH_TOKEN not configured' }) };
    }

    const authHeader = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
    const xAuthToken = (event.headers || {})['x-auth-token'] || (event.headers || {})['X-Auth-Token'] || '';
    const provided = authHeader.replace(/^Bearer\s+/i, '').trim() || xAuthToken.trim();

    if (provided !== authToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const { pageId, dryRun } = body;
    if (!pageId || typeof pageId !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(pageId.replace(/-/g, ''))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'pageId is required and must be a valid Notion page ID' }) };
    }

    const notionToken = process.env.NOTION_TOKEN;
    const rentcastKey = process.env.RENTCAST_API_KEY;
    const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    const ghlKey = process.env.GHL_API_KEY;
    const renderUrl = process.env.RENDER_SERVICE_URL || 'http://64.23.204.220:3001/render';
    const renderToken = process.env.RENDER_SERVICE_TOKEN;

    if (!notionToken) return { statusCode: 500, headers, body: JSON.stringify({ error: 'NOTION_TOKEN not configured' }) };

    const pageRes = await fetch(NOTION_BASE + '/pages/' + pageId, {
      headers: notionHeaders(notionToken)
    });
    if (!pageRes.ok) {
      const t = await pageRes.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Notion fetch failed: ' + pageRes.status, detail: t.slice(0, 200) }) };
    }
    const page = await pageRes.json();

    const streetAddress = prop(page, 'Street Address') || '';
    const city = prop(page, 'City') || '';
    const state = prop(page, 'State') || '';
    const zip = prop(page, 'ZIP') || '';
    const dealId = prop(page, 'Deal ID') || '';
    const dealType = prop(page, 'Deal Type') || '';
    const askingPrice = prop(page, 'Asking Price');
    const existingArv = prop(page, 'ARV');
    const existingBeds = prop(page, 'Beds');
    const existingBaths = prop(page, 'Baths');
    const existingLivingArea = prop(page, 'Living Area');
    const existingYearBuilt = prop(page, 'Year Built');
    const entryFee = prop(page, 'Entry Fee');
    const loanBalance = prop(page, 'Loan Balance');
    const interestRate = prop(page, 'Interest Rate');
    const piti = prop(page, 'PITI');

    const fullAddress = [streetAddress, city, state, zip].filter(Boolean).join(', ');
    console.log('[auto-enrich] pageId=' + pageId + ' dealId=' + dealId + ' address=' + fullAddress);

    const [rcPropResult, rcAvmResult, rcRentResult, hudResult] = await Promise.allSettled([
      rentcastKey && streetAddress ? withTimeout(fetchRentcastProperty(rentcastKey, streetAddress, city, state, zip), 6000) : Promise.reject(new Error('no rentcast key or address')),
      rentcastKey && streetAddress ? withTimeout(fetchRentcastAvmValue(rentcastKey, streetAddress, city, state, zip), 6000) : Promise.reject(new Error('no rentcast key or address')),
      rentcastKey && streetAddress ? withTimeout(fetchRentcastAvmRent(rentcastKey, streetAddress, city, state, zip), 6000) : Promise.reject(new Error('no rentcast key or address')),
      city && state ? withTimeout(fetchHudFmr(state, city, existingBeds || 3), 6000) : Promise.reject(new Error('no city or state'))
    ]);

    const rcProp = rcPropResult.status === 'fulfilled' ? rcPropResult.value : null;
    const rcAvm  = rcAvmResult.status  === 'fulfilled' ? rcAvmResult.value  : null;
    const rcRent = rcRentResult.status === 'fulfilled' ? rcRentResult.value : null;
    const hud    = hudResult.status    === 'fulfilled' ? hudResult.value    : null;

    if (rcPropResult.status === 'rejected') console.warn('[auto-enrich] RentCast property failed:', rcPropResult.reason && rcPropResult.reason.message);
    if (rcAvmResult.status  === 'rejected') console.warn('[auto-enrich] RentCast AVM failed:', rcAvmResult.reason && rcAvmResult.reason.message);
    if (rcRentResult.status === 'rejected') console.warn('[auto-enrich] RentCast rent failed:', rcRentResult.reason && rcRentResult.reason.message);
    if (hudResult.status    === 'rejected') console.warn('[auto-enrich] HUD FMR failed:', hudResult.reason && hudResult.reason.message);

    const enriched = {
      dealId,
      fullAddress,
      city,
      state,
      zip,
      dealType,
      askingPrice,
      entryFee,
      loanBalance,
      interestRate,
      piti,
      rcProperty: rcProp ? {
        beds: rcProp.bedrooms,
        baths: rcProp.bathrooms,
        sqft: rcProp.squareFootage,
        yearBuilt: rcProp.yearBuilt,
        lotSize: rcProp.lotSize,
        propertyType: rcProp.propertyType
      } : null,
      rcAvm: rcAvm ? {
        value: rcAvm.price,
        valueRangeLow: rcAvm.priceRangeLow,
        valueRangeHigh: rcAvm.priceRangeHigh,
        comps: (rcAvm.comparables || []).slice(0, 4).map(c => ({
          address: c.formattedAddress,
          price: c.price,
          sqft: c.squareFootage,
          distance: c.distance
        }))
      } : null,
      rcRent: rcRent ? {
        rent: rcRent.rent,
        rentRangeLow: rcRent.rentRangeLow,
        rentRangeHigh: rcRent.rentRangeHigh,
        comps: (rcRent.comparables || []).slice(0, 4).map(c => ({
          address: c.formattedAddress,
          rent: c.price,
          distance: c.distance
        }))
      } : null,
      hud: hud ? {
        ltr: hud.ltr,
        ltrLow: hud.ltrLow,
        ltrHigh: hud.ltrHigh,
        marketTier: hud.marketTier,
        metro: hud.metro
      } : null
    };

    let narrative = null;
    let claudeUsage = null;

    if (claudeKey) {
      try {
        const claudeResult = await complete(claudeKey, {
          system: CLAUDE_SYSTEM,
          user: JSON.stringify(enriched),
          maxTokens: 600,
          json: true,
          model: HAIKU_MODEL
        });
        narrative = claudeResult.text;
        claudeUsage = claudeResult.usage;
        console.log('[auto-enrich] Claude narrative generated, confidence=' + (narrative && narrative.confidence));
      } catch (e) {
        console.error('[auto-enrich] Claude failed:', e.message);
      }
    } else {
      console.warn('[auto-enrich] CLAUDE_API_KEY not set — skipping narrative');
    }

    let notionPatched = { ok: false, skipped: true };
    if (!dryRun) {
      const notionProps = {};

      const estRent = (rcRent && rcRent.rent) || (hud && hud.ltr);
      if (estRent) {
        notionProps['LTR Market Rent'] = { number: Math.round(estRent) };
      }

      notionProps['Enriched at'] = { date: { start: new Date().toISOString().split('T')[0] } };

      if (!existingArv && rcAvm && rcAvm.price) {
        notionProps['ARV'] = { number: Math.round(rcAvm.price) };
      }
      if (existingBeds == null && rcProp && rcProp.beds != null) {
        notionProps['Beds'] = { number: rcProp.beds };
      }
      if (existingBaths == null && rcProp && rcProp.baths != null) {
        notionProps['Baths'] = { number: rcProp.baths };
      }
      if (existingLivingArea == null && rcProp && rcProp.sqft != null) {
        notionProps['Living Area'] = { number: rcProp.sqft };
      }
      if (existingYearBuilt == null && rcProp && rcProp.yearBuilt != null) {
        notionProps['Year Built'] = { number: rcProp.yearBuilt };
      }

      if (narrative && narrative.hook) {
        notionProps['Description'] = {
          rich_text: [{ type: 'text', text: { content: narrative.hook.slice(0, 2000) } }]
        };
      }

      notionPatched = await patchNotion(notionToken, pageId, notionProps);
      console.log('[auto-enrich] Notion patch:', JSON.stringify(notionPatched));
    }

    let driveFileId = null;
    let driveWebViewLink = null;

    if (!dryRun && renderToken) {
      try {
        const renderBody = {
          dealId: dealId || pageId.slice(0, 8),
          deal: {
            streetAddress,
            city,
            state,
            zip,
            dealType,
            askingPrice,
            entryFee,
            loanBalance,
            interestRate,
            piti,
            beds: (rcProp && rcProp.beds) || existingBeds,
            baths: (rcProp && rcProp.baths) || existingBaths,
            sqft: (rcProp && rcProp.sqft) || existingLivingArea,
            yearBuilt: (rcProp && rcProp.yearBuilt) || existingYearBuilt,
            arv: (rcAvm && rcAvm.price) || existingArv,
            estRent: (rcRent && rcRent.rent) || (hud && hud.ltr),
            hook: narrative && narrative.hook,
            whyExists: narrative && narrative.whyExists,
            strategies: narrative && narrative.strategies,
            buyerFitYes: narrative && narrative.buyerFitYes,
            analysis: narrative ? JSON.stringify({ redFlags: narrative.redFlags, confidence: narrative.confidence }) : null
          }
        };

        const renderRes = await withTimeout(fetch(renderUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': renderToken },
          body: JSON.stringify(renderBody)
        }), 15000);

        if (renderRes.ok) {
          const renderData = await renderRes.json();
          driveFileId = renderData.driveFileId;
          driveWebViewLink = renderData.driveWebViewLink;
          console.log('[auto-enrich] Render OK driveFileId=' + driveFileId);
        } else {
          const rt = await renderRes.text().catch(() => '');
          console.error('[auto-enrich] Render failed:', renderRes.status, rt.slice(0, 200));
        }
      } catch (e) {
        console.error('[auto-enrich] Render error:', e.message);
      }
    }

    if (!dryRun && ghlKey) {
      const addr = streetAddress ? streetAddress + ', ' + city + ', ' + state : city + ', ' + state;
      const summaryLines = [
        '🏠 Auto-Enrichment Complete',
        'Deal: ' + (dealId || pageId.slice(0, 8)),
        'Address: ' + addr,
        'Deal Type: ' + (dealType || 'Unknown'),
        'Asking: ' + (askingPrice ? '$' + Number(askingPrice).toLocaleString() : '—'),
        '',
        'Enrichment Results:',
        rcAvm && rcAvm.price ? '• AVM Value: $' + Number(rcAvm.price).toLocaleString() : '• AVM Value: not available',
        rcRent && rcRent.rent ? '• AVM Rent: $' + Math.round(rcRent.rent) + '/mo' : '• AVM Rent: not available',
        hud && hud.ltr ? '• HUD FMR: $' + Math.round(hud.ltr) + '/mo (' + (hud.marketTier || '') + ')' : '• HUD FMR: not available',
        narrative ? '• Narrative: ' + (narrative.confidence || '') + ' confidence' : '• Narrative: skipped',
        driveFileId ? '• Drive doc: ' + (driveWebViewLink || driveFileId) : '• Drive doc: not generated',
        notionPatched.ok ? '• Notion: updated' : '• Notion: ' + (notionPatched.error || 'not patched')
      ];

      try {
        await postNote(ghlKey, BROOKE_CONTACT_ID, summaryLines.join('\n'));
      } catch (e) {
        console.error('[auto-enrich] GHL note failed:', e.message);
      }

      const smsText = 'Auto-enrich done: ' + (dealId || addr) +
        (rcAvm && rcAvm.price ? ' | AVM $' + Number(rcAvm.price).toLocaleString() : '') +
        (rcRent && rcRent.rent ? ' | Rent $' + Math.round(rcRent.rent) + '/mo' : '') +
        (narrative ? ' | ' + (narrative.confidence || '') + ' confidence' : '');

      try {
        await sendSmsToBrooke(smsText);
      } catch (e) {
        console.error('[auto-enrich] SMS failed:', e.message);
      }

      if (narrative) {
        const emailHtml = `<h2>Auto-Enrichment: ${dealId || addr}</h2>
<p><strong>Address:</strong> ${fullAddress}</p>
<p><strong>Deal Type:</strong> ${dealType || '—'} &nbsp;|&nbsp; <strong>Asking:</strong> ${askingPrice ? '$' + Number(askingPrice).toLocaleString() : '—'}</p>
<hr>
<h3>Market Data</h3>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
  <tr><td><strong>AVM Value</strong></td><td>${rcAvm && rcAvm.price ? '$' + Number(rcAvm.price).toLocaleString() : '—'}</td></tr>
  <tr><td><strong>AVM Rent</strong></td><td>${rcRent && rcRent.rent ? '$' + Math.round(rcRent.rent) + '/mo' : '—'}</td></tr>
  <tr><td><strong>HUD FMR</strong></td><td>${hud && hud.ltr ? '$' + Math.round(hud.ltr) + '/mo (' + (hud.marketTier || '') + ')' : '—'}</td></tr>
  ${driveWebViewLink ? '<tr><td><strong>Deal Doc</strong></td><td><a href="' + driveWebViewLink + '">View in Drive</a></td></tr>' : ''}
</table>
<hr>
<h3>AI Narrative</h3>
<p><strong>Hook:</strong> ${narrative.hook || '—'}</p>
<p><strong>Why It Exists:</strong> ${narrative.whyExists || '—'}</p>
<p><strong>Strategies:</strong><br>${(narrative.strategies || '').replace(/\n/g, '<br>')}</p>
<p><strong>Ideal Buyer:</strong> ${narrative.buyerFitYes || '—'}</p>
${narrative.redFlags ? '<p><strong>Red Flags:</strong><br>' + narrative.redFlags.replace(/\n/g, '<br>') + '</p>' : ''}
<p><strong>Confidence:</strong> ${narrative.confidence || '—'}</p>`;

        try {
          await sendEmailToContact({
            contactId: BROOKE_CONTACT_ID,
            subject: 'Auto-Enrichment: ' + (dealId || addr),
            html: emailHtml
          });
        } catch (e) {
          console.error('[auto-enrich] Email failed:', e.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        dryRun: !!dryRun,
        dealId,
        fullAddress,
        enriched,
        narrative,
        notionPatched,
        driveFileId,
        driveLink: driveWebViewLink,
        claudeUsage
      })
    };
  } catch (err) {
    console.error('[auto-enrich] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
