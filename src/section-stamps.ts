/**
 * The source line range a reading-view section renders, kept on the section's
 * own element. The selection handler reads it to confine its search to the
 * lines under the selection, and a marks refresh reads it to re-map notes onto
 * already-rendered sections without a rerender.
 */

export interface SectionLines {
  /** First source line, 0-based. */
  lineStart: number;
  /** Last source line, 0-based, inclusive. */
  lineEnd: number;
}

export interface StampedSection extends SectionLines {
  element: HTMLElement;
}

const START_KEY = "agentThreadsLineStart";
const END_KEY = "agentThreadsLineEnd";
const STAMPED = "[data-agent-threads-line-start]";

export function stampSection(element: HTMLElement, lineStart: number, lineEnd: number): void {
  element.dataset[START_KEY] = String(lineStart);
  element.dataset[END_KEY] = String(lineEnd);
}

/** The lines stamped on `element`, or `null` when it carries none. */
export function sectionLines(element: HTMLElement): SectionLines | null {
  const start = element.dataset[START_KEY];
  const end = element.dataset[END_KEY];
  if (start === undefined || end === undefined) return null;
  const lineStart = Number(start);
  const lineEnd = Number(end);
  return Number.isInteger(lineStart) && Number.isInteger(lineEnd) ? { lineStart, lineEnd } : null;
}

/** Every stamped section under `root`, in document order. */
export function stampedSections(root: HTMLElement): StampedSection[] {
  const sections: StampedSection[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(STAMPED))) {
    const lines = sectionLines(element);
    if (lines !== null) sections.push({ element, ...lines });
  }
  return sections;
}

/** Where a selection sits: the stamped sections' lines and its start inside their rendered text. */
export interface SelectionPlacement extends SectionLines {
  /** The rendered text (text nodes concatenated) of the stamped sections from the first selected to the last. */
  renderedText: string;
  /** Where the selection starts inside `renderedText`. */
  renderedOffset: number;
}

/**
 * The placement of `range` against the stamped sections holding its two ends,
 * or `null` when either end sits outside a stamped section.
 */
export function selectionPlacement(range: Range): SelectionPlacement | null {
  const first = enclosingSection(range.startContainer);
  const last = enclosingSection(range.endContainer);
  if (first === null || last === null) return null;
  const firstLines = sectionLines(first);
  const lastLines = sectionLines(last);
  if (firstLines === null || lastLines === null) return null;
  const whole = first.ownerDocument.createRange();
  whole.setStart(first, 0);
  whole.setEnd(last, last.childNodes.length);
  const before = first.ownerDocument.createRange();
  before.setStart(first, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return { lineStart: firstLines.lineStart, lineEnd: lastLines.lineEnd, renderedText: whole.toString(), renderedOffset: before.toString().length };
}

function enclosingSection(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>(STAMPED) ?? null;
}
