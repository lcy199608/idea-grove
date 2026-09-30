// Repository images are binary Git blobs; local snapshots keep their Base64 bytes.
export const MAX_IMAGE_BYTES = 1536 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_EDGE = 2560;
export const IMAGE_PATTERN = /^ideas\/[a-zA-Z0-9_-]{1,80}\/images\/[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,80}\.(jpg|png|webp)$/;
export const isImagePath = path => IMAGE_PATTERN.test(path);
export const imageMime = path => ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[path.split('.').pop()];
export const base64Size = value => value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
export function validateImage(path, value) {
  if (!isImagePath(path) || typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`图片数据无效或超过 1.5 MB：${path}`);
  const header = atob(value.slice(0, 64));
  const mime = imageMime(path);
  const valid = mime === 'image/jpeg' ? header.startsWith('\xff\xd8\xff') : mime === 'image/png' ? header.startsWith('\x89PNG\r\n\x1a\n') : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error(`图片格式与扩展名不符：${path}`);
  return base64Size(value);
}
export function imageBlob(path, value) {
  const raw = atob(value);
  return new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], { type: imageMime(path) });
}
export const imageFileName = item => `${item.name.replace(/\.[^.]+$/, '').replace(/[/\\:*?"<>|]/g, '_') || '参考图'}.${item.path.split('.').pop()}`;
export const formatSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败，请换一张图片重试。')), type, quality));
}
function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
    reader.readAsDataURL(blob);
  });
}
export async function prepareImage(file, topicID, moduleID) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的图片。');
  if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) throw new Error('请选择 JPG、PNG 或 WebP 图片；GIF 只保存静态画面，HEIC 取决于浏览器支持。');
  const url = URL.createObjectURL(file);
  const source = new Image();
  let canvas;
  try {
    await new Promise((resolve, reject) => {
      source.onload = resolve;
      source.onerror = () => reject(new Error('浏览器无法读取这张图片。HEIC 请先转换为 JPG 或 PNG。'));
      source.src = url;
    });
    if (!source.naturalWidth || !source.naturalHeight || source.naturalWidth * source.naturalHeight > 50000000) throw new Error('图片尺寸过大，请缩小到 5000 万像素以内。');
    canvas = document.createElement('canvas');
    let scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(source.naturalWidth, source.naturalHeight));
    let blob;
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器无法处理图片，请更新浏览器。');
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      blob = await toBlob(canvas, 'image/webp', attempt ? 0.8 : 0.9);
      if (blob.size <= MAX_IMAGE_BYTES) break;
      scale *= 0.75;
    }
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('压缩后仍超过 1.5 MB，请裁剪图片后重试。');
    const extension = blob.type === 'image/webp' ? 'webp' : 'png';
    const id = crypto.randomUUID();
    const path = `ideas/${topicID}/images/${moduleID}/${id}.${extension}`;
    const content = await asBase64(blob);
    validateImage(path, content);
    return { content, attachment: { id, path, name: (file.name || '参考图').slice(0, 200), caption: '', mimeType: imageMime(path), width: canvas.width, height: canvas.height, size: blob.size } };
  } finally {
    source.src = '';
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
