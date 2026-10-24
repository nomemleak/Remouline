// Builds EMPTY implementations of an assignment from its tests + headers, used to
// validate an imported testsuite without any reference solution. Two variants,
// because 0 / NULL is sometimes the right answer (error cases):
//   - "zero":  functions return 0 / NULL / a zeroed struct; programs print nothing, exit 0;
//   - "other": functions return a non-zero value (every byte set to 1: 16843009 for an
//              int, an invalid pointer, true...); programs print a line and exit 1.
// Void functions do nothing in both. A test is meaningless only if it passes on BOTH.
// Each variant is graded by the standard pipeline, like any student submission.
// The folder rules mirror runner/pipeline.py (Unit) and criterion-parser.js.
import fs from 'node:fs';
import path from 'node:path';
import { exerciseNameFromFile } from './criterion-parser.js';
import { listFiles } from './assignments.js';

const TYPE_WORDS = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'bool',
  'size_t', 'ssize_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'intptr_t', 'uintptr_t', 'ptrdiff_t', 'off_t', 'pid_t', 'FILE',
]);
const QUALIFIERS = new Set(['const', 'volatile', 'restrict', '__restrict', 'register']);
const STORAGE = /\b(extern|static|inline|__inline__|_Noreturn|__attribute__\s*\(\(.*?\)\))\s*/g;

function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#(?:[^\n]*\\\r?\n)*[^\n]*/gm, ' ') // preprocessor lines, with continuations
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

// Removes every {...} block (struct/union/enum bodies, inline function bodies).
function stripBraces(code) {
  let out = '';
  let depth = 0;
  for (const ch of code) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) out += ' {} ';
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      // End the statement: an inline function body is not followed by ';'.
      if (depth === 0) out += ';';
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

function splitTopLevel(params) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of params) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Adds a name to parameters declared without one ("int", "char *", "int (*)(int)"). */
function nameParameter(param, index) {
  const p = param.trim();
  if (p === 'void' || p === '...' || p === '') return p;
  if (p.includes('(')) {
    return /\(\s*\*\s*\)/.test(p) ? p.replace(/\(\s*\*\s*\)/, `(*p${index})`) : p;
  }
  const base = p.replace(/\[[^\]]*\]/g, ' ').replace(/\*/g, ' ');
  const tokens = base.split(/\s+/).filter(Boolean);
  const idents = [];
  let hasBuiltin = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (QUALIFIERS.has(t)) continue;
    if (t === 'struct' || t === 'enum' || t === 'union') {
      hasBuiltin = true;
      i += 1; // skip the tag
      continue;
    }
    if (TYPE_WORDS.has(t)) {
      hasBuiltin = true;
      continue;
    }
    idents.push(t);
  }
  const named = idents.length >= 2 || (idents.length === 1 && hasBuiltin);
  if (named) return p;
  const arrayAt = p.indexOf('[');
  return arrayAt === -1 ? `${p} p${index}` : `${p.slice(0, arrayAt)} p${index}${p.slice(arrayAt)}`;
}

/** Extracts function prototypes from a header: [{ returnType, name, params }]. */
export function parsePrototypes(header) {
  const code = stripBraces(stripNoise(header));
  const protos = [];
  for (const raw of code.split(';')) {
    const stmt = raw.replace(/\s+/g, ' ').trim();
    if (!stmt || /^typedef\b/.test(stmt) || stmt.includes('{}') || !stmt.includes('(')) continue;
    // static/inline helpers belong to the header itself: redefining them would not compile.
    if (/\b(static|inline|__inline__)\b/.test(stmt)) continue;
    const m = /^(.*?[\s*])([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(stmt.replace(STORAGE, ''));
    if (!m) continue;
    const returnType = m[1].trim();
    // Skip function-pointer variables ("int (*handler)(int)") and macros-looking declarations.
    if (!returnType || /[()]/.test(returnType) || /^[A-Z0-9_]+$/.test(m[2])) continue;
    protos.push({ returnType, name: m[2], params: m[3].trim() });
  }
  return protos;
}

export const STUB_VARIANTS = ['zero', 'other'];

export function stubDefinition({ returnType, name, params }, variant = 'zero') {
  const list = params === '' ? 'void' : splitTopLevel(params).map(nameParameter).join(', ');
  const cleanType = returnType.replace(STORAGE, '').trim();
  const head = `${cleanType} ${name}(${list})\n{\n`;
  if (/^void$/.test(cleanType)) return `${head}}\n`;
  if (variant === 'other') {
    // Works for any return type (scalars, pointers, structs, const-qualified types).
    return `${head}    union { ${cleanType} value; unsigned char bytes[sizeof(${cleanType})]; } u;\n\n`
      + '    memset(u.bytes, 1, sizeof(u.bytes));\n    return u.value;\n}\n';
  }
  if (cleanType.includes('*')) return `${head}    return NULL;\n}\n`;
  return `${head}    return (${cleanType}){0};\n}\n`;
}

function stubSource(target, { includes, preamble, protos }, variant) {
  const dir = path.posix.dirname(target);
  // Same include as the tests write for a header from elsewhere ("records.h"): the students'
  // code finds it only through the assignment's flags (-I includes/), and so must this file.
  const lines = [...includes].map(([h, name]) => `#include "${name ?? path.posix.relative(dir, h)}"`)
    .filter((line) => !preamble.split('\n').includes(line));
  return [
    `/* Empty implementation ("${variant}" variant) generated by Remouline to validate the testsuite. */`,
    '#pragma GCC diagnostic ignored "-Wunused-parameter"',
    ...(preamble ? [preamble] : []),
    '#include <stddef.h>',
    '#include <string.h>',
    ...lines,
    '',
    ...[...protos.values()].map((p) => stubDefinition(p, variant)),
  ].join('\n');
}

const QUOTED_INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]*"([^"]+)"/gm;

