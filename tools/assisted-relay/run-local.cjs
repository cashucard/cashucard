/* One-command, disposable local campaign. Creates only uniquely named test
 * Docker networks/volumes/containers. It cannot accept a remote mint URL. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { localHTTP } = require("./local-http.cjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
async function run(script, args, log, cwd) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, MINT_URL: "", CARDSIM_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = fs.createWriteStream(log, { flags: "wx", mode: 0o600 });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await new Promise((resolve) => output.end(resolve));
  if (status.code !== 0)
    throw Error("local demonstration failed; inspect " + log);
}
async function main() {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--pos", "--artifact", "--output"].includes(args[i]) ||
      !args[i + 1] ||
      options[args[i]]
    )
      throw Error("expected --pos PATH --artifact PATH --output NEW_PATH");
    options[args[i]] = args[i + 1];
  }
  const pos = options["--pos"],
    artifact = options["--artifact"],
    output = options["--output"];
  if (
    ![pos, artifact, output].every(
      (v) => typeof v === "string" && path.isAbsolute(v),
    )
  )
    throw Error("absolute demonstration paths required");
  if (
    !fs.existsSync(
      path.join(pos, "__tests__/integration/cardRelayDemo.test.ts"),
    ) ||
    !fs.existsSync(path.join(artifact, "sim-classes/CompactHarness.class"))
  )
    throw Error("prepared POS harness and compiled private simulator required");
  fs.mkdirSync(output, { mode: 0o700 });
  const id = "cashucard-relay-" + randomBytes(6).toString("hex"),
    network = id + "-net",
    created = [];
  const volumes = [];
  let networkCreated = false;
  const start = async (name, volume, { legacy = false, free = false } = {}) => {
    const port = await new Promise((resolve, reject) => {
      const server = require("node:net").createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close((error) => (error ? reject(error) : resolve(port)));
      });
    });
    const extra = [
      ...(legacy ? ["-e", "VERSION=0.19.2"] : []),
      ...(free ? ["-e", "MINT_INPUT_FEE_PPK=0"] : []),
    ];
    if (!created.includes(name)) created.push(name);
    docker(
      "run",
      "-d",
      "--platform",
      "linux/amd64",
      "--name",
      name,
      "--label",
      "cashucard.relay-demo=" + id,
      "--network",
      network,
      "-p",
      "127.0.0.1:" + port + ":3338",
      "-v",
      volume + ":/app/data",
      "-e",
      "CASHU_DIR=/app/data",
      "-e",
      "MINT_BACKEND_BOLT11_SAT=FakeWallet",
      "-e",
      "MINT_LISTEN_HOST=0.0.0.0",
      "-e",
      "MINT_LISTEN_PORT=3338",
      "-e",
      "MINT_PRIVATE_KEY=PUBLIC_TEST_KEY_" + id,
      ...extra,
      "cashubtc/nutshell:0.20.3",
      "poetry",
      "run",
      "mint",
    );
    return "http://127.0.0.1:" + port;
  };
  const ready = async (origin) => {
    const request = localHTTP(origin);
    let last;
    for (let i = 0; i < 120; i++) {
      try {
        return await request("/v1/keysets");
      } catch (e) {
        last = e;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw last;
  };
  const demo = async (action, directory, origin) => {
    const logfile = path.join(
      output,
      path.basename(directory) + "-" + action + ".log",
    );
    await run(
      path.join(__dirname, "demo.cjs"),
      [
        action,
        directory,
        origin,
        pos,
        ...(action === "prepare" ? [artifact] : []),
      ],
      logfile,
      path.resolve(__dirname, "../.."),
    );
  };
  try {
    docker("network", "create", network);
    networkCreated = true;
    for (const suffix of ["v2", "v1"]) {
      const volume = id + "-" + suffix;
      docker("volume", "create", volume);
      volumes.push(volume);
    }
    const v2name = id + "-v2",
      v1name = id + "-v1";
    const v2 = await start(v2name, volumes[0]);
    const initialV2 = await ready(v2);
    assert.equal(initialV2.keysets[0].id.length, 66);
    const inside = JSON.parse(
      docker(
        "exec",
        v2name,
        "poetry",
        "run",
        "python",
        "-c",
        "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3338/v1/keysets').read().decode())",
      )
        .split("\n")
        .at(-1),
    );
    assert.deepEqual(
      initialV2,
      inside,
      "host endpoint must be this campaign's container",
    );
    let v1 = await start(v1name, volumes[1], { legacy: true, free: true });
    const seededV1 = await ready(v1);
    assert.equal(seededV1.keysets[0].id.length, 16);
    docker("rm", "-f", v1name);
    v1 = await start(v1name, volumes[1], { free: true });
    const retainedV1 = await ready(v1);
    assert.equal(retainedV1.keysets[0].id, seededV1.keysets[0].id);
    const insideV1 = JSON.parse(
      docker(
        "exec",
        v1name,
        "poetry",
        "run",
        "python",
        "-c",
        "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3338/v1/keysets').read().decode())",
      )
        .split("\n")
        .at(-1),
    );
    assert.deepEqual(
      retainedV1,
      insideV1,
      "legacy host endpoint must be this campaign's container",
    );
    for (const [label, origin, name, expected] of [
      ["v2", v2, v2name, 11],
      ["v1", v1, v1name, 12],
    ]) {
      const directory = path.join(output, label);
      await demo("prepare", directory, origin);
      await demo("relay", directory, origin);
      docker("restart", name);
      await ready(origin);
      await demo("recover", directory, origin);
      assert.equal(
        read(path.join(directory, "verified.json")).merchantAmount,
        expected,
      );
      process.stdout.write(
        label + ": merchant recovered " + expected + " sats once\n",
      );
    }
    const race = path.join(output, "race");
    await demo("prepare", race, v2);
    await demo("race", race, v2);
    docker("restart", v2name);
    await ready(v2);
    await demo("recover", race, v2);
    assert.equal(
      read(path.join(race, "race-verified.json")).bothReachedSwapBarrier,
      true,
    );
    const report = {
      format: "private-assisted-relay-campaign-v1",
      results: ["v2", "v1", "race"].map((label) => ({
        ...read(path.join(output, label, "verified.json")),
        case: label,
      })),
      race: read(path.join(race, "race-verified.json")),
    };
    fs.writeFileSync(
      path.join(output, "verified.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    process.stdout.write(
      "phone/till race verified; evidence: " +
        path.join(output, "verified.json") +
        "\n",
    );
  } catch (error) {
    for (const name of created) {
      try {
        fs.writeFileSync(
          path.join(output, name + ".log"),
          docker("logs", "--tail", "100", name),
          { mode: 0o600 },
        );
      } catch {
        /* Preserve the original failure. */
      }
    }
    throw error;
  } finally {
    const failures = [];
    for (const name of created.reverse())
      try {
        docker("rm", "-f", name);
      } catch {
        failures.push(name);
      }
    for (const volume of volumes)
      try {
        docker("volume", "rm", volume);
      } catch {
        failures.push(volume);
      }
    if (networkCreated)
      try {
        docker("network", "rm", network);
      } catch {
        failures.push(network);
      }
    if (failures.length)
      throw Error("test-resource cleanup incomplete: " + failures.join(", "));
  }
}
if (require.main === module)
  main().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
