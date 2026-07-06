let currentApi = null;
let activeCodeTab = 'curl';
let activeNavView = 'apis';
let currentUser = null;

// Auth Session token helper
function getAuthToken() {
  return localStorage.getItem('aetherflow_token');
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`
  };
}

// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authErrorMsg = document.getElementById('auth-error-msg');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const btnAuthSwitch = document.getElementById('btn-auth-switch');
const authSwitchText = document.getElementById('auth-switch-text');
const btnDemoLogin = document.getElementById('btn-demo-login');

const mainApp = document.getElementById('main-app');
const userEmailDisplay = document.getElementById('user-email-display');
const btnLogout = document.getElementById('btn-logout');

// Navigation Tabs
const navBtnApis = document.getElementById('nav-btn-apis');
const navBtnMarketplace = document.getElementById('nav-btn-marketplace');
const navBtnBilling = document.getElementById('nav-btn-billing');

const viewApis = document.getElementById('view-apis');
const viewMarketplace = document.getElementById('view-marketplace');
const viewBilling = document.getElementById('view-billing');
const myApisSidebarSection = document.getElementById('my-apis-sidebar-section');

// Workspace Details Elements
const apiList = document.getElementById('api-list');
const btnRefresh = document.getElementById('btn-refresh');
const welcomeScreen = document.getElementById('welcome-screen');
const apiWorkspace = document.getElementById('api-workspace');

const apiEndpoint = document.getElementById('api-endpoint');
const apiTitle = document.getElementById('api-title');
const apiDesc = document.getElementById('api-desc');
const apiDate = document.getElementById('api-date');
const btnTogglePublish = document.getElementById('btn-toggle-publish');

const apiKeyInput = document.getElementById('api-key-input');
const userTierBadge = document.getElementById('user-tier-badge');
const btnCopyKey = document.getElementById('btn-copy-key');
const btnToggleKey = document.getElementById('btn-toggle-key');

const usageMeterRow = document.getElementById('usage-meter-row');
const usageMeterText = document.getElementById('usage-meter-text');
const usageProgressFill = document.getElementById('usage-progress-fill');

const formInputsContainer = document.getElementById('form-inputs-container');
const playgroundForm = document.getElementById('playground-form');
const btnRunApi = document.getElementById('btn-run-api');

const tabBtns = document.querySelectorAll('.tab-btn');
const snippetCode = document.getElementById('snippet-code');
const btnCopySnippet = document.getElementById('btn-copy-snippet');

const executionStatus = document.getElementById('execution-status');
const metricTime = document.getElementById('metric-time');
const metricCode = document.getElementById('metric-code');
const jsonOutput = document.getElementById('json-output');

const screenshotContainer = document.getElementById('screenshot-container');
const screenshotImg = document.getElementById('screenshot-img');

// Modals
const bkashModal = document.getElementById('bkash-modal');
const btnCloseBkash = document.getElementById('btn-close-bkash');
const bkashAmountText = document.getElementById('bkash-amount-text');
const btnCopyBkashPhone = document.getElementById('btn-copy-bkash-phone');
const bkashPaymentForm = document.getElementById('bkash-payment-form');
const bkashWallet = document.getElementById('bkash-wallet');
const bkashTrx = document.getElementById('bkash-trx');
const bkashErrorMsg = document.getElementById('bkash-error-msg');
const btnBkashPaySubmit = document.getElementById('btn-bkash-pay-submit');
const bkashLoader = document.getElementById('bkash-loader');
const bkashSuccess = document.getElementById('bkash-success');
const bkashSuccessMsg = document.getElementById('bkash-success-msg');

const publishModal = document.getElementById('publish-modal');
const btnClosePublish = document.getElementById('btn-close-publish');
const publishForm = document.getElementById('publish-form');
const pubIsPublic = document.getElementById('pub-is-public');
const pubPriceGroup = document.getElementById('pub-price-group');
const pubPrice = document.getElementById('pub-price');

// Active state variables for Modals
let activeBkashContext = { type: 'upgrade_plan', apiId: null, priceBDT: 0 };
let isLoginMode = false; // toggles between Login and Register

// --- AUTHENTICATION FLOWS ---

function checkAuthSession() {
  const token = getAuthToken();
  if (token) {
    fetchProfile();
  } else {
    showAuthScreen();
  }
}

async function fetchProfile() {
  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Session invalid');
    
    currentUser = await res.json();
    userEmailDisplay.textContent = currentUser.email;
    userTierBadge.textContent = currentUser.tier === 'pro' ? 'Pro Plan' : 'Free Plan';
    userTierBadge.className = `key-badge ${currentUser.tier}`;
    
    // Set user API Key
    apiKeyInput.value = currentUser.apiKey;
    
    hideAuthScreen();
    fetchApis();
  } catch (err) {
    logout();
  }
}

function showAuthScreen() {
  authOverlay.style.display = 'flex';
  mainApp.style.display = 'none';
  authErrorMsg.style.display = 'none';
}

function hideAuthScreen() {
  authOverlay.style.display = 'none';
  mainApp.style.display = 'flex';
}

function logout() {
  localStorage.removeItem('aetherflow_token');
  currentUser = null;
  currentApi = null;
  showAuthScreen();
}

// Toggle Register / Login Form
btnAuthSwitch.addEventListener('click', () => {
  isLoginMode = !isLoginMode;
  authErrorMsg.style.display = 'none';
  
  if (isLoginMode) {
    authTitle.textContent = 'Log In to AetherFlow';
    authSubtitle.textContent = 'Enter your credentials to access your browser APIs.';
    btnAuthSubmit.textContent = 'Log In';
    authSwitchText.textContent = "Don't have an account?";
    btnAuthSwitch.textContent = 'Register';
  } else {
    authTitle.textContent = 'Welcome to AetherFlow';
    authSubtitle.textContent = 'Register to begin building and monetizing browser APIs.';
    btnAuthSubmit.textContent = 'Register Account';
    authSwitchText.textContent = 'Already have an account?';
    btnAuthSwitch.textContent = 'Log In';
  }
});

// Form Submit (Auth)
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErrorMsg.style.display = 'none';
  
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Authentication failed');
    
    localStorage.setItem('aetherflow_token', data.token);
    authEmail.value = '';
    authPassword.value = '';
    fetchProfile();
  } catch (err) {
    authErrorMsg.textContent = err.message;
    authErrorMsg.style.display = 'block';
  }
});

// One-Click Demo Login
btnDemoLogin.addEventListener('click', async () => {
  authEmail.value = 'demo@aetherflow.com';
  authPassword.value = 'password123';
  
  // Try login first, if fail try register, then login
  try {
    isLoginMode = true;
    authForm.dispatchEvent(new Event('submit'));
  } catch (e) {
    isLoginMode = false;
    authForm.dispatchEvent(new Event('submit'));
  }
});

btnLogout.addEventListener('click', logout);

// --- NAVIGATION TABS VIEW CONTROL ---

function switchView(viewName) {
  activeNavView = viewName;
  
  navBtnApis.classList.toggle('active', viewName === 'apis');
  navBtnMarketplace.classList.toggle('active', viewName === 'marketplace');
  navBtnBilling.classList.toggle('active', viewName === 'billing');
  
  viewApis.style.display = viewName === 'apis' ? 'block' : 'none';
  viewMarketplace.style.display = viewName === 'marketplace' ? 'block' : 'none';
  viewBilling.style.display = viewName === 'billing' ? 'block' : 'none';
  
  myApisSidebarSection.style.display = viewName === 'apis' ? 'flex' : 'none';
  
  if (viewName === 'marketplace') {
    fetchMarketplace();
  } else if (viewName === 'billing') {
    updateBillingView();
  }
}

navBtnApis.addEventListener('click', () => switchView('apis'));
navBtnMarketplace.addEventListener('click', () => switchView('marketplace'));
navBtnBilling.addEventListener('click', () => switchView('billing'));

// --- MY APIs WORKSPACE ---

// Fetch My APIs (created + subscribed)
async function fetchApis(autoSelectId = null) {
  try {
    const res = await fetch('/api/apis', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load APIs');
    const data = await res.json();
    
    // Combine lists, adding a source tag to subscribed ones
    const combined = [
      ...data.created.map(api => ({ ...api, isOwned: true })),
      ...data.subscribed.map(api => ({ ...api, isOwned: false }))
    ];
    
    renderApiList(combined, autoSelectId);
  } catch (err) {
    console.error(err);
    apiList.innerHTML = `<div class="empty-state">Error loading APIs</div>`;
  }
}

function renderApiList(apis, autoSelectId = null) {
  if (apis.length === 0) {
    apiList.innerHTML = `<div class="empty-state">No APIs recorded yet.</div>`;
    showWelcomeScreen();
    return;
  }
  
  apiList.innerHTML = '';
  apis.forEach(api => {
    const item = document.createElement('button');
    item.className = 'api-item';
    if (currentApi && currentApi.id === api.id) {
      item.classList.add('active');
    }
    
    const badgeText = api.isOwned ? 'OWNED' : 'SUBSCRIBED';
    item.innerHTML = `
      <span class="api-item-title" style="display:flex; justify-content:space-between;">
        <span>${api.name}</span>
        <span style="font-size:9px; opacity:0.6; padding: 2px 4px; background: rgba(255,255,255,0.05); border-radius:3px;">${badgeText}</span>
      </span>
      <span class="api-item-route">POST /api/run/${api.id}</span>
    `;
    
    item.addEventListener('click', () => selectApi(api));
    apiList.appendChild(item);
  });
  
  if (autoSelectId) {
    const matched = apis.find(a => a.id === autoSelectId);
    if (matched) selectApi(matched);
  } else if (currentApi) {
    const matched = apis.find(a => a.id === currentApi.id);
    if (matched) selectApi(matched);
  }
}

function showWelcomeScreen() {
  welcomeScreen.style.display = 'flex';
  apiWorkspace.style.display = 'none';
  currentApi = null;
  history.pushState(null, '', '/');
}

function selectApi(api) {
  currentApi = api;
  
  // Select active in UI list
  document.querySelectorAll('.api-item').forEach(item => {
    const isMatched = item.querySelector('.api-item-route').textContent.includes(api.id);
    item.classList.toggle('active', isMatched);
  });
  
  welcomeScreen.style.display = 'none';
  apiWorkspace.style.display = 'block';
  
  apiEndpoint.textContent = `/api/run/${api.id}`;
  apiTitle.textContent = api.name;
  apiDesc.textContent = api.description;
  
  const createdDate = new Date(api.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  apiDate.textContent = `Created ${createdDate}`;
  
  // Publish configuration button UI
  if (api.isOwned) {
    btnTogglePublish.style.display = 'inline-block';
    if (api.isPublic) {
      btnTogglePublish.textContent = `Public API • BDT ${api.priceBDT}`;
      btnTogglePublish.className = 'publish-badge-btn public';
    } else {
      btnTogglePublish.textContent = 'Private API';
      btnTogglePublish.className = 'publish-badge-btn private';
    }
  } else {
    btnTogglePublish.style.display = 'none'; // Subscribed APIs can't be published by runner
  }
  
  // Check usage gauge limit for Free plan
  updateUsageMeter();
  
  buildPlaygroundForm(api);
  resetOutputs();
  
  const url = new URL(window.location);
  url.searchParams.set('apiId', api.id);
  history.pushState(null, '', url);
  
  updateCodeSnippets();
}

async function updateUsageMeter() {
  if (!currentUser) return;
  
  // Fetch fresh profile runs statistics
  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (res.ok) {
      const freshUser = await res.json();
      currentUser.runsToday = freshUser.runsToday;
      currentUser.tier = freshUser.tier;
    }
  } catch(e) {}
  
  if (currentUser.tier === 'free') {
    usageMeterRow.style.display = 'flex';
    usageMeterText.textContent = `${currentUser.runsToday} / 5 runs used`;
    const pct = Math.min(100, (currentUser.runsToday / 5) * 100);
    usageProgressFill.style.width = `${pct}%`;
    
    // Change bar color based on warning thresholds
    usageProgressFill.className = 'progress-fill';
    if (currentUser.runsToday >= 5) {
      usageProgressFill.classList.add('danger');
    } else if (currentUser.runsToday >= 4) {
      usageProgressFill.classList.add('warning');
    }
  } else {
    usageMeterRow.style.display = 'none';
  }
}

function buildPlaygroundForm(api) {
  formInputsContainer.innerHTML = '';
  if (api.parameters.length === 0) {
    formInputsContainer.innerHTML = '<p class="card-subtitle">This API requires no input parameters.</p>';
    return;
  }
  
  api.parameters.forEach(param => {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.innerHTML = `
      <label for="field-${param.name}">${param.name}</label>
      <input type="text" id="field-${param.name}" name="${param.name}" value="${param.defaultValue}">
      <p>${param.description} (Default: "${param.defaultValue}")</p>
    `;
    group.querySelector('input').addEventListener('input', updateCodeSnippets);
    formInputsContainer.appendChild(group);
  });
}

function resetOutputs() {
  executionStatus.textContent = 'Ready';
  executionStatus.className = 'status-indicator';
  metricTime.textContent = '--';
  metricCode.textContent = '--';
  jsonOutput.textContent = JSON.stringify({ message: "Execute the API above to run Playwright workflow." }, null, 2);
  
  screenshotImg.style.display = 'none';
  screenshotImg.src = '';
  screenshotContainer.querySelector('.screenshot-placeholder').style.display = 'flex';
}

function getFormPayload() {
  const payload = {};
  if (!currentApi) return payload;
  
  currentApi.parameters.forEach(param => {
    const input = document.getElementById(`field-${param.name}`);
    payload[param.name] = input ? input.value : param.defaultValue;
  });
  return payload;
}

function updateCodeSnippets() {
  if (!currentApi || !currentUser) return;
  
  const payload = getFormPayload();
  const protocol = window.location.protocol;
  const host = window.location.host;
  const runUrl = `${protocol}//${host}/api/run/${currentApi.id}`;
  
  if (activeCodeTab === 'curl') {
    snippetCode.textContent = `curl -X POST "${runUrl}" \\
  -H "Authorization: Bearer ${currentUser.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}'`;
  } 
  else if (activeCodeTab === 'js') {
    snippetCode.textContent = `fetch("${runUrl}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${currentUser.apiKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2).replace(/\n/g, '\n  ')})
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));`;
  } 
  else if (activeCodeTab === 'python') {
    const pyDict = JSON.stringify(payload, null, 4).replace(/: true/g, ': True').replace(/: false/g, ': False').replace(/: null/g, ': None');
    snippetCode.textContent = `import requests

url = "${runUrl}"
headers = {
    "Authorization": "Bearer ${currentUser.apiKey}",
    "Content-Type": "application/json"
}
payload = ${pyDict.replace(/\n/g, '\n    ')}

response = requests.post(url, headers=headers, json=payload)
print(response.json())`;
  }
}

