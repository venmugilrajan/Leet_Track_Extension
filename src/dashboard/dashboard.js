import { getSettings, saveSettings, getHistory, updateProblemNotes, clearHistory } from '../storage/storage.js';
import { getUserInfo, getUserRepos, createRepo } from '../github/github.js';
import { calculateStreaks, padProblemId, formatDate } from '../utils/utils.js';

// Active chart instances
let difficultyChartInstance = null;
let languagesChartInstance = null;
let contestChartInstance = null;

// Modal problem tracking
let activeModalProblemId = null;

// Core topics target solved count for gamification
const TOPIC_TARGETS = {
  'Array': 40,
  'String': 30,
  'Hash Table': 25,
  'Dynamic Programming': 25,
  'Math': 20,
  'Sorting': 20,
  'Greedy': 20,
  'Depth-First Search': 20,
  'Breadth-First Search': 15,
  'Tree': 20,
  'Binary Search': 15,
  'Matrix': 12,
  'Two Pointers': 12,
  'Stack': 12,
  'Graph': 12,
  'Design': 10,
  'Backtracking': 10,
  'Linked List': 12,
  'Sliding Window': 10,
  'Heap (Priority Queue)': 10
};

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial Load
  await initSettings();
  await refreshDashboard();
  setupTabs();
  
  // Theme Toggle listener
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Global Sync button
  const globalSyncBtn = document.getElementById('global-sync-btn');
  globalSyncBtn.addEventListener('click', async () => {
    globalSyncBtn.disabled = true;
    globalSyncBtn.innerHTML = `<span class="material-icons rotating">sync</span> Syncing...`;
    
    chrome.runtime.sendMessage({ type: 'SYNC_ALL_UNCOMMITTED' }, async (response) => {
      globalSyncBtn.disabled = false;
      globalSyncBtn.innerHTML = `<span class="material-icons">sync</span> Sync Repository`;
      if (response && response.success) {
        await refreshDashboard();
        alert('All uncommitted submissions successfully synced to GitHub!');
      } else {
        alert(`Sync failed: ${response?.error || 'Unknown error'}`);
      }
    });
  });

  // Notes Modal Close
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('notes-modal').style.display = 'none';
  });
  document.getElementById('save-notes-btn').addEventListener('click', saveModalNotes);

  // Data Actions
  document.getElementById('export-json').addEventListener('click', exportJSON);
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('export-markdown').addEventListener('click', exportMarkdown);
  document.getElementById('clear-db-btn').addEventListener('click', handleResetDB);

  // Search & Filter listeners
  document.getElementById('search-bar').addEventListener('input', renderSubmissionsTable);
  document.getElementById('filter-difficulty').addEventListener('change', renderSubmissionsTable);
  document.getElementById('filter-tag').addEventListener('change', renderSubmissionsTable);
  document.getElementById('filter-time').addEventListener('change', renderSubmissionsTable);

  // GitHub Settings Verification
  document.getElementById('verify-token-btn').addEventListener('click', verifyGitHubToken);
  document.getElementById('settings-repo').addEventListener('change', async (e) => {
    await saveSettings({ githubRepo: e.target.value });
    await updateConnectedBadge();
  });
  document.getElementById('create-repo-btn').addEventListener('click', handleCreateRepo);

  // Settings inputs save on change
  const prefInputs = [
    { id: 'settings-folder', key: 'syncFolder' },
    { id: 'settings-folder-structure', key: 'folderNaming' },
    { id: 'settings-commit-format', key: 'commitMsgFormat' },
    { id: 'settings-auto-sync', key: 'autoSync', isCheck: true },
    { id: 'settings-auto-push', key: 'autoPush', isCheck: true }
  ];

  prefInputs.forEach(input => {
    const el = document.getElementById(input.id);
    el.addEventListener('change', async () => {
      const val = input.isCheck ? el.checked : el.value;
      await saveSettings({ [input.key]: val });
    });
  });

  // Contest Tracker Fetch
  document.getElementById('fetch-contest-btn').addEventListener('click', fetchContestData);
});

