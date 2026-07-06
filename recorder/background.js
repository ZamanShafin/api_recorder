let isRecording = false;
let steps = [];
let isExtractMode = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    isRecording = true;
    steps = [];
    isExtractMode = false;
    
    // Auto-record the initial navigation step from the current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://')) {
        steps.push({
          action: 'navigate',
          url: activeTab.url
        });
      }
      sendResponse({ status: 'started', steps });
    });
    return true; // async response
  }
  
  if (request.action === 'stopRecording') {
    isRecording = false;
    isExtractMode = false;
    sendResponse({ status: 'stopped', steps });
  }
  
  if (request.action === 'getStatus') {
    sendResponse({ isRecording, steps, isExtractMode });
  }
  
  if (request.action === 'addStep') {
    if (isRecording) {
      // If it's a fill step, avoid duplicate fill steps on the same selector by updating the last step if it was a fill on the same element
      if (request.step.action === 'fill') {
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.action === 'fill' && lastStep.selector === request.step.selector) {
          lastStep.value = request.step.value;
          sendResponse({ success: true, steps });
          return;
        }
      }
      steps.push(request.step);
    }
    sendResponse({ success: true, steps });
  }

  if (request.action === 'toggleExtractMode') {
    isExtractMode = request.value;
    // Broadcast to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'setExtractMode', value: isExtractMode });
      }
    });
    sendResponse({ isExtractMode });
  }
});