// Form Submit (Run API Replay)
playgroundForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentApi || !currentUser) return;
  
  btnRunApi.disabled = true;
  btnRunApi.querySelector('.btn-text').textContent = 'Executing Playwright...';
  btnRunApi.querySelector('.loader-spinner').style.display = 'block';
  executionStatus.textContent = 'Running automation';
  executionStatus.className = 'status-indicator running';
  
  const startTime = performance.now();
  const payload = getFormPayload();
  
  try {
    const res = await fetch(`/api/run/${currentApi.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    metricTime.textContent = `${duration}s`;
    metricCode.textContent = res.status;
    
    const result = await res.json();
    jsonOutput.textContent = JSON.stringify(result, null, 2);
    
    if (res.ok && result.success) {
      executionStatus.textContent = 'Success';
      executionStatus.className = 'status-indicator success';
    } else {
      executionStatus.textContent = 'Failed';
      executionStatus.className = 'status-indicator error';
    }
    
    if (result.screenshot) {
      screenshotImg.src = result.screenshot;
      screenshotImg.style.display = 'block';
      screenshotContainer.querySelector('.screenshot-placeholder').style.display = 'none';
    }
    
    // Update daily usage stats
    updateUsageMeter();
  } catch (err) {
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    metricTime.textContent = `${duration}s`;
    metricCode.textContent = 'ERR';
    executionStatus.textContent = 'Error';
    executionStatus.className = 'status-indicator error';
    jsonOutput.textContent = JSON.stringify({ error: err.message }, null, 2);
  } finally {
    btnRunApi.disabled = false;
    btnRunApi.querySelector('.btn-text').textContent = 'Execute API';
    btnRunApi.querySelector('.loader-spinner').style.display = 'none';
  }
});

btnRefresh.addEventListener('click', () => fetchApis());

// Copy Key
btnCopyKey.addEventListener('click', () => {
  navigator.clipboard.writeText(apiKeyInput.value);
  btnCopyKey.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
  setTimeout(() => {
    btnCopyKey.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
  }, 1500);
});

// Toggle Key Visibility
btnToggleKey.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    btnToggleKey.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  } else {
    apiKeyInput.type = 'password';
    btnToggleKey.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
});

// Code tab toggling
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCodeTab = btn.getAttribute('data-tab');
    updateCodeSnippets();
  });
});

btnCopySnippet.addEventListener('click', () => {
  navigator.clipboard.writeText(snippetCode.textContent);
  btnCopySnippet.textContent = 'Copied!';
  setTimeout(() => btnCopySnippet.textContent = 'Copy', 1500);
});

// --- MARKETPLACE TIER LOGIC ---

async function fetchMarketplace() {
  const container = document.getElementById('marketplace-grid');
  container.innerHTML = '<div class="loading-state">Loading APIs...</div>';
  
  try {
    const res = await fetch('/api/marketplace', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load marketplace');
    const apis = await res.json();
    
    if (apis.length === 0) {
      container.innerHTML = '<div class="empty-state">No public APIs in the marketplace yet. Make your own API public!</div>';
      return;
    }
    
    container.innerHTML = '';
    apis.forEach(api => {
      const card = document.createElement('div');
      card.className = 'glass-card market-card';
      
      const isPaid = api.priceBDT > 0;
      const priceText = isPaid ? `BDT ${api.priceBDT}` : 'FREE';
      const priceClass = isPaid ? 'price-tag-badge paid' : 'price-tag-badge';
      
      let buttonHtml = '';
      if (api.isSubscribed) {
        buttonHtml = `<button class="market-btn subscribed" disabled>Subscribed</button>`;
      } else {
        buttonHtml = `<button class="market-btn" onclick="subscribeMarketplaceApi('${api.id}', ${api.priceBDT})">Subscribe</button>`;
      }
      
      card.innerHTML = `
        <div class="market-card-top">
          <div class="market-card-meta">
            <span class="creator-tag">By: ${api.creatorEmail}</span>
            <span class="${priceClass}">${priceText}</span>
          </div>
          <h2>${api.name}</h2>
          <p class="desc">${api.description}</p>
          <div class="market-stats">
            <span>Inputs: ${api.parametersCount}</span>
            <span>Outputs: ${api.outputsCount}</span>
          </div>
        </div>
        <div class="market-card-bottom">
          <div class="subscribers-count">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/>
              <path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
            <span>${api.subscribersCount} subscribers</span>
          </div>
          ${buttonHtml}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
  }
}

