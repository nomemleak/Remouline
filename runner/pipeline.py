#!/usr/bin/env python3
"""Remouline correction pipeline, executed INSIDE the sandboxed runner container.

Layout (bind-mounted by the worker):
    /work/submission/   content of the student's <slug>/ folder (read-write, builds happen here)
    /work/tests/        Criterion files of the assignment (read-only)
    /work/out/          report.json is written here

Order: build -> Criterion tests -> valgrind on passing tests. Tests of an exercise whose
build failed are reported as "skipped" with an explicit reason instead of being attempted.

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
ASAN_FLAGS = ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
SANITIZER_ENV = {
    # Leaks are checked by valgrind; LeakSanitizer cannot run without ptrace in the sandbox.
    "ASAN_OPTIONS": "detect_leaks=0:abort_on_error=1:symbolize=1:print_legend=0",
    # abort (signal) rather than exit(1), so Criterion reports a crash and not a plain failure.
    "UBSAN_OPTIONS": "print_stacktrace=1:halt_on_error=1:abort_on_error=1",
}

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


class Unit:
    """One test file + the exercise it targets."""

    def __init__(self, tests_root, submission, rel, makefile_keys=()):
        self.rel = rel
        self.test_file = tests_root / rel
        self.parts = category_parts(rel)
        self.exercise = self.parts[-1]
        rel_dir = str(Path(rel).parent).replace("\\", "/")
        self.rel_dir = "" if rel_dir == "." else rel_dir
        # The exercise lives either in its own folder (<dir>/<exercise>/) or directly in <dir>/.
        candidates = ["/".join(x for x in [self.rel_dir, self.exercise] if x), self.rel_dir]
        self.exercise_dir = None
        self.exercise_rel = None
        for candidate in candidates:
            path = submission / candidate if candidate else submission
            if path.is_dir():
                self.exercise_dir = path
                self.exercise_rel = candidate or "."
                break
        self.mode = None
        # Project layout: the test file sits in a project folder (e.g. fundamentals/, with
        # src/ and include/, often a Makefile) and tests several of its modules, one test
        # file per module (test_physics.c, test_records.c...): every .c of the project counts.
        self.project = (
            self.exercise_dir is not None
            and self.exercise_rel == (self.rel_dir or ".")
            and self.exercise_dir.name != self.exercise
            and not (self.exercise_dir / (self.exercise + ".c")).exists()
            and ((self.exercise_dir / "src").is_dir() or (self.exercise_dir / "include").is_dir())
        )
        # The assignment says this folder is built with its Makefile ("<folder>: makefile" in
        # its flags, or "*: makefile" for every folder that has one). Otherwise a Makefile
        # found in the submission is never run.
        self.uses_makefile = self.exercise_dir is not None and (
            any(key in makefile_keys for key in (self.exercise_rel, "/".join(self.parts), self.exercise))
            or ("*" in makefile_keys and any((self.exercise_dir / m).is_file() for m in ("Makefile", "makefile"))))
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


def read_makefile_flags(folder, rel):
    """Flags used by the compile commands that `make -n` prints for this folder."""
    if not (folder / "Makefile").exists() and not (folder / "makefile").exists():
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
    def __init__(self, submission, build_root, config=None, valgrind=True):
        self.submission = submission
        self.build_root = build_root
        # "plain" (uninstrumented) binaries only exist for valgrind.
        self.variants = ("asan", "plain") if valgrind else ("asan",)
        self.make_cache = {}
        self.obj_cache = {}
        config = config or {}
        self.default_flags = config.get("default_flags") or STRICT_FLAGS
        self.overrides = config.get("overrides") or {}

    def flags_for(self, unit):
        """Assignment flags, or the exercise's own flags when the subject says so. Sanitizer
        flags are dropped: the pipeline builds its own AddressSanitizer/UBSan variant, and the
        plain variant must stay uninstrumented for valgrind."""
        flags = self.default_flags
        from_makefile = self.makefile_flags(unit)[0] if unit.uses_makefile and unit.mode == "functions" else None
        if from_makefile is not None:
            flags = from_makefile
        else:
            for key in (unit.exercise_rel, "/".join(unit.parts), unit.exercise):
                if key in self.overrides:
                    flags = self.overrides[key]
                    break
        return [f for f in flags if not f.startswith(("-fsanitize", "-fno-sanitize"))]

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
            if header.parent not in dirs and not any(p.startswith(".") for p in header.relative_to(unit.exercise_dir).parts):
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
            if any(p.startswith(".") for p in src.relative_to(unit.exercise_dir).parts):
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
        flags = [f for f in self.flags_for(unit) if not f.startswith("-l")]
        key = (tuple(str(s) for s in sources), variant, tuple(flags))
        if key in self.obj_cache:
            return self.obj_cache[key]
        out_dir = self.build_root / ("objs-%d-%s" % (len(self.obj_cache), variant))
        out_dir.mkdir(parents=True, exist_ok=True)
        objects, logs, ok = [], [], True
        extra = ASAN_FLAGS if variant == "asan" else []
        for index, src in enumerate(sources):
            obj = out_dir / ("%d_%s.o" % (index, src.stem))
            cmd = ["gcc", *flags, "-g", *extra, "-I", str(src.parent), *self.shared_includes(unit),
                   "-c", str(src), "-o", str(obj)]
            res = run(cmd, timeout=BUILD_TIMEOUT)
            display = " ".join(["gcc", *flags, "-c", str(src.relative_to(self.submission))])
            logs.append("$ %s\n%s" % (display, res["output"] or ""))
            if res["code"] != 0:
                ok = False
                break
            objects.append(obj)
        result = (ok, objects, "\n".join(logs).strip())
        self.obj_cache[key] = result
        return result

    def run_make(self, unit):
        key = str(unit.exercise_dir)
        if key not in self.make_cache:
            res = run(["make", "-C", str(unit.exercise_dir)], timeout=BUILD_TIMEOUT)
            text = "$ make -C %s\n%s" % (unit.exercise_rel, res["output"] or "")
            if res["timed_out"]:
                text += "\nmake timed out after %ds." % BUILD_TIMEOUT
            self.make_cache[key] = (res["code"] == 0 and not res["timed_out"], text.strip())
        return self.make_cache[key]

    def compile_test_object(self, unit, variant, include_dirs):
        out = self.build_root / ("test-%s-%s.o" % (re.sub(r"[^A-Za-z0-9]+", "_", unit.rel), variant))
        extra = ASAN_FLAGS if variant == "asan" else []
        includes = []
        for d in include_dirs:
            includes += ["-I", str(d)]
        res = run(["gcc", "-w", "-g", *extra, *includes, "-c", str(unit.test_file), "-o", str(out)], timeout=BUILD_TIMEOUT)
        return res["code"] == 0, out, res["output"] or ""

    def link_flags(self, unit):
        """Libraries must also be given at link time: -l*, -pthread from the flags, plus -lm
        (math.h functions) which never hurts."""
        flags = [f for f in self.flags_for(unit) if f.startswith("-l") or f == "-pthread"]
        return flags + ([] if "-lm" in flags else ["-lm"])

    def build_program(self, unit):
        """No Makefile, but the tests run ./binary: compile every .c of the folder into it."""
        key = "program:%s" % unit.exercise_dir
        if key in self.make_cache:
            return self.make_cache[key]
        sources = self.project_sources(unit, with_main=True) if unit.project else sorted(unit.exercise_dir.glob("*.c"))
        sources += self.linked_sources(unit, sources)
        flags = self.flags_for(unit)
        logs, ok = [], bool(sources)
        if not sources:
            logs.append("No source file found in %s/." % unit.exercise_rel)
        for name in unit.binaries if sources else []:
            cmd = ["gcc", *flags, "-g", "-I", str(unit.exercise_dir), *self.shared_includes(unit),
                   *[str(s) for s in sources], *[str(a) for a in self.project_archives(unit)],
                   "-o", str(unit.exercise_dir / name), *self.link_flags(unit)]
            res = run(cmd, timeout=BUILD_TIMEOUT)
            shown = " ".join(str(s.relative_to(self.submission)) for s in sources)
            logs.append("$ gcc %s %s -o %s\n%s" % (" ".join(flags), shown, name, res["output"] or ""))
            if res["code"] != 0:
                ok = False
                break
        self.make_cache[key] = (ok, "\n".join(logs).strip(), sources)
        return self.make_cache[key]

    def link(self, unit, objects, test_obj, variant):
        out = self.build_root / ("bin-%s-%s" % (re.sub(r"[^A-Za-z0-9]+", "_", unit.rel), variant))
        extra = ASAN_FLAGS if variant == "asan" else []
        archives = [str(a) for a in self.project_archives(unit)]
        res = run(["gcc", *extra, *[str(o) for o in objects], str(test_obj), *archives, "-o", str(out), "-lcriterion",
                   *self.link_flags(unit)], timeout=BUILD_TIMEOUT)
        return res["code"] == 0, out, res["output"] or ""

    def build(self, unit):
        """Returns dict(ok, test_error, log, binaries={'asan','plain'}, student_sources)."""
        if unit.exercise_dir is None:
            return {"ok": False, "log": "Exercise folder not found in your submission: %s" % (unit.rel_dir or "."),
                    "reason": "Exercise folder not found."}
        include_dirs = [unit.exercise_dir, unit.test_file.parent]
        if (self.submission / "include").is_dir():
            include_dirs.append(self.submission / "include")
        if unit.rel_dir and (self.submission / unit.rel_dir).is_dir():
            include_dirs.append(self.submission / unit.rel_dir)
        if unit.project:
            include_dirs += self.project_header_dirs(unit)
        logs = []

        if unit.mode == "makefile":
            ok, text = self.run_make(unit)
            logs.append(text)
            if not ok:
                return {"ok": False, "log": "\n".join(logs), "reason": "make failed."}
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
            for index, variant in enumerate(reversed(self.variants)):
                ok, objs, text = self.compile_objects(unit, sources, variant)
                if index == 0:
                    logs.append(text)
                if not ok:
                    reason = ("Compilation failed (%s)." % " ".join(self.flags_for(unit))
                              if index == 0 else "Compilation with sanitizers failed.")
                    return {"ok": False, "log": "\n".join(logs), "reason": reason}
                objects[variant] = objs
            student_sources = sources

        binaries = {}
        for variant in self.variants:
            ok, test_obj, output = self.compile_test_object(unit, variant, include_dirs)
            if not ok:
                return {"ok": True, "log": "\n".join(logs), "test_error": "The test file %s does not compile. "
                        "This is a problem with the testsuite, not with your code.\n\n%s" % (unit.rel, output)}
            ok, binary, output = self.link(unit, objects[variant], test_obj, variant)
            if not ok:
                logs.append("$ link with %s\n%s" % (unit.rel, output))
                return {"ok": False, "log": "\n".join(logs),
                        "reason": "Link failed: a function required by the tests is missing or has the wrong name/signature."}
            binaries[variant] = binary
        return {"ok": True, "log": "\n".join(logs), "binaries": binaries, "student_sources": student_sources}


# ---------------------------------------------------------------------------
# Criterion execution + result interpretation
# ---------------------------------------------------------------------------
def list_tests(binary, unit):
    res = run([str(binary), "--list"], cwd=str(unit.exercise_dir), timeout=TEST_TIMEOUT, env=SANITIZER_ENV)
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
    if "AddressSanitizer" in raw or "runtime error" in raw or "Unexpected signal" in raw or "CRASH" in raw:
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


def run_single_test(binary, unit, suite, name, tmp_dir, index):
    json_path = tmp_dir / ("r%d.json" % index)
    if json_path.exists():
        json_path.unlink()
    # No --quiet: it would also swallow the sanitizer report printed by the test process.
    cmd = [str(binary), "--filter", "%s/%s" % (suite, name), "-j1", "--json=%s" % json_path]
    res = run(cmd, cwd=str(unit.exercise_dir), timeout=TEST_TIMEOUT, env=SANITIZER_ENV)
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
    crashed = status_raw == "ERRORED" or "AddressSanitizer" in raw or "runtime error" in raw or (res["code"] or 0) < 0
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
    # Validation runs (empty implementations) only need pass/fail: no valgrind, no plain build.
    parser.add_argument("--no-valgrind", action="store_true")
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
    units = [Unit(tests_root, submission, rel, makefile_keys) for rel in test_files]
    builder = Builder(submission, build_root, config, valgrind=not args.no_valgrind)
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
            names = static_tests(unit.test_file.read_text(errors="replace")) or [("tests", unit.exercise)]
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
        for suite, name in list_tests(built["binaries"]["asan"], unit):
            counter += 1
            outcome = run_single_test(built["binaries"]["asan"], unit, suite, name, tmp_dir, counter)
            item = leaf("%s/%s" % (prefix, suite), name, outcome.pop("status"), **outcome)
            if item["status"] == "pass" and not args.no_valgrind:
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
