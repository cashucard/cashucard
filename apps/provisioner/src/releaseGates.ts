/** Enable only after the approved phone/CPLC/termination report is reviewed.
 * This gate never certifies mint/owner/PIN personalization or holder readiness.
 */
export const CARD_INSTALLATION_VALIDATED = false;

/** Local validation builds only (including owner-built iOS Release binaries).
 * Never enable in a production commit or distribute an enabled validation build.
 * This flag does not bypass CARD_INSTALLATION_VALIDATED.
 */
export const RECOVERY_DRILLS_ENABLED = false;

/** Spare-card laboratory tools only. Never enable in a distributed Release. */
export const BENCH_RUNS_ENABLED = false;
