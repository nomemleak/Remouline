#!/usr/bin/env python3
"""Remouline correction pipeline, executed INSIDE the sandboxed runner container.

Layout (bind-mounted by the worker):
    /work/submission/   content of the student's <slug>/ folder (read-write, builds happen here)
    /work/tests/        Criterion files of the assignment (read-only)
    /work/config.json   {default_flags, overrides, makefile, tests} (server/src/flags.js)
    /work/out/          report.json is written here

Order: build -> Criterion tests (one process per test, with AddressSanitizer/UBSan) -> memory
check of passing tests. Leaks in the user's code are reported by LeakSanitizer during the test
run itself; valgrind is only used where the sanitizers cannot see the user's code (programs
built by its own Makefile or run as ./binary) or when LeakSanitizer cannot run. Tests of an
exercise whose build failed are reported as "skipped" with an explicit reason.

The report is a flat list of leaves; each leaf carries its full `category_path`
(Build/..., Testsuite/<folders>/<exercise>/<suite>) so the tree can be rebuilt at any
depth. Standard library only.
"""
import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

CAP = 64 * 1024
TEST_TIMEOUT = int(os.environ.get("TEST_TIMEOUT", "10"))
VALGRIND_TIMEOUT = int(os.environ.get("VALGRIND_TIMEOUT", "60"))
BUILD_TIMEOUT = int(os.environ.get("BUILD_TIMEOUT", "120"))
# Stop starting valgrind runs after this many seconds, so the global job timeout is never hit.
VALGRIND_BUDGET = int(os.environ.get("VALGRIND_BUDGET", "360"))
STRICT_FLAGS = ["-Wall", "-Wextra", "-Werror"]
# Test files are compiled without the assignment's flags, but a function or type the user's
# header does not declare (as the subject requires) must stop the build, not crash at run time.
TEST_FILE_ERRORS = ["-Werror=implicit-function-declaration", "-Werror=implicit-int", "-Werror=int-conversion",
                    "-Werror=incompatible-pointer-types"]
ASAN_FLAGS = ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]


def sanitizer_env(leaks):
    return {
        "ASAN_OPTIONS": "detect_leaks=%d:abort_on_error=1:symbolize=1:print_legend=0" % (1 if leaks else 0),
        # Leaks are reported when each test process exits, without changing its result: the
        # pipeline reads the report (leaks_in) and keeps only leaks allocated by the user's code.
        "LSAN_OPTIONS": "exitcode=0",
        # abort (signal) rather than exit(1), so Criterion reports a crash and not a plain failure.
        "UBSAN_OPTIONS": "print_stacktrace=1:halt_on_error=1:abort_on_error=1",
    }


def sanitizer_error(raw):
    """A memory error or undefined behavior (a leak report alone is not one)."""
    return "ERROR: AddressSanitizer" in raw or "runtime error" in raw

# A function definition: "type name(params) {" (same idea as server/src/stubs.js functionsDefinedIn).
DEFINITION_RE = re.compile(r"(?:^|[;}])\s*(?!(?:if|for|while|switch|return|else|do)\b)[A-Za-z_][\w\s*]*?[\s*]"
                           r"(?!(?:if|for|while|switch|return|sizeof)\b)([A-Za-z_]\w*)\s*\((?:[^;{}()]|\([^()]*\))*\)\s*\{")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
MAIN_RE = re.compile(r"^\s*int\s+main\s*\(", re.MULTILINE)
CRITERION_RE = re.compile(r"#\s*include\s*<criterion/")
TEST_RE = re.compile(r"\bTest\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)")
PARAM_TEST_RE = re.compile(r"\b(?:ParameterizedTest|Theory)\s*\(\s*(?:\([^)]*\)|[^,]+?)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)")


# ---------------------------------------------------------------------------
# Text safety: never let raw non-UTF-8 / control bytes reach the dashboard.
# ---------------------------------------------------------------------------
def clean(value):
    """bytes|str -> printable str: invalid UTF-8 becomes \\xNN, control chars become \\xNN."""
    if value is None:
        return None
    if isinstance(value, bytes):
        text = value.decode("utf-8", "backslashreplace")
    else:
        text = value.encode("utf-8", "surrogateescape").decode("utf-8", "backslashreplace")
    return CONTROL_RE.sub(lambda m: "\\x%02x" % ord(m.group(0)), text)


def cap(text, limit=CAP):
    if text is None or len(text) <= limit:
        return text
    return text[:limit] + "\n[... output truncated by Remouline (%d more characters) ...]" % (len(text) - limit)


# ---------------------------------------------------------------------------
# Process execution with timeout, process-group kill and capped output.
# ---------------------------------------------------------------------------
def run(cmd, cwd=None, timeout=60, env=None):
    full_env = dict(os.environ)
    full_env.setdefault("HOME", "/tmp")
    if env:
        full_env.update(env)
    start = time.monotonic()
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=full_env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    chunks = []
    size = [0]

    def reader():
        while True:
            data = proc.stdout.read(4096)
            if not data:
                break
            if size[0] < CAP * 2:
                chunks.append(data)
            size[0] += len(data)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    # Children may still hold the pipe; kill the whole group before joining.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    thread.join(timeout=5)
    output = clean(b"".join(chunks))
    if size[0] > CAP * 2:
        output += "\n[... %d bytes of output discarded ...]" % (size[0] - CAP * 2)
    return {
        "code": proc.returncode,
        "output": cap(output),
        "timed_out": timed_out,
        "duration_ms": int((time.monotonic() - start) * 1000),
    }


def leaf(category_path, test_name, status, **fields):
    item = {
        "category_path": category_path,
        "test_name": test_name,
        "status": status,
        "actual_output": None,
        "expected_output": None,
        "error_message": None,
        "raw_output": None,
        "valgrind_ok": None,
        "valgrind_details": None,
        "duration_ms": None,
    }
    item.update(fields)
    return item


# ---------------------------------------------------------------------------
# Test discovery + exercise mapping (keep identical to server/src/criterion-parser.js)
# ---------------------------------------------------------------------------
DEFINE_RE = re.compile(r"^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)\(([^)]*)\)((?:[^\n]*\\\r?\n)*[^\n]*)", re.MULTILINE)
PREPROCESSOR_RE = re.compile(r"^[ \t]*#(?:[^\n]*\\\r?\n)*[^\n]*", re.MULTILINE)
IDENT_RE = re.compile(r"^[A-Za-z_]\w*$")


def strip_comments(source):
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", source)


def direct_tests(code):
    found = [(m.group(1), m.group(2)) for m in TEST_RE.finditer(code)]
    found += [(m.group(1), m.group(2)) for m in PARAM_TEST_RE.finditer(code)]
    return found


