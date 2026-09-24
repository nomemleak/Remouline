// Non-printable bytes must never be injected as-is into the page (that produces
// "�" garbage). The pipeline already escapes invalid UTF-8 and control bytes
// as \xNN; this is the last line of defense for anything that slips through.

// Control chars except \t and \n, DEL, C1 controls, the replacement char, lone surrogates.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f�]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function escapeForDisplay(value: string | null | undefined): string {
  if (value == null) return '';
  return value.replace(UNSAFE, (ch) => {
    const code = ch.charCodeAt(0);
    if (ch === '\r') return '\\r';
    if (code === 0xfffd) return '\\ufffd';
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

/** True when a field contains escaped bytes, in which case a hex view is offered. */
export function hasBinaryContent(value: string | null | undefined): boolean {
  if (!value) return false;
  UNSAFE.lastIndex = 0;
  return UNSAFE.test(value) || /\\x[0-9a-fA-F]{2}/.test(value);
}

/** Classic hex dump (offset, 16 bytes, ASCII column) of the UTF-8 bytes of a string. */
export function hexDump(value: string): string {
  // Turn pipeline escapes (\xNN) back into the original bytes first.
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const re = /\\x([0-9a-fA-F]{2})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    bytes.push(...encoder.encode(value.slice(last, m.index)));
    bytes.push(parseInt(m[1], 16));
    last = m.index + m[0].length;
  }
  bytes.push(...encoder.encode(value.slice(last)));

  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return lines.join('\n');
}