// Window globally scoped function so onclick works
window.subscribeMarketplaceApi = async function(apiId, priceBDT) {
  if (priceBDT === 0) {
    // Free Sub
    try {
      const res = await fetch(`/api/apis/${apiId}/subscribe`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      fetchMarketplace();
      fetchApis(); // refresh sidebar list
    } catch (err) {
      alert(`Subscription failed: ${err.message}`);
    }
  } else {
    // Paid Sub -> Trigger bKash Modal
    activeBkashContext = { type: 'buy_api', apiId, priceBDT };
    openBkashCheckout(priceBDT);
  }
};

// --- BILLING, PRICING & MOCK PLANS VIEW ---

async function updateBillingView() {
  if (!currentUser) return;
  
  // Set tier UI box active
  const planFreeBox = document.getElementById('plan-free-box');
  const planProBox = document.getElementById('plan-pro-box');
  const btnUpgradePro = document.getElementById('btn-upgrade-pro');
  const statusFreeActive = document.getElementById('status-free-active');
  const statusProActive = document.getElementById('status-pro-active');
  
  if (currentUser.tier === 'pro') {
    planFreeBox.classList.remove('active');
    planProBox.classList.add('active');
    btnUpgradePro.style.display = 'none';
    statusFreeActive.style.display = 'none';
    statusProActive.style.display = 'block';
  } else {
    planFreeBox.classList.add('active');
    planProBox.classList.remove('active');
    btnUpgradePro.style.display = 'block';
    statusFreeActive.style.display = 'block';
    statusProActive.style.display = 'none';
  }
  
  // Load revenue splits calculations
  try {
    const res = await fetch('/api/billing/earnings', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    document.getElementById('earn-sales').textContent = `BDT ${data.totalSalesBDT}`;
    document.getElementById('earn-fee').textContent = `BDT ${data.platformFeeBDT}`;
    document.getElementById('earn-net').textContent = `BDT ${data.netEarningsBDT}`;
    
    const rowsContainer = document.getElementById('earnings-sales-rows');
    if (data.transactions.length === 0) {
      rowsContainer.innerHTML = '<tr><td colspan="3" class="table-empty">No sales recorded yet.</td></tr>';
      return;
    }
    
    rowsContainer.innerHTML = '';
    data.transactions.forEach(tx => {
      const tr = document.createElement('tr');
      const dateStr = new Date(tx.timestamp).toLocaleDateString();
      tr.innerHTML = `
        <td><strong>${tx.apiName}</strong></td>
        <td>BDT ${tx.amount}</td>
        <td>${dateStr}</td>
      `;
      rowsContainer.appendChild(tr);
    });
  } catch (e) {
    console.error("Could not load earnings metrics");
  }
}

// Upgrade Plan button listener
document.getElementById('btn-upgrade-pro').addEventListener('click', () => {
  activeBkashContext = { type: 'upgrade_plan', apiId: null, priceBDT: 1000 };
  openBkashCheckout(1000);
});

// --- bKASH CHECKOUT MODAL LOGIC ---

function openBkashCheckout(amount) {
  bkashAmountText.textContent = `${amount}.00`;
  bkashWallet.value = '';
  bkashTrx.value = '';
  bkashErrorMsg.style.display = 'none';
  bkashLoader.style.display = 'none';
  bkashSuccess.style.display = 'none';
  bkashModal.style.display = 'flex';
}

function closeBkashCheckout() {
  bkashModal.style.display = 'none';
}

btnCloseBkash.addEventListener('click', closeBkashCheckout);

btnCopyBkashPhone.addEventListener('click', () => {
  navigator.clipboard.writeText('+8801787888999');
  btnCopyBkashPhone.textContent = 'Copied!';
  setTimeout(() => btnCopyBkashPhone.textContent = 'Copy', 1500);
});

bkashPaymentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bkashErrorMsg.style.display = 'none';
  
  const wallet = bkashWallet.value.trim();
  const trx = bkashTrx.value.trim();
  
  // Basic Regex validation
  if (!/^01[3-9]\d{8}$/.test(wallet)) {
    bkashErrorMsg.textContent = 'Invalid bKash Wallet Number. E.g. 01712345678';
    bkashErrorMsg.style.display = 'block';
    return;
  }
  if (trx.length !== 10) {
    bkashErrorMsg.textContent = 'bKash Transaction ID must be exactly 10 characters long.';
    bkashErrorMsg.style.display = 'block';
    return;
  }
  
  // Show verifying loading state
  bkashLoader.style.display = 'flex';
  
  // Submit payment verify to backend
  try {
    let endpoint = '';
    let bodyObj = { bkashNumber: wallet, trxId: trx };
    
    if (activeBkashContext.type === 'upgrade_plan') {
      endpoint = '/api/billing/upgrade';
    } else {
      endpoint = `/api/apis/${activeBkashContext.apiId}/subscribe`;
    }
    
    // Artificial 2s loading delay to make bKash gateway feel real and premium
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(bodyObj)
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'bKash payment verification failed');
    
    // Show success view
    bkashLoader.style.display = 'none';
    bkashSuccess.style.display = 'flex';
    
    if (activeBkashContext.type === 'upgrade_plan') {
      bkashSuccessMsg.textContent = 'You have successfully upgraded to the Pro Plan.';
    } else {
      bkashSuccessMsg.textContent = 'You have successfully subscribed to the API.';
    }
    
    // Reload state after success delay
    setTimeout(() => {
      closeBkashCheckout();
      fetchProfile(); // reload profile metrics
      if (activeNavView === 'marketplace') fetchMarketplace();
      else if (activeNavView === 'billing') updateBillingView();
    }, 2500);
    
  } catch (err) {
    bkashLoader.style.display = 'none';
    bkashErrorMsg.textContent = err.message;
    bkashErrorMsg.style.display = 'block';
  }
});

