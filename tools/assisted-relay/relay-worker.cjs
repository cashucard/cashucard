/* Separate phone process. Its arguments name only the public phone folder and
 * explicit loopback endpoint, never the merchant's preparation/storage folder. */
const fs = require("node:fs"),
  path = require("node:path");
const { reconcilePayment } = require("./relay.js");
const { crypto } = require("./node-adapter.cjs");
const { localHTTP } = require("./local-http.cjs");
async function main() {
  const [directory, origin, mode] = process.argv.slice(2);
  if (
    !directory ||
    !path.isAbsolute(directory) ||
    !["settle", "replay", "race"].includes(mode)
  )
    throw Error("phone arguments");
  const { withPhaseJournal } = require("../outbox-spike/phase-journal.cjs");
  const policy = JSON.parse(
    fs.readFileSync(path.join(directory, "policy.json"), "utf8"),
  );
  let calls = 0;
  const http = localHTTP(origin);
  const request = async (route, body) => {
    if (route === "/v1/swap") {
      calls++;
      if (mode === "race") {
        fs.writeFileSync(path.join(directory, "race-ready.json"), "{}", {
          flag: "wx",
          mode: 0o600,
        });
        const started = Date.now();
        while (!fs.existsSync(path.join(directory, "race-go.json"))) {
          if (Date.now() - started > 15000)
            throw Error("local race barrier timed out");
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    }
    const r = await http(route, body);
    if (route === "/v1/swap") {
      // Accepted by the real mint, deliberately unavailable to the caller.
      throw Error("injected lost successful swap response");
    }
    return r;
  };
  const file = path.join(directory, "relay.json");
  let result;
  await withPhaseJournal(file, undefined, async ({ journal, save }) => {
    result = await reconcilePayment({ journal, policy, crypto, request, save });
  });
  if (result.state !== "outputs-confirmed") throw Error("relay incomplete");
  fs.writeFileSync(
    path.join(directory, mode + "-result.json"),
    JSON.stringify({
      state: result.state,
      packetId: result.evidence.packetId,
      swapCalls: calls,
    }),
    { flag: "wx", mode: 0o600 },
  );
}
if (require.main === module)
  main().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