/* --- Tab Navigation --- */
function setupTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const tabId = item.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
      
      // Update Title
      if (tabId === 'tab-overview') pageTitle.innerText = "Analytics Overview";
      if (tabId === 'tab-submissions') pageTitle.innerText = "Submissions History";
      if (tabId === 'tab-contest') pageTitle.innerText = "Contest Performance";
      if (tabId === 'tab-settings') pageTitle.innerText = "Settings & Config";
    });
  });
}

/* --- Theme Support --- */
async function initSettings() {
  const settings = await getSettings();
  
  // Set Theme
  document.documentElement.setAttribute('data-theme', settings.theme);
  const themeIcon = document.getElementById('theme-icon');
  themeIcon.innerText = settings.theme === 'light' ? 'dark_mode' : 'light_mode';

  // Populate Preferences Inputs
  document.getElementById('settings-folder').value = settings.syncFolder;
  document.getElementById('settings-folder-structure').value = settings.folderNaming;
  document.getElementById('settings-commit-format').value = settings.commitMsgFormat;
  document.getElementById('settings-auto-sync').checked = settings.autoSync;
  document.getElementById('settings-auto-push').checked = settings.autoPush;

  if (settings.githubToken) {
    document.getElementById('settings-token').value = settings.githubToken;
    await verifyGitHubToken();
  }

  // Load username for contest tracker
  chrome.storage.local.get(['lcUsername'], (res) => {
    if (res.lcUsername) {
      document.getElementById('lc-username-input').value = res.lcUsername;
      fetchContestData();
    }
  });
}

async function toggleTheme() {
  const settings = await getSettings();
  const nextTheme = settings.theme === 'light' ? 'dark' : 'light';
  await saveSettings({ theme: nextTheme });
  document.documentElement.setAttribute('data-theme', nextTheme);
  const themeIcon = document.getElementById('theme-icon');
  themeIcon.innerText = nextTheme === 'light' ? 'dark_mode' : 'light_mode';
}

/* --- Refresh Operations --- */
async function refreshDashboard() {
  const history = await getHistory();
  await updateConnectedBadge();

  // Overview stats
  const total = history.length;
  document.getElementById('over-total').innerText = total;

  const solvedDates = [];
  const difficulties = { Easy: 0, Medium: 0, Hard: 0 };
  const languages = {};
  const tagsCount = {};
  let committedCount = 0;

  history.forEach(item => {
    difficulties[item.difficulty]++;
    languages[item.language] = (languages[item.language] || 0) + 1;
    
    if (item.solvedDate) solvedDates.push(item.solvedDate);
    if (item.githubCommit) committedCount++;

    if (item.tags && Array.isArray(item.tags)) {
      item.tags.forEach(t => {
        tagsCount[t] = (tagsCount[t] || 0) + 1;
      });
    }
  });

  const { currentStreak, longestStreak } = calculateStreaks(solvedDates);
  document.getElementById('over-cstreak').innerHTML = `${currentStreak} <span class="days-lbl">Days</span>`;
  document.getElementById('over-lstreak').innerHTML = `${longestStreak} <span class="days-lbl">Days</span>`;

  // Sync details
  const syncPct = total ? Math.round((committedCount / total) * 100) : 0;
  document.getElementById('over-sync-ratio').innerText = `${syncPct}%`;
  document.getElementById('over-sync-count').innerText = `${committedCount} of ${total} committed`;
  document.getElementById('over-progress-pct').style.width = `${total > 0 ? 100 : 0}%`;

  // Draw Dashboard UI parts
  renderHeatmap(solvedDates);
  renderCharts(difficulties, languages);
  renderTagCompletion(tagsCount);
  populateFilters(history);
  renderSubmissionsTable();
}