// --- PUBLISHING SETTINGS DIALOG LOGIC ---

btnTogglePublish.addEventListener('click', () => {
  if (!currentApi) return;
  
  pubIsPublic.checked = currentApi.isPublic;
  pubPrice.value = currentApi.priceBDT;
  pubPriceGroup.style.display = currentApi.isPublic ? 'flex' : 'none';
  
  publishModal.style.display = 'flex';
});

pubIsPublic.addEventListener('change', () => {
  pubPriceGroup.style.display = pubIsPublic.checked ? 'flex' : 'none';
});

btnClosePublish.addEventListener('click', () => {
  publishModal.style.display = 'none';
});

publishForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentApi) return;
  
  const isPublic = pubIsPublic.checked;
  const priceBDT = parseInt(pubPrice.value) || 0;
  
  try {
    const res = await fetch(`/api/apis/${currentApi.id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ isPublic, priceBDT })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    publishModal.style.display = 'none';
    
    // Reload active details
    fetchApis(currentApi.id);
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  }
});

// --- INITIAL ON LOAD ---

window.addEventListener('DOMContentLoaded', () => {
  // Check auth session
  checkAuthSession();
  
  // Watch url parameter for direct selections
  const urlParams = new URLSearchParams(window.location.search);
  const apiId = urlParams.get('apiId');
  if (apiId) {
    fetchApis(apiId);
  }
});
