/**
 * The roadmap as the admin sees it in the app. The text of record is `docs/ROADMAP.md`; this is
 * the same content in a shape a page can draw.
 */
export type RoadmapStatus = 'done' | 'built' | 'partial' | 'next' | 'later';

export interface RoadmapStep {
  title: string;
  status: RoadmapStatus;
  /** One sentence: what it is. */
  summary: string;
  points?: string[];
}

export interface Roadmap {
  updated: string;
  direction: string;
  /** What exists today, by area. */
  areas: { name: string; items: string[] }[];
  /** What comes next, in order. */
  steps: RoadmapStep[];
  /** What must be closed before a public launch. */
  gaps: { title: string; detail: string }[];
  /** Questions only the owner can answer. */
  decisions: { question: string; detail: string }[];
  business: { title: string; detail: string }[];
  ruledOut: string;
}
