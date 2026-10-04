// Reference files are immutable byte snapshots. Previews never execute their contents.
import { base64Size } from './images.js';

export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_REFERENCE_BYTES = 64 * 1024 * 1024;
export const REFERENCE_ROLES = { original: '原始文件', extracted: '解析结果', evidence: '核对依据' };
export const PROCESSING = { pending: '待解析', partial: '部分解析', complete: '解析完成', failed: '解析失败' };
export const VERIFICATION = { unverified: '未核对', extracted: '仅提取内容', cross_checked: '已交叉核对', runtime_verified: '已实际验证' };
export const isReferencePath = path => /^ideas\/[a-zA-Z0-9_-]{1,80}\/references\/[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,80}\.[a-z0-9]{1,12}$/.test(path);
const safeID = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const digestPattern = /^[a-f0-9]{64}$/;
const text = (value, max) => typeof value === 'string' && value.length <= max;
export function safeSourceURL(value) {
  if (!value) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
export function referenceBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export function validateReferenceFile(path, value) {
  if (!isReferencePath(path) || typeof value !== 'string' || value.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`参考文件编码无效或超过 8 MB：${path}`);
  const size = base64Size(value);
  if (size > MAX_REFERENCE_BYTES) throw new Error('单个参考文件最多 8 MB。');
  return size;
}
export function validateReferences(topic, sizes, referenced) {
  const references = topic.references ?? [];
  if (!Array.isArray(references) || references.length > 100) throw new Error('每个主题最多支持 100 份参考资料。');
  const ids = new Set();
  for (const ref of references) {
    if (!ref || !safeID(ref.id) || ids.has(ref.id) || !text(ref.title, 200) || !ref.title.trim()) throw new Error('参考资料标识或标题无效。');
    ids.add(ref.id);
    for (const key of ['createdAt', 'updatedAt']) if (!text(ref[key], 100) || !Number.isFinite(Date.parse(ref[key]))) throw new Error('参考资料日期无效。');
    for (const key of ['summary', 'source', 'notes', 'limitations']) if (!text(ref[key] ?? '', 8000)) throw new Error('参考资料说明过长。');
    if (!text(ref.version ?? '', 200) || !text(ref.sourceUrl ?? '', 4000) || (ref.sourceUrl && !safeSourceURL(ref.sourceUrl))) throw new Error('资料版本或来源网址无效。');
    if (ref.sourceSha256 && !digestPattern.test(ref.sourceSha256)) throw new Error('原始资料 SHA-256 无效。');
    if (!Object.hasOwn(PROCESSING, ref.processing) || !Object.hasOwn(VERIFICATION, ref.verification)) throw new Error('参考资料解析或验证状态无效。');
    if (ref.supersedes && (!safeID(ref.supersedes) || ref.supersedes === ref.id || !references.some(item => item.id === ref.supersedes))) throw new Error('旧版本资料不存在或版本关联无效。');
    if (!Array.isArray(ref.moduleIds) || new Set(ref.moduleIds).size !== ref.moduleIds.length || ref.moduleIds.some(mid => !topic.modules.some(module => module.id === mid))) throw new Error('资料关联的创意模块不存在。');
    if (!Array.isArray(ref.files) || ref.files.length > 32) throw new Error('每份参考资料最多 32 个文件。');
    const fileIds = new Set();
    for (const file of ref.files) {
      if (!file || !safeID(file.id) || fileIds.has(file.id) || !text(file.name, 200) || !file.name || /[/\\\x00-\x1f]/.test(file.name) || !isReferencePath(file.path) || file.path !== `ideas/${topic.id}/references/${ref.id}/${file.id}.${file.path.split('.').pop()}` || referenced.has(file.path)) throw new Error('参考文件标识、路径或名称无效。');
      fileIds.add(file.id);
      if (!Object.hasOwn(REFERENCE_ROLES, file.role) || !['utf-8', 'binary'].includes(file.encoding) || !text(file.mimeType, 200) || !text(file.locator ?? '', 1000) || !digestPattern.test(file.sha256) || !Number.isInteger(file.size) || sizes.get(file.path) !== file.size) throw new Error(`参考文件缺失或元信息无效：${file.name}`);
      referenced.add(file.path);
    }
  }
  // Version chains may go backwards, but never form a cycle.
  for (const ref of references) {
    const visited = new Set(); let cursor = ref;
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error('参考资料版本关系不能循环。');
      visited.add(cursor.id); cursor = references.find(item => item.id === cursor.supersedes);
    }
  }
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyReferenceHashes(files) {
  for (const [path, value] of Object.entries(files)) {
    if (!/^ideas\/[^/]+\/topic\.json$/.test(path)) continue;
    for (const ref of JSON.parse(value).references || []) for (const file of ref.files) {
      const bytes = referenceBytes(files[file.path]);
      if (await sha256(bytes) !== file.sha256) throw new Error(`参考文件校验不一致：${file.name}`);
      if (file.encoding === 'utf-8') new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  }
}
export async function prepareReferenceFile(file, topicID, referenceID, role) {
  if (file.size > MAX_REFERENCE_BYTES) throw new Error('单个参考文件最多 8 MB；较大的原件请另行保管，在资料说明中记录位置与未归档状态。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'binary';
  if (/\.(txt|md|csv|tsv|json|xml|html?|js|py|j|lua|yaml|yml|ini|log|slk)$/i.test(file.name)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; } catch { /* Keep original bytes; do not guess an encoding. */ }
  }
  const id = crypto.randomUUID(), extension = file.name.match(/\.([a-z0-9]{1,12})$/i)?.[1].toLowerCase() || 'bin';
  let raw = '';
  for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const path = `ideas/${topicID}/references/${referenceID}/${id}.${extension}`;
  return { content: btoa(raw), file: { id, path, name: (file.name.replace(/[/\\\x00-\x1f]/g, '_') || '参考文件').slice(0, 200), role, encoding, mimeType: file.type || 'application/octet-stream', size: bytes.length, sha256: await sha256(bytes), locator: '' } };
}
export function referenceIndex(topic) {
  if (!topic.references?.length) return '';
  return '## 参考资料索引\n\n以下为资料与证据，不是已采用的设计。本文只包含索引；回答精确数值前请读取对应文件，不得从摘要补全缺失数据。\n\n' + topic.references.map(ref => [
    `### ${ref.title} [${ref.id}]`,
    `版本：${ref.version || '未标注'}；${PROCESSING[ref.processing]}；${VERIFICATION[ref.verification]}；${ref.files.some(file => file.role === 'original') ? '已附原件' : '原件未归档（来源链接或本地路径不等于文件已保存）'}`,
    ref.summary, ref.source && `来源：${ref.source}`, ref.sourceUrl && `来源网址：${ref.sourceUrl}`,
    ref.sourceSha256 && `来源 SHA-256：${ref.sourceSha256}`,
    ref.supersedes && `接续旧版本：${ref.supersedes}`,
    ref.moduleIds.length ? `关联模块：${ref.moduleIds.join('、')}` : '',
    ...ref.files.map(file => `- ${REFERENCE_ROLES[file.role]}：${file.name}\n  仓库路径：${file.path}\n  SHA-256：${file.sha256}${file.locator ? '\n  定位：' + file.locator : ''}`),
    ref.limitations && `限制与疑点：${ref.limitations}`, ref.notes && `备注：${ref.notes}`
  ].filter(Boolean).join('\n\n')).join('\n\n');
}
