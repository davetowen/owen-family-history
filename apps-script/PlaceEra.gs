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
 * It also looks after FAMILY PHOTOS (see the "family photos" section further down):
 *
 *   website "Add a photo"  ->  this script  ->  "Owen Family Photos" folder in your Google Drive
 *                                   |
 *                                   +-> "Photos" tab in the Owen Genealogy sheet (one row per photo)
 *
 * Anyone can see the photos on the website. Only someone who knows the family passcode can add,
 * hide or re-order them. You can also manage them by hand in the Photos tab: edit a caption,
 * type Yes in "Main" to choose the portrait, or Yes in "Hide" to take a photo off the website.
 *
 * Settings (Project Settings -> Script properties):
 *   GEMINI_API_KEY      required for Place & Era. Your key from aistudio.google.com. Never put it in this file.
 *   GEMINI_MODEL        optional. Defaults to gemini-3.8-flash.
 *   MAX_NEW_PER_DAY     optional. Most new Gemini calls per day. Defaults to 150 (set 20 to match the free tier).
 *   FAMILY_PASSCODE     required for photo uploads. A word or phrase you share with family. Until it is set, nobody can upload.
 *   MAX_PHOTOS_PER_DAY  optional. Most photos added per day. Defaults to 60.
 *   PHOTO_FOLDER_ID     filled in automatically the first time (the Drive folder the photos go into).
 */

const SPREADSHEET_ID = '1EKRkCcujbg64V-UFpvYljIv9BZq_jYOkPUreF1YnoTc';
const DB_TAB = 'Master Database';
const CACHE_TAB = 'Place & Era';
const HEADERS = ['Key', 'Place', 'Year', 'Kind', 'Facts', 'Search terms', 'Generated', 'Model', 'Reviewed'];
const DEFAULT_MODEL = 'gemini-3.8-flash';

const PHOTOS_TAB = 'Photos';
const PHOTO_HEADERS = ['Photo ID', 'Person ID', 'Person', 'Drive file ID', 'Caption', 'Year', 'Added by', 'Added', 'Main', 'Hide'];
const PHOTO_FOLDER_NAME = 'Owen Family Photos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PERSON_ID = /^P\d{2,4}$/i;

/* ---------- web entry point ---------- */
function doGet(e) {
  try {
    const q = (e && e.parameter) || {};
    if (q.action === 'photos') return json_(listPhotos_());
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

/* =====================================================================================
   FAMILY PHOTOS
   ===================================================================================== */

/* The website sends photo changes here (a POST). Every change needs the family passcode. */
function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const gate = checkPasscode_(b.passcode);
    if (gate) return json_({ error: gate, badPasscode: true });
    if (b.action === 'checkPasscode') return json_({ ok: true });
    if (b.action === 'addPhoto') return json_(addPhoto_(b));
    if (b.action === 'hidePhoto') return json_(markPhoto_(b.photoId, 'hide'));
    if (b.action === 'mainPhoto') return json_(markPhoto_(b.photoId, 'main'));
    if (b.action === 'captionPhoto') return json_(markPhoto_(b.photoId, 'caption', b));
    return json_({ error: 'Unknown request.' });
  } catch (err) {
    console.error(err);
    return json_({ error: 'Something went wrong saving that. Please try again.' });
  }
}

/* What the website reads: every photo that is not hidden. */
function listPhotos_() {
  const out = { photos: [], uploads: !!prop_('FAMILY_PASSCODE') };
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PHOTOS_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, PHOTO_HEADERS.length).getDisplayValues();
  rows.forEach(r => {
    const person = String(r[1]).trim().toUpperCase(), file = String(r[3]).trim();
    if (!r[0] || !PERSON_ID.test(person) || !/^[\w-]{20,}$/.test(file) || yes_(r[9])) return;
    out.photos.push({ id: String(r[0]).trim(), person, file, caption: unquote_(r[4]), year: String(r[5]).trim(), by: unquote_(r[6]), main: yes_(r[8]) });
  });
  return out;
}

function addPhoto_(b) {
  const personId = String(b.personId || '').trim().toUpperCase();
  const who = personName_(personId);
  if (!who) return { error: 'That person is not in the family database.' };

  const mime = String(b.mime || '');
  if (!/^image\/(jpeg|png)$/.test(mime)) return { error: 'Only JPEG or PNG pictures can be added.' };
  let bytes;
  try { bytes = Utilities.base64Decode(String(b.data || '')); } catch (err) { return { error: 'That picture could not be read.' }; }
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return { error: 'That picture is too large.' };
  const u = i => bytes[i] & 0xff;
  const isJpeg = u(0) === 0xff && u(1) === 0xd8, isPng = u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47;
  if (!(mime === 'image/jpeg' ? isJpeg : isPng)) return { error: 'That file is not a picture.' };
  if (!underPhotoCap_()) return { error: 'The daily limit for new photos has been reached. Try again tomorrow.' };

  const caption = clean_(b.caption, 300), by = clean_(b.addedBy, 60);
  const year = /^\d{4}$/.test(String(b.year || '').trim()) ? String(b.year).trim() : '';
  const stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
  const blob = Utilities.newBlob(bytes, mime, `${personId} ${who} ${stamp}.${mime === 'image/png' ? 'png' : 'jpg'}`);
  const file = photoFolder_().createFile(blob);
  file.setDescription([who + ' (' + personId + ')', caption, year, by && 'Added by ' + by].filter(Boolean).join(' · '));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { console.warn('Could not share file: ' + err); }

  const id = 'PH' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let main;
  try {
    const sh = photosSheet_();
    main = !photoRows_(sh).some(r => r.person === personId && !r.hidden);   // the first photo becomes the portrait
    sh.appendRow([id, personId, safe_(who), file.getId(), safe_(caption), year, safe_(by), new Date(), main ? 'Yes' : '', '']);
  } finally { lock.releaseLock(); }
  return { ok: true, photo: { id, person: personId, file: file.getId(), caption, year, by, main } };
}

