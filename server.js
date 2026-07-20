require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');

// Initialize database with SaaS collections
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({
    users: [],
    apis: [],
    subscriptions: [],
    api_runs: [],
    transactions: []
  }, null, 2));
} else {
  // Run schema migration if database exists from core step
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    let migrated = false;
    if (!db.users) { db.users = []; migrated = true; }
    if (!db.apis) { db.apis = []; migrated = true; }
    if (!db.subscriptions) { db.subscriptions = []; migrated = true; }
    if (!db.api_runs) { db.api_runs = []; migrated = true; }
    if (!db.transactions) { db.transactions = []; migrated = true; }
    
    // Migrate legacy APIs that don't have a userId
    db.apis.forEach(api => {
      if (!api.userId) {
        api.userId = 'system';
        api.isPublic = true;
        api.priceBDT = 0;
        migrated = true;
      }
    });

    // Migrate user accounts to include role
    db.users.forEach(user => {
      if (user.email.toLowerCase() === 'demo@aetherflow.com') {
        if (user.role !== 'admin' || user.tier !== 'pro') {
          user.role = 'admin';
          user.tier = 'pro';
          migrated = true;
        }
      } else if (!user.role) {
        user.role = 'user';
        migrated = true;
      }
    });
    
    if (migrated) {
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
      console.log("Database schema successfully migrated for SaaS features.");
    }
  } catch (e) {
    console.error("Database migration check failed:", e);
  }
}

function getDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return { users: [], apis: [], subscriptions: [], api_runs: [], transactions: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Password hashing helper (Sha256 - zero dependencies)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// --- MIDDLEWARES ---

// User authentication helper (Bearer token)
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.replace(/^Bearer\s+/, '');
  
  if (!token || !token.startsWith('token_')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Session expired or missing' });
  }
  
  const userId = token.substring(6); // remove 'token_'
  const db = getDB();
  const user = db.users.find(u => u.id === userId);
  
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: User not found' });
  }
  
  // Attach user profile (strip password)
  req.user = {
    id: user.id,
    email: user.email,
    tier: user.tier,
    role: user.role || 'user',
    apiKey: user.apiKey,
    createdAt: user.createdAt
  };
  next();
}

// --- SPEC GENERATORS ---

function generateMockSpec(steps) {
  let siteName = "Web Automation";
  const navStep = steps.find(s => s.action === 'navigate');
  if (navStep && navStep.url) {
    try {
      const urlObj = new URL(navStep.url);
      siteName = urlObj.hostname.replace('www.', '') + " API";
    } catch (e) {
      // ignore
    }
  }
  
  const parameters = [];
  const outputs = [];
  
  steps.forEach((step, index) => {
    if (step.action === 'fill') {
      let name = `input_${index}`;
      if (step.selector.includes('#')) {
        name = step.selector.split('#')[1].replace(/[^a-z0-9_]/g, '_');
      } else if (step.selector.includes('[name=')) {
        const matches = step.selector.match(/name="([^"]+)"/);
        if (matches) name = matches[1];
      }
      
      parameters.push({
        name: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        stepIndex: index,
        defaultValue: step.value,
        description: `Text input for selector "${step.selector}"`
      });
    }
    if (step.action === 'extract') {
      outputs.push({
        label: step.label,
        stepIndex: index,
        description: `Extracted text from selector "${step.selector}"`
      });
    }
    if (step.action === 'extract_llm') {
      outputs.push({
        label: step.label,
        stepIndex: index,
        description: `AI Extracted data for query "${step.prompt}"`
      });
    }
  });
  
  return {
    name: siteName,
    description: `A custom automated API generated from user actions recorded on ${siteName}.`,
    parameters,
    outputs,
    analysis: `This API automates the process of interacting with ${siteName} and performing user recorded actions.`,
    clarifications: [
      `Should the API extract more elements, or is the current single-page flow sufficient?`,
      `Do you need to support custom parameters for input fields?`
    ]
  };
}
 
