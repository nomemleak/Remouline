// Client-side helpers turning pasted code / picked files / zips into
// [{ path, content, encoding }] payloads for the admin import API.
import JSZip from 'jszip';

export type UploadFile = { path: string; content: string; encoding: 'utf8' | 'base64' };

const JUNK = /(^|\/)(\.git|__MACOSX|node_modules)(\/|$)|(^|\/)\.DS_Store$|\.o$/;
// Legacy format: one code block per file starting with "// Fundamentals/test_x.c".
const PATH_HEADER = /^\s*(?:\/\/|#)\s*((?:[A-Za-z0-9_.-]+\/)*(?:[A-Za-z0-9_.-]+\.[ch]|[Mm]akefile))\s*$/;
// Single-document format requested by the prompts: "===== FILE: path =====".
const FILE_MARKER = /^\s*=+\s*FILE:\s*(\S+?)\s*=+\s*$/;
const END_MARKER = /^\s*=+\s*END\s*=+\s*$/;
const FENCE = /^\s*```[\w+-]*\s*$/;

export type PastedBundle = { tests: UploadFile[]; headers: UploadFile[]; errors: string[]; flags?: string };

const decodeText = (f: UploadFile) =>
  f.encoding === 'base64' ? new TextDecoder().decode(Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0))) : f.content;

/**
 * Sorts files into the two groups Remouline needs: "headers/..." are the subject's
 * headers (prototypes, used to build the empty implementation), every other .c/.h
 * is a Criterion test file. A leading "<slug>/" or "tests/" is dropped.
 */
export function routeFiles(files: UploadFile[], slug: string, errors: string[] = []): PastedBundle {
  const out: PastedBundle = { tests: [], headers: [], errors };
  const clean = (p: string) => {
    let s = p.replace(/^\.?\//, '');
    if (s.startsWith(`${slug}/`)) s = s.slice(slug.length + 1);
    return s;
  };
  for (const f of files) {
    const p = clean(f.path);
    if (/^remouline\/flags(\.txt)?$/.test(p)) {
      // Compilation flags stated by the subject: "default: ..." + per-exercise exceptions.
      out.flags = decodeText(f);
    } else if (p.startsWith('headers/')) {
      const rel = clean(p.slice('headers/'.length));
      if (rel.endsWith('.h')) out.headers.push({ ...f, path: rel });
      else errors.push(`${p}: only .h files belong in headers/, ignored.`);
    } else if (/^(correct|broken)\//.test(p)) {
      errors.push(`${p}: reference implementations are no longer used, ignored.`);
    } else if (/\.(c|h)$/.test(p)) {
      out.tests.push({ ...f, path: clean(p.replace(/^tests\//, '')) });
    } else {
      errors.push(`${p}: not a .c/.h file, ignored.`);
    }
  }
  return out;
}

/** Parses a pasted testsuite bundle (single document with FILE markers, or code blocks). */
export function parsePastedBundle(text: string, slug: string): PastedBundle {
  const { files, errors } = parsePastedCode(text);
  return routeFiles(files, slug, errors);
}

function parseMarkedDocument(text: string): { files: UploadFile[]; errors: string[] } {
  const files: UploadFile[] = [];
  let current: { path: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) files.push({ path: current.path, content: current.lines.join('\n').replace(/^\n+/, '').trimEnd() + '\n', encoding: 'utf8' });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const marker = FILE_MARKER.exec(line);
    if (marker) {
      flush();
      current = { path: marker[1], lines: [] };
    } else if (END_MARKER.test(line)) {
      flush();
    } else if (current && !FENCE.test(line)) {
      // Code fences never appear alone on a line in C code: they come from Markdown wrapping.
      current.lines.push(line);
    }
  }
  flush();
  return { files, errors: files.length ? [] : ['No "===== FILE: path =====" marker found.'] };
}

/**
 * Parses a pasted bundle (docs/BUNDLE-FORMAT.md). Preferred: ONE document where every file starts with
 * "===== FILE: <path> =====". Also accepted: one code block per file starting with a
 * "// <path>" comment.
 */
export function parsePastedCode(text: string): { files: UploadFile[]; errors: string[] } {
  if (text.split(/\r?\n/).some((l) => FILE_MARKER.test(l))) return dedupe(parseMarkedDocument(text));
  const errors: string[] = [];
  const blocks: string[] = [];
  if (text.includes('```')) {
    const re = /```[^\n]*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  } else {
    blocks.push(text);
  }
  const files: UploadFile[] = [];
  blocks.forEach((block, index) => {
    let current: { path: string; lines: string[] } | null = null;
    for (const line of block.split('\n')) {
      const header = PATH_HEADER.exec(line);
      if (header) {
        if (current) files.push({ path: current.path, content: current.lines.join('\n').trimEnd() + '\n', encoding: 'utf8' });
        current = { path: header[1].replace(/^\.?\//, ''), lines: [line] };
      } else if (current) {
        current.lines.push(line);
      } else if (line.trim()) {
        errors.push(`Block ${index + 1} does not start with a "// path/to/file.c" comment: ignored.`);
        break;
      }
    }
    if (current) files.push({ path: current.path, content: current.lines.join('\n').trimEnd() + '\n', encoding: 'utf8' });
  });
  return dedupe({ files, errors });
}

function dedupe({ files, errors }: { files: UploadFile[]; errors: string[] }) {
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) errors.push(`${f.path} appears twice: the last one wins.`);
    seen.add(f.path);
  }
  return { files: [...new Map(files.map((f) => [f.path, f])).values()], errors };
}

/**
 * One uploaded file or folder: a .txt/.md document in the FILE-marker format, a .zip,
 * or plain .c/.h files. Everything is sorted into tests / headers.
 */
export async function readBundleUpload(list: FileList, slug: string): Promise<PastedBundle> {
  const files = Array.from(list);
  if (files.length === 1 && /\.(txt|md|markdown)$/i.test(files[0].name)) {
    return parsePastedBundle(await files[0].text(), slug);
  }
  return routeFiles(await readPickedFiles(list, slug), slug);
}

async function toBase64(buffer: ArrayBuffer): Promise<string> {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function stripPrefix(paths: string[], slug: string, alwaysStripFirst: boolean): (p: string) => string {
  const first = (p: string) => p.split('/')[0];
  const shared = paths.length > 0 && paths.every((p) => p.includes('/') && first(p) === first(paths[0])) ? first(paths[0]) : null;
  return (p: string) => {
    let out = p;
    if (shared && (alwaysStripFirst || shared === slug)) out = out.slice(shared.length + 1);
    if (out.startsWith(`${slug}/`)) out = out.slice(slug.length + 1);
    return out;
  };
}

/** Files picked with <input type="file" multiple> or a folder picker (webkitdirectory). */
export async function readPickedFiles(list: FileList, slug: string, filter?: (path: string) => boolean): Promise<UploadFile[]> {
  const files = Array.from(list);
  const zip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip') ? files[0] : null;
  if (zip) return readZip(zip, slug, filter);
  const raw = files.map((f) => ({ file: f, path: (f.webkitRelativePath || f.name).replace(/\\/g, '/') }));
  const fromFolder = raw.some((r) => r.file.webkitRelativePath);
  const strip = stripPrefix(raw.map((r) => r.path), slug, fromFolder);
  const out: UploadFile[] = [];
  for (const { file, path } of raw) {
    const rel = strip(path);
    if (!rel || JUNK.test(rel) || (filter && !filter(rel))) continue;
    out.push({ path: rel, content: await toBase64(await file.arrayBuffer()), encoding: 'base64' });
  }
  return out;
}

export async function readZip(file: File, slug: string, filter?: (path: string) => boolean): Promise<UploadFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((e) => !e.dir && !JUNK.test(e.name));
  const zipBase = file.name.replace(/\.zip$/i, '');
  const paths = entries.map((e) => e.name);
  const shared = paths.length > 0 && paths.every((p) => p.includes('/') && p.split('/')[0] === paths[0].split('/')[0]) ? paths[0].split('/')[0] : null;
  const strip = stripPrefix(paths, slug, shared !== null && shared === zipBase);
  const out: UploadFile[] = [];
  for (const entry of entries) {
    const rel = strip(entry.name);
    if (!rel || (filter && !filter(rel))) continue;
    out.push({ path: rel, content: await entry.async('base64'), encoding: 'base64' });
  }
  return out;
}

export const isTestFile = (p: string) => /\.(c|h)$/.test(p);
