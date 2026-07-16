/**
 * LeetTrack Pro Content Script
 * Detects accepted submissions and extracts metadata via LeetCode's GraphQL API.
 */

// Track the last processed submission ID to prevent double syncs
let lastProcessedSubmissionId = null;

// Extracted problem slug from URL
function getProblemSlug() {
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  return match ? match[1] : null;
}

// Helper to read cookies from document
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

// Queries LeetCode GraphQL Endpoint
async function queryLeetCodeGraphQL(query, variables = {}) {
  const csrfToken = getCookie('csrftoken');
  
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-csrftoken': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  });
  
  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`);
  }
  
  return await response.json();
}

// Fetch the list of submissions for the current problem
async function fetchLatestSubmissions(slug) {
  const query = `
    query submissionList($questionSlug: String!, $offset: Int!, $limit: Int!) {
      questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) {
        submissions {
          id
          statusDisplay
          lang
          runtime
          memory
          timestamp
        }
      }
    }
  `;
  
  const data = await queryLeetCodeGraphQL(query, {
    questionSlug: slug,
    offset: 0,
    limit: 10
  });
  
  return data?.data?.questionSubmissionList?.submissions || [];
}

// Fetch description and testcases for a specific problem slug
async function fetchQuestionContent(titleSlug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        content
        sampleTestCase
      }
    }
  `;
  const data = await queryLeetCodeGraphQL(query, { titleSlug });
  return data?.data?.question;
}

// Fetch details for a specific submission ID
async function fetchSubmissionDetails(submissionId) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        runtime
        runtimeDisplay
        runtimePercentile
        memory
        memoryDisplay
        memoryPercentile
        code
        timestamp
        statusCode
        lang {
          name
          verboseName
        }
        question {
          questionId
          title
          titleSlug
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    }
  `;
  
  const data = await queryLeetCodeGraphQL(query, { submissionId: parseInt(submissionId) });
  return data?.data?.submissionDetails;
}

// Extract details, format, and send to background service worker
async function processSubmission(submissionId) {
  if (lastProcessedSubmissionId === submissionId) return;
  lastProcessedSubmissionId = submissionId;
  
  console.log(`[LeetTrack Pro] Processing accepted submission ID: ${submissionId}`);
  
  try {
    const details = await fetchSubmissionDetails(submissionId);
    if (!details) {
      console.error("[LeetTrack Pro] Could not retrieve submission details.");
      return;
    }
    
    // Fetch description and test cases separately for 100% reliability
    let plainDescription = '';
    let sampleTestCase = '';
    try {
      const qContent = await fetchQuestionContent(details.question.titleSlug);
      if (qContent) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = qContent.content || '';
        plainDescription = tempDiv.innerText || tempDiv.textContent || '';
        sampleTestCase = qContent.sampleTestCase || '';
      }
    } catch (e) {
      console.error("[LeetTrack Pro] Error fetching question description:", e);
    }
    
    // Prepare metadata package
    const metadata = {
      id: details.question.questionId,
      title: details.question.title,
      problemUrl: `https://leetcode.com/problems/${details.question.titleSlug}/`,
      difficulty: details.question.difficulty,
      language: details.lang.verboseName,
      runtime: details.runtimeDisplay || `${details.runtime} ms`,
      memory: details.memoryDisplay || `${details.memory} MB`,
      tags: details.question.topicTags.map(tag => tag.name),
      solvedDate: new Date(details.timestamp * 1000).toISOString().slice(0, 10),
      code: details.code,
      submissionId: String(submissionId),
      description: plainDescription,
      sampleTestCase: sampleTestCase,
      timeComplexity: '',
      spaceComplexity: '',
      notes: {
        approach: '',
        mistakes: '',
        optimization: '',
        timeComplexity: '',
        spaceComplexity: '',
        revisionRequired: false
      }
    };
    
    // Send message to background script
    chrome.runtime.sendMessage({
      type: 'NEW_SUBMISSION',
      data: metadata
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[LeetTrack Pro] Error sending message:", chrome.runtime.lastError);
      } else {
        console.log("[LeetTrack Pro] Submission result from background:", response);
      }
    });
    
  } catch (err) {
    console.error("[LeetTrack Pro] Error parsing submission details:", err);
  }
}

// Retrieve settings directly in content script
function getContentSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve(result.settings || {});
    });
  });
}

// Function to apply the Zen Mode visibility styles and DOM manipulation
let currentZenSettings = {};

