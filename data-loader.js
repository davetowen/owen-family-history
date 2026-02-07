// data-loader.js - Centralized data loader for Owen Family Website
// Connects to published Google Sheets CSV

// The published CSV URL for the Owen family database
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSqmNfGZrDplmYK-eG3y7CvVIqL5nGHADF0puFCXkcncPocQe0tsnvyeWae8v426J5dBypFICQ11wLn/pub?gid=0&single=true&output=csv';

class FamilyDatabase {
  constructor(csvUrl) {
    this.csvUrl = csvUrl;
    this.cacheKey = 'familyTreeData';
    this.cacheTimeKey = 'familyTreeData_timestamp';
    this.cacheDuration = 60 * 60 * 1000; // 1 hour
  }

  async getData(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = this.getCachedData();
      if (cached) {
        console.log('Using cached data (' + cached.people.length + ' people)');
        return cached;
      }
    }

    console.log('Fetching fresh data from Google Sheets...');
    const data = await this.fetchFromGoogleSheets();
    this.cacheData(data);
    return data;
  }

  async fetchFromGoogleSheets() {
    try {
      const response = await fetch(this.csvUrl);
      if (!response.ok) throw new Error('Failed to fetch data: ' + response.status);

      const csvText = await response.text();
      const database = this.parseCSV(csvText);

      console.log('Loaded ' + database.people.length + ' people from Google Sheets');
      return database;
    } catch (error) {
      console.error('Error loading from Google Sheets:', error);
      const cached = this.getCachedData();
      if (cached) {
        console.warn('Using stale cached data as fallback');
        return cached;
      }
      return { people: [], metadata: { error: error.message } };
    }
  }

  // --- CSV Parsing ---

  parseCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length === 0) return { people: [] };

    const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
    const people = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const raw = {};
      headers.forEach((header, idx) => {
        raw[header] = (values[idx] || '').trim();
      });

      const person = this.mapFields(raw);
      if (person.id) people.push(person);
    }

    return {
      people,
      metadata: {
        lastUpdated: new Date().toISOString(),
        source: 'Google Sheets',
        recordCount: people.length
      }
    };
  }

  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current); // last field
    return values;
  }

  // --- Field Mapping: Google Sheet headers → JS field names ---

  mapFields(raw) {
    const str = (key) => raw[key] || '';
    const num = (key) => {
      const v = raw[key];
      return v ? parseInt(v, 10) || null : null;
    };
    const arr = (key) => {
      const v = raw[key];
      return v ? v.split(';').map(s => s.trim()).filter(s => s) : [];
    };

    const firstName = str('First Name');
    const lastName = str('Last Name');

    return {
      // Core identity
      id:             str('Person ID'),
      title:          str('Title'),
      firstName:      firstName,
      middleName:     str('Middle Name(s)'),
      lastName:       lastName,
      suffix:         str('Suffix'),
      nickname:       str('Preferred / Nickname'),
      maidenName:     str('Maiden Name'),
      fullName:       str('Full Name'),
      name:           str('Full Name') || (firstName + ' ' + lastName).trim(),
      gender:         str('Gender'),

      // Birth
      birthYear:      num('Birth Date'),
      birthCity:      str('Birth City'),
      birthState:     str('Birth State / Province'),
      birthCountry:   str('Birth Country'),

      // Death
      deathYear:      num('Death Date'),
      deathCity:      str('Death City'),
      deathState:     str('Death State / Province'),
      deathCountry:   str('Death Country'),
      burialPlace:    str('Burial / Cremation Place'),
      ageAtDeath:     num('Age at Death'),

      // Career
      occupation:     str('Occupation / Notes'),
      employers:      str('Employeers'),

      // Family relationships
      fatherId:       str('Father ID'),
      motherId:       str('Mother ID'),
      spouseIds:      arr('Spouse IDs'),
      childrenIds:    arr('Children IDs'),
      siblingIds:     arr('Sibling IDs'),
      stepParent:     str('Step Parent'),

      // Lineage
      branchLineage:      str('Branch / Lineage Tag'),
      immigrationYear:    num('Year Immigrated to USA'),
      generationAmerican: str('Generation American'),
      generationNumber:   num('Generation Number'),

      // Military
      military:       str('Military'),
      militaryBranch: str('Branch'),
      war:            str('War'),
      servedFrom:     str('Served From'),
      servedTo:       str('Served To'),

      // Education
      undergradUniv:  str('Undergradute University'),
      undergradYear:  str('Undergad Year Graduated'),
      gradUniv:       str('Graduate University(s)'),
      gradYear:       str('Graduate Year Graduated'),
      fraternity:     str('Fraternity / Sorority'),
      sports:         str('Sports'),

      // Additional
      flyFishing:     str('Fly Fishing'),
      photoLink:      str('Photo / Document Link'),
      notes:          str('Notes / Stories'),
      relationship:   str('Relationship to Key Ancestor'),
      confidence:     str('Confidence Level'),
      infoLink:       str('Information Link'),
      dnaMatchId:     str('DNA Match ID'),

      // Residence
      residenceCity:    str('Residence City'),
      residenceState:   str('Residence State'),
      residenceCountry: str('Residence Country')
    };
  }

  // --- Caching (localStorage) ---

  getCachedData() {
    try {
      const timestamp = localStorage.getItem(this.cacheTimeKey);
      if (!timestamp) return null;

      const age = Date.now() - parseInt(timestamp, 10);
      if (age > this.cacheDuration) {
        console.log('Cache expired');
        return null;
      }

      const data = localStorage.getItem(this.cacheKey);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn('Cache read error:', e);
      return null;
    }
  }

  cacheData(data) {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify(data));
      localStorage.setItem(this.cacheTimeKey, Date.now().toString());
    } catch (e) {
      console.warn('Cache write error (storage may be full):', e);
    }
  }

  clearCache() {
    localStorage.removeItem(this.cacheKey);
    localStorage.removeItem(this.cacheTimeKey);
    console.log('Cache cleared');
  }

  // --- Convenience: build a lookup map by ID ---

  static buildLookup(people) {
    const map = {};
    for (const p of people) {
      map[p.id] = p;
    }
    return map;
  }
}

// Initialize database instance that all pages can use
const owenFamilyDB = new FamilyDatabase(SHEET_CSV_URL);
