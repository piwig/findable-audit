/** Inert inline Markdown text, including when rendered with raw HTML enabled. */
export function markdownText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_\[\]{}()|!#])/g, '\\$1');
}
