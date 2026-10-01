// Static detection of Criterion tests in imported files, used for the admin preview.
// The mapping rules below MUST stay identical to runner/pipeline.py (exercise_for_test).

const TEST_RE = /\bTest\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g;
const PARAM_TEST_RE = /\b(?:ParameterizedTest|Theory)\s*\(\s*(?:\([^)]*\)|[^,]+?)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g;

const DEFINE_RE = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)\(([^)]*)\)((?:[^\n]*\\\r?\n)*[^\n]*)/gm;
const PREPROCESSOR_RE = /^[ \t]*#(?:[^\n]*\\\r?\n)*[^\n]*/gm;
const IDENT_RE = /^[A-Za-z_]\w*$/;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** All (suite, name) pairs matched by the Test / ParameterizedTest / Theory patterns. */
function directTests(code) {
  const tests = [];
  for (const re of [TEST_RE, PARAM_TEST_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null) tests.push({ suite: match[1], name: match[2] });
  }
  return tests;
}

/** Helper macros wrapping a test: "#define TIMED(s, n) Test(s, n, .timeout = 2)" -> {TIMED, 0, 1}. */
function wrapperMacros(code) {
  const macros = [];
  DEFINE_RE.lastIndex = 0;
  let match;
  while ((match = DEFINE_RE.exec(code)) !== null) {
    const params = match[2].split(',').map((p) => p.trim());
    for (const { suite, name } of directTests(match[3])) {
      const suiteIndex = params.indexOf(suite);
      const nameIndex = params.indexOf(name);
      if (suiteIndex >= 0 && nameIndex >= 0) macros.push({ macro: match[1], suiteIndex, nameIndex });
    }
  }
  return macros;
}

/** Top-level arguments of the call whose "(" is at `open`. */
function callArguments(code, open) {
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(') {
      if (depth++ > 0) current += c;
    } else if (c === ')') {
      if (--depth === 0) return [...args, current.trim()];
      current += c;
    } else if (c === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  return null;
}

// Comments and preprocessor lines are ignored (a helper macro's own body is not a test);
// tests written through such a helper macro are found from its calls.
export function findTests(source) {
  const withDefines = stripComments(source);
  const code = withDefines.replace(PREPROCESSOR_RE, '');
  const tests = directTests(code);
  for (const { macro, suiteIndex, nameIndex } of wrapperMacros(withDefines)) {
    const re = new RegExp(`\\b${macro}\\s*\\(`, 'g');
    let match;
    while ((match = re.exec(code)) !== null) {
      const args = callArguments(code, match.index + match[0].length - 1);
      const suite = args?.[suiteIndex];
      const name = args?.[nameIndex];
      if (suite && name && IDENT_RE.test(suite) && IDENT_RE.test(name)) tests.push({ suite, name });
    }
  }
  return tests;
}

// "test_address_book.c" / "address_book_test.c" / "tests_address_book.c" -> "address_book"
export function exerciseNameFromFile(fileName) {
  return fileName
    .replace(/\.c$/, '')
    .replace(/^tests?_/, '')
    .replace(/_tests?$/, '');
}

/** Category path under Testsuite for a test file: upload folders (+ exercise) + suite. */
export function categoryPartsForTestFile(relPath) {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  const exercise = exerciseNameFromFile(fileName);
  if (parts.length === 0 || parts[parts.length - 1] !== exercise) parts.push(exercise);
  return parts;
}

/** files: [{path, content}] -> preview tree data + problems found. */
export function previewTests(files) {
  const entries = [];
  const warnings = [];
  const seen = new Map();
  for (const file of files) {
    if (!file.path.endsWith('.c')) continue;
    const tests = findTests(file.content);
    const parts = categoryPartsForTestFile(file.path);
    if (tests.length === 0) warnings.push(`${file.path}: no Test(suite, name) macro found`);
    for (const t of tests) {
      const key = `${t.suite}/${t.name}`;
      if (seen.has(key)) {
        warnings.push(`Duplicate test ${key} in ${file.path} (also in ${seen.get(key)})`);
      }
      seen.set(key, file.path);
      entries.push({
        file: file.path,
        category_path: ['Testsuite', ...parts, t.suite].join('/'),
        test_name: t.name,
      });
    }
  }
  return { tests: entries, warnings, count: entries.length };
}