async function generateApiSpec(steps) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.warn("No GEMINI_API_KEY found. Falling back to rule-based parser.");
    return generateMockSpec(steps);
  }
  
  try {
    const stepsString = JSON.stringify(steps, null, 2);
    const promptText = `
You are an expert system that analyzes browser automation scripts and transforms them into parameterized API definitions.
Below is a sequence of actions recorded by a user:
${stepsString}
 
Your task:
1. Come up with a clean name (e.g. "Google Search API") and a descriptive summary of what this automation does.
2. Identify all steps that have user-inputted strings (where action is 'fill'). These inputs should be parameterized. Recommend parameter names that make sense (e.g., 'search_query', 'username', 'email') instead of hardcoded values, describe what they are, and keep their original recorded value as the default.
3. Identify all steps that extract data (action is 'extract' or 'extract_llm'). For each extract step, describe what value it returns (based on the step label and selector/AI prompt).
4. Write a brief 1-2 sentence high-level analysis of the captured flow steps.
5. List 2-3 clarification questions or recommendations about potential edge cases, budget parameters, or dynamic elements in this automation.

Return a valid JSON object matching this schema:
{
  "name": "string (name of the API)",
  "description": "string (description of the API)",
  "analysis": "string (brief summary of steps)",
  "clarifications": ["string (clarification question/recommendation 1)", "string (2)"],
  "parameters": [
    {
      "name": "string (parameter name, lowercase alphanumeric + underscore)",
      "stepIndex": number (0-based index of the step in the array that this parameter applies to),
      "defaultValue": "string (the value from the step)",
      "description": "string (what this parameter represents)"
    }
  ],
  "outputs": [
    {
      "label": "string (the label of the extract step)",
      "stepIndex": number (0-based index of the extract step),
      "description": "string (what is being extracted)"
    }
  ]
}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini Spec Generation API failed. Falling back to mock generator. Error:", err.message);
    return generateMockSpec(steps);
  }
}

// --- PLAYWRIGHT RUNNER ---

async function runLlmExtraction(pageText, promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error("GEMINI_API_KEY is not set. Cannot run LLM-powered extraction.");
  }
  
  const prompt = `
You are an expert data extraction system. You are given the visible text content of a web page and a request for what data to extract.
Your goal is to extract the requested structured data as a clean JSON object or array.

Request: "${promptText}"

Return a valid JSON response containing the extracted data. Do not include markdown code block formatting (like \`\`\`json). Return ONLY the raw JSON string.

Web Page Content:
${pageText}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text.trim();
    
    // Strip any markdown code fence if the LLM outputted them
    let cleanedText = responseText;
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/, '').replace(/```$/, '').trim();
    }
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("Gemini Extraction direct REST call failed:", err.message);
    throw err;
  }
}

// --- PLAYWRIGHT RUNNER ---

async function runFlow(steps, params) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });
  
  // Disable navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const results = {};
  
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let value = step.value;
      const paramMatch = params.find(p => p.stepIndex === i);
      if (paramMatch && paramMatch.value !== undefined) {
        value = paramMatch.value;
      }
      
      switch (step.action) {
        case 'navigate':
          console.log(`[Replayer] Navigating to: ${step.url}`);
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          break;
        case 'click':
          console.log(`[Replayer] Clicking: ${step.selector}`);
          await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
          if (step.selector.includes('has-text(')) {
            const textMatch = step.selector.match(/:has-text\("([^"]+)"\)/);
            if (textMatch) {
              await page.locator(`text=${textMatch[1]}`).first().click({ timeout: 10000 });
            } else {
              await page.click(step.selector, { timeout: 10000 });
            }
          } else {
            await page.click(step.selector, { timeout: 10000 });
          }
          break;
        case 'fill':
          console.log(`[Replayer] Typing "${value}": ${step.selector}`);
          await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
          await page.fill(step.selector, value, { timeout: 10000 });
          break;
        case 'extract':
          console.log(`[Replayer] Extracting innerText: ${step.selector}`);
          await page.waitForSelector(step.selector, { timeout: 10000 });
          const text = await page.locator(step.selector).innerText();
          results[step.label] = text.trim();
          break;
        case 'extract_llm':
          console.log(`[Replayer] Extracting structured data using LLM: "${step.prompt}"`);
          const bodyText = await page.locator('body').innerText();
          try {
            const extractedData = await runLlmExtraction(bodyText, step.prompt);
            results[step.label] = extractedData;
          } catch (llmErr) {
            console.error("[Replayer LLM Error]:", llmErr);
            results[step.label] = { error: llmErr.message, fallbackText: bodyText.substring(0, 1000) };
          }
          break;
      }
      await page.waitForTimeout(500);
    }
    
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const screenshotBase64 = screenshotBuffer.toString('base64');
    return { success: true, results, screenshot: screenshotBase64 };
  } catch (error) {
    console.error("[Replayer Error]:", error);
    let errorScreenshot = null;
    try {
      const buffer = await page.screenshot({ fullPage: false });
      errorScreenshot = buffer.toString('base64');
    } catch (e) {}
    return { success: false, error: error.message, results, screenshot: errorScreenshot };
  } finally {
    await browser.close();
  }
}

