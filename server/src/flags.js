// Compilation flags of an assignment: one default set (e.g.
// "-std=c99 -pedantic -Werror -Wall -Wextra -Wvla") and per-exercise exceptions
// (e.g. an exercise allowed to drop -std=c99 to use getline). Text format, used both
// in the admin panel and in the "remouline/flags.txt" file of a testsuite bundle
// (docs/BUNDLE-FORMAT.md):
//
//   default: -std=c99 -pedantic -Werror -Wall -Wextra -Wvla
//   file_io: -pedantic -Werror -Wall -Wextra -Wvla
//   fundamentals: makefile
//
// An exercise is matched by its folder name ("file_io") or its path
// ("Fundamentals/file_io"). "makefile" means the assignment provides or requires a
// Makefile in that folder: the pipeline builds programs with it and reads the
// compilation flags from it. Without that line, a student's Makefile is never run.
import { config } from './config.js';

const FLAG_RE = /^-[A-Za-z0-9_=+.,:-]+$/;
// Flags that could redirect output, load code or change the toolchain are refused.
const FORBIDDEN = /^-(o|B|wrapper|fplugin|specs|x|E|S|c|M)/;
// Folder options, written "-I includes/" or "-Iincludes/": the folder is relative to the
// assignment folder (runner/pipeline.py resolves it inside the submission).
const PATH_OPTIONS = ['-iquote', '-isystem', '-I', '-L'];
// Options whose value may also be given as a separate word ("-D NAME=1").
const VALUE_OPTIONS = ['-D', '-U'];
const FOLDER_RE = /^[A-Za-z0-9_.+-]+(\/[A-Za-z0-9_.+-]+)*\/?$/;
const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
export const MAKEFILE = 'makefile';

const fail = (message) => Object.assign(new Error(message), { status: 400 });

function folderFlag(option, folder) {
  const clean = folder.replace(/^\.\//, '');
  if (!FOLDER_RE.test(clean) || clean.split('/').includes('..')) {
    throw fail(`Invalid folder for ${option}: ${folder} (a folder relative to the assignment folder is expected, e.g. ${option} includes/).`);
  }
  return `${option}${clean.replace(/\/$/, '') || '.'}`;
}

export function parseFlagList(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const flags = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const pathOption = PATH_OPTIONS.find((o) => word.startsWith(o));
    const separate = (word === pathOption || VALUE_OPTIONS.includes(word)) && i + 1 < words.length && !words[i + 1].startsWith('-');
    if (pathOption) {
      flags.push(folderFlag(pathOption, separate ? words[(i += 1)] : word.slice(pathOption.length)));
      continue;
    }
    const f = separate ? `${word}${words[(i += 1)]}` : word;
    if (!f.startsWith('-')) {
      throw fail(`"${f}" is not a compilation flag: a value must follow the option it belongs to (e.g. "-I includes/", "-D NAME=1").`);
    }
    if (!FLAG_RE.test(f) || FORBIDDEN.test(f)) throw fail(`Invalid or forbidden compilation flag: ${f}`);
    flags.push(f);
  }
  if (flags.length > 40) throw fail('Too many compilation flags.');
  return flags;
}

/** "default: ..." + "<exercise>: ..." lines -> { defaultFlags: string|null, overrides: string } */
export function parseFlagsFile(text) {
  let defaultFlags = null;
  const overrides = new Map();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([^:]+):(.*)$/.exec(line);
    if (!m) throw fail(`Invalid flags line (expected "exercise: flags"): ${line}`);
    const key = m[1].trim();
    const value = m[2].trim();
    const makefile = value.toLowerCase() === MAKEFILE;
    if (key === 'default') {
      if (makefile) {
        throw fail('"makefile" names the folder that has the Makefile: write one line per folder '
          + '("fundamentals: makefile") and keep "default:" for compilation flags.');
      }
      if (defaultFlags !== null) throw fail('"default:" is given twice.');
      defaultFlags = parseFlagList(value).join(' ');
    } else if (!KEY_RE.test(key)) {
      throw fail(`Invalid exercise name in flags: ${key}`);
    } else if (overrides.has(key)) {
      throw fail(`"${key}:" is given twice.`);
    } else {
      overrides.set(key, makefile ? MAKEFILE : parseFlagList(value).join(' '));
    }
  }
  return { defaultFlags, overrides: [...overrides].map(([key, value]) => `${key}: ${value}`).join('\n') };
}

/** Normalizes the overrides text typed in the admin panel (throws on invalid input). */
export function normalizeOverrides(text) {
  const { defaultFlags, overrides } = parseFlagsFile(text);
  if (defaultFlags) throw fail('Put the default flags in the "Default flags" field, not in the exceptions.');
  return overrides;
}

/**
 * Exceptions saved in the database. They were checked when saved, but a line an older version
 * accepted and this one refuses (e.g. "*: makefile") is ignored and listed in `ignored`
 * (shown in the admin panel) instead of failing every correction of the assignment.
 */
export function storedOverrides(text) {
  const overrides = {};
  const makefile = [];
  const ignored = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let line;
    try {
      line = parseFlagsFile(raw).overrides;
    } catch {
      ignored.push(raw.trim());
      continue;
    }
    if (!line) continue;
    const [key, flags] = line.split(/:\s*/);
    if (flags === MAKEFILE) makefile.push(key);
    else overrides[key] = flags.split(/\s+/).filter(Boolean);
  }
  return { overrides, makefile, ignored };
}

/**
 * Config file handed to the pipeline (runner/pipeline.py reads /work/config.json), from the
 * assignment's current (draft) flags. `tests`, set at publication, lists the tests as Criterion
 * listed them during validation.
 */
export function pipelineConfig(assignment) {
  const { overrides, makefile } = storedOverrides(assignment?.flag_overrides);
  return {
    default_flags: parseFlagList(assignment?.compile_flags || config.defaultCompileFlags),
    overrides,
    makefile,
  };
}

/**
 * Config frozen at publication: the validated flags, plus the tests Criterion listed on the
 * "zero" empty implementation, so a student's failed build lists exactly the tests a
 * successful one runs.
 */
export function freezeConfig(assignment, validationResults) {
  const tests = validationResults
    .filter((r) => r.category_path.startsWith('Testsuite/'))
    .map((r) => [r.category_path, r.test_name]);
  return { ...pipelineConfig(assignment), tests };
}

/** What student pushes are graded with: the config frozen at publication. */
export function publishedConfig(assignment) {
  if (assignment?.published_config) return JSON.parse(assignment.published_config);
  return pipelineConfig(assignment); // published before this snapshot existed
}

/** True when the draft flags are no longer the ones frozen at publication. */
export function draftFlagsDiffer(assignment) {
  if (!assignment?.published_config) return false;
  const { default_flags, overrides, makefile } = JSON.parse(assignment.published_config);
  return JSON.stringify(pipelineConfig(assignment)) !== JSON.stringify({ default_flags, overrides, makefile });
}
