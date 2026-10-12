/** Reconcile transport errors later, but never suppress an admission failure. */
export async function broadcastSavedTransaction(
  connection,
  entry,
  beforeBroadcast,
) {
  await beforeBroadcast?.();
  try {
    await connection.sendRawTransaction(Buffer.from(entry.raw, "base64"), {
      skipPreflight: false,
      maxRetries: 0,
    });
  } catch {
    // The caller reconciles the same persisted signature before any retry.
  }
}