// --- AUTH ROUTINGS ---

// Register User
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  const db = getDB();
  if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  
  const newUser = {
    id: 'usr_' + uuidv4().replace(/-/g, '').substring(0, 12),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    tier: 'free',
    role: 'user',
    apiKey: 'sk_usr_' + uuidv4().replace(/-/g, '').substring(0, 24),
    createdAt: new Date().toISOString()
  };
  
  db.users.push(newUser);
  saveDB(db);
  
  res.json({
    token: `token_${newUser.id}`,
    user: { id: newUser.id, email: newUser.email, tier: newUser.tier, role: newUser.role, apiKey: newUser.apiKey }
  });
});
 
// Login User
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  const db = getDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  
  res.json({
    token: `token_${user.id}`,
    user: { id: user.id, email: user.email, tier: user.tier, role: user.role || 'user', apiKey: user.apiKey }
  });
});

// Fetch current user details
app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = getDB();
  
  // Calculate daily run metrics
  const today = new Date().toISOString().substring(0, 10);
  const runsToday = db.api_runs.filter(r => r.userId === req.user.id && r.timestamp.startsWith(today)).length;
  
  res.json({
    ...req.user,
    runsToday,
    runsLimit: req.user.tier === 'free' ? 5 : Infinity
  });
});

// --- API ACTIONS (Dashboard level) ---

// Fetch My APIs (created + subscribed)
app.get('/api/apis', requireAuth, (req, res) => {
  const db = getDB();
  
  // APIs I own
  const myCreatedApis = db.apis.filter(api => api.userId === req.user.id || api.userId === 'system');
  
  // APIs I subscribed to in marketplace
  const mySubscribedIds = db.subscriptions
    .filter(sub => sub.userId === req.user.id)
    .map(sub => sub.apiId);
  const mySubscribedApis = db.apis.filter(api => mySubscribedIds.includes(api.id));
  
  res.json({
    created: myCreatedApis,
    subscribed: mySubscribedApis
  });
});

// Create API (from recorder)
app.post('/api/recordings', async (req, res) => {
  const { steps, userToken } = req.body;
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).send('Invalid steps data.');
  }
  
  // Resolve user id if logged in
  let userId = 'system';
  if (userToken && userToken.startsWith('token_')) {
    userId = userToken.substring(6);
  }
  
  console.log(`Creating API for user ${userId} with ${steps.length} steps.`);
  
  try {
    const spec = await generateApiSpec(steps);
    const newApi = {
      id: 'api_' + uuidv4().replace(/-/g, '').substring(0, 12),
      name: spec.name || 'Untitled API',
      description: spec.description || 'No description provided.',
      analysis: spec.analysis || '',
      clarifications: spec.clarifications || [],
      steps: steps,
      parameters: spec.parameters || [],
      outputs: spec.outputs || [],
      userId: userId,
      isPublic: true,
      priceBDT: 0,
      createdAt: new Date().toISOString()
    };
    
    const db = getDB();
    db.apis.push(newApi);
    saveDB(db);
    
    res.json(newApi);
  } catch (err) {
    console.error("Failed to process recording:", err);
    res.status(500).send('Server Error: ' + err.message);
  }
});