def wrapper_macros(code):
    """Helper macros wrapping a test: "#define TIMED(s, n) Test(s, n, .timeout = 2)" -> (TIMED, 0, 1)."""
    macros = []
    for m in DEFINE_RE.finditer(code):
        params = [p.strip() for p in m.group(2).split(",")]
        for suite, name in direct_tests(m.group(3)):
            if suite in params and name in params:
                macros.append((m.group(1), params.index(suite), params.index(name)))
    return macros


def call_arguments(code, start):
    """Top-level arguments of the call whose "(" is at `start`."""
    args, depth, current = [], 0, ""
    for c in code[start:]:
        if c == "(":
            if depth > 0:
                current += c
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return args + [current.strip()]
            current += c
        elif c == "," and depth == 1:
            args.append(current.strip())
            current = ""
        else:
            current += c
    return None


def static_tests(source):
    """Comments and preprocessor lines are ignored (a helper macro's own body is not a test);
    tests written through such a helper macro are found from its calls."""
    with_defines = strip_comments(source)
    code = PREPROCESSOR_RE.sub("", with_defines)
    found = direct_tests(code)
    for macro, suite_index, name_index in wrapper_macros(with_defines):
        for m in re.finditer(r"\b%s\s*\(" % macro, code):
            args = call_arguments(code, m.end() - 1) or []
            if max(suite_index, name_index) < len(args):
                suite, name = args[suite_index], args[name_index]
                if IDENT_RE.match(suite) and IDENT_RE.match(name):
                    found.append((suite, name))
    return found


def exercise_name(file_name):
    name = re.sub(r"\.c$", "", file_name)
    name = re.sub(r"^tests?_", "", name)
    return re.sub(r"_tests?$", "", name)


def category_parts(rel):
    parts = rel.split("/")
    file_name = parts.pop()
    ex = exercise_name(file_name)
    if not parts or parts[-1] != ex:
        parts.append(ex)
    return parts


BIN_RE = re.compile(r"""["'`]\./([A-Za-z0-9_.+-]+)""")
DATA_EXT_RE = re.compile(r"\.(c|h|txt|md|json|csv|in|out|bin|log|dat)$")


def binaries_used(test_source):
    """Programs run by a test: "./name" inside a string literal (same rule as server/src/stubs.js)."""
    return sorted({m for m in BIN_RE.findall(test_source) if not DATA_EXT_RE.search(m)})


def ignored(parts):
    """Hidden folders and CMake's generated CMakeFiles/ (a build folder committed by mistake)."""
    return any(p.startswith(".") or p == "CMakeFiles" for p in parts)


def module_file(folder, exercise, exercises):
    """<exercise>.c in a module subfolder of a project, next to its header (e.g.
    game_logic/cannon.c + game_logic/cannon.h), not in a hidden folder nor in the folder of
    another exercise tested from the same folder."""
    for src in sorted(folder.rglob(exercise + ".c")):
        parts = src.relative_to(folder).parts[:-1]
        if (parts and not ignored(parts) and parts[0] not in exercises
                and any(src.parent.glob("*.h"))):
            return src
    return None


def is_project(folder, exercises, modules=True):
    """A folder holding test files directly (one per module) is built as ONE project, every .c
    under it, when one of those tests has no exercise folder or file of its own: the project
    has src/ or include/ (fundamentals/src/, fundamentals/include/), or keeps that module in a
    subfolder of its own (proficiencies/game_logic/cannon.c, with `modules`). Its other tests
    (e.g. a module in proficiencies/game_state/game_state.c) then belong to the same project."""
    if not folder.is_dir():
        return False
    layout = (folder / "src").is_dir() or (folder / "include").is_dir()
    for exercise in sorted(exercises):
        if exercise == folder.name or (folder / exercise).is_dir() or (folder / (exercise + ".c")).exists():
            continue
        if layout or (modules and module_file(folder, exercise, exercises) is not None):
            return True
    return False


class Unit:
    """One test file + the exercise it targets."""

    def __init__(self, tests_root, submission, rel, makefile_keys=(), exercises=()):
        """`exercises`: exercise names of every test file in the same folder as this one."""
        self.rel = rel
        self.test_file = tests_root / rel
        self.parts = category_parts(rel)
        self.exercise = self.parts[-1]
        rel_dir = str(Path(rel).parent).replace("\\", "/")
        self.rel_dir = "" if rel_dir == "." else rel_dir
        # Project layout: the test file sits in a project folder (e.g. fundamentals/, with
        # src/ and include/, often a Makefile or a CMakeLists.txt) and tests several of its
        # modules, one test file per module (test_physics.c, test_records.c...): every .c of
        # the project counts, and the project folder is the exercise folder. At the top of the
        # submission, exercises live in folders of their own next to a shared include/: only
        # this test's own exercise counts, and only src/ or include/ (one missing or misplaced
        # exercise must not merge all the others into one project).
        if self.rel_dir:
            self.project = is_project(submission / self.rel_dir, set(exercises) | {self.exercise})
        else:
            self.project = is_project(submission, {self.exercise}, modules=False)
        # Otherwise the exercise lives either in its own folder (<dir>/<exercise>/) or directly in <dir>/.
        candidates = [self.rel_dir] if self.project else [
            "/".join(x for x in [self.rel_dir, self.exercise] if x), self.rel_dir]
        self.exercise_dir = None
        self.exercise_rel = None
        for candidate in candidates:
            path = submission / candidate if candidate else submission
            if path.is_dir():
                self.exercise_dir = path
                self.exercise_rel = candidate or "."
                break
        self.mode = None
        # Names an assignment's flags.txt may use for this exercise, most specific first.
        self.keys = [k for k in (self.exercise_rel, "/".join(self.parts), self.exercise) if k]
        # The assignment says this folder is built with its Makefile ("<folder>: makefile").
        # Otherwise a Makefile found in the submission is never run.
        self.uses_makefile = self.exercise_dir is not None and any(k in makefile_keys for k in self.keys)
        if self.exercise_dir is not None:
            # makefile: the tests run "./binary" built with the folder's Makefile; program: the
            # tests run "./binary" that we compile from the folder; functions: unit tests linked
            # with the student's code (with the Makefile's compilation flags when it is used).
            self.binaries = binaries_used(self.test_file.read_text(errors="replace"))
            if self.binaries and self.uses_makefile:
                self.mode = "makefile"
            elif self.binaries:
                self.mode = "program"
            else:
                self.mode = "functions"
        self.build_path = "Build/" + "/".join(self.parts[:-1]) if len(self.parts) > 1 else "Build"


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
INCLUDE_RE = re.compile(r'^\s*#\s*include\s*"([^"]+)"', re.MULTILINE)
COMPILER_RE = re.compile(r"^(gcc|cc|clang|g\+\+|c\+\+)(-[0-9.]+)?$")
# Options followed by a separate argument, and options the pipeline handles itself.
TAKES_ARGUMENT = {"-o", "-I", "-L", "-MF", "-MT", "-MQ", "-include", "-isystem", "-iquote", "-x"}
NOT_KEPT = ("-c", "-I", "-L", "-l", "-M", "-o", "-fsanitize", "-fno-sanitize", "-B", "-wrapper", "-fplugin",
            "-specs", "-isystem", "-iquote", "-include")


