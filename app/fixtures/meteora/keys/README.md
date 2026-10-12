# Public test signer

`localnet-devnet-dbc-config-TEST-ONLY.json` is deliberately public test material.
Its public key is `AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k`.
The local validator and devnet rehearsal create the DBC config with this signer.
Never send mainnet funds to it or use it for a mainnet account.

Mainnet uses a separate ops-held signer. Only that signer's public key is pinned
in `METEORA_BY_CLUSTER.mainnet.dbcConfig`; its key file never enters this repo.
The mainnet pin is PENDING and the release gate rejects it until launch setup.
