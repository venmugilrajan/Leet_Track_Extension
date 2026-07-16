/**
 * LeetTrack Pro Storage Module
 * Wraps chrome.storage.local with clean getter/setter APIs.
 */

// Default settings
const DEFAULT_SETTINGS = {
  githubToken: '',
  githubRepo: '',
  syncFolder: 'LeetCode',
  autoSync: true,
  autoPush: true,
  theme: 'dark',
  commitMsgFormat: 'Solved {id} - {title}',
  languagePreference: 'Any',
  folderNaming: 'Difficulty', // 'Difficulty' (Easy/Medium/Hard) or 'Flat'
  hideEasy: false,
  hideMedium: false,
  hideHard: false,
  hideAcceptance: false
};

/**
 * Gets all extension settings.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...result.settings });
    });
  });
}

/**
 * Saves extension settings.
 * @param {Partial<typeof DEFAULT_SETTINGS>} newSettings 
 * @returns {Promise<void>}
 */
export async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = { ...current, ...newSettings };
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: updated }, () => {
      resolve();
    });
  });
}

/**
 * Retrieves the full submission history from storage.
 * @returns {Promise<Object[]>}
 */
export async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['history'], (result) => {
      resolve(result.history || []);
    });
  });
}

/**
 * Saves the entire history array to storage.
 * @param {Object[]} history 
 * @returns {Promise<void>}
 */
export async function saveHistory(history) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ history }, () => {
      resolve();
    });
  });
}

/**
 * Adds or updates a problem submission in the local history database.
 * Prevents duplicates by keying off the problem ID.
 * @param {Object} submission 
 * @returns {Promise<{updated: boolean, isNew: boolean}>}
 */
export async function addOrUpdateSubmission(submission) {
  const history = await getHistory();
  const existingIndex = history.findIndex(item => String(item.id) === String(submission.id));

  let isNew = false;
  let updated = false;

  const newEntry = {
    id: String(submission.id),
    title: submission.title,
    difficulty: submission.difficulty || 'Medium',
    language: submission.language || 'JavaScript',
    runtime: submission.runtime || '',
    memory: submission.memory || '',
    tags: submission.tags || [],
    solvedDate: submission.solvedDate || new Date().toISOString().slice(0, 10),
    code: submission.code || '',
    githubCommit: submission.githubCommit || null,
    description: submission.description || '',
    sampleTestCase: submission.sampleTestCase || '',
    notes: submission.notes || {
      approach: '',
      mistakes: '',
      optimization: '',
      timeComplexity: submission.timeComplexity || '',
      spaceComplexity: submission.spaceComplexity || '',
      revisionRequired: false
    }
  };

  if (existingIndex > -1) {
    const existing = history[existingIndex];
    // Avoid updating if it's the exact same solution, but overwrite details if it's a new language or better metrics
    // Or if notes have been updated.
    // For automatic trigger, we update language, code, runtime, memory, date and reset/preserve notes
    history[existingIndex] = {
      ...existing,
      ...newEntry,
      notes: {
        ...newEntry.notes,
        ...existing.notes // Preserve existing notes
      }
    };
    updated = true;
  } else {
    history.push(newEntry);
    isNew = true;
    updated = true;
  }

  if (updated) {
    await saveHistory(history);
  }
  return { updated, isNew };
}

/**
 * Updates notes for a specific problem ID.
 * @param {string} problemId 
 * @param {Object} notes 
 * @returns {Promise<boolean>}
 */
export async function updateProblemNotes(problemId, notes) {
  const history = await getHistory();
  const idx = history.findIndex(item => String(item.id) === String(problemId));
  if (idx > -1) {
    history[idx].notes = {
      ...history[idx].notes,
      ...notes
    };
    await saveHistory(history);
    return true;
  }
  return false;
}

/**
 * Clears all local history.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ history: [] }, () => {
      resolve();
    });
  });
}
