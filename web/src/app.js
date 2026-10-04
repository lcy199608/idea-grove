import { TYPES, STATUSES, id, now, clone, marker, upgradeImages, upgradeReferences, newTopic, newModule, topicPath, modulePath, encodeTopic, encodeModule, parseFiles, changedPaths, mergeFiles, resolveMerge, contextText } from './model.js';
import { get, setRecords, emptyWorkspace, workspaceKey, getCredential, saveConnection, clearCredentials } from './storage.js';
import { GitHub } from './github.js';
import { isImagePath, imageBlob, imageFileName, prepareImage, formatSize, base64Size, MAX_ATTACHMENTS, MAX_TOTAL_IMAGE_BYTES } from './images.js';
import { renderMarkdown, removeImageReferences } from './markdown.js';
import { createBodyEditor } from './body-editor.js';
import { sharePluginConnection } from './plugin-connection.js';
import { isReferencePath, referenceBytes, prepareReferenceFile, verifyReferenceHashes, safeSourceURL, REFERENCE_ROLES, PROCESSING, VERIFICATION } from './references.js';

const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app'), dialog = $('#dialog');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  leaf: '<path d="M19 4C8 3 3 8 5 15c6 5 15 1 14-11ZM5 20l9-11"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>', up: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v4h14v-4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', edit: '<path d="m14 5 5 5M4 20l5-1L20 8l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>', book: '<path d="M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2Zm0 14h16M8 7h8M8 11h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 4v-3a3 3 0 0 0-.8-2.3c3-.3 6-1.5 6-6.5a5 5 0 0 0-1.4-3.5A5 5 0 0 0 18.7 2S17.5 1.7 15 3.3a13 13 0 0 0-6 0C6.5 1.7 5.3 2 5.3 2a5 5 0 0 0-.1 3.7 5 5 0 0 0-1.4 3.5c0 5 3 6.2 6 6.5A3 3 0 0 0 9 18v3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>', wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0M12 20h.01"/>',
  box: '<path d="m3 7 9-4 9 4v11l-9 4-9-4ZM3 7l9 4 9-4M12 11v11"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
let config, workspace, selected = null, activeTab = 'modules', statusFilter = 'all', query = '', busy = false, token = '', sidebarOpen = false;
let installPrompt, toastTimer, currentDraft = null, saveQueue = Promise.resolve(), modalBusy = false;
let persistentError = '';
let releaseMainImages = () => {};
const date = value => new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const topics = () => parseFiles(workspace.files);
const currentTopic = () => topics().find(topic => topic.id === selected);
const dirtyCount = () => changedPaths(workspace.base, workspace.files).length;
const badge = status => `<span class="badge ${esc(status)}"><span></span>${esc(STATUSES[status])}</span>`;
const statusLabel = () => busy ? '正在同步…' : !navigator.onLine ? '离线 · 草稿可用' : config && !token ? '请填写访问令牌' : dirtyCount() ? `${dirtyCount()} 个文件待上传` : config ? '与上次拉取一致' : '仅保存在本机';

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.className = '', error ? 9000 : 4500);
}
function queueWrite(key, value) {
  return queueRecords([[key, value]]);
}
function queueRecords(records) {
  const snapshot = clone(records);
  const write = saveQueue.catch(() => {}).then(() => setRecords(snapshot));
  saveQueue = write;
  return write;
}
async function saveWorkspace(next, message) {
  parseFiles(next.files);
  parseFiles(next.base);
  await verifyReferenceHashes(next.files);
  if (message) next.activity = [{ id: id(), message, at: now() }, ...(next.activity || [])].slice(0, 60);
  await queueWrite(workspaceKey(config), next);
  workspace = next;
  persistentError = '';
}
function render() {
  releaseMainImages();
  const all = topics();
  if (!all.some(topic => topic.id === selected)) selected = all[0]?.id || null;
  const topic = currentTopic();
  app.innerHTML = `
    <div class="shell ${sidebarOpen ? 'nav-open' : ''}">
      <button class="nav-scrim" data-action="menu" aria-label="收起导航"></button>
      <aside class="sidebar" aria-label="主题导航">
        <a class="brand" href="#" data-action="home"><img src="./icons/icon.svg" alt="" width="36" height="36"><div>拾念<span>IDEA FIELD</span></div></a>
        <div class="workspace-label">我的创意空间 <span>PERSONAL</span></div>
        <button class="new-topic" data-action="new-topic">${icon('plus')} 新建主题 <kbd>＋</kbd></button>
        <div class="nav-heading">游戏主题 <span>${all.length.toString().padStart(2, '0')}</span></div>
        <nav class="topic-nav">${all.map((item, index) => `<button class="topic-link ${selected === item.id ? 'active' : ''}" data-action="select" data-id="${esc(item.id)}" ${selected === item.id ? 'aria-current="page"' : ''}><span class="topic-monogram">${esc(item.title.slice(0, 1))}</span><span class="topic-nav-text">${esc(item.title)}<small>${item.modules.length} 个模块</small></span>${selected === item.id ? '<span class="nav-dot"></span>' : ''}</button>`).join('') || '<p class="nav-empty">一个新世界，<br>从一个想法开始。</p>'}</nav>
        <div class="sidebar-bottom"><button data-action="guide">${icon('spark')} 与 AI 一起创作 ${icon('arrow')}</button><button data-action="backup">${icon('box')} 备份与导入</button><button data-action="settings">${icon('settings')} 同步设置</button>
        <div class="connection"><span class="connection-dot ${config && token ? 'connected' : ''}"></span><div>${config ? esc(config.owner + '/' + config.repo) : '尚未连接 GitHub'}<small>${config ? esc(config.branch) : '你的草稿保存在此设备'}</small></div></div></div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开主题导航">${icon('menu')}</button><span>创意档案</span><span class="slash">/</span><strong>${topic ? esc(topic.title) : '开始创作'}</strong></div>
          <div class="top-actions"><span class="sync-state"><span class="status-dot ${dirtyCount() ? 'dirty' : ''}"></span>${esc(statusLabel())}</span><button class="button subtle" data-action="pull" ${busy ? 'disabled' : ''}>${icon('down')}<span>拉取</span></button><button class="button primary small" data-action="push" ${busy ? 'disabled' : ''}>${icon('up')}<span>上传</span></button></div></header>
        ${persistentError ? `<div class="persistent-error" role="alert">${esc(persistentError)} <button data-action="backup">导出当前备份</button></div>` : ''}
        ${!navigator.onLine ? '<div class="offline-bar">当前离线，仍可编辑并保存到本机。恢复网络后再同步。</div>' : ''}
        <div class="content">${topic ? topicView(topic) : welcomeView()}</div>
        <footer class="footer"><span>留住值得继续的想法。</span><span>${config ? `上次同步 ${workspace.syncedAt ? date(workspace.syncedAt) : '尚未同步'}` : 'LOCAL FIRST · GITHUB SYNC'}</span></footer>
      </main>
    </div>`;
  releaseMainImages = mountImages(app, workspace.files);
}

