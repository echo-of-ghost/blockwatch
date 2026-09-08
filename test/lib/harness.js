"use strict";
// Assertion runner for the blockwatch suites.
//
// Two properties the previous ad-hoc `ok()` did not have:
//
//   1. A stable count. Assertions were previously wrapped in `if` blocks, so a
//      run could report 59 or 61 depending on whether a DOM element was found.
//      A count that moves cannot be used to detect a silently skipped test, so
//      here every declared check is always counted — a check that cannot run is
//      a failure, not an absence.
//   2. No aborting. A check that throws is recorded as a failure and the run
//      continues, so one broken assertion does not hide the state of every
//      assertion after it.

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

class Harness {
  constructor(title) {
    this.title = title;
    this.pass = 0;
    this.fail = 0;
    this.failures = [];
    this._expected = null;
    console.log(`${BOLD}${title}${OFF}`);
  }

  // Declare how many checks this suite must run. If the real count differs the
  // suite fails, which is what catches an assertion that silently stopped
  // running because the code it targeted moved.
  expect(n) { this._expected = n; }

  section(name) { console.log(`\n${DIM}── ${name}${OFF}`); }

  // `fn` may return a boolean or a promise of one. Throwing counts as failure
  // and reports the error, rather than taking the process down.
  async check(name, fn, detail) {
    let value, error = null;
    try {
      value = typeof fn === "function" ? await fn() : await fn;
    } catch (e) {
      error = e;
      value = false;
    }
    const passed = value === true;
    let note = "";
    if (typeof detail === "function") {
      try { note = await detail(); } catch (e) { note = "(detail threw: " + e.message + ")"; }
    } else if (detail !== undefined) {
      note = detail;
    }
    if (error) note = "threw: " + error.message + (note ? " | " + note : "");
    // A non-boolean result is a bug in the check itself, not a pass.
    if (!passed && !error && value !== false) {
      note = `check did not return a boolean (got ${JSON.stringify(value)})` + (note ? " | " + note : "");
    }

    if (passed) {
      this.pass++;
      console.log(`  ${GREEN}pass${OFF} ${name}${note ? DIM + "  " + note + OFF : ""}`);
    } else {
      this.fail++;
      this.failures.push({ name, note });
      console.log(`  ${RED}FAIL${OFF} ${name}${note ? "  " + note : ""}`);
    }
    return passed;
  }

  // For a condition that must hold before the rest of a section is meaningful.
  // Still counted, still non-fatal, but flags that following checks are suspect.
  async require(name, fn, detail) {
    const okay = await this.check(name, fn, detail);
    if (!okay) console.log(`  ${DIM}   (checks after this one may fail as a consequence)${OFF}`);
    return okay;
  }

  summary() {
    const total = this.pass + this.fail;
    console.log("");
    if (this.failures.length) {
      console.log(`${RED}${BOLD}${this.failures.length} failing:${OFF}`);
      for (const f of this.failures) console.log(`  ${RED}·${OFF} ${f.name}${f.note ? "  " + f.note : ""}`);
      console.log("");
    }
    let countOk = true;
    if (this._expected !== null && total !== this._expected) {
      countOk = false;
      console.log(`${RED}${BOLD}assertion count drifted: expected ${this._expected}, ran ${total}${OFF}`);
      console.log(`${DIM}  A check stopped running. Update expect() only when you deliberately add or remove one.${OFF}`);
    }
    const good = this.fail === 0 && countOk;
    // Without the reason, a drifted count prints "50/50 passed" in red and
    // exits 1, which reads as a contradiction.
    const why = good ? "" : countOk ? "" : "  (assertion count drifted)";
    console.log(`${good ? GREEN : RED}${BOLD}${this.pass}/${total} passed${why}${OFF}`);
    return good;
  }

  exit() { process.exit(this.summary() ? 0 : 1); }
}

// Wraps a suite so an unexpected throw still prints a summary and exits with a
// useful message rather than an unhandled rejection.
async function runSuite(title, body) {
  const t = new Harness(title);
  let fatal = null;
  try {
    await body(t);
  } catch (e) {
    fatal = e;
  }
  if (fatal) {
    console.log(`\n${RED}${BOLD}suite aborted:${OFF} ${fatal.message}`);
    if (fatal.stack) console.log(`${DIM}${fatal.stack.split("\n").slice(1, 4).join("\n")}${OFF}`);
    t.summary();
    process.exit(1);
  }
  t.exit();
}

module.exports = { Harness, runSuite };
