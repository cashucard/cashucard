# Provisioner stop/cancel audit — 2026-10-23

The operator found the saved-reset landing page offered only Continue after
reopening build 7. The following audit covers all shipped routes and the gated
legacy/lab screens. See [D109](DECISIONS.md#d109).

| Screen/state | Exit | What remains |
| --- | --- | --- |
| Sign-in, idle | Normal app exit; credentials are entered only in memory. | No operator session is assumed. |
| Sign-in, waiting | Stop, including hardware Back. | Password input is cleared; an aborted/late result cannot sign in. A disconnected HTTP request may have reached the server. |
| New batch, unsubmitted | Cancel setup → Settings. | No batch is silently created by leaving the form. |
| Batch review, idle | Back/Edit batch, or Cancel setup → Settings. | Unsaved form values may be discarded. |
| Batch creation waiting | Stop and keep saved work; Settings requests Stop before leaving. | The original request ID/body remain for reconciliation if the service already committed. |
| Installation, ready or paused | Stop for now → Settings. Existing End batch handles safe closure through the service. | Attempts, stopped chips and service acknowledgements remain. |
| Installation, active NFC | Cancel tap / Stop, including hardware Back. | The last durable intent remains; transmitted commands may already have changed the card. |
| Installation record submission/retry | Stop and keep saved work. | The immutable record stays queued. Explicit Stop suppresses in-session timer/foreground retries until manual work resumes. |
| Saved-reset landing page | Continue or Stop for now → Settings. | The exact reset and account/service binding remain; new installations stay guarded until it is resolved. |
| Reset inspection before preparation | Cancel review / Back → Settings. | The transient read is dismissed; no reset intent is discarded. |
| Prepared reset, including completed cleanup | Stop and save for later / Back → Settings. | The review, settlement digest and completed cleanup remain. Keep the card aside. |
| Reset, active NFC or service wait | Cancel tap / Stop and keep saved work. | Saved deletion/rotation/verification boundaries and service holds remain for recovery. |
| Reset completion | Set up a new batch, or Back to Settings. | The completion receipt is retained. |
| Read-only card status | Back; Cancel read during NFC **and** later service lookup. | Canceled late results cannot publish reset eligibility. No writes are started by leaving. |
| Read-only CPLC identity | Back/Cancel read, including hardware Back. | Its owned session ends and late identity replies are suppressed. |
| Settings | Back; Sign out confirms when durable work exists. | Signing out preserves batches/resets. Help can be expanded and collapsed. |
| Lab bench | Gated off in distributed builds; its existing Cancel/unmount path ends its session. | No lab tool is enabled by this change. |
| Legacy batch summary | Not a route in the shipping navigator. | Existing tests retain the old outbox coverage; the real receipt/history screen is the shipped flow. |

A local reviewed stage is insufficient evidence that the service never saw an
authorization. Stop therefore preserves the saved reset rather than deleting it
or releasing a chip/device hold. It never restores removed applets, spent
entries, old keys or old ownership. Unresolved work keeps its existing guards;
Settings, support details and read-only tools remain reachable.

## Verification

Focused regressions cover the saved-reset exit, hardware-Back priority, canceled
sign-in and ignored late responses, service-only read cancellation, mint and
HTTP body cancellation, exact reset-state retention, and suppression of automatic
record retries after Stop. All existing interrupted-install, source/actor,
quarantine, immutable-record and reset tests still run. Tests use fixture
transports and no hardware. The resumed SuperMax drill remains separately
approved and paused before applet reset; it must verify saved 0/0 state after
this update. No production deployment, protocol/CAP change or evidence erasure
is part of the UI audit.