function mountImages(root, files) {
  const urls = [];
  root.querySelectorAll('img[data-image-path]').forEach(img => {
    const path = img.dataset.imagePath;
    if (!isImagePath(path) || !files[path]) return;
    const url = URL.createObjectURL(imageBlob(path, files[path]));
    urls.push(url); img.src = url;
  });
  return () => urls.forEach(url => URL.revokeObjectURL(url));
}
function previewImage(item, content) {
  if (!content) { toast('这张参考图缺失，请重新拉取或重新添加。', true); return; }
  const viewer = document.createElement('dialog');
  viewer.className = 'image-viewer';
  const url = URL.createObjectURL(imageBlob(item.path, content));
  viewer.innerHTML = `<div class="dialog-head"><div><h2>${esc(item.name)}</h2><p>${item.width} × ${item.height} · ${formatSize(item.size)} · 已保存的参考图</p></div><button class="icon-button" aria-label="关闭图片">${icon('close')}</button></div><div class="image-stage"><img src="${url}" alt="${esc(item.caption || item.name)}"></div>${item.caption ? `<p class="image-caption">${esc(item.caption)}</p>` : ''}<div class="image-viewer-actions"><a class="button primary" href="${url}" download="${esc(imageFileName(item))}">${icon('down')} 下载图片</a><button class="button outline" id="image-zoom">查看实际尺寸</button></div>`;
  document.body.append(viewer);
  $('.icon-button', viewer).onclick = () => viewer.close();
  $('#image-zoom', viewer).onclick = event => {
    const full = $('.image-stage', viewer).classList.toggle('actual-size');
    event.currentTarget.textContent = full ? '适应窗口' : '查看实际尺寸';
  };
  viewer.addEventListener('close', () => { URL.revokeObjectURL(url); viewer.remove(); }, { once: true });
  viewer.showModal();
}
function welcomeView() {
  return `<section class="welcome"><div class="eyebrow">A PLACE FOR YOUR NEXT GAME</div><h1>让每一次灵感，<br>都有<span>下一次。</span></h1><p class="welcome-copy">把散落在对话里的玩法、技术与世界观，<br class="desktop-break">收进一份能接着聊、接着做的创意档案。</p><div class="welcome-actions"><button class="button primary" data-action="new-topic">${icon('plus')} 创建第一个主题</button><button class="button outline" data-action="sample">看看示例 ${icon('arrow')}</button></div>
    <div class="welcome-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-cross cross-one">+</div><div class="art-cross cross-two">+</div><div class="idea-slip back"><span>01 / 灵感</span><div class="sketch-line"></div><div class="sketch-line short"></div></div><div class="idea-slip front"><div class="slip-top">${icon('leaf')} 一颗想法的种子</div><h3>如果森林<br>能记住你的选择？</h3><span class="slip-pill">待探索</span><div class="slip-bottom">从这里，长出一个世界。 ${icon('arrow')}</div></div><div class="floating-note">${icon('check')} 让共识留下来</div></div></section>
    <section class="start-grid"><article><span class="step">01</span>${icon('spark')}<h3>自在地讨论</h3><p>继续在 ChatGPT 或 Codex 中头脑风暴。</p></article><article><span class="step">02</span>${icon('leaf')}<h3>有选择地沉淀</h3><p>留下已确认的结论，区分尚未定下的想法。</p></article><article><span class="step">03</span>${icon('arrow')}<h3>从共识继续</h3><p>换一台设备、换一个 AI，思路依然连贯。</p></article></section>`;
}
function topicView(topic) {
  const confirmed = topic.modules.filter(module => module.status === 'confirmed').length;
  const exploring = topic.modules.filter(module => module.status === 'exploring').length;
  return `<section class="topic-heading"><div><div class="eyebrow">YOUR GAME, TAKING SHAPE</div><div class="title-row"><h1>${esc(topic.title)}</h1><button class="icon-button" data-action="edit-topic" aria-label="编辑主题">${icon('edit')}</button></div><p class="topic-description">${esc(topic.description || '给这个世界写一句开场白。')}</p><div class="tags">${topic.tags.map(tag => `<span># ${esc(tag)}</span>`).join('')}<span class="topic-date">创建于 ${date(topic.createdAt)}</span></div></div><button class="button outline context-button" data-action="context">${icon('copy')} 接续上下文 ${icon('arrow')}</button></section>
    <section class="stats" aria-label="主题统计"><div><span>沉淀模块</span><strong>${String(topic.modules.length).padStart(2, '0')}<small>块拼图</small></strong></div><div><span><i class="stat-dot green"></i>已确认共识</span><strong>${String(confirmed).padStart(2, '0')}<small>继续创作的基础</small></strong></div><div><span><i class="stat-dot amber"></i>待探索想法</span><strong>${String(exploring).padStart(2, '0')}<small>留一点可能性</small></strong></div><div class="stat-quote">“好的创意，<br>值得被认真留下。” ${icon('leaf')}</div></section>
    <div class="tabs-row"><div class="tabs" role="tablist" aria-label="主题视图">${[['modules', 'grid', '创意模块'], ['references', 'box', '参考资料'], ['overview', 'book', '项目概览'], ['activity', 'clock', '本机动态']].map(([tab, symbol, label]) => `<button role="tab" aria-selected="${activeTab === tab}" class="tab ${activeTab === tab ? 'active' : ''}" data-action="tab" data-id="${tab}">${icon(symbol)} ${label}</button>`).join('')}</div><button class="text-button danger" data-action="delete-topic">${icon('trash')} 删除主题</button></div>
    <section role="tabpanel">${activeTab === 'modules' ? modulesView(topic) : activeTab === 'references' ? referencesView(topic) : activeTab === 'overview' ? overviewView(topic) : activityView()}</section>`;
}
function referencesView(topic) {
  const refs = (topic.references || []).filter(ref => `${ref.title} ${ref.summary} ${ref.source} ${ref.version} ${ref.files.map(file => file.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return `<div class="module-toolbar"><p class="muted">保存原件、解析结果与依据，换一次对话也能继续查阅。</p><div class="module-tools"><label class="search">${icon('search')}<input id="reference-search" type="search" placeholder="搜索参考资料…" value="${esc(query)}" aria-label="搜索参考资料"></label><button class="button primary" data-action="new-reference">${icon('plus')} 添加资料</button></div></div><div class="module-grid">${refs.map(ref => `<article class="module-card reference-card"><div class="card-meta"><span>${esc(PROCESSING[ref.processing])}</span><span>${esc(VERIFICATION[ref.verification])}</span></div><button class="card-title" data-action="view-reference" data-id="${esc(ref.id)}"><h2>${esc(ref.title)}</h2></button><p class="card-excerpt">${esc(ref.summary || '尚未填写资料摘要。')}</p><p class="helper">${esc(ref.version || '版本未标注')} · ${ref.files.length} 个文件 · ${ref.files.some(file => file.role === 'original') ? '已附原件' : '本页未附原件'}</p><div class="card-bottom"><span>${date(ref.updatedAt)}</span><button class="icon-button" data-action="edit-reference" data-id="${esc(ref.id)}" aria-label="编辑 ${esc(ref.title)}">${icon('edit')}</button></div></article>`).join('')}</div>${!refs.length ? '<p class="empty-filter">还没有对应资料。可添加文件，或先登记来源与待解析事项。</p>' : ''}`;
}
async function editReference(existing) {
  const topic = currentTopic(), key = `reference-draft:${workspaceKey(config)}:${topic.id}:${existing?.id || 'new'}`;
  const saved = await get(key), time = now();
  const value = clone(saved?.reference || existing || { id: id(), title: '', summary: '', source: '', sourceUrl: '', sourceSha256: '', version: '', processing: 'pending', verification: 'unverified', limitations: '', notes: '', moduleIds: [], files: [], createdAt: time, updatedAt: time });
  let assets = Object.fromEntries(value.files.map(file => [file.path, saved?.assets?.[file.path] ?? workspace.files[file.path]])), fileBusy = false;
  const selectOptions = (items, current) => Object.entries(items).map(([k, v]) => `<option value="${esc(k)}" ${current === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
  showDialog(existing ? '编辑参考资料' : '添加参考资料', '资料与设计共识分别保存。原件未上传时会明确标注；文件内容不会自动成为已确认设计。', `<form>${saved ? '<p class="notice">已恢复此设备尚未保存的资料草稿。</p>' : ''}<label class="field">资料名称<input name="title" required maxlength="200" value="${esc(value.title)}"></label><label class="field">摘要<textarea name="summary" rows="3" maxlength="8000">${esc(value.summary)}</textarea></label><div class="field-pair"><label class="field">版本<input name="version" maxlength="200" value="${esc(value.version)}"></label><label class="field">接续哪个旧版本<select name="supersedes"><option value="">独立资料</option>${(topic.references || []).filter(ref => ref.id !== value.id).map(ref => `<option value="${esc(ref.id)}" ${ref.id === value.supersedes ? 'selected' : ''}>${esc(ref.title)} · ${esc(ref.version)}</option>`).join('')}</select></label></div><label class="field">来源说明<input name="source" maxlength="8000" value="${esc(value.source)}" placeholder="文件提供者、来源位置或说明"></label><label class="field">来源网址（可选）<input name="sourceUrl" type="url" maxlength="4000" value="${esc(value.sourceUrl)}" placeholder="https://…"></label><label class="field">来源原件 SHA-256（可选）<input name="sourceSha256" pattern="[a-f0-9]{64}" value="${esc(value.sourceSha256)}"></label><div class="field-pair"><label class="field">解析状态<select name="processing">${selectOptions(PROCESSING, value.processing)}</select></label><label class="field">验证状态<select name="verification">${selectOptions(VERIFICATION, value.verification)}</select></label></div><label class="field">限制与待验证信息<textarea name="limitations" rows="3" maxlength="8000">${esc(value.limitations)}</textarea></label><label class="field">备注<textarea name="notes" rows="2" maxlength="8000">${esc(value.notes)}</textarea></label><fieldset class="reference-modules"><legend>关联创意模块（可选）</legend>${topic.modules.map(module => `<label class="check-field"><input type="checkbox" name="moduleId" value="${esc(module.id)}" ${value.moduleIds.includes(module.id) ? 'checked' : ''}>${esc(module.title)}</label>`).join('') || '<p class="helper">主题尚无模块。</p>'}</fieldset><div class="field-pair"><label class="field">添加文件的用途<select id="reference-role">${selectOptions(REFERENCE_ROLES, 'original')}</select></label><label class="field">添加文件<input id="reference-input" type="file" multiple></label></div><p class="helper">每份资料最多32个文件，单文件≤8 MB，资料库参考文件总量≤64 MB。保留原始字节，不自动解析PDF、表格或地图；AI解析结果可另作文件加入。大文件可先登记来源与校验值。</p><div id="reference-files"></div><p id="reference-state" class="helper" role="status"></p>${formActions()}</form>`, true);
  const form = $('form', dialog);
  const collect = () => { const data = new FormData(form); return { ...value, ...Object.fromEntries([...data].filter(([k]) => k !== 'moduleId')), moduleIds: data.getAll('moduleId'), updatedAt: now() }; };
  const persist = async () => { await queueWrite(key, { reference: collect(), assets }); $('#reference-state', form).textContent = '资料草稿已保存到本机'; };
  const draw = () => { $('#reference-files', form).innerHTML = value.files.map(file => `<div class="reference-file"><div><strong>${esc(file.name)}</strong><small>${esc(REFERENCE_ROLES[file.role])} · ${formatSize(file.size)}</small><label class="field">来源位置 / 定位说明<input data-locator="${esc(file.id)}" maxlength="1000" value="${esc(file.locator || '')}" placeholder="例如：第3页、表格行号、函数名"></label></div><button type="button" class="text-button danger" data-remove-file="${esc(file.id)}">移除文件</button></div>`).join(''); };
  draw();
  form.addEventListener('input', event => {
    if (fileBusy || event.target.type === 'file') return;
    if (event.target.dataset.locator) value.files.find(file => file.id === event.target.dataset.locator).locator = event.target.value;
    persist().catch(error => { $('#reference-state', form).textContent = error.message; });
  });
  $('#reference-files', form).onclick = async event => {
    const button = event.target.closest('[data-remove-file]'); if (!button || fileBusy) return;
    const file = value.files.find(file => file.id === button.dataset.removeFile);
    value.files = value.files.filter(item => item !== file); delete assets[file.path]; draw();
    try { await persist(); } catch (error) { $('#reference-state', form).textContent = error.message; }
  };
  $('#reference-input', form).onchange = async event => {
    const input = event.target, role = $('#reference-role', form).value;
    fileBusy = true; modalBusy = true; form.inert = true; form.querySelector('[type="submit"]').disabled = true;
    try {
      for (const file of input.files) {
        if (value.files.length >= 32) throw new Error('每份资料最多32个文件。');
        const prepared = await prepareReferenceFile(file, topic.id, value.id, role);
        if (value.files.some(item => item.sha256 === prepared.file.sha256 && item.role === role)) continue;
        const duplicate = role === 'original' && (topic.references || []).find(ref => ref.id !== value.id && ref.files.some(item => item.role === 'original' && item.sha256 === prepared.file.sha256));
        if (duplicate) throw new Error(`相同原件已收录于「${duplicate.title}」，请编辑已有资料并关联需要的模块。`);
        const allFiles = { ...workspace.files, ...assets, [prepared.file.path]: prepared.content };
        for (const old of existing?.files || []) if (!value.files.some(item => item.path === old.path)) delete allFiles[old.path];
        if (Object.entries(allFiles).filter(([path]) => isReferencePath(path)).reduce((sum, [, data]) => sum + base64Size(data), 0) > 64 * 1024 * 1024) throw new Error('参考文件总量超过64 MB。');
        value.files.push(prepared.file); assets[prepared.file.path] = prepared.content;
        if (!$('[name="title"]', form).value.trim()) $('[name="title"]', form).value = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
        if (role === 'original' && !$('[name="sourceSha256"]', form).value) $('[name="sourceSha256"]', form).value = prepared.file.sha256;
      }
      draw(); await persist();
    } catch (error) { draw(); await persist().catch(() => {}); $('#reference-state', form).textContent = error.message; }
    finally { fileBusy = false; modalBusy = false; form.inert = false; input.value = ''; form.querySelector('[type="submit"]').disabled = false; }
  };
  bindForm(async () => {
    if (fileBusy) throw new Error('请等待文件保存完成。');
    const reference = collect(); reference.title = reference.title.trim();
    const next = clone(workspace), meta = JSON.parse(next.files[topicPath(topic.id)]);
    meta.references = (meta.references || []).filter(ref => ref.id !== reference.id).concat(reference); meta.updatedAt = now();
    for (const old of existing?.files || []) if (!reference.files.some(file => file.path === old.path)) delete next.files[old.path];
    Object.assign(next.files, assets); next.files[topicPath(topic.id)] = encodeTopic(meta); upgradeReferences(next.files);
    await saveWorkspace(next, `保存参考资料「${reference.title}」`);
    await queueWrite(key, null); dialog.close(); activeTab = 'references'; render(); toast('资料已保存到本机，上传后可跨设备读取。');
  });
}
function viewReference(ref) {
  if (!ref) return;
  showDialog(ref.title, `${ref.version || '版本未标注'} · ${PROCESSING[ref.processing]} · ${VERIFICATION[ref.verification]}`, `<div class="reference-detail"><p>${esc(ref.summary)}</p><p>来源：${esc(ref.source || '未填写')}</p>${safeSourceURL(ref.sourceUrl) ? `<p><a href="${esc(safeSourceURL(ref.sourceUrl))}" target="_blank" rel="noopener noreferrer">打开来源网页</a>（链接不等于原件已归档）</p>` : ''}<p class="notice">${ref.files.some(file => file.role === 'original') ? '已附原始文件。' : '本页未附原件；如原件另有归档，请按来源说明取回。当前附件仅包含下列文件。'}</p><p class="reference-note">${esc(ref.limitations)}</p><p class="reference-note">${esc(ref.notes)}</p>${ref.files.map(file => `<div class="reference-file"><div><strong>${esc(file.name)}</strong><small>${esc(REFERENCE_ROLES[file.role])} · ${formatSize(file.size)}${file.locator ? ' · ' + esc(file.locator) : ''}</small><code>${esc(file.path)}</code><small>SHA-256：${esc(file.sha256)}</small></div><div>${file.encoding === 'utf-8' ? `<button class="button outline" data-read-file="${esc(file.id)}">查看文本</button>` : ''}<button class="button outline" data-download-file="${esc(file.id)}">下载</button></div></div>`).join('')}<div class="dialog-actions"><button class="text-button danger" id="delete-reference">删除资料</button><button class="button primary" id="edit-reference">编辑资料</button></div></div>`, true);
  $('#edit-reference', dialog).onclick = () => editReference(ref).catch(error => toast(error.message, true));
  $('#delete-reference', dialog).onclick = () => {
    const topic = currentTopic();
    confirmDelete(`删除「${ref.title}」？`, '将删除此资料及附带文件。关联的设计模块保留；新版本对本记录的关联将解除。', async () => {
      const next = clone(workspace), meta = JSON.parse(next.files[topicPath(topic.id)]);
      meta.references = meta.references.filter(item => item.id !== ref.id).map(item => { if (item.supersedes !== ref.id) return item; const copy = { ...item, updatedAt: now() }; delete copy.supersedes; return copy; });
      meta.updatedAt = now(); next.files[topicPath(topic.id)] = encodeTopic(meta);
      for (const file of ref.files) delete next.files[file.path];
      await saveWorkspace(next, `删除参考资料「${ref.title}」`);
      await queueWrite(`reference-draft:${workspaceKey(config)}:${topic.id}:${ref.id}`, null);
    });
  };
  $('.reference-detail', dialog).onclick = event => {
    const button = event.target.closest('[data-read-file], [data-download-file]'); if (!button) return;
    const file = ref.files.find(item => item.id === (button.dataset.readFile || button.dataset.downloadFile));
    const bytes = referenceBytes(workspace.files[file.path]);
    if (button.dataset.downloadFile) { download(file.name, bytes, 'application/octet-stream'); return; }
    const viewer = document.createElement('dialog'); viewer.className = 'wide';
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), shown = text.slice(0, 200000);
    viewer.innerHTML = `<div class="dialog-head"><h2>${esc(file.name)}</h2><button class="icon-button" aria-label="关闭预览">${icon('close')}</button></div><p class="helper">纯文本预览，不执行文件内容。${shown.length < text.length ? '内容较长，仅显示前200000字符；完整内容请下载。' : ''}</p><pre class="reference-preview">${esc(shown)}</pre>`;
    document.body.append(viewer); $('button', viewer).onclick = () => viewer.close(); viewer.onclose = () => viewer.remove(); viewer.showModal();
  };
}
function modulesView(topic) {
  const filters = [['all', '全部'], ['confirmed', '已确认'], ['exploring', '待探索'], ['rejected', '已放弃']];
  const filtered = topic.modules.filter(module => (statusFilter === 'all' || module.status === statusFilter) && `${module.title} ${module.body} ${module.reason} ${TYPES[module.type]} ${(module.attachments || []).map(item => item.name + ' ' + item.caption).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(module => {
    const used = renderMarkdown(module.body, module.attachments || []).used;
    return { ...module, visibleImages: (module.attachments || []).filter(item => !item.inline || used.has(item.id)) };
  });
  return `<div class="module-toolbar"><div class="filter-row">${filters.map(([value, label]) => `<button class="filter ${statusFilter === value ? 'active' : ''}" data-action="filter" data-id="${value}" aria-pressed="${statusFilter === value}">${label}</button>`).join('')}</div><div class="module-tools"><label class="search">${icon('search')}<input id="module-search" type="search" placeholder="搜索想法…" value="${esc(query)}" aria-label="搜索模块"></label><button class="button primary" data-action="new-module">${icon('plus')} 新增模块</button></div></div>
    <div class="module-grid">${filtered.map(module => `<article class="module-card ${module.status}"><div class="card-meta"><span class="module-kind">${icon(module.type === 'tech' ? 'settings' : module.type === 'art' ? 'leaf' : module.type === 'question' ? 'spark' : 'grid')}${esc(TYPES[module.type])}</span>${badge(module.status)}</div><button class="card-title" data-action="view-module" data-id="${esc(module.id)}"><h2>${esc(module.title)}</h2></button>${module.visibleImages.length ? `<button class="card-image" data-action="view-module" data-id="${esc(module.id)}" aria-label="查看参考图"><img data-image-path="${esc(module.visibleImages[0].path)}" alt="${esc(module.visibleImages[0].caption || module.visibleImages[0].name)}" loading="lazy"><span>${module.visibleImages.length} 张参考图</span></button>` : ''}<p class="card-excerpt">${esc(module.body.replace(/[#*\x60>]/g, '').slice(0, 200) || '还没有正文，继续补充这个想法。')}</p>${module.reason ? `<div class="card-reason"><span>为什么保留</span>${esc(module.reason.slice(0, 100))}</div>` : ''}<div class="card-bottom"><span>${date(module.updatedAt)}</span><button class="icon-button" data-action="edit-module" data-id="${esc(module.id)}" aria-label="编辑${esc(module.title)}">${icon('edit')}</button></div></article>`).join('')}${!query && statusFilter === 'all' ? `<button class="add-card" data-action="new-module"><span>${icon('plus')}</span><strong>留住下一个想法</strong><small>玩法、技术、体验，或者一个好问题</small></button>` : ''}</div>${!filtered.length && (query || statusFilter !== 'all') ? '<div class="empty-filter">没有找到对应模块。试试其他关键词或状态。</div>' : ''}`;
}
function overviewView(topic) {
  return `<div class="overview-layout"><article class="paper"><div class="paper-label">PROJECT BRIEF</div><h2>${esc(topic.title)}</h2><p>${esc(topic.description || '暂无项目描述。')}</p><h3>当前共识</h3>${topic.modules.filter(module => module.status === 'confirmed').map(module => `<button class="overview-item" data-action="view-module" data-id="${esc(module.id)}">${icon('check')}<span>${esc(module.title)}<small>${esc(TYPES[module.type])}</small></span>${icon('arrow')}</button>`).join('') || '<p class="muted">还没有确认的模块。讨论成熟后，将模块标记为「已确认」。</p>'}<h3>下一步可以讨论</h3>${topic.modules.filter(module => module.status === 'exploring').map(module => `<button class="overview-item" data-action="view-module" data-id="${esc(module.id)}">${icon('spark')}<span>${esc(module.title)}<small>${esc(TYPES[module.type])}</small></span>${icon('arrow')}</button>`).join('') || '<p class="muted">暂时没有待探索内容。</p>'}</article><aside class="context-note">${icon('book')}<h3>下一场对话，<br>从这里开始。</h3><p>接续上下文会汇集已确认模块和可选的待探索想法，自动排除废案。</p><button class="button primary" data-action="context">生成上下文 ${icon('arrow')}</button></aside></div>`;
}
function activityView() {
  return `<div class="activity-list"><p class="muted">这里记录此设备的操作；跨设备完整历史保存在 GitHub 提交中。</p>${(workspace.activity || []).map(item => `<div class="activity-item">${icon('clock')}<div>${esc(item.message)}<small>${date(item.at)}</small></div></div>`).join('') || '<p class="empty-filter">创作才刚刚开始。</p>'}${workspace.head && config ? `<a class="button outline" href="https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commit/${encodeURIComponent(workspace.head)}" target="_blank" rel="noopener noreferrer">查看上次同步的提交 ${icon('arrow')}</a>` : ''}</div>`;
}

let modalCleanup;
function showDialog(title, subtitle, content, wide = false) {
  if (dialog.open) { modalCleanup?.(); modalCleanup = null; dialog.close(); }
  dialog.className = wide ? 'wide' : '';
  dialog.innerHTML = `<div class="dialog-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button" data-dialog="close" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body">${content}</div>`;
  dialog.showModal();
  $('[data-dialog="close"]', dialog).onclick = () => { if (!modalBusy) dialog.close(); };
  dialog.querySelectorAll('[data-dialog="cancel"]').forEach(button => button.onclick = () => { if (!modalBusy) dialog.close(); });
}
dialog.addEventListener('cancel', event => { if (modalBusy) event.preventDefault(); });
dialog.addEventListener('close', () => { if (dialog.open) return; modalCleanup?.(); modalCleanup = null; currentDraft = null; });
const formActions = (text = '保存到本机') => `<div class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button subtle" data-dialog="cancel">取消</button><button class="button primary" type="submit">${icon('check')} ${text}</button></div>`;
function bindForm(callback) {
  const form = $('form', dialog);
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    const errorElement = $('.form-error', form);
    if (button.disabled) return;
    const data = new FormData(form);
    button.disabled = true;
    form.inert = true;
    modalBusy = true;
    errorElement.textContent = '';
    try { await callback(data, form); }
    catch (error) { errorElement.textContent = error.message; }
    finally { modalBusy = false; form.inert = false; if (button.isConnected) button.disabled = false; }
  };
}
function parseTags(value) {
  return [...new Set(String(value).split(/[,，]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
}
function editTopic(existing) {
  showDialog(existing ? '编辑主题' : '种下一个新想法', '每个主题，都是一个值得慢慢展开的游戏世界。', `<form><label class="field">主题名称<input name="title" maxlength="200" required autofocus placeholder="例如：回声森林" value="${esc(existing?.title)}"></label><label class="field">一句话描述<textarea name="description" maxlength="4000" rows="3" placeholder="它是一个怎样的游戏？你希望玩家感受到什么？">${esc(existing?.description)}</textarea></label><label class="field">标签 <span class="optional">用逗号分隔</span><input name="tags" placeholder="探索, 解谜, 独立游戏" value="${esc(existing?.tags.join(', '))}"></label>${formActions(existing ? '保存主题' : '创建主题')}</form>`);
  bindForm(async data => {
    const title = data.get('title').trim();
    if (!title) throw new Error('请填写主题名称。');
    const topic = existing ? { ...existing } : newTopic(title);
    delete topic.modules;
    Object.assign(topic, { title, description: data.get('description').trim(), tags: parseTags(data.get('tags')), updatedAt: now() });
    const next = clone(workspace);
    next.files['idea-vault.json'] ||= marker();
    next.files[topicPath(topic.id)] = encodeTopic(topic);
    parseFiles(next.files);
    await saveWorkspace(next, `${existing ? '编辑' : '创建'}主题「${title}」`);
    selected = topic.id; activeTab = 'modules'; statusFilter = 'all'; query = '';
    dialog.close(); render(); toast('主题已保存到本机。');
  });
}
async function editModule(module) {
  const topic = currentTopic();
  if (!topic) return;
  const draftKey = `draft:${workspaceKey(config)}:${topic.id}:${module?.id || 'new'}`;
  const saved = await get(draftKey);
  const draftImagesKey = `${draftKey}:images`;
  const savedImages = saved ? await get(draftImagesKey) : null;
  const value = saved?.module || module || newModule();
  let attachments = clone(value.attachments || []);
  const images = Object.fromEntries(attachments.map(item => [item.path, savedImages?.[item.path] ?? saved?.images?.[item.path] ?? workspace.files[item.path]]));
  let releaseImages = () => {}, imageBusy = false, imageRevision = 0, savedImageRevision = -1;
  showDialog(module ? '编辑创意模块' : '留住一个好想法', `${topic.title} · 编辑草稿自动保存在此设备，保存后才进入正式模块。`, `<form class="module-form">${saved ? '<div class="notice">已恢复上次未完成的编辑草稿。<button type="button" class="text-button" id="discard-draft">丢弃草稿</button></div>' : ''}<label class="field">模块标题<input name="title" required maxlength="200" placeholder="用一句话概括这个想法" value="${esc(value.title)}"></label><div class="field-pair"><label class="field">内容类型<select name="type">${Object.entries(TYPES).map(([key, label]) => `<option value="${key}" ${key === value.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">当前状态<select name="status">${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}" ${key === value.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><section class="body-composer" aria-label="图文正文"><div class="body-toolbar"><span id="body-label">正文</span><div class="body-toolbar-actions"><button type="button" class="text-button" id="toggle-body-source" aria-pressed="false">Markdown 源码</button><button type="button" class="button outline" id="choose-images">${icon('plus')} 插入图片</button></div><input id="image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif" multiple hidden></div><p class="helper">在正文中直接粘贴图片，在图片前后继续写。也可先放好光标，再选择或拖入图片。</p><div id="body-editor" class="visual-body-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="body-label" data-placeholder="写下想法，在需要的位置直接粘贴图片…" spellcheck="true"></div><textarea id="body-source" class="body-editor body-source" rows="14" maxlength="200000" aria-label="Markdown 正文源码" hidden></textarea><p id="image-status" class="helper" role="status" aria-live="polite"></p></section><details class="image-library"><summary>管理图片 <span id="image-count"></span></summary><p class="helper">已有图片可再次插入正文。删除正文中的引用只移除展示位置；点击“删除图片与引用”才会一并删除文件。每模块最多 10 张，原文件 ≤ 20 MB，自动压缩至最长边 2560 像素、≤ 1.5 MB。GIF 保存静态画面。</p><div id="attachment-list" class="attachment-grid"></div></details><label class="field">决策理由 <span class="optional">可选</span><textarea name="reason" rows="2" maxlength="4000" placeholder="为什么采用、仍需探索，或为什么放弃？">${esc(value.reason)}</textarea></label><label class="field">来源 <span class="optional">可选，仅作文字记录</span><input name="source" maxlength="4000" placeholder="例如：与 Codex 讨论 / 某次试玩观察" value="${esc(value.source)}"></label><div class="draft-state" id="draft-state">${saved ? '已恢复本地草稿' : '编辑内容会自动保存为草稿'}</div>${formActions()}</form>`, true);
  const form = $('form', dialog), list = $('#attachment-list', form);
  const editor = $('#body-editor', form);
  const bodyEditor = createBodyEditor({
    element: editor, source: $('#body-source', form), toggle: $('#toggle-body-source', form), value: value.body,
    attachments: () => attachments, images: () => images,
    onChange: () => { if (!imageBusy) form.dispatchEvent(new Event('input')); },
    onError: message => { $('#image-status', form).textContent = message; },
    onPreview: item => previewImage(item, images[item.path])
  });
  const insertImage = item => bodyEditor.insertImage(item);
  const collect = () => {
    const used = renderMarkdown(bodyEditor.value, attachments).used;
    for (const item of attachments) if (used.has(item.id)) item.inline = true;
    return { ...value, ...Object.fromEntries(new FormData(form)), body: bodyEditor.value, attachments: clone(attachments), updatedAt: now() };
  };
  const persistDraft = async () => {
    currentDraft = { module: collect(), at: now() };
    const revision = imageRevision;
    const writes = [[draftKey, currentDraft]];
    if (savedImageRevision < revision) writes.push([draftImagesKey, { ...images }]);
    try {
      await queueRecords(writes);
      savedImageRevision = Math.max(savedImageRevision, revision);
      $('#draft-state', form).textContent = '草稿和参考图已保存在此设备';
    } catch (error) { $('#draft-state', form).textContent = error.message; }
  };
  const drawImages = () => {
    releaseImages();
    $('#image-count', form).textContent = `${attachments.length} / ${MAX_ATTACHMENTS}`;
    list.innerHTML = attachments.map(item => `<article class="attachment-tile"><button type="button" class="attachment-preview" data-preview="${esc(item.id)}" aria-label="放大 ${esc(item.name)}"><img data-image-path="${esc(item.path)}" alt="${esc(item.caption || item.name)}" loading="lazy"></button><div class="attachment-meta"><span title="${esc(item.name)}">${esc(item.name)}</span><small>${item.width} × ${item.height} · ${formatSize(item.size)}</small></div><label class="field">参考说明<textarea data-caption="${esc(item.id)}" rows="2" maxlength="4000" placeholder="例如：参考配色，保留轮廓，不采用人物造型">${esc(item.caption)}</textarea></label><div class="image-library-actions"><button type="button" class="button outline" data-insert="${esc(item.id)}">插入正文</button><button type="button" class="text-button danger" data-remove="${esc(item.id)}">${icon('trash')} 删除图片与引用</button></div></article>`).join('');
    releaseImages = mountImages(list, images);
  };
  modalCleanup = () => {
    releaseImages(); bodyEditor.destroy();
  };
  drawImages();
  form.addEventListener('input', event => {
    if (event.target.dataset.caption) {
      const item = attachments.find(item => item.id === event.target.dataset.caption);
      if (item) item.caption = event.target.value;
    }
    $('#draft-state', form).textContent = '正在保存草稿…';
    persistDraft();
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || imageBusy) return;
    const item = attachments.find(item => item.id === (button.dataset.preview || button.dataset.remove || button.dataset.insert));
    if (!item) return;
    if (button.dataset.preview) previewImage(item, images[item.path]);
    else if (button.dataset.insert) {
      try { insertImage(item); bodyEditor.focus(); await persistDraft(); }
      catch (error) { $('#image-status', form).textContent = error.message; }
    } else {
      attachments = attachments.filter(candidate => candidate.id !== item.id);
      delete images[item.path];
      bodyEditor.forgetImage(item, removeImageReferences);
      imageRevision++;
      drawImages(); await persistDraft();
    }
  });
  const addImages = async candidates => {
    if (imageBusy || !candidates.length) return;
    imageBusy = true; modalBusy = true; form.inert = true;
    const submit = $('button[type="submit"]', form); submit.disabled = true;
    const status = $('#image-status', form), errors = [];
    let added = 0;
    try {
      for (const file of candidates) {
        if (attachments.length >= MAX_ATTACHMENTS) { errors.push('每个模块最多 10 张参考图，其余图片未添加。'); break; }
        status.textContent = `正在处理 ${file.name || '粘贴的图片'}…`;
        try {
          const result = await prepareImage(file, topic.id, value.id);
          const otherBytes = Object.entries(workspace.files).filter(([path]) => isImagePath(path) && !path.startsWith(`ideas/${topic.id}/images/${value.id}/`)).reduce((total, [, bytes]) => total + base64Size(bytes), 0);
          if (otherBytes + attachments.reduce((total, item) => total + item.size, 0) + result.attachment.size > MAX_TOTAL_IMAGE_BYTES) throw new Error('当前资料库图片总量将超过 40 MB，请删除不需要的参考图或拆分资料库。');
          // Build the body insertion before saving either the reference or the binary draft.
          attachments.push(result.attachment); images[result.attachment.path] = result.content;
          try { insertImage(result.attachment); }
          catch (error) { attachments.pop(); delete images[result.attachment.path]; throw error; }
          added++;
          imageRevision++;
          await persistDraft();
        } catch (error) { errors.push(`${file.name || '图片'}：${error.message}`); }
      }
      drawImages();
      status.textContent = [`已在正文插入 ${added} 张图片。`, ...errors].join(' ');
    } catch (error) { status.textContent = error.message; }
    finally { imageBusy = false; modalBusy = false; form.inert = false; submit.disabled = false; if (added) bodyEditor.focus(); }
  };
  const input = $('#image-input', form), drop = $('.body-composer', form);
  $('#choose-images', form).onclick = () => input.click();
  input.onchange = () => { const files = [...input.files]; input.value = ''; addImages(files); };
  form.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); bodyEditor.remember(); addImages(files); }
  });
  form.addEventListener('dragover', event => {
    if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); drop.classList.add('drag-over'); }
  });
  form.addEventListener('dragleave', event => { if (!form.contains(event.relatedTarget)) drop.classList.remove('drag-over'); });
  form.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault(); drop.classList.remove('drag-over'); addImages([...event.dataTransfer.files]);
  });
  $('#discard-draft', form)?.addEventListener('click', async () => {
    try { await queueRecords([[draftKey, null], [draftImagesKey, null]]); dialog.close(); await editModule(module); }
    catch (error) { toast(error.message, true); }
  });
  bindForm(async () => {
    const result = collect();
    result.title = result.title.trim();
    if (!result.title) throw new Error('请填写模块标题。');
    const next = clone(workspace);
    for (const path of Object.keys(next.files)) if (path.startsWith(`ideas/${topic.id}/images/${result.id}/`)) delete next.files[path];
    for (const item of attachments) next.files[item.path] = images[item.path];
    if (attachments.length) upgradeImages(next.files);
    next.files[modulePath(topic.id, result.id)] = encodeModule(result);
    const meta = JSON.parse(next.files[topicPath(topic.id)]);
    meta.updatedAt = now();
    next.files[topicPath(topic.id)] = encodeTopic(meta);
    await saveWorkspace(next, `${module ? '更新' : '新增'}模块「${result.title}」`);
    await queueRecords([[draftKey, null], [draftImagesKey, null]]);
    dialog.close(); render(); toast('模块与参考图已保存。上传后，其他设备才能读取。');
  });
}
function viewModule(module) {
  const attachments = module.attachments || [];
  const body = renderMarkdown(module.body || '暂无正文。', attachments);
  const unplaced = attachments.filter(item => !item.inline && !body.used.has(item.id));
  showDialog(module.title, `${TYPES[module.type]} · 更新于 ${date(module.updatedAt)}`, `<div class="module-detail">${badge(module.status)}<div class="markdown">${body.html}</div>${unplaced.length ? `<section class="attachment-section"><h3>其他参考图片 <small>${unplaced.length} 张</small></h3><div class="attachment-grid">${unplaced.map(item => `<figure class="attachment-tile"><button type="button" class="attachment-preview" data-preview="${esc(item.id)}" aria-label="放大 ${esc(item.name)}"><img data-image-path="${esc(item.path)}" alt="${esc(item.caption || item.name)}" loading="lazy"></button><figcaption><strong>${esc(item.name)}</strong>${item.caption ? `<p>${esc(item.caption)}</p>` : ''}<small>${item.width} × ${item.height} · ${formatSize(item.size)} · 点击放大或下载</small></figcaption></figure>`).join('')}</div></section>` : ''}${module.reason ? `<div class="reason-panel"><strong>决策理由</strong><p>${esc(module.reason)}</p></div>` : ''}${module.source ? `<p class="source-line">来源：${esc(module.source)}</p>` : ''}<div class="dialog-actions spread"><button id="remove-module" class="text-button danger">${icon('trash')} 删除模块</button><button id="edit-module" class="button primary">${icon('edit')} 编辑模块</button></div></div>`, true);
  modalCleanup = mountImages(dialog, workspace.files);
  dialog.querySelectorAll('[data-preview]').forEach(button => button.onclick = () => {
    const item = attachments.find(item => item.id === button.dataset.preview);
    previewImage(item, workspace.files[item.path]);
  });
  $('#edit-module', dialog).onclick = () => editModule(module).catch(error => toast(error.message, true));
  $('#remove-module', dialog).onclick = () => deleteModule(module);
}
function confirmDelete(title, description, callback) {
  showDialog(title, description, `<form><p class="notice">删除先保存在本机，上传后会同步到 GitHub。已上传的旧内容仍可能在 Git 历史中保留。</p><label class="check-field"><input name="confirmed" type="checkbox" required> 我确认删除上述内容</label>${formActions('确认删除')}</form>`);
  bindForm(async () => { await callback(); dialog.close(); render(); toast('已删除，等待上传同步。'); });
}
function deleteModule(module) {
  const topic = currentTopic();
  confirmDelete(`删除「${module.title}」？`, '删除这个模块及其参考图片，主题中的其他内容会保留。', async () => {
    const next = clone(workspace);
    delete next.files[modulePath(topic.id, module.id)];
    for (const path of Object.keys(next.files)) if (path.startsWith(`ideas/${topic.id}/images/${module.id}/`)) delete next.files[path];
    const meta = JSON.parse(next.files[topicPath(topic.id)]); meta.updatedAt = now();
    if (meta.references) meta.references = meta.references.map(ref => ref.moduleIds.includes(module.id) ? { ...ref, moduleIds: ref.moduleIds.filter(mid => mid !== module.id), updatedAt: now() } : ref);
    next.files[topicPath(topic.id)] = encodeTopic(meta);
    await saveWorkspace(next, `删除模块「${module.title}」`);
  });
}
function deleteTopic() {
  const topic = currentTopic();
  confirmDelete(`删除主题「${topic.title}」？`, `同时删除其中 ${topic.modules.length} 个模块及全部参考资料和文件。`, async () => {
    const next = clone(workspace);
    for (const path of Object.keys(next.files)) if (path.startsWith(`ideas/${topic.id}/`)) delete next.files[path];
    await saveWorkspace(next, `删除主题「${topic.title}」`);
  });
}
function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制。'); }
  catch { toast('浏览器未允许复制。请选中文字手动复制或下载文件。', true); }
}
function pluginConnectionControls(parent) {
  const section = document.createElement('section');
  section.innerHTML = `<h3>与拾念插件共用配置</h3><p class="helper">使用已保存的仓库设置：${config ? esc(config.owner + '/' + config.repo + ' · ' + config.branch) : '尚未配置'}。共享后，插件可通过同一个 GitHub 账号找回仓库。只向该仓库保存账号编号、仓库和分支，不上传令牌或创意。</p><div class="dialog-actions"><button type="button" class="button outline" data-share-connection>共享 / 更新仓库配置</button><button type="button" class="button outline" data-copy-connection>复制首次配置说明</button></div><p class="helper" data-connection-result role="status">请先保存上方设置，再共享。ChatGPT 仍需单独连接 GitHub；更换仓库或分支后需再次共享。</p>`;
  parent.append(section);
  $('[data-copy-connection]', section).onclick = () => {
    if (!config) { toast('请先保存资料仓库设置。', true); return; }
    copy(`拾念，请配置并记住资料仓库 ${config.owner}/${config.repo}，资料分支 ${config.branch}。请先核对 GitHub 连接，并保存设置供下次使用；只保存连接配置，不修改游戏创意。`);
  };
  $('[data-share-connection]', section).onclick = async () => {
    if (modalBusy || busy) return;
    if (!config || !token) { toast('请先在同步设置中保存仓库和访问令牌。', true); return; }
    const body = $('.dialog-body', dialog), result = $('[data-connection-result]', section);
    modalBusy = true; body.inert = true;
    result.textContent = '正在保存连接配置…';
    try {
      const saved = await sharePluginConnection(new GitHub({ ...config }, token));
      result.textContent = `已共享 ${saved.document.repository} · ${saved.document.branch}。在 ChatGPT 选择拾念，说“打开我的创意库”即可。此操作未上传本机创意。`;
    } catch (error) { result.textContent = `${error.message} 连接配置尚未确认保存；主题和草稿未受影响。`; }
    finally { modalBusy = false; body.inert = false; }
  };
}
function showContext() {
  const topic = currentTopic();
  showDialog('带着共识，继续聊', '包含已确认、可选的待探索内容和参考资料索引。索引不是文件全文；AI需按路径另行读取，或由你下载文件上传到对话。', `<label class="check-field"><input id="include-exploring" type="checkbox" checked> 包含待探索想法</label><textarea id="context-output" class="context-output" rows="16" readonly aria-label="接续上下文"></textarea><div class="dialog-actions"><button class="button outline" id="download-context">${icon('down')} 下载 Markdown</button><button class="button primary" id="copy-context">${icon('copy')} 复制上下文</button></div>`, true);
  const update = () => $('#context-output', dialog).value = contextText(topic, $('#include-exploring', dialog).checked);
  update(); $('#include-exploring', dialog).onchange = update;
  $('#copy-context', dialog).onclick = () => copy($('#context-output', dialog).value);
  $('#download-context', dialog).onclick = () => download(`${topic.title.replace(/[/\\:*?"<>|]/g, '_')}-上下文.md`, $('#context-output', dialog).value);
}

function settings() {
  showDialog('连接你的 GitHub 资料库', '资料保存在私有仓库。应用直接连接 GitHub，不经过自建服务器。', `<form><div class="notice">先在 GitHub 创建一个私有仓库，勾选「添加 README」。创建仅授权该仓库的细粒度令牌，给予 Contents 读写权限。<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">前往 GitHub 创建令牌 ↗</a></div><div class="field-pair"><label class="field">仓库所有者<input name="owner" value="${esc(config?.owner)}" placeholder="your-name" required pattern="[a-zA-Z0-9-]+" autocomplete="off"></label><label class="field">仓库名称<input name="repo" value="${esc(config?.repo)}" placeholder="game-ideas" required pattern="[a-zA-Z0-9_.-]+" autocomplete="off"></label></div><label class="field">分支<input name="branch" value="${esc(config?.branch || 'main')}" required autocomplete="off"></label><label class="field">GitHub 访问令牌<input id="github-token" name="token" type="password" placeholder="github_pat_…" required autocomplete="off" spellcheck="false"></label><p class="helper">保存后会在此设备长期记住登录，刷新或重启浏览器无需重填。凭据只保存在当前浏览器，不会上传或进入备份。令牌过期、被撤销，或浏览器站点数据被清除时需要重新连接。</p>${!config && Object.keys(workspace.files).length ? '<label class="check-field"><input name="carry" type="checkbox" checked> 首次连接此仓库时带上当前本地资料（原本地副本仍保留）</label>' : ''}<div class="form-error" role="alert"></div><div class="dialog-actions spread">${config ? '<button type="button" class="text-button" id="disconnect">切回本地空间</button>' : '<span></span>'}<button type="submit" class="button primary">保存并记住登录</button></div></form><div class="dialog-actions"><button type="button" class="text-button danger" id="clear-login">清除此设备全部登录</button></div>`);
  $('#github-token', dialog).value = token;
  const connectionForm = $('form', dialog);
  const tokenInput = $('#github-token', dialog);
  let credentialRevision = 0;
  tokenInput.addEventListener('input', () => { credentialRevision++; });
  const restoreCredential = async () => {
    const revision = ++credentialRevision;
    tokenInput.value = '';
    const fields = new FormData(connectionForm);
    try {
      const savedToken = await getCredential({ owner: fields.get('owner').trim(), repo: fields.get('repo').trim() });
      if (revision === credentialRevision && tokenInput.isConnected && !modalBusy) tokenInput.value = savedToken;
    } catch (error) { if (revision === credentialRevision && tokenInput.isConnected) toast(error.message, true); }
  };
  for (const name of ['owner', 'repo']) connectionForm.elements.namedItem(name).addEventListener('input', restoreCredential);
  pluginConnectionControls($('.dialog-body', dialog));
  $('#clear-login', dialog).onclick = async () => {
    if (modalBusy) return;
    modalBusy = true;
    const body = $('.dialog-body', dialog);
    body.inert = true;
    credentialRevision++;
    try {
      await saveQueue.catch(() => {});
      await clearCredentials();
      token = '';
      tokenInput.value = '';
      try { sessionStorage.removeItem('shinian-token'); } catch { /* The migration tombstone blocks reuse. */ }
      render();
      toast('此设备保存的全部登录已清除。主题、草稿和仓库设置保留。');
    } catch (error) { toast(error.message, true); }
    finally { body.inert = false; modalBusy = false; }
  };
  bindForm(async data => {
    const nextConfig = { owner: data.get('owner').trim(), repo: data.get('repo').trim(), branch: data.get('branch').trim() };
    if (!/^[a-zA-Z0-9-]+$/.test(nextConfig.owner) || !/^[a-zA-Z0-9_.-]+$/.test(nextConfig.repo) || ['.', '..'].includes(nextConfig.repo)) throw new Error('仓库所有者或名称格式不正确。');
    if (!nextConfig.branch || /[\s~^:?*\[\\]/.test(nextConfig.branch) || nextConfig.branch.includes('..') || nextConfig.branch.includes('@{') || nextConfig.branch.startsWith('/') || nextConfig.branch.endsWith('/') || nextConfig.branch.endsWith('.') || nextConfig.branch.includes('//') || nextConfig.branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) throw new Error('分支名称格式不正确。');
    const nextToken = data.get('token').trim();
    if (!nextToken || /\s/.test(nextToken)) throw new Error('请填写完整的访问令牌。');
    const key = workspaceKey(nextConfig);
    let saved = await get(key);
    if (!saved) {
      saved = emptyWorkspace();
      if (data.has('carry')) saved.files = clone(workspace.files);
      await queueWrite(key, saved);
    }
    parseFiles(saved.files);
    await saveQueue.catch(() => {});
    await saveConnection(nextConfig, nextToken);
    try { sessionStorage.removeItem('shinian-token'); } catch { /* Legacy sessions are retired in IndexedDB. */ }
    // Best-effort request to reduce automatic eviction; it is not a durability guarantee.
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* Login is saved even if persistence is unavailable. */ }
    config = nextConfig; token = nextToken; workspace = saved; selected = null;
    dialog.close(); render(); toast('登录已保存在此设备。点击「拉取」读取远端资料。');
  });
  $('#disconnect', dialog)?.addEventListener('click', async () => {
    if (modalBusy) return;
    modalBusy = true;
    const body = $('.dialog-body', dialog);
    body.inert = true;
    credentialRevision++;
    try {
      const local = await get('local') || emptyWorkspace();
      await queueWrite('config', null);
      config = null; token = ''; workspace = local; selected = null;
      try { sessionStorage.removeItem('shinian-token'); } catch { /* optional storage */ }
      dialog.close(); render(); toast('已切回本地空间。登录与仓库草稿仍保留，再次填写仓库名即可恢复。');
    } catch (error) { toast(error.message, true); }
    finally { body.inert = false; modalBusy = false; }
  });
}
function resolveConflicts(result) {
  return new Promise(resolve => {
    let settled = false;
    const label = files => {
      const meta = Object.entries(files).find(([path]) => path.endsWith('/topic.json'));
      return meta ? JSON.parse(meta[1]).title : files['idea-vault.json'] ? '资料库标记' : '已删除 / 不存在';
    };
    showDialog('有些想法，需要你来选择', '同一主题在两端都有修改。选择保留的版本；取消不会改变本地资料。', `<form><p class="notice">冲突按整个主题处理，包括主题信息与全部模块。可先下载两端副本，再决定保留哪一版。</p>${result.conflicts.map(conflict => `<fieldset class="conflict"><legend>${esc(label(conflict.local) !== '已删除 / 不存在' ? label(conflict.local) : label(conflict.remote))}</legend><div class="conflict-options">${[['local', '保留本机'], ['remote', '采用 GitHub']].map(([side, title]) => `<label><input type="radio" name="${esc(conflict.key)}" value="${side}" required><strong>${title}</strong><small>${esc(label(conflict[side]))}</small><details><summary>查看该版本完整资料</summary><pre>${esc(Object.entries(conflict[side]).map(([path, content]) => `${path}\n${(isImagePath(path) || isReferencePath(path)) ? `[附件 ${formatSize(base64Size(content))}，完整数据包含在冲突副本中]` : content}`).join('\n\n') || '此版本已删除整个主题。')}</pre></details></label>`).join('')}</div></fieldset>`).join('')}<button type="button" class="button outline" id="export-conflicts">${icon('down')} 下载冲突副本</button>${formActions('应用所选版本')}</form>`, true);
    $('#export-conflicts', dialog).onclick = () => download(`拾念-冲突-${Date.now()}.json`, JSON.stringify(result.conflicts, null, 2), 'application/json');
    modalCleanup = () => { if (!settled) resolve(null); };
    bindForm(async data => {
      const files = resolveMerge(result, Object.fromEntries(data));
      settled = true; dialog.close(); resolve(files);
    });
  });
}
async function sync(upload) {
  if (busy) return;
  if (!config || !token) { settings(); return; }
  if (!navigator.onLine) { toast('当前离线。恢复网络后再同步。', true); return; }
  busy = true; render();
  let stage = 'read';
  try {
    const client = new GitHub(config, token);
    const remote = await client.snapshot();
    const result = mergeFiles(workspace.base, workspace.files, remote.files);
    const merged = result.conflicts.length ? await resolveConflicts(result) : result.merged;
    if (!merged) return;
    if (Object.keys(merged).some(isImagePath)) upgradeImages(merged);
    if (Object.keys(merged).some(isReferencePath) || Object.entries(merged).some(([path, text]) => path.endsWith('/topic.json') && JSON.parse(text).references?.length)) upgradeReferences(merged);
    parseFiles(merged);
    let next = clone(workspace);
    next.files = merged; next.base = remote.files; next.head = remote.head; next.syncedAt = now();
    await saveWorkspace(next, '拉取 GitHub 最新资料并合并本地草稿');
    if (upload && changedPaths(remote.files, merged).length) {
      stage = 'write';
      const count = changedPaths(remote.files, merged).length;
      const head = await client.push(remote, merged, `拾念：同步 ${count} 个资料文件`);
      stage = 'saved-remotely';
      next = clone(workspace); next.base = clone(merged); next.head = head; next.syncedAt = now();
      await saveWorkspace(next, `上传 ${count} 个文件至 GitHub · ${head.slice(0, 7)}`);
      toast('已上传，其他设备和 AI 可以读取最新资料。');
    } else toast(upload ? '已是最新状态，没有需要上传的修改。' : '已拉取最新资料，本地未上传修改已保留。');
  } catch (error) {
    persistentError = stage === 'saved-remotely' ? 'GitHub 已保存成功，但本机状态保存失败。请重新拉取后继续。' : `${error.message}${stage === 'write' ? ' 如请求中断，请重新拉取确认提交是否已生效。' : ''}`;
    toast(persistentError, true);
  } finally { busy = false; render(); }
}
function backups() {
  showDialog('给灵感留一份副本', '备份包含当前空间的正式模块、参考图片和参考资料文件，不包含令牌。未保存的编辑草稿请先保存。', `<div class="backup-actions"><button class="button outline" id="export-backup">${icon('down')} 导出当前资料备份</button><label class="field">导入拾念备份<input id="import-file" type="file" accept="application/json,.json"></label><p class="helper">导入会显示主题数量供确认，再替换此空间的本地资料。上传之前不会修改 GitHub；原本机资料会自动留存一份恢复副本。</p><button class="text-button" id="recover-import">下载最近一次导入前的恢复副本</button><div class="form-error" role="alert"></div></div>`);
  const backup = files => JSON.stringify({ app: 'idea-vault-backup', schemaVersion: JSON.parse(files['idea-vault.json'] || '{"schemaVersion":1}').schemaVersion, exportedAt: now(), files }, null, 2);
  $('#export-backup', dialog).onclick = () => download(`拾念-备份-${new Date().toISOString().slice(0, 10)}.json`, backup(workspace.files), 'application/json');
  $('#recover-import', dialog).onclick = async () => {
    const saved = await get(`recovery:${workspaceKey(config)}`);
    if (!saved) { toast('还没有导入前恢复副本。'); return; }
    download('拾念-导入前恢复副本.json', JSON.stringify({ app: 'idea-vault-backup', schemaVersion: JSON.parse(saved.files['idea-vault.json'] || '{"schemaVersion":1}').schemaVersion, exportedAt: now(), files: saved.files }, null, 2), 'application/json');
  };
  $('#import-file', dialog).onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 256 * 1024 * 1024) throw new Error('备份超过 256 MB，请拆分资料库。');
      const data = JSON.parse(await file.text());
      if (data.app !== 'idea-vault-backup' || ![1, 2, 3].includes(data.schemaVersion)) throw new Error('不是受支持的拾念备份。');
      const incoming = parseFiles(data.files);
      await verifyReferenceHashes(data.files);
      showDialog('导入这份资料？', `含 ${incoming.length} 个主题、${incoming.reduce((total, topic) => total + topic.modules.length, 0)} 个模块、${Object.keys(data.files).filter(isImagePath).length} 张参考图、${incoming.reduce((n, topic) => n + (topic.references || []).length, 0)} 份参考资料。`, `<form><p class="notice">导入会替换当前空间的本地资料，并保留当前 GitHub 同步基线。被替换的远端内容可能在下次上传时删除，请先确认备份内容。</p><label class="check-field"><input type="checkbox" required> 确认以备份替换当前本地资料</label>${formActions('导入备份')}</form>`);
      bindForm(async () => {
        await queueWrite(`recovery:${workspaceKey(config)}`, workspace);
        const next = clone(workspace); next.files = data.files;
        await saveWorkspace(next, `导入备份：${incoming.length} 个主题`);
        selected = null; dialog.close(); render(); toast('资料已导入本机。');
      });
    } catch (error) { $('.form-error', dialog).textContent = error.message; }
  };
}
function guide() {
  showDialog('把对话，接进你的创意空间', 'ChatGPT 与 Codex 共用资料，聊天记录留在各自的平台。', `<div class="guide"><article><span class="step">01 / PLUGIN</span><h3>安装拾念插件</h3><p>下载插件包，在 ChatGPT「插件 → 添加 → 上传插件压缩包」导入，连接 GitHub。账号内可用的云端插件可在电脑和手机调用；本机 Skill 不会自动变成手机插件。</p><a class="button outline" href="./integrations/shinian-plugin.zip" download="拾念插件.zip">下载拾念插件</a></article><article><span class="step">02 / CONNECT</span><h3>配置一次，随时接续</h3><p>先在「同步设置」保存资料仓库，再点下方「共享 / 更新仓库配置」。插件按 GitHub 账号读取云端配置，不需重复粘贴链接。没有 Web 配置时，也可以在插件中首次指定仓库和分支并要求记住。</p><blockquote>“拾念，打开我的创意库。继续讨论回声森林。”</blockquote></article><article><span class="step">03 / SAVE</span><h3>先讨论，再保存共识</h3><p>说“整理本次讨论”先看摘要，再说“保存已确认内容”。AI 保存成功后在这里点「拉取」；在这里编辑后点「上传」。本机草稿不会自动进入 GitHub。</p></article><p class="helper">普通聊天也可以通过主题右上角「接续上下文」复制 Markdown。下面的 GPT Actions 文件仅用于具备 Actions 入口的账号。</p>${installPrompt ? '<button class="button primary" id="install-app">安装到此设备</button>' : '<p class="helper">手机可通过浏览器菜单添加到主屏幕。</p>'}</div>`, true);
  pluginConnectionControls($('.guide', dialog));
  $('#install-app', dialog)?.addEventListener('click', async () => { await installPrompt.prompt(); installPrompt = null; dialog.close(); });
  const exports = document.createElement('div');
  exports.className = 'dialog-actions';
  exports.innerHTML = '<button class="button outline" id="gpt-instructions">下载 GPT 指令</button><button class="button primary" id="gpt-schema">下载本仓库 Actions 配置</button>';
  $('.guide', dialog).append(exports);
  $('#gpt-instructions', dialog).onclick = async () => {
    try {
      const response = await fetch('./integrations/chatgpt-instructions.md');
      if (!response.ok) throw new Error('无法读取 GPT 指令，请恢复网络后重试。');
      download('拾念-GPT指令.md', await response.text());
    } catch (error) { toast(error.message, true); }
  };
  $('#gpt-schema', dialog).onclick = async () => {
    if (!config) { toast('请先在「同步设置」填写资料仓库，再下载专属配置。', true); return; }
    try {
      const response = await fetch('./integrations/chatgpt-openapi.template.json');
      if (!response.ok) throw new Error('无法读取 Actions 模板，请恢复网络后重试。');
      const schema = await response.json();
      schema.servers = [{ url: `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}` }];
      const branch = config.branch.split('/').map(encodeURIComponent).join('/');
      schema.paths = Object.fromEntries(Object.entries(schema.paths).map(([path, operation]) => [path.replace('VAULT_BRANCH', branch), operation]));
      download('拾念-GPT-Actions.json', JSON.stringify(schema, null, 2), 'application/json');
      toast('已生成本仓库配置，不含访问令牌。');
    } catch (error) { toast(error.message, true); }
  };
}
async function loadSample() {
  const topic = newTopic('回声森林', '一款让森林记住玩家选择的轻量探索解谜游戏。每一次改变，都会在下一次归来时留下回声。', ['探索解谜', '轻量叙事', '示例']);
  const next = clone(workspace); next.files['idea-vault.json'] ||= marker(); next.files[topicPath(topic.id)] = encodeTopic(topic);
  const samples = [
    ['让环境回应玩家的选择', 'gameplay', 'confirmed', '玩家通过声音唤醒森林中的机关。每次使用声音，都会改变附近植物的生长状态。\n\n- 观察环境 → 尝试发声 → 发现变化 → 打开新路径\n- 第一段体验只引入一种声音和一种植物\n- 不加入战斗，以探索与观察作为主要乐趣', '用可见的环境变化建立反馈，避免一开始堆叠系统。'],
    ['森林是否需要长期记忆？', 'question', 'exploring', '希望玩家再次进入区域时，能看到自己曾经留下的改变。\n\n需要讨论：\n- 记住每棵植物，还是只记住关键事件？\n- 记忆是否会影响后续谜题？\n- 如何避免永久选择导致卡关？', '先确认设计价值，再决定存档粒度。'],
    ['用事件状态驱动场景变化', 'tech', 'exploring', '用稳定的事件 ID 记录关键选择。场景进入时根据事件状态恢复机关与植物表现。\n\n先做一个独立场景原型，验证探索节奏，再确定完整技术栈。', '技术实现应服务于已确认的玩法。']
  ];
  for (const [title, type, status, body, reason] of samples) {
    const module = { ...newModule(title, type, status), body, reason, source: '拾念内置示例，可自由修改或删除' };
    next.files[modulePath(topic.id, module.id)] = encodeModule(module);
  }
  await saveWorkspace(next, '载入示例主题「回声森林」'); selected = topic.id; render(); toast('示例已载入本机。可以自由编辑或删除。');
}
app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault();
  const action = target.dataset.action, value = target.dataset.id;
  if (busy && action !== 'menu') return;
  try {
    switch (action) {
      case 'home': activeTab = 'modules'; render(); break;
      case 'menu': sidebarOpen = !sidebarOpen; render(); break;
      case 'new-topic': editTopic(); break;
      case 'edit-topic': editTopic(currentTopic()); break;
      case 'select': selected = value; activeTab = 'modules'; query = ''; statusFilter = 'all'; sidebarOpen = false; render(); break;
      case 'tab': activeTab = value; query = ''; render(); break;
      case 'filter': statusFilter = value; render(); break;
      case 'new-reference': await editReference(); break;
      case 'edit-reference': await editReference(currentTopic().references.find(ref => ref.id === value)); break;
      case 'view-reference': viewReference(currentTopic().references.find(ref => ref.id === value)); break;
      case 'new-module': await editModule(); break;
      case 'edit-module': await editModule(currentTopic().modules.find(module => module.id === value)); break;
      case 'view-module': viewModule(currentTopic().modules.find(module => module.id === value)); break;
      case 'delete-topic': deleteTopic(); break;
      case 'context': showContext(); break;
      case 'settings': settings(); break;
      case 'pull': await sync(false); break;
      case 'push': await sync(true); break;
      case 'backup': backups(); break;
      case 'guide': guide(); break;
      case 'sample': await loadSample(); break;
    }
  } catch (error) { toast(error.message, true); }
});
function onSearch(event) {
  if (!['module-search', 'reference-search'].includes(event.target.id) || event.isComposing) return;
  const searchID = event.target.id;
  const start = event.target.selectionStart;
  query = event.target.value; render();
  const input = $('#' + searchID); input.focus();
  try { input.setSelectionRange(start, start); } catch { /* type=search may not support selection */ }
}
app.addEventListener('input', onSearch);
app.addEventListener('compositionend', onSearch);
window.addEventListener('online', () => { if (workspace) render(); });
window.addEventListener('offline', () => { if (workspace) render(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k' && !dialog.open) { event.preventDefault(); $('#module-search')?.focus(); }
});
async function start() {
  try {
    config = await get('config') || null;
    workspace = await get(workspaceKey(config)) || emptyWorkspace();
    parseFiles(workspace.files); parseFiles(workspace.base);
    token = await getCredential(config);
    if (!token && config && !await get('auth:legacy-retired')) {
      let legacy;
      try { legacy = JSON.parse(sessionStorage.getItem('shinian-token') || 'null'); } catch { /* No readable legacy session. */ }
      if (legacy?.key === workspaceKey(config) && typeof legacy.token === 'string' && legacy.token.trim()) {
        await saveConnection(config, legacy.token.trim());
        token = legacy.token.trim();
      }
    }
    try { sessionStorage.removeItem('shinian-token'); } catch { /* Optional cleanup of legacy storage. */ }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(() => toast('离线缓存未能启用，在线使用不受影响。', true));
  } catch (error) {
    app.innerHTML = `<div class="fatal"><h1>暂时无法打开资料</h1><p>${esc(error.message)}</p><p>请不要清除浏览器数据。可以先导出原始本地记录用于恢复。</p><button class="button outline" id="raw-recovery">导出原始记录</button></div>`;
    $('#raw-recovery').onclick = async () => { const raw = await get(workspaceKey(config)); download('拾念-原始恢复记录.json', JSON.stringify(raw, null, 2), 'application/json'); };
  }
}
// One active editor per origin avoids two local tabs overwriting IndexedDB snapshots.
if (navigator.locks) {
  navigator.locks.request('shinian-active-editor', { ifAvailable: true }, async lock => {
    if (!lock) {
      app.innerHTML = '<div class="fatal"><h1>拾念已在另一个窗口打开</h1><p>为保护本地草稿，请在已有窗口继续；关闭那个窗口后刷新此页。</p><button class="button primary" id="reload-app">重新打开</button></div>';
      $('#reload-app').onclick = () => location.reload(); return;
    }
    await start(); await new Promise(() => {});
  });
} else {
  app.innerHTML = '<div class="fatal"><h1>请使用支持安全存储的现代浏览器</h1><p>通过 HTTPS 或 localhost 打开拾念，并更新 Safari、Chrome、Edge 或 Firefox 后重试。</p></div>';
}
