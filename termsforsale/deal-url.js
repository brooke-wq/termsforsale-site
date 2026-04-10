/**
 * Client-side deal URL builder.
 * Mirrors termsforsale/netlify/functions/_deal-url.js so every on-site
 * deal link uses the short /d/{city}-{zip}-{code} path.
 *
 * Include via <script src="/deal-url.js"></script> before any script that
 * calls buildDealPath().
 */
(function(){
  function slugify(s){
    return String(s||'').toLowerCase()
      .replace(/[^a-z0-9\s-]/g,'').trim()
      .replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'');
  }
  function shortCode(d){
    var raw=d.dealCode||d.deal_code||d.deal_id||'';
    if(raw)return slugify(raw).replace(/-/g,'');
    var id=d.id||'';
    return id?String(id).replace(/[^a-z0-9]/gi,'').slice(0,8).toLowerCase():'';
  }
  window.buildDealPath=function(d){
    if(!d)return'/deals.html';
    var city=slugify(d.city);
    var zip=slugify(d.zip);
    var code=shortCode(d);
    var parts=[];
    if(city)parts.push(city);
    if(zip)parts.push(zip);
    if(code)parts.push(code);
    return'/d/'+(parts.length?parts.join('-'):String(d.id||'').toLowerCase());
  };
})();
