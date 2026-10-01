// Compilation flags of an assignment: one default set (e.g.
// "-std=c99 -pedantic -Werror -Wall -Wextra -Wvla") and per-exercise exceptions
// (e.g. an exercise allowed to drop -std=c99 to use getline). Text format, used both
// in the admin panel and in the "remouline/flags.txt" file of a testsuite bundle:
//
//   default: -std=c99 -pedantic -Werror -Wall -Wextra -Wvla
//   file_io: -pedantic -Werror -Wall -Wextra -Wvla
//   fundamentals: makefile
//
// An exercise is matched by its folder name ("file_io") or its path
// ("Fundamentals/file_io"). "makefile" means the assignment provides or requires a
// Makefile for that folder: the pipeline builds programs with it and reads the
// compilation flags from it. Without that line, a student's Makefile is never run.
import { config } from './config.js';

const FLAG_RE = /^-[A-Za-z0-9_=+.,:-]+$/;
// Flags that could redirect output, load code or change the toolchain are refused.
const FORBIDDEN = /^-(o|B|wrapper|fplugin|specs|x|E|S|c|M)/;
const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
export const MAKEFILE = 'makefile';

const fail = (message) => Object.assign(new Error(message), { status: 400 });

export function parseFlagList(text) {
  const flags = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  for (const f of flags) {
    if (!FLAG_RE.test(f) || FORBIDDEN.test(f)) throw fail(`Invalid or forbidden compilation flag: ${f}`);
  }
  if (flags.length > 40) throw fail('Too many compilation flags.');
  return flags;
}

/** "default: ..." + "<exercise>: ..." lines -> { defaultFlags: string|null, overrides: string } */
export function parseFlagsFile(text) {
  let defaultFlags = null;
  const overrides = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([^:]+):(.*)$/.exec(line);
    if (!m) throw fail(`Invalid flags line (expected "exercise: flags"): ${line}`);
    const key = m[1].trim();
    const value = m[2].trim();
    if (key === 'default') {
      if (value.toLowerCase() === MAKEFILE) throw fail('"makefile" is set per folder ("fundamentals: makefile"), not as the default.');
      defaultFlags = parseFlagList(value).join(' ');
    } else if (!KEY_RE.test(key)) {
      throw fail(`Invalid exercise name in flags: ${key}`);
    } else {
      overrides.push(`${key}: ${value.toLowerCase() === MAKEFILE ? MAKEFILE : parseFlagList(value).join(' ')}`);
    }
  }
  return { defaultFlags, overrides: overrides.join('\n') };
}

/** Normalizes the overrides text typed in the admin panel (throws on invalid input). */
export function normalizeOverrides(text) {
  const { defaultFlags, overrides } = parseFlagsFile(text);
  if (defaultFlags) throw fail('Put the default flags in the "Default flags" field, not in the exceptions.');
  return overrides;
}

/** Config file handed to the pipeline (runner/pipeline.py reads /work/config.json). */
export function pipelineConfig(assignment) {
  const overrides = {};
  const makefile = [];
  const { overrides: lines } = parseFlagsFile(assignment?.flag_overrides ?? '');
  for (const line of lines.split('\n').filter(Boolean)) {
    const [key, flags] = line.split(/:\s*/);
    if (flags === MAKEFILE) makefile.push(key);
    else overrides[key] = flags.split(/\s+/).filter(Boolean);
  }
  return {
    default_flags: parseFlagList(assignment?.compile_flags || config.defaultCompileFlags),
    overrides,
    makefile,
  };
}