/**
 * Headers of the bundle that a file includes: "records.h" -> "includes/records.h". Looked up
 * relative to the file's folder first, then by name anywhere (closest folder first), since
 * the assignment's flags (-I includes/) put shared header folders on the include path.
 * @returns {Map<string, string>} include text -> header path
 */
export function resolveIncludes(source, fromDir, headers) {
  const found = new Map();
  for (const [, name] of source.matchAll(QUOTED_INCLUDE_RE)) {
    const direct = path.posix.normalize(path.posix.join(fromDir || '.', name));
    if (headers.includes(direct)) {
      found.set(name, direct);
      continue;
    }
    const shared = (a, b) => {
      const x = a.split('/');
      const y = b.split('/');
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
      return i;
    };
    const byName = headers
      .filter((h) => path.posix.basename(h) === path.posix.basename(name) && h.endsWith(name.replace(/^(\.\.?\/)+/, '')))
      .sort((a, b) => shared(path.posix.dirname(b), fromDir) - shared(path.posix.dirname(a), fromDir));
    if (byName.length > 0) found.set(name, byName[0]);
  }
  return found;
}

/**
 * What the prototypes declared in a test file need, in order: its preprocessor lines (minus
 * Criterion, quoted includes pointing to the bundle's headers) and its type definitions
 * (typedef, struct/union/enum bodies). Functions and variables are left out.
 */
export function testPreamble(source, includePath) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  const out = [];
  let stmt = '';
  let depth = 0;
  const keep = (text) => {
    const t = text.trim();
    if (/^typedef\b/.test(t) || /^(struct|union|enum)\s*[A-Za-z_]?\w*\s*\{[\s\S]*\}\s*;$/.test(t)) out.push(t);
  };
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (depth === 0 && !stmt.trim() && ch === '#') {
      let end = i;
      while (end < code.length && (code[end] !== '\n' || code[end - 1] === '\\')) end += 1;
      const line = code.slice(i, end).trim();
      i = end;
      stmt = '';
      const include = /^#\s*include\s*([<"])([^>"]+)[>"]/.exec(line);
      if (include && include[1] === '<' && include[2].startsWith('criterion/')) continue;
      if (include && include[1] === '"') {
        const resolved = includePath(include[2]);
        if (resolved) out.push(`#include "${resolved}"`);
        continue;
      }
      out.push(line);
      continue;
    }
    if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < code.length && code[end] !== ch) end += code[end] === '\\' ? 2 : 1;
      stmt += code.slice(i, end + 1);
      i = end;
      continue;
    }
    stmt += ch;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      // A function body ends the statement without ';'.
      if (depth === 0 && /\)\s*$/.test(stmt.slice(0, stmt.indexOf('{')))) stmt = '';
    }
    if (ch === ';' && depth === 0) {
      keep(stmt);
      stmt = '';
    }
  }
  return out.join('\n');
}

