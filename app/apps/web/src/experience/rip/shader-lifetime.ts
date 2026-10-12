/** Three's compileAsync polls material programs until linking finishes.
 * Keep those programs alive after detaching a scene, until every poll finishes.
 */
export class ShaderLifetime {
  private pending = 0;
  private closed = false;
  private dispose: (() => void) | undefined;

  async run(compile: () => Promise<void>): Promise<void> {
    if (this.closed) return;
    this.pending++;
    try {
      await compile();
    } finally {
      this.pending--;
      this.flush();
    }
  }

  close(dispose: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.dispose = dispose;
    this.flush();
  }

  private flush(): void {
    if (!this.closed || this.pending) return;
    const dispose = this.dispose;
    this.dispose = undefined;
    dispose?.();
  }
}
