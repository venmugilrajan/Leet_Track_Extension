/**
 * LeetTrack Pro GitHub API Module
 */

/**
 * Encodes string to Base64 (supporting UTF-8 characters safely).
 * @param {string} str 
 * @returns {string} base64 string
 */
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Fetches authenticated user info from GitHub.
 * @param {string} token 
 * @returns {Promise<Object>} User details
 */
export async function getUserInfo(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error(`GitHub Auth Failed: ${res.statusText}`);
  return await res.json();
}

/**
 * Fetches repositories of the authenticated user.
 * @param {string} token 
 * @returns {Promise<Object[]>} Repo list
 */
export async function getUserRepos(token) {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) throw new Error(`Failed to fetch repos: ${res.statusText}`);
  return await res.json();
}

/**
 * Creates a new repository for the user.
 * @param {string} token 
 * @param {string} name Repo Name
 * @param {boolean} isPrivate 
 * @returns {Promise<Object>} Created repo details
 */
export async function createRepo(token, name, isPrivate = true) {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify({
      name,
      description: 'LeetCode solutions automatically synced using LeetTrack Pro.',
      private: isPrivate,
      auto_init: true
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create repository');
  }
  return await res.json();
}

/**
 * Pushes a file to GitHub repository (creates or updates).
 * Handles existing files by fetching their SHA first.
 * @param {string} token 
 * @param {string} repo Full repo name (e.g. "username/repo")
 * @param {string} path Path to file inside repo
 * @param {string} content Content of the file
 * @param {string} commitMessage 
 * @returns {Promise<Object>} Commit info
 */
export async function pushToGitHub(token, repo, path, content, commitMessage) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  let sha = null;

  // Try to check if file already exists to get SHA
  try {
    const checkRes = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (checkRes.ok) {
      const data = await checkRes.json();
      sha = data.sha;
    }
  } catch (e) {
    // File doesn't exist, proceed with sha = null
  }

  // Commit the file
  const body = {
    message: commitMessage,
    content: toBase64(content)
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `Failed to commit file: ${path}`);
  }

  return await res.json();
}