// Toggle Publish to Marketplace / Edit API details
app.post('/api/apis/:id/publish', requireAuth, (req, res) => {
  const { isPublic, priceBDT, name, description } = req.body;
  const db = getDB();
  
  const api = db.apis.find(a => a.id === req.params.id);
  if (!api) return res.status(404).json({ error: 'API not found' });
  if (api.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  if (isPublic !== undefined) api.isPublic = !!isPublic;
  if (priceBDT !== undefined) api.priceBDT = Math.max(0, parseInt(priceBDT) || 0);
  if (name !== undefined) api.name = name.trim() || api.name;
  if (description !== undefined) api.description = description.trim() || api.description;
  
  saveDB(db);
  res.json({ success: true, api });
});

// --- MARKETPLACE ACTIONS ---

// Fetch public marketplace APIs
app.get('/api/marketplace', requireAuth, (req, res) => {
  const db = getDB();
  
  // Filter only public APIs created by others (or system default)
  const publicApis = db.apis.filter(api => api.isPublic && api.userId !== req.user.id);
  
  // Attach subscription stats
  const result = publicApis.map(api => {
    const subscribersCount = db.subscriptions.filter(s => s.apiId === api.id).length;
    const isSubscribed = db.subscriptions.some(s => s.apiId === api.id && s.userId === req.user.id);
    const creatorEmail = db.users.find(u => u.id === api.userId)?.email || 'Platform Default';
    
    return {
      id: api.id,
      name: api.name,
      description: api.description,
      parametersCount: api.parameters.length,
      outputsCount: api.outputs.length,
      priceBDT: api.priceBDT,
      subscribersCount,
      isSubscribed,
      creatorEmail
    };
  });
  
  res.json(result);
});

// Subscribe to a marketplace API (with mock bKash verification for paid APIs)
app.post('/api/apis/:id/subscribe', requireAuth, (req, res) => {
  const apiId = req.params.id;
  const { bkashNumber, trxId } = req.body;
  const db = getDB();
  
  const api = db.apis.find(a => a.id === apiId);
  if (!api) return res.status(404).json({ error: 'API not found' });
  
  // Check if already subscribed
  if (db.subscriptions.some(s => s.apiId === apiId && s.userId === req.user.id)) {
    return res.status(400).json({ error: 'Already subscribed' });
  }
  
  // Validate bKash inputs for paid APIs
  if (api.priceBDT > 0) {
    if (!bkashNumber || !trxId) {
      return res.status(400).json({ error: 'bKash wallet number and Transaction ID (TrxID) are required for paid APIs.' });
    }
    if (trxId.length !== 10) {
      return res.status(400).json({ error: 'Invalid bKash Transaction ID. Must be exactly 10 alphanumeric characters.' });
    }
    
    // Save transaction
    const newTx = {
      id: 'tx_' + uuidv4().replace(/-/g, '').substring(0, 10),
      userId: req.user.id,
      bkashNumber,
      trxId: trxId.toUpperCase(),
      amount: api.priceBDT,
      type: 'api_purchase',
      apiId: apiId,
      timestamp: new Date().toISOString()
    };
    db.transactions.push(newTx);
  }
  
  // Create subscription
  db.subscriptions.push({
    id: 'sub_' + uuidv4().replace(/-/g, '').substring(0, 10),
    userId: req.user.id,
    apiId: apiId,
    createdAt: new Date().toISOString()
  });
  
  saveDB(db);
  res.json({ success: true, message: 'Subscribed successfully!' });
});

// --- BILLING / BKASH UPGRADE ---

app.post('/api/billing/upgrade', requireAuth, (req, res) => {
  const { bkashNumber, trxId } = req.body;
  if (!bkashNumber || !trxId) {
    return res.status(400).json({ error: 'bKash wallet number and Transaction ID (TrxID) are required.' });
  }
  if (trxId.length !== 10) {
    return res.status(400).json({ error: 'Invalid bKash Transaction ID. Must be exactly 10 alphanumeric characters.' });
  }
  
  const db = getDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  // Record Transaction
  const newTx = {
    id: 'tx_' + uuidv4().replace(/-/g, '').substring(0, 10),
    userId: req.user.id,
    bkashNumber,
    trxId: trxId.toUpperCase(),
    amount: 1000,
    type: 'plan_upgrade',
    timestamp: new Date().toISOString()
  };
  
  db.transactions.push(newTx);
  
  // Upgrade Account Tier
  user.tier = 'pro';
  saveDB(db);
  
  res.json({
    success: true,
    user: { id: user.id, email: user.email, tier: user.tier, apiKey: user.apiKey }
  });
});

// Fetch Revenue Split calculations (Owner Earnings)
app.get('/api/billing/earnings', requireAuth, (req, res) => {
  const db = getDB();
  
  // Find all public APIs owned by this user
  const myPublicApiIds = db.apis
    .filter(api => api.userId === req.user.id && api.isPublic)
    .map(api => api.id);
    
  // Find transactions buying these APIs
  const apiPurchases = db.transactions.filter(t => t.type === 'api_purchase' && myPublicApiIds.includes(t.apiId));
  
  const totalSalesBDT = apiPurchases.reduce((sum, tx) => sum + tx.amount, 0);
  const platformFeeBDT = Math.round(totalSalesBDT * 0.20); // 20% Fee
  const netEarningsBDT = totalSalesBDT - platformFeeBDT;     // 80% Share
  
  res.json({
    totalSalesBDT,
    platformFeeBDT,
    netEarningsBDT,
    salesCount: apiPurchases.length,
    transactions: apiPurchases.map(t => ({
      apiName: db.apis.find(a => a.id === t.apiId)?.name || 'Unknown API',
      amount: t.amount,
      timestamp: t.timestamp
    }))
  });
});

// --- SECURE API RUN PIPELINE ---

// Executing Endpoint via personal API key checking usage caps
app.post('/api/run/:id', async (req, res) => {
  const apiId = req.params.id;
  const db = getDB();
  const api = db.apis.find(a => a.id === apiId);
  
  if (!api) {
    return res.status(404).json({ success: false, error: 'API not found' });
  }
  
  // Resolve runner credentials (must match API Key `sk_usr_...` or query)
  const authHeader = req.headers['authorization'];
  const reqKey = req.query.apiKey || (authHeader && authHeader.replace(/^Bearer\s+/, ''));
  
  if (!reqKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing API key.' });
  }
  
  const caller = db.users.find(u => u.apiKey === reqKey);
  if (!caller && reqKey !== 'sk_aether_dev_test') { // fallback testing key
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid personal API key.' });
  }
  
  // Bypass authorization check if legacy system/testing credentials are used
  const runner = caller || { id: 'legacy_client', tier: 'pro', email: 'guest' };
  
  // Check permission: Must own the API OR be subscribed to it in the marketplace
  const isOwner = api.userId === runner.id || api.userId === 'system';
  const isSubscribed = db.subscriptions.some(s => s.userId === runner.id && s.apiId === api.id);
  
  if (!isOwner && !isSubscribed) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: You do not own or hold a subscription to this API. Visit the Marketplace to subscribe.'
    });
  }
  
  // Usage limit capping: checks caller limits (5 per day on Free tier)
  if (runner.tier === 'free') {
    const today = new Date().toISOString().substring(0, 10);
    const runsToday = db.api_runs.filter(r => r.userId === runner.id && r.timestamp.startsWith(today)).length;
    
    if (runsToday >= 5) {
      return res.status(402).json({
        success: false,
        error: 'Free trial execution limit reached (5 attempts/day). Please upgrade your account to Pro at the Billing portal.',
        limitReached: true
      });
    }
  }
  
  console.log(`[API GATEWAY] Executing flow "${api.name}" for user ${runner.email}`);
  
  // Format parameters override
  const runParams = [];
  for (const param of api.parameters) {
    const value = req.body[param.name];
    runParams.push({
      stepIndex: param.stepIndex,
      value: value !== undefined ? value : param.defaultValue
    });
  }
  
  const result = await runFlow(api.steps, runParams);
  
  if (result.success) {
    // Log run statistics
    db.api_runs.push({
      id: 'run_' + uuidv4().replace(/-/g, '').substring(0, 12),
      userId: runner.id,
      apiId: api.id,
      timestamp: new Date().toISOString()
    });
    saveDB(db);
    
    res.json({
      success: true,
      data: result.results,
      screenshot: `data:image/png;base64,${result.screenshot}`
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error,
      data: result.results,
      screenshot: result.screenshot ? `data:image/png;base64,${result.screenshot}` : null
    });
  }
});

