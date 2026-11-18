import { repoQueryIn } from './explode-client.ts';

/**
 * Explode Anything from a photo, and an illustration of any subject, on the 2D page only.
 *
 * A picked photo is downscaled here, sent to the server to be named (and its parts outlined),
 * shown back with every outline, and its name is then submitted through the form's own submit
 * path, so the normal subject proposal runs. Any subject submitted (typed or from a photo) also
 * asks, without waiting on it, for a drawn illustration. Everything shown is labelled as a model's
 * guess. Server strings only ever reach the page through `textContent`.
 */

const TIMEOUT_MS = 60_000;
const MAX_SIDE = 1024;
const MAX_DATA_URL = 700_000;

interface PhotoPart {
  name: string;
  box: [number, number, number, number] | null;
}
interface PhotoAnswer {
  subject: string;
  reason: string;
  parts: PhotoPart[];
  models: { vision: string; segment: string | null };
}
interface IllustrationAnswer {
  image: string;
  model: string;
  prompt: string;
}

export interface PhotoExplode {
  /** Hides the preview panel (an immersive session started). */
  hide(): void;
}

export function wirePhotoExplode(opts: { base: string; form: HTMLFormElement; input: HTMLInputElement; setStatus?: (s: string) => void }): PhotoExplode {
  const base = opts.base.replace(/\/$/, '');
  const { form, input } = opts;
  const button = document.getElementById('photo-pick') as HTMLButtonElement | null;
  const file = document.getElementById('photo-file') as HTMLInputElement | null;
  const statusLine = document.getElementById('photo-status');
  const panel = document.getElementById('photo-preview');
  const photoBlock = document.getElementById('photo-block');
  const photoFrame = document.getElementById('photo-frame');
  const photoImg = document.getElementById('photo-img') as HTMLImageElement | null;
  const photoList = document.getElementById('photo-unboxed');
  const photoCaption = document.getElementById('photo-caption');
  const artBlock = document.getElementById('art-block');
  const artImg = document.getElementById('art-img') as HTMLImageElement | null;
  const artCaption = document.getElementById('art-caption');
  const close = document.getElementById('photo-close') as HTMLButtonElement | null;

  const say = (text: string) => {
    if (statusLine) statusLine.textContent = text;
    opts.setStatus?.(text);
  };
  const syncPanel = () => {
    if (panel) panel.hidden = !!photoBlock?.hidden && !!artBlock?.hidden;
  };
  const hide = () => {
    if (panel) panel.hidden = true;
  };

  // Parts named by the photo, passed to the illustration for the next submit only.
  let pendingParts: string[] | null = null;
  let artRequest = 0;

  const showPhoto = (dataUrl: string, answer: PhotoAnswer) => {
    if (!photoBlock || !photoFrame || !photoImg || !photoList || !photoCaption) return;
    photoImg.src = dataUrl;
    photoImg.alt = `The photo, named "${answer.subject}"`;
    for (const old of photoFrame.querySelectorAll('.photo-box')) old.remove();
    photoList.replaceChildren();
    const unboxed: string[] = [];
    for (const part of answer.parts) {
      const b = part.box;
      if (!b || b.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        unboxed.push(part.name);
        continue;
      }
      const x0 = clamp01(Math.min(b[0], b[2]));
      const y0 = clamp01(Math.min(b[1], b[3]));
      const x1 = clamp01(Math.max(b[0], b[2]));
      const y1 = clamp01(Math.max(b[1], b[3]));
      const box = document.createElement('div');
      box.className = 'photo-box';
      box.style.left = `${x0 * 100}%`;
      box.style.top = `${y0 * 100}%`;
      box.style.width = `${(x1 - x0) * 100}%`;
      box.style.height = `${(y1 - y0) * 100}%`;
      const tag = document.createElement('span');
      tag.textContent = part.name;
      box.append(tag);
      photoFrame.append(box);
    }
    photoList.hidden = unboxed.length === 0;
    if (unboxed.length) photoList.textContent = `Also named, not outlined: ${unboxed.join(', ')}.`;
    photoCaption.textContent =
      `${answer.models.vision} named this "${answer.subject}".` +
      (answer.models.segment ? ` ${answer.models.segment} outlined the parts it could find.` : '') +
      ' Both are a model\'s guess, checked by no one.';
    photoBlock.hidden = false;
    syncPanel();
  };

  const illustrate = (title: string, parts: string[] | null) => {
    const ask = ++artRequest;
    // A newer request replaces the older picture straight away.
    if (artBlock) artBlock.hidden = true;
    syncPanel();
    const body: { title: string; parts?: string[] } = { title: title.slice(0, 60) };
    if (parts && parts.length) body.parts = parts;
    void postJson(`${base}/v1/explode/illustration`, body)
      .then(({ ok, data }) => {
        if (ask !== artRequest) return; // stale
        const a = data as Partial<IllustrationAnswer> | null;
        if (!ok || !a || typeof a.image !== 'string' || !a.image.startsWith('data:image/') || typeof a.model !== 'string') {
          console.debug('[explode:illustration] nothing to show');
          return;
        }
        if (!artBlock || !artImg || !artCaption) return;
        artImg.src = a.image;
        artImg.alt = `An illustration of ${body.title}`;
        artCaption.textContent = `Drawn by ${a.model} from the name alone. It is an illustration, not a picture of the real thing, and no one checked it.`;
        artBlock.hidden = false;
        syncPanel();
      })
      .catch((err: unknown) => console.debug('[explode:illustration]', err));
  };

  // Registered before the app's own submit handler (which clears the input), so the text is still there.
  form.addEventListener('submit', () => {
    const text = input.value.trim();
    const parts = pendingParts;
    pendingParts = null;
    if (!text || repoQueryIn(text) !== null) return;
    illustrate(text, parts);
  });

  close?.addEventListener('click', () => {
    hide();
    artRequest++; // a late picture should not reopen a closed panel
  });

  if (button && file) {
    button.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const picked = file.files?.[0];
      file.value = ''; // so the same photo can be picked again
      if (!picked) return;
      button.disabled = true;
      say('Looking at the photo…');
      void (async () => {
        try {
          const dataUrl = await downscale(picked);
          const { ok, status, data } = await postJson(`${base}/v1/explode/photo`, { image: dataUrl });
          const a = data as Partial<PhotoAnswer> | null;
          if (!ok) {
            const said = (data as { error?: unknown } | null)?.error;
            say(typeof said === 'string' ? said.slice(0, 200) : `The server answered ${status}.`);
            return;
          }
          if (!a || typeof a.subject !== 'string' || !a.subject.trim()) {
            say('The server sent something this page does not understand.');
            return;
          }
          const answer: PhotoAnswer = {
            subject: a.subject.trim(),
            reason: typeof a.reason === 'string' ? a.reason : '',
            parts: Array.isArray(a.parts) ? a.parts.filter((p): p is PhotoPart => !!p && typeof p.name === 'string') : [],
            models: {
              vision: typeof a.models?.vision === 'string' ? a.models.vision : 'A model',
              segment: typeof a.models?.segment === 'string' ? a.models.segment : null,
            },
          };
          showPhoto(dataUrl, answer);
          say('');
          input.value = answer.subject.slice(0, 300);
          pendingParts = answer.parts.map((p) => p.name);
          form.requestSubmit();
        } catch (err) {
          say(err instanceof Error && err.message ? err.message : 'The photo could not be read.');
        } finally {
          button.disabled = false;
        }
      })();
    });
  }

  return { hide };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error('The server could not be reached.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON: the status decides.
  }
  return { ok: res.ok, status: res.status, data };
}

/** Decodes a picked image and re-encodes it as a JPEG data URL, longest side ≤ 1024 px and under ~700 KB. */
async function downscale(picked: File): Promise<string> {
  const url = URL.createObjectURL(picked);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('That file could not be read as a picture.');
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('That file could not be read as a picture.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare the photo.');
    for (const [side, quality] of [[MAX_SIDE, 0.8], [MAX_SIDE, 0.6], [768, 0.6], [512, 0.5]] as const) {
      const scale = Math.min(1, side / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_DATA_URL) return dataUrl;
    }
    throw new Error('The photo is too large to send.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
