// Minimal line diff (LCS) between expected and actual output.
export type DiffLine = { kind: 'same' | 'expected' | 'actual'; text: string };

export function lineDiff(expected: string, actual: string): DiffLine[] {
  const a = expected.split('\n');
  const b = actual.split('\n');
  if (a.length * b.length > 250_000) {
    // Too large for LCS: fall back to "all expected, then all actual".
    return [...a.map((text) => ({ kind: 'expected' as const, text })), ...b.map((text) => ({ kind: 'actual' as const, text }))];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'expected', text: a[i++] });
    } else {
      out.push({ kind: 'actual', text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: 'expected', text: a[i++] });
  while (j < b.length) out.push({ kind: 'actual', text: b[j++] });
  return out;
}

/** Makes invisible differences visible: trailing spaces and tabs. */
export function showWhitespace(line: string): string {
  return line.replace(/\t/g, '→   ').replace(/ +$/, (m) => '·'.repeat(m.length));
}