// --- TESTING GROUND ROUTE ---
app.post('/api/testing-ground/extract', requireAuth, async (req, res) => {
  const { content, contentType, prompt } = req.body;
  if (!content || !contentType || !prompt) {
    return res.status(400).json({ success: false, error: 'Missing content, contentType, or prompt parameter.' });
  }

  let textToExtract = '';

  try {
    if (contentType === 'url') {
      console.log(`[Testing Ground] Replaying URL for text scrape: ${content}`);
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      
      try {
        await page.goto(content, { waitUntil: 'domcontentloaded', timeout: 25000 });
        textToExtract = await page.locator('body').innerText();
      } finally {
        await browser.close();
      }
    } else {
      textToExtract = content;
    }

    console.log(`[Testing Ground] Running direct LLM extraction with prompt: "${prompt}"`);
    const extractedData = await runLlmExtraction(textToExtract, prompt);

    res.json({
      success: true,
      data: extractedData
    });
  } catch (err) {
    console.error("[Testing Ground Error]:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// --- ADMINISTRATIVE CONTROLS ---

// Admin Authorization Middleware
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden: Administrative access required.' });
    }
    next();
  });
}

// 1. Admin Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const db = getDB();
  const totalUsers = db.users.length;
  const totalApis = db.apis.length;
  const totalSubscriptions = db.subscriptions.length;
  const totalRuns = db.api_runs.length;
  
  // Calculate total platform billing transactions
  const totalSales = db.transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  
  res.json({
    totalUsers,
    totalApis,
    totalSubscriptions,
    totalRuns,
    totalSales
  });
});