async function updateConnectedBadge() {
  const settings = await getSettings();
  const sidebarBadge = document.getElementById('sidebar-github-badge');
  if (settings.githubToken && settings.githubRepo) {
    sidebarBadge.className = 'github-connected-badge connected';
    sidebarBadge.innerHTML = `
      <span class="material-icons">cloud_done</span>
      <span>${settings.githubRepo.split('/')[1]}</span>
    `;
  } else {
    sidebarBadge.className = 'github-connected-badge';
    sidebarBadge.innerHTML = `
      <span class="material-icons text-muted">cloud_off</span>
      <span>Disconnected</span>
    `;
  }
}

/* --- Heatmap Generator --- */
function renderHeatmap(solvedDates) {
  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = '';

  const dateMap = {};
  solvedDates.forEach(d => {
    dateMap[d] = (dateMap[d] || 0) + 1;
  });

  // Calculate past 365 days
  const today = new Date();
  const dayMillis = 24 * 60 * 60 * 1000;
  const startDay = new Date(today.getTime() - 364 * dayMillis);

  // Align start to the nearest preceding Sunday
  const startOffset = startDay.getDay();
  startDay.setTime(startDay.getTime() - startOffset * dayMillis);

  // Total boxes to render: 53 columns * 7 rows = 371 cells
  for (let i = 0; i < 371; i++) {
    const current = new Date(startDay.getTime() + i * dayMillis);
    const dateStr = current.toISOString().slice(0, 10);
    const count = dateMap[dateStr] || 0;

    let intensity = 'lvl-0';
    if (count === 1) intensity = 'lvl-1';
    else if (count === 2) intensity = 'lvl-2';
    else if (count === 3) intensity = 'lvl-3';
    else if (count >= 4) intensity = 'lvl-4';

    const cell = document.createElement('div');
    cell.className = `heatmap-cell ${intensity}`;
    
    const formattedDate = current.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    cell.setAttribute('data-tooltip', `${count} solve${count !== 1 ? 's' : ''} on ${formattedDate}`);
    grid.appendChild(cell);
  }
}