/* hide a photo, choose the portrait, or change a caption */
function markPhoto_(photoId, what, b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = photosSheet_(), rows = photoRows_(sh);
    const hit = rows.find(r => r.id === String(photoId || '').trim());
    if (!hit) return { error: 'That photo could not be found.' };
    if (what === 'hide') {
      sh.getRange(hit.row, 10).setValue('Yes');
      if (hit.main) {   // pass the portrait on to the next photo of the same person
        sh.getRange(hit.row, 9).setValue('');
        const next = rows.find(r => r.person === hit.person && !r.hidden && r.id !== hit.id);
        if (next) sh.getRange(next.row, 9).setValue('Yes');
      }
    } else if (what === 'main') {
      rows.filter(r => r.person === hit.person).forEach(r => sh.getRange(r.row, 9).setValue(r.id === hit.id ? 'Yes' : ''));
    } else if (what === 'caption') {
      sh.getRange(hit.row, 5).setValue(safe_(clean_(b.caption, 300)));
      sh.getRange(hit.row, 6).setValue(/^\d{4}$/.test(String(b.year || '').trim()) ? String(b.year).trim() : '');
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function photosSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(PHOTOS_TAB);
  if (!sh) {
    sh = ss.insertSheet(PHOTOS_TAB);
    sh.getRange(1, 1, 1, PHOTO_HEADERS.length).setValues([PHOTO_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 200); sh.setColumnWidth(4, 120); sh.setColumnWidth(5, 380);
    sh.getRange('E:E').setWrap(true);
  }
  return sh;
}

function photoRows_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, PHOTO_HEADERS.length).getDisplayValues().map((r, i) => ({
    row: i + 2, id: String(r[0]).trim(), person: String(r[1]).trim().toUpperCase(), main: yes_(r[8]), hidden: yes_(r[9])
  }));
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('PHOTO_FOLDER_ID');
  if (saved) { try { const f = DriveApp.getFolderById(saved); if (!f.isTrashed()) return f; } catch (err) { /* make a new one below */ } }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { console.warn('Could not share folder: ' + err); }
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// Returns the person's name if the ID is in the Master Database, otherwise ''.
function personName_(personId) {
  if (!PERSON_ID.test(personId)) return '';
  const values = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(DB_TAB).getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = names => names.map(n => head.indexOf(n)).find(i => i >= 0);
  let idCol = col(['personid', 'id']);
  if (idCol === undefined) {   // header renamed: find the column that looks like P001, P002...
    let best = 0;
    values[0].forEach((_, c) => { const n = values.slice(1).filter(r => PERSON_ID.test(String(r[c]).trim())).length; if (n > best) { best = n; idCol = c; } });
  }
  if (idCol === undefined) return '';
  const row = values.slice(1).find(r => String(r[idCol]).trim().toUpperCase() === personId);
  if (!row) return '';
  const full = col(['fullname']), first = col(['firstname']), last = col(['lastname']);
  const name = (full !== undefined && String(row[full]).trim()) || [first, last].filter(c => c !== undefined).map(c => String(row[c]).trim()).filter(Boolean).join(' ');
  return (name || personId).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80);
}

// '' when the passcode is right; otherwise the message to show. Too many wrong guesses lock uploads for the day.
function checkPasscode_(given) {
  const real = prop_('FAMILY_PASSCODE');
  if (!real) return 'Photo uploads are not switched on yet.';
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const fails = props.getProperty('failDay') === today ? parseInt(props.getProperty('failCount'), 10) || 0 : 0;
  if (fails >= 25) return 'Too many wrong passcodes today. Try again tomorrow.';
  const tidy = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (tidy(given) && tidy(given) === tidy(real)) return '';
  props.setProperties({ failDay: today, failCount: String(fails + 1) });
  return 'That passcode is not right.';
}

function underPhotoCap_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const max = parseInt(props.getProperty('MAX_PHOTOS_PER_DAY'), 10) || 60;
  const used = props.getProperty('photoDay') === today ? parseInt(props.getProperty('photoCount'), 10) || 0 : 0;
  if (used >= max) return false;
  props.setProperties({ photoDay: today, photoCount: String(used + 1) });
  return true;
}

const yes_ = v => /^(y|yes|true|x)$/i.test(String(v || '').trim());
const clean_ = (s, max) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// Stops typed text from being treated as a spreadsheet formula.
const safe_ = s => /^[=+\-@]/.test(s) ? "'" + s : s;
const unquote_ = s => String(s || '').trim().replace(/^'/, '');

/* ---------- run this once from the editor to switch photos on ---------- */
// It makes the Photos tab and the Drive folder, and asks you for permission to use Google Drive.
function setupPhotos() {
  photosSheet_();
  const folder = photoFolder_();
  console.log('Photos tab is ready. Photos will be saved in: ' + folder.getUrl());
  console.log(prop_('FAMILY_PASSCODE') ? 'A family passcode is set. Uploads are on.' : 'No FAMILY_PASSCODE yet. Add one in Project Settings -> Script properties to allow uploads.');
}

/* ---------- run this once from the editor to check everything works ---------- */
function testOnce() {
  const r = doGet({ parameter: { place: 'Rhinelander, Wisconsin', year: '1915', kind: 'birth' } });
  console.log(r.getContent());
}