PATH_OPTIONS = ("-iquote", "-isystem", "-I", "-L")
UNDEFINED_RE = re.compile(r"undefined reference to [`']([A-Za-z_]\w*)'")
MULTIPLE_RE = re.compile(r"multiple definition of [`']([A-Za-z_]\w*)'")
MISSING_HEADER_RE = re.compile(r"fatal error: ([^:\s]+): No such file or directory")


def path_option(flag):
    """("-I", "includes") for "-Iincludes" (server/src/flags.js joins "-I includes/")."""
    for option in PATH_OPTIONS:
        if flag.startswith(option) and len(flag) > len(option):
            return option, flag[len(option):]
    return None, None


def has_makefile(folder):
    return any((folder / name).is_file() for name in ("Makefile", "makefile", "GNUmakefile"))


def read_makefile_flags(folder, rel):
    """Flags used by the compile commands that `make -n` prints for this folder."""
    if not has_makefile(folder):
        return None, ("The assignment builds %s/ with its Makefile, but there is none: "
                      "the assignment's default flags are used." % rel)
    res = run(["make", "-n", "-B", "-C", str(folder)], timeout=BUILD_TIMEOUT)
    flags, found = [], False
    for line in (res["output"] or "").splitlines():
        try:
            tokens = shlex.split(line)
        except ValueError:
            continue
        if not tokens or not COMPILER_RE.match(os.path.basename(tokens[0])):
            continue
        if not any(t.endswith(".c") for t in tokens):
            continue
        found = True
        skip = False
        for token in tokens[1:]:
            if skip:
                skip = False
                continue
            if token in TAKES_ARGUMENT:
                skip = True
                continue
            if token.startswith("-") and not token.startswith(NOT_KEPT) and token not in flags:
                flags.append(token)
    if res["code"] != 0 or not found:
        return None, ("Could not read the compilation flags from %s/Makefile (make -n): "
                      "the assignment's default flags are used." % rel)
    return flags, "Compilation flags read from %s/Makefile: %s" % (rel, " ".join(flags) or "(none)")