/* --- Chart Rendering --- */
function renderCharts(difficulties, languages) {
  // 1. Difficulty Doughnut Chart
  const diffCtx = document.getElementById('chart-difficulty').getContext('2d');
  if (difficultyChartInstance) difficultyChartInstance.destroy();

  difficultyChartInstance = new Chart(diffCtx, {
    type: 'doughnut',
    data: {
      labels: ['Easy', 'Medium', 'Hard'],
      datasets: [{
        data: [difficulties.Easy, difficulties.Medium, difficulties.Hard],
        backgroundColor: ['#00b8a3', '#ffc01e', '#ef4743'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a0a5c0', font: { family: 'Inter' } }
        }
      }
    }
  });

  // 2. Languages polarArea/bar Chart
  const langCtx = document.getElementById('chart-languages').getContext('2d');
  if (languagesChartInstance) languagesChartInstance.destroy();

  const labels = Object.keys(languages);
  const data = Object.values(languages);

  languagesChartInstance = new Chart(langCtx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['None'],
      datasets: [{
        label: 'Problems Solved',
        data: data.length ? data : [0],
        backgroundColor: 'rgba(255, 137, 0, 0.65)',
        borderColor: '#ff8a00',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          ticks: { color: '#a0a5c0' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: {
          ticks: { color: '#a0a5c0' },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/* --- Tag Gamification Completion --- */
function renderTagCompletion(tagsCount) {
  const container = document.getElementById('tag-completion-list');
  container.innerHTML = '';

  const coreTopics = Object.keys(TOPIC_TARGETS);
  
  // Sort by count descending
  const sortedTopics = coreTopics.map(topic => {
    return {
      name: topic,
      solved: tagsCount[topic] || 0,
      target: TOPIC_TARGETS[topic]
    };
  }).sort((a, b) => b.solved - a.solved);

  sortedTopics.forEach(topic => {
    const percentage = Math.min(100, Math.round((topic.solved / topic.target) * 100));
    
    const item = document.createElement('div');
    item.className = 'tag-progress-item';
    item.innerHTML = `
      <div class="tag-progress-lbl">
        <span class="tag-name">${topic.name}</span>
        <span class="tag-values">${topic.solved} / ${topic.target} (${percentage}%)</span>
      </div>
      <div class="tag-progress-bar">
        <div class="tag-progress-fill" style="width: ${percentage}%"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

/* --- Filters & Search --- */
function populateFilters(history) {
  const tagFilter = document.getElementById('filter-tag');
  const previousValue = tagFilter.value;
  tagFilter.innerHTML = '<option value="All">All Topics</option>';

  const tags = new Set();
  history.forEach(item => {
    if (item.tags) item.tags.forEach(t => tags.add(t));
  });

  Array.from(tags).sort().forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.innerText = tag;
    tagFilter.appendChild(opt);
  });

  tagFilter.value = previousValue || 'All';
}

async function renderSubmissionsTable() {
  const history = await getHistory();
  const searchQuery = document.getElementById('search-bar').value.toLowerCase();
  const diffFilter = document.getElementById('filter-difficulty').value;
  const tagFilter = document.getElementById('filter-tag').value;
  const timeFilter = document.getElementById('filter-time').value;

  const tableBody = document.getElementById('submissions-table-body');
  tableBody.innerHTML = '';

  const now = new Date();
  
  const filtered = history.filter(item => {
    // Search
    const idStr = String(item.id);
    const titleMatch = item.title.toLowerCase().includes(searchQuery);
    const idMatch = idStr.includes(searchQuery);
    const tagMatch = item.tags.some(t => t.toLowerCase().includes(searchQuery));
    const langMatch = item.language.toLowerCase().includes(searchQuery);
    const searchPass = titleMatch || idMatch || tagMatch || langMatch;

    // Difficulty
    const diffPass = diffFilter === 'All' || item.difficulty === diffFilter;

    // Tag
    const tagPass = tagFilter === 'All' || item.tags.includes(tagFilter);

    // Time filter
    let timePass = true;
    if (item.solvedDate) {
      const solvedDate = new Date(item.solvedDate);
      const diffTime = now - solvedDate;
      const diffDays = diffTime / (1000 * 60 * 60 * 24);

      if (timeFilter === 'Week') timePass = diffDays <= 7;
      else if (timeFilter === 'Month') timePass = diffDays <= 30;
      else if (timeFilter === 'Year') timePass = diffDays <= 365;
    }

    return searchPass && diffPass && tagPass && timePass;
  });

  // Sort by solvedDate descending
  filtered.sort((a, b) => new Date(b.solvedDate) - new Date(a.solvedDate));

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No submissions found matching the criteria.</td></tr>`;
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement('tr');
    
    // Format difficulty badge
    const diffClass = item.difficulty.toLowerCase();
    
    // Format sync status
    const syncHtml = item.githubCommit 
      ? `<span class="sync-status-icon synced"><span class="material-icons">cloud_done</span> Synced</span>`
      : `<span class="sync-status-icon pending"><span class="material-icons">cloud_queue</span> Pending</span>`;

    // Dynamically construct URL if it is missing
    const problemSlug = item.title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/[\s_]+/g, '-');
    const problemUrl = item.problemUrl || `https://leetcode.com/problems/${problemSlug}/`;

    row.innerHTML = `
      <td>${padProblemId(item.id)}</td>
      <td style="font-weight: 600;">
        <a href="${problemUrl}" target="_blank" style="color: var(--accent-color); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
          ${item.title}
          <span class="material-icons" style="font-size: 14px;">open_in_new</span>
        </a>
      </td>
      <td><span class="diff-badge ${diffClass}">${item.difficulty}</span></td>
      <td>${item.language}</td>
      <td>${item.runtime} / ${item.memory}</td>
      <td>${item.solvedDate}</td>
      <td>${syncHtml}</td>
      <td>
        <button class="glass-action-btn note-edit-btn" data-id="${item.id}" style="padding:6px 12px; font-size:12px;">
          <span class="material-icons" style="font-size:16px;">edit_note</span> Notes
        </button>
        ${!item.githubCommit ? `
        <button class="glass-action-btn sync-single-btn" data-id="${item.id}" style="padding:6px 12px; font-size:12px;">
          <span class="material-icons" style="font-size:16px;">sync</span> Sync
        </button>
        ` : ''}
      </td>
    `;
    tableBody.appendChild(row);
  });

  // Hook note buttons
  document.querySelectorAll('.note-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const problemId = e.currentTarget.getAttribute('data-id');
      openNotesModal(problemId);
    });
  });

  // Hook single sync buttons
  document.querySelectorAll('.sync-single-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const problemId = e.currentTarget.getAttribute('data-id');
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = `<span class="material-icons rotating" style="font-size:16px;">sync</span>`;
      
      chrome.runtime.sendMessage({ type: 'MANUAL_SYNC', problemId }, async (response) => {
        if (response && response.success) {
          await refreshDashboard();
        } else {
          alert(`Sync failed: ${response?.error || 'Unknown error'}`);
          await refreshDashboard();
        }
      });
    });
  });
}