// Standard library functions a test may declare itself: never given an empty implementation.
const LIBC = new Set(`strlen strcpy strncpy strcat strncat strcmp strncmp strchr strrchr strstr strdup strndup
  strtok strtok_r strspn strcspn strpbrk strerror memcpy memmove memset memcmp memchr malloc calloc realloc free
  abs labs atoi atol atof strtol strtoul strtod qsort bsearch exit abort getenv rand srand printf fprintf
  sprintf snprintf dprintf vprintf vfprintf vsnprintf puts fputs fputc putchar putc fgets fgetc getc getchar
  getline getdelim fopen fclose fread fwrite fseek ftell rewind fflush feof ferror fileno tmpfile remove rename
  open close read write lseek unlink access dup dup2 pipe fork wait waitpid execv execve execvp isalpha isdigit
  isalnum isspace isupper islower isprint ispunct toupper tolower sqrt pow fabs floor ceil round fmod`.split(/\s+/));

const CALL_RE = /\b([A-Za-z_]\w*)\s*\(/g;

const STUB_MAIN = {
  zero: '/* Empty program generated by Remouline. */\nint main(void)\n{\n    return 0;\n}\n',
  other: '/* Empty program generated by Remouline. */\n#include <stdio.h>\n\nint main(void)\n{\n    puts("remouline");\n    return 1;\n}\n',
};

const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do']);

/**
 * Functions DEFINED in a test file. A testsuite may provide helper functions that
 * students are allowed to call (e.g. "parse_record"): the tests define them, so the
 * empty implementation must not define them again (duplicate symbol at link time).
 */
export function functionsDefinedIn(testSource) {
  const code = stripNoise(testSource);
  const names = new Set();
  const re = /(?:^|[;}])\s*[A-Za-z_][\w\s*]*?[\s*]([A-Za-z_]\w*)\s*\((?:[^;{}()]|\([^()]*\))*\)\s*\{/g;
  for (const m of code.matchAll(re)) {
    if (!NOT_FUNCTIONS.has(m[1])) names.add(m[1]);
  }
  return names;
}

// Binaries run by a test: "./name" inside a string literal.
export function binariesUsed(testSource) {
  const found = new Set();
  for (const m of testSource.matchAll(/["'`]\.\/([A-Za-z0-9_.+-]+)/g)) {
    // Same rule as runner/pipeline.py binaries_used().
    if (!/\.(c|h|txt|md|json|csv|in|out|bin|log|dat)$/.test(m[1])) found.add(m[1]);
  }
  return [...found];
}

function write(root, rel, content) {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

/**
 * @param {string} testsDir    staging tests
 * @param {string} headersDir  headers given with the tests (paths mirror the assignment)
 * @param {string} outDir      folder to (re)create with the empty implementation
 * @param {'zero'|'other'} variant
 * @returns {{ notes: string[], voidFunctions: string[] }}
 */
export function generateStubSubmission(testsDir, headersDir, outDir, variant = 'zero') {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const notes = [];
  const headers = listFiles(headersDir).filter((f) => f.endsWith('.h'));
  const headerText = new Map(headers.map((h) => [h, fs.readFileSync(path.join(headersDir, h), 'utf8')]));
  // Headers are part of the student's deliverable: copy them where the student would have them.
  for (const [h, text] of headerText) write(outDir, h, text);
  const headerProtos = new Map(headers.map((h) => [h, parsePrototypes(headerText.get(h))]));

  const testFiles = listFiles(testsDir).filter((f) => f.endsWith('.c'));
  const sources = new Map(testFiles.map((rel) => [rel, fs.readFileSync(path.join(testsDir, rel), 'utf8')]));
  const providedByTests = new Set();
  for (const source of sources.values()) {
    for (const name of functionsDefinedIn(source)) providedByTests.add(name);
  }

  // void functions (free_*, destroy_*...) are only observable through memory checks.
  const voidFunctions = new Set();
  const noteVoids = (protos) => {
    for (const p of protos) if (p.returnType.replace(STORAGE, '').trim() === 'void') voidFunctions.add(p.name);
  };
  for (const protos of headerProtos.values()) noteVoids(protos);

  // One empty implementation file per exercise (target path -> what it includes and defines).
  const stubs = new Map();
  const stubFor = (target) => {
    if (!stubs.has(target)) stubs.set(target, { includes: new Map(), preamble: '', protos: new Map() });
    return stubs.get(target);
  };
  const addProtos = (entry, protos) => {
    for (const p of protos) if (!providedByTests.has(p.name) && !entry.protos.has(p.name)) entry.protos.set(p.name, p);
  };
  const testStubs = [];
  const done = new Set();
  for (const rel of testFiles) {
    const source = sources.get(rel);
    const parts = rel.split('/');
    const exercise = exerciseNameFromFile(parts.pop());
    const relDir = parts.join('/');
    const inOwnFolder = parts[parts.length - 1] === exercise;
    const folder = inOwnFolder ? relDir : [relDir, exercise].filter(Boolean).join('/');

    const binaries = binariesUsed(source);
    if (binaries.length > 0) {
      if (done.has(`bin:${folder}`)) continue;
      done.add(`bin:${folder}`);
      write(outDir, `${folder}/stub_main.c`, STUB_MAIN[variant]);
      const rules = binaries.map((b) => `\t$(CC) -o ${b} stub_main.c`).join('\n');
      write(outDir, `${folder}/Makefile`, `all:\n${rules}\n\n.PHONY: all\n`);
      notes.push(`${folder}: program exercise, empty binaries ${binaries.join(', ')}`);
      continue;
    }

    // Function exercise: headers in the exercise folder, else in the category folder.
    const folderHeaders = headers.filter((h) => path.posix.dirname(h) === folder);
    const useFolder = inOwnFolder || folderHeaders.length > 0;
    const targetDir = useFolder ? folder : relDir;
    const scope = headers.filter((h) => path.posix.dirname(h) === (targetDir || '.'));

    // Project layout (e.g. fundamentals/include/*.h, one test file per module): ONE empty
    // implementation for the whole project, built from every header under it.
    const projectHeaders = relDir ? headers.filter((h) => h.startsWith(`${relDir}/`)) : [];
    let target;
    let own = scope;
    if (!useFolder && scope.length === 0 && projectHeaders.length > 0) {
      target = `${relDir}/src/remouline_stub.c`;
      own = projectHeaders;
    } else {
      target = useFolder ? `${folder}/${exercise}_stub.c` : `${[relDir, exercise].filter(Boolean).join('/')}.c`;
    }
    // Headers the test includes from elsewhere (a shared includes/ folder, a sibling exercise).
    const included = resolveIncludes(source, relDir, headers);
    const entry = stubFor(target);
    for (const h of own) {
      entry.includes.set(h, null);
      addProtos(entry, headerProtos.get(h));
    }
    if (own.length === 0) {
      for (const [name, h] of included) {
        if (!entry.includes.has(h)) entry.includes.set(h, name);
        addProtos(entry, headerProtos.get(h));
      }
    }
    // Functions the test declares itself (e.g. a function the subject gives without header):
    // defined with the test's own includes and types.
    const declared = parsePrototypes(source).filter((p) => !LIBC.has(p.name) && !providedByTests.has(p.name));
    const extra = declared.filter((p) => !entry.protos.has(p.name));
    if (extra.length > 0) {
      const preamble = testPreamble(source, (name) => (included.has(name) ? name : null));
      if (!entry.preamble.includes(preamble)) entry.preamble = [entry.preamble, preamble].filter(Boolean).join('\n');
      addProtos(entry, extra);
      noteVoids(extra);
    }
    testStubs.push({ rel, source, target, included });
  }

  // A test may call functions declared in a header but implemented by no exercise of its own
  // (e.g. helpers of a shared header): the pipeline links the exercise defining a function
  // the tests need, so only functions that NO empty implementation defines are added here.
  const defined = new Set([...stubs.values()].flatMap((e) => [...e.protos.keys()]));
  for (const { source, target, included } of testStubs) {
    const called = new Set([...stripNoise(source).matchAll(CALL_RE)].map((m) => m[1]));
    const entry = stubFor(target);
    for (const [name, h] of included) {
      const missing = headerProtos.get(h).filter((p) => called.has(p.name) && !defined.has(p.name) && !providedByTests.has(p.name));
      if (missing.length === 0) continue;
      if (!entry.includes.has(h)) entry.includes.set(h, name);
      addProtos(entry, missing);
      for (const p of missing) defined.add(p.name);
    }
  }

  for (const { rel, target } of testStubs) {
    if (done.has(target)) continue;
    done.add(target);
    const entry = stubs.get(target);
    if (entry.protos.size === 0 && entry.includes.size === 0 && !entry.preamble) {
      notes.push(`${rel}: no header found for this exercise (looked in headers/${path.posix.dirname(target)}/ and the headers the test includes), `
        + 'and the test declares no prototype - its tests cannot be built.');
      continue;
    }
    write(outDir, target, stubSource(target, entry, variant));
    notes.push(`${target}: ${entry.protos.size} empty function(s)`);
  }
  return { notes, voidFunctions: [...voidFunctions].sort() };
}
