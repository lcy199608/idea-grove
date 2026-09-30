// Only repository location is shared. Credentials never enter this document.
export const CONNECTION_APP = 'shinian-connection';

export function connectionPath(userId) {
  if (!/^[1-9][0-9]*$/.test(String(userId))) throw new Error('无法识别当前 GitHub 账号。');
  return `.shinian/connections/${userId}.json`;
}

export function connectionDocument(config, userId, previous = {}) {
  connectionPath(userId);
  return {
    ...previous,
    app: CONNECTION_APP,
    schemaVersion: 1,
    githubUserId: String(userId),
    repository: `${config.owner}/${config.repo}`,
    branch: config.branch,
    updatedAt: new Date().toISOString()
  };
}

export async function sharePluginConnection(client) {
  const account = await client.request('/user', 'GET', undefined, '');
  const path = connectionPath(account.id);
  const repo = await client.request('');
  if (!repo.default_branch || !repo.full_name) throw new Error('请先在 GitHub 创建仓库并添加 README。');
  // Validate the chosen data branch, and store discovery metadata on the default branch.
  await client.request(`/git/ref/heads/${client.branchPath()}`);
  const indexBranch = repo.default_branch;
  const branchPath = indexBranch.split('/').map(encodeURIComponent).join('/');
  await client.request(`/git/ref/heads/${branchPath}`);
  const filePath = `/contents/${path}`;
  let existing = null, previous = {};
  try {
    existing = await client.request(`${filePath}?ref=${encodeURIComponent(indexBranch)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    // Recheck access before treating a contents 404 as a missing file.
    await client.request(`/git/ref/heads/${branchPath}`);
  }
  if (existing) {
    if (existing.type !== 'file' || existing.encoding !== 'base64' || existing.size > 16000) throw new Error('远端连接配置格式不受支持，未覆盖。');
    try {
      const bytes = Uint8Array.from(atob(existing.content.replace(/\s/g, '')), c => c.charCodeAt(0));
      previous = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw new Error('远端连接配置无法解析，未覆盖。'); }
    if (previous?.app !== CONNECTION_APP || previous.schemaVersion !== 1 || previous.githubUserId !== String(account.id) || previous.repository?.toLowerCase() !== repo.full_name.toLowerCase()) throw new Error('远端连接配置与当前账号或仓库不符，未覆盖。');
  }
  const [owner, repoName] = repo.full_name.split('/');
  const document = connectionDocument({ owner, repo: repoName, branch: client.config.branch }, account.id, previous);
  const content = btoa(Array.from(new TextEncoder().encode(JSON.stringify(document, null, 2) + '\n'), byte => String.fromCharCode(byte)).join(''));
  const result = await client.request(filePath, 'PUT', {
    message: 'Configure Shinian repository connection',
    content,
    branch: indexBranch,
    ...(existing ? { sha: existing.sha } : {})
  });
  if (!result?.commit?.sha) throw new Error('GitHub 未返回提交结果。请让拾念插件读取连接状态确认，不要重复提交。');
  return { document, commit: result.commit.sha };
}
