// Static detection of Criterion tests in imported files, used for the admin preview.
// The mapping rules below MUST stay identical to runner/pipeline.py (exercise_for_test).

const TEST_RE = /\bTest\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g;
const PARAM_TEST_RE = /\b(?:ParameterizedTest|Theory)\s*\(\s*(?:\([^)]*\)|[^,]+?)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export function findTests(source) {
  const code = stripComments(source);
  const tests = [];
  for (const re of [TEST_RE, PARAM_TEST_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null) {
      tests.push({ suite: match[1], name: match[2] });
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
