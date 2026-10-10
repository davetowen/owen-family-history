// data-loader.js - Centralized, live data loader for the Owen Family History website
// Reads the published Google Sheet (CSV) on every page load so the site always
// reflects the current database. A saved copy is used only if Google can't be reached.
//
// Public interface (unchanged for existing pages):
//   owenFamilyDB.getData(forceRefresh)  -> Promise<{ people, metadata }>
//   owenFamilyDB.clearCache()
//   FamilyDatabase.buildLookup(people)  -> { id: person }

// The published CSV URL for the Owen family database (Master Database tab)
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSqmNfGZrDplmYK-eG3y7CvVIqL5nGHADF0puFCXkcncPocQe0tsnvyeWae8v426J5dBypFICQ11wLn/pub?gid=0&single=true&output=csv';

// Each field lists the header names it may appear under in the sheet.
// Matching ignores case, spaces and punctuation, so small header edits don't break the site.
const FIELD_HEADERS = {
  id:                 ['Person ID', 'ID', 'PersonID'],
  qcReviewed:         ['QC Reviewed', 'Reading'],
  title:              ['Title'],
  firstName:          ['First Name'],
  middleName:         ['Middle Name(s)', 'Middle Name'],
  lastName:           ['Last Name'],
  suffix:             ['Suffix'],
  nickname:           ['Preferred / Nickname', 'Nickname'],
  maidenName:         ['Maiden Name'],
  fullName:           ['Full Name'],
  gender:             ['Gender', 'Sex'],
  birthDate:          ['Birth Date', 'Birth Year'],
  birthCity:          ['Birth City'],
  birthState:         ['Birth State / Province', 'Birth State'],
  birthCountry:       ['Birth Country'],
  deathDate:          ['Death Date', 'Death Year'],
  deathCity:          ['Death City'],
  deathState:         ['Death State / Province', 'Death State'],
  deathCountry:       ['Death Country'],
  burialPlace:        ['Burial / Cremation Place', 'Burial Place'],
  ageAtDeath:         ['Age at Death'],
  occupation:         ['Occupation / Notes', 'Occupation'],
  employers:          ['Employers', 'Employeers'],
  fatherId:           ['Father ID'],
  motherId:           ['Mother ID'],
  spouseIds:          ['Spouse IDs', 'Spouse ID'],
  childrenIds:        ['Children IDs', 'Child IDs'],
  siblingIds:         ['Sibling IDs'],
  stepParent:         ['Step Parent'],
  branchLineage:      ['Branch / Lineage Tag', 'Lineage'],
  immigrationYear:    ['Year Immigrated to USA'],
  generationAmerican: ['Generation American'],
  generationNumber:   ['Generation Number'],
  military:           ['Military'],
  militaryBranch:     ['Branch', 'Military Branch'],
  war:                ['War'],
  servedFrom:         ['Served From'],
  servedTo:           ['Served To'],
  undergradUniv:      ['Undergraduate University', 'Undergradute University'],
  undergradYear:      ['Undergraduate Year Graduated', 'Undergad Year Graduated'],
  gradUniv:           ['Graduate University(s)', 'Graduate University'],
  gradYear:           ['Graduate Year Graduated'],
  fraternity:         ['Fraternity / Sorority'],
  sports:             ['Sports'],
  flyFishing:         ['Fly Fishing'],
  photoLink:          ['Photo / Document Link'],
  notes:              ['Notes / Stories', 'Notes'],
  relationship:       ['Relationship to Key Ancestor'],
  confidence:         ['Confidence Level'],
  infoLink:           ['Information Link'],
  dnaMatchId:         ['DNA Match ID'],
  residenceCity:      ['Residence City'],
  residenceState:     ['Residence State'],
  residenceCountry:   ['Residence Country'],
  reviewQuestions:    ['Questions for Review'],
  dataConfidence:     ['Data Confidence'],
  confidenceReason:   ['Confidence Reason'],
  findAGraveLink:     ['Find a Grave Link'],
  newsLink:           ['News / Obituary Link', 'Obituary Link'],
  researchSources:    ['Research Sources'],
  researchStatus:     ['Research Status']
};

const LIST_FIELDS = new Set(['spouseIds', 'childrenIds', 'siblingIds']);
const ID_PATTERN = /^P\d{2,4}$/i;

class FamilyDatabase {
  constructor(csvUrl) {
    this.csvUrl = csvUrl;
    this.cacheKey = 'familyTreeData_v2';
    this.cacheTimeKey = 'familyTreeData_v2_timestamp';
    // Clear the old one-hour cache from the previous version of the site
    this._safeStorage(s => { s.removeItem('familyTreeData'); s.removeItem('familyTreeData_timestamp'); });
  }

