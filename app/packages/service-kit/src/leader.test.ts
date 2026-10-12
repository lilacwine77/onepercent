import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeeperLeader, type LeaderSession } from "./leader.js";

class Session extends EventEmitter implements LeaderSession {
  acquired = true;
  failProbe = false;
  connect = vi.fn(async () => undefined);
  end = vi.fn(async () => undefined);
  query = vi.fn(async (sql: string) => {
    if (this.failProbe && sql === "SELECT 1")
      throw new Error("database connection lost");
    return { rows: [{ acquired: this.acquired }] };
  });
}

const options = {
  connectionString: "postgres://localhost/test",
  tickMs: 100,
  followerRetrySeconds: 0.1,
  leaderFailoverSeconds: 1,
};
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function deferredJob() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolveJob, rejectJob) => {
    resolve = resolveJob;
    reject = rejectJob;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("keeper leadership", () => {
  it("aborts running work immediately on a session error and refuses subsequent jobs", async () => {
    const session = new Session();
    let jobSignal: AbortSignal | undefined;
    const onChange = vi.fn();
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => session,
      onChange,
      onLeader: (signal) => {
        jobSignal = signal;
        return untilAborted(signal);
      },
    });
    await leader.start();
    expect(leader.isLeader).toBe(true);
    expect(jobSignal?.aborted).toBe(false);
    expect(session.query).toHaveBeenCalledWith(
      "SELECT pg_try_advisory_lock(hashtext('onepct:keeper')) AS acquired",
    );
    session.emit("error", new Error("lost"));
    expect(jobSignal?.aborted).toBe(true);
    expect(leader.isLeader).toBe(false);
    expect(() => leader.assertLeader()).toThrow("leadership unavailable");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    await leader.stop();
  });

  it("uses a distinct allowlisted executor lock", async () => {
    const session = new Session();
    const leader = new KeeperLeader({
      ...options,
      lockKey: "onepct:executor",
      sessionFactory: () => session,
    });
    await leader.start();
    expect(session.query).toHaveBeenCalledWith(
      "SELECT pg_try_advisory_lock(hashtext('onepct:executor')) AS acquired",
    );
    await leader.stop();
    expect(
      () =>
        new KeeperLeader({
          ...options,
          lockKey: "untrusted" as "onepct:executor",
        }),
    ).toThrow("invalid_leader_lock");
  });

  it("detects silent loss on the next probe and starts a fresh signal only after reacquisition", async () => {
    vi.useFakeTimers();
    const sessions = [new Session(), new Session()];
    let next = 0;
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => sessions[next++]!,
    });
    await leader.start();
    const original = leader.signal;
    sessions[0]!.failProbe = true;
    await vi.advanceTimersByTimeAsync(options.tickMs);
    expect(original.aborted).toBe(true);
    expect(leader.isLeader).toBe(false);
    await vi.advanceTimersByTimeAsync(options.followerRetrySeconds * 1_000);
    expect(leader.isLeader).toBe(true);
    expect(leader.signal).not.toBe(original);
    await leader.stop();
    expect(leader.signal.aborted).toBe(true);
  });

  it("followers do not start jobs, and stop cannot acquire a late lock", async () => {
    const session = new Session();
    session.acquired = false;
    const onLeader = vi.fn(untilAborted);
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => session,
      onLeader,
    });
    await leader.start();
    expect(leader.isLeader).toBe(false);
    expect(onLeader).not.toHaveBeenCalled();
    await leader.stop();
  });

  it("rejects timings that cannot meet the configured failover budget", () => {
    expect(() => new KeeperLeader({ ...options, tickMs: 1_000 })).toThrow(
      "failover budget",
    );
  });

  it("aborts within one tick when a probe hangs and does not revive a stale proof", async () => {
    vi.useFakeTimers();
    const session = new Session();
    let resolveProbe: (() => void) | undefined;
    session.query.mockImplementation(async (sql) => {
      if (sql === "SELECT 1")
        await new Promise<void>((resolve) => {
          resolveProbe = resolve;
        });
      return { rows: [{ acquired: true }] };
    });
    const onLeader = vi.fn(untilAborted);
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => session,
      onLeader,
    });
    await leader.start();
    const signal = leader.signal;
    await vi.advanceTimersByTimeAsync(options.tickMs / 2);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(options.tickMs / 2);
    expect(signal.aborted).toBe(true);
    expect(leader.isLeader).toBe(false);
    resolveProbe?.();
    await Promise.resolve();
    expect(leader.isLeader).toBe(false);
    expect(onLeader).toHaveBeenCalledTimes(1);
    await leader.stop();
  });

  it("fences sends with monotonic time even before delayed timers can run", async () => {
    let now = 1_000;
    const session = new Session();
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => session,
      now: () => now,
    });
    await leader.start();
    const signal = leader.signal;
    now += options.tickMs;
    expect(() => leader.assertLeader()).toThrow("leadership unavailable");
    expect(signal.aborted).toBe(true);
    await leader.stop();
  });

  it.each(["reject", "resolve"] as const)(
    "releases a terminated business task before five healthy probe intervals (%s)",
    async (termination) => {
      vi.useFakeTimers();
      const session = new Session();
      const standbySession = new Session();
      // Another replica can take the released lock; this replica becomes follower.
      standbySession.acquired = false;
      const sessions = [session, standbySession];
      const job = deferredJob();
      const onError = vi.fn();
      const leader = new KeeperLeader({
        ...options,
        sessionFactory: () => sessions.shift()!,
        onLeader: () => job.promise,
        onError,
      });
      await leader.start();
      const signal = leader.signal;
      if (termination === "reject") job.reject(new Error("rpc_unavailable"));
      else job.resolve();
      await vi.advanceTimersByTimeAsync((5 * options.tickMs) / 2);
      expect(signal.aborted).toBe(true);
      expect(leader.isLeader).toBe(false);
      expect(session.end).toHaveBeenCalledExactlyOnceWith();
      expect(session.query).not.toHaveBeenCalledWith("SELECT 1");
      expect(onError).toHaveBeenCalledExactlyOnceWith("leader_job_failed");
      await leader.stop();
    },
  );

  it.each(["throw", "return"] as const)(
    "releases the term when the business callback synchronously stops (%s)",
    async (termination) => {
      const session = new Session();
      const onError = vi.fn();
      const leader = new KeeperLeader({
        ...options,
        sessionFactory: () => session,
        onLeader: () => {
          if (termination === "throw") throw new Error("rpc_unavailable");
        },
        onError,
      });
      await leader.start();
      expect(leader.isLeader).toBe(false);
      expect(leader.signal.aborted).toBe(true);
      expect(session.end).toHaveBeenCalledExactlyOnceWith();
      expect(onError).toHaveBeenCalledExactlyOnceWith("leader_job_failed");
      await leader.stop();
    },
  );

  it.each(["reject", "resolve"] as const)(
    "does not let an old business callback stop the next term (%s)",
    async (termination) => {
      vi.useFakeTimers();
      const originalSession = new Session();
      const nextSession = new Session();
      const sessions = [originalSession, nextSession];
      const originalJob = deferredJob();
      const onError = vi.fn();
      const onLeader = vi
        .fn(untilAborted)
        .mockImplementationOnce(() => originalJob.promise);
      const leader = new KeeperLeader({
        ...options,
        sessionFactory: () => sessions.shift()!,
        onLeader,
        onError,
      });
      await leader.start();
      const originalSignal = leader.signal;
      originalSession.emit("end");
      await vi.advanceTimersByTimeAsync(options.followerRetrySeconds * 1_000);
      const nextSignal = leader.signal;
      expect(leader.isLeader).toBe(true);
      expect(nextSignal).not.toBe(originalSignal);
      expect(originalSignal.aborted).toBe(true);
      if (termination === "reject")
        originalJob.reject(new Error("late_rpc_failure"));
      else originalJob.resolve();
      await Promise.resolve();
      expect(leader.isLeader).toBe(true);
      expect(nextSignal.aborted).toBe(false);
      expect(nextSession.end).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      await leader.stop();
    },
  );

  it("releases a failed task even when status and error observers throw", async () => {
    const session = new Session();
    const job = deferredJob();
    const leader = new KeeperLeader({
      ...options,
      sessionFactory: () => session,
      onLeader: () => job.promise,
      onChange: (isLeader) => {
        if (!isLeader) throw new Error("status_unavailable");
      },
      onError: () => {
        throw new Error("alert_unavailable");
      },
    });
    await leader.start();
    const signal = leader.signal;
    job.reject(new Error("rpc_unavailable"));
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(leader.isLeader).toBe(false);
    expect(session.end).toHaveBeenCalledExactlyOnceWith();
    await leader.stop();
  });
});
