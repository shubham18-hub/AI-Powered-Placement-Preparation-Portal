import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) {
    return;
  }

  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const SECRET_KEY = process.env.SECRET_KEY || 'dev_secret_key_change_me';
const ACCESS_TOKEN_EXPIRE_MINUTES = 60;
const REFRESH_TOKEN_EXPIRE_DAYS = 7;
const VALID_ROLES = new Set(['student', 'admin']);
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RESUMES_FILE = path.join(DATA_DIR, 'resumes.json');
const ATS_FILE = path.join(DATA_DIR, 'ats.json');
const DSA_FILE = path.join(DATA_DIR, 'dsa.json');
const INTERVIEWS_FILE = path.join(DATA_DIR, 'interviews.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

const refreshTokens = new Map();
const ATS_API_KEY = process.env.ATS_API_KEY || '';
const ATS_BASE_URL = process.env.ATS_BASE_URL || 'https://api.openai.com/v1';
const ATS_MODEL = process.env.ATS_MODEL || 'gpt-4o-mini';

function createDefaultState() {
  return {
    users: [],
    resumes: [],
    atsResults: [],
    dsaProblems: [],
    interviews: [],
    notifications: [],
  };
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

const state = {
  users: loadJson(USERS_FILE, []),
  resumes: loadJson(RESUMES_FILE, []),
  atsResults: loadJson(ATS_FILE, []),
  dsaProblems: loadJson(DSA_FILE, []),
  interviews: loadJson(INTERVIEWS_FILE, []),
  notifications: loadJson(NOTIFICATIONS_FILE, []),
};

function ensureSeedData() {
  if (!Array.isArray(state.users) || state.users.length === 0) {
    const demoPassword = hashPassword('ap3demo123');
    state.users = [
      { name: 'Demo Student', email: 'student@ap3.dev', password: demoPassword, role: 'student', createdAt: new Date().toISOString() },
      { name: 'Demo Admin', email: 'admin@ap3.dev', password: demoPassword, role: 'admin', createdAt: new Date().toISOString() },
    ];
  }

  if (!Array.isArray(state.resumes)) state.resumes = [];
  if (!Array.isArray(state.atsResults)) state.atsResults = [];
  if (!Array.isArray(state.dsaProblems) || state.dsaProblems.length === 0) {
    state.dsaProblems = [
      { id: 'dsa-1', userEmail: 'student@ap3.dev', title: 'Two Sum', company: 'Google', difficulty: 'Easy', tags: ['Hash Map', 'Arrays'], status: 'Solved', updatedAt: new Date().toISOString() },
      { id: 'dsa-2', userEmail: 'student@ap3.dev', title: 'Merge Intervals', company: 'Microsoft', difficulty: 'Medium', tags: ['Intervals', 'Sorting'], status: 'In Progress', updatedAt: new Date().toISOString() },
      { id: 'dsa-3', userEmail: 'student@ap3.dev', title: 'Binary Tree Level Order Traversal', company: 'Amazon', difficulty: 'Medium', tags: ['Trees', 'BFS'], status: 'Planned', updatedAt: new Date().toISOString() },
    ];
  }

  if (!Array.isArray(state.interviews) || state.interviews.length === 0) {
    state.interviews = [
      { id: 'interview-1', userEmail: 'student@ap3.dev', company: 'Google', role: 'Frontend Engineer', date: '2026-08-12', time: '10:00', status: 'Confirmed' },
      { id: 'interview-2', userEmail: 'student@ap3.dev', company: 'Microsoft', role: 'Software Engineer', date: '2026-08-14', time: '16:30', status: 'Scheduled' },
    ];
  }

  if (!Array.isArray(state.notifications) || state.notifications.length === 0) {
    state.notifications = [
      { id: 'notify-1', userEmail: 'student@ap3.dev', title: 'ATS result ready', detail: 'Your latest resume scan is ready for review.', createdAt: new Date().toISOString(), read: false },
      { id: 'notify-2', userEmail: 'student@ap3.dev', title: 'Interview reminder', detail: 'Mock interview for Google starts tomorrow.', createdAt: new Date().toISOString(), read: true },
    ];
  }

  saveJson(USERS_FILE, state.users);
  saveJson(RESUMES_FILE, state.resumes);
  saveJson(ATS_FILE, state.atsResults);
  saveJson(DSA_FILE, state.dsaProblems);
  saveJson(INTERVIEWS_FILE, state.interviews);
  saveJson(NOTIFICATIONS_FILE, state.notifications);
}

ensureSeedData();

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(data) {
  return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('base64url');
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.${hmac(`${header}.${body}`)}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [header, body, signature] = parts;
  const expected = hmac(`${header}.${body}`);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) {
    throw new Error('Token expired');
  }

  return payload;
}

function createToken(payload, expiresInSeconds, type) {
  return signToken({
    ...payload,
    type,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

function createAccessToken(data) {
  return createToken(data, ACCESS_TOKEN_EXPIRE_MINUTES * 60, 'access');
}

function createRefreshToken(email) {
  return createToken({ sub: email }, REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60, 'refresh');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4) {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function sanitizeFileName(fileName) {
  return String(fileName || 'resume').replace(/[\\/\\:*?"<>|]/g, '_');
}

function json(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5e6) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authCookie(value) {
  return `refresh_token=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60}`;
}

function clearAuthCookie() {
  return 'refresh_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}

function currentUserFromAuthHeader(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    const error = new Error('Missing access token');
    error.statusCode = 401;
    throw error;
  }
  const payload = verifyToken(authHeader.slice(7).trim());
  if (payload.type !== 'access') {
    const error = new Error('Invalid token type');
    error.statusCode = 401;
    throw error;
  }
  const email = payload.sub;
  const user = state.users.find((entry) => entry.email === email);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 401;
    throw error;
  }
  return { name: user.name, email: user.email, role: user.role };
}

function buildAuthResponse(email, res) {
  const user = state.users.find((entry) => entry.email === email);
  const accessToken = createAccessToken({ sub: email, name: user.name, role: user.role });
  const refreshToken = createRefreshToken(email);
  refreshTokens.set(email, refreshToken);
  res.setHeader('Set-Cookie', authCookie(refreshToken));
  return { user: { name: user.name, email: user.email, role: user.role }, accessToken };
}

function persistUserStore() {
  saveJson(USERS_FILE, state.users);
  saveJson(RESUMES_FILE, state.resumes);
  saveJson(ATS_FILE, state.atsResults);
  saveJson(DSA_FILE, state.dsaProblems);
  saveJson(INTERVIEWS_FILE, state.interviews);
  saveJson(NOTIFICATIONS_FILE, state.notifications);
}

function createNotification(userEmail, title, detail) {
  const notification = {
    id: `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userEmail,
    title,
    detail,
    createdAt: new Date().toISOString(),
    read: false,
  };
  state.notifications.unshift(notification);
  persistUserStore();
  return notification;
}

function fallbackATSResult(userEmail, fileName, jobDescription) {
  const normalized = `${fileName} ${jobDescription}`.toLowerCase();
  const keywords = (jobDescription || '').toLowerCase().split(/\W+/).filter(Boolean);
  const keywordMatches = keywords.filter((word) => normalized.includes(word)).length;
  const breakdown = {
    keywords: Math.min(100, 75 + keywordMatches * 4),
    sectionStructure: 82 + (jobDescription ? 4 : 0),
    impact: 78 + (normalized.includes('project') ? 4 : 0),
  };
  const score = Math.round((breakdown.keywords + breakdown.sectionStructure + breakdown.impact) / 3);
  const result = {
    id: `ats-${Date.now()}`,
    userEmail,
    fileName,
    score,
    jobDescription: jobDescription || 'General placement screening',
    breakdown,
    summary: score >= 85 ? 'Strong alignment for recruiter screening' : 'Good base, add more impact bullets and keywords.',
    createdAt: new Date().toISOString(),
    provider: 'heuristic',
  };
  return result;
}

async function createATSResult(userEmail, fileName, jobDescription, resumeContent = '') {
  const fallback = fallbackATSResult(userEmail, fileName, jobDescription);

  if (!ATS_API_KEY) {
    state.atsResults.unshift(fallback);
    persistUserStore();
    return fallback;
  }

  try {
    const payload = {
      model: ATS_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an ATS scoring assistant. Score the resume fit for a job description. Return valid JSON with score, summary, and breakdown keys containing keywords, sectionStructure, and impact percentages.',
        },
        {
          role: 'user',
          content: `Resume file: ${fileName}\nJob description: ${jobDescription || 'General placement screening'}\nResume preview: ${resumeContent.slice(0, 4000) || 'No text preview available.'}`,
        },
      ],
    };

    const response = await fetch(`${ATS_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ATS_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Provider responded with ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const result = {
      id: `ats-${Date.now()}`,
      userEmail,
      fileName,
      score: Number(parsed.score) || fallback.score,
      jobDescription: jobDescription || 'General placement screening',
      breakdown: {
        keywords: Number(parsed.breakdown?.keywords) || fallback.breakdown.keywords,
        sectionStructure: Number(parsed.breakdown?.sectionStructure) || fallback.breakdown.sectionStructure,
        impact: Number(parsed.breakdown?.impact) || fallback.breakdown.impact,
      },
      summary: String(parsed.summary || fallback.summary),
      createdAt: new Date().toISOString(),
      provider: 'api',
    };
    state.atsResults.unshift(result);
    persistUserStore();
    return result;
  } catch (error) {
    console.warn('ATS provider failed, falling back to heuristic scoring', error.message);
    const result = { ...fallback, provider: 'heuristic-fallback' };
    state.atsResults.unshift(result);
    persistUserStore();
    return result;
  }
}

function handleCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
}

async function handler(req, res) {
  handleCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || 'student').trim().toLowerCase();

      if (!name) {
        json(res, 400, { detail: 'Name is required' });
        return;
      }
      if (!validateEmail(email)) {
        json(res, 400, { detail: 'Invalid email address' });
        return;
      }
      if (password.length < 8) {
        json(res, 400, { detail: 'Password must be at least 8 characters' });
        return;
      }
      if (!VALID_ROLES.has(role)) {
        json(res, 400, { detail: 'Invalid role' });
        return;
      }
      if (state.users.some((entry) => entry.email === email)) {
        json(res, 400, { detail: 'User already exists' });
        return;
      }

      state.users.push({ name, email, password: hashPassword(password), role, createdAt: new Date().toISOString() });
      persistUserStore();
      json(res, 200, buildAuthResponse(email, res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const user = state.users.find((entry) => entry.email === email);

      if (!validateEmail(email) || !user || !verifyPassword(password, user.password)) {
        json(res, 401, { detail: 'Invalid credentials' });
        return;
      }

      json(res, 200, buildAuthResponse(email, res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
      const cookies = parseCookies(req.headers.cookie || '');
      const refreshToken = cookies.refresh_token;
      if (!refreshToken) {
        json(res, 401, { detail: 'Missing refresh token' });
        return;
      }

      const payload = verifyToken(refreshToken);
      if (payload.type !== 'refresh') {
        json(res, 401, { detail: 'Invalid token type' });
        return;
      }

      const email = payload.sub;
      if (!state.users.some((entry) => entry.email === email) || refreshTokens.get(email) !== refreshToken) {
        json(res, 401, { detail: 'Refresh token revoked' });
        return;
      }

      const user = state.users.find((entry) => entry.email === email);
      const accessToken = createAccessToken({ sub: email, name: user.name, role: user.role });
      const newRefreshToken = createRefreshToken(email);
      refreshTokens.set(email, newRefreshToken);
      res.setHeader('Set-Cookie', authCookie(newRefreshToken));
      json(res, 200, { user: { name: user.name, email: user.email, role: user.role }, accessToken });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const cookies = parseCookies(req.headers.cookie || '');
      const refreshToken = cookies.refresh_token;
      if (refreshToken) {
        try {
          const payload = verifyToken(refreshToken);
          if (payload.sub && refreshTokens.get(payload.sub) === refreshToken) {
            refreshTokens.delete(payload.sub);
          }
        } catch {
          // Ignore invalid logout token
        }
      }
      res.setHeader('Set-Cookie', clearAuthCookie());
      json(res, 200, { message: 'Logged out' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      try {
        json(res, 200, { user: currentUserFromAuthHeader(req) });
      } catch (error) {
        json(res, error.statusCode || 401, { detail: error.message || 'Unauthorized' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/ping') {
      try {
        const currentUser = currentUserFromAuthHeader(req);
        if (currentUser.role !== 'admin') {
          json(res, 403, { detail: 'Forbidden' });
          return;
        }
        json(res, 200, { message: `Hello, ${currentUser.name}` });
      } catch (error) {
        json(res, error.statusCode || 401, { detail: error.message || 'Unauthorized' });
      }
      return;
    }

    const currentUser = currentUserFromAuthHeader(req);

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const resumes = state.resumes.filter((entry) => entry.userEmail === currentUser.email);
      const atsResults = state.atsResults.filter((entry) => entry.userEmail === currentUser.email);
      const dsaProblems = state.dsaProblems.filter((entry) => entry.userEmail === currentUser.email);
      const interviews = state.interviews.filter((entry) => entry.userEmail === currentUser.email);
      const notifications = state.notifications.filter((entry) => entry.userEmail === currentUser.email);
      const solved = dsaProblems.filter((entry) => entry.status === 'Solved').length;
      json(res, 200, {
        user: currentUser,
        metrics: {
          resumeCount: resumes.length,
          atsScore: atsResults[0]?.score || 0,
          dsaSolved: solved,
          interviewCount: interviews.length,
          unreadNotifications: notifications.filter((entry) => !entry.read).length,
        },
        highlights: [
          { title: 'Resume health', detail: resumes.length ? 'A fresh resume has been uploaded and scored.' : 'Upload your first resume to begin ATS scoring.' },
          { title: 'DSA momentum', detail: `You have ${solved} solved problem${solved === 1 ? '' : 's'} in your tracker.` },
          { title: 'Interviews', detail: interviews.length ? 'Upcoming interviews are already scheduled.' : 'Book your next interview slot to stay on track.' },
        ],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/resumes') {
      const items = state.resumes.filter((entry) => entry.userEmail === currentUser.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      json(res, 200, { resumes: items });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/resume/upload') {
      const body = await readBody(req);
      if (!body.fileName || !body.content) {
        json(res, 400, { detail: 'Resume file is required' });
        return;
      }

      const fileName = sanitizeFileName(body.fileName);
      const userDir = path.join(UPLOAD_DIR, sanitizeFileName(currentUser.email));
      fs.mkdirSync(userDir, { recursive: true });
      const filePath = path.join(userDir, `${Date.now()}-${fileName}`);
      const buffer = Buffer.from(String(body.content), 'base64');
      fs.writeFileSync(filePath, buffer);

      const entry = {
        id: `resume-${Date.now()}`,
        userEmail: currentUser.email,
        fileName,
        filePath,
        mimeType: body.mimeType || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
        status: 'uploaded',
      };
      state.resumes.unshift(entry);
      const atsResult = await createATSResult(currentUser.email, fileName, body.jobDescription || 'Frontend developer', body.resumeText || '');
      createNotification(currentUser.email, 'Resume uploaded', `Your resume ${fileName} has been uploaded and scored.`);
      createNotification(currentUser.email, 'ATS score ready', `Your latest ATS score is ${atsResult.score}/100.`);
      persistUserStore();
      json(res, 200, { resume: entry, ats: atsResult });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/ats') {
      const userAts = state.atsResults.filter((entry) => entry.userEmail === currentUser.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = userAts[0] || null;
      json(res, 200, { latest, history: userAts, breakdown: latest?.breakdown || null });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ats/score') {
      const body = await readBody(req);
      const latest = await createATSResult(currentUser.email, body.fileName || 'resume.pdf', body.jobDescription || 'Frontend developer', body.resumeText || '');
      json(res, 200, { ats: latest });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/dsa') {
      const userProblems = state.dsaProblems.filter((entry) => entry.userEmail === currentUser.email);
      json(res, 200, { problems: userProblems });
      return;
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/dsa/')) {
      const id = url.pathname.split('/').pop();
      const body = await readBody(req);
      const target = state.dsaProblems.find((entry) => entry.id === id && entry.userEmail === currentUser.email);
      if (!target) {
        json(res, 404, { detail: 'Problem not found' });
        return;
      }
      target.status = body.status || target.status;
      target.updatedAt = new Date().toISOString();
      persistUserStore();
      json(res, 200, { problem: target, problems: state.dsaProblems.filter((entry) => entry.userEmail === currentUser.email) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/interviews') {
      const items = state.interviews.filter((entry) => entry.userEmail === currentUser.email).sort((a, b) => a.date.localeCompare(b.date));
      json(res, 200, { interviews: items });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/interviews') {
      const body = await readBody(req);
      const item = {
        id: `interview-${Date.now()}`,
        userEmail: currentUser.email,
        company: body.company || 'Target Company',
        role: body.role || 'Software Engineer',
        date: body.date || new Date().toISOString().slice(0, 10),
        time: body.time || '09:00',
        status: body.status || 'Scheduled',
      };
      state.interviews.unshift(item);
      persistUserStore();
      createNotification(currentUser.email, 'Interview booked', `${item.company} interview has been added to your calendar.`);
      json(res, 200, { interview: item });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/notifications') {
      const items = state.notifications.filter((entry) => entry.userEmail === currentUser.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      json(res, 200, { notifications: items });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/notifications/')) {
      const id = url.pathname.split('/').pop();
      const target = state.notifications.find((entry) => entry.id === id && entry.userEmail === currentUser.email);
      if (!target) {
        json(res, 404, { detail: 'Notification not found' });
        return;
      }
      target.read = true;
      persistUserStore();
      json(res, 200, { notification: target });
      return;
    }

    json(res, 404, { detail: 'Not found' });
  } catch (error) {
    json(res, 500, { detail: error.message || 'Internal server error' });
  }
}

http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});
