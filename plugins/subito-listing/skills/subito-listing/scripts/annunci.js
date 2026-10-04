// Annunci di una pagina di ricerca Subito, letti dal JSON di Next.js
// (__NEXT_DATA__) invece che dal DOM: sopravvive ai cambi di layout.
// Uso: playwright-cli -s=subito eval "$(cat scripts/annunci.js)"
// Una riga per annuncio: titolo | prezzo | km | anno | stato | spedibile | foto |
// città | venditore | url | testo (primi 200 caratteri). Campi vuoti dove la
// categoria non li ha. venditore: privato / pro (concessionari e negozi, che
// includono garanzia).
() => {
  const data = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
  const seen = new Set();
  const rows = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.subject && o.urls && o.features) {
      if (seen.has(o.urn)) return;
      seen.add(o.urn);
      const f = {};
      const list = Array.isArray(o.features) ? o.features : Object.values(o.features);
      list.forEach((x) => { f[x.uri] = (x.values || []).map((v) => v.value).join(','); });
      rows.push([
        o.subject,
        f['/price'] || '',
        f['/mileage_scalar'] || f['/mileage'] || '',
        f['/registration_date'] || f['/year'] || '',
        f['/item_condition'] || '',
        f['/item_shippable'] || '',
        `${(o.images || []).length} foto`,
        o.geo?.town?.value || '',
        o.advertiser?.type ? 'pro' : 'privato',
        o.urls.default,
        (o.body || '').replace(/\s+/g, ' ').slice(0, 200),
      ].join(' | '));
      return;
    }
    Object.values(o).forEach(walk);
  })(data);
  return rows.join('\n');
}