class Builder:
    def __init__(self, submission, build_root, config=None, validation=False, leak_sanitizer=False):
        self.submission = submission
        self.build_root = build_root
        # Validation runs the empty implementations built from the assignment's own headers.
        self.validation = validation
        self.leak_sanitizer = leak_sanitizer
        self.make_cache = {}
        self.obj_cache = {}
        config = config or {}
        self.default_flags = config.get("default_flags") or STRICT_FLAGS
        self.overrides = config.get("overrides") or {}

    def uses_valgrind(self, unit):
        """Validation checks no memory. Unit tests of the user's functions run instrumented
        (LeakSanitizer); programs built from the folder or by its Makefile need valgrind."""
        return not self.validation and not (self.leak_sanitizer and unit.mode == "functions")

    def variants(self, unit):
        # "plain" (uninstrumented) binaries only exist for valgrind.
        return ("asan", "plain") if self.uses_valgrind(unit) else ("asan",)

    def flags_for(self, unit):
        """Assignment flags, or the exercise's own flags when the subject says so. Sanitizer
        flags are dropped: the pipeline builds its own AddressSanitizer/UBSan variant, and the
        plain variant must stay uninstrumented for valgrind."""
        flags = self.default_flags
        from_makefile = self.makefile_flags(unit)[0] if unit.uses_makefile and unit.mode == "functions" else None
        if from_makefile is not None:
            flags = from_makefile
        else:
            flags = next((self.overrides[k] for k in unit.keys if k in self.overrides), flags)
        return [f for f in flags if not f.startswith(("-fsanitize", "-fno-sanitize"))]

    def localize(self, flags, unit):
        """Folder options ("-Iincludes") are relative to the assignment folder, as when the
        subject's command is run from it; the exercise folder is searched too. Folders outside
        the submission are dropped."""
        out = []
        root = self.submission.resolve()
        for flag in flags:
            option, folder = path_option(flag)
            if option is None:
                out.append(flag)
                continue
            for base in dict.fromkeys([self.submission, unit.exercise_dir or self.submission]):
                resolved = (base / folder).resolve()
                if (resolved == root or root in resolved.parents) and option + str(resolved) not in out:
                    out.append(option + str(resolved))
        return out

    def flag_include_dirs(self, unit):
        """Header folders named by the assignment's -I / -iquote / -isystem flags: the tests
        include their headers from there, like the user's code."""
        dirs = []
        for flag in self.localize(self.flags_for(unit), unit):
            option, folder = path_option(flag)
            if option in ("-I", "-iquote", "-isystem") and Path(folder) not in dirs:
                dirs.append(Path(folder))
        return dirs

    def makefile_flags(self, unit):
        """Compilation flags of the folder's Makefile, read from `make -n` (nothing is built).
        Returns (flags or None, note for the build log)."""
        key = "flags:%s" % unit.exercise_dir
        if key not in self.make_cache:
            self.make_cache[key] = read_makefile_flags(unit.exercise_dir, unit.exercise_rel)
        return self.make_cache[key]

    def linked_sources(self, unit, sources):
        """Sources of OTHER exercise folders this exercise includes a header from
        (e.g. fleet_report.h including "../fleet/fleet.h" needs fleet's .c files)."""
        own = unit.exercise_dir.resolve()
        shared = (self.submission / "include").resolve()
        root = self.submission.resolve()
        scanned, extra_dirs = set(), []
        queue = list(sources) + sorted(unit.exercise_dir.glob("*.h"))
        while queue and len(scanned) < 200:
            current = queue.pop()
            if current in scanned or not current.exists():
                continue
            scanned.add(current)
            for target in INCLUDE_RE.findall(current.read_text(errors="replace")):
                resolved = (current.parent / target).resolve()
                if not resolved.exists() or root not in resolved.parents:
                    continue
                folder = resolved.parent
                queue.append(resolved)
                if folder in (own, shared) or folder in extra_dirs:
                    continue
                extra_dirs.append(folder)
                queue.extend(sorted(folder.glob("*.c")))
        extra = []
        for folder in extra_dirs:
            for src in sorted(folder.glob("*.c")):
                if src not in sources and not MAIN_RE.search(src.read_text(errors="replace")):
                    extra.append(src)
        return extra

    def shared_includes(self, unit=None):
        """A top-level include/ folder (common layout) is visible to every exercise, and so
        is every folder holding headers inside a project."""
        folders = []
        if (self.submission / "include").is_dir():
            folders.append(self.submission / "include")
        if unit is not None and unit.project:
            folders += self.project_header_dirs(unit)
        flags = []
        for folder in folders:
            flags += ["-I", str(folder)]
        return flags

    def project_header_dirs(self, unit):
        dirs = []
        for header in sorted(unit.exercise_dir.rglob("*.h")):
            if header.parent not in dirs and not ignored(header.relative_to(unit.exercise_dir).parts):
                dirs.append(header.parent)
            if len(dirs) >= 20:
                break
        return dirs

    def project_archives(self, unit):
        """Precompiled libraries shipped with a project (e.g. lib/libfoo.a, given with the
        assignment and committed by the student): linked after the student's code."""
        if not unit.project:
            return []
        return [a for a in sorted(unit.exercise_dir.rglob("*.a"))
                if not any(p.startswith(".") for p in a.relative_to(unit.exercise_dir).parts)]

    def project_sources(self, unit, with_main=False):
        """Every .c of a project folder, except test files (and main() unless asked)."""
        sources = []
        for src in sorted(unit.exercise_dir.rglob("*.c")):
            if ignored(src.relative_to(unit.exercise_dir).parts):
                continue
            text = src.read_text(errors="replace")
            if CRITERION_RE.search(text) or (not with_main and MAIN_RE.search(text)):
                continue
            sources.append(src)
        return sources

    def sources_for(self, unit):
        """Student sources of a function-style exercise."""
        if unit.project:
            sources = self.project_sources(unit)
            return sources, None if sources else "No source file found in %s/." % unit.exercise_rel
        own_file = unit.exercise_dir / (unit.exercise + ".c")
        if unit.exercise_dir.name == unit.exercise:
            # Exercise folder: every .c file of the folder, except the ones defining main().
            sources = []
            for src in sorted(unit.exercise_dir.glob("*.c")):
                text = src.read_text(errors="replace")
                if not MAIN_RE.search(text):
                    sources.append(src)
            return sources, None if sources else "No source file found in %s/." % unit.exercise_rel
        if own_file.exists():
            return [own_file], None
        missing = "/".join(x for x in [unit.rel_dir, unit.exercise + ".c"] if x)
        return [], "Missing file: %s" % missing

    def compile_objects(self, unit, sources, variant):
        # Libraries (-lm...) only matter at link time (see link_flags).
        shown = [f for f in self.flags_for(unit) if not f.startswith(("-l", "-L"))]
        flags = self.localize(shown, unit)
        key = (tuple(str(s) for s in sources), variant, tuple(flags))
        if key in self.obj_cache:
            return self.obj_cache[key]
        out_dir = self.build_root / ("objs-%d-%s" % (len(self.obj_cache), variant))
        out_dir.mkdir(parents=True, exist_ok=True)
        objects, logs, ok = [], [], True
        extra = ASAN_FLAGS if variant == "asan" else []
        for index, src in enumerate(sources):
            obj = out_dir / ("%d_%s.o" % (index, src.stem))
            # A main() left in the exercise file (e.g. given with a debugging exercise) would replace
            # Criterion's: it is renamed in the test build only.
            rename = ["-Dmain=remouline_user_main"] if MAIN_RE.search(src.read_text(errors="replace")) else []
            cmd = ["gcc", *flags, *rename, "-g", *extra, "-I", str(src.parent), *self.shared_includes(unit),
                   "-c", str(src), "-o", str(obj)]
            res = run(cmd, timeout=BUILD_TIMEOUT)
            display = " ".join(["gcc", *shown, "-c", str(src.relative_to(self.submission))])
            logs.append("$ %s\n%s" % (display, res["output"] or ""))
            if res["code"] != 0:
                ok = False
                break
            objects.append(obj)
        result = (ok, objects, "\n".join(logs).strip())
        self.obj_cache[key] = result
        return result

    def run_make(self, unit):
        """Builds the folder with its Makefile: (ok, log, reason when it failed)."""
        key = str(unit.exercise_dir)
        if key not in self.make_cache:
            if not has_makefile(unit.exercise_dir):
                self.make_cache[key] = (False, "No Makefile in %s/." % unit.exercise_rel,
                                        "The assignment requires a Makefile in %s/." % unit.exercise_rel)
                return self.make_cache[key]
            res = run(["make", "-C", str(unit.exercise_dir)], timeout=BUILD_TIMEOUT)
            text = "$ make -C %s\n%s" % (unit.exercise_rel, res["output"] or "")
            reason = None
            if res["timed_out"]:
                text += "\nmake timed out after %ds." % BUILD_TIMEOUT
                reason = "make timed out."
            elif res["code"] != 0:
                reason = "make failed."
            self.make_cache[key] = (reason is None, text.strip(), reason)
        ok, text, reason = self.make_cache[key]
        missing = [b for b in unit.binaries if not (unit.exercise_dir / b).is_file()] if ok else []
        if missing:
            # Several test files can share a folder: each checks the programs it runs.
            return False, text, "make did not produce %s." % ", ".join("./" + b for b in missing)
        return ok, text, reason

    def compile_test_object(self, unit, variant, include_dirs):
        out = self.build_root / ("test-%s-%s.o" % (re.sub(r"[^A-Za-z0-9]+", "_", unit.rel), variant))
        extra = ASAN_FLAGS if variant == "asan" else []
        includes = []
        for d in include_dirs:
            includes += ["-I", str(d)]
        res = run(["gcc", *TEST_FILE_ERRORS, "-g", *extra, *includes, "-c", str(unit.test_file), "-o", str(out)],
                  timeout=BUILD_TIMEOUT)
        return res["code"] == 0, out, res["output"] or ""

    def link_flags(self, unit):
        """Libraries must also be given at link time: -l*, -pthread from the flags, plus -lm
        (math.h functions) which never hurts."""
        flags = [f for f in self.localize(self.flags_for(unit), unit) if f.startswith(("-l", "-L")) or f == "-pthread"]
        return flags + ([] if "-lm" in flags else ["-lm"])

    def build_program(self, unit):
        """No Makefile, but the tests run ./binary: compile every .c of the folder into it."""
        key = "program:%s" % unit.exercise_dir
        if key in self.make_cache:
            return self.make_cache[key]
        sources = self.project_sources(unit, with_main=True) if unit.project else sorted(unit.exercise_dir.glob("*.c"))
        sources += self.linked_sources(unit, sources)
        flags = self.flags_for(unit)
        local = [f for f in self.localize(flags, unit) if not f.startswith(("-l", "-L"))]
        logs, ok = [], bool(sources)
        if not sources:
            logs.append("No source file found in %s/." % unit.exercise_rel)
        # A project's program is linked with the object files given with it, like its archives.
        given = self.given_objects(unit.exercise_dir) if unit.project else []
        for name in unit.binaries if sources else []:
            cmd = ["gcc", *local, "-g", "-I", str(unit.exercise_dir), *self.shared_includes(unit),
                   *[str(s) for s in sources], *[str(o) for o in given], *[str(a) for a in self.project_archives(unit)],
                   "-o", str(unit.exercise_dir / name), *self.link_flags(unit)]
            res = run(cmd, timeout=BUILD_TIMEOUT)
            shown = " ".join(str(s.relative_to(self.submission)) for s in sources)
            logs.append("$ gcc %s %s -o %s\n%s" % (" ".join(flags), shown, name, res["output"] or ""))
            if res["code"] != 0:
                ok = False
                break
        self.make_cache[key] = (ok, "\n".join(logs).strip(), sources)
        return self.make_cache[key]

    def definitions(self):
        """{function name: source} for every .c of the submission that may be linked with
        another exercise's tests: no main(), no Criterion test, not in a hidden folder."""
        if not hasattr(self, "_definitions"):
            self._definitions = {}
            for src in sorted(self.submission.rglob("*.c")):
                if ignored(src.relative_to(self.submission).parts):
                    continue
                text = src.read_text(errors="replace")
                if CRITERION_RE.search(text) or MAIN_RE.search(text):
                    continue
                code = PREPROCESSOR_RE.sub("", strip_comments(text))
                for match in DEFINITION_RE.finditer(code):
                    if not re.search(r"\bstatic\b", match.group(0)):
                        self._definitions.setdefault(match.group(1), src)
        return self._definitions

    def missing_definitions(self, sources, link_output):
        """Other files of the submission defining the functions the link could not find: an
        exercise may use the code of another one (e.g. list functions written earlier)."""
        found = {}
        for name in sorted(set(UNDEFINED_RE.findall(link_output))):
            src = self.definitions().get(name)
            if src is not None and src not in sources:
                found.setdefault(src, []).append(name)
        return found

    def given_objects(self, folder=None):
        """Object files given with the assignment and committed with the code (e.g.
        display/display.o, delivered without its source): not in a hidden folder, not a build
        output (no .c of the same name next to it, not CMake's CMakeFiles/ or *.c.o)."""
        folder = folder or self.submission
        found = []
        for obj in sorted(folder.rglob("*.o")):
            parts = obj.relative_to(self.submission).parts
            if (ignored(parts) or obj.stem.endswith(".c")
                    or obj.with_suffix(".c").exists() or not obj.is_file()):
                continue
            found.append(obj)
        return found

    def object_definitions(self):
        """{function name: object file} for the given object files of the submission (nm)."""
        if not hasattr(self, "_object_definitions"):
            self._object_definitions = {}
            for obj in self.given_objects():
                res = run(["nm", "-P", "--defined-only", "-g", str(obj)], timeout=BUILD_TIMEOUT)
                if res["code"] != 0:
                    continue
                for line in (res["output"] or "").splitlines():
                    fields = line.split()
                    if len(fields) >= 2 and fields[1] in ("T", "D", "B", "R") and IDENT_RE.match(fields[0]):
                        self._object_definitions.setdefault(fields[0], obj)
        return self._object_definitions

    def missing_objects(self, given, link_output):
        """Given object files defining functions the link could not find, when no source file of
        the submission defines them (e.g. display functions of display/display.o)."""
        found = {}
        for name in sorted(set(UNDEFINED_RE.findall(link_output))):
            obj = self.object_definitions().get(name)
            if obj is not None and obj not in given and name not in self.definitions():
                found.setdefault(obj, []).append(name)
        return found

    def link_failure(self, unit, output):
        """Explicit reason for a failed link, naming the functions."""
        missing = sorted(set(UNDEFINED_RE.findall(output)))
        twice = sorted(set(MULTIPLE_RE.findall(output)))
        if missing and self.validation:
            return ("Link failed: no empty implementation defines %s. Remouline generates them from the "
                    "prototypes of the headers under headers/ and of the test file %s: declare %s in one of them."
                    % (", ".join(missing), unit.rel, "them" if len(missing) > 1 else "it"))
        if missing:
            return ("Link failed: the tests call %s, defined nowhere in your code: check the name and the "
                    "prototype against the subject." % ", ".join(missing))
        if twice:
            return "Link failed: %s is defined more than once." % ", ".join(twice)
        return "Link failed: a function required by the tests is missing or has the wrong name/signature."

    def headers_named(self, name, unit):
        """Headers of the submission matching an #include "name", closest to the exercise first."""
        target = Path(name)
        found = [h for h in self.submission.rglob(target.name) if h.is_file()
                 and not any(p.startswith(".") for p in h.relative_to(self.submission).parts)
                 and str(h).endswith("/" + str(target).lstrip("./"))]
        base = (unit.exercise_dir or self.submission).relative_to(self.submission).parts

        def closeness(h):
            parts = h.relative_to(self.submission).parts
            common = 0
            while common < min(len(parts), len(base)) and parts[common] == base[common]:
                common += 1
            return (-common, str(h))
        return sorted(found, key=closeness)

    def header_folder(self, unit, output, include_dirs):
        """The test file includes a header that is in the submission but not on the include path
        (e.g. a shared header of a sibling exercise): the folder to add, or None."""
        match = MISSING_HEADER_RE.search(output)
        if not match:
            return None
        for header in self.headers_named(match.group(1), unit):
            folder = header.parent
            for _ in Path(match.group(1)).parts[:-1]:
                folder = folder.parent
            if folder not in include_dirs:
                return folder
        return None

    def unreachable_header(self, unit, output):
        """Explicit reason when the user's code includes a header that exists in the submission
        but not on the include path given by the assignment's flags."""
        match = MISSING_HEADER_RE.search(output)
        if not match:
            return None
        found = self.headers_named(match.group(1), unit)
        if not found:
            return None
        folder = found[0].parent.relative_to(self.submission)
        if self.validation:
            return ('The headers put "%s" in %s/, which is not on the include path: the students\' code '
                    'includes it like the tests do. If the subject compiles with "-I %s/", add it to the '
                    'default flags in remouline/flags.txt; otherwise put the header where the subject does.'
                    % (match.group(1), folder, folder))
        return ('"%s" is in %s/, which is not on the include path with the assignment\'s flags (%s): '
                "put it where the subject asks." % (match.group(1), folder, " ".join(self.flags_for(unit)) or "none"))

    def missing_header(self, unit, output):
        """Explicit reason when a test file includes a header found nowhere."""
        match = MISSING_HEADER_RE.search(output)
        if not match:
            return None
        own = "/".join(x for x in [unit.rel_dir, unit.exercise] if x)
        if self.validation:
            return ('The test file %s includes "%s", but no header of that name is given under headers/ '
                    "(e.g. headers/%s/%s, or where the subject puts it)." % (unit.rel, match.group(1), own, match.group(1)))
        return 'The tests include "%s", which is missing from your submission (expected in %s/ or where the subject puts it).' % (
            match.group(1), own)

    def link(self, unit, objects, test_obj, variant, given=()):
        """`given`: object files given with the assignment that the tests need (missing_objects)."""
        out = self.build_root / ("bin-%s-%s" % (re.sub(r"[^A-Za-z0-9]+", "_", unit.rel), variant))
        extra = ASAN_FLAGS if variant == "asan" else []
        archives = [str(a) for a in self.project_archives(unit)]
        res = run(["gcc", *extra, *[str(o) for o in objects], *[str(o) for o in given], str(test_obj), *archives,
                   "-o", str(out), "-lcriterion", *self.link_flags(unit)], timeout=BUILD_TIMEOUT)
        return res["code"] == 0, out, res["output"] or ""

    def build(self, unit):
        """Returns dict(ok, test_error, log, binaries={'asan','plain'}, student_sources)."""
        if unit.exercise_dir is None:
            own = "/".join(x for x in [unit.rel_dir, unit.exercise] if x)
            expected = "%s/ (or %s/%s.c)" % (own, unit.rel_dir, unit.exercise) if unit.rel_dir else "%s/" % own
            if self.validation:
                reason = ("No empty implementation was generated for %s (expected in %s): give the exercise's "
                          "header under headers/%s/ or headers/%s/, include it from the test file, or declare the "
                          "prototypes the tests call in the test file." % (unit.rel, expected, own, unit.rel_dir or "."))
            else:
                reason = "Exercise folder not found: expected %s in your submission." % expected
            return {"ok": False, "log": reason, "reason": reason}
        include_dirs = [unit.exercise_dir, unit.test_file.parent]
        if (self.submission / "include").is_dir():
            include_dirs.append(self.submission / "include")
        if unit.rel_dir and (self.submission / unit.rel_dir).is_dir():
            include_dirs.append(self.submission / unit.rel_dir)
        if unit.project:
            include_dirs += self.project_header_dirs(unit)
        include_dirs += [d for d in self.flag_include_dirs(unit) if d not in include_dirs]
        logs = []

        if unit.mode == "makefile":
            ok, text, reason = self.run_make(unit)
            logs.append(text)
            if not ok:
                return {"ok": False, "log": "\n".join(logs), "reason": reason}
            objects = {"asan": [], "plain": []}
            student_sources = [p for p in unit.exercise_dir.rglob("*.c")]
        elif unit.mode == "program":
            ok, text, student_sources = self.build_program(unit)
            logs.append(text)
            if not ok:
                return {"ok": False, "log": "\n".join(logs),
                        "reason": "Compilation failed (%s)." % " ".join(self.flags_for(unit))}
            objects = {"asan": [], "plain": []}
        else:
            sources, problem = self.sources_for(unit)
            if problem:
                return {"ok": False, "log": problem, "reason": problem}
            if unit.uses_makefile:
                logs.append(self.makefile_flags(unit)[1])
            linked = self.linked_sources(unit, sources)
            if linked:
                logs.append("Also compiling code used from other exercises: %s"
                            % ", ".join(str(s.relative_to(self.submission)) for s in linked))
            sources = sources + linked
            objects = {}
            # The plain build first when there is one: its log shows exactly the assignment's flags.
            for index, variant in enumerate(reversed(self.variants(unit))):
                ok, objs, text = self.compile_objects(unit, sources, variant)
                if index == 0:
                    logs.append(text)
                if not ok:
                    reason = self.unreachable_header(unit, text) or (
                        "Compilation failed (%s)." % " ".join(self.flags_for(unit))
                        if index == 0 else "Compilation with sanitizers failed.")
                    return {"ok": False, "log": "\n".join(logs), "reason": reason}
                objects[variant] = objs
            student_sources = sources

        binaries = {}
        given = []
        for variant in self.variants(unit):
            ok, test_obj, output = self.compile_test_object(unit, variant, include_dirs)
            for _ in range(5):
                folder = None if ok else self.header_folder(unit, output, include_dirs)
                if folder is None:
                    break
                include_dirs.append(folder)
                ok, test_obj, output = self.compile_test_object(unit, variant, include_dirs)
            if not ok:
                header = self.missing_header(unit, output)
                if self.validation:
                    # The assignment's own headers are used: the test file itself is wrong.
                    return {"ok": True, "log": "\n".join(logs), "test_error": "%s\n\n%s" % (
                        header or "The test file %s does not compile against the assignment's headers." % unit.rel,
                        output)}
                logs.append("$ compile the tests of %s\n%s" % (unit.rel, output))
                return {"ok": False, "log": "\n".join(logs),
                        "reason": header or "The tests do not compile with your headers: check that their names, "
                                            "prototypes, structures and types match the subject."}
            ok, binary, output = self.link(unit, objects[variant], test_obj, variant, given)
            for _ in range(4 if unit.mode == "functions" and not ok else 0):
                # Functions of another exercise used by these tests: link the files defining them,
                # then the object files given with the assignment (which may need more of them).
                found = self.missing_definitions(student_sources, output)
                given_found = self.missing_objects(given, output)
                if not found and not given_found:
                    break
                if found:
                    logs.append("Also compiling code of other exercises used by the tests: %s" % "; ".join(
                        "%s (%s)" % (src.relative_to(self.submission), ", ".join(names)) for src, names in found.items()))
                    student_sources = student_sources + list(found)
                    for v in self.variants(unit):
                        compiled, objs, text = self.compile_objects(unit, student_sources, v)
                        if not compiled:
                            logs.append(text)
                            return {"ok": False, "log": "\n".join(logs),
                                    "reason": "Compilation failed (%s)." % " ".join(self.flags_for(unit))}
                        objects[v] = objs
                if given_found:
                    logs.append("Also linking object files given with the assignment: %s" % "; ".join(
                        "%s (%s)" % (obj.relative_to(self.submission), ", ".join(names)) for obj, names in given_found.items()))
                    given = given + list(given_found)
                ok, binary, output = self.link(unit, objects[variant], test_obj, variant, given)
            if not ok:
                logs.append("$ link with %s\n%s" % (unit.rel, output))
                return {"ok": False, "log": "\n".join(logs), "reason": self.link_failure(unit, output)}
            binaries[variant] = binary
        return {"ok": True, "log": "\n".join(logs), "binaries": binaries, "student_sources": student_sources}


