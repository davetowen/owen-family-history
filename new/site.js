/* Owen Family — shared toolkit for the new site.
   Loads the live sheet (via ../data-loader.js), knows how people are related,
   draws the top menu, and provides search, colours, research links and the
   "world they were born into" lookups. Every new page includes this file. */
(function () {
  'use strict';

  const PLACE_ERA_URL = 'https://script.google.com/macros/s/AKfycbypl-z85XQvv1pC7FhH-WjExMNxnemcAtGwJIvO4cRfDaaqglaWjmRm1wVcFaMapqns/exec';

  /* ---------- family colours (same as the story page) ---------- */
  const FAMILY = {
    owen: ['Owen', '#C3283A'], lunde: ['Lunde', '#2356C8'], bonnie: ['Bonnie', '#E06A16'], mantach: ['Mantach', '#14805A'],
    wells: ['Wells', '#7A3AA8'], eastman: ['Eastman', '#0F8EA1'], pedersen: ['Pedersen', '#B0285F'], good: ['Good', '#C9930B'],
    wheeler: ['Wheeler', '#8B4A2F'], murphy: ['Murphy', '#2E9A47'], nelson: ['Nelson', '#3B66A8'], nance: ['Nance', '#A2397A'],
    barnum: ['Barnum', '#5C6B1E'], robinson: ['Robinson', '#7E2E2E'], omoth: ['Omoth', '#3F7FB5'], connaughty: ['Connaughty', '#2F8C77'],
    johnson: ['Johnson', '#5A58B6'], loofboro: ['Loofboro', '#9C6B12'], utter: ['Utter', '#3C5FA0'], simons: ['Simons', '#6D4C9B'], roblee: ['Roblee', '#B4462B']
  };
  const VARIANTS = { owens: 'owen', owain: 'owen', welles: 'wells', bonney: 'bonnie', bonneau: 'bonnie', lund: 'lunde',
    barnham: 'barnum', barham: 'barnum', loofbourrow: 'loofboro', robbinson: 'robinson', robinsonne: 'robinson', robinsomme: 'robinson',
    root: 'roote', tyrell: 'tyrrell', tyrrel: 'tyrrell', terrell: 'tyrrell', petersen: 'pedersen' };
  function familyKey(p) {
    if (!p) return '';
    const raw = (p.gender === 'F' && p.maidenName ? p.maidenName : p.lastName) || '';
    const k = raw.toLowerCase().replace(/\s+(ii|iii|\d.*)$/, '').replace(/[^a-z\s]/g, '').trim();
    return VARIANTS[k] || k;
  }
  const hashHue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const familyColor = k => FAMILY[k] ? FAMILY[k][1] : k ? `hsl(${hashHue(k)} 45% 40%)` : '#7C756B';
  const familyLabel = (k, p) => FAMILY[k] ? FAMILY[k][0] : (p && ((p.gender === 'F' && p.maidenName) || p.lastName)) || (k ? k.replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown');
  const colorOf = p => familyColor(familyKey(p));
  const mix = (c, v, base = '#ECEAE5') => `color-mix(in oklab, ${c} ${Math.round(v * 100)}%, ${base})`;

  /* ---------- people and relationships ---------- */
  const P = {}; let PEOPLE = [];   // P is filled in place so pages can hold on to it
  const kidsOf = {};
  function prepare(people) {
    PEOPLE = people.filter(p => p.id);
    for (const k in P) delete P[k];
    PEOPLE.forEach(p => { P[p.id] = p; ['childrenIds', 'spouseIds', 'siblingIds'].forEach(f => p[f] = Array.isArray(p[f]) ? p[f] : (p[f] ? String(p[f]).split(/[;,]/).map(s => s.trim()).filter(Boolean) : [])); });
    for (const k in kidsOf) delete kidsOf[k];
    const add = (par, kid) => { if (P[par] && P[kid] && par !== kid) (kidsOf[par] = kidsOf[par] || new Set()).add(kid); };
    PEOPLE.forEach(p => { add(p.fatherId, p.id); add(p.motherId, p.id); p.childrenIds.forEach(c => add(p.id, c)); });
    // spouse links both ways, so a marriage recorded on one side shows on both
    PEOPLE.forEach(p => p.spouseIds.forEach(s => { if (P[s] && !P[s].spouseIds.includes(p.id)) P[s].spouseIds.push(p.id); }));
    Owen.P = P; Owen.PEOPLE = PEOPLE;
  }
  const byBirth = (a, b) => (a.birthYear || 9999) - (b.birthYear || 9999);
  const parentsOf = id => { const p = P[id]; return p ? [P[p.fatherId] ? p.fatherId : null, P[p.motherId] ? p.motherId : null] : [null, null]; };
  const childrenOf = id => [...(kidsOf[id] || [])].map(k => P[k]).sort(byBirth);
  function siblingsOf(id) {
    if (!P[id]) return [];
    const s = new Set(P[id].siblingIds.filter(x => P[x]));
    parentsOf(id).forEach(par => par && (kidsOf[par] || []).forEach(k => s.add(k)));
    s.delete(id); return [...s].map(k => P[k]).sort(byBirth);
  }
  const spousesOf = id => P[id] ? P[id].spouseIds.filter(x => P[x] && x !== id).map(x => P[x]) : [];

  // all ancestors with their distance: Map(id -> generations up)
  function ancestorsWithDepth(id) {
    const out = new Map([[id, 0]]), q = [id];
    while (q.length) {
      const c = q.shift(), d = out.get(c);
      for (const par of parentsOf(c)) if (par && !out.has(par)) { out.set(par, d + 1); q.push(par); }
    }
    return out;
  }
  const ord = n => n === 1 ? '' : n === 2 ? 'great-' : `${n - 1}× great-`;
  const nth = n => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] || n + 'th';
  const sexWord = (p, m, f, x) => p.gender === 'M' ? m : p.gender === 'F' ? f : x;

  // How is `otherId` related to `meId`? Returns e.g. "your great-grandmother", or '' if not related.
  function relationTo(meId, otherId) {
    if (!P[meId] || !P[otherId]) return '';
    if (meId === otherId) return 'you';
    const o = P[otherId];
    const blood = bloodRelation(meId, otherId);
    if (blood) return 'your ' + blood;
    // married into the family: spouse of a blood relative, or a relative of my spouse
    for (const s of spousesOf(otherId)) { const r = s.id === meId ? null : bloodRelation(meId, s.id); if (s.id === meId) return 'your ' + sexWord(o, 'husband', 'wife', 'spouse'); if (r) return `spouse of your ${r}`; }
    for (const s of spousesOf(meId)) { const r = bloodRelation(s.id, otherId); if (r) return `your ${sexWord(P[s.id], 'husband', 'wife', 'spouse')}'s ${r}`; }
    return '';
  }
  function bloodRelation(meId, otherId) {
    const A = ancestorsWithDepth(meId), B = ancestorsWithDepth(otherId);
    let best = null;
    for (const [id, da] of A) if (B.has(id)) { const db = B.get(id); if (!best || da + db < best[0] + best[1]) best = [da, db]; }
    if (!best) return '';
    const [up, down] = best, o = P[otherId];
    if (down === 0) return up === 1 ? sexWord(o, 'father', 'mother', 'parent') : ord(up - 1) + sexWord(o, 'grandfather', 'grandmother', 'grandparent');
    if (up === 0) return down === 1 ? sexWord(o, 'son', 'daughter', 'child') : ord(down - 1) + sexWord(o, 'grandson', 'granddaughter', 'grandchild');
    if (up === 1 && down === 1) { const shared = parentsOf(meId).filter(x => x && parentsOf(otherId).includes(x)).length; const both = parentsOf(meId).filter(Boolean).length === 2 && parentsOf(otherId).filter(Boolean).length === 2; return (shared === 1 && both ? 'half-' : '') + sexWord(o, 'brother', 'sister', 'sibling'); }
    if (down === 1) return ord(up - 1) + sexWord(o, 'uncle', 'aunt', 'aunt or uncle');
    if (up === 1) return ord(down - 1) + sexWord(o, 'nephew', 'niece', 'niece or nephew');
    const degree = Math.min(up, down) - 1, removed = Math.abs(up - down);
    return `${nth(degree)} cousin${removed ? (removed === 1 ? ' once' : removed === 2 ? ' twice' : ` ${removed} times`) + ' removed' : ''}`;
  }

  /* ---------- text helpers ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const displayName = p => [p.firstName, p.middleName, p.lastName, p.suffix].filter(Boolean).join(' ') || p.name;
  const shortName = p => [p.nickname ? `${p.firstName} “${p.nickname}”` : p.firstName, p.lastName].filter(Boolean).join(' ') || p.name;
  const firstName = p => p.firstName || p.name;
  const years = p => p.alive ? (p.birthYear ? `Born ${p.birthYear}` : 'Living') : (p.birthYear || p.deathYear) ? `${p.birthYear || '?'} – ${p.deathYear || '?'}` : 'Dates unknown';
  function place(p, which = 'birth') {
    const c = p[which + 'City'], s = p[which + 'State'], k = p[which + 'Country'];
    const parts = [c, s].filter(Boolean); if (k && !(k === 'United States' && parts.length)) parts.push(k);
    return parts.join(', ');
  }
  function searchLinks(p) {
    const q = encodeURIComponent, f = p.firstName || '', l = p.lastName || '', full = displayName(p);
    const links = {
      'FamilySearch': `https://www.familysearch.org/search/record/results?q.givenName=${q(f)}&q.surname=${q(l)}${p.birthYear ? '&q.birthLikeDate.from=' + (p.birthYear - 2) + '&q.birthLikeDate.to=' + (p.birthYear + 2) : ''}`,
      'Find a Grave': `https://www.findagrave.com/memorial/search?firstname=${q(f)}&lastname=${q(l)}${p.birthYear ? '&birthyear=' + p.birthYear + '&birthyearfilter=2' : ''}${p.deathYear ? '&deathyear=' + p.deathYear + '&deathyearfilter=2' : ''}`,
      'Ancestry': `https://www.ancestry.com/search/?name=${q(f + '_' + l)}${p.birthYear ? '&birth=' + p.birthYear : ''}${p.deathYear ? '&death=' + p.deathYear : ''}`,
      'Google': `https://www.google.com/search?q=${q(`"${f} ${l}" ${p.birthYear || ''} ${p.deathYear || ''} ${p.birthCity || ''}`.replace(/\s+/g, ' ').trim())}`
    };
    // US newspapers 1770–1963 (Library of Congress)
    const y = p.deathYear || p.birthYear;
    if (y && y >= 1770 && y <= 1963 && /united states|usa|^us$/i.test(p.birthCountry + ' ' + p.deathCountry))
      links['Old newspapers'] = `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=&phrasetext=${q(f + ' ' + l)}&date1=${Math.max(1770, (p.birthYear || y) )}&date2=${Math.min(1963, (p.deathYear || y) + 2)}&dateFilterType=yearRange`;
    if (p.alive) delete links['Find a Grave'];
    return links;
  }

  /* ---------- search ---------- */
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function search(q, limit = 10) {
    const t = norm(q).split(' ').filter(Boolean); if (!t.length) return [];
    const out = [];
    for (const p of PEOPLE) {
      const hay = norm([p.name, p.firstName, p.middleName, p.lastName, p.nickname, p.maidenName, p.birthYear, p.deathYear, p.birthCity, p.id].join(' '));
      let s = 0;
      for (const w of t) { if (!hay.includes(w)) { s = -1; break; } s += norm(p.firstName).startsWith(w) || norm(p.lastName).startsWith(w) ? 3 : 1; }
      if (s > 0) out.push([s + (p.birthYear || 0) / 10000, p]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
  }
  function bindFinder(input, list, onPick) {
    let items = [], idx = -1;
    const draw = () => {
      list.innerHTML = items.map((p, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === idx}" data-id="${esc(p.id)}">
        <span class="swatch" style="background:${colorOf(p)}"></span>
        <span><span class="r-name">${esc(displayName(p))}</span><br><span class="r-meta">${esc(years(p))}${place(p) ? ' · ' + esc(place(p)) : ''}</span></span></li>`).join('');
      input.setAttribute('aria-activedescendant', idx >= 0 ? `${list.id}-${idx}` : '');
      input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    };
    const pick = id => { items = []; draw(); input.value = ''; input.blur(); onPick(id); };
    input.addEventListener('input', () => { items = search(input.value); idx = items.length ? 0 : -1; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[idx]) pick(items[idx].id);
      else if (e.key === 'Escape') { items = []; draw(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { items = []; draw(); }, 180));
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) pick(li.dataset.id); });
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  }

  /* ---------- small storage for per-visitor settings (who "me" is) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem('owenStory.' + k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('owenStory.' + k) : localStorage.setItem('owenStory.' + k, v); } catch (e) {} }
  };
  const me = () => (P[store.get('viewer')] ? store.get('viewer') : null);
  const setMe = id => store.set('viewer', id);

  /* ---------- top menu ---------- */
  const PAGES = [
    ['index.html', 'Home', 'home'], ['story.html', 'Story', 'story'], ['tree.html', 'Family Tree', 'tree'], ['maps.html', 'Maps', 'maps']
  ];
  const MORE = [
    ['related.html', 'How we’re related', 'Find the link between any two people', 'related'],
    ['timeline.html', 'Timeline', 'Lives against the sweep of history', 'timeline'],
    ['statistics.html', 'Statistics', 'The family in numbers', 'statistics'],
    ['research.html', 'Research desk', 'Gaps, open questions and sources', 'research'],
    ['../classic.html', 'The original site', 'The first version, kept as it was', 'classic']
  ];
  function nav(current) {
    const el = document.createElement('header');
    el.className = 'nav';
    el.innerHTML = `<a class="brand" href="index.html"><span class="crest" aria-hidden="true"></span>Owen Family</a>
      <button class="burger" type="button" aria-label="Menu" aria-expanded="false">☰</button>
      <nav class="links" aria-label="Main">
        ${PAGES.slice(1).map(([h, t, k]) => `<a href="${h}"${k === current ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
        <div class="more"><button type="button" aria-expanded="false" aria-haspopup="true">More ▾</button>
          <div class="menu" hidden>${MORE.map(([h, t, d, k]) => `<a href="${h}"${k === current ? ' aria-current="page"' : ''}>${t}<small>${d}</small></a>`).join('')}</div></div>
      </nav>`;
    document.body.prepend(el);
    const burger = el.querySelector('.burger'), more = el.querySelector('.more > button'), menu = el.querySelector('.menu');
    burger.addEventListener('click', () => { const o = el.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
    more.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', !menu.hidden); });
    document.addEventListener('click', e => { if (!e.target.closest('.more')) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); } });
    return el;
  }

  /* ---------- status + toast ---------- */
  function stamp(text, bad) {
    let s = document.querySelector('.status-stamp');
    if (!s) { s = document.createElement('div'); s.className = 'status-stamp'; document.body.appendChild(s); }
    s.textContent = text; s.classList.toggle('bad', !!bad);
    if (!bad) setTimeout(() => { s.style.transition = 'opacity 1s'; s.style.opacity = '0'; s.style.pointerEvents = 'none'; }, 6000);
  }
  let toastTimer;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600);
  }

  /* ---------- loading the live sheet ---------- */
  async function load() {
    const db = typeof owenFamilyDB !== 'undefined' ? owenFamilyDB : null;
    let people = [], label = '';
    if (db) {
      try {
        const data = await db.getData();
        const old = document.getElementById('owen-data-status'); if (old) old.remove();
        people = data.people || [];
        label = `${people.length} people · live from the family sheet`;
        if (data.metadata && data.metadata.stale) label = `${people.length} people · saved copy (the sheet could not be reached)`;
      } catch (e) { stamp('The family data could not be loaded. Please try again later.', true); }
    } else if (window.OWEN_SNAPSHOT) {
      people = window.OWEN_SNAPSHOT.people; label = `${people.length} people · preview copy from ${window.OWEN_SNAPSHOT.taken}`;
    }
    prepare(people);
    if (people.length) stamp(label); else stamp('No family data found.', true);
    return PEOPLE;
  }

  /* ---------- the world they were born into (Gemini via the sheet's helper) ---------- */
  async function placeEra(placeTxt, year, kind) {
    if (!PLACE_ERA_URL || !placeTxt || !year) return null;
    const r = await fetch(`${PLACE_ERA_URL}?place=${encodeURIComponent(placeTxt)}&year=${year}&kind=${kind || 'birth'}`);
    const d = await r.json();
    return d && d.facts && d.facts.length ? d : null;
  }
  function factsHtml(facts) {
    return facts.map(f => { const m = /^([^:]{2,24}):\s*(.+)$/s.exec(f); return `<li>${m ? `<b>${esc(m[1])}:</b> ${esc(m[2])}` : esc(f)}</li>`; }).join('');
  }
  async function commonsPhotos(placeTxt, year, terms = [], want = 8) {
    const city = placeTxt.split(',')[0].trim();
    const api = 'https://commons.wikimedia.org/w/api.php?format=json&origin=*&action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280';
    const tries = [
      year && `${api}&generator=categorymembers&gcmtype=file&gcmlimit=40&gcmtitle=${encodeURIComponent(`Category:${year} in ${city}`)}`,
      ...terms.slice(0, 2).map(t => `${api}&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(t + ' filetype:bitmap')}`),
      year && `${api}&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(`"${city}" ${Math.floor(year / 10) * 10}s filetype:bitmap`)}`,
      `${api}&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(`"${city}" filetype:bitmap`)}`
    ].filter(Boolean);
    for (const u of tries) {
      try {
        const d = await (await fetch(u)).json();
        const pages = Object.values((d.query && d.query.pages) || {});
        const imgs = pages.map(pg => pg.imageinfo && pg.imageinfo[0])
          .filter(ii => ii && ii.thumburl && /\.(jpe?g|png)$/i.test(ii.url.split('?')[0]) && !/logo|icon|map|flag|seal|coat.of.arms|signature/i.test(ii.url.split('?')[0]))
          .map(ii => {
            const m = ii.extmetadata || {}, strip = s => (s || '').replace(/<[^>]+>/g, '').trim();
            return { src: ii.thumburl, page: ii.descriptionurl, title: strip(m.ObjectName && m.ObjectName.value), credit: [strip(m.Artist && m.Artist.value), strip(m.LicenseShortName && m.LicenseShortName.value)].filter(Boolean).join(' · ') };
          });
        if (imgs.length >= 3) return imgs.sort(() => Math.random() - .5).slice(0, want);
      } catch (e) { /* try the next search */ }
    }
    return [];
  }
  function playReel(reel, photos) {
    if (!photos.length) return;
    reel.innerHTML = photos.map((ph, i) => `<img src="${esc(ph.src)}" alt="${esc(ph.title || 'Historic photo')}" class="${i === 0 ? 'on' : ''}">`).join('') + `<a class="credit" target="_blank" rel="noopener"></a>`;
    const imgs = [...reel.querySelectorAll('img')], credit = reel.querySelector('.credit');
    let i = 0;
    const show = () => { imgs.forEach((im, j) => im.classList.toggle('on', j === i)); credit.textContent = [photos[i].title, photos[i].credit, 'Wikimedia Commons'].filter(Boolean).join(' · '); credit.href = photos[i].page; };
    show();
    clearInterval(reel._timer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && imgs.length > 1) reel._timer = setInterval(() => { if (!document.body.contains(reel)) return clearInterval(reel._timer); i = (i + 1) % imgs.length; show(); }, 6000);
  }

  const Owen = window.Owen = {
    PLACE_ERA_URL, FAMILY, familyKey, familyColor, familyLabel, colorOf, mix,
    prepare, load, parentsOf, childrenOf, siblingsOf, spousesOf, ancestorsWithDepth, relationTo, byBirth,
    esc, displayName, shortName, firstName, years, place, searchLinks, norm, search, bindFinder,
    store, me, setMe, nav, stamp, toast, placeEra, factsHtml, commonsPhotos, playReel,
    P, PEOPLE: []
  };
})();
