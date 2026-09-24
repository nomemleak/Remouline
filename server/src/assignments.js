// On-disk layout of an assignment (all managed from the admin panel, never by hand):
//
//   ASSIGNMENTS_DIR/tp-<slug>/
//     staging/tests/        Criterion files imported but not yet published
//     staging/headers/      headers from the subject (prototypes only), used to build the stub
//     stub/, stub-other/    generated EMPTY implementations (returning 0/NULL, and non-zero)
//     tests/                published Criterion files, used for real student pushes
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_FILE_BYTES = 1024 * 1024;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

export function assignmentDir(slug) {
  if (!isValidSlug(slug)) throw new Error(`Invalid assignment slug: ${slug}`);
  return path.join(config.assignmentsDir, `tp-${slug}`);
}

export const dirs = (slug) => {
  const base = assignmentDir(slug);
  return {
    base,
    staging: path.join(base, 'staging', 'tests'),
    headers: path.join(base, 'staging', 'headers'),
    stub: path.join(base, 'stub'),
    stubOther: path.join(base, 'stub-other'),
    tests: path.join(base, 'tests'),
  };
};

// Normalizes an uploaded relative path and refuses anything escaping the target folder.
export function safeRelativePath(input) {
  const cleaned = String(input).replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(cleaned);
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error(`Refusing unsafe path: ${input}`);
  }
  if (normalized.split('/').some((part) => part === '.git')) {
    throw new Error(`Refusing .git path: ${input}`);
  }
  return normalized;
}

/** files: [{ path, content, encoding?: 'utf8' | 'base64' }] -> replaces the folder content. */
export function replaceFolder(target, files) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const file of files) {
    const rel = safeRelativePath(file.path);
    const buffer = Buffer.from(file.content ?? '', file.encoding === 'base64' ? 'base64' : 'utf8');
    if (buffer.length > MAX_FILE_BYTES) throw new Error(`File too large: ${rel}`);
    const dest = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(tmp, target);
}

/** Adds/overwrites the given files in the folder, keeping every other existing file. */
export function mergeIntoFolder(target, files) {
  const existing = listFiles(target).map((rel) => ({
    path: rel,
    content: fs.readFileSync(path.join(target, rel)).toString('base64'),
    encoding: 'base64',
  }));
  const byPath = new Map(existing.map((f) => [f.path, f]));
  for (const f of files) byPath.set(safeRelativePath(f.path), f);
  replaceFolder(target, [...byPath.values()]);
}

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

export function readTextFiles(root) {
  return listFiles(root).map((rel) => ({ path: rel, content: fs.readFileSync(path.join(root, rel), 'utf8') }));
}

export function hasFiles(root) {
  return listFiles(root).length > 0;
}

export function publishStagingTests(slug) {
  const d = dirs(slug);
  const files = listFiles(d.staging).map((rel) => ({
    path: rel,
    content: fs.readFileSync(path.join(d.staging, rel)).toString('base64'),
    encoding: 'base64',
  }));
  replaceFolder(d.tests, files);
}

// Files/folders allowed next to the assignment folder at the root of a student repo.
const IGNORED_ROOT_ENTRIES = new Set(['.git', '.github', '.gitignore', '.gitattributes', '.gitmodules', '.vscode', '.idea']);

/**
 * The assignment slug is NOT the repo name (it may contain the student's identity):
 * it is the single assignment folder at the repo root, e.g. "SpaceMission".
 * Returns { slug } or { error }.
 */
export function resolveSlug(repoDir) {
  const folders = fs.readdirSync(repoDir, { withFileTypes: true })
    .filter((e) => !IGNORED_ROOT_ENTRIES.has(e.name) && e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
  if (folders.length === 1) return { slug: folders[0] };
  if (folders.length === 0) {
    return { error: 'No assignment folder found at the root of the repository (expected exactly one folder named after the assignment, e.g. "SpaceMission/").' };
  }
  return {
    error: `Expected exactly one assignment folder at the root of the repository, found ${folders.length}: ${folders.sort().join(', ')}.`,
  };
}

/** Deletes every file of an assignment (tests, headers, stub). */
export function deleteAssignmentFiles(slug) {
  fs.rmSync(assignmentDir(slug), { recursive: true, force: true });
}

export function getAssignment(slug) {
  return db().prepare('SELECT * FROM assignments WHERE slug = ?').get(slug);
}

// Used by the worker: a push is only graded if its assignment folder matches a published assignment.
export function getPublishedAssignment(slug) {
  if (!isValidSlug(slug)) return null;
  const row = db().prepare("SELECT * FROM assignments WHERE slug = ? AND status = 'published'").get(slug);
  if (!row || !hasFiles(dirs(slug).tests)) return null;
  return row;
}
