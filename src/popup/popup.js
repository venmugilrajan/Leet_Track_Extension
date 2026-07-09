import { getSettings, getHistory } from '../storage/storage.js';
import { calculateStreaks, padProblemId } from '../utils/utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  await refreshUI();

  // Open full dashboard
  document.getElementById('open-dashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Bulk sync uncommitted solutions
  const syncBtn = document.getElementById('sync-now');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `<span class="material-icons rotating">sync</span> Syncing...`;
      
      chrome.runtime.sendMessage({ type: 'SYNC_ALL_UNCOMMITTED' }, async (response) => {
        syncBtn.disabled = false;
        syncBtn.innerHTML = `<span class="material-icons">sync</span> Sync Now`;
        if (response && response.success) {
          await refreshUI();
        } else {
          alert(`Sync failed: ${response?.error || 'Unknown error'}`);
        }
      });
    });
  }
});

async function refreshUI() {
  const settings = await getSettings();
  const history = await getHistory();

  // 1. Update GitHub Connection Status
  const githubStatus = document.getElementById('github-status');
  if (settings.githubToken && settings.githubRepo) {
    githubStatus.className = 'status-box connected';
    githubStatus.innerHTML = `
      <span class="material-icons status-icon">cloud_done</span>
      <div class="status-info">
        <div class="status-title">Synced to GitHub</div>
        <div class="status-desc">${settings.githubRepo}</div>
      </div>
    `;
  } else {
    githubStatus.className = 'status-box';
    githubStatus.innerHTML = `
      <span class="material-icons status-icon">cloud_off</span>
      <div class="status-info">
        <div class="status-title">GitHub Not Connected</div>
        <div class="status-desc">Click to open settings and configure.</div>
      </div>
    `;
    githubStatus.style.cursor = 'pointer';
    githubStatus.onclick = () => chrome.runtime.openOptionsPage();
  }

  // 2. Calculate Stats
  const total = history.length;
  const difficulties = { Easy: 0, Medium: 0, Hard: 0 };
  const solvedDates = [];

  history.forEach(item => {
    const diff = item.difficulty || 'Medium';
    if (difficulties[diff] !== undefined) {
      difficulties[diff]++;
    }
    if (item.solvedDate) {
      solvedDates.push(item.solvedDate);
    }
  });

  // Calculate Streaks
  const { currentStreak } = calculateStreaks(solvedDates);

  // Update numbers
  document.getElementById('stat-total').innerText = total;
  document.getElementById('stat-streak').innerText = `🔥 ${currentStreak}`;

  // 3. Update Progress Bars
  const easyPct = total ? (difficulties.Easy / total) * 100 : 0;
  const mediumPct = total ? (difficulties.Medium / total) * 100 : 0;
  const hardPct = total ? (difficulties.Hard / total) * 100 : 0;

  document.getElementById('bar-easy').style.width = `${easyPct}%`;
  document.getElementById('bar-medium').style.width = `${mediumPct}%`;
  document.getElementById('bar-hard').style.width = `${hardPct}%`;

  // 4. Update Sync Action Container
  const uncommitted = history.filter(item => !item.githubCommit);
  const syncContainer = document.getElementById('sync-container');
  const unsyncedText = document.getElementById('unsynced-text');

  if (settings.githubToken && settings.githubRepo && uncommitted.length > 0) {
    syncContainer.style.display = 'flex';
    unsyncedText.innerText = `You have ${uncommitted.length} uncommitted solution${uncommitted.length > 1 ? 's' : ''}.`;
  } else {
    syncContainer.style.display = 'none';
  }

  // 5. Update last solved problem title
  const lastSolvedTitle = document.getElementById('last-solved-title');
  if (history.length > 0) {
    // Sort by solvedDate descending
    const sorted = [...history].sort((a, b) => new Date(b.solvedDate) - new Date(a.solvedDate));
    const latest = sorted[0];
    lastSolvedTitle.innerText = `${padProblemId(latest.id)} - ${latest.title}`;
    lastSolvedTitle.title = `${padProblemId(latest.id)} - ${latest.title}`;
  } else {
    lastSolvedTitle.innerText = 'No submissions tracked yet.';
  }
}
