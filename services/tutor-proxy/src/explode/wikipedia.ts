/**
 * Research for a subject (ADR-0026): the text of one or two English Wikipedia articles, fetched
 * by this server from one fixed host. What comes back is what the model is given to read, and its
 * titles and addresses are what the learner is told was read. Read-only; nothing the model or the
 * learner says is ever used as an address.
 */

const API = 'https://en.wikipedia.org/w/api.php';
const HOST = 'en.wikipedia.org';
const TIMEOUT_MS = 12_000;
/** Articles read at most, and characters of each. */
export const MAX_ARTICLES = 2;
/** Characters read in all, shared between the articles. */
export const MAX_READ_CHARS = 14_000;

export interface Article {
  title: string;
  url: string;
  /** Plain text, cut so that all the articles together stay within MAX_READ_CHARS. */
  text: string;
}

async function get(params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'explode-anything-builder' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.url && new URL(res.url).host !== HOST) throw new Error('Wikipedia redirected somewhere else');
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  return res.json();
}

/** Results looked at while filling the reading list. */
const SEARCH_RESULTS = 6;
/** Shorter than this and a page is a stub or a pointer, not something to draft from. */
const MIN_ARTICLE_CHARS = 400;

interface Page {
  id: number;
  title: string;
  text: string;
}

/**
 * One page's text, by title or by id. Null when it does not exist, is a disambiguation page (a
 * list of other pages, not an article), or is too short to draft from. The whole text can only be
 * asked for one page at a time.
 */
async function readPage(which: { title: string } | { id: number }, fetchImpl: typeof fetch): Promise<Page | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await get(
    { action: 'query', prop: 'extracts|pageprops', ppprop: 'disambiguation', explaintext: '1', exsectionformat: 'plain', redirects: '1', ...('title' in which ? { titles: which.title.slice(0, 120) } : { pageids: String(which.id) }) },
    fetchImpl,
  );
  const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : undefined;
  if (!page || page.missing || page.invalid || typeof page.title !== 'string' || typeof page.extract !== 'string') return null;
  if (page.pageprops && 'disambiguation' in page.pageprops) return null;
  const text = page.extract.trim();
  if (text.length < MIN_ARTICLE_CHARS) return null;
  return { id: Number(page.pageid), title: page.title, text };
}

/**
 * What to read about a subject: the article of that name when there is one, and only that. A
 * search for one word brings back whatever shares it (a planet, then a singer), and one right
 * article is better reading than one right and one wrong. With no article of that name, the best
 * search results, up to MAX_ARTICLES. Disambiguation pages and stubs are passed over. Empty when
 * nothing usable is found.
 */
export async function readArticles(search: string, fetchImpl: typeof fetch = fetch): Promise<Article[]> {
  const pages: Page[] = [];
  const add = (page: Page | null) => {
    if (page && Number.isInteger(page.id) && !pages.some((p) => p.id === page.id)) pages.push(page);
  };
  add(await readPage({ title: search }, fetchImpl));
  if (pages.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found: any = await get({ action: 'query', list: 'search', srsearch: search.slice(0, 120), srlimit: String(SEARCH_RESULTS), srnamespace: '0' }, fetchImpl);
    const ids: number[] = (Array.isArray(found?.query?.search) ? found.query.search : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => Number(r?.pageid))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    for (const id of ids) {
      if (pages.length >= MAX_ARTICLES) break;
      add(await readPage({ id }, fetchImpl));
    }
  }
  const each = Math.floor(MAX_READ_CHARS / Math.max(1, Math.min(pages.length, MAX_ARTICLES)));
  // The address is built here from the title, never taken from an answer.
  return pages.slice(0, MAX_ARTICLES).map((p) => ({ title: p.title.slice(0, 160), url: `https://${HOST}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, text: p.text.slice(0, each) }));
}
