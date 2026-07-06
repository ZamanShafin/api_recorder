const btnRecord = document.getElementById('btn-record');
const btnExtract = document.getElementById('btn-extract');
const btnExtractLlm = document.getElementById('btn-extract-llm');
const btnExport = document.getElementById('btn-export');
const stepsList = document.getElementById('steps-list');
const badge = document.getElementById('badge');
const statusMessage = document.getElementById('status-message');
const backendUrlInput = document.getElementById('backend-url');

// Load host URL from storage or default
chrome.storage.local.get(['backendUrl'], (result) => {
  if (result.backendUrl) {
    backendUrlInput.value = result.backendUrl;
  }
});

backendUrlInput.addEventListener('input', () => {
  chrome.storage.local.set({ backendUrl: backendUrlInput.value });
});

// Helper to format steps for visual listing
function getStepDescription(step) {
  switch (step.action) {
    case 'navigate':
      return `Navigate to ${step.url}`;
    case 'click':
      return `Click on "${step.selector}"`;
    case 'fill':
      return `Type "${step.value}" into "${step.selector}"`;
    case 'extract':
      return `Extract "${step.label}" from "${step.selector}"`;
    case 'extract_llm':
      return `Extract with AI: "${step.prompt}" as "${step.label}"`;
    default:
      return `${step.action} on ${step.selector}`;
  }
}

// Update the UI state
function updateUI() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    if (!status) return;
    
    const { isRecording, steps, isExtractMode } = status;
    
    if (isRecording) {
      badge.className = 'status-badge recording';
      btnRecord.textContent = 'Stop Recording';
      btnRecord.className = 'recording';
      btnExtract.disabled = false;
      btnExtractLlm.disabled = false;
      btnExport.disabled = steps.length === 0;
    } else {
      badge.className = 'status-badge';
      btnRecord.textContent = 'Start Recording';
      btnRecord.className = '';
      btnExtract.disabled = true;
      btnExtractLlm.disabled = true;
      btnExport.disabled = steps.length === 0;
    }
    
    if (isExtractMode) {
      btnExtract.textContent = 'Cancel Extract';
      btnExtract.className = 'active';
    } else {
      btnExtract.textContent = 'Select Extract Target';
      btnExtract.className = '';
    }
    
    if (steps.length === 0) {
      stepsList.innerHTML = '<div class="empty-steps">No steps recorded yet.</div>';
    } else {
      stepsList.innerHTML = '';
      steps.forEach((step, index) => {
        const div = document.createElement('div');
        div.className = `step-item ${step.action === 'extract_llm' ? 'extract' : step.action}`;
        div.textContent = `${index + 1}. ${getStepDescription(step)}`;
        stepsList.appendChild(div);
      });
      stepsList.scrollTop = stepsList.scrollHeight;
    }
  });
}

// Scrape session token from open dashboard tab if possible
async function getDashboardToken(backendUrl) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        if (!tabs || tabs.length === 0) {
          resolve(null);
          return;
        }
        
        // Find any open tab pointing to the dashboard domain
        const dashTab = tabs.find(t => t.url && t.url.toLowerCase().startsWith(backendUrl.toLowerCase()));
        
        if (dashTab) {
          chrome.scripting.executeScript({
            target: { tabId: dashTab.id },
            func: () => localStorage.getItem('aetherflow_token')
          }, (results) => {
            if (results && results[0] && results[0].result) {
              resolve(results[0].result);
            } else {
              resolve(null);
            }
          });
        } else {
          resolve(null);
        }
      });
    } catch (e) {
      console.warn("Failed to query tab scripting permissions:", e);
      resolve(null);
    }
  });
}

// Click Record
btnRecord.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    if (status && status.isRecording) {
      chrome.runtime.sendMessage({ action: 'stopRecording' }, () => {
        updateUI();
      });
    } else {
      chrome.runtime.sendMessage({ action: 'startRecording' }, () => {
        updateUI();
      });
    }
  });
});

// Click Extract Target
btnExtract.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    if (status) {
      const targetState = !status.isExtractMode;
      chrome.runtime.sendMessage({ action: 'toggleExtractMode', value: targetState }, () => {
        updateUI();
      });
    }
  });
});

// Click Extract LLM Target
btnExtractLlm.addEventListener('click', () => {
  const promptText = prompt(
    "What structured data or list would you like to extract with AI?\ne.g., 'List of products with name and price'",
    "List of search results with name and price"
  );
  if (!promptText) return;

  const label = prompt(
    "Set a variable label for this extracted data:\ne.g., 'products', 'hotels'",
    "extracted_list"
  );
  if (!label) return;

  chrome.runtime.sendMessage({
    action: 'addStep',
    step: {
      action: 'extract_llm',
      prompt: promptText.trim(),
      label: label.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    }
  }, () => {
    updateUI();
  });
});

// Click Export (Create API)
btnExport.addEventListener('click', async () => {
  statusMessage.textContent = 'Generating API spec with LLM. Please wait...';
  statusMessage.className = 'msg success';
  btnExport.disabled = true;
  
  chrome.runtime.sendMessage({ action: 'getStatus' }, async (status) => {
    if (!status || status.steps.length === 0) {
      showError('No steps to export.');
      return;
    }
    
    const backendUrl = backendUrlInput.value.replace(/\/$/, '');
    
    try {
      // Find session token to link recording to correct user account
      const userToken = await getDashboardToken(backendUrl);
      
      const response = await fetch(`${backendUrl}/api/recordings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: status.steps,
          userToken: userToken
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${await response.text()}`);
      }
      
      const api = await response.json();
      
      statusMessage.textContent = 'API Created successfully!';
      statusMessage.className = 'msg success';
      
      chrome.runtime.sendMessage({ action: 'stopRecording' }, () => {
        updateUI();
        chrome.tabs.create({ url: `${backendUrl}/?apiId=${api.id}` });
      });
      
    } catch (err) {
      showError(err.message);
    }
  });
});

function showError(msg) {
  statusMessage.textContent = `Error: ${msg}`;
  statusMessage.className = 'msg error';
  btnExport.disabled = false;
}

updateUI();
setInterval(updateUI, 1000);
