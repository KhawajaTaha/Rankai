export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.RUN_WORKER_IN_PROCESS ?? "true") === "true") {
    const { startWorkerLoop } = await import("./lib/jobs/runner");
    startWorkerLoop();
  }
}