// 2. Manage Users (Get list)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = getDB();
  const users = db.users.map(u => ({
    id: u.id,
    email: u.email,
    tier: u.tier,
    role: u.role || 'user',
    apiKey: u.apiKey,
    createdAt: u.createdAt
  }));
  res.json(users);
});

// 3. Manage Users (Update user tier or role)
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { tier, role, email } = req.body;
  const db = getDB();
  const user = db.users.find(u => u.id === id);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  if (tier !== undefined) user.tier = tier;
  if (role !== undefined) user.role = role;
  if (email !== undefined) user.email = email.toLowerCase().trim();
  
  saveDB(db);
  res.json({ success: true, user: { id: user.id, email: user.email, tier: user.tier, role: user.role } });
});

// 4. Manage Users (Delete user)
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const userIdx = db.users.findIndex(u => u.id === id);
  
  if (userIdx === -1) return res.status(404).json({ error: 'User not found' });
  
  db.users.splice(userIdx, 1);
  db.subscriptions = db.subscriptions.filter(s => s.userId !== id);
  db.api_runs = db.api_runs.filter(r => r.userId !== id);
  
  saveDB(db);
  res.json({ success: true, message: 'User and all associated data deleted successfully.' });
});

// 5. Manage APIs (Get all APIs)
app.get('/api/admin/apis', requireAdmin, (req, res) => {
  const db = getDB();
  res.json(db.apis);
});

// 6. Manage APIs (Delete API)
app.delete('/api/admin/apis/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const apiIdx = db.apis.findIndex(a => a.id === id);
  
  if (apiIdx === -1) return res.status(404).json({ error: 'API not found' });
  
  db.apis.splice(apiIdx, 1);
  db.subscriptions = db.subscriptions.filter(s => s.apiId !== id);
  db.api_runs = db.api_runs.filter(r => r.apiId !== id);
  
  saveDB(db);
  res.json({ success: true, message: 'API and all associated subscriptions deleted successfully.' });
});

// 7. Manage Subscriptions (Get all)
app.get('/api/admin/subscriptions', requireAdmin, (req, res) => {
  const db = getDB();
  const subscriptions = db.subscriptions.map(sub => {
    const user = db.users.find(u => u.id === sub.userId);
    const api = db.apis.find(a => a.id === sub.apiId);
    return {
      id: sub.id,
      userId: sub.userId,
      apiId: sub.apiId,
      userEmail: user ? user.email : 'Unknown User',
      apiName: api ? api.name : 'Unknown API',
      createdAt: sub.createdAt
    };
  });
  res.json(subscriptions);
});

// 8. Manage Subscriptions (Manually Add Subscription)
app.post('/api/admin/subscriptions', requireAdmin, (req, res) => {
  const { userId, apiId } = req.body;
  if (!userId || !apiId) return res.status(400).json({ error: 'User ID and API ID are required' });
  
  const db = getDB();
  const userExists = db.users.some(u => u.id === userId);
  const apiExists = db.apis.some(a => a.id === apiId);
  
  if (!userExists) return res.status(404).json({ error: 'User not found' });
  if (!apiExists) return res.status(404).json({ error: 'API not found' });
  
  if (db.subscriptions.some(s => s.userId === userId && s.apiId === apiId)) {
    return res.status(400).json({ error: 'Subscription already exists' });
  }
  
  const newSub = {
    id: 'sub_' + uuidv4().replace(/-/g, '').substring(0, 10),
    userId,
    apiId,
    createdAt: new Date().toISOString()
  };
  db.subscriptions.push(newSub);
  saveDB(db);
  
  res.json({ success: true, subscription: newSub });
});

// 9. Manage Subscriptions (Cancel subscription)
app.delete('/api/admin/subscriptions/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const subIdx = db.subscriptions.findIndex(s => s.id === id);
  
  if (subIdx === -1) return res.status(404).json({ error: 'Subscription not found' });
  
  db.subscriptions.splice(subIdx, 1);
  saveDB(db);
  res.json({ success: true, message: 'Subscription canceled successfully.' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
