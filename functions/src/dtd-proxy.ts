/**
 * DTD Proxy Cloud Function
 *
 * Acts as an API proxy between the XNautical SPA and the 3Si Tracking
 * PHP backend at www.3sitracking.com. Manages PHP sessions, handles
 * CSRF tokens, and parses HTML table responses into JSON.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

const crypto = require('crypto');

// Initialize admin if not already done (index.ts may have already called it)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const BASE_URL = 'https://www.3sitracking.com';
const API_URL = 'https://api.3sitracking.com';

// ---------------------------------------------------------------------------
// Session Management (Firestore-backed for multi-instance support)
// ---------------------------------------------------------------------------

interface SessionData {
  cookies: string;
  csrfToken: string;
  apiToken: string;       // Bearer token for api.3sitracking.com REST API
  lastUsed: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SESSIONS_COLLECTION = 'dtd_sessions';

async function saveSession(token: string, session: SessionData): Promise<void> {
  await db.collection(SESSIONS_COLLECTION).doc(token).set(session);
}

async function loadSession(token: string): Promise<SessionData | null> {
  const doc = await db.collection(SESSIONS_COLLECTION).doc(token).get();
  if (!doc.exists) return null;
  const data = doc.data() as SessionData;
  if (Date.now() - data.lastUsed > SESSION_TTL_MS) {
    await db.collection(SESSIONS_COLLECTION).doc(token).delete();
    return null;
  }
  return data;
}

async function touchSession(token: string, session: SessionData): Promise<void> {
  session.lastUsed = Date.now();
  await db.collection(SESSIONS_COLLECTION).doc(token).set(session);
}

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Cookie Helpers
// ---------------------------------------------------------------------------

function extractCookies(headers: Record<string, any>): string {
  const setCookieHeader = headers['set-cookie'];
  if (!setCookieHeader) return '';
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr
    .map((c: string) => c.split(';')[0].trim())
    .join('; ');
}

function mergeCookies(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const cookieMap = new Map<string, string>();

  // Parse existing cookies
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(trimmed.substring(0, eqIdx).trim(), trimmed.substring(eqIdx + 1).trim());
    }
  }

  // Parse and merge incoming cookies
  for (const part of incoming.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(trimmed.substring(0, eqIdx).trim(), trimmed.substring(eqIdx + 1).trim());
    }
  }

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Axios Client Factory
// ---------------------------------------------------------------------------

function createClient(cookies?: string): AxiosInstance {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };
  if (cookies) {
    headers['Cookie'] = cookies;
  }
  return axios.create({
    baseURL: BASE_URL,
    headers,
    maxRedirects: 0,
    validateStatus: (status) => status < 400,
    timeout: 30000,
  });
}

// ---------------------------------------------------------------------------
// Login Flow
// ---------------------------------------------------------------------------

async function loginFlow(
  username: string,
  password: string
): Promise<{ token: string } | { error: string }> {
  // Use a permissive validateStatus for all login steps so we can inspect responses
  const permissive = { validateStatus: (s: number) => s < 500 };

  try {
    // Step 1: GET /tracker/index.php to obtain initial session cookie
    const step1 = await createClient().get('/tracker/index.php', {
      ...permissive,
      maxRedirects: 5,
    });
    let cookies = extractCookies(step1.headers);
    console.log(`[login] Step 1: status=${step1.status}, cookies=${cookies ? cookies.substring(0, 60) : 'none'}`);

    // If step1 returned a redirect without following, grab cookies and continue
    if (step1.status >= 300 && step1.status < 400) {
      console.log('[login] Step 1 redirect location:', step1.headers.location);
    }

    // Generate a UUID like the browser JS does
    const uuid = 'login-' + crypto.randomBytes(5).toString('hex');

    // Step 2: GET the authentication form to extract the CSRF token
    const client2 = createClient(cookies);
    const step2 = await client2.get(
      `/tracker/app.php/authenticate/form?templates%5B%5D=login_form&uuid=${uuid}`,
      {
        ...permissive,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${BASE_URL}/tracker/index.php`,
        },
        maxRedirects: 5,
      }
    );
    cookies = mergeCookies(cookies, extractCookies(step2.headers));
    console.log(`[login] Step 2: status=${step2.status}, dataLen=${String(step2.data).length}`);

    if (step2.status !== 200) {
      console.error('[login] Step 2 non-200, body:', String(step2.data).substring(0, 300));
      return { error: `Backend returned ${step2.status} when fetching login form` };
    }

    // The response wraps the form HTML inside a <script> tag, so cheerio
    // treats it as text. Extract the inner HTML content first.
    let formHtml = String(step2.data);
    const scriptMatch = formHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      formHtml = scriptMatch[1];
    }
    const $ = cheerio.load(formHtml);
    const csrfToken = $('input#csrf-token').val() as string || $('#csrf-token').attr('value') as string;
    const formUuid = ($('#uuid').val() as string) || uuid;
    console.log(`[login] CSRF token: ${csrfToken ? csrfToken.substring(0, 8) + '...' : 'MISSING'}, uuid: ${formUuid}`);
    if (!csrfToken) {
      console.error('[login] Form HTML (first 500 chars):', formHtml.substring(0, 500));
      return { error: 'Failed to extract CSRF token from login form' };
    }

    // Step 3: POST credentials
    const encodeFormValue = (v: string) =>
      encodeURIComponent(v).replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const body = `csrf-token=${encodeFormValue(csrfToken)}&username=${encodeFormValue(username)}&password=${encodeFormValue(password)}&uuid=${encodeFormValue(formUuid)}&redirect=`;

    const client3 = createClient(cookies);
    const step3 = await client3.post(
      '/tracker/app.php/authenticate/login',
      body,
      {
        ...permissive,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/tracker/index.php`,
        },
        maxRedirects: 0,
      }
    );
    cookies = mergeCookies(cookies, extractCookies(step3.headers));
    console.log(`[login] Step 3: status=${step3.status}, data=${JSON.stringify(step3.data).substring(0, 300)}`);

    if (step3.status === 401 || step3.status === 403) {
      const msg = typeof step3.data === 'object' && step3.data?.error
        ? step3.data.error
        : `Backend rejected login (HTTP ${step3.status})`;
      return { error: msg };
    }

    const result = step3.data;
    if (result && result.success) {
      // Also authenticate against the REST API to get a Bearer token for map data
      let apiToken = '';
      try {
        const apiLogin = await axios.post(`${API_URL}/login`, {
          username,
          password,
        }, { timeout: 15000 });
        apiToken = apiLogin.data?.token || '';
        console.log(`[login] REST API token obtained: ${apiToken ? 'yes' : 'no'}`);
      } catch (apiErr: any) {
        console.warn('[login] REST API login failed (non-fatal):', apiErr.message);
      }

      const token = generateToken();
      await saveSession(token, {
        cookies,
        csrfToken,
        apiToken,
        lastUsed: Date.now(),
      });
      console.log('[login] Success, session saved');
      return { token };
    } else {
      const errorMsg = typeof result === 'string'
        ? `Login rejected (got HTML — status ${step3.status})`
        : result?.error || 'Login failed — invalid credentials or server error';
      console.error('[login] Failed:', errorMsg);
      return { error: errorMsg };
    }
  } catch (err: any) {
    console.error('[login] Exception:', err.message);
    if (err.response) {
      console.error('[login] Response status:', err.response.status);
      console.error('[login] Response data:', String(err.response.data).substring(0, 300));
    }
    return { error: `Login failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// HTML Table Parsers
// ---------------------------------------------------------------------------

function parseDeviceTable(html: string): {
  devices: any[];
  total: number;
  offset: number;
  limit: number;
} {
  const $ = cheerio.load(html);
  const headers: string[] = [];

  $('th').each((_i, el) => {
    headers.push($(el).text().trim());
  });

  const uniqueHeaders = [...new Set(headers)];

  const devices: any[] = [];
  $('tbody tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length === 0) return;
    const device: Record<string, string> = {};
    cells.each((j, cell) => {
      const key = uniqueHeaders[j] || `col${j}`;
      device[key] = $(cell).text().trim();
    });
    devices.push(device);
  });

  // Deduplicate devices by checking for duplicates from the double selector
  const seen = new Set<string>();
  const uniqueDevices = devices.filter((d) => {
    const key = JSON.stringify(d);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Extract pagination total from text like "of X,XXX"
  let total = uniqueDevices.length;
  const bodyText = $.text();
  const totalMatch = bodyText.match(/(?:of|Total)\s+([\d,]+)/);
  if (totalMatch) {
    total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
  }

  return { devices: uniqueDevices, total, offset: 0, limit: uniqueDevices.length };
}

function parseLocationTable(html: string): {
  locations: any[];
  total: number;
} {
  const $ = cheerio.load(html);
  const headers: string[] = [];

  $('th').each((_i, el) => {
    headers.push($(el).text().trim());
  });

  const uniqueHeaders = [...new Set(headers)];

  const locations: any[] = [];
  $('tbody tr, table tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length === 0) return;
    const location: Record<string, string> = {};
    cells.each((j, cell) => {
      const key = uniqueHeaders[j] || `col${j}`;
      location[key] = $(cell).text().trim();
    });
    locations.push(location);
  });

  const seen = new Set<string>();
  const uniqueLocations = locations.filter((l) => {
    const key = JSON.stringify(l);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let total = uniqueLocations.length;
  const bodyText = $.text();
  const totalMatch = bodyText.match(/(?:of|Total)\s+([\d,]+)/);
  if (totalMatch) {
    total = parseInt(totalMatch[1].replace(/,/g, ''), 10);
  }

  return { locations: uniqueLocations, total };
}

function parseSearchResults(html: string): any[] {
  const $ = cheerio.load(html);
  const results: any[] = [];
  const headers: string[] = [];

  $('th').each((_i, el) => {
    headers.push($(el).text().trim());
  });

  const uniqueHeaders = [...new Set(headers)];

  $('tbody tr, table tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length === 0) return;
    const item: Record<string, string> = {};
    cells.each((j, cell) => {
      const key = uniqueHeaders[j] || `col${j}`;
      item[key] = $(cell).text().trim();
    });
    results.push(item);
  });

  const seen = new Set<string>();
  return results.filter((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Session Validation
// ---------------------------------------------------------------------------

async function getSession(
  authHeader: string | undefined
): Promise<{ token: string; session: SessionData } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const session = await loadSession(token);
  if (!session) return null;

  session.lastUsed = Date.now();
  return { token, session };
}

// ---------------------------------------------------------------------------
// HTTP Endpoint
// ---------------------------------------------------------------------------

export const dtdProxy = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Strip /api prefix from path
  let routePath = req.path;
  if (routePath.startsWith('/api')) {
    routePath = routePath.substring(4);
  }

  try {
    // -----------------------------------------------------------------------
    // POST /auth/login
    // -----------------------------------------------------------------------
    if (routePath === '/auth/login' && req.method === 'POST') {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: 'username and password are required' });
        return;
      }
      const result = await loginFlow(username, password);
      if ('error' in result) {
        res.status(401).json(result);
      } else {
        res.json(result);
      }
      return;
    }

    // All remaining routes require authentication
    const sessionResult = await getSession(req.headers.authorization);
    if (!sessionResult) {
      res.status(401).json({ error: 'Unauthorized. Provide a valid Bearer token.' });
      return;
    }

    const { token: sessionToken, session } = sessionResult;
    const client = createClient(session.cookies);

    // Helper to update session cookies from response and persist
    const updateCookies = async (headers: Record<string, any>) => {
      const newCookies = extractCookies(headers);
      if (newCookies) {
        session.cookies = mergeCookies(session.cookies, newCookies);
      }
      await touchSession(sessionToken, session);
    };

    // -----------------------------------------------------------------------
    // GET /devices
    // -----------------------------------------------------------------------
    if (routePath === '/devices' && req.method === 'GET') {
      const rows = req.query.rows || '25';
      const offset = req.query.offset || '0';
      const sort = req.query.sort || '';
      const desc = req.query.desc || '';

      let url = `/tracker/app.php/device_list?rows=${rows}&offset=${offset}`;
      if (sort) url += `&sort=${sort}`;
      if (desc) url += `&desc=${desc}`;

      const response = await client.get(url);
      await updateCookies(response.headers);

      const parsed = parseDeviceTable(response.data);
      parsed.offset = parseInt(offset as string, 10);
      parsed.limit = parseInt(rows as string, 10);
      res.json(parsed);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /locations
    // -----------------------------------------------------------------------
    if (routePath === '/locations' && req.method === 'GET') {
      const rows = req.query.rows || '25';
      const offset = req.query.offset || '0';

      const url = `/tracker/app.php/location_list?rows=${rows}&offset=${offset}`;
      const response = await client.get(url);
      await updateCookies(response.headers);

      const parsed = parseLocationTable(response.data);
      res.json(parsed);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /alerts
    // -----------------------------------------------------------------------
    if (routePath === '/alerts' && req.method === 'GET') {
      const url = '/tracker/app.php/alert_pane?xml=1&force_update=1';
      const response = await client.get(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      await updateCookies(response.headers);
      res.json(response.data);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /search
    // -----------------------------------------------------------------------
    if (routePath === '/search' && req.method === 'GET') {
      const q = req.query.q || '';
      const url = `/tracker/app.php/device_list?search=${encodeURIComponent(q as string)}`;
      const response = await client.get(url);
      await updateCookies(response.headers);

      const results = parseSearchResults(response.data);
      res.json({ results });
      return;
    }

    // -----------------------------------------------------------------------
    // GET /locations/search
    // -----------------------------------------------------------------------
    if (routePath === '/locations/search' && req.method === 'GET') {
      const q = req.query.q || '';
      const url = `/tracker/app.php/location/ajax/search_by_name_or_id?term=${encodeURIComponent(q as string)}`;
      const response = await client.get(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      await updateCookies(response.headers);
      res.json(response.data);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /devices/map — All devices with lat/lon from REST API
    // -----------------------------------------------------------------------
    if (routePath === '/devices/map' && req.method === 'GET') {
      if (!session.apiToken) {
        res.status(503).json({ error: 'REST API token not available. Please log in again.' });
        return;
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const maxPerPage = parseInt(req.query.max_per_page as string, 10) || 1000;

      const apiRes = await axios.get(`${API_URL}/devices`, {
        params: {
          page,
          max_per_page: maxPerPage,
          sort_field: 'last_point_time',
          sort_direction: 'desc',
        },
        headers: { Authorization: `Bearer ${session.apiToken}` },
        timeout: 30000,
      });

      await touchSession(sessionToken, session);
      res.json(apiRes.data);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /devices/active — Active devices from REST API
    // -----------------------------------------------------------------------
    if (routePath === '/devices/active' && req.method === 'GET') {
      if (!session.apiToken) {
        res.status(503).json({ error: 'REST API token not available. Please log in again.' });
        return;
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const maxPerPage = parseInt(req.query.max_per_page as string, 10) || 1000;

      const apiRes = await axios.get(`${API_URL}/active_devices`, {
        params: {
          page,
          max_per_page: maxPerPage,
          sort_field: 'last_point_time',
          sort_direction: 'desc',
        },
        headers: { Authorization: `Bearer ${session.apiToken}` },
        timeout: 30000,
      });

      await touchSession(sessionToken, session);
      res.json(apiRes.data);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /locations/map — All locations with lat/lon from REST API
    // -----------------------------------------------------------------------
    if (routePath === '/locations/map' && req.method === 'GET') {
      if (!session.apiToken) {
        res.status(503).json({ error: 'REST API token not available. Please log in again.' });
        return;
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const maxPerPage = parseInt(req.query.max_per_page as string, 10) || 1000;

      const apiRes = await axios.get(`${API_URL}/locations`, {
        params: {
          page,
          max_per_page: maxPerPage,
        },
        headers: { Authorization: `Bearer ${session.apiToken}` },
        timeout: 30000,
      });

      await touchSession(sessionToken, session);
      res.json(apiRes.data);
      return;
    }

    // -----------------------------------------------------------------------
    // GET /devices/position/:number — Single device position from REST API
    // -----------------------------------------------------------------------
    const positionMatch = routePath.match(/^\/devices\/position\/(.+)$/);
    if (positionMatch && req.method === 'GET') {
      if (!session.apiToken) {
        res.status(503).json({ error: 'REST API token not available. Please log in again.' });
        return;
      }

      const deviceNumber = positionMatch[1];
      const apiRes = await axios.get(`${API_URL}/devices/position/${deviceNumber}`, {
        headers: { Authorization: `Bearer ${session.apiToken}` },
        timeout: 15000,
      });

      await touchSession(sessionToken, session);
      res.json(apiRes.data);
      return;
    }

    // -----------------------------------------------------------------------
    // Unknown route
    // -----------------------------------------------------------------------
    res.status(404).json({ error: `Unknown route: ${req.method} ${routePath}` });
  } catch (err: any) {
    console.error('dtdProxy error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
