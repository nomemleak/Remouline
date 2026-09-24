import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTests, categoryPartsForTestFile, previewTests } from '../src/criterion-parser.js';
import { resolveSlug, safeRelativePath, isValidSlug } from '../src/assignments.js';
import { hashToken } from '../src/tokens.js';
import { parsePrototypes, stubDefinition, binariesUsed, functionsDefinedIn } from '../src/stubs.js';
import { parseFlagsFile, parseFlagList, pipelineConfig } from '../src/flags.js';
import { judge } from '../src/validation.js';

test('findTests detects Test and ParameterizedTest, ignores comments', () => {
  const src = `
    // Test(commented, out)
    /* Test(block, commented) */
    Test(suite_a, first) {}
    Test( suite_a , second, .timeout = 2) {}
    ParameterizedTest(struct param *p, suite_b, params) {}
  `;
  assert.deepEqual(findTests(src), [
    { suite: 'suite_a', name: 'first' },
    { suite: 'suite_a', name: 'second' },
    { suite: 'suite_b', name: 'params' },
  ]);
});

test('category path combines upload folders and exercise name', () => {
  assert.deepEqual(categoryPartsForTestFile('Fundamentals/test_address_book.c'), ['Fundamentals', 'address_book']);
  assert.deepEqual(categoryPartsForTestFile('Fundamentals/preflight_check/test_preflight_check.c'), ['Fundamentals', 'preflight_check']);
  assert.deepEqual(categoryPartsForTestFile('Programs/shout/shout_tests.c'), ['Programs', 'shout']);
  const preview = previewTests([{ path: 'Fundamentals/test_x.c', content: 'Test(x, a) {}' }]);
  assert.equal(preview.tests[0].category_path, 'Testsuite/Fundamentals/x/x');
});

test('resolveSlug finds the single assignment folder and rejects ambiguous repos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'README'), 'x');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'x');
  assert.ok(resolveSlug(dir).error);
  fs.mkdirSync(path.join(dir, 'SpaceMission'));
  assert.deepEqual(resolveSlug(dir), { slug: 'SpaceMission' });
  fs.mkdirSync(path.join(dir, 'Other'));
  assert.match(resolveSlug(dir).error, /exactly one/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upload paths cannot escape the target folder', () => {
  assert.equal(safeRelativePath('Fundamentals\\a.c'), 'Fundamentals/a.c');
  assert.throws(() => safeRelativePath('../etc/passwd'));
  assert.throws(() => safeRelativePath('a/../../b'));
  assert.throws(() => safeRelativePath('.git/config'));
  assert.ok(isValidSlug('SpaceMission'));
  assert.ok(!isValidSlug('../x'));
});

test('stub generator parses tricky headers', () => {
  const header = `
    #ifndef X_H
    #define X_H
    #include <stddef.h>
    /* comment with a fake proto int nope(void); */
    typedef struct vec_s { int x; int (*cb)(int); } vec_t;
    typedef int (*handler_t)(int);
    enum color { RED, GREEN };
    extern int g_counter;
    static inline int helper(int a) { return a; }
    int add(int, int);
    char *my_strdup(const char *);
    vec_t make_vec(int x, int y);
    void apply(int (*)(int), int *values, size_t n);
    unsigned long count(const char *s, char c);
    const char *name_of(enum color c);
    int no_args();
    #define MAX(a, b) ((a) > (b) ? (a) : (b))
    #endif
  `;
  const protos = parsePrototypes(header);
  assert.deepEqual(protos.map((p) => p.name), ['add', 'my_strdup', 'make_vec', 'apply', 'count', 'name_of', 'no_args']);
  const defs = Object.fromEntries(protos.map((p) => [p.name, stubDefinition(p)]));
  assert.match(defs.add, /^int add\(int p0, int p1\)/);
  assert.match(defs.add, /return \(int\)\{0\};/);
  assert.match(defs.my_strdup, /const char \* ?p0\)[\s\S]*return NULL;/);
  assert.match(defs.make_vec, /return \(vec_t\)\{0\};/);
  assert.match(defs.apply, /^void apply\(int \(\*p0\)\(int\), int \*values, size_t n\)\n\{\n\}/);
  assert.match(defs.no_args, /no_args\(void\)/);
});

