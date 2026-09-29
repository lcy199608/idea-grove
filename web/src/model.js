export const SCHEMA_VERSION = 1;
export const TYPES = { gameplay: '核心玩法', experience: '玩家体验', art: '美术与世界', tech: '技术方案', question: '待解决问题', other: '自由笔记' };
export const STATUSES = { confirmed: '已确认', exploring: '待探索', rejected: '已放弃' };
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const clone = value => structuredClone(value);
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const safeID = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const marker = () => JSON.stringify({ schemaVersion: SCHEMA_VERSION, app: 'idea-vault' }, null, 2) + '\n';
export const managed = path => path === 'idea-vault.json' || /^ideas\/[a-zA-Z0-9_-]{1,80}\/topic\.json$/.test(path) || /^ideas\/[a-zA-Z0-9_-]{1,80}\/modules\/[a-zA-Z0-9_-]{1,80}\.md$/.test(path);

export function newTopic(title, description = '', tags = []) {
  const time = now();
  return { id: id(), title, description, tags, createdAt: time, updatedAt: time };
}
export function newModule(title = '', type = 'gameplay', status = 'exploring') {
  const time = now();
  return { id: id(), title, type, status, reason: '', source: '', createdAt: time, updatedAt: time, body: '' };
}
export const topicPath = tid => `ideas/${tid}/topic.json`;
export const modulePath = (tid, mid) => `ideas/${tid}/modules/${mid}.md`;
export const encodeTopic = topic => JSON.stringify(topic, null, 2) + '\n';
export function encodeModule(module) {
  const { body, ...metadata } = module;
  return `---\n${JSON.stringify(metadata)}\n---\n\n${body.trim()}\n`;
}
function textField(value, name, max = 200000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name}格式错误或过长。`);
}
function metadata(value) {
  if (!value || !safeID(value.id)) throw new Error('资料标识格式错误。');
  textField(value.title, '标题', 200);
  if (!value.title.trim()) throw new Error('标题不能为空。');
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key]))) throw new Error('资料日期格式错误。');
  }
}
export function decodeModule(content) {
  const match = content.match(/^---\r?\n([^\r\n]+)\r?\n---\r?\n(?:\r?\n)?([\s\S]*)$/);
  if (!match) throw new Error('模块需要一行 JSON frontmatter，详见资料格式文档。');
  const module = JSON.parse(match[1]);
  metadata(module);
  if (!Object.hasOwn(TYPES, module.type) || !Object.hasOwn(STATUSES, module.status)) throw new Error('模块类型或状态不受支持。');
  for (const key of ['source', 'reason']) textField(module[key] ?? '', key, 4000);
  textField(match[2].trim(), '正文');
  return { ...module, body: match[2].trim() };
}
export function parseFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('资料必须是文件映射。');
  if (Object.keys(files).length > 2000) throw new Error('首版最多支持 2000 个资料文件。');
  const topics = [];
  for (const [path, content] of Object.entries(files)) {
    if (!managed(path)) throw new Error(`不支持的资料路径：${path}`);
    textField(content, path, 300000);
    if (new TextEncoder().encode(content).byteLength > 300000) throw new Error(`文件超过 300000 UTF-8 字节，请拆分模块：${path}`);
    if (path === 'idea-vault.json') {
      const value = JSON.parse(content);
      if (value.schemaVersion !== 1 || value.app !== 'idea-vault') throw new Error('资料库版本不受支持，请更新应用。');
    } else if (path.endsWith('/topic.json')) {
      const topic = JSON.parse(content);
      metadata(topic);
      if (path !== topicPath(topic.id)) throw new Error('主题标识与路径不一致。');
      textField(topic.description, '主题描述', 4000);
      if (!Array.isArray(topic.tags) || topic.tags.length > 20 || topic.tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw new Error('主题标签格式错误。');
      topics.push({ ...topic, modules: [] });
    }
  }
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue;
    const topic = topics.find(item => item.id === path.split('/')[1]);
    if (!topic) throw new Error(`模块缺少所属主题：${path}`);
    const module = decodeModule(content);
    if (path !== modulePath(topic.id, module.id)) throw new Error('模块标识与路径不一致。');
    topic.modules.push(module);
  }
  if (topics.length && !files['idea-vault.json']) throw new Error('缺少 idea-vault.json 资料库标记。');
  topics.forEach(topic => topic.modules.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  return topics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const changedPaths = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]);
const groupKey = path => path.startsWith('ideas/') ? path.split('/')[1] : '_vault';
const subset = (files, key) => Object.fromEntries(Object.keys(files).filter(path => groupKey(path) === key).sort().map(path => [path, files[path]]));

// A topic is a consistency boundary: deleting a topic must not resurrect its modules.
export function mergeFiles(base, local, remote) {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)].map(groupKey));
  const merged = {};
  const conflicts = [];
  for (const key of keys) {
    const b = subset(base, key), l = subset(local, key), r = subset(remote, key);
    if (equal(l, r) || equal(b, r)) Object.assign(merged, l);
    else if (equal(b, l)) Object.assign(merged, r);
    else conflicts.push({ key, base: b, local: l, remote: r });
  }
  return { merged, conflicts };
}
export function resolveMerge(result, choices) {
  const files = { ...result.merged };
  for (const conflict of result.conflicts) {
    if (!['local', 'remote'].includes(choices[conflict.key])) throw new Error('请处理所有冲突。');
    Object.assign(files, conflict[choices[conflict.key]]);
  }
  parseFiles(files);
  return files;
}
export function contextText(topic, includeExploring = true) {
  const modules = topic.modules.filter(module => module.status === 'confirmed' || (includeExploring && module.status === 'exploring'));
  return [
    `# ${topic.title}`, topic.description,
    '> 这是项目的当前资料快照。已确认内容是当前约束；待探索内容尚未采用。请勿把推测写成共识。',
    ...modules.map(module => `## ${module.title} · ${STATUSES[module.status]}\n类型：${TYPES[module.type]}\n\n${module.body}${module.reason ? `\n\n决策理由：${module.reason}` : ''}${module.source ? `\n来源：${module.source}` : ''}`),
    '---\n接续方式：先指出需要澄清的未决问题，再继续讨论；当我明确要求沉淀时，列出新增、修改和删除，并保留不相关内容。'
  ].filter(Boolean).join('\n\n');
}
