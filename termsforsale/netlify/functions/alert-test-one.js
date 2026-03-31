/**
 * One-off test: tag a single contact with deal alert data
 * GET /api/alert-test-one?contact_id=XXX&deal_id=YYY
 *
 * This populates the alert custom fields and adds the new-deal-alert tag
 * so we can verify the GHL workflow fires.
 */

exports.handler = async (event) => {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return respond(500, { error: 'Missing env vars' });

  const contactId = event.queryStringParameters?.contact_id || 'Lp1OMHH6TeIctnSkO3dW'; // Brooke's ID
  const dealId = event.queryStringParameters?.deal_id;

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Get a deal to use for alert data
    let deal;
    if (dealId) {
      // Fetch from Notion
      const notionRes = await fetch(`https://api.notion.com/v1/pages/${dealId}`, {
        headers: { 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
      });
      if (notionRes.ok) {
        const page = await notionRes.json();
        const p = page.properties;
        deal = {
          id: dealId,
          type: getText(p['Deal Type']),
          address: getText(p['Street Address']) + ', ' + getText(p['City']) + ', ' + getText(p['State']),
          city: getText(p['City']),
          state: getText(p['State']),
          price: getNum(p['Asking Price']),
          entry: getNum(p['Entry Fee']),
          beds: getText(p['Beds']),
          baths: getText(p['Baths']),
          sqft: getText(p['Living Area']),
          yearBuilt: getText(p['Year Built']),
          highlights: getText(p['Highlight 1']),
          propertyType: getText(p['Property Type']),
        };
      }
    }

    // Fallback test data if no deal found
    if (!deal) {
      deal = {
        id: '31a090d6-75e7-819a-8f68-dc78ce853c15',
        type: 'SubTo',
        address: '20768 W Hamilton St, Buckeye, AZ',
        city: 'Buckeye',
        state: 'AZ',
        price: 447010,
        entry: 51465,
        beds: '4',
        baths: '2.5',
        sqft: '2,203',
        yearBuilt: '2021',
        highlights: 'Built 2021, excellent condition, below market PITI',
        propertyType: 'Single Family',
      };
    }

    // Update contact with alert fields
    const customFields = [
      { key: 'alert_asking_price', field_value: '$' + Number(deal.price).toLocaleString() },
      { key: 'alert_entry_fee', field_value: '$' + Number(deal.entry).toLocaleString() },
      { key: 'alert_beds', field_value: deal.beds + ' beds' },
      { key: 'alert_baths', field_value: deal.baths + ' baths' },
      { key: 'alert_sqft', field_value: deal.sqft + ' sqft' },
      { key: 'alert_year_built', field_value: 'Built in ' + deal.yearBuilt },
      { key: 'alert_highlights', field_value: deal.highlights },
      { key: 'alert_property_type', field_value: deal.propertyType },
      { key: 'alert_city', field_value: deal.city },
      { key: 'alert_state', field_value: deal.state },
      { key: 'alert_deal_id', field_value: deal.id },
    ];

    // Update contact
    const updateRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ customFields }),
    });
    const updateData = await updateRes.json();

    // Add tag
    const tagRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags: ['new-deal-alert'] }),
    });
    const tagData = await tagRes.json();

    return respond(200, {
      success: true,
      contactId,
      deal: deal.address + ' — ' + deal.type + ' — $' + Number(deal.price).toLocaleString(),
      fieldsUpdated: updateRes.ok,
      tagApplied: tagRes.ok,
      message: 'Tag "new-deal-alert" applied. Check GHL for workflow trigger.',
    });

  } catch (err) {
    return respond(500, { error: err.message });
  }
};

function getText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.select) return prop.select?.name || '';
  if (prop.status) return prop.status?.name || '';
  if (prop.number !== undefined) return String(prop.number || '');
  return '';
}
function getNum(prop) {
  if (!prop) return 0;
  if (prop.number !== undefined) return prop.number || 0;
  return 0;
}
function respond(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
