// ============================================================================
// SESSION 3 — APPEND THESE EXPORTS TO YOUR EXISTING termsforsale/netlify/functions/_ghl.js
// ============================================================================
// Do NOT replace _ghl.js wholesale — open it and paste the functions below
// just before the final `module.exports = { ... }` line, then add the new
// names to the module.exports object.
//
// New exports to add: advanceOpportunityStage, findContactByEmail, findOpportunityByContactAndDealCode, sendTokenizedDataRoomEmail
// ============================================================================

// Move an opportunity to a different stage in the same pipeline.
async function advanceOpportunityStage({ opportunityId, pipelineId, stageName }) {
  const stageId = await getStageIdByName(pipelineId, stageName);
  if (isTest()) {
    console.log('[TEST_MODE] GHL PUT /opportunities/' + opportunityId, { stageId, stageName });
    return { ok: true, test: true, opportunityId, stageId };
  }
  return await ghlFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({
      pipelineId,
      pipelineStageId: stageId,
      status: 'open',
    }),
  });
}

// Find an existing contact by email — used by webhook handler when GHL sends a signed-doc event.
async function findContactByEmail(email) {
  if (isTest()) return { id: 'test-contact-id', email };
  const res = await ghlFetch(`/contacts/search/duplicate?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`);
  return res?.contact || null;
}

// Find the most recent opportunity for a given contact + deal code in the Commercial pipeline.
async function findOpportunityByContactAndDealCode({ contactId, pipelineId, dealCode }) {
  if (isTest()) return { id: 'test-opp-id', contactId, dealCode };
  const res = await ghlFetch(`/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${pipelineId}&contact_id=${contactId}`);
  const opps = res?.opportunities || [];
  // Match on the deal_code custom field
  const match = opps.find(o => {
    const cf = (o.customFields || []).find(c => c.id?.includes('deal_code') || c.field_value === dealCode);
    return !!cf;
  }) || opps[0]; // fallback to most recent if custom field match fails
  return match || null;
}

// Send the tokenized data room link to the buyer via GHL email.
async function sendTokenizedDataRoomEmail({ contactId, contactName, dealCode, tokenizedUrl, expiresAt }) {
  const subject = `Your data room access — ${dealCode}`;
  const expiryStr = new Date(expiresAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const html = `
    <p>Hi ${(contactName || '').split(' ')[0] || 'there'},</p>
    <p>Your NDA for <b>${dealCode}</b> is signed — here's the full data room.</p>
    <p style="margin:24px 0">
      <a href="${tokenizedUrl}" style="background:#f5b301;color:#111;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open the Data Room</a>
    </p>
    <p style="color:#666;font-size:13px">This link is unique to you and expires on <b>${expiryStr}</b>. Need a fresh link after that? Just click the link and request a new one — as long as your NDA is on file, you'll get instant access.</p>
    <p style="color:#666;font-size:13px">Please don't forward this link. Each link is logged and tied to your account.</p>
    <p>— Brooke<br/>Deal Pros</p>
  `;
  await sendEmailToContact({ contactId, subject, html });
}

/* ============================================================================
   THEN UPDATE THE module.exports LINE AT THE BOTTOM OF _ghl.js TO:

module.exports = {
  upsertContact,
  createOpportunity,
  sendSmsToBrooke,
  sendEmailToContact,
  isTest,
  getStageIdByName,
  advanceOpportunityStage,
  findContactByEmail,
  findOpportunityByContactAndDealCode,
  sendTokenizedDataRoomEmail,
};
   ============================================================================ */