  // Always fetch fresh; fall back to the last good copy only if the fetch fails.
  async getData(forceRefresh = false) {
    try {
      const data = await this.fetchFromGoogleSheets();
      this.cacheData(data);
      this.showStatus(data);
      return data;
    } catch (error) {
      console.error('Error loading from Google Sheets:', error);
      const cached = this.getCachedData();
      if (cached && cached.people && cached.people.length) {
        cached.metadata = Object.assign({}, cached.metadata, { stale: true, error: error.message });
        this.showStatus(cached);
        return cached;
      }
      const empty = { people: [], metadata: { error: error.message, recordCount: 0 } };
      this.showStatus(empty);
      return empty;
    }
  }

  async fetchFromGoogleSheets() {
    // Cache-busting parameter so browsers never reuse an old copy of the sheet
    const url = this.csvUrl + (this.csvUrl.includes('?') ? '&' : '?') + '_ts=' + Date.now();
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Google Sheets returned ' + response.status);
    const csvText = await response.text();
    if (/^\s*<!DOCTYPE html/i.test(csvText)) throw new Error('Google Sheets returned a web page instead of CSV (is the sheet still published?)');
    const database = this.parseCSV(csvText);
    if (database.people.length === 0) {
      throw new Error(database.metadata.warning || 'No people found in the sheet');
    }
    console.log('Loaded ' + database.people.length + ' people from Google Sheets');
    return database;
  }

  // --- CSV parsing (handles commas, quotes and line breaks inside cells) ---

