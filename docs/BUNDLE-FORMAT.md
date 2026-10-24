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
Programs/shout/test_shout.c                      runs ./shout, compiled from the folder's .c files
headers/Fundamentals/count_chars/count_chars.h   header users write in Fundamentals/count_chars/
```

**Shared header folder.** When the assignment keeps its headers in one folder and compiles with
it on the include path (e.g. `includes/` with `-I includes/`), put them there and keep the flag:

```
headers/includes/records.h                       header users write in includes/
Fundamentals/records/test_basics.c               #include "records.h"
remouline/flags.txt                              default: ... -I includes/
```

The tests and the empty implementations find a header by the name they include, wherever it is
under `headers/`; users' code only finds it through the flags, as with the real grading. Without
the flag, validation says which header is out of reach and which flag to add.

**Project layout.** When an assignment part is a project folder (with `src/` and/or `include/`,
often a `Makefile`) tested module by module, put the test files directly in that folder:

```
fundamentals/test_physics.c                      tests the fundamentals/ project
fundamentals/test_records.c                      same project, another module
headers/fundamentals/include/physics.h           headers users write in fundamentals/include/
headers/fundamentals/include/records.h
```

Every `.c` of the project is compiled and linked with the tests, except the file defining `main()`,
together with the precompiled libraries shipped in the project (`lib/*.a`);
every folder holding headers is on the include path, and the tests run with the project folder as
working directory (so `data/...` paths work). Validation builds one empty implementation for the
whole project. If the assignment provides the project's `Makefile`, add `<project>: makefile` to the
flags.

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
document, so a bundle can be copied from a message or an issue as-is.

Also accepted:

- a `.zip` with the same paths;
- several files, or a folder, uploaded at once (same paths);
- code blocks each starting with a `// <path>` comment.

## `remouline/flags.txt`

```
default: -std=c99 -pedantic -Werror -Wall -Wextra -Wvla
file_io: -pedantic -Werror -Wall -Wextra -Wvla
fundamentals: makefile
```

- `default:` the flags used to compile users' code (never the test files);
- `<exercise>: <flags>` an exception for one exercise, matched by its folder name (`file_io`) or its
  path (`Fundamentals/file_io`);
- `<folder>: makefile` the assignment provides or requires a Makefile for that folder: programs run
  by the tests (`./name`) are built with `make`, and unit tests are compiled with the flags of the
  compile commands `make -n` prints (`-I`, `-o`, `-l` and sanitizer options are handled by the
  pipeline). One line per folder that has a Makefile; `default:` always holds flags. **Without
  such a line, a Makefile found in a submission is never run**;
- `-I <folder>` (also `-iquote`, `-isystem`, `-L`), written `-I includes/` or `-Iincludes/`: a
  folder relative to the assignment folder (also looked up in the exercise folder); the tests use
  the same include path. `-D NAME=1` may also be written with a space;
- `#` starts a comment. Each key appears once. Flags that could redirect output or load code
  (`-o`, `-B`, `-fplugin`...) are refused. Libraries (`-l*`, `-pthread`) are passed at link time;
  `-lm` is always added.

Without a `default:` line, the assignment uses `DEFAULT_COMPILE_FLAGS` and the admin panel flags it.
Test files are always compiled without these flags, but a call to a function the header does not
declare, or a wrong pointer/integer type, is an error.

## Writing good tests

- One Criterion suite per function (`Test(<function>, <case>)`): validation expects every suite to
  have at least one test failing on an empty implementation.
- Write each test with `Test(...)` / `ParameterizedTest(...)` directly, not through a helper macro,
  so the preview lists it before validation.
- Every assertion has an explicit, readable message (`cr_assert(x == 2, "Expected 2 but got %d", x)`):
  messages of the form `Expected X but got Y` are shown as expected / actual with a diff.
- Cover the edge cases the assignment implies: NULL, empty strings, size 0, negative values.
- Tests create every data file they need themselves (`fopen`/`fwrite` in the test or a fixture) and
  clean up; they run with the exercise folder as working directory.
- Programs are run as `./<binary>` (e.g. with `popen`) and checked on their output and exit code.
- A function the assignment gives without a header (e.g. a buggy function to fix in a debugging
  exercise) is declared in the test file itself, after its `#include` lines: the empty
  implementations define it, with the includes, macros and types of the test file.
- An exercise may call the functions of another one (a list built with the functions of an
  earlier exercise): when a function is missing at link time, the file of the submission that
  defines it is compiled and linked too, and the build log says so.
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