# ---------------------------------------------------------------------------
# Criterion execution + result interpretation
# ---------------------------------------------------------------------------
def list_tests(binary, unit):
    res = run([str(binary), "--list"], cwd=str(unit.exercise_dir), timeout=TEST_TIMEOUT, env=sanitizer_env(False))
    tests, suite = [], None
    for line in (res["output"] or "").splitlines():
        header = re.match(r"^(\S+): \d+ tests?$", line.strip())
        if header and not line.startswith((" ", "│", "|")):
            suite = header.group(1)
            continue
        item = re.match(r"^\s*(?:├──|└──|\|--|`--)\s+(\S+)", line)
        if item and suite:
            tests.append((suite, item.group(1)))
    if not tests:
        tests = static_tests(unit.test_file.read_text(errors="replace"))
    return tests


def load_json_report(path):
    try:
        raw = path.read_bytes().decode("utf-8", "surrogateescape")
        return json.loads(raw, strict=False)
    except (OSError, ValueError):
        return None


def extract_io(message):
    """Best-effort actual/expected extraction from Criterion assertion messages."""
    if not message:
        return None, None
    text = message.strip()
    match = re.search(r'does not match the (?:string|file contents?)\s+"(.*)"', text, re.DOTALL)
    if match:
        return None, match.group(1)
    match = re.search(r"[Ee]xpected\s*:?\s*(.+?)[,;]?\s+(?:but\s+)?(?:got|received|was|returned)\s*:?\s*(.+?)\.?\s*\Z",
                      text, re.DOTALL)
    if match:
        return match.group(2).strip(), match.group(1).strip()
    actual = re.search(r"(?im)^\s*(?:actual|got|result)\s*[:=]\s*(.+)$", text)
    expected = re.search(r"(?im)^\s*expected\s*[:=]\s*(.+)$", text)
    if actual or expected:
        return (actual.group(1).strip() if actual else None), (expected.group(1).strip() if expected else None)
    match = re.search(r"(?s)Actual:\s*(.+?)\s*Expected:\s*(.+)$", text)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return None, None


