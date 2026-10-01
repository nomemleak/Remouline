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

function stubSource(headerPaths, protos, variant) {
  const includes = headerPaths.map((h) => `#include "${path.posix.basename(h)}"`).join('\n');
  return [
    `/* Empty implementation ("${variant}" variant) generated by Remouline to validate the testsuite. */`,
    '#pragma GCC diagnostic ignored "-Wunused-parameter"',
    '#include <stddef.h>',
    '#include <string.h>',
    includes,
    '',
    ...protos.map((p) => stubDefinition(p, variant)),
  ].join('\n');
}

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
  // Headers are part of the student's deliverable: copy them where the student would have them.
  for (const h of headers) write(outDir, h, fs.readFileSync(path.join(headersDir, h)));

  const testFiles = listFiles(testsDir).filter((f) => f.endsWith('.c'));
  const providedByTests = new Set();
  for (const rel of testFiles) {
    for (const name of functionsDefinedIn(fs.readFileSync(path.join(testsDir, rel), 'utf8'))) providedByTests.add(name);
  }

  // void functions (free_*, destroy_*...) are only observable through memory checks.
  const voidFunctions = new Set();
  for (const h of headers) {
    for (const p of parsePrototypes(fs.readFileSync(path.join(headersDir, h), 'utf8'))) {
      if (p.returnType.replace(STORAGE, '').trim() === 'void') voidFunctions.add(p.name);
    }
  }

  const done = new Set();
  for (const rel of testFiles) {
    const source = fs.readFileSync(path.join(testsDir, rel), 'utf8');
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
    if (!useFolder && scope.length === 0 && projectHeaders.length > 0) {
      const projectTarget = `${relDir}/src/remouline_stub.c`;
      if (done.has(projectTarget)) continue;
      done.add(projectTarget);
      const protos = projectHeaders.flatMap((h) => parsePrototypes(fs.readFileSync(path.join(headersDir, h), 'utf8')));
      const unique = [...new Map(protos.filter((p) => !providedByTests.has(p.name)).map((p) => [p.name, p])).values()];
      write(outDir, projectTarget, stubSource(projectHeaders, unique, variant));
      notes.push(`${projectTarget}: ${unique.length} empty function(s) for the ${relDir}/ project`);
      continue;
    }
    const target = useFolder ? `${folder}/${exercise}_stub.c` : `${[relDir, exercise].filter(Boolean).join('/')}.c`;
    if (done.has(target)) continue;
    done.add(target);
    if (scope.length === 0) {
      notes.push(`${rel}: no header found in ${targetDir || '(root)'}/ - the tests cannot compile without it`);
      continue;
    }
    const protos = scope.flatMap((h) => parsePrototypes(fs.readFileSync(path.join(headersDir, h), 'utf8')));
    const unique = [...new Map(protos.filter((p) => !providedByTests.has(p.name)).map((p) => [p.name, p])).values()];
    write(outDir, target, stubSource(scope, unique, variant));
    notes.push(`${target}: ${unique.length} empty function(s)`);
  }
  return { notes, voidFunctions: [...voidFunctions].sort() };
}
