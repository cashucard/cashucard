/* Exclusive, atomic local storage for the private phase controller. No transport. */
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const LIMIT = 1024 * 1024;
function privateFile(file) {
  const st = fs.lstatSync(file);
  if (
    !st.isFile() ||
    st.uid !== process.getuid() ||
    st.nlink !== 1 ||
    (st.mode & 0o077) !== 0 ||
    st.size > LIMIT
  )
    throw Error("private-journal-required");
  return st;
}
async function withPhaseJournal(file, initial, callback) {
  if (!path.isAbsolute(file)) throw Error("absolute-journal-required");
  const parent = path.dirname(file),
    st = fs.lstatSync(parent);
  if (
    !st.isDirectory() ||
    st.uid !== process.getuid() ||
    (st.mode & 0o077) !== 0
  )
    throw Error("private-directory-required");
  const lock = file + ".lock";
  const directory = fs.openSync(parent, fs.constants.O_RDONLY);
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    fs.closeSync(directory);
    throw error;
  }
  let active = true;
  const save = async (value) => {
    if (!active) throw Error("journal-lease-closed");
    const raw = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(raw) > LIMIT) throw Error("journal-size-bound");
    if (fs.lstatSync(file, { throwIfNoEntry: false })) privateFile(file);
    const temporary = file + ".tmp-" + randomBytes(12).toString("hex");
    let output;
    try {
      output = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(output, raw);
      fs.fsyncSync(output);
      fs.closeSync(output);
      output = undefined;
      fs.renameSync(temporary, file);
      fs.fsyncSync(directory);
    } finally {
      if (output !== undefined) fs.closeSync(output);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }) + "\n");
    fs.fsyncSync(fd);
    fs.fsyncSync(directory);
    let journal;
    if (fs.lstatSync(file, { throwIfNoEntry: false })) {
      const expected = privateFile(file);
      const input = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const actual = fs.fstatSync(input);
        if (expected.ino !== actual.ino || expected.dev !== actual.dev)
          throw Error("journal-changed");
        journal = JSON.parse(fs.readFileSync(input, "utf8"));
      } finally {
        fs.closeSync(input);
      }
    } else {
      if (!initial) throw Error("journal-missing");
      await save(initial);
      journal = JSON.parse(JSON.stringify(initial));
    }
    return await callback({ journal, save });
  } finally {
    active = false;
    fs.closeSync(fd);
    fs.unlinkSync(lock);
    fs.fsyncSync(directory);
    fs.closeSync(directory);
  }
}
module.exports = { withPhaseJournal };
