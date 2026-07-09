/**
 * LeetTrack Pro Utilities Module
 */

// Language to extension mapping
export const LANGUAGE_EXTENSIONS = {
  'cpp': 'cpp',
  'c': 'c',
  'csharp': 'cs',
  'java': 'java',
  'python': 'py',
  'python3': 'py',
  'javascript': 'js',
  'typescript': 'ts',
  'golang': 'go',
  'rust': 'rs',
  'kotlin': 'kt',
  'swift': 'swift',
  'ruby': 'rb',
  'scala': 'scala',
  'php': 'php',
  'html': 'html',
  'sql': 'sql',
  'mysql': 'sql',
  'mssql': 'sql',
  'bash': 'sh'
};

/**
 * Normalizes language name to a file extension.
 * @param {string} lang 
 * @returns {string} extension
 */
export function getLanguageExtension(lang) {
  if (!lang) return 'txt';
  const cleanLang = lang.toLowerCase().trim();
  return LANGUAGE_EXTENSIONS[cleanLang] || cleanLang;
}

/**
 * Pads problem ID to 4 characters (e.g., 1 -> 0001).
 * @param {string|number} id 
 * @returns {string} padded ID
 */
export function padProblemId(id) {
  const strId = String(id).trim();
  if (/^\d+$/.test(strId)) {
    return strId.padStart(4, '0');
  }
  return strId;
}

/**
 * Formats a title into snake_case with alphanumeric values.
 * @param {string} title 
 * @returns {string} formatted title
 */
export function formatTitle(title) {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');
}

/**
 * Calculates current and longest streak from a list of solvedDates (format: YYYY-MM-DD).
 * @param {string[]} dates 
 * @returns {{currentStreak: number, longestStreak: number}}
 */
export function calculateStreaks(dates) {
  if (!dates || dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Remove duplicates and sort ascending
  const uniqueDates = [...new Set(dates)].map(d => new Date(d).toISOString().slice(0, 10)).sort();
  
  if (uniqueDates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  let longest = 0;
  let current = 0;
  let tempStreak = 0;
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // Helper to check if two YYYY-MM-DD dates are consecutive days
  const isConsecutive = (d1, d2) => {
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    const diffTime = Math.abs(date2 - date1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 1;
  };

  // Calculate longest streak
  for (let i = 0; i < uniqueDates.length; i++) {
    if (i === 0 || isConsecutive(uniqueDates[i - 1], uniqueDates[i])) {
      tempStreak++;
    } else {
      if (tempStreak > longest) longest = tempStreak;
      tempStreak = 1;
    }
  }
  if (tempStreak > longest) longest = tempStreak;

  // Calculate current streak (must include today or yesterday to be active)
  const lastSolvedDate = uniqueDates[uniqueDates.length - 1];
  if (lastSolvedDate === todayStr || lastSolvedDate === yesterdayStr) {
    current = 1;
    for (let i = uniqueDates.length - 1; i > 0; i--) {
      if (isConsecutive(uniqueDates[i - 1], uniqueDates[i])) {
        current++;
      } else {
        break;
      }
    }
  } else {
    current = 0;
  }

  return { currentStreak: current, longestStreak: longest };
}

/**
 * Formats a date to local YYYY-MM-DD.
 * @param {Date|number|string} val 
 * @returns {string} YYYY-MM-DD
 */
export function formatDate(val) {
  const d = new Date(val);
  return d.toISOString().slice(0, 10);
}

/**
 * Generates the README.md content dynamically based on history.
 * @param {Object[]} history 
 * @returns {string} README markdown
 */
export function generateReadme(history) {
  const total = history.length;
  const difficulties = { Easy: 0, Medium: 0, Hard: 0 };
  const languages = {};
  
  const solvedDates = [];
  
  history.forEach(item => {
    const diff = item.difficulty || 'Medium';
    difficulties[diff] = (difficulties[diff] || 0) + 1;
    
    const lang = item.language || 'Unknown';
    languages[lang] = (languages[lang] || 0) + 1;
    
    if (item.solvedDate) {
      solvedDates.push(item.solvedDate);
    }
  });

  const { currentStreak, longestStreak } = calculateStreaks(solvedDates);

  // Generate difficulty section
  const easyPct = total ? Math.round((difficulties.Easy / total) * 100) : 0;
  const mediumPct = total ? Math.round((difficulties.Medium / total) * 100) : 0;
  const hardPct = total ? Math.round((difficulties.Hard / total) * 100) : 0;

  // Recent 5 problems
  const recent = history
    .slice()
    .sort((a, b) => new Date(b.solvedDate) - new Date(a.solvedDate))
    .slice(0, 5);

  let readme = `# LeetCode Progress 🚀

Maintain your LeetCode journey synced automatically using [LeetTrack Pro](https://github.com/ruthr/Leetcode-Track).

### Stats

| Metric | Details |
| :--- | :--- |
| **Total Solved** | ${total} |
| **Easy** | ${difficulties.Easy} (${easyPct}%) |
| **Medium** | ${difficulties.Medium} (${mediumPct}%) |
| **Hard** | ${difficulties.Hard} (${hardPct}%) |
| **Current Streak** | 🔥 ${currentStreak} days |
| **Longest Streak** | 🏆 ${longestStreak} days |

### Languages

`;

  // Sort languages by solve count
  const sortedLangs = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  sortedLangs.forEach(([lang, count]) => {
    readme += `- **${lang}**: ${count} problems\n`;
  });

  readme += `
### Recent Submissions

`;

  if (recent.length === 0) {
    readme += `No submissions tracked yet.`;
  } else {
    recent.forEach(item => {
      const paddedId = padProblemId(item.id);
      readme += `- ✔ **[${paddedId} - ${item.title}](https://leetcode.com/problems/${item.title.toLowerCase().replace(/[\s_]+/g, '-')})** (${item.difficulty}) - *Solved in ${item.language}*\n`;
    });
  }

  readme += `\n\n*README updated automatically by LeetTrack Pro.*`;
  return readme;
}
