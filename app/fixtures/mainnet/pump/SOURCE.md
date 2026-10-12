# Raw pump fixtures

Mainnet capture: 2026-10-09T03:35:52.728Z, finalized reads at slots 454747012–454747060. ProgramData read slots are separate; these reads are not an atomic snapshot. The public Solana mainnet RPC was used. Optional endpoint credentials are never recorded.

`../../pump/refresh-mainnet.mjs` retrieves the upgradeable program accounts and ProgramData. Each `.so` is its raw payload after the 45-byte loader header, preserving allocation padding. Metadata records program id, ProgramData address, deploy slot, upgrade authority, byte hashes, owner, lamports and capture time. The binaries are runtime fixtures, not new dependencies.

Raw `.bin` account fixtures include Global, both fee configs, Mayhem global parameters/SOL vault, PumpSwap global config, a buyback recipient and sampled curves/pool. Metadata accompanies each. The local validator's account JSON is generated only in a temporary directory.

Files beginning `v3-`, `v4-` or `v5-` contain unsigned transactions or simulated post-state. They do not describe landed transactions. Simulated metadata is labelled. See `../../pump/simulation-verification.json` and `../../pump/SOURCE.md` for scope and results. No mainnet funds were moved.

The raw captures and their metadata remain unchanged after D27/D28. Current
launch checks require zero `creator_fee_bps` and `can_edit_creator_fee == false`
for the SOL pair; D27's collection split belongs to M4.1. D28 uses one atomic
v0 transaction through Helius Sender. The old full-plan JSON files under
`../../pump/` retain their original pre-D28 fields as historical evidence;
they do not describe the current launch interface. See `../../pump/SOURCE.md`
for the current single-transaction size measurements and readiness limits.

D29 supersedes the launch requirements in the preceding historical note.
The active $1PCT launch uses Meteora DBC and SPL Token, with no pump curve or
creator-fee assertions. These original pump reads and simulations are retained
for Feed and X-ray compatibility and historical provenance. Current launch
program fixtures, account vectors and size evidence are under
`../../meteora/`.
