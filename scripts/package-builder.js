'use strict';

// Build the dist/packages-dist directory in the same fashion as the legacy
// /build.sh script, by building the npm packages with Bazel and copying files.
// This is needed for scripts and tests which are not updated to the Bazel output
// layout (which always matches the input layout).
// Do not add new dependencies on this script, instead adapt scripts to use the
// new layout, and write new tests as Bazel targets.
//
// Ideally integration tests should run under bazel, and just consume the npm
// packages via `deps`. Until that works, we manually build the npm packages and then
// copy the results to the appropriate `dist` location.

const {execSync} = require('child_process');
const {existsSync, statSync} = require('fs');
const {resolve, relative} = require('path');
const {chmod, cp, mkdir, rm, set} = require('shelljs');

set('-e');


/** @type {string} The absolute path to the project root directory. */
const baseDir = resolve(`${__dirname}/..`);

/** @type {string} The command to use for running bazel. */
const bazelCmd = 'yarn --silent bazel';

/** @type {string} The absolute path to the bazel-bin directory. */
const bazelBin = exec(`${bazelCmd} info bazel-bin`, true);

/**
 * @type {string}
 * The relative path to the entry script (i.e. the one loaded when the Node.js process launched).
 * It is relative to `baseDir`.
 */
const scriptPath = relative(baseDir, require.main.filename);

module.exports = {
  baseDir,
  bazelBin,
  bazelCmd,
  buildTargetPackages,
  exec,
  scriptPath,
};

/**
 * Build the packages.
 *
 * @param {string} destPath Path to the output directory into which we copy the npm packages.
 * @param {'legacy' | 'aot'} compileMode Either `legacy` (view engine) or `aot` (ivy).
 * @param {string} description Human-readable description of the build.
 */
function buildTargetPackages(destPath, compileMode, description) {
  console.log('##################################');
  console.log(`${scriptPath}:`);
  console.log('  Building @angular/* npm packages');
  console.log(`  Mode: ${description}`);
  console.log('##################################');

  // List of targets to build, e.g. core, common, compiler, etc. Note that we want to also remove
  // all carriage return (`\r`) characters form the query output, because otherwise the carriage
  // return is part of the bazel target name and bazel will complain.
  const getTargetsCmd = `${bazelCmd} query --output=label "attr('tags', '\\[.*release-with-framework.*\\]', //packages/...) intersect kind('.*_package', //packages/...)"`;
  const targets = exec(getTargetsCmd, true).split(/\r?\n/);

  // Use `--config=release` so that snapshot builds get published with embedded version info.
  exec(`${bazelCmd} build --config=release --define=compile=${compileMode} ${targets.join(' ')}`);

  // Create the output directory.
  const absDestPath = `${baseDir}/${destPath}`;
  if (!existsSync(absDestPath)) mkdir('-p', absDestPath);

  targets.forEach(target => {
    const pkg = target.replace(/\/\/packages\/(.*):npm_package/, '$1');

    // Skip any that don't have an "npm_package" target.
    const srcDir = `${bazelBin}/packages/${pkg}/npm_package`;
    const destDir = `${absDestPath}/${pkg}`;

    if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
      console.log(`# Copy artifacts to ${destDir}`);
      rm('-rf', destDir);
      cp('-R', srcDir, destDir);
      chmod('-R', 'u+w', destDir);
    }
  });
}

/**
 * Execute a command synchronously.
 *
 * By default, the current process' stdout is used (and thus the output is not captured and returned
 * to the caller). This is necessary for showing colors and modifying already printed output, for
 * example to show progress.
 *
 * If the caller requests the output (via `captureStdout: true`), the command is run without
 * printing anything to stdout and then (once the command has completed) the whole output is printed
 * to stdout and returned to the caller.
 *
 * @param {string} cmd The command to run.
 * @param {boolean} [captureStdout=false] Whether to return the output of the command.
 * @return {string | undefined} The captured stdout output if `captureStdout: true` or `undefined`.
 */
function exec(cmd, captureStdout) {
  const output = execSync(cmd, {
    stdio: [
      /* stdin  */ 'inherit',
      /* stdout */ captureStdout ? 'pipe' : 'inherit',
      /* stderr */ 'inherit',
    ],
  });

  if (captureStdout) {
    process.stdout.write(output);
    return output.toString().trim();
  }
}
