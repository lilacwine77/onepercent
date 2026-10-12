export function walletBrowserLinks(target: string) {
  const ref = encodeURIComponent(new URL(target).origin);
  const encodedTarget = encodeURIComponent(target);
  return {
    phantom: `https://phantom.com/ul/browse/${encodedTarget}?ref=${ref}`,
    solflare: `https://solflare.com/ul/v1/browse/${encodedTarget}?ref=${ref}`,
    backpack: `https://backpack.app/ul/v1/browse/${encodedTarget}?ref=${ref}`,
  };
}
