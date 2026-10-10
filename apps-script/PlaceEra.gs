/**
 * Owen Family — "Place & Era" helper
 * ----------------------------------
 * A tiny web app that sits between the family website and Gemini.
 *
 *   website  ->  this script  ->  Gemini (only if not already saved)
 *                     |
 *                     +-> "Place & Era" tab in the Owen Genealogy sheet
 *
 * What it sends to Gemini: a place name and a year. Nothing about any person.
 * What it returns to the website: { facts: [...], searchTerms: [...], cached: true|false }
 *
 * Every answer is saved in the "Place & Era" tab. The website reads from there first,
 * so each place/year is only ever asked once. You can edit the saved facts in the sheet;
 * the website shows your edited version. Put "Redo" in the Reviewed column to have it
 * regenerated next time someone visits.
 *
 * Settings (Project Settings -> Script properties):
 *   GEMINI_API_KEY   required. Your key from aistudio.google.com. Never put it in this file.
 *   GEMINI_MODEL     optional. Defaults to gemini-3.8-flash.
 *   MAX_NEW_PER_DAY  optional. Most new Gemini calls per day. Defaults to 150 (set 20 to match the free tier).
 */

const SPREADSHEET_ID = '1EKRkCcujbg64V-UFpvYljIv9BZq_jYOkPUreF1YnoTc';
const DB_TAB = 'Master Database';
const CACHE_TAB = 'Place & Era';
const HEADERS = ['Key', 'Place', 'Year', 'Kind', 'Facts', 'Search terms', 'Generated', 'Model', 'Reviewed'];
const DEFAULT_MODEL = 'gemini-3.8-flash';

/* ---------- web entry point ---------- */
function doGet(e) {
  try {
    const q = (e && e.parameter) || {};
    const place = String(q.place || '').replace(/\s+/g, ' ').trim();
    const year = parseInt(q.year, 10);
    const kind = q.kind === 'death' ? 'death' : 'birth';

    if (q.ping) return json_({ ok: true });
    if (!place || place.length > 90) return json_({ error: 'Missing or overlong place.' });
    if (!(year >= 1000 && year <= new Date().getFullYear())) return json_({ error: 'Year out of range.' });
    if (!isFamilyPlace_(place)) return json_({ error: 'That place is not in the family database.' });

    const key = [place.toLowerCase(), year, kind].join('|');
    const sheet = cacheSheet_();
    const hit = findRow_(sheet, key);
    if (hit && !/^redo$/i.test(hit.reviewed)) return json_({ facts: hit.facts, searchTerms: hit.terms, cached: true });

    // Only one visitor at a time may trigger a new Gemini call for the same answer.
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const again = findRow_(sheet, key);
      if (again && !/^redo$/i.test(again.reviewed)) return json_({ facts: again.facts, searchTerms: again.terms, cached: true });
      if (!underDailyCap_()) return json_({ error: 'Daily limit reached. Try again tomorrow.' });

      const model = prop_('GEMINI_MODEL') || DEFAULT_MODEL;
      const out = askGemini_(place, year, kind, model);
      const row = [key, place, year, kind, out.facts.join('\n'), out.searchTerms.join('\n'), new Date(), model, ''];
      if (again) sheet.getRange(again.row, 1, 1, row.length).setValues([row]);
      else sheet.appendRow(row);
      return json_({ facts: out.facts, searchTerms: out.searchTerms, cached: false });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json_({ error: 'Something went wrong. The website will show its built-in history instead.' });
  }
}

