export interface PackRevealOptions {
  container: HTMLElement;
  assetsBase?: string;
  onProgress?: (progress: number) => void;
  interactive?: boolean;
  reducedMotion?: boolean;
}
export class PackReveal {
  constructor(options: PackRevealOptions);
  ready: Promise<void>;
  progress: number;
  setProgress(progress: number): void;
  exportGLB(): Promise<ArrayBuffer>;
  destroy(): void;
}
