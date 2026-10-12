# VRF queue reader

`decodeVrfQueue(data, {oldestItemTs?})` validates the discriminator, header,
contiguous item offsets, variable payload bounds and active count. The caller
must first check the RPC account owner against the configured VRF program.
Capacity excludes the discriminator and aligned header. Used bytes measure the
allocated item range, including internal holes, so occupancy is conservative.
Removed entries never supply the oldest slot.

The recorded fixtures are confirmed reads of the shared mainnet queue
`Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` and devnet test queue
`GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb`. The former is empty; the latter has
52 active items. The queue source is pinned to
[MagicBlock commit 52b103c5](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/api/src/state/queue.rs).
Each fixture records source hashes, SDK 0.17.3's source commit, the read slot and
the RPC response. The SDK crate publishes request types; the queue layout is in
the provider's program source.

M2's proposed `oldestItemTs` cannot be recovered from bytes alone. Queue items
contain a slot and a four-second u16 creation stamp that wraps roughly every
72 hours; old live requests still have zero in that field. The decoder therefore
adds `oldestItemSlot` and leaves `oldestItemTs: null` until the caller resolves that
slot with `getBlockTime`. Pass that chain timestamp through `oldestItemTs`, or use
it directly to compute age. The devnet fixture includes the recorded block-time
response for its oldest slot. No local clock or modulo timestamp is presented as
an authoritative creation time.