/* --- Notes Modal Manager --- */
async function openNotesModal(problemId) {
  const history = await getHistory();
  const problem = history.find(item => String(item.id) === String(problemId));
  if (!problem) return;

  activeModalProblemId = problemId;

  document.getElementById('modal-title').innerText = `Notes: ${padProblemId(problem.id)} - ${problem.title}`;
  document.getElementById('note-time').value = problem.notes?.timeComplexity || '';
  document.getElementById('note-space').value = problem.notes?.spaceComplexity || '';
  document.getElementById('note-revision').checked = problem.notes?.revisionRequired || false;
  
  document.getElementById('note-approach').value = problem.notes?.approach || '';
  document.getElementById('note-mistakes').value = problem.notes?.mistakes || '';
  document.getElementById('note-optimizations').value = problem.notes?.optimization || '';

  // Question description and test cases
  document.getElementById('note-description-preview').innerText = problem.description || 'No description found.';
  document.getElementById('note-testcase-preview').innerText = problem.sampleTestCase || 'No sample test case found.';

  // Code preview
  document.getElementById('note-code-preview').innerText = problem.code || '// No code found';

  document.getElementById('notes-modal').style.display = 'flex';
}

async function saveModalNotes() {
  if (!activeModalProblemId) return;

  const notes = {
    timeComplexity: document.getElementById('note-time').value,
    spaceComplexity: document.getElementById('note-space').value,
    revisionRequired: document.getElementById('note-revision').checked,
    approach: document.getElementById('note-approach').value,
    mistakes: document.getElementById('note-mistakes').value,
    optimization: document.getElementById('note-optimizations').value
  };

  const ok = await updateProblemNotes(activeModalProblemId, notes);
  if (ok) {
    document.getElementById('notes-modal').style.display = 'none';
    await refreshDashboard();
  } else {
    alert("Failed to save notes.");
  }
}

