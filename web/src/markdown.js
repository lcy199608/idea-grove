// A small escaped Markdown renderer. Images resolve only against this module's files.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const imageReferencePath = item => `../images/${item.path.split('/').slice(-2).join('/')}`;
export const imageMarkdown = item => `![${(item.caption || item.name).replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&')}](${imageReferencePath(item)})`;
const resolveImage = (path, attachments) => attachments.find(item => path === item.path || path === imageReferencePath(item));
const unescapeLabel = value => value.replace(/\\([\\\[\]])/g, '$1');

function tokens(line, onText, onCode, onImage) {
  const pattern = /(`+)(.*?)\1|!\[((?:\\.|[^\]\\])*)\]\(([^()\s]+)\)/g;
  let output = '', end = 0;
  for (const match of line.matchAll(pattern)) {
    // Escaped syntax remains literal text.
    const preceding = line.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
    if (preceding % 2) continue;
    output += onText(line.slice(end, match.index));
    output += match[1] ? onCode(match[2], match[0]) : onImage(unescapeLabel(match[3]), match[4], match[0]);
    end = match.index + match[0].length;
  }
  return output + onText(line.slice(end));
}

function transformLines(text, transform, fenceLine, codeLine) {
  let fence = null;
  const output = String(text).split('\n').map(line => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (mark && (!fence || (mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()))) {
      const opening = !fence;
      fence = opening ? mark[1] : null;
      return fenceLine(line, opening);
    }
    return fence ? codeLine(line) : transform(line);
  });
  return { output, unclosedFence: Boolean(fence) };
}

export function renderMarkdown(text, attachments = []) {
  const used = new Set();
  const inline = line => tokens(line,
    text => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
    code => `<code>${esc(code)}</code>`,
    (alt, path, original) => {
      const item = resolveImage(path, attachments);
      if (!item) return esc(original);
      used.add(item.id);
      const label = alt || item.caption || item.name;
      return `<span class="md-image"><button type="button" class="md-image-button" data-preview="${esc(item.id)}" aria-label="放大 ${esc(label)}"><img data-image-path="${esc(item.path)}" alt="${esc(label)}" loading="lazy"></button>${label ? `<span class="md-image-caption">${esc(label)}</span>` : ''}</span>`;
    });
  const { output, unclosedFence } = transformLines(text, line => {
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) return `<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`;
    if (/^[-*] /.test(line)) return `<div class="md-bullet">${inline(line.slice(2))}</div>`;
    if (/^> /.test(line)) return `<blockquote>${inline(line.slice(2))}</blockquote>`;
    return line.trim() ? `<p>${inline(line)}</p>` : '<div class="md-space"></div>';
  }, (line, opening) => opening ? '<pre><code>' : '</code></pre>', line => `${esc(line)}\n`);
  return { html: output.join('') + (unclosedFence ? '</code></pre>' : ''), used };
}

export function removeImageReferences(text, item) {
  const { output } = transformLines(text, line => tokens(line, value => value, (code, original) => original,
    (alt, path, original) => resolveImage(path, [item]) ? '' : original), line => line, line => line);
  return output.join('\n');
}

// Preserve every source character while replacing only real, local image references.
// Code examples, unsupported Markdown and unknown paths stay editable as plain text.
export function imageSegments(text, attachments = []) {
  const { output } = transformLines(text, line => {
    const parts = [];
    tokens(line, value => { parts.push({ text: value }); return ''; },
      (code, original) => { parts.push({ text: original }); return ''; },
      (alt, path, original) => { parts.push({ text: original, item: resolveImage(path, attachments), alt }); return ''; });
    return parts;
  }, line => [{ text: line }], line => [{ text: line }]);
  return output.flatMap((parts, index) => index ? [{ text: '\n' }, ...parts] : parts);
}