function applyZenMode(settings) {
  currentZenSettings = settings;

  // 1. Manage stylesheet injection
  let styleEl = document.getElementById('leettrack-zen-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'leettrack-zen-styles';
    document.head.appendChild(styleEl);
  }

  let css = '';
  if (settings.hideEasy) {
    css += `
      .text-easy-s, [class*="text-green-s"], [class*="text-lc-green"], [class*="bg-lc-green"], [class*="text-emerald"], [class*="bg-emerald"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
  }
  if (settings.hideMedium) {
    css += `
      .text-medium-s, [class*="text-medium"], [class*="text-orange-s"], [class*="text-lc-orange"], [class*="bg-lc-orange"], [class*="text-yellow-s"], [class*="text-lc-yellow"], [class*="bg-lc-yellow"], [class*="text-amber"], [class*="bg-amber"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
  }
  if (settings.hideHard) {
    css += `
      .text-hard-s, [class*="text-red-s"], [class*="text-lc-red"], [class*="bg-lc-red"], [class*="text-pink"], [class*="bg-pink"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
  }
  styleEl.textContent = css;

  const hasActiveZen = settings.hideEasy || settings.hideMedium || settings.hideHard || settings.hideAcceptance;
  if (!hasActiveZen) {
    // Restore all hidden elements if all settings are turned off
    document.querySelectorAll('[data-zen-hidden]').forEach(el => {
      el.style.opacity = '';
      el.style.pointerEvents = '';
      el.removeAttribute('data-zen-hidden');
    });
  } else {
    // Perform initial walk on document.body
    hideZenTextInSubtree(document.body, settings);
  }
}

function hideZenTextNode(node, settings) {
  const parent = node.parentElement;
  if (!parent) return;

  const tag = parent.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

  const text = node.nodeValue.trim();
  if (!text) return;

  // Easy match
  if (settings.hideEasy && text === 'Easy') {
    parent.style.setProperty('opacity', '0', 'important');
    parent.style.setProperty('pointer-events', 'none', 'important');
    parent.setAttribute('data-zen-hidden', 'true');
  }

  // Medium match
  if (settings.hideMedium && (text === 'Medium' || text === 'Med.' || text === 'Med')) {
    parent.style.setProperty('opacity', '0', 'important');
    parent.style.setProperty('pointer-events', 'none', 'important');
    parent.setAttribute('data-zen-hidden', 'true');
  }

  // Hard match
  if (settings.hideHard && text === 'Hard') {
    parent.style.setProperty('opacity', '0', 'important');
    parent.style.setProperty('pointer-events', 'none', 'important');
    parent.setAttribute('data-zen-hidden', 'true');
  }

  // Acceptance match
  if (settings.hideAcceptance) {
    // 1. Hide "Acceptance" header exactly
    if (text === 'Acceptance') {
      parent.style.setProperty('opacity', '0', 'important');
      parent.style.setProperty('pointer-events', 'none', 'important');
      parent.setAttribute('data-zen-hidden', 'true');
    }
    // 2. Hide acceptance stat block by checking if text matches Accepted/Acceptance Rate
    if (text.includes('Accepted') || text.includes('Acceptance Rate')) {
      let container = parent;
      for (let i = 0; i < 5; i++) {
        if (!container || !container.parentElement) break;
        const parentText = container.parentElement.innerText || '';
        if (parentText.includes('Accepted') && parentText.includes('Acceptance Rate')) {
          container = container.parentElement;
          break;
        }
        container = container.parentElement;
      }
      container.style.setProperty('opacity', '0', 'important');
      container.style.setProperty('pointer-events', 'none', 'important');
      container.setAttribute('data-zen-hidden', 'true');
    }
    // 3. Problem set list percentage match (e.g. "73.6%" or split structures containing "%")
    if (text.includes('%')) {
      let container = parent;
      for (let i = 0; i < 3; i++) {
        if (!container) break;
        const cellText = (container.innerText || '').replace(/\s/g, '').replace(/\u00a0/g, '');
        if (/^\d+(\.\d+)?%$/.test(cellText)) {
          container.style.setProperty('opacity', '0', 'important');
          container.style.setProperty('pointer-events', 'none', 'important');
          container.setAttribute('data-zen-hidden', 'true');
          break;
        }
        container = container.parentElement;
      }
    }
  }
}

function hideZenTextInSubtree(element, settings) {
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walk.nextNode()) {
    hideZenTextNode(node, settings);
  }
}

// Listen for settings changes to apply updates in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    applyZenMode(changes.settings.newValue || {});
  }
});

// Efficient check for "Accepted" banner/status in added nodes
function containsAccepted(mutation) {
  if (mutation.type === 'childList') {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.textContent && node.textContent.includes("Accepted")) {
          return true;
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.includes("Accepted")) {
          return true;
        }
      }
    }
  } else if (mutation.type === 'characterData') {
    if (mutation.target.nodeValue && mutation.target.nodeValue.includes("Accepted")) {
      return true;
    }
  }
  return false;
}

// Observe the DOM to check for submission results
let isCheckingSubmissions = false;

function setupObserver() {
  console.log("[LeetTrack Pro] Injecting Mutation Observer...");

  getContentSettings().then(settings => {
    applyZenMode(settings);
  });
  
  const observer = new MutationObserver((mutations) => {
    const hasActiveZen = currentZenSettings.hideEasy || currentZenSettings.hideMedium || currentZenSettings.hideHard || currentZenSettings.hideAcceptance;

    for (const mutation of mutations) {
      const isChildList = mutation.type === 'childList';
      const isCharData = mutation.type === 'characterData';

      if (isChildList && hasActiveZen) {
        // Optimize: Only walk newly added subtrees to prevent performance lag
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            hideZenTextInSubtree(node, currentZenSettings);
          } else if (node.nodeType === Node.TEXT_NODE) {
            hideZenTextNode(node, currentZenSettings);
          }
        });
      } else if (isCharData && hasActiveZen) {
        hideZenTextNode(mutation.target, currentZenSettings);
      }

      // Fast check for "Accepted" submission result without reading document.body.innerHTML
      if (containsAccepted(mutation)) {
        if (isCheckingSubmissions) continue; // Skip if a check is already in progress
        const slug = getProblemSlug();
        if (slug) {
          isCheckingSubmissions = true;
          fetchLatestSubmissions(slug).then(submissions => {
            isCheckingSubmissions = false;
            const latest = submissions[0];
            if (latest && latest.statusDisplay === 'Accepted') {
              const ageSeconds = (Date.now() / 1000) - latest.timestamp;
              if (ageSeconds < 60) {
                processSubmission(latest.id);
              }
            }
          }).catch(err => {
            isCheckingSubmissions = false;
            console.error("[LeetTrack Pro] Submissions check failed:", err);
          });
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Run setup after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupObserver);
} else {
  setupObserver();
}

