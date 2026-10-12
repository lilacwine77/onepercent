export declare const MeshoptDecoder: {
  supported: boolean;
  ready: Promise<void>;
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string,
  ): void;
};