  parseCSV(csv) {
    const rows = this.parseRows(csv.replace(/^﻿/, ''));
    if (rows.length === 0) return { people: [], metadata: { warning: 'The sheet is empty' } };

    const headers = rows[0].map(h => h.trim());
    const columnFor = this.mapHeaders(headers, rows.slice(1));
    const warnings = [];
    if (columnFor.id === undefined) warnings.push('Could not find a Person ID column');

    const people = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.some(v => v && v.trim())) continue;           // skip blank rows
      const person = this.mapFields(row, columnFor);
      if (person.id) people.push(person);
    }

    return {
      people,
      metadata: {
        lastUpdated: new Date().toISOString(),
        source: 'Google Sheets',
        recordCount: people.length,
        warning: warnings.join('; ') || null
      }
    };
  }

  parseRows(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // --- Header matching ---

  static normalize(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  mapHeaders(headers, dataRows) {
    const norm = headers.map(FamilyDatabase.normalize);
    const columnFor = {};
    for (const [field, names] of Object.entries(FIELD_HEADERS)) {
      for (const name of names) {
        const idx = norm.indexOf(FamilyDatabase.normalize(name));
        if (idx !== -1 && !Object.values(columnFor).includes(idx)) { columnFor[field] = idx; break; }
      }
    }
    // Safety net: if the Person ID header was renamed or erased, find the column
    // whose values look like P001, P002, ...
    if (columnFor.id === undefined) {
      let best = -1, bestCount = 0;
      for (let c = 0; c < headers.length; c++) {
        const count = dataRows.reduce((n, r) => n + (ID_PATTERN.test((r[c] || '').trim()) ? 1 : 0), 0);
        if (count > bestCount) { best = c; bestCount = count; }
      }
      if (bestCount > 0) {
        columnFor.id = best;
        console.warn('Person ID header not found; using column ' + (best + 1) + ' (' + bestCount + ' IDs detected)');
      }
    }
    return columnFor;
  }

  // --- Field mapping: sheet row -> person object ---

  mapFields(row, columnFor) {
    const raw = (field) => {
      const idx = columnFor[field];
      return idx === undefined ? '' : (row[idx] || '').trim();
    };
    const year = (field) => {
      const m = raw(field).match(/\b(\d{4})\b/);
      return m ? parseInt(m[1], 10) : null;
    };
    const num = (field) => {
      const v = parseInt(raw(field), 10);
      return Number.isFinite(v) ? v : null;
    };
    const list = (field) => raw(field)
      .split(/[;,]/).map(s => s.trim())
      .filter(s => s && ID_PATTERN.test(s));                   // ignore placeholders like "x"

    const person = {};
    for (const field of Object.keys(FIELD_HEADERS)) {
      person[field] = LIST_FIELDS.has(field) ? list(field) : raw(field);
    }

    // Typed fields
    const ageText = raw('ageAtDeath');
    person.birthYear = year('birthDate');
    person.deathYear = year('deathDate');
    person.alive = /^alive$/i.test(ageText);
    person.ageAtDeath = person.alive ? null : num('ageAtDeath');
    if (person.ageAtDeath === null && !person.alive && person.birthYear && person.deathYear) {
      person.ageAtDeath = person.deathYear - person.birthYear;
    }
    person.immigrationYear = year('immigrationYear');
    person.generationNumber = num('generationNumber');
    person.fatherId = ID_PATTERN.test(person.fatherId) ? person.fatherId : '';
    person.motherId = ID_PATTERN.test(person.motherId) ? person.motherId : '';

    // Convenience fields
    const built = [person.firstName, person.middleName, person.lastName, person.suffix].filter(Boolean).join(' ');
    person.name = person.fullName || built || person.id;
    const dc = (person.dataConfidence || '').toLowerCase();
    person.dataConfidence = dc.startsWith('h') ? 'High' : dc.startsWith('m') ? 'Medium' : dc.startsWith('l') ? 'Low' : '';
    person.hasReviewQuestion = !!person.reviewQuestions;
    person.searchLinks = FamilyDatabase.searchLinks(person);
    return person;
  }

  // One-click research links built from the person's own data
  static searchLinks(p) {
    if (!p.firstName && !p.lastName) return {};
    const q = encodeURIComponent;
    const fg = 'https://www.findagrave.com/memorial/search?firstname=' + q(p.firstName || '') +
               '&lastname=' + q(p.lastName || '') +
               (p.birthYear ? '&birthyear=' + p.birthYear + '&birthyearfilter=2' : '') +
               (p.deathYear ? '&deathyear=' + p.deathYear + '&deathyearfilter=2' : '');
    const fs = 'https://www.familysearch.org/search/record/results?q.givenName=' + q(p.firstName || '') +
               '&q.surname=' + q(p.lastName || '') +
               (p.birthYear ? '&q.birthLikeDate.from=' + (p.birthYear - 2) + '&q.birthLikeDate.to=' + (p.birthYear + 2) : '') +
               (p.deathYear ? '&q.deathLikeDate.from=' + (p.deathYear - 2) + '&q.deathLikeDate.to=' + (p.deathYear + 2) : '');
    const an = 'https://www.ancestry.com/search/?name=' + q((p.firstName || '') + '_' + (p.lastName || '')) +
               (p.birthYear ? '&birth=' + p.birthYear : '') +
               (p.deathYear ? '&death=' + p.deathYear : '');
    return { findAGrave: fg, familySearch: fs, ancestry: an };
  }

  // --- Saved copy (fallback only) ---

  _safeStorage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  getCachedData() {
    return this._safeStorage(s => {
      const data = s.getItem(this.cacheKey);
      return data ? JSON.parse(data) : null;
    });
  }

  cacheData(data) {
    this._safeStorage(s => {
      s.setItem(this.cacheKey, JSON.stringify(data));
      s.setItem(this.cacheTimeKey, Date.now().toString());
    });
  }

  clearCache() {
    this._safeStorage(s => { s.removeItem(this.cacheKey); s.removeItem(this.cacheTimeKey); });
  }

  // --- Visible status: warning banner on failure, "data loaded at" stamp on success ---

  showStatus(data) {
    if (typeof document === 'undefined') return;
    const render = () => {
      let el = document.getElementById('owen-data-status');
      if (!el) {
        el = document.createElement('div');
        el.id = 'owen-data-status';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
      }
      const md = data.metadata || {};
      const when = md.lastUpdated ? new Date(md.lastUpdated).toLocaleString() : '';
      let text, bad = false;
      if (!data.people || data.people.length === 0) {
        text = 'Family data could not be loaded' + (md.error ? ': ' + md.error : '') + '. Please try again later.';
        bad = true;
      } else if (md.stale) {
        text = 'Showing a saved copy from ' + when + ' (live data unavailable: ' + md.error + ').';
        bad = true;
      } else {
        text = data.people.length + ' people · data loaded ' + when + (md.warning ? ' · ' + md.warning : '');
      }
      el.textContent = text;
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:calc(100% - 24px);' +
        'padding:6px 12px;border-radius:6px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.2);' +
        (bad ? 'background:#fdecea;color:#8a1c1c;border:1px solid #f5c2c0;'
             : 'background:rgba(255,253,245,.92);color:#5b4a32;border:1px solid #e3d6bd;');
      if (!bad) setTimeout(() => { el.style.opacity = '0.55'; }, 6000);
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render);
  }

  // --- Convenience: lookup map by ID ---

  static buildLookup(people) {
    const map = {};
    for (const p of people) map[p.id] = p;
    return map;
  }
}

// Shared instance used by every page
const owenFamilyDB = new FamilyDatabase(SHEET_CSV_URL);