/* ---------- Gemini ---------- */
function askGemini_(place, year, kind, model) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set in Script properties.');

  const opening = kind === 'death'
    ? `A family member died in ${place} in ${year}. Describe the world as it was the year they left us, for family members reading it today.`
    : `A baby was born in ${place} in ${year}. Paint a picture of the world they arrived in, for family members reading it today.`;

  const town = place.split(',')[0].trim();
  const prompt = [
    `You are writing for a family history website. ${opening}`,
    'Write 8 short items, each starting with its label exactly as shown, then a colon:',
    `1. The town: what ${town} was like that year: its size, what people did for work, and anything new being built or opened.`,
    "2. Everyday life: what an ordinary family's home, meals, getting around, and school or work looked like.",
    "3. What things cost: two or three typical prices that year, such as a loaf of bread, a newspaper, a car, a house, or a day's wages.",
    '4. Nearby news: something that happened in the town or region around that year.',
    '5. The nation: the big story in the country that year.',
    '6. Pop culture: the songs, films, radio or TV shows, books, sports stars or crazes people were talking about. Before recorded music, use popular songs, hymns, books, theater, fairs or pastimes of the day.',
    '7. Brand new: an invention, gadget, fashion or fad that was new that year.',
    "8. The world: what was happening beyond the country's borders.",
    'Rules:',
    '- Be specific: real names of songs, films, events and places, and real prices. Only include what you are confident is true. If you are not sure about the town itself, describe the region and say so.',
    '- Keep each item to one or two sentences, in a warm, plain, lively tone.',
    '- Do not use filler words like "bustling", "vibrant", "rich tapestry" or "hustle and bustle".',
    '- Do not mention the family or any person in it.',
    `Also give 3 short search phrases that would find historical photographs of ${town} around that time on Wikimedia Commons (for example "Main Street Rhinelander 1910s").`
  ].join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          facts: { type: 'ARRAY', items: { type: 'STRING' } },
          searchTerms: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['facts', 'searchTerms']
      }
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));

  const data = JSON.parse(res.getContentText());
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '{}';
  const parsed = JSON.parse(text);
  const clean = a => (Array.isArray(a) ? a : []).map(s => String(s).trim()).filter(Boolean);
  const facts = clean(parsed.facts).slice(0, 10), terms = clean(parsed.searchTerms).slice(0, 4);
  if (!facts.length) throw new Error('Gemini returned no facts.');
  return { facts, searchTerms: terms };
}

/* ---------- the "Place & Era" tab ---------- */
function cacheSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(CACHE_TAB);
  if (!sh) {
    sh = ss.insertSheet(CACHE_TAB);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 220); sh.setColumnWidth(5, 520); sh.setColumnWidth(6, 260);
    sh.getRange('E:F').setWrap(true);
  }
  return sh;
}

function findRow_(sheet, key) {
  const n = sheet.getLastRow();
  if (n < 2) return null;
  const found = sheet.getRange(2, 1, n - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!found) return null;
  const r = found.getRow();
  const v = sheet.getRange(r, 1, 1, HEADERS.length).getValues()[0];
  const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  return { row: r, facts: lines(v[4]), terms: lines(v[5]), reviewed: String(v[8] || '').trim() };
}

/* ---------- guard rails ---------- */
// Only answer for places that appear in the family database, so the key can't be used for anything else.
function isFamilyPlace_(place) {
  const cache = CacheService.getScriptCache();
  let list = cache.get('familyPlaces');
  if (!list) {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_TAB);
    const values = sh.getDataRange().getDisplayValues();
    const head = values[0].map(h => String(h).trim().toLowerCase());
    const cols = ['birth city', 'death city', 'residence city', 'burial']
      .map(h => head.indexOf(h)).filter(i => i >= 0);
    const set = {};
    values.slice(1).forEach(r => cols.forEach(i => {
      const c = norm_(String(r[i] || '').split(',')[0]);
      if (c) set[c] = 1;
    }));
    list = Object.keys(set).join('|');
    cache.put('familyPlaces', list, 6 * 60 * 60);
  }
  const city = norm_(place.split(',')[0]);
  return city && ('|' + list + '|').indexOf('|' + city + '|') >= 0;
}

function underDailyCap_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const max = parseInt(props.getProperty('MAX_NEW_PER_DAY'), 10) || 150;
  const used = props.getProperty('usedDay') === today ? parseInt(props.getProperty('usedCount'), 10) || 0 : 0;
  if (used >= max) return false;
  props.setProperties({ usedDay: today, usedCount: String(used + 1) });
  return true;
}

/* ---------- helpers ---------- */
function norm_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- run this once from the editor to check everything works ---------- */
function testOnce() {
  const r = doGet({ parameter: { place: 'Rhinelander, Wisconsin', year: '1915', kind: 'birth' } });
  console.log(r.getContent());
}
