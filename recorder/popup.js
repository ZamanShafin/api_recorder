const btnRecord = document.getElementById('btn-record');
const btnExtract = document.getElementById('btn-extract');
const btnExtractLlm = document.getElementById('btn-extract-llm');
const btnExport = document.getElementById('btn-export');
const btnClear = document.getElementById('btn-clear');
const stepsList = document.getElementById('steps-list');
const badge = document.getElementById('badge');
const statusMessage = document.getElementById('status-message');
const backendUrlInput = document.getElementById('backend-url');
const extractGroupContainer = document.getElementById('extract-group-container');
const panelTitleText = document.getElementById('panel-title-text');

// Load host URL from local storage or default
chrome.storage.local.get(['backendUrl'], (result) => {
  if (result.backendUrl) {
    backendUrlInput.value = result.backendUrl;
  }
});

backendUrlInput.addEventListener('input', () => {
  chrome.storage.local.set({ backendUrl: backendUrlInput.value });
});

// Helper to format steps for visual listing matching screenshot format
function getStepDescription(step) {
  switch (step.action) {
    case 'navigate':
      return `[navigate] Navigate to ${step.url}`;
    case 'click':
      return `[click] ${step.label || 'undefined'}`;
    case 'fill':
      return `[fill] ${step.label || 'undefined'}`;
    case 'extract':
      return `[extract] ${step.label || 'undefined'}`;
    case 'extract_llm':
      return `[extract_llm] ${step.label || 'undefined'}`;
    default:
      return `[${step.action}] ${step.selector || 'undefined'}`;
  }
}

// Update the UI state dynamically
function updateUI() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    if (!status) return;
    
    const { isRecording, steps, isExtractMode } = status;
    
    // 1. Update status badge text & styling
    if (isRecording) {
      badge.textContent = 'RECORDING';
      badge.className = 'status-badge-text recording';
      btnRecord.textContent = 'Stop Recording';
      btnRecord.className = 'recording';
      
      // Show extract buttons during recording
      if (extractGroupContainer) extractGroupContainer.style.display = 'grid';
      btnExtract.disabled = false;
      btnExtractLlm.disabled = false;
    } else {
      badge.textContent = 'IDLE';
      badge.className = 'status-badge-text';
      btnRecord.textContent = 'Start Recording';
      btnRecord.className = '';
      
      // Hide extract buttons when idle
      if (extractGroupContainer) extractGroupContainer.style.display = 'none';
      btnExtract.disabled = true;
      btnExtractLlm.disabled = true;
    }
    
    // Enable/disable Send to Marketplace button
    btnExport.disabled = steps.length === 0;
    
    // Update Extract selector mode button
    if (isExtractMode) {
      btnExtract.textContent = 'Cancel Extract';
      btnExtract.className = 'active';
    } else {
      btnExtract.textContent = 'Select Extract';
      btnExtract.className = '';
    }
    
    // Update panel title header count
    if (panelTitleText) {
      panelTitleText.textContent = `RECORDED STEPS (${steps.length})`;
    }
    
    // 2. Render steps list
    if (steps.length === 0) {
      stepsList.innerHTML = '<div class="empty-steps">No steps recorded yet.</div>';
    } else {
      stepsList.innerHTML = '';
      steps.forEach((step, index) => {
        const div = document.createElement('div');
        div.className = 'step-item';
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

// Click Record toggle
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

// Click Extract Target element
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

// Click Clear Steps
btnClear.addEventListener('click', () => {
  if (confirm('Clear all recorded steps?')) {
    chrome.runtime.sendMessage({ action: 'clearSteps' }, () => {
      updateUI();
    });
  }
});

// Click Export (Send to Marketplace)
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
    
    // Auto-extract logic: if no extract step is found, automatically append an AI extraction step to the flow
    const stepsToSend = [...status.steps];
    const hasExtract = stepsToSend.some(s => s.action === 'extract' || s.action === 'extract_llm');
    
    if (!hasExtract) {
      stepsToSend.push({
        action: 'extract_llm',
        prompt: 'Extract the main list of search results or primary data shown on the final page with all key labels and values.',
        label: 'extracted_data'
      });
    }
    
    try {
      // Find session token to link recording to correct user account
      const userToken = await getDashboardToken(backendUrl);
      
      const response = await fetch(`${backendUrl}/api/recordings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: stepsToSend,
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
        chrome.tabs.create({ url: `${backendUrl}/?apiId=${api.id}&new=true` });
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

// Initial UI sync
updateUI();
setInterval(updateUI, 1000);
