// Two-process conformance worker: acquires a cross-process profile lock for the lockKey
// passed as argv[2], prints "HELD" once it owns the lockfile, then holds it until told to
// release (stdin "release\n") or a safety timeout. Imports the BUILT dist module so it runs
// as a genuinely separate OS process contending for the same on-disk O_EXCL lock.
import { acquireProfileLock, releaseProfileLock } from "../../dist/profile-lock.js";

const lockKey = process.argv[2];
if (!lockKey) {
  console.error("usage: profile-lock-holder.mjs <lockKey>");
  process.exit(2);
}

let handle;
try {
  handle = acquireProfileLock(lockKey, "holder-worker");
} catch (error) {
  console.log(`FAILED ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}
console.log("HELD");

function done() {
  releaseProfileLock(handle);
  process.exit(0);
}

// Release on request, or after a safety timeout so a wedged test never leaks the lock.
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (chunk.includes("release")) {
    done();
  }
});
setTimeout(done, 10_000).unref();
