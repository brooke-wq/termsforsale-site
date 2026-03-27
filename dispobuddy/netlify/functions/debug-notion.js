exports.handler = async (event) => {
  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  
  const results = {
    hasToken: !!token,
    tokenPrefix: token ? token.substring(0, 10) + '...' : 'NOT SET',
    dbId: dbId,
  };

  if (!token) {
    return { statusCode: 200, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: JSON.stringify(results, null, 2) };
  }

  // Try to query the database to confirm access
  try {
    const dbRes = await fetch('https://api.notion.com/v1/databases/' + dbId, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
      }
    });
    const dbData = await dbRes.json();
    results.dbAccess = dbRes.status;
    results.dbTitle = dbData.title ? dbData.title.map(t => t.plain_text).join('') : 'unknown';
    
    // List property names and types
    if (dbData.properties) {
      results.properties = {};
      Object.entries(dbData.properties).forEach(([name, prop]) => {
        results.properties[name] = prop.type;
      });
    }
    if (dbData.code) results.error = dbData.message;
  } catch(err) {
    results.dbError = err.message;
  }

  // Try creating a test page
  try {
    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Street Address': { title: [{ text: { content: 'DEBUG TEST — Delete Me' } }] },
        }
      })
    });
    const createData = await createRes.json();
    results.createTest = { status: createRes.status, id: createData.id, error: createData.message };
  } catch(err) {
    results.createError = err.message;
  }

  return { statusCode: 200, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: JSON.stringify(results, null, 2) };
};
