// The request body is capped by the HTTP handler before this parser is called.
// Only two text fields are accepted; uploaded JSON is never written to disk.
export function baselineInput(body, contentType = '') {
  if (!/^multipart\/form-data\b/i.test(contentType)) {
    return new URLSearchParams(body).get('baseline') ?? '';
  }
  const boundary = /\bboundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType);
  const token = boundary?.[1] ?? boundary?.[2];
  if (!token || token.length > 70 || !/^[0-9A-Za-z'()+_,\-./:=? ]+$/.test(token)) return '';
  const delimiter = `--${token}`;
  if (!body.startsWith(`${delimiter}\r\n`) || !body.includes(`\r\n${delimiter}--`)) return '';
  const fields = new Map();
  const parts = body.split(`\r\n${delimiter}`);
  parts[0] = parts[0].slice(delimiter.length);
  for (const part of parts) {
    if (part.startsWith('--')) break;
    if (!part.startsWith('\r\n')) return '';
    const end = part.indexOf('\r\n\r\n');
    if (end < 0 || end > 8192) return '';
    const headers = part.slice(2, end);
    const name = /(?:^|\r\n)Content-Disposition: form-data;[^\r\n]*\bname="(baseline|baselineFile)"(?:;|$)/i.exec(headers)?.[1];
    if (!name) continue;
    if (fields.has(name)) return '';
    fields.set(name, part.slice(end + 4));
  }
  return fields.get('baselineFile')?.trim() || fields.get('baseline') || '';
}
