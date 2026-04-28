'use strict';

// Top 25 US metros covering ~60% of national MF inventory.
// Sources: Census ACS 2023 + RealPage 2024 unit-count rankings.
//
// Each entry registers a county assessor URL + scrape strategy. The
// `county-records-mapper` consumes this to look up "given a property in
// (state, county), how do I fetch parcel/owner/mortgage data?".
//
// Schema:
//   {
//     state, county, metro_name, assessor_url,
//     scrape_strategy: 'json_api' | 'html_form' | 'html_search' | 'manual',
//     scrape_config: { ...strategy-specific config... },
//     estimated_share_pct: approximate % of national MF inventory,
//     is_active: true|false (skip if false)
//   }
//
// The scrape_config shape per strategy:
//   json_api:    { endpoint, parcel_param, response_path }
//   html_form:   { search_url, form_method, fields, result_selector }
//   html_search: { search_url, link_selector, detail_selectors: {...} }
//   manual:      { docs_url, notes } — flagged in DB for human follow-up
//
// IMPORTANT: All assessor URLs and scrape configs are best-effort defaults
// based on public county assessor websites. Several have rate limits or
// require CAPTCHA on bulk lookups — start with `manual` strategy until
// each county is verified working.

module.exports = [
  // ── TIER 1 (top 5, build first) ───────────────────────────────────
  {
    state: 'AZ', county: 'Maricopa', metro_name: 'Phoenix-Mesa-Chandler',
    assessor_url: 'https://mcassessor.maricopa.gov/',
    // Maricopa has a public parcel search at /mcs/ that accepts parcel or address
    scrape_strategy: 'html_form',
    scrape_config: {
      search_url: 'https://mcassessor.maricopa.gov/mcs/?q=',
      form_method: 'GET',
      address_param: 'q',
      result_selector: '.parcel-results .parcel-result',
      detail_url_selector: 'a.parcel-link',
      detail_selectors: {
        parcel_number: '.parcel-number',
        owner_name: '.owner-name',
        owner_mailing_address: '.owner-mailing',
        last_sale_date: '.last-sale-date',
        last_sale_price: '.last-sale-price',
        assessed_value: '.assessed-value'
      }
    },
    estimated_share_pct: 4.5,
    is_active: true
  },
  {
    state: 'TX', county: 'Harris', metro_name: 'Houston-The Woodlands-Sugar Land',
    assessor_url: 'https://hcad.org/',
    scrape_strategy: 'html_search',
    scrape_config: {
      search_url: 'https://hcad.org/quick-search/',
      link_selector: 'a[href*="/property-search-results"]',
      // HCAD often blocks bulk; throttle hard. May need fallback to manual.
      rate_limit_ms: 8000
    },
    estimated_share_pct: 3.8,
    is_active: true
  },
  {
    state: 'TX', county: 'Dallas', metro_name: 'Dallas-Fort Worth-Arlington',
    assessor_url: 'https://www.dallascad.org/',
    scrape_strategy: 'html_search',
    scrape_config: {
      search_url: 'https://www.dallascad.org/SearchAddr.aspx',
      rate_limit_ms: 6000
    },
    estimated_share_pct: 3.2,
    is_active: true
  },
  {
    state: 'FL', county: 'Hillsborough', metro_name: 'Tampa-St. Petersburg-Clearwater',
    assessor_url: 'https://gis.hcpafl.org/propertysearch/',
    scrape_strategy: 'html_search',
    scrape_config: {
      search_url: 'https://gis.hcpafl.org/propertysearch/',
      rate_limit_ms: 5000
    },
    estimated_share_pct: 2.0,
    is_active: true
  },
  {
    state: 'GA', county: 'Fulton', metro_name: 'Atlanta-Sandy Springs-Alpharetta',
    assessor_url: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=936&LayerID=18261',
    scrape_strategy: 'html_search',
    scrape_config: {
      search_url: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=936&LayerID=18261',
      rate_limit_ms: 6000
    },
    estimated_share_pct: 2.4,
    is_active: true
  },

  // ── TIER 2 (next 20, build after Tier 1 verified) ─────────────────
  // Marked is_active: false until each is confirmed working with a real test.
  { state: 'CA', county: 'Los Angeles', metro_name: 'Los Angeles-Long Beach-Anaheim', assessor_url: 'https://assessor.lacounty.gov/', scrape_strategy: 'manual', scrape_config: { notes: 'LA Assessor parcel search has CAPTCHA. Consider commercial provider PropMix or DataTree if scraping breaks.' }, estimated_share_pct: 5.5, is_active: false },
  { state: 'NY', county: 'Kings', metro_name: 'New York-Newark-Jersey City (Brooklyn)', assessor_url: 'https://a836-pts-access.nyc.gov/', scrape_strategy: 'manual', scrape_config: { notes: 'NYC ACRIS for deed/mortgage; PTS for assessment. Two-system lookup.' }, estimated_share_pct: 3.0, is_active: false },
  { state: 'NY', county: 'Queens', metro_name: 'New York-Newark-Jersey City (Queens)', assessor_url: 'https://a836-pts-access.nyc.gov/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 2.5, is_active: false },
  { state: 'IL', county: 'Cook', metro_name: 'Chicago-Naperville-Elgin', assessor_url: 'https://www.cookcountyassessor.com/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 4.0, is_active: false },
  { state: 'CA', county: 'San Diego', metro_name: 'San Diego-Chula Vista-Carlsbad', assessor_url: 'https://arcc.sdcounty.ca.gov/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 2.0, is_active: false },
  { state: 'CA', county: 'Orange', metro_name: 'Los Angeles-Long Beach-Anaheim (OC)', assessor_url: 'https://www.ocgov.com/assessor', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 2.2, is_active: false },
  { state: 'NV', county: 'Clark', metro_name: 'Las Vegas-Henderson-Paradise', assessor_url: 'https://www.clarkcountynv.gov/government/assessor/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.6, is_active: false },
  { state: 'WA', county: 'King', metro_name: 'Seattle-Tacoma-Bellevue', assessor_url: 'https://kingcounty.gov/depts/assessor.aspx', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.8, is_active: false },
  { state: 'CO', county: 'Denver', metro_name: 'Denver-Aurora-Lakewood', assessor_url: 'https://www.denvergov.org/assessor', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.4, is_active: false },
  { state: 'TX', county: 'Bexar', metro_name: 'San Antonio-New Braunfels', assessor_url: 'https://www.bcad.org/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.3, is_active: false },
  { state: 'TX', county: 'Travis', metro_name: 'Austin-Round Rock-Georgetown', assessor_url: 'https://www.traviscad.org/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.4, is_active: false },
  { state: 'FL', county: 'Miami-Dade', metro_name: 'Miami-Fort Lauderdale-Pompano Beach', assessor_url: 'https://www.miamidade.gov/pa/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 2.4, is_active: false },
  { state: 'FL', county: 'Broward', metro_name: 'Miami-Fort Lauderdale-Pompano Beach (Broward)', assessor_url: 'https://web.bcpa.net/bcpaclient/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.8, is_active: false },
  { state: 'FL', county: 'Orange', metro_name: 'Orlando-Kissimmee-Sanford', assessor_url: 'https://www.ocpafl.org/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.5, is_active: false },
  { state: 'PA', county: 'Philadelphia', metro_name: 'Philadelphia-Camden-Wilmington', assessor_url: 'https://property.phila.gov/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.6, is_active: false },
  { state: 'MA', county: 'Suffolk', metro_name: 'Boston-Cambridge-Newton', assessor_url: 'https://www.cityofboston.gov/assessing/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.0, is_active: false },
  { state: 'MN', county: 'Hennepin', metro_name: 'Minneapolis-St. Paul-Bloomington', assessor_url: 'https://www.hennepin.us/your-government/property/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.1, is_active: false },
  { state: 'NC', county: 'Mecklenburg', metro_name: 'Charlotte-Concord-Gastonia', assessor_url: 'https://meckcounty.gov/Departments/Tax/AssessorsOffice/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 1.0, is_active: false },
  { state: 'TN', county: 'Davidson', metro_name: 'Nashville-Davidson-Murfreesboro', assessor_url: 'https://www.padctn.org/', scrape_strategy: 'manual', scrape_config: {}, estimated_share_pct: 0.9, is_active: false }
];