/* --- GitHub Integration Flow --- */
async function verifyGitHubToken() {
  const tokenInput = document.getElementById('settings-token').value.trim();
  if (!tokenInput) {
    alert("Please enter a token first.");
    return;
  }

  const verifyBtn = document.getElementById('verify-token-btn');
  verifyBtn.disabled = true;
  verifyBtn.innerText = "Verifying...";

  try {
    const user = await getUserInfo(tokenInput);
    const repos = await getUserRepos(tokenInput);
    
    await saveSettings({ githubToken: tokenInput });
    
    // Populate repos dropdown
    const repoSelect = document.getElementById('settings-repo');
    repoSelect.innerHTML = '';
    
    repos.forEach(repo => {
      const opt = document.createElement('option');
      opt.value = repo.full_name;
      opt.innerText = repo.full_name;
      repoSelect.appendChild(opt);
    });

    const settings = await getSettings();
    if (settings.githubRepo && repos.some(r => r.full_name === settings.githubRepo)) {
      repoSelect.value = settings.githubRepo;
    } else if (repos.length > 0) {
      repoSelect.value = repos[0].full_name;
      await saveSettings({ githubRepo: repos[0].full_name });
    }

    document.getElementById('repo-select-container').style.display = 'block';
    verifyBtn.innerText = "Verified ✔";
    verifyBtn.style.background = "#00b8a3";
    
    await updateConnectedBadge();
  } catch (err) {
    console.error("Token verification failed:", err);
    alert(`Token verification failed: ${err.message}`);
    verifyBtn.disabled = false;
    verifyBtn.innerText = "Verify & Load Repositories";
    verifyBtn.style.background = '';
  }
}

async function handleCreateRepo() {
  const settings = await getSettings();
  if (!settings.githubToken) {
    alert("Provide a verified GitHub Token first.");
    return;
  }

  const repoName = prompt("Enter new repository name:", "LeetCode-Solutions");
  if (!repoName) return;

  try {
    const created = await createRepo(settings.githubToken, repoName);
    alert(`Repository '${created.full_name}' successfully created!`);
    await verifyGitHubToken();
  } catch (err) {
    alert(`Failed to create repository: ${err.message}`);
  }
}

/* --- Contest Tracker Flow --- */
async function fetchContestData() {
  const username = document.getElementById('lc-username-input').value.trim();
  if (!username) {
    alert("Please enter a LeetCode username.");
    return;
  }

  const btn = document.getElementById('fetch-contest-btn');
  btn.disabled = true;
  btn.innerText = "Loading...";

  const query = `
    query userContestRankingInfo($username: String!) {
      userContestRanking(username: $username) {
        attendedContestsCount
        rating
        globalRanking
        totalParticipants
        topPercentage
      }
      userContestRankingHistory(username: $username) {
        attended
        problemsSolved
        rating
        contest {
          title
          startTime
        }
      }
    }
  `;

  try {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { username } })
    });
    
    if (!response.ok) throw new Error("Connection failed");
    const result = await response.json();
    const ranking = result?.data?.userContestRanking;
    const history = result?.data?.userContestRankingHistory?.filter(h => h.attended) || [];

    if (!ranking) {
      alert("No contest records found for this user. Make sure the username is correct and has attended contests.");
      btn.disabled = false;
      btn.innerText = "Load Contest Data";
      return;
    }

    // Save username
    chrome.storage.local.set({ lcUsername: username });

    // Show Cards
    document.getElementById('contest-stats-container').style.display = 'grid';
    document.getElementById('contest-chart-card').style.display = 'block';

    // Set stats
    document.getElementById('contest-rating').innerText = Math.round(ranking.rating);
    document.getElementById('contest-highest').innerText = `Global Rank: ${ranking.globalRanking} / ${ranking.totalParticipants}`;
    document.getElementById('contest-global-rank').innerText = `#${ranking.globalRanking}`;
    document.getElementById('contest-percentile').innerText = `Top ${ranking.topPercentage}%`;
    document.getElementById('contest-attended').innerText = ranking.attendedContestsCount;
    
    const totalContestSolves = history.reduce((sum, h) => sum + (h.problemsSolved || 0), 0);
    document.getElementById('contest-questions').innerText = `Questions Solved: ${totalContestSolves}`;

    // Draw Line Chart
    const labels = history.map(h => h.contest.title.replace("Weekly Contest ", "W").replace("Biweekly Contest ", "B"));
    const ratings = history.map(h => Math.round(h.rating));

    const contestCtx = document.getElementById('chart-contest-rating').getContext('2d');
    if (contestChartInstance) contestChartInstance.destroy();

    contestChartInstance = new Chart(contestCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Rating',
          data: ratings,
          backgroundColor: 'rgba(0, 242, 254, 0.1)',
          borderColor: '#00f2fe',
          borderWidth: 2,
          pointBackgroundColor: '#00f2fe',
          fill: true,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { color: '#a0a5c0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#a0a5c0' }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });

    btn.disabled = false;
    btn.innerText = "Load Contest Data";

  } catch (err) {
    console.error("Contest loading error:", err);
    alert(`Failed to load contest details: ${err.message}`);
    btn.disabled = false;
    btn.innerText = "Load Contest Data";
  }
}

