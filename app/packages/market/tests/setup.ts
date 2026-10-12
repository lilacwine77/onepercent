globalThis.fetch = async () => {
  throw new Error("network disabled in tests");
};
