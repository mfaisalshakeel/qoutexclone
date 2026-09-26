import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

/**
 * Markdown to sanitised HTML, for the CMS editors' preview pane and anywhere
 * admin-authored copy is eventually rendered. `marked` never touches the DOM
 * itself, but the CMS's whole point is that an admin's own typing ends up as
 * HTML someone else's browser renders, so it is sanitised regardless.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
