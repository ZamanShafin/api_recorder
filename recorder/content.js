console.log("[AetherFlow Recorder] Content script injected on", window.location.href);
let isExtractMode = false;
let hoveredElement = null;

// Add highlighting CSS for extraction mode
const style = document.createElement('style');
style.id = 'api-flow-recorder-style';
style.innerHTML = `
  .api-flow-highlight {
    outline: 2px dashed #10b981 !important;
    background-color: rgba(16, 185, 129, 0.1) !important;
    cursor: dotted !important;
  }
`;
document.head.appendChild(style);

// Helper to generate CSS selectors (safeguarded)
function getUniqueSelector(el) {
  if (!el || !el.tagName) return '';
  
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  
  const tagName = el.tagName.toLowerCase();
  
  // Try unique attributes
  const nameAttr = el.getAttribute('name');
  if (nameAttr) {
    return `${tagName}[name="${CSS.escape(nameAttr)}"]`;
  }
  
  const placeholderAttr = el.getAttribute('placeholder');
  if (placeholderAttr) {
    return `${tagName}[placeholder="${CSS.escape(placeholderAttr)}"]`;
  }

  // Handle links specifically
  if (tagName === 'a' && el.innerText.trim()) {
    const text = el.innerText.trim();
    if (text.length < 30) {
      return `a:has-text("${text.replace(/"/g, '\\"')}")`;
    }
  }

  // Traversal to find nth-of-type selector
  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    if (!el.tagName) break;
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += '#' + CSS.escape(el.id);
      path.unshift(selector);
      break;
    } else {
      let sib = el, sibCount = 0;
      while (sib) {
        if (sib.nodeName === el.nodeName) sibCount++;
        sib = sib.previousElementSibling;
      }
      sib = el.nextElementSibling;
      while (sib) {
        if (sib.nodeName === el.nodeName) sibCount++;
        sib = sib.nextElementSibling;
      }
      if (sibCount > 1) {
        let index = 1;
        let sibIter = el.previousElementSibling;
        while (sibIter) {
          if (sibIter.nodeName === el.nodeName) index++;
          sibIter = sibIter.previousElementSibling;
        }
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(' > ');
}

// Check recording status with background
function checkRecording(callback) {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response && response.isRecording) {
      callback(response);
    }
  });
}

// Click listener
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.tagName) return;

  if (isExtractMode) {
    e.preventDefault();
    e.stopPropagation();
    
    const selector = getUniqueSelector(e.target);
    const value = e.target.innerText.trim() || e.target.value || '';
    
    const label = prompt(
      `Set a parameter label for this extracted text:\ne.g., 'price', 'product_name'`,
      'extracted_data'
    );
    
    if (label) {
      chrome.runtime.sendMessage({
        action: 'addStep',
        step: {
          action: 'extract',
          selector: selector,
          label: label.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          value: value
        }
      });
    }
    
    // Turn off extract mode
    isExtractMode = false;
    if (hoveredElement) {
      hoveredElement.classList.remove('api-flow-highlight');
      hoveredElement = null;
    }
    chrome.runtime.sendMessage({ action: 'toggleExtractMode', value: false });
    return;
  }

  checkRecording(() => {
    // Avoid recording clicks on text inputs, because focus is implicit in typing
    const tagName = e.target.tagName.toLowerCase();
    if (tagName === 'input' && ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(e.target.type)) {
      return;
    }
    if (tagName === 'textarea') {
      return;
    }
    
    // Find text labels or class elements if available
    let clickLabel = e.target.innerText ? e.target.innerText.trim().substring(0, 30) : '';
    if (!clickLabel && e.target.value) {
      clickLabel = e.target.value.toString().trim().substring(0, 30);
    }
    if (!clickLabel && e.target.placeholder) {
      clickLabel = e.target.placeholder.trim().substring(0, 30);
    }
    
    const selector = getUniqueSelector(e.target);
    console.log("[AetherFlow Recorder] Click recorded on selector:", selector, "label:", clickLabel);
    chrome.runtime.sendMessage({
      action: 'addStep',
      step: {
        action: 'click',
        selector: selector,
        label: clickLabel || undefined
      }
    });
  });
}, true);

// Input listener for real-time text entries
document.addEventListener('input', (e) => {
  if (!e.target || !e.target.tagName) return;

  checkRecording(() => {
    const tagName = e.target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
      const selector = getUniqueSelector(e.target);
      let fillLabel = e.target.name || e.target.placeholder || e.target.id || 'input';
      console.log("[AetherFlow Recorder] Text input recorded on selector:", selector, "value:", e.target.value);
      
      chrome.runtime.sendMessage({
        action: 'addStep',
        step: {
          action: 'fill',
          selector: selector,
          value: e.target.value,
          label: fillLabel
        }
      });
    }
  });
}, true);

// Change listener for select elements, checkboxes, and radios
document.addEventListener('change', (e) => {
  if (!e.target || !e.target.tagName) return;

  checkRecording(() => {
    const tagName = e.target.tagName.toLowerCase();
    if (tagName === 'select' || (tagName === 'input' && (e.target.type === 'checkbox' || e.target.type === 'radio'))) {
      const selector = getUniqueSelector(e.target);
      let fillLabel = e.target.name || e.target.id || 'select';
      console.log("[AetherFlow Recorder] Input recorded on selector:", selector, "value:", e.target.value);
      
      chrome.runtime.sendMessage({
        action: 'addStep',
        step: {
          action: 'fill',
          selector: selector,
          value: e.target.value,
          label: fillLabel
        }
      });
    }
  });
}, true);

// Extract mode hover effects
document.addEventListener('mouseover', (e) => {
  if (!isExtractMode) return;
  if (!e.target || !e.target.tagName) return;
  
  if (hoveredElement && hoveredElement !== e.target) {
    hoveredElement.classList.remove('api-flow-highlight');
  }
  
  hoveredElement = e.target;
  hoveredElement.classList.add('api-flow-highlight');
}, true);

document.addEventListener('mouseout', (e) => {
  if (!isExtractMode) return;
  if (!e.target || !e.target.tagName) return;
  if (hoveredElement === e.target) {
    hoveredElement.classList.remove('api-flow-highlight');
    hoveredElement = null;
  }
}, true);

// Listen for control signals from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setExtractMode') {
    isExtractMode = request.value;
    if (!isExtractMode && hoveredElement) {
      hoveredElement.classList.remove('api-flow-highlight');
      hoveredElement = null;
    }
    sendResponse({ success: true, isExtractMode });
  }
});
