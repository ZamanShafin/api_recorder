// Helper to get/set state from chrome.storage.local
async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['isRecording', 'steps', 'isExtractMode'], (result) => {
      resolve({
        isRecording: !!result.isRecording,
        steps: result.steps || [],
        isExtractMode: !!result.isExtractMode
      });
    });
  });
}

async function saveState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set(state, () => {
      resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      const initialSteps = [];
      if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://')) {
        initialSteps.push({
          action: 'navigate',
          url: activeTab.url
        });
      }
      
      await saveState({
        isRecording: true,
        steps: initialSteps,
        isExtractMode: false
      });
      
      sendResponse({ status: 'started', steps: initialSteps });
    });
    return true; // async response
  }
  
  if (request.action === 'stopRecording') {
    saveState({
      isRecording: false,
      isExtractMode: false
    }).then(() => {
      getState().then(state => {
        sendResponse({ status: 'stopped', steps: state.steps });
      });
    });
    return true;
  }
  
  if (request.action === 'clearSteps') {
    saveState({
      steps: [],
      isExtractMode: false
    }).then(() => {
      sendResponse({ success: true, steps: [] });
    });
    return true;
  }
  
  if (request.action === 'getStatus') {
    getState().then(state => {
      sendResponse(state);
    });
    return true;
  }
  
  if (request.action === 'addStep') {
    getState().then(async (state) => {
      if (state.isRecording) {
        const steps = state.steps;
        // Avoid duplicate fill steps on the same selector
        if (request.step.action === 'fill') {
          const lastStep = steps[steps.length - 1];
          if (lastStep && lastStep.action === 'fill' && lastStep.selector === request.step.selector) {
            lastStep.value = request.step.value;
            await saveState({ steps });
            sendResponse({ success: true, steps });
            return;
          }
        }
        steps.push(request.step);
        await saveState({ steps });
        sendResponse({ success: true, steps });
      } else {
        sendResponse({ success: true, steps: state.steps });
      }
    });
    return true;
  }

  if (request.action === 'toggleExtractMode') {
    const isExtractMode = request.value;
    saveState({ isExtractMode }).then(() => {
      // Broadcast to active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'setExtractMode', value: isExtractMode });
        }
      });
      sendResponse({ isExtractMode });
    });
    return true;
  }
});

// Listen for tab URL changes to record navigation steps automatically
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !changeInfo.url.startsWith('chrome://') && !changeInfo.url.startsWith('about:')) {
    getState().then(async (state) => {
      if (state.isRecording) {
        const steps = state.steps;
        // Check if the last step was already a navigation to this URL
        const lastStep = steps[steps.length - 1];
        if (!lastStep || lastStep.url !== changeInfo.url) {
          steps.push({
            action: 'navigate',
            url: changeInfo.url
          });
          await saveState({ steps });
        }
      }
    });
  }
});
