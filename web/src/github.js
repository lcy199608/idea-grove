import { managed, parseFiles, changedPaths } from './model.js';
import { isImagePath, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from './images.js';

export class GitHub {
  constructor(config, token) {
    this.config = config;
    this.token = token;
    this.root = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  }
  async request(path, method = 'GET', body, root = this.root) {
    if (!this.token) throw new Error('请在同步设置中填写 GitHub 访问令牌。');
    let response;
    try {
      response = await fetch(`https://api.github.com${root}${path}`, {
        method, cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'GitHub 请求超时。草稿已保留；请重新拉取确认远端状态。' : '无法连接 GitHub。请检查网络后重试，草稿仍在本机。');
    }
    if (!response.ok) {
      const messages = { 401: '访问令牌无效或已过期。', 403: '权限不足、分支受保护或 API 额度已用完。请检查令牌 Contents 读写权限。', 404: '找不到仓库或分支，或令牌没有访问权限。请先创建仓库并添加 README。', 409: '仓库为空或发生版本冲突。请初始化 README，或重新拉取。', 422: 'GitHub 拒绝本次提交，可能是远端已有新版本或分支规则限制。请重新拉取后重试。', 429: 'GitHub 请求过于频繁，请稍后重试。' };
      const error = new Error(messages[response.status] || `GitHub 请求失败（${response.status}），本地修改已保留。`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  branchPath() { return this.config.branch.split('/').map(encodeURIComponent).join('/'); }
  async snapshot() {
    const ref = await this.request(`/git/ref/heads/${this.branchPath()}`);
    const head = ref.object.sha;
    const commit = await this.request(`/git/commits/${head}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('仓库文件过多，无法完整读取。请使用独立的资料仓库。');
    const entries = tree.tree.filter(entry => managed(entry.path));
    if (entries.length > 2000) throw new Error('首版最多支持 2000 个资料文件，请拆分仓库。');
    if (tree.tree.some(entry => entry.path.startsWith('ideas/') && entry.type !== 'tree' && !managed(entry.path))) throw new Error('ideas/ 中有不支持的文件，请按资料格式整理后再同步。');
    if (entries.some(entry => entry.type !== 'blob' || entry.mode !== '100644' || !Number.isInteger(entry.size) || entry.size > (isImagePath(entry.path) ? MAX_IMAGE_BYTES : 300000))) throw new Error('资料含有过大文件或不支持的文件类型。');
    if (entries.filter(entry => isImagePath(entry.path)).reduce((sum, entry) => sum + entry.size, 0) > MAX_TOTAL_IMAGE_BYTES) throw new Error('资料库图片总量超过 40 MB，请拆分资料库。');
    const files = {};
    // Bound concurrency to keep large personal vaults within GitHub's request limits.
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
        const blob = await this.request(`/git/blobs/${entry.sha}`);
        if (blob.encoding !== 'base64') throw new Error('GitHub 返回了不支持的编码。');
        const content = blob.content.replace(/\s/g, '');
        if (isImagePath(entry.path)) files[entry.path] = content;
        else {
          const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
          files[entry.path] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
      }));
    }
    parseFiles(files);
    return { files, head, tree: commit.tree.sha };
  }
  async push(snapshot, files, message) {
    parseFiles(files);
    const paths = changedPaths(snapshot.files, files);
    if (!paths.length) return snapshot.head;
    const entries = [];
    // Upload binary blobs first. The branch changes only after the complete tree/commit is ready.
    for (const path of paths) {
      let value;
      if (files[path] === undefined) value = { sha: null };
      else if (isImagePath(path)) {
        const blob = await this.request('/git/blobs', 'POST', { content: files[path], encoding: 'base64' });
        value = { sha: blob.sha };
      } else value = { content: files[path] };
      entries.push({ path, mode: '100644', type: 'blob', ...value });
    }
    const tree = await this.request('/git/trees', 'POST', { base_tree: snapshot.tree, tree: entries });
    const commit = await this.request('/git/commits', 'POST', { message, tree: tree.sha, parents: [snapshot.head] });
    // A concurrent writer makes this update non-fast-forward; never force overwrite.
    await this.request(`/git/refs/heads/${this.branchPath()}`, 'PATCH', { sha: commit.sha, force: false });
    return commit.sha;
  }
}
