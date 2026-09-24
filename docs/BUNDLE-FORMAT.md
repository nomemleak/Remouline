# Testsuite bundle format

A **bundle** is everything Remouline needs to grade an assignment: the Criterion test files, the
headers users must write, and (optionally) the compilation flags. You can write it by hand or with
any tool you like; Remouline only reads the format below. A complete example is
[`examples/DemoMission/bundle.txt`](../examples/DemoMission/bundle.txt).

A bundle must contain **tests and declarations only**: never a solution, and never a copy of the
material the assignment comes from (subject text, statements). Maintainers confirm this at every
import.

## Paths

Every path is relative to the assignment folder (the single top-level folder of a user's
repository, e.g. `SpaceMission/`), and is sorted into one of three groups:

| Path | Group | Content |
| --- | --- | --- |
| `remouline/flags.txt` | flags | compilation flags (see below) |
| `headers/<path>.h` | headers | a header users must write, at `<path>.h` in their folder |
| anything else ending in `.c` or `.h` | tests | Criterion test files (and test-only headers) |

Test files mirror the exercise folders:

```
Fundamentals/test_add_numbers.c                  tests Fundamentals/add_numbers.c (+ .h)
Fundamentals/count_chars/test_count_chars.c      tests the exercise folder Fundamentals/count_chars/
Programs/shout/test_shout.c                      runs ./shout, built with the folder's Makefile
headers/Fundamentals/count_chars/count_chars.h   header users write in Fundamentals/count_chars/
```

## Single document

Paste it in *Tests & publishing*, or upload it as one `.txt` file. Every file starts with a marker
line, and the document ends with an END line:

```
===== FILE: Fundamentals/count_chars/test_count_chars.c =====
#include <criterion/criterion.h>
#include "count_chars.h"

Test(count_chars, simple_string)
{
    int result = count_chars("hello", 'l');

    cr_assert(result == 2, "Expected 2 but got %d for count_chars(\"hello\", 'l')", result);
}
===== FILE: headers/Fundamentals/count_chars/count_chars.h =====
#ifndef COUNT_CHARS_H_
    #define COUNT_CHARS_H_

int count_chars(const char *str, char c);

#endif /* COUNT_CHARS_H_ */
===== FILE: remouline/flags.txt =====
default: -std=c99 -pedantic -Wall -Wextra -Werror
===== END =====
```

Text outside the markers is ignored, and so are Markdown code fences (```` ``` ````) around the
document, so a bundle can be pasted from a chat or an issue as-is.

Also accepted:

- a `.zip` with the same paths;
- several files, or a folder, uploaded at once (same paths);
- code blocks each starting with a `// <path>` comment.

## `remouline/flags.txt`

```
default: -std=c99 -pedantic -Werror -Wall -Wextra -Wvla
file_io: -pedantic -Werror -Wall -Wextra -Wvla
```

- `default:` the flags used to compile users' code (never the test files);
- `<exercise>: <flags>` an exception for one exercise, matched by its folder name (`file_io`) or its
  path (`Fundamentals/file_io`);
- `#` starts a comment. Flags that could redirect output or load code (`-o`, `-B`, `-fplugin`...)
  are refused. Libraries (`-l*`, `-pthread`) are passed at link time; `-lm` is always added.

Without this file, the assignment uses `DEFAULT_COMPILE_FLAGS` and the admin panel flags it.
Exercises with their own `Makefile` use their own flags.

## Writing good tests

- One Criterion suite per function (`Test(<function>, <case>)`): validation expects every suite to
  have at least one test failing on an empty implementation.
- Every assertion has an explicit, readable message (`cr_assert(x == 2, "Expected 2 but got %d", x)`):
  messages of the form `Expected X but got Y` are shown as expected / actual with a diff.
- Cover the edge cases the assignment implies: NULL, empty strings, size 0, negative values.
- Tests create every data file they need themselves (`fopen`/`fwrite` in the test or a fixture) and
  clean up; they run with the exercise folder as working directory.
- Programs are run as `./<binary>` (e.g. with `popen`) and checked on their output and exit code.
- If the assignment lets users call a helper function provided with the tests, define it (non-static)
  in the test file: the empty implementations never redefine functions defined by the tests.

## Updating a testsuite

Import only the changed files with *Update only these files*: every other file is kept. *Replace
everything* replaces each group present in the bundle (tests and/or headers). Every import runs the
validation again; publishing is blocked until it passes.

## Exports

*Export validation report* and *Export reports* produce JSON files (`"format":
"remouline-validation-report"` / `"remouline-reports"`, `"version": 1`) with the results or the
anonymous reports and the current test files and headers, to work on a testsuite with any tool.
