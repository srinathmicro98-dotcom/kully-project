// Tracks the last time this process saw real user traffic, so the Lambda
// idle-checker can decide whether to auto-stop the EC2 instance. In-memory
// is fine — a process restart (e.g. after a fresh `connect`) naturally
// resets the idle clock too.
let lastActivityAt = Date.now();

export function touchActivity() {
  lastActivityAt = Date.now();
}

export function getLastActivityAt() {
  return lastActivityAt;
}
