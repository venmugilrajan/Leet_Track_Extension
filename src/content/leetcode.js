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

// Observe the DOM to check for submission results
function setupObserver() {
  console.log("[LeetTrack Pro] Injecting Mutation Observer...");
  
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        // Look for the "Accepted" text in the submission panel
        const element = document.body;
        
        // Match standard LeetCode "Accepted" states
        // In the new UI, it shows "Accepted" on success. We can search for elements containing this.
        if (element.innerHTML.includes("Accepted")) {
          // Verify it's an actual solved event. 
          // Let's query the LeetCode submissions list to grab the latest submission and see if it's accepted.
          // This avoids false positives and gives us the exact ID immediately!
          const slug = getProblemSlug();
          if (slug) {
            fetchLatestSubmissions(slug).then(submissions => {
              const latest = submissions[0];
              if (latest && latest.statusDisplay === 'Accepted') {
                const ageSeconds = (Date.now() / 1000) - latest.timestamp;
                // If the submission is less than 60 seconds old, it's our new submission!
                if (ageSeconds < 60) {
                  processSubmission(latest.id);
                }
              }
            }).catch(err => {
              console.error("[LeetTrack Pro] Submissions check failed:", err);
            });
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Run setup after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupObserver);
} else {
  setupObserver();
}
