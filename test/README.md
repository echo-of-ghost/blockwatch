# Tests

Everything here runs locally against your own node. Nothing phones home, and
there is no CI wiring — these exist so the checks survive in version control
alongside the code they cover.

```bash
npm test          # headless: no bitcoind, no window, no side effects
npm run test:app  # everything, needs a running bitcoind
```

## What runs where

| Suite | Needs | Covers |
|---|---|---|
| `explorer-url.test.js` | nothing | 50 checks on the explorer URL builder |
| `contrast.py` | Python 3 | 235 colour pairings across 5 chain themes, WCAG AA |
| `layout-engine.test.js` | bitcoind + window | 108 checks on the fluid layout engine |
| `layout-reclaim.test.js` | bitcoind + window | 21 checks on horizontal reclaim and the restore bar |
| `perf.js` | bitcoind + window | frame timing during a drag (not part of `test:app`) |

`lib/cdp.js` and `lib/harness.js` are shared by the browser suites — a DevTools
Protocol client and an assertion runner. Neither is a test.

The first two are pure: `explorer-url` loads `client/shared.js` into a `vm` with
a fake `localStorage`, and `contrast` parses the token blocks straight out of
`blockwatch.css`. They run in about a second.

The rest drive a real Electron window over the Chrome DevTools Protocol. They
need a bitcoind to talk to and they raise a window on your desktop, which is why
`npm test` skips them by default.

## Running the browser suites

```bash
npm run test:app                          # mainnet on the usual ports
RPC_=38332 ZMQ_=28332 npm run test:app    # signet
PORT_=3030 CDP_=9400 npm run test:app     # pin the ports it starts searching from
```

`run.sh` picks a free dashboard port and a free debugging port, hands both to
`launch.sh`, and exports them as `BW_PORT` and `BW_CDP` for the suites. Nothing
assumes a fixed port: two runs on one machine do not collide, and a suite cannot
attach to a browser it did not start.

`launch.sh` runs the app under a **disposable `--user-data-dir`**, so a test can
neither read nor destroy the layout you have saved in `bw_layout_v44`. It records
its pid, and `stop.sh` signals that pid and its children — never a process
matched by name. An earlier version ran `pkill -f electron`, which killed the
developer's own dashboard, any other Electron app started from source, and
occasionally the shell running the tests.

`run.sh` traps `INT`/`TERM`/`EXIT`, so interrupting a run still stops the app
instead of leaving it holding two ports.

## What the suites guarantee about themselves

**Assertion counts are fixed.** Each suite declares `t.expect(n)`. If a check
stops running — because a selector moved, or a condition wrapped it in an `if` —
the count drifts and the suite fails even though nothing reported a failure.
Update `expect()` only when deliberately adding or removing a check.

**A throw is one failure, not a lost run.** `harness.check()` catches, records
and continues, so a single broken assertion cannot hide the state of every
assertion after it.

**Page-side patches are undone in a `finally`.** Anything that monkey-patches
`localStorage.setItem`, `window.addEventListener` or `fluid._solve` goes through
`cdp.withPatch()`. A patch surviving a failed assertion poisons every later
check, and the run then reports failures unrelated to the change under test.

**Waits are on conditions, not on the clock.** `cdp.settled()` waits for the
engine's animation frame to stop; `cdp.waitFor()` polls a page expression. Fixed
sleeps made results depend on machine load.

Starting a gesture is plumbing, not the behaviour under test. `startDrag()` and
`startResize()` press, move, and retry up to three times if the gesture did not
begin — CDP presses are occasionally dropped by the compositor, the same reason
`focusAndPrime()` retries. They report the attempt count, so a gesture that
needed retrying is still visible rather than silently smoothed over. Both flaky
checks this fixed were *preconditions* ("get a drag started"), so a dropped
press reported a flake instead of a result.

That rule is about *observing* state. It does not apply to *generating* input:
synthetic pointer moves are paced ~10ms apart, because a real pointer produces
moves every 8-16ms and two dozen dispatched with no gap is a gesture no browser
ever sees. Removing that pacing made drags die mid-traverse about one run in
five. Likewise, "is the drag live yet?" is a condition to wait for, not to
sample the instant the input event is acknowledged — the pointer handler runs
after the dispatch returns.

## Two things that will bite you

**The window must be focused — and can stop being focused.** CDP input events do not reach the compositor
when the window is not raised, so a suite that forgets `Page.bringToFront` will
report that drags silently never start. `focusAndPrime()` fronts the window,
waits for `document.hasFocus()`, then proves a real gesture lands by requiring a
`pointerdown` listener to fire — retried five times, because the first pointer
event after a raise is occasionally swallowed. Nearly every "the drag never
started" mystery has turned out to be focus rather than a product bug.

Focus can also be lost part-way through a run, and CDP input then still
dispatches while no longer reliably reaching the page. `ensureFocus()` re-fronts
the window and is called at the start of every pointer-driven section; it costs
one `eval` when focus is already held.

**Some layout state changes in an animation callback.** `layout.minimize()` and
`layout.restore()` do their bookkeeping after the animation, so the state they
change is not observable when the call returns. Wait for `layout._minimized`,
not for the call. Asserting immediately produced a test that passed or failed
depending on machine speed.

## Assertions state a direction

"Something changed" passes when the engine moves a neighbour the *wrong* way.
Every motion check names the direction and a threshold:

```js
await t.check("dragging the south edge UP moves the neighbour UP, live",
  () => partnerYMid < partnerY0 - 4, `${partner} y ${partnerY0} -> ${partnerYMid}`);
```

The same applies to height fractions, column indices and focus. If you add a
check that can only say "these differ", it will not catch the bug you are
writing it for.

## The contrast gate

`contrast.py` parses `:root` and every `html.chain-*` block, merges the
overrides, and checks each text token against each opaque surface — plus the
translucent `--odim` / `--osoft` washes composited over the surface beneath
them.

The wash checks are **not** a cross-product. Every rule that paints a wash as a
background was enumerated and the surface beneath it resolved, giving three real
cases (see `WASH_CASES`). Checking all nine text tokens against both washes
reported 125 failures for combinations the product cannot render, and a gate
whose output is mostly impossible gets ignored.

Re-derive the rule list after touching those tokens:

```bash
grep -nE 'background:\s*var\(--o(dim|soft)\)' blockwatch.css
```

Exit codes: `0` pass, `1` a real contrast failure, `2` the palette could not be
parsed — a renamed or malformed token is an error, never a silent pass.

## Profiling

`perf.js` is deliberately not part of `test:app`: it reports numbers rather than
asserting behaviour, and it perturbs the page to measure it. It suspends
`renderAll` before sampling, because a block arriving mid-drag re-renders every
panel, table and chart — with that left live, identical code measured anywhere
from 1 to 36 dropped frames run to run. The solver wrapper and `renderAll` are
both restored in a `finally`, so repeat runs against one instance are fine; it
refuses to start only if an interrupted run left the solver still wrapped.

```bash
node test/perf.js                              # measure and report
BW_PERF_MAX_DROPPED=2 node test/perf.js        # also fail if the budget is exceeded
```

Expect roughly p50 16.7ms and p95 16.8ms with one or two dropped frames in ~148.
