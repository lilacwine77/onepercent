const prohibited =
  /api-key|helius-rpc|x-api-key|BEGIN [A-Z0-9 ]*PRIVATE KEY|_SECRET|dev\/experience|onepercent-demo-build|onepercent\.demo\.v\d|demo\/pages/i;

export function hasProhibitedBuildContent(source) {
  // Exempt only web3.js's exact generic member spelling, not credential suffixes.
  return prohibited.test(source.replace(/\bthis\._secretKey\b/g, ""));
}
