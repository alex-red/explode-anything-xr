/**
 * What the curation model is asked, and the shape it must answer in (docs/RELEVANCE_PLAN.md).
 * Shared by the hand-run curation of the SDK (`curate.ts`) and by repositories built on request
 * (`any-repo.ts`, ADR-0026). The answer is always checked against the index before it is used.
 */

const SDK_ORDER = "how it starts, then what runs each frame, then what a user's hands reach, then the rest";
const GENERAL_ORDER = 'where a caller comes in, then the core that does the work, then what supports it';
const SDK_SPOTLIGHT = ', including ones that nothing calls directly because a frame loop runs them';
const FILE_MEMBERS = ' In a small repository a member may instead be one file: the path inside a PART id, between its first ":" and the "#".';

export interface CurationPromptOptions {
  /** Fewest parent nodes asked for. The schema accepts four or more. */
  minGroups: number;
  /** Tell the model a single file may be a member, for repositories with few directories. */
  fileMembers: boolean;
  /** A repository of any kind: leave out the wording that fits only a per-frame, hands-on SDK. */
  general: boolean;
}

/** A repository built on request: it may be small and flat, and it may be anything. */
export const ANY_CURATION_PROMPT: CurationPromptOptions = { minGroups: 4, fileMembers: true, general: true };

/** The SDK's own curation: six to eight groups of directories. */
export const SDK_CURATION_PROMPT: CurationPromptOptions = { minGroups: 6, fileMembers: false, general: false };

export function curationSystemPrompt(opts: CurationPromptOptions = SDK_CURATION_PROMPT): string {
  return `You are helping a newcomer see how a large codebase is organised. You are given a digest of every source directory of one repository: each DIR line, then its strongest PART lines (classes and top-level functions, with their doc comment and how many other parts call them).

Choose what a first-time reader should be shown, as JSON.

"groups": ${opts.minGroups} to 8 parent nodes. Each is one idea a newcomer must know to understand this system, not a folder listing.
- "id": lowercase slug, letters, digits and dashes, 2 to 30 characters.
- "label": plain words, at most 24 characters. No file names.
- "summary": one or two sentences, at most 200 characters, saying what this part of the system does. Describe only what the digest supports. No marketing words.
- "members": one or more DIR paths, copied exactly from the digest.${opts.fileMembers ? FILE_MEMBERS : ''} A DIR may appear in at most one group. Leave out DIRs that are plumbing a newcomer can skip; they will not be drawn.
- Order the groups the way the system would be explained: ${opts.general ? GENERAL_ORDER : SDK_ORDER}.

"spotlight": 8 to 14 PART ids, copied exactly from the digest (the whole text after "PART ", up to the first space). Pick the parts that are most interesting or most central${opts.general ? '' : SDK_SPOTLIGHT}. Each has "why": at most 140 characters, a plain reason.

"entry_points": 1 or 2 PART ids where a newcomer should start reading.`;
}

export const CURATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups', 'spotlight', 'entry_points'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'summary', 'members'],
        properties: { id: { type: 'string' }, label: { type: 'string' }, summary: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } },
      },
    },
    spotlight: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } },
    },
    entry_points: { type: 'array', items: { type: 'string' } },
  },
};
