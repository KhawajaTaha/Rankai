/**
 * Standalone background worker. Run as many instances as needed:
 *   npm run worker
 * Jobs are claimed with FOR UPDATE SKIP LOCKED so workers never double-process.
 */
import { startWorkerLoop } from "../lib/jobs/runner";

startWorkerLoop(Number(process.env.WORKER_INTERVAL_MS ?? 3000));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.info(`[worker] ${sig} received, exiting`);
    process.exit(0);
  });
}
