import {CASHU_LOAD_FILE} from './assets/cashu';

/**
 * The card load files a chip has installed and the operator approved for
 * distributed internal testing (D74), by the sha256 of the bytes LOADed
 * (CASHU_LOAD_FILE.sha256, which tools/cardkit/make-assets.py generates).
 * Installation is enabled only when this build carries one of them, so a
 * distributed build never installs a load file no chip has taken. After a chip
 * run installs a new load file (the opener, the card applet and the tag, then
 * `cardctl selftest`) and its size and hash are in tools/refcheck.py's SIZES
 * and PROVEN, add its sha256 here in a change of its own, with the operator's
 * approval and the run's hardware report.
 * This gate never certifies mint/owner/PIN personalization or holder readiness.
 */
export const VALIDATED_LOAD_FILE_SHA256S: readonly string[] = [
  // 2.1, 20,068 bytes: installed 2026-10-14, approved for internal build 4 (D74)
  'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee',
  // 2.2, 21,631 bytes: installed 2026-11-06 (ENG-823)
  '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3',
];

/** Whether `sha256` (hex, either case) is on VALIDATED_LOAD_FILE_SHA256S. */
export function loadFileValidated(sha256: string): boolean {
  return VALIDATED_LOAD_FILE_SHA256S.includes(sha256.toLowerCase());
}

/**
 * Operator-approved installation for distributed internal testing (D74): this
 * build's load file is a validated one. It gates what LOADs that file (a batch
 * and its installs), never an owned-card reset, which removes an installation
 * and restores the manager keys without loading anything.
 */
export const CARD_INSTALLATION_VALIDATED = loadFileValidated(
  CASHU_LOAD_FILE.sha256,
);

/** Local validation builds only (including owner-built iOS Release binaries).
 * Never enable in a production commit or distribute an enabled validation build.
 * This flag does not bypass CARD_INSTALLATION_VALIDATED.
 */
export const RECOVERY_DRILLS_ENABLED = false;

/** Spare-card laboratory tools only. Never enable in a distributed Release. */
export const BENCH_RUNS_ENABLED = false;

/**
 * What the bench screen may run. Every bench action wants BENCH_RUNS_ENABLED.
 * Installing the Cashu card's load file also wants CARD_INSTALLATION_VALIDATED,
 * so a bench build never installs a load file no chip has taken; the chip run
 * that validates a new load file is made with gp and cardctl
 * (docs/HARDWARE_DEPLOYMENT.md), not here. The hello applet and the key
 * rotation install no card load file.
 */
export function benchActionAllowed(
  action: 'hello' | 'cashu' | 'rotate',
  bench = BENCH_RUNS_ENABLED,
  validated = CARD_INSTALLATION_VALIDATED,
): boolean {
  return bench && (action !== 'cashu' || validated);
}