test('"other" stub variant returns non-zero values of any type', () => {
  const [proto] = parsePrototypes('const char *name_of(int c);');
  assert.match(stubDefinition(proto, 'other'), /union \{ const char \* value; unsigned char bytes\[sizeof\(const char \*\)\]; \} u;/);
  assert.match(stubDefinition(proto, 'other'), /memset\(u\.bytes, 1, sizeof\(u\.bytes\)\);\n    return u\.value;/);
  const [voidProto] = parsePrototypes('void reset(int *x);');
  assert.equal(stubDefinition(voidProto, 'other'), 'void reset(int *x)\n{\n}\n');
});

test('validation judges each function (suite) on both empty implementations', () => {
  const leaf = (suite, name, status) => ({ category_path: `Testsuite/Fundamentals/village/${suite}`, test_name: name, status, valgrind_ok: null });
  const build = { category_path: 'Build/Fundamentals', test_name: 'village', status: 'pass', valgrind_ok: null };
  // find_house: its only test expects NULL -> passes on "zero", fails on "other" -> useful.
  // count_houses: fails on "zero" -> useful. log_visit: passes on both -> checks nothing.
  const zero = [build, leaf('find_house', 'unknown_name_returns_null', 'pass'), leaf('count_houses', 'three', 'fail'),
    leaf('log_visit', 'does_not_crash', 'pass')];
  const other = [build, leaf('find_house', 'unknown_name_returns_null', 'fail'), leaf('count_houses', 'three', 'fail'),
    leaf('log_visit', 'does_not_crash', 'pass')];
  const { blocking, warnings } = judge(zero, other);
  assert.equal(blocking.length, 1);
  assert.match(blocking[0], /Fundamentals\/village\/log_visit/);
  assert.equal(warnings.length, 0);
  // A void function (free_*/destroy_*) cannot fail on empty code: warning, not blocking.
  const freeSuite = judge(zero, other, { voidFunctions: ['log_visit'] });
  assert.deepEqual(freeSuite.blocking, []);
  assert.match(freeSuite.warnings[0], /log_visit: void function/);
  // A suite mixing a real check and an always-passing one only warns.
  const mixed = judge([build, leaf('s', 'real', 'fail'), leaf('s', 'noop', 'pass')], [build, leaf('s', 'real', 'fail'), leaf('s', 'noop', 'pass')]);
  assert.deepEqual(mixed.blocking, []);
  assert.equal(mixed.warnings.length, 1);
});

test('functions defined by the testsuite are detected (not stubbed)', () => {
  const src = `
    #include <criterion/criterion.h>
    int parse_record(char *line, struct record *r)
    {
        if (line == NULL) { return 1; }
        while (*line) { line++; }
        return 0;
    }
    static void helper(void) { }
    Test(file_io, parse) { cr_assert(parse_record("a", NULL) == 1, "x"); }
  `;
  assert.deepEqual([...functionsDefinedIn(src)].sort(), ['helper', 'parse_record']);
});

test('compilation flags: parsing and per-exercise exceptions', () => {
  const parsed = parseFlagsFile('default: -std=c99 -pedantic -Werror -Wall -Wextra -Wvla\nfile_io: -pedantic -Werror -Wall -Wextra -Wvla\n');
  assert.equal(parsed.defaultFlags, '-std=c99 -pedantic -Werror -Wall -Wextra -Wvla');
  assert.equal(parsed.overrides, 'file_io: -pedantic -Werror -Wall -Wextra -Wvla');
  assert.throws(() => parseFlagList('-Wall -o /tmp/x'), /forbidden/);
  assert.throws(() => parseFlagList('-Wall; rm -rf /'), /Invalid/);
  const cfg = pipelineConfig({ compile_flags: '-std=c99 -Wall', flag_overrides: parsed.overrides });
  assert.deepEqual(cfg.default_flags, ['-std=c99', '-Wall']);
  assert.deepEqual(cfg.overrides.file_io, ['-pedantic', '-Werror', '-Wall', '-Wextra', '-Wvla']);
});

test('stub generator detects program exercises from "./binary" calls', () => {
  assert.deepEqual(binariesUsed('popen("./shout hello", "r"); system("./my_ls -l"); fopen("./input.txt")'), ['shout', 'my_ls']);
});

test('invitation tokens are hashed deterministically', () => {
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), 'abc');
  assert.equal(hashToken('abc').length, 64);
});
