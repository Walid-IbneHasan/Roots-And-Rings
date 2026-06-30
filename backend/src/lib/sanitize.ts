import sanitizeHtml from 'sanitize-html';

/** Single server-side trust boundary for product rich descriptions. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4', 'br', 'blockquote'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener nofollow', target: '_blank' }),
    },
  });
}