def find_test_json(report, suite, name):
    if not report:
        return None
    for s in report.get("test_suites", []):
        if s.get("name") != suite:
            continue
        for t in s.get("tests", []):
            if t.get("name") == name:
                return t
    return None


def text_fallback(raw, suite, name, code):
    if sanitizer_error(raw) or "Unexpected signal" in raw or "CRASH" in raw:
        return {"status": "ERRORED", "messages": []}
    if "[FAIL] %s::%s" % (suite, name) in raw:
        lines = [re.sub(r"^\[----\]\s?", "", l) for l in raw.splitlines() if l.startswith("[----]")]
        lines = [l for l in lines if l.strip() and "Assertion Failed" not in l]
        return {"status": "FAILED", "messages": ["\n".join(l.strip() for l in lines)]}
    if code == 0:
        return {"status": "PASSED", "messages": []}
    return None


CRASH_HINTS = [
    ("stack-overflow", "Stack overflow (infinite recursion?)"),
    ("heap-buffer-overflow", "Heap buffer overflow"),
    ("stack-buffer-overflow", "Stack buffer overflow"),
    ("heap-use-after-free", "Use after free"),
    ("double-free", "Double free"),
    ("SEGV", "Segmentation fault"),
    ("attempting free on address", "Invalid free"),
    ("runtime error", "Undefined behavior"),
]


