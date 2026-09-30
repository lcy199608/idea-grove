import { imageSegments, imageMarkdown } from './markdown.js';
import { imageBlob } from './images.js';

const MAX_LENGTH = 200000;
const BLOCKS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3']);

// Keep Markdown as the document model; image widgets are atomic views of its references.
// No browser HTML or blob URLs are persisted to the repository or clipboard.
export function createBodyEditor({ element, source, toggle, value, attachments, images, onChange, onError, onPreview }) {
  const urls = new Map();
  let sourceMode = false, composing = false, selection = { start: value.length, end: value.length };
  let history = [], historyIndex = -1, disposed = false;
  const listeners = [];
  const listen = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };

  function documentMap(root = element) {
    let text = '';
    const bounds = new WeakMap(), runs = [];
    const visit = node => {
      const start = text.length;
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.data;
        bounds.set(node, { start, end: text.length });
        runs.push({ node, start, end: text.length });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.dataset?.editorImage) {
        text += node.dataset.markdown;
        bounds.set(node, { start, end: text.length, atomic: true });
        runs.push({ node, start, end: text.length, atomic: true });
        return;
      }
      if (node.nodeName === 'BR') {
        // A final BR in a browser-created paragraph is a caret placeholder.
        if (!node.hasAttribute('data-editor-tail') && !(node.parentNode !== root && !node.nextSibling)) text += '\n';
        bounds.set(node, { start, end: text.length, atomic: true });
        runs.push({ node, start, end: text.length, atomic: true });
        return;
      }
      const offsets = [text.length], children = [...node.childNodes];
      children.forEach((child, index) => {
        // Browser editing engines may wrap a newly entered line in a DIV/P.
        if (index && !child.hasAttribute?.('data-editor-tail') && (BLOCKS.has(child.nodeName) || BLOCKS.has(children[index - 1].nodeName))) text += '\n';
        offsets[index] = text.length;
        visit(child);
        offsets.push(text.length);
      });
      bounds.set(node, { start, end: text.length, offsets });
    };
    visit(root);
    return { text, bounds, runs };
  }
  const read = () => sourceMode ? source.value : documentMap().text;
  function remember() {
    if (sourceMode) { selection = { start: source.selectionStart, end: source.selectionEnd }; return; }
    const current = window.getSelection();
    if (!current?.rangeCount) return;
    const range = current.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const map = documentMap();
    const offset = (node, position) => {
      const entry = map.bounds.get(node);
      if (entry) return entry.offsets ? entry.offsets[position] ?? entry.end : entry.atomic ? (position ? entry.end : entry.start) : entry.start + position;
      const image = node.parentElement?.closest('[data-editor-image]');
      return map.bounds.get(image)?.start ?? map.text.length;
    };
    selection = { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
  }
  function restore(focus = true) {
    const length = read().length;
    selection = { start: Math.min(selection.start, length), end: Math.min(selection.end, length) };
    if (sourceMode) {
      if (focus) source.focus();
      source.setSelectionRange(selection.start, selection.end);
      return;
    }
    if (focus) element.focus();
    const { runs } = documentMap();
    const point = position => {
      for (const run of runs) {
        if (position > run.end) continue;
        if (!run.atomic) return [run.node, Math.max(0, position - run.start)];
        const index = [...run.node.parentNode.childNodes].indexOf(run.node);
        return [run.node.parentNode, index + (position > run.start ? 1 : 0)];
      }
      return [element, Math.max(0, element.childNodes.length - 1)];
    };
    const range = document.createRange();
    range.setStart(...point(selection.start)); range.setEnd(...point(selection.end));
    const current = window.getSelection();
    current.removeAllRanges(); current.addRange(range);
  }
  function render(text) {
    const fragment = document.createDocumentFragment();
    for (const part of imageSegments(text, attachments())) {
      if (!part.item) { if (part.text) fragment.append(document.createTextNode(part.text)); continue; }
      const item = part.item;
      const widget = document.createElement('span');
      widget.className = 'editor-image'; widget.contentEditable = 'false';
      widget.dataset.editorImage = item.id; widget.dataset.markdown = part.text;
      const img = document.createElement('img');
      img.alt = part.alt || item.caption || item.name; img.draggable = false;
      if (images()[item.path]) {
        if (!urls.has(item.path)) urls.set(item.path, URL.createObjectURL(imageBlob(item.path, images()[item.path])));
        img.src = urls.get(item.path);
      }
      const actions = document.createElement('span'); actions.className = 'editor-image-actions';
      for (const [action, label] of [['preview', '放大'], ['after', '在下方输入'], ['remove', '移除此处图片']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.imageAction = action; button.textContent = label;
        actions.append(button);
      }
      widget.append(img, actions); fragment.append(widget);
    }
    const tail = document.createElement('br'); tail.dataset.editorTail = '';
    fragment.append(tail); source.value = text; element.replaceChildren(fragment);
    for (const [path, url] of urls) if (!images()[path]) { URL.revokeObjectURL(url); urls.delete(path); }
  }
  function record() {
    const text = read();
    if (history[historyIndex]?.text === text) return;
    history.splice(historyIndex + 1);
    history.push({ text, selection: { ...selection } });
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    onChange();
  }
  function apply(text, nextSelection, focus = true) {
    if (text.length > MAX_LENGTH) throw new Error('正文超过 200000 字符，请精简后继续。');
    render(text); selection = nextSelection; restore(focus); record();
  }
  function edit(insert, { start, end } = selection) {
    const text = read();
    start = Math.min(start, text.length); end = Math.min(end, text.length);
    // Save the cursor before an operation so undo restores the insertion point.
    if (history[historyIndex]) history[historyIndex].selection = { start, end };
    apply(text.slice(0, start) + insert + text.slice(end), { start: start + insert.length, end: start + insert.length });
  }
  function undo(direction) {
    if (composing) return;
    const next = historyIndex + direction;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    const entry = history[next]; render(entry.text); selection = { ...entry.selection }; restore(); onChange();
  }
  function input(event) {
    event.stopPropagation();
    if (composing || event.isComposing) return;
    remember();
    if (read().length > MAX_LENGTH) {
      const previous = history[historyIndex];
      render(previous.text); selection = { ...previous.selection }; restore();
      onError('正文超过 200000 字符，本次输入未保留。');
      return;
    }
    record();
  }
  for (const target of [element, source]) {
    listen(target, 'input', input);
    listen(target, 'compositionstart', () => { composing = true; });
    listen(target, 'compositionend', () => { composing = false; input({ stopPropagation() {} }); });
    for (const type of ['keyup', 'mouseup', 'touchend', 'blur', 'select']) listen(target, type, remember);
    listen(target, 'keydown', event => {
      if (event.isComposing || composing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === 'y' ? 1 : -1);
      }
    });
    listen(target, 'beforeinput', event => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault(); undo(event.inputType === 'historyUndo' ? -1 : 1); return;
      }
      if (target !== element || composing || event.isComposing) return;
      if (['insertParagraph', 'insertLineBreak'].includes(event.inputType)) {
        event.preventDefault(); remember();
        try { edit('\n'); } catch (error) { onError(error.message); }
      } else if (['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
        remember();
        if (selection.start !== selection.end) return;
        const backward = event.inputType === 'deleteContentBackward';
        const image = documentMap().runs.find(run => run.node.dataset?.editorImage && (backward ? run.end === selection.start : run.start === selection.start));
        if (image) { event.preventDefault(); edit('', image); }
      } else if (event.inputType.startsWith('format')) event.preventDefault();
    });
  }
  listen(document, 'selectionchange', () => { if (!disposed && !composing && !element.closest('[inert]')) remember(); });
  listen(element, 'paste', event => {
    // File pastes are handled by the image importer in the parent form.
    if ([...(event.clipboardData?.items || [])].some(item => item.kind === 'file' && item.type.startsWith('image/'))) return;
    event.preventDefault(); remember();
    try { edit(event.clipboardData?.getData('text/plain') || ''); } catch (error) { onError(error.message); }
  });
  for (const type of ['copy', 'cut']) listen(element, type, event => {
    remember();
    if (selection.start === selection.end || !event.clipboardData) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', read().slice(selection.start, selection.end));
    if (type === 'cut') edit('');
  });
  listen(element, 'dragstart', event => event.preventDefault());
  listen(element, 'drop', event => {
    // The parent's file handler uses the saved caret; never accept pasted/dropped HTML.
    if (event.dataTransfer?.files.length) return;
    event.preventDefault(); remember();
    const text = event.dataTransfer?.getData('text/plain');
    if (text) try { edit(text); } catch (error) { onError(error.message); }
  });
  listen(element, 'click', event => {
    const button = event.target.closest('[data-image-action]');
    if (!button) return;
    const widget = button.closest('[data-editor-image]');
    const range = documentMap().bounds.get(widget);
    const item = attachments().find(item => item.id === widget.dataset.editorImage);
    if (button.dataset.imageAction === 'preview') { if (item) onPreview(item); return; }
    if (button.dataset.imageAction === 'remove') edit('', range);
    else {
      const text = read();
      if (text[range.end] !== '\n') edit('\n', { start: range.end, end: range.end });
      else { selection = { start: range.end + 1, end: range.end + 1 }; restore(); }
    }
  });
  listen(toggle, 'click', () => {
    remember(); const text = read(); sourceMode = !sourceMode;
    render(text); element.hidden = sourceMode; source.hidden = !sourceMode;
    toggle.textContent = sourceMode ? '图文编辑' : 'Markdown 源码';
    toggle.setAttribute('aria-pressed', String(sourceMode)); restore();
  });
  render(value); history.push({ text: value, selection: { ...selection } }); historyIndex = 0;
  return {
    get value() { return read(); },
    remember, focus: () => restore(),
    insertImage(item) {
      const text = read(), start = Math.min(selection.start, text.length), end = Math.min(selection.end, text.length);
      const before = text.slice(0, start), after = text.slice(end);
      const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
      const suffix = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      const insertion = prefix + imageMarkdown(item) + suffix;
      if (text.length - (end - start) + insertion.length > MAX_LENGTH) throw new Error('正文已接近长度限制，请精简后再插入图片。');
      item.inline = true;
      edit(insertion, { start, end });
    },
    // Permanent file removal must also remove references from undo snapshots.
    forgetImage(item, removeReferences) {
      const text = removeReferences(read(), item);
      history = [{ text, selection: { start: text.length, end: text.length } }]; historyIndex = 0;
      render(text); selection = { ...history[0].selection };
    },
    destroy() { disposed = true; listeners.forEach(remove => remove()); for (const url of urls.values()) URL.revokeObjectURL(url); }
  };
}
