/* Private generated lab only. Does not open NFC or change the normal app. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ORIGINAL_SHA256 =
  "f18b6c6ca0ddb9f95ec689a9202080d14645172740e68fd7545ccf2e5fa86500";
const PATCHED_SHA256 =
  "83ee9eaf22253562b200bf7ea9c57cb04afa71785314e05d4dd515cc26042e9c";
const TARGET =
  "node_modules/react-native-nfc-manager/android/src/main/java/community/revteltech/nfc/NfcManager.java";
// TagLostException is already imported by the pinned dependency. IOException
// includes causes Android does not distinguish further; never label it timeout.
const METHOD = `    private static String cashuLabFailure(Exception ex) {
        if (ex instanceof TagLostException) return "cashucard-lab:tag-lost";
        if (ex instanceof java.io.IOException) return "cashucard-lab:io";
        if (ex instanceof SecurityException) return "cashucard-lab:security";
        if (ex instanceof IllegalStateException) return "cashucard-lab:state";
        return "cashucard-lab:other";
    }

`;
const BEFORE = `                    Log.d(LOG_TAG, "transceive fail: " + ex);
                    callback.invoke(ERR_TRANSCEIVE_FAIL);`;
const AFTER = `                    callback.invoke(cashuLabFailure(ex));`;
const MARKER =
  "    @ReactMethod\n    public void transceive(ReadableArray rnArray, Callback callback) {";
const sha = (s) => createHash("sha256").update(s).digest("hex");
function patchSource(source) {
  const hash = sha(source);
  if (hash === PATCHED_SHA256) return source;
  if (hash !== ORIGINAL_SHA256)
    throw Error("Unrecognized NFC dependency source");
  if (source.split(BEFORE).length !== 2 || source.split(MARKER).length !== 2)
    throw Error("NFC diagnostic patch anchor mismatch");
  const patched = source
    .replace(BEFORE, AFTER)
    .replace(MARKER, METHOD + MARKER);
  if (sha(patched) !== PATCHED_SHA256)
    throw Error("NFC diagnostic patch hash mismatch");
  return patched;
}
function patch(app) {
  // Require generated-lab identity before changing its local dependency copy.
  const asset = JSON.parse(
    fs.readFileSync(path.join(app, "pixel-asset.json"), "utf8"),
  );
  if (
    !["org.cashucard.compactlab", "org.cashucard.capacitylab"].includes(
      asset.build?.appId,
    )
  )
    throw Error("Generated private lab required");
  const file = path.join(app, TARGET);
  const source = fs.readFileSync(file, "utf8");
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  return { original: ORIGINAL_SHA256, patched: PATCHED_SHA256 };
}
module.exports = {
  patch,
  patchSource,
  METHOD,
  ORIGINAL_SHA256,
  PATCHED_SHA256,
  TARGET,
};
if (require.main === module) {
  process.stdout.write(JSON.stringify(patch(__dirname)) + "\n");
}
