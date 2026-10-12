import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/check-sbf-flags.mjs <file.so>...");
  process.exitCode = 1;
}

for (const file of files) {
  try {
    const header = await readFile(file);
    if (header.length < 64) {
      throw new Error("truncated ELF64 header (expected at least 64 bytes)");
    }
    if (
      header[0] !== 0x7f ||
      header[1] !== 0x45 ||
      header[2] !== 0x4c ||
      header[3] !== 0x46
    ) {
      throw new Error("invalid ELF magic");
    }
    if (header[4] !== 2) {
      throw new Error("expected ELF64 class 2");
    }
    if (header[5] !== 1) {
      throw new Error("expected little-endian ELF encoding");
    }
    const flags = header.readUInt32LE(48);
    if (flags !== 3) {
      throw new Error(`expected sBPF flags 3, received ${flags}`);
    }
    console.log(`${file}: sBPF flags 3`);
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exitCode = 1;
  }
}