def describe_crash(raw):
    for needle, label in CRASH_HINTS:
        if needle in (raw or ""):
            return label
    return "The test crashed"


def run_single_test(binary, unit, suite, name, tmp_dir, index, leaks=False):
    json_path = tmp_dir / ("r%d.json" % index)
    if json_path.exists():
        json_path.unlink()
    # No --quiet: it would also swallow the sanitizer report printed by the test process.
    cmd = [str(binary), "--filter", "%s/%s" % (suite, name), "-j1", "--json=%s" % json_path]
    res = run(cmd, cwd=str(unit.exercise_dir), timeout=TEST_TIMEOUT, env=sanitizer_env(leaks))
    raw = "\n".join(line for line in (res["output"] or "").splitlines()
                    if not line.startswith("[====] Synthesis")).strip()
    base = {"duration_ms": res["duration_ms"]}
    if res["timed_out"]:
        return dict(base, status="timeout", raw_output=raw or None,
                    error_message="Timeout: the test did not finish within %ds (infinite loop or blocking read?)." % TEST_TIMEOUT)
    report = load_json_report(json_path)
    data = find_test_json(report, suite, name)
    if data is None:
        # Criterion does not escape quotes inside assertion messages, so its JSON can be
        # invalid: fall back to its text output (and exit code, 0 = the test passed).
        data = text_fallback(raw, suite, name, res["code"])
    messages = [clean(m) for m in (data or {}).get("messages", []) if m]
    message = "\n".join(messages) or None
    status_raw = (data or {}).get("status", "")
    if status_raw == "PASSED":
        return dict(base, status="pass", raw_output=raw or None)
    if status_raw == "SKIPPED":
        return dict(base, status="skipped", error_message=message or "Skipped by the testsuite.")
    crashed = status_raw == "ERRORED" or sanitizer_error(raw) or (res["code"] or 0) < 0
    if status_raw == "FAILED" and not crashed:
        actual, expected = extract_io(message)
        return dict(base, status="fail", error_message=message or "Assertion failed.",
                    actual_output=actual, expected_output=expected, raw_output=raw or None)
    if crashed or data is None:
        label = describe_crash(raw)
        detail = message if message and message != "The test crashed." else None
        return dict(base, status="crash", error_message=label + (": " + detail if detail else "."),
                    raw_output=raw or "No output was captured (the process was killed by a signal).")
    return dict(base, status="error", error_message=message or "Unknown Criterion status %r." % status_raw,
                raw_output=raw or None)


LEAK_PROBE = """#include <stdlib.h>

__attribute__((noinline)) static void lose(void)
{
    char *volatile block = malloc(7);

    block[0] = 1;
}

int main(void)
{
    for (int i = 0; i < 16; i++)
        lose();
    return 0;
}
"""
LEAK_BLOCK_RE = re.compile(r"^(?:Direct|Indirect) leak of .*?(?=\n[ \t]*\n|\Z)", re.MULTILINE | re.DOTALL)


def leak_sanitizer_works(build_root):
    """LeakSanitizer needs ptrace, which a sandbox may forbid: checked once per run on a
    program that leaks, valgrind is used instead when it reports nothing."""
    src, exe = build_root / "leak_probe.c", build_root / "leak_probe"
    src.write_text(LEAK_PROBE)
    if run(["gcc", *ASAN_FLAGS, str(src), "-o", str(exe)], timeout=BUILD_TIMEOUT)["code"] != 0:
        return False
    res = run([str(exe)], timeout=TEST_TIMEOUT, env=sanitizer_env(True))
    return "LeakSanitizer: detected memory leaks" in (res["output"] or "")


def leaks_in(raw, student_files):
    """LeakSanitizer reports (printed when the test process exits) of memory allocated by the
    user's code: "#1 0x... in my_strdup /work/submission/.../my_strdup.c:12"."""
    flagged = []
    for block in LEAK_BLOCK_RE.findall(raw or ""):
        if any(re.search(r"[ /]%s:\d" % re.escape(f), block) for f in student_files):
            flagged.append(block.strip())
    return flagged