/* --- Data Exports --- */
function downloadFile(content, fileName, contentType) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportJSON() {
  const history = await getHistory();
  const str = JSON.stringify(history, null, 2);
  downloadFile(str, "leettrack_history.json", "application/json");
}

async function exportCSV() {
  const history = await getHistory();
  let csv = "ID,Title,Difficulty,Language,Runtime,Memory,SolvedDate,GithubSynced,Notes_Time,Notes_Space,Notes_Approach\n";
  
  history.forEach(item => {
    const row = [
      item.id,
      `"${item.title.replace(/"/g, '""')}"`,
      item.difficulty,
      item.language,
      item.runtime,
      item.memory,
      item.solvedDate,
      item.githubCommit ? "YES" : "NO",
      `"${(item.notes?.timeComplexity || '').replace(/"/g, '""')}"`,
      `"${(item.notes?.spaceComplexity || '').replace(/"/g, '""')}"`,
      `"${(item.notes?.approach || '').replace(/"/g, '""')}"`
    ];
    csv += row.join(",") + "\n";
  });

  downloadFile(csv, "leettrack_history.csv", "text/csv");
}

async function exportMarkdown() {
  const history = await getHistory();
  let md = "# My LeetCode Portfolio\n\nGenerated automatically via LeetTrack Pro Control Center.\n\n";
  
  md += `## Overall Statistics\n- **Total Solved**: ${history.length}\n`;
  
  const groups = { Easy: [], Medium: [], Hard: [] };
  history.forEach(item => {
    if (groups[item.difficulty]) groups[item.difficulty].push(item);
  });

  md += `- **Easy**: ${groups.Easy.length}\n`;
  md += `- **Medium**: ${groups.Medium.length}\n`;
  md += `- **Hard**: ${groups.Hard.length}\n\n`;

  const renderGroup = (label, list) => {
    md += `### ${label} (${list.length} solved)\n\n`;
    if (list.length === 0) {
      md += "*No problems solved in this category.*\n\n";
      return;
    }
    list.forEach(item => {
      md += `#### ${padProblemId(item.id)} - ${item.title}\n`;
      md += `- **Language**: ${item.language}\n`;
      md += `- **Runtime / Memory**: ${item.runtime} / ${item.memory}\n`;
      md += `- **Solved Date**: ${item.solvedDate}\n`;
      if (item.notes?.timeComplexity) md += `- **Time Complexity**: ${item.notes.timeComplexity}\n`;
      if (item.notes?.spaceComplexity) md += `- **Space Complexity**: ${item.notes.spaceComplexity}\n`;
      if (item.notes?.approach) md += `- **Approach**: ${item.notes.approach}\n`;
      md += `\n\`\`\`${item.language.toLowerCase()}\n${item.code}\n\`\`\`\n\n`;
    });
  };

  renderGroup("Easy Solutions", groups.Easy);
  renderGroup("Medium Solutions", groups.Medium);
  renderGroup("Hard Solutions", groups.Hard);

  downloadFile(md, "LeetCode_Portfolio.md", "text/markdown");
}

async function handleResetDB() {
  if (confirm("Are you sure you want to RESET the local database? This deletes all history stored in the extension. Your GitHub files will not be deleted.")) {
    await clearHistory();
    await refreshDashboard();
    alert("Local database reset successfully.");
  }
}
