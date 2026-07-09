import { addOrUpdateSubmission, getSettings, getHistory, saveHistory } from '../storage/storage.js';
import { pushToGitHub } from '../github/github.js';
import { getLanguageExtension, padProblemId, formatTitle, generateReadme } from '../utils/utils.js';

// Show notifications
function showNotification(notificationId, title, message) {
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/src/assets/icons/icon128.png',
    title: title,
    message: message,
    priority: 2
  });
}

// Formats problem description and testcases as comments at the top of the code
function commentCode(code, language, title, id, difficulty, description, sampleTestCase) {
  const ext = getLanguageExtension(language);
  let commentStart = '/*';
  let commentLine = ' * ';
  let commentEnd = ' */';
  
  if (ext === 'py' || ext === 'sh' || ext === 'rb' || ext === 'pl') {
    commentStart = '##';
    commentLine = '# ';
    commentEnd = '##';
  }

  let commentBlock = `${commentStart}\n`;
  commentBlock += `${commentLine}Problem: ${id} - ${title}\n`;
  commentBlock += `${commentLine}Difficulty: ${difficulty}\n`;
  commentBlock += `${commentLine}URL: https://leetcode.com/problems/${title.toLowerCase().replace(/[\s_]+/g, '-')}/\n`;
  
  if (description) {
    commentBlock += `${commentLine}\n`;
    commentBlock += `${commentLine}Description:\n`;
    const lines = description.trim().split('\n');
    lines.forEach(l => {
      commentBlock += `${commentLine}${l}\n`;
    });
  }
  
  if (sampleTestCase) {
    commentBlock += `${commentLine}\n`;
    commentBlock += `${commentLine}Sample Test Case:\n`;
    const testLines = sampleTestCase.trim().split('\n');
    testLines.forEach(tl => {
      commentBlock += `${commentLine}  ${tl}\n`;
    });
  }
  
  commentBlock += `${commentEnd}\n\n`;
  return commentBlock + code;
}

// Commits a single problem submission to GitHub and updates README
async function syncSubmissionToGitHub(submission, settings, history) {
  const token = settings.githubToken;
  const repo = settings.githubRepo;
  
  if (!token || !repo) {
    throw new Error("GitHub credentials not configured");
  }

  const paddedId = padProblemId(submission.id);
  const formattedTitle = formatTitle(submission.title);
  const ext = getLanguageExtension(submission.language);
  const filename = `${paddedId}_${formattedTitle}.${ext}`;
  
  // Format folder path
  let path = '';
  if (settings.syncFolder) {
    path += settings.syncFolder.trim().replace(/\/+$/, '') + '/';
  }
  
  if (settings.folderNaming === 'Difficulty') {
    path += `${submission.difficulty}/${filename}`;
  } else {
    path += filename;
  }

  // Format commit message
  let commitMsg = settings.commitMsgFormat || 'Solved {id} - {title}';
  commitMsg = commitMsg
    .replace('{id}', paddedId)
    .replace('{title}', submission.title);

  // Prepend comments (description, testcases)
  const finalCode = commentCode(
    submission.code,
    submission.language,
    submission.title,
    paddedId,
    submission.difficulty,
    submission.description,
    submission.sampleTestCase
  );

  // 1. Commit the code
  await pushToGitHub(token, repo, path, finalCode, commitMsg);

  // 2. Regenerate and commit README
  const updatedHistory = history.map(item => {
    if (String(item.id) === String(submission.id)) {
      return { ...item, githubCommit: true };
    }
    return item;
  });
  
  const readmeContent = generateReadme(updatedHistory);
  const readmePath = settings.syncFolder 
    ? `${settings.syncFolder.trim().replace(/\/+$/, '')}/README.md`
    : 'README.md';
    
  await pushToGitHub(
    token,
    repo,
    readmePath,
    readmeContent,
    `Update README.md - Solved ${paddedId}`
  );

  return updatedHistory;
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_SUBMISSION') {
    handleNewSubmission(message.data)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error("Submission Handling Error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'MANUAL_SYNC') {
    handleManualSync(message.problemId)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error("Manual Sync Error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'SYNC_ALL_UNCOMMITTED') {
    handleSyncAllUncommitted()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => {
        console.error("Sync All Error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

// Logic for handling a new LeetCode submission
async function handleNewSubmission(submissionData) {
  // 1. Save to local storage
  const { updated, isNew } = await addOrUpdateSubmission(submissionData);
  
  if (!updated) {
    return { status: 'skipped', message: 'No updates or duplicate solution' };
  }

  showNotification(
    `accepted-${submissionData.id}`,
    `Accepted: ${submissionData.title}`,
    `Saved locally. Language: ${submissionData.language}`
  );

  // 2. Auto Push if active
  const settings = await getSettings();
  if (settings.autoPush && settings.githubToken && settings.githubRepo) {
    try {
      const history = await getHistory();
      const updatedHistory = await syncSubmissionToGitHub(submissionData, settings, history);
      
      // Update history with commit flag
      await saveHistory(updatedHistory);
      
      showNotification(
        `sync-${submissionData.id}`,
        "GitHub Sync Successful",
        `Committed: ${padProblemId(submissionData.id)} - ${submissionData.title}`
      );
      
      return { status: 'synced' };
    } catch (err) {
      console.error("GitHub Auto Sync failed:", err);
      showNotification(
        `sync-failed-${submissionData.id}`,
        "GitHub Sync Failed",
        err.message || "Failed to commit solution."
      );
      return { status: 'failed_sync', error: err.message };
    }
  }

  return { status: 'saved_locally' };
}

// Logic for manual sync of a single problem from dashboard
async function handleManualSync(problemId) {
  const history = await getHistory();
  const submission = history.find(item => String(item.id) === String(problemId));
  if (!submission) throw new Error("Submission not found in local database");

  const settings = await getSettings();
  const updatedHistory = await syncSubmissionToGitHub(submission, settings, history);
  await saveHistory(updatedHistory);

  showNotification(
    `manual-sync-${problemId}`,
    "GitHub Sync Successful",
    `Manually committed: ${submission.title}`
  );

  return { status: 'synced' };
}

// Sync all uncommitted submissions
async function handleSyncAllUncommitted() {
  const history = await getHistory();
  const uncommitted = history.filter(item => !item.githubCommit);
  
  if (uncommitted.length === 0) {
    return { count: 0, message: "All submissions are already synced." };
  }

  const settings = await getSettings();
  let successCount = 0;
  let activeHistory = [...history];

  for (const submission of uncommitted) {
    try {
      activeHistory = await syncSubmissionToGitHub(submission, settings, activeHistory);
      await saveHistory(activeHistory);
      successCount++;
    } catch (err) {
      console.error(`Failed to manual sync ${submission.title}:`, err);
      showNotification(
        `sync-all-failed`,
        "Bulk Sync Partial Failure",
        `Synced ${successCount}/${uncommitted.length}. Failed on: ${submission.title}`
      );
      throw err;
    }
  }

  showNotification(
    `sync-all-success`,
    "Bulk Sync Successful",
    `Successfully synced ${successCount} solutions to GitHub.`
  );

  return { count: successCount };
}