VALGRIND_KEYWORDS = ("Invalid read", "Invalid write", "Invalid free", "Mismatched free", "uninitialised",
                     "definitely lost", "indirectly lost", "Source and destination overlap", "Conditional jump",
                     "Syscall param")


def run_valgrind(binary, unit, suite, name, vg_dir, index, student_files):
    if not shutil.which("valgrind"):
        return None, "valgrind is not installed in the runner image; memory check skipped."
    for old in vg_dir.glob("v%d.*" % index):
        old.unlink()
    cmd = ["valgrind", "--trace-children=yes", "--leak-check=full", "--show-leak-kinds=definite,indirect",
           "--errors-for-leak-kinds=definite,indirect", "--num-callers=30",
           "--log-file=%s/v%d.%%p.log" % (vg_dir, index),
           str(binary), "--filter", "%s/%s" % (suite, name), "-j1", "--quiet"]
    res = run(cmd, cwd=str(unit.exercise_dir), timeout=VALGRIND_TIMEOUT, env={"HOME": "/tmp"})
    if res["timed_out"]:
        return None, "valgrind did not finish within %ds; memory check skipped for this test." % VALGRIND_TIMEOUT
    flagged = []
    for log in sorted(vg_dir.glob("v%d.*.log" % index)):
        text = clean(log.read_bytes())
        blocks = re.split(r"\n==\d+==\s*\n", text)
        for block in blocks:
            if not any(k in block for k in VALGRIND_KEYWORDS):
                continue
            if any("(%s:" % f in block for f in student_files):
                flagged.append(block.strip())
    if flagged:
        return False, cap("\n\n".join(flagged))
    return True, None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", default="/work")
    parser.add_argument("--slug", required=True)
    # Validation runs (empty implementations built from the assignment's headers) only need
    # pass/fail: no memory check, and a test file that does not compile is the testsuite's fault.
    parser.add_argument("--validation", action="store_true")
    args = parser.parse_args()

    started = time.monotonic()
    work = Path(args.work)
    submission = work / "submission"
    tests_root = work / "tests"
    out_dir = work / "out"
    build_root = work / "build"
    tmp_dir = out_dir / "tmp"
    vg_dir = out_dir / "valgrind"
    for d in (build_root, tmp_dir, vg_dir):
        d.mkdir(parents=True, exist_ok=True)

    results = []

    test_files = sorted(str(p.relative_to(tests_root)).replace("\\", "/") for p in tests_root.rglob("*.c"))
    # Compilation flags of the assignment (written by the worker, read before any student code runs).
    config_path = work / "config.json"
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    makefile_keys = set(config.get("makefile") or [])
    # Tests of the published testsuite as Criterion listed them during its validation, so a
    # failed build lists exactly the tests a successful one runs (same total for everyone).
    known_tests = {}
    for category_path, test_name in config.get("tests") or []:
        prefix, _, suite = category_path.rpartition("/")
        known_tests.setdefault(prefix, []).append((suite, test_name))
    # Exercises tested from each folder: a project's tests decide together (is_project).
    exercises = {}
    for rel in test_files:
        exercises.setdefault(str(Path(rel).parent), set()).add(category_parts(rel)[-1])
    units = [Unit(tests_root, submission, rel, makefile_keys, exercises[str(Path(rel).parent)])
             for rel in test_files]
    leak_sanitizer = not args.validation and leak_sanitizer_works(build_root)
    if not args.validation:
        print("memory check: %s" % ("LeakSanitizer (valgrind for programs)" if leak_sanitizer
                                    else "valgrind (LeakSanitizer cannot run here)"))
    builder = Builder(submission, build_root, config, validation=args.validation, leak_sanitizer=leak_sanitizer)
    build_leaves = {}
    test_leaves = []
    counter = 0

    for unit in units:
        built = builder.build(unit)
        build_key = (unit.build_path, unit.exercise)
        previous = build_leaves.get(build_key)
        if not built["ok"]:
            build_leaves[build_key] = leaf(unit.build_path, unit.exercise, "fail",
                                           error_message=built.get("reason"), raw_output=built["log"] or None)
        elif previous is None or previous["status"] == "pass":
            build_leaves[build_key] = leaf(unit.build_path, unit.exercise, "pass", raw_output=built["log"] or None)

        prefix = "/".join(["Testsuite", *unit.parts])
        if not built["ok"] or built.get("test_error"):
            names = (known_tests.get(prefix) or static_tests(unit.test_file.read_text(errors="replace"))
                     or [("tests", unit.exercise)])
            for suite, name in names:
                if built.get("test_error"):
                    test_leaves.append(leaf("%s/%s" % (prefix, suite), name, "error",
                                            error_message="The testsuite for this exercise could not be compiled.",
                                            raw_output=cap(clean(built["test_error"]))))
                else:
                    test_leaves.append(leaf("%s/%s" % (prefix, suite), name, "skipped",
                                            error_message="Not run: the build failed (see the Build section). %s"
                                            % (built.get("reason") or "")))
            continue

        student_files = sorted({p.name for p in built["student_sources"]})
        valgrind = builder.uses_valgrind(unit)
        leaks = not args.validation and not valgrind
        for suite, name in list_tests(built["binaries"]["asan"], unit):
            counter += 1
            outcome = run_single_test(built["binaries"]["asan"], unit, suite, name, tmp_dir, counter, leaks=leaks)
            item = leaf("%s/%s" % (prefix, suite), name, outcome.pop("status"), **outcome)
            if item["status"] == "pass" and leaks:
                flagged = leaks_in(item["raw_output"], student_files)
                item["valgrind_ok"] = not flagged
                if flagged:
                    item["status"] = "memory_error"
                    item["valgrind_details"] = cap("\n\n".join(flagged))
                    item["error_message"] = "The test passed, but LeakSanitizer found memory leaks in your code."
            elif item["status"] == "pass" and valgrind:
                if time.monotonic() - started < VALGRIND_BUDGET:
                    ok, details = run_valgrind(built["binaries"]["plain"], unit, suite, name, vg_dir, counter, student_files)
                    item["valgrind_ok"] = ok
                    item["valgrind_details"] = details
                    if ok is False:
                        item["status"] = "memory_error"
                        item["error_message"] = "The test passed, but valgrind found memory errors in your code."
                else:
                    item["valgrind_details"] = "Memory check skipped: time budget exhausted."
            test_leaves.append(item)

    if not units:
        results.append(leaf("Testsuite", "No tests", "error", error_message="This assignment has no Criterion test file."))

    results.extend(build_leaves.values())
    results.extend(test_leaves)
    passed = sum(1 for r in results if r["status"] == "pass" and r["valgrind_ok"] is not False)
    report = {
        "version": 1,
        "slug": args.slug,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "summary": {"passed": passed, "total": len(results)},
        "results": results,
    }
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    print("report written: %d/%d passed" % (passed, len(results)))


if __name__ == "__main__":
    main()
