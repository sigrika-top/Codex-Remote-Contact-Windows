import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const maxImages = 4;
const maxBytes = 20 * 1024 * 1024;
const validId = value => /^[A-Za-z0-9_.-]{1,256}$/.test(value) && !value.includes('..');

function addImage(target, seen, data) {
  const file = String(data?.file || '').trim();
  if (!validId(file) || seen.has(file)) return;
  seen.add(file);
  target.push({ file, url: typeof data?.url === 'string' ? data.url : '',
    subType: data?.subType == null ? '' : String(data.subType) });
}

// OneBot can send segment arrays, CQ-code strings, or both. Only the opaque
// media ID is passed to its local get_image endpoint; chat-supplied URLs are
// never fetched directly.
export function extractOneBotImageInputs(payload = {}) {
  const images = [], seen = new Set();
  const segments = Array.isArray(payload.message) ? payload.message : [];
  for (const segment of segments) {
    if (String(segment?.type || '').toLowerCase() === 'image') addImage(images, seen, segment.data);
  }
  for (const body of [payload.raw_message, typeof payload.message === 'string' ? payload.message : '']) {
    const text = String(body || '');
    for (const match of text.matchAll(/\[CQ:image,([^\]]+)\]/gi)) {
      const file = match[1].match(/(?:^|,)file=([^,]+)/i)?.[1]
        ?.replaceAll('&amp;', '&').replaceAll('&#44;', ',').replaceAll('&#91;', '[').replaceAll('&#93;', ']');
      addImage(images, seen, { file });
    }
  }
  return images.slice(0, maxImages);
}

export function formatQqImageSummary(images = []) {
  return `${images.length} 张图片`;
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return '.jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return '.gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

export async function prepareQqModelImages(images, { fetchOneBotImage, onError } = {}) {
  if (typeof fetchOneBotImage !== 'function') throw new TypeError('QQ image preparation is not configured');
  const output = [];
  for (const image of (images || []).slice(0, maxImages)) {
    try {
      if (!validId(String(image?.file || ''))) throw new Error('invalid media ID');
      const details = await fetchOneBotImage(image.file);
      const source = String(details?.file || '');
      if (!isAbsolute(source)) throw new Error('OneBot did not return a local file');
      const metadata = await stat(source);
      if (!metadata.isFile() || metadata.size === 0 || metadata.size > maxBytes) throw new Error('image size is unsupported');
      const bytes = await readFile(source);
      const extension = imageExtension(bytes);
      if (!extension) throw new Error('image format is unsupported');
      output.push(source);
    } catch (error) {
      onError?.(error);
    }
  }
  return output;
}
