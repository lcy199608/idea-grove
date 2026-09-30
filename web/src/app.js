import { TYPES, STATUSES, id, now, clone, marker, upgradeImages, newTopic, newModule, topicPath, modulePath, encodeTopic, encodeModule, parseFiles, changedPaths, mergeFiles, resolveMerge, contextText } from './model.js';
import { get, setRecords, emptyWorkspace, workspaceKey, getCredential, saveConnection, clearCredentials } from './storage.js';
import { GitHub } from './github.js';
import { isImagePath, imageBlob, imageFileName, prepareImage, formatSize, base64Size, MAX_ATTACHMENTS, MAX_TOTAL_IMAGE_BYTES } from './images.js';
import { imageMarkdown, renderMarkdown, removeImageReferences } from './markdown.js';

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
    <div class="tabs-row"><div class="tabs" role="tablist" aria-label="主题视图">${[['modules', 'grid', '创意模块'], ['overview', 'book', '项目概览'], ['activity', 'clock', '本机动态']].map(([tab, symbol, label]) => `<button role="tab" aria-selected="${activeTab === tab}" class="tab ${activeTab === tab ? 'active' : ''}" data-action="tab" data-id="${tab}">${icon(symbol)} ${label}</button>`).join('')}</div><button class="text-button danger" data-action="delete-topic">${icon('trash')} 删除主题</button></div>
    <section role="tabpanel">${activeTab === 'modules' ? modulesView(topic) : activeTab === 'overview' ? overviewView(topic) : activityView()}</section>`;
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
  showDialog(module ? '编辑创意模块' : '留住一个好想法', `${topic.title} · 编辑草稿自动保存在此设备，保存后才进入正式模块。`, `<form class="module-form">${saved ? '<div class="notice">已恢复上次未完成的编辑草稿。<button type="button" class="text-button" id="discard-draft">丢弃草稿</button></div>' : ''}<label class="field">模块标题<input name="title" required maxlength="200" placeholder="用一句话概括这个想法" value="${esc(value.title)}"></label><div class="field-pair"><label class="field">内容类型<select name="type">${Object.entries(TYPES).map(([key, label]) => `<option value="${key}" ${key === value.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">当前状态<select name="status">${Object.entries(STATUSES).map(([key, label]) => `<option value="${key}" ${key === value.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><section class="body-composer" aria-label="图文正文"><div class="body-toolbar"><label for="body-editor">正文</label><button type="button" class="button outline" id="choose-images">${icon('plus')} 插入图片</button><input id="image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif" multiple hidden></div><p class="helper">在正文光标处粘贴图片，或先定位光标再拖入、选择图片。可移动图片引用调整位置。</p><label class="field"><span class="sr-only">Markdown 正文</span><textarea id="body-editor" class="body-editor" name="body" rows="11" maxlength="200000" placeholder="写下想法，在需要的位置直接粘贴图片…">${esc(value.body)}</textarea></label><p id="image-status" class="helper" role="status" aria-live="polite"></p><details class="body-preview-wrap" id="body-preview-wrap" open><summary>正文预览</summary><div id="body-preview" class="markdown body-preview"></div></details></section><details class="image-library"><summary>管理图片 <span id="image-count"></span></summary><p class="helper">已有图片可再次插入正文。删除正文中的引用只移除展示位置；点击“删除图片与引用”才会一并删除文件。每模块最多 10 张，原文件 ≤ 20 MB，自动压缩至最长边 2560 像素、≤ 1.5 MB。GIF 保存静态画面。</p><div id="attachment-list" class="attachment-grid"></div></details><label class="field">决策理由 <span class="optional">可选</span><textarea name="reason" rows="2" maxlength="4000" placeholder="为什么采用、仍需探索，或为什么放弃？">${esc(value.reason)}</textarea></label><label class="field">来源 <span class="optional">可选，仅作文字记录</span><input name="source" maxlength="4000" placeholder="例如：与 Codex 讨论 / 某次试玩观察" value="${esc(value.source)}"></label><div class="draft-state" id="draft-state">${saved ? '已恢复本地草稿' : '编辑内容会自动保存为草稿'}</div>${formActions()}</form>`, true);
  const form = $('form', dialog), list = $('#attachment-list', form);
  const editor = $('#body-editor', form), preview = $('#body-preview', form);
  let selection = { start: editor.value.length, end: editor.value.length }, previewTimer;
  const previewURLs = new Map();
  const rememberSelection = () => { selection = { start: editor.selectionStart, end: editor.selectionEnd }; };
  for (const eventName of ['input', 'select', 'click', 'keyup', 'blur']) editor.addEventListener(eventName, rememberSelection);
  const drawPreview = () => {
    preview.innerHTML = renderMarkdown(editor.value, attachments).html || '<p class="muted">文字与图片会按正文顺序显示在这里。</p>';
    preview.querySelectorAll('img[data-image-path]').forEach(img => {
      const path = img.dataset.imagePath;
      if (!images[path]) return;
      if (!previewURLs.has(path)) previewURLs.set(path, URL.createObjectURL(imageBlob(path, images[path])));
      img.src = previewURLs.get(path);
    });
    for (const [path, url] of previewURLs) if (!images[path]) { URL.revokeObjectURL(url); previewURLs.delete(path); }
  };
  const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(drawPreview, 150); };
  const insertImage = item => {
    const start = Math.min(selection.start, editor.value.length), end = Math.min(selection.end, editor.value.length);
    const before = editor.value.slice(0, start), after = editor.value.slice(end);
    const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const suffix = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const content = prefix + imageMarkdown(item) + suffix;
    if (editor.value.length - (end - start) + content.length > editor.maxLength) throw new Error('正文已接近长度限制，请精简后再插入图片。');
    editor.setRangeText(content, start, end, 'end');
    item.inline = true;
    rememberSelection();
    $('#body-preview-wrap', form).open = true;
    drawPreview();
  };
  preview.addEventListener('click', event => {
    const button = event.target.closest('[data-preview]');
    const item = button && attachments.find(item => item.id === button.dataset.preview);
    if (item) previewImage(item, images[item.path]);
  });
  const collect = () => {
    const used = renderMarkdown(editor.value, attachments).used;
    for (const item of attachments) if (used.has(item.id)) item.inline = true;
    return { ...value, ...Object.fromEntries(new FormData(form)), attachments: clone(attachments), updatedAt: now() };
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
    releaseImages(); clearTimeout(previewTimer);
    for (const url of previewURLs.values()) URL.revokeObjectURL(url);
  };
  drawImages(); drawPreview();
  form.addEventListener('input', event => {
    if (event.target.dataset.caption) {
      const item = attachments.find(item => item.id === event.target.dataset.caption);
      if (item) item.caption = event.target.value;
    }
    $('#draft-state', form).textContent = '正在保存草稿…';
    schedulePreview();
    persistDraft();
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || imageBusy) return;
    const item = attachments.find(item => item.id === (button.dataset.preview || button.dataset.remove || button.dataset.insert));
    if (!item) return;
    if (button.dataset.preview) previewImage(item, images[item.path]);
    else if (button.dataset.insert) {
      try { insertImage(item); editor.focus(); await persistDraft(); }
      catch (error) { $('#image-status', form).textContent = error.message; }
    } else {
      editor.value = removeImageReferences(editor.value, item);
      selection = { start: Math.min(selection.start, editor.value.length), end: Math.min(selection.end, editor.value.length) };
      attachments = attachments.filter(candidate => candidate.id !== item.id);
      delete images[item.path];
      imageRevision++;
      drawImages(); drawPreview(); await persistDraft();
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
    finally { imageBusy = false; modalBusy = false; form.inert = false; submit.disabled = false; if (added) { editor.focus(); editor.setSelectionRange(selection.start, selection.end); } }
  };
  const input = $('#image-input', form), drop = $('.body-composer', form);
  $('#choose-images', form).onclick = () => input.click();
  input.onchange = () => { const files = [...input.files]; input.value = ''; addImages(files); };
  form.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); if (event.target === editor) rememberSelection(); addImages(files); }
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
    next.files[topicPath(topic.id)] = encodeTopic(meta);
    await saveWorkspace(next, `删除模块「${module.title}」`);
  });
}
function deleteTopic() {
  const topic = currentTopic();
  confirmDelete(`删除主题「${topic.title}」？`, `同时删除其中 ${topic.modules.length} 个模块及其参考图片。`, async () => {
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
function showContext() {
  const topic = currentTopic();
  showDialog('带着共识，继续聊', '默认包含已确认和待探索内容。参考图附名称、说明和路径；需要 AI 看图时，请从模块下载图片再上传到对话。', `<label class="check-field"><input id="include-exploring" type="checkbox" checked> 包含待探索想法</label><textarea id="context-output" class="context-output" rows="16" readonly aria-label="接续上下文"></textarea><div class="dialog-actions"><button class="button outline" id="download-context">${icon('down')} 下载 Markdown</button><button class="button primary" id="copy-context">${icon('copy')} 复制上下文</button></div>`, true);
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
    showDialog('有些想法，需要你来选择', '同一主题在两端都有修改。选择保留的版本；取消不会改变本地资料。', `<form><p class="notice">冲突按整个主题处理，包括主题信息与全部模块。可先下载两端副本，再决定保留哪一版。</p>${result.conflicts.map(conflict => `<fieldset class="conflict"><legend>${esc(label(conflict.local) !== '已删除 / 不存在' ? label(conflict.local) : label(conflict.remote))}</legend><div class="conflict-options">${[['local', '保留本机'], ['remote', '采用 GitHub']].map(([side, title]) => `<label><input type="radio" name="${esc(conflict.key)}" value="${side}" required><strong>${title}</strong><small>${esc(label(conflict[side]))}</small><details><summary>查看该版本完整资料</summary><pre>${esc(Object.entries(conflict[side]).map(([path, content]) => `${path}\n${isImagePath(path) ? `[图片附件 ${formatSize(base64Size(content))}，完整数据包含在冲突副本中]` : content}`).join('\n\n') || '此版本已删除整个主题。')}</pre></details></label>`).join('')}</div></fieldset>`).join('')}<button type="button" class="button outline" id="export-conflicts">${icon('down')} 下载冲突副本</button>${formActions('应用所选版本')}</form>`, true);
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
  showDialog('给灵感留一份副本', '备份包含当前空间的正式模块和参考图片，不包含令牌。未保存的编辑草稿请先保存为模块。', `<div class="backup-actions"><button class="button outline" id="export-backup">${icon('down')} 导出当前资料备份</button><label class="field">导入拾念备份<input id="import-file" type="file" accept="application/json,.json"></label><p class="helper">导入会显示主题数量供确认，再替换此空间的本地资料。上传之前不会修改 GitHub；原本机资料会自动留存一份恢复副本。</p><button class="text-button" id="recover-import">下载最近一次导入前的恢复副本</button><div class="form-error" role="alert"></div></div>`);
  const backup = files => JSON.stringify({ app: 'idea-vault-backup', schemaVersion: 2, exportedAt: now(), files }, null, 2);
  $('#export-backup', dialog).onclick = () => download(`拾念-备份-${new Date().toISOString().slice(0, 10)}.json`, backup(workspace.files), 'application/json');
  $('#recover-import', dialog).onclick = async () => {
    const saved = await get(`recovery:${workspaceKey(config)}`);
    if (!saved) { toast('还没有导入前恢复副本。'); return; }
    download('拾念-导入前恢复副本.json', JSON.stringify({ app: 'idea-vault-backup', schemaVersion: 2, exportedAt: now(), files: saved.files }, null, 2), 'application/json');
  };
  $('#import-file', dialog).onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 256 * 1024 * 1024) throw new Error('备份超过 256 MB，请拆分资料库。');
      const data = JSON.parse(await file.text());
      if (data.app !== 'idea-vault-backup' || ![1, 2].includes(data.schemaVersion)) throw new Error('不是受支持的拾念备份。');
      const incoming = parseFiles(data.files);
      showDialog('导入这份资料？', `含 ${incoming.length} 个主题、${incoming.reduce((total, topic) => total + topic.modules.length, 0)} 个模块、${Object.keys(data.files).filter(isImagePath).length} 张参考图。`, `<form><p class="notice">导入会替换当前空间的本地资料，并保留当前 GitHub 同步基线。被替换的远端内容可能在下次上传时删除，请先确认备份内容。</p><label class="check-field"><input type="checkbox" required> 确认以备份替换当前本地资料</label>${formActions('导入备份')}</form>`);
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
  showDialog('把对话，接进你的创意空间', 'ChatGPT 与 Codex 共用资料，聊天记录留在各自的平台。', `<div class="guide"><article><span class="step">01 / CODEX</span><h3>用 Skill 连接仓库</h3><p>项目附带 game-idea-vault Skill。将它安装到 Codex 后，指定本地资料仓库，就可以读取上下文、整理模块并提交。首次需要在电脑上克隆资料仓库并完成 GitHub 认证。</p><blockquote>“读取我的资料仓库，继续讨论回声森林。采用的结论再沉淀。”</blockquote></article><article><span class="step">02 / CHATGPT</span><h3>用私人 GPT 直接连接 GitHub</h3><p>项目附带 GPT 指令与 Actions 配置生成器。配置专属仓库地址和认证后，可直接读取、更新资料。账号是否支持 Actions 及手机端体验，请按接入文档人工验证。</p><blockquote>“把刚才确认的潜行机制更新到核心玩法模块。”</blockquote></article><article><span class="step">03 / ANYWHERE</span><h3>随时带走上下文</h3><p>点击主题右上角「接续上下文」，复制或下载 Markdown，交给任意 AI。已放弃内容会自动排除。</p></article><div class="notice">AI 保存成功后，在这里点「拉取」；这里编辑完成后点「上传」。仅保存在本机的内容，AI 暂时无法读取。</div>${installPrompt ? '<button class="button primary" id="install-app">安装到此设备</button>' : '<p class="helper">手机可通过浏览器菜单添加到主屏幕；支持安装的桌面浏览器会显示安装入口。</p>'}</div>`, true);
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
      case 'tab': activeTab = value; render(); break;
      case 'filter': statusFilter = value; render(); break;
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
  if (event.target.id !== 'module-search' || event.isComposing) return;
  const start = event.target.selectionStart;
  query = event.target.value; render();
  const input = $('#module-search'); input.focus();
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => toast('离线缓存未能启用，在线使用不受影响。', true));
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
