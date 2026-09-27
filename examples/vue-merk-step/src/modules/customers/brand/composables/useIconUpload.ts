import { ref } from 'vue';

export interface ValidatedUpload {
  dataUrl: string;
  fileName: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_PX = 256;

/**
 * Validates an icon the user brings themselves: SVG or PNG, square, at least
 * 256×256 px for bitmaps. The file is shown through <img>, so scripts inside an
 * SVG never run here — the API must still sanitise SVGs before storing them.
 */
export function useIconUpload() {
  const error = ref<string | null>(null);
  const busy = ref(false);

  async function validate(file: File): Promise<ValidatedUpload | null> {
    error.value = null;
    busy.value = true;
    try {
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
      if (!isSvg && !isPng) return fail('Kies een SVG- of PNG-bestand.');
      if (file.size > MAX_BYTES) return fail('Het bestand is groter dan 2 MB.');

      if (isSvg) {
        const text = await file.text();
        const ratio = svgAspect(text);
        if (ratio === null) return fail('Dit SVG-bestand kon niet gelezen worden.');
        if (Math.abs(ratio - 1) > 0.02) return fail('Het icoon moet vierkant zijn.');
        return { dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, fileName: file.name };
      }

      const dataUrl = await readAsDataUrl(file);
      const size = await imageSize(dataUrl).catch(() => null);
      if (!size) return fail('Deze PNG kon niet gelezen worden.');
      const { width, height } = size;
      if (Math.abs(width / height - 1) > 0.02) return fail(`Het icoon moet vierkant zijn (nu ${width} × ${height} px).`);
      if (width < MIN_PX) return fail(`Het icoon is te klein (${width} px). Gebruik minstens ${MIN_PX} × ${MIN_PX} px.`);
      return { dataUrl, fileName: file.name };
    } finally {
      busy.value = false;
    }
  }

  function fail(message: string): null {
    error.value = message;
    return null;
  }

  return { error, busy, validate };
}

/** Width/height ratio from viewBox, or from width/height attributes. */
export function svgAspect(svg: string): number | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return vb[2] / vb[3];
  const w = parseFloat(/\bwidth\s*=\s*["']([\d.]+)/i.exec(tag)?.[1] ?? '');
  const h = parseFloat(/\bheight\s*=\s*["']([\d.]+)/i.exec(tag)?.[1] ?? '');
  return w > 0 && h > 0 ? w / h : null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Afbeelding kon niet geladen worden'));
    img.src = src;
  });
}
