import { describe, expect, it, vi } from "vitest";
import { ShaderLifetime } from "./shader-lifetime";

describe("shader compilation lifetime", () => {
  it("keeps programs alive through both pending compiles after teardown", async () => {
    const lifetime = new ShaderLifetime();
    const program = { isReady: vi.fn(() => true) };
    const material: { currentProgram?: typeof program } = {
      currentProgram: program,
    };
    let finishScreen!: () => void;
    let finishBloom!: () => void;
    const compile = (finish: (done: () => void) => void) =>
      lifetime.run(async () => {
        await new Promise<void>(finish);
        // Same deferred access as Three.compileAsync. Early disposal throws here.
        expect(material.currentProgram!.isReady()).toBe(true);
      });
    const screen = compile((done) => {
      finishScreen = done;
    });
    const bloom = compile((done) => {
      finishBloom = done;
    });
    const dispose = vi.fn(() => {
      delete material.currentProgram;
    });
    lifetime.close(dispose);
    lifetime.close(dispose);
    expect(dispose).not.toHaveBeenCalled();
    finishScreen();
    await screen;
    expect(dispose).not.toHaveBeenCalled();
    finishBloom();
    await bloom;
    expect(dispose).toHaveBeenCalledTimes(1);
    const lateCompile = vi.fn(async () => {});
    await lifetime.run(lateCompile);
    expect(lateCompile).not.toHaveBeenCalled();
  });
  it("retains a pending program if the other variant fails", async () => {
    const lifetime = new ShaderLifetime();
    let finish!: () => void;
    const pending = lifetime.run(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const failed = lifetime.run(async () => {
      throw new Error("variant failed");
    });
    const dispose = vi.fn();
    lifetime.close(dispose);
    await expect(failed).rejects.toThrow("variant failed");
    expect(dispose).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans up after a rejected compile, and immediately when idle", async () => {
    const lifetime = new ShaderLifetime();
    const dispose = vi.fn();
    const pending = lifetime.run(async () => {
      throw new Error("compile failed");
    });
    lifetime.close(dispose);
    await expect(pending).rejects.toThrow("compile failed");
    expect(dispose).toHaveBeenCalledTimes(1);
    const idle = new ShaderLifetime();
    idle.close(dispose);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
