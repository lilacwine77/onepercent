/** Fictitious test inventory approved for devnet; never a production hit list. */
export const DEVNET_MAJOR_PROFILE = Object.freeze({
  name: "devnet-major-sol-fixture-v1",
  cluster: "devnet",
  mint: "8qHh54rJXmwegYvCz7369akQUnx1DTj3G3amoYzmYdFV",
  solUsdPriceAccount: "7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE",
  coverageLamports: 1_500_000_000n,
  // Admin-set bucket cap (Machine STATE, `UpdateBucket`), not a compiled constant:
  // three concurrent Original coverages plus headroom for one hit carve.
  bucketCapLamports: 5_000_000_000n,
  decimals: 6,
  // Test units only: one whole fixture token represents one SOL of coverage.
  deliveredBaseUnits: 1_500_000n,
} as const);

export function devnetMajorFixtureProfile(cluster: string) {
  if (cluster !== DEVNET_MAJOR_PROFILE.cluster)
    throw new Error("devnet_major_fixture_requires_devnet");
  return DEVNET_MAJOR_PROFILE;
}
