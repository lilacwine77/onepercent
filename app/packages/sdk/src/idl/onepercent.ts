/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/onepercent.json`.
 */
export type Onepercent = {
  "address": "DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe",
  "metadata": {
    "name": "onepercent",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "The 1% Machine program scaffold"
  },
  "instructions": [
    {
      "name": "adminConfig",
      "discriminator": [
        32,
        33,
        226,
        214,
        28,
        110,
        52,
        90
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "adminAction"
            }
          }
        }
      ]
    },
    {
      "name": "adminListMint",
      "discriminator": [
        59,
        58,
        29,
        73,
        220,
        200,
        205,
        42
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault"
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "class",
          "type": "u8"
        },
        {
          "name": "cap",
          "type": "u64"
        },
        {
          "name": "oracle",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "advancePhase",
      "discriminator": [
        91,
        6,
        51,
        226,
        144,
        243,
        74,
        113
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "buyPacks",
      "discriminator": [
        136,
        30,
        10,
        209,
        228,
        139,
        105,
        138
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "deck",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "pull",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "pullNonce"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "edition",
          "type": "u8"
        },
        {
          "name": "qty",
          "type": "u8"
        },
        {
          "name": "pullNonce",
          "type": "u32"
        },
        {
          "name": "minLiveFlags",
          "type": "u8"
        },
        {
          "name": "referrer",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "hold",
          "type": {
            "option": {
              "defined": {
                "name": "holdProof"
              }
            }
          }
        }
      ]
    },
    {
      "name": "claimFinalSol",
      "discriminator": [
        98,
        8,
        163,
        49,
        114,
        39,
        187,
        159
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimFinalTokens",
      "discriminator": [
        231,
        129,
        17,
        5,
        11,
        202,
        91,
        110
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claimLaunchFees",
      "discriminator": [
        222,
        48,
        127,
        199,
        252,
        222,
        228,
        127
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "feeIn",
          "writable": true
        },
        {
          "name": "feeInWsol",
          "writable": true
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "dbcConfig"
        },
        {
          "name": "baseMint"
        },
        {
          "name": "baseVault",
          "writable": true
        },
        {
          "name": "quoteVault",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "poolAuthority"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "venueProgram"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "position",
          "writable": true,
          "optional": true
        },
        {
          "name": "positionNftAccount",
          "optional": true
        },
        {
          "name": "feeInBase",
          "writable": true,
          "optional": true
        }
      ],
      "args": [
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "launchFeeKind"
            }
          }
        }
      ]
    },
    {
      "name": "closeBinder",
      "discriminator": [
        61,
        4,
        88,
        7,
        244,
        159,
        27,
        176
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeVault",
      "discriminator": [
        141,
        103,
        17,
        126,
        72,
        75,
        29,
        29
      ],
      "accounts": [
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "collectCreatorFees",
      "discriminator": [
        78,
        57,
        27,
        244,
        150,
        73,
        198,
        78
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "feeIn",
          "writable": true
        },
        {
          "name": "feeInWsol",
          "writable": true
        },
        {
          "name": "splTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "consumeRandomness",
      "discriminator": [
        190,
        217,
        49,
        162,
        99,
        26,
        73,
        234
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "pull"
        },
        {
          "name": "machine"
        },
        {
          "name": "deck"
        },
        {
          "name": "binder"
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "seq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "execBegin",
      "discriminator": [
        94,
        233,
        239,
        96,
        234,
        195,
        70,
        146
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "src",
          "writable": true
        },
        {
          "name": "solDest"
        },
        {
          "name": "oracle0"
        },
        {
          "name": "oracle1"
        },
        {
          "name": "oracle2"
        },
        {
          "name": "oracle3"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "splTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "bucket",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "execEnd",
      "discriminator": [
        142,
        111,
        117,
        141,
        80,
        143,
        96,
        200
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "solDest"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "splTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "kind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "feed",
      "discriminator": [
        46,
        213,
        237,
        176,
        190,
        113,
        182,
        94
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "depositor"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amounts",
          "type": {
            "vec": "u64"
          }
        },
        {
          "name": "expiry",
          "type": "i64"
        },
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "attIx",
          "type": "u8"
        }
      ]
    },
    {
      "name": "feedBack",
      "discriminator": [
        15,
        57,
        169,
        98,
        126,
        5,
        64,
        169
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "cardIndices",
          "type": {
            "vec": "u16"
          }
        }
      ]
    },
    {
      "name": "guardian",
      "discriminator": [
        138,
        247,
        107,
        233,
        48,
        251,
        183,
        234
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "guardianAction"
            }
          }
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "program",
          "address": "DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe"
        },
        {
          "name": "programData"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              }
            ]
          }
        },
        {
          "name": "feeIn",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "vrfQueue"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initParams"
            }
          }
        }
      ]
    },
    {
      "name": "ping",
      "discriminator": [
        173,
        0,
        94,
        236,
        73,
        133,
        225,
        153
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "powerOn",
      "discriminator": [
        123,
        229,
        27,
        135,
        29,
        130,
        2,
        101
      ],
      "accounts": [
        {
          "name": "launchWallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "launchPool"
        },
        {
          "name": "dbcConfig"
        },
        {
          "name": "feeIn",
          "writable": true
        },
        {
          "name": "ledger",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "redeem",
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "cardIndex",
          "type": "u16"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundPull",
      "discriminator": [
        207,
        171,
        0,
        146,
        188,
        39,
        84,
        166
      ],
      "accounts": [
        {
          "name": "pull",
          "writable": true
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true
        },
        {
          "name": "buyer"
        }
      ],
      "args": [
        {
          "name": "seq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sellBack",
      "discriminator": [
        230,
        50,
        8,
        6,
        210,
        15,
        152,
        133
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "ledger",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "cards",
          "type": {
            "vec": {
              "defined": {
                "name": "sellBackCard"
              }
            }
          }
        },
        {
          "name": "quoteLamports",
          "type": "u64"
        },
        {
          "name": "expiry",
          "type": "i64"
        },
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "attIx",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle",
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "pull",
          "writable": true
        },
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "buyer"
        },
        {
          "name": "referrer"
        },
        {
          "name": "wallet0"
        },
        {
          "name": "wallet1"
        },
        {
          "name": "wallet2"
        },
        {
          "name": "wallet3"
        },
        {
          "name": "binder0"
        },
        {
          "name": "binder1"
        },
        {
          "name": "binder2"
        },
        {
          "name": "binder3"
        }
      ],
      "args": [
        {
          "name": "seq",
          "type": "u64"
        },
        {
          "name": "pack",
          "type": "u8"
        }
      ]
    },
    {
      "name": "spotlightDeposit",
      "discriminator": [
        31,
        77,
        4,
        91,
        2,
        158,
        186,
        141
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "spotlightTakeBack",
      "discriminator": [
        69,
        221,
        62,
        117,
        9,
        67,
        14,
        220
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "startFinalPull",
      "discriminator": [
        239,
        68,
        96,
        214,
        196,
        221,
        162,
        229
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "takeBack",
      "discriminator": [
        99,
        255,
        183,
        133,
        153,
        30,
        12,
        32
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              }
            ]
          }
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "depositor"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "ledger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "machine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "deckIndex",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "teamWithdraw",
      "discriminator": [
        237,
        151,
        110,
        121,
        198,
        185,
        214,
        97
      ],
      "accounts": [
        {
          "name": "machine",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  99,
                  104,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "teamWallet",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "withdrawOwed",
      "discriminator": [
        110,
        222,
        234,
        254,
        112,
        86,
        192,
        66
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "binder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  105,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "binder",
      "discriminator": [
        156,
        60,
        140,
        75,
        151,
        85,
        67,
        63
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "deck",
      "discriminator": [
        192,
        215,
        78,
        133,
        216,
        161,
        59,
        154
      ]
    },
    {
      "name": "machine",
      "discriminator": [
        25,
        102,
        22,
        13,
        58,
        243,
        138,
        79
      ]
    },
    {
      "name": "mintLedger",
      "discriminator": [
        202,
        202,
        190,
        148,
        227,
        148,
        76,
        70
      ]
    },
    {
      "name": "pull",
      "discriminator": [
        65,
        19,
        46,
        7,
        253,
        230,
        71,
        243
      ]
    }
  ],
  "events": [
    {
      "name": "bagFed",
      "discriminator": [
        224,
        113,
        23,
        93,
        216,
        121,
        129,
        77
      ]
    },
    {
      "name": "bagTakenBack",
      "discriminator": [
        169,
        62,
        149,
        216,
        67,
        122,
        82,
        62
      ]
    },
    {
      "name": "binderClosed",
      "discriminator": [
        206,
        108,
        148,
        141,
        255,
        73,
        8,
        106
      ]
    },
    {
      "name": "bucketListed",
      "discriminator": [
        98,
        4,
        175,
        69,
        38,
        20,
        230,
        227
      ]
    },
    {
      "name": "callbackSkipped",
      "discriminator": [
        6,
        168,
        228,
        80,
        89,
        110,
        119,
        182
      ]
    },
    {
      "name": "cardDropped",
      "discriminator": [
        236,
        165,
        48,
        242,
        228,
        11,
        65,
        237
      ]
    },
    {
      "name": "cardFedBack",
      "discriminator": [
        79,
        210,
        156,
        52,
        238,
        201,
        50,
        56
      ]
    },
    {
      "name": "cardRedeemed",
      "discriminator": [
        133,
        166,
        12,
        57,
        114,
        90,
        50,
        85
      ]
    },
    {
      "name": "configChanged",
      "discriminator": [
        147,
        25,
        86,
        98,
        98,
        77,
        78,
        192
      ]
    },
    {
      "name": "creatorFeesCollected",
      "discriminator": [
        117,
        190,
        177,
        156,
        222,
        94,
        28,
        227
      ]
    },
    {
      "name": "execBegun",
      "discriminator": [
        253,
        139,
        146,
        118,
        253,
        250,
        34,
        116
      ]
    },
    {
      "name": "execEnded",
      "discriminator": [
        103,
        192,
        231,
        146,
        240,
        238,
        86,
        22
      ]
    },
    {
      "name": "finalPullStarted",
      "discriminator": [
        21,
        245,
        187,
        190,
        193,
        155,
        59,
        67
      ]
    },
    {
      "name": "finalSolClaimed",
      "discriminator": [
        65,
        112,
        28,
        121,
        191,
        36,
        31,
        108
      ]
    },
    {
      "name": "finalTokensClaimed",
      "discriminator": [
        255,
        146,
        0,
        44,
        20,
        46,
        74,
        176
      ]
    },
    {
      "name": "hitSkipped",
      "discriminator": [
        109,
        212,
        206,
        231,
        27,
        170,
        141,
        167
      ]
    },
    {
      "name": "initialized",
      "discriminator": [
        208,
        213,
        115,
        98,
        115,
        82,
        201,
        209
      ]
    },
    {
      "name": "jackpotWon",
      "discriminator": [
        37,
        157,
        14,
        36,
        53,
        182,
        158,
        175
      ]
    },
    {
      "name": "keeperHistoryStarted",
      "discriminator": [
        35,
        52,
        4,
        79,
        178,
        247,
        209,
        172
      ]
    },
    {
      "name": "launchFeesClaimed",
      "discriminator": [
        152,
        122,
        245,
        108,
        47,
        244,
        90,
        137
      ]
    },
    {
      "name": "onePctLive",
      "discriminator": [
        2,
        87,
        19,
        52,
        232,
        126,
        79,
        135
      ]
    },
    {
      "name": "onePctPulled",
      "discriminator": [
        202,
        206,
        162,
        61,
        142,
        233,
        44,
        0
      ]
    },
    {
      "name": "owedWithdrawn",
      "discriminator": [
        5,
        182,
        86,
        222,
        137,
        212,
        104,
        229
      ]
    },
    {
      "name": "packRevealed",
      "discriminator": [
        152,
        85,
        14,
        60,
        105,
        201,
        31,
        169
      ]
    },
    {
      "name": "packSettled",
      "discriminator": [
        84,
        73,
        178,
        253,
        208,
        173,
        47,
        100
      ]
    },
    {
      "name": "phaseAdvanced",
      "discriminator": [
        123,
        52,
        118,
        23,
        154,
        234,
        206,
        41
      ]
    },
    {
      "name": "pong",
      "discriminator": [
        107,
        153,
        141,
        173,
        103,
        56,
        68,
        117
      ]
    },
    {
      "name": "poweredOn",
      "discriminator": [
        204,
        98,
        220,
        180,
        5,
        183,
        97,
        125
      ]
    },
    {
      "name": "pullClosed",
      "discriminator": [
        151,
        42,
        161,
        114,
        178,
        108,
        13,
        167
      ]
    },
    {
      "name": "pullOpened",
      "discriminator": [
        226,
        99,
        246,
        234,
        48,
        201,
        169,
        193
      ]
    },
    {
      "name": "pullRefunded",
      "discriminator": [
        80,
        238,
        108,
        202,
        93,
        150,
        181,
        56
      ]
    },
    {
      "name": "pullRevealed",
      "discriminator": [
        113,
        32,
        147,
        7,
        227,
        175,
        203,
        93
      ]
    },
    {
      "name": "referralRedirected",
      "discriminator": [
        55,
        7,
        11,
        253,
        175,
        171,
        19,
        248
      ]
    },
    {
      "name": "revealTimestamped",
      "discriminator": [
        246,
        194,
        28,
        16,
        94,
        99,
        66,
        14
      ]
    },
    {
      "name": "royaltyRedirected",
      "discriminator": [
        0,
        154,
        103,
        216,
        110,
        141,
        245,
        135
      ]
    },
    {
      "name": "sellHistoryUpdated",
      "discriminator": [
        177,
        7,
        109,
        242,
        50,
        48,
        45,
        83
      ]
    },
    {
      "name": "soldBack",
      "discriminator": [
        153,
        215,
        200,
        12,
        194,
        138,
        190,
        253
      ]
    },
    {
      "name": "teamWithdrawn",
      "discriminator": [
        81,
        96,
        11,
        34,
        127,
        203,
        158,
        3
      ]
    },
    {
      "name": "vaultClosed",
      "discriminator": [
        238,
        129,
        38,
        228,
        227,
        118,
        249,
        215
      ]
    },
    {
      "name": "vaultShortfall",
      "discriminator": [
        168,
        9,
        203,
        214,
        142,
        202,
        75,
        5
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "roleDisabled",
      "msg": "roleDisabled"
    },
    {
      "code": 6002,
      "name": "paused",
      "msg": "paused"
    },
    {
      "code": 6003,
      "name": "wrongPhase",
      "msg": "wrongPhase"
    },
    {
      "code": 6004,
      "name": "seasonOver",
      "msg": "seasonOver"
    },
    {
      "code": 6005,
      "name": "invalidArgument",
      "msg": "invalidArgument"
    },
    {
      "code": 6006,
      "name": "invalidEdition",
      "msg": "invalidEdition"
    },
    {
      "code": 6007,
      "name": "invalidQuantity",
      "msg": "invalidQuantity"
    },
    {
      "code": 6008,
      "name": "teamWallet",
      "msg": "teamWallet"
    },
    {
      "code": 6009,
      "name": "notWallet",
      "msg": "notWallet"
    },
    {
      "code": 6010,
      "name": "mintNotSafe",
      "msg": "mintNotSafe"
    },
    {
      "code": 6011,
      "name": "mintForbidden",
      "msg": "mintForbidden"
    },
    {
      "code": 6012,
      "name": "notPumpFun",
      "msg": "notPumpFun"
    },
    {
      "code": 6013,
      "name": "duplicateMint",
      "msg": "duplicateMint"
    },
    {
      "code": 6014,
      "name": "tokensNotReceived",
      "msg": "tokensNotReceived"
    },
    {
      "code": 6015,
      "name": "attestationInvalid",
      "msg": "attestationInvalid"
    },
    {
      "code": 6016,
      "name": "attestationExpired",
      "msg": "attestationExpired"
    },
    {
      "code": 6017,
      "name": "attestationReplay",
      "msg": "attestationReplay"
    },
    {
      "code": 6018,
      "name": "freshCapReached",
      "msg": "freshCapReached"
    },
    {
      "code": 6019,
      "name": "deckFull",
      "msg": "deckFull"
    },
    {
      "code": 6020,
      "name": "deckUnderfunded",
      "msg": "deckUnderfunded"
    },
    {
      "code": 6021,
      "name": "vaultMismatch",
      "msg": "vaultMismatch"
    },
    {
      "code": 6022,
      "name": "ledgerMismatch",
      "msg": "ledgerMismatch"
    },
    {
      "code": 6023,
      "name": "accountMismatch",
      "msg": "accountMismatch"
    },
    {
      "code": 6024,
      "name": "cardMoved",
      "msg": "cardMoved"
    },
    {
      "code": 6025,
      "name": "cardNotRedeemable",
      "msg": "cardNotRedeemable"
    },
    {
      "code": 6026,
      "name": "refilling",
      "msg": "refilling"
    },
    {
      "code": 6027,
      "name": "machineHungry",
      "msg": "machineHungry"
    },
    {
      "code": 6028,
      "name": "liveFlagsChanged",
      "msg": "liveFlagsChanged"
    },
    {
      "code": 6029,
      "name": "queueNotAllowed",
      "msg": "queueNotAllowed"
    },
    {
      "code": 6030,
      "name": "binderFull",
      "msg": "binderFull"
    },
    {
      "code": 6031,
      "name": "pullNotRevealed",
      "msg": "pullNotRevealed"
    },
    {
      "code": 6032,
      "name": "pullMismatch",
      "msg": "pullMismatch"
    },
    {
      "code": 6033,
      "name": "tooEarlyToRefund",
      "msg": "tooEarlyToRefund"
    },
    {
      "code": 6034,
      "name": "bucketsFull",
      "msg": "bucketsFull"
    },
    {
      "code": 6035,
      "name": "bucketExists",
      "msg": "bucketExists"
    },
    {
      "code": 6036,
      "name": "bucketInvalid",
      "msg": "bucketInvalid"
    },
    {
      "code": 6037,
      "name": "trendingLimit",
      "msg": "trendingLimit"
    },
    {
      "code": 6038,
      "name": "vaultNotEmpty",
      "msg": "vaultNotEmpty"
    },
    {
      "code": 6039,
      "name": "mintListed",
      "msg": "mintListed"
    },
    {
      "code": 6040,
      "name": "seasonAlreadySet",
      "msg": "seasonAlreadySet"
    },
    {
      "code": 6041,
      "name": "invalidRole",
      "msg": "invalidRole"
    },
    {
      "code": 6042,
      "name": "mathOverflow",
      "msg": "mathOverflow"
    },
    {
      "code": 6043,
      "name": "vaultInvariant",
      "msg": "vaultInvariant"
    },
    {
      "code": 6044,
      "name": "multipleFeeds",
      "msg": "multipleFeeds"
    },
    {
      "code": 6045,
      "name": "notImplemented",
      "msg": "notImplemented"
    },
    {
      "code": 6046,
      "name": "notTopLevel",
      "msg": "notTopLevel"
    },
    {
      "code": 6047,
      "name": "payeeBelowRent",
      "msg": "payeeBelowRent"
    },
    {
      "code": 6048,
      "name": "execPairing",
      "msg": "execPairing"
    },
    {
      "code": 6049,
      "name": "execInFlight",
      "msg": "execInFlight"
    },
    {
      "code": 6050,
      "name": "tooSoon",
      "msg": "tooSoon"
    },
    {
      "code": 6051,
      "name": "trancheTooLarge",
      "msg": "trancheTooLarge"
    },
    {
      "code": 6052,
      "name": "hourlyCapReached",
      "msg": "hourlyCapReached"
    },
    {
      "code": 6053,
      "name": "trendingShareExceeded",
      "msg": "trendingShareExceeded"
    },
    {
      "code": 6054,
      "name": "bucketCapExceeded",
      "msg": "bucketCapExceeded"
    },
    {
      "code": 6055,
      "name": "reservedCapacity",
      "msg": "reservedCapacity"
    },
    {
      "code": 6056,
      "name": "bucketDisabled",
      "msg": "bucketDisabled"
    },
    {
      "code": 6057,
      "name": "oracleInvalid",
      "msg": "oracleInvalid"
    },
    {
      "code": 6058,
      "name": "oracleStale",
      "msg": "oracleStale"
    },
    {
      "code": 6059,
      "name": "oracleWide",
      "msg": "oracleWide"
    },
    {
      "code": 6060,
      "name": "slippageExceeded",
      "msg": "slippageExceeded"
    },
    {
      "code": 6061,
      "name": "slackShort",
      "msg": "slackShort"
    },
    {
      "code": 6062,
      "name": "notSellBackable",
      "msg": "notSellBackable"
    },
    {
      "code": 6063,
      "name": "sellBackFloor",
      "msg": "sellBackFloor"
    },
    {
      "code": 6064,
      "name": "sellBackBudget",
      "msg": "sellBackBudget"
    },
    {
      "code": 6065,
      "name": "notFeedable",
      "msg": "notFeedable"
    },
    {
      "code": 6066,
      "name": "binderNotEmpty",
      "msg": "binderNotEmpty"
    },
    {
      "code": 6067,
      "name": "pullPending",
      "msg": "pullPending"
    },
    {
      "code": 6068,
      "name": "finalNotClaimed",
      "msg": "finalNotClaimed"
    },
    {
      "code": 6069,
      "name": "notLaunchCurve",
      "msg": "notLaunchCurve"
    },
    {
      "code": 6070,
      "name": "finalPullNotDue",
      "msg": "finalPullNotDue"
    },
    {
      "code": 6071,
      "name": "stockBuyPullInFlight",
      "msg": "stockBuyPullInFlight"
    },
    {
      "code": 6072,
      "name": "stockBuyRevealDelay",
      "msg": "stockBuyRevealDelay"
    },
    {
      "code": 6073,
      "name": "stockBuyListingNotice",
      "msg": "stockBuyListingNotice"
    },
    {
      "code": 6074,
      "name": "stockBuyReserve",
      "msg": "stockBuyReserve"
    }
  ],
  "types": [
    {
      "name": "adminAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "setRole",
            "fields": [
              {
                "name": "role",
                "type": "u8"
              },
              {
                "name": "key",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "setTeam",
            "fields": [
              {
                "name": "teamWallet",
                "type": "pubkey"
              },
              {
                "name": "teamWallets",
                "type": {
                  "array": [
                    "pubkey",
                    8
                  ]
                }
              }
            ]
          },
          {
            "name": "setSeason",
            "fields": [
              {
                "name": "snapshotSlot",
                "type": "u64"
              },
              {
                "name": "snapshotTs",
                "type": "i64"
              },
              {
                "name": "stockUpTs",
                "type": "i64"
              }
            ]
          },
          {
            "name": "setTokenMint",
            "fields": [
              {
                "name": "mint",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "addVrfQueue",
            "fields": [
              {
                "name": "queue",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "updateBucket",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              },
              {
                "name": "enabled",
                "type": "bool"
              },
              {
                "name": "cap",
                "type": "u64"
              }
            ]
          },
          {
            "name": "setPause",
            "fields": [
              {
                "name": "bits",
                "type": "u8"
              },
              {
                "name": "paused",
                "type": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "bagFed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deckIndex",
            "type": "u32"
          },
          {
            "name": "deposit",
            "type": "u64"
          },
          {
            "name": "freshInDeck",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "bagTakenBack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deckIndex",
            "type": "u32"
          },
          {
            "name": "movedFrom",
            "type": "u32"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "binder",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "seasonSpend",
            "type": "u64"
          },
          {
            "name": "solOwed",
            "type": "u64"
          },
          {
            "name": "feedNonceBase",
            "type": "u32"
          },
          {
            "name": "sbNonce",
            "type": "u32"
          },
          {
            "name": "pullNonce",
            "type": "u32"
          },
          {
            "name": "feedNonceBits",
            "type": "u16"
          },
          {
            "name": "freshInDeck",
            "type": "u16"
          },
          {
            "name": "len",
            "type": "u16"
          },
          {
            "name": "cap",
            "type": "u16"
          },
          {
            "name": "reserved",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "flags",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "binderClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bucket",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "cost",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": "u64"
          },
          {
            "name": "cap",
            "type": "u64"
          },
          {
            "name": "trendBoughtHour",
            "type": "u64"
          },
          {
            "name": "trendHourIndex",
            "type": "u32"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "class",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "u8"
          },
          {
            "name": "tokenProgram",
            "type": "u8"
          },
          {
            "name": "finalPool",
            "type": "u64"
          },
          {
            "name": "trendSoldHour",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bucketHistory",
      "docs": [
        "Parallel to Machine.buckets; preserves the deployed 128-byte Bucket stride."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listedTs",
            "type": "i64"
          },
          {
            "name": "sbInflowHour",
            "docs": [
              "SOL book value returned by Sell, never token units or the payout."
            ],
            "type": "u64"
          },
          {
            "name": "sbInflowPrevHour",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bucketListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "listedTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "callbackSkipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "reason",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "cardDropped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "cardFedBack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "cardIndex",
            "type": "u16"
          },
          {
            "name": "movedFrom",
            "type": "u16"
          },
          {
            "name": "deckIndex",
            "type": "u32"
          },
          {
            "name": "deposit",
            "type": "u64"
          },
          {
            "name": "slotRefund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "cardRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "cardIndex",
            "type": "u16"
          },
          {
            "name": "movedFrom",
            "type": "u16"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "guardians",
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "intakeSigner",
            "type": "pubkey"
          },
          {
            "name": "quoteSigner",
            "type": "pubkey"
          },
          {
            "name": "launchWallet",
            "type": "pubkey"
          },
          {
            "name": "teamWallet",
            "type": "pubkey"
          },
          {
            "name": "teamWallets",
            "type": {
              "array": [
                "pubkey",
                8
              ]
            }
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "vrfQueues",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "snapshotSlot",
            "type": "u64"
          },
          {
            "name": "snapshotTs",
            "type": "i64"
          },
          {
            "name": "stockUpTs",
            "type": "i64"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "activeQueue",
            "type": "u8"
          },
          {
            "name": "seasonSet",
            "type": "u8"
          },
          {
            "name": "adminPaused",
            "type": "u8"
          },
          {
            "name": "guardianPaused",
            "type": "u8"
          },
          {
            "name": "disabledRoles",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": "u8"
          },
          {
            "name": "vrfProgram",
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                96
              ]
            }
          }
        ]
      }
    },
    {
      "name": "configChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "action",
            "type": "u8"
          },
          {
            "name": "actor",
            "type": "pubkey"
          },
          {
            "name": "key",
            "type": "pubkey"
          },
          {
            "name": "a",
            "type": "u64"
          },
          {
            "name": "b",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeesCollected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "regime",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fromFeeIn",
            "type": "u64"
          },
          {
            "name": "fromWsol",
            "type": "u64"
          },
          {
            "name": "toStock",
            "type": "u64"
          },
          {
            "name": "toBurn",
            "type": "u64"
          },
          {
            "name": "toTeam",
            "type": "u64"
          },
          {
            "name": "book",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deck",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "len",
            "type": "u32"
          },
          {
            "name": "cap",
            "type": "u32"
          },
          {
            "name": "headerRent",
            "type": "u64"
          },
          {
            "name": "totalFed",
            "type": "u64"
          },
          {
            "name": "totalPulled",
            "type": "u64"
          },
          {
            "name": "totalTakenBack",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "dustPick",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deckLenBefore",
            "type": "u32"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "movedFrom",
            "type": "u32"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "execBegun",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "signer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "minOut",
            "type": "u64"
          },
          {
            "name": "v0",
            "type": "u64"
          },
          {
            "name": "book",
            "type": "u64"
          },
          {
            "name": "expected",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "execEnded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "minOut",
            "type": "u64"
          },
          {
            "name": "delta",
            "type": "u64"
          },
          {
            "name": "book",
            "type": "u64"
          },
          {
            "name": "trackedAfter",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "execRecord",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "v0",
            "type": "u64"
          },
          {
            "name": "minOut",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "pubkey"
          },
          {
            "name": "aux",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "finalPullStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "finalTs",
            "type": "i64"
          },
          {
            "name": "poolSol",
            "type": "u64"
          },
          {
            "name": "pool1pct",
            "type": "u64"
          },
          {
            "name": "jackpotTokens",
            "type": "u64"
          },
          {
            "name": "onepctFinalMask",
            "type": "u8"
          },
          {
            "name": "totalSpend",
            "type": "u64"
          },
          {
            "name": "bucketPools",
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "finalSolClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "share",
            "type": "u64"
          },
          {
            "name": "paid",
            "type": "u64"
          },
          {
            "name": "toOwed",
            "type": "bool"
          },
          {
            "name": "remaining",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "finalTokensClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "onepct",
            "type": "u64"
          },
          {
            "name": "buckets",
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "cards",
            "type": "u8"
          },
          {
            "name": "slotRent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "guardianAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "setPause",
            "fields": [
              {
                "name": "bits",
                "type": "u8"
              },
              {
                "name": "paused",
                "type": "bool"
              }
            ]
          },
          {
            "name": "disableBucket",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              }
            ]
          },
          {
            "name": "lowerCap",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              },
              {
                "name": "cap",
                "type": "u64"
              }
            ]
          },
          {
            "name": "disableRole",
            "fields": [
              {
                "name": "role",
                "type": "u8"
              }
            ]
          },
          {
            "name": "selectVrfQueue",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "hitSkipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "holdProof",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "attIx",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "guardians",
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "intakeSigner",
            "type": "pubkey"
          },
          {
            "name": "quoteSigner",
            "type": "pubkey"
          },
          {
            "name": "launchWallet",
            "type": "pubkey"
          },
          {
            "name": "teamWallet",
            "type": "pubkey"
          },
          {
            "name": "teamWallets",
            "type": {
              "array": [
                "pubkey",
                8
              ]
            }
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "vrfQueue",
            "type": "pubkey"
          },
          {
            "name": "rentBufferLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u16"
          },
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jackpotWon",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "edition",
            "type": "u8"
          },
          {
            "name": "tokens",
            "type": "u64"
          },
          {
            "name": "cost",
            "type": "u64"
          },
          {
            "name": "jackpotSolLeft",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "keeperHistoryStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "launchFeeKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "curve"
          },
          {
            "name": "pool"
          },
          {
            "name": "surplus"
          }
        ]
      }
    },
    {
      "name": "launchFeesClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "quote",
            "type": "u64"
          },
          {
            "name": "base",
            "type": "u64"
          },
          {
            "name": "unwrappedLamports",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "machine",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "phase",
            "type": "u8"
          },
          {
            "name": "vaultAuthBump",
            "type": "u8"
          },
          {
            "name": "deckBump",
            "type": "u8"
          },
          {
            "name": "configBump",
            "type": "u8"
          },
          {
            "name": "feeInBump",
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": "u8"
          },
          {
            "name": "nextSeq",
            "type": "u64"
          },
          {
            "name": "pendingPulls",
            "type": "u64"
          },
          {
            "name": "reservedDust",
            "type": "u64"
          },
          {
            "name": "powerOnTs",
            "type": "i64"
          },
          {
            "name": "onAirTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "finalTs",
            "type": "i64"
          },
          {
            "name": "stockSol",
            "type": "u64"
          },
          {
            "name": "jackpotSol",
            "type": "u64"
          },
          {
            "name": "burnSol",
            "type": "u64"
          },
          {
            "name": "teamSol",
            "type": "u64"
          },
          {
            "name": "finalPoolSol",
            "type": "u64"
          },
          {
            "name": "totalSpend",
            "type": "u64"
          },
          {
            "name": "hourIndex",
            "type": "u64"
          },
          {
            "name": "hitOutThisHour",
            "type": "u64"
          },
          {
            "name": "hitOutLastHour",
            "type": "u64"
          },
          {
            "name": "sbPaidHour",
            "type": "u64"
          },
          {
            "name": "solAtHourStart",
            "type": "u64"
          },
          {
            "name": "packsRevealed",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "hitValueOut",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "buckets",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "bucket"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "jackpotTokens",
            "type": "u64"
          },
          {
            "name": "jackpotCost",
            "type": "u64"
          },
          {
            "name": "burnedTotal",
            "type": "u64"
          },
          {
            "name": "lastBurnTs",
            "type": "i64"
          },
          {
            "name": "burnHourIndex",
            "type": "u64"
          },
          {
            "name": "burnPaidHour",
            "type": "u64"
          },
          {
            "name": "lastJackpotBuyTs",
            "type": "i64"
          },
          {
            "name": "finalPool1pct",
            "type": "u64"
          },
          {
            "name": "onepct",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "onePctSlot"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "spotlight",
            "type": {
              "defined": {
                "name": "spotlightSlot"
              }
            }
          },
          {
            "name": "exec",
            "type": {
              "defined": {
                "name": "execRecord"
              }
            }
          },
          {
            "name": "lastStockTradeTs",
            "type": "i64"
          },
          {
            "name": "stockHourIndex",
            "type": "u64"
          },
          {
            "name": "stockBoughtHour",
            "type": "u64"
          },
          {
            "name": "stockSoldHour",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "finalSolTotal",
            "type": "u64"
          },
          {
            "name": "final1pctTotal",
            "type": "u64"
          },
          {
            "name": "lastRevealTs",
            "type": "i64"
          },
          {
            "name": "sbPaidPrevHour",
            "type": "u64"
          },
          {
            "name": "keeperHistoryVersion",
            "type": "u64"
          },
          {
            "name": "keeperHistoryStartedTs",
            "type": "i64"
          },
          {
            "name": "bucketHistory",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "bucketHistory"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "unsettledReveals",
            "type": "u64"
          },
          {
            "name": "reserved0",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    24
                  ]
                },
                25
              ]
            }
          },
          {
            "name": "reserved1",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "mintLedger",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "accounted",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "onePctLive",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "releaseTs",
            "type": "i64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "onePctPulled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "holder",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "onePctSlot",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "state",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "owedWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "packRevealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "edition",
            "type": "u8"
          },
          {
            "name": "liveFlags",
            "type": "u8"
          },
          {
            "name": "holder",
            "type": "bool"
          },
          {
            "name": "t",
            "type": "u32"
          },
          {
            "name": "widths",
            "type": {
              "array": [
                "u32",
                6
              ]
            }
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "hitBucket",
            "type": "u8"
          },
          {
            "name": "houseMask",
            "type": "u8"
          },
          {
            "name": "hitMint",
            "type": "pubkey"
          },
          {
            "name": "hitAmount",
            "type": "u64"
          },
          {
            "name": "hitValue",
            "type": "u64"
          },
          {
            "name": "dust",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "dustPick"
                  }
                },
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "packSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "paid",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "redirectedMask",
            "type": "u8"
          },
          {
            "name": "referralPaid",
            "type": "u64"
          },
          {
            "name": "referralToTeam",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "phaseAdvanced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "u8"
          },
          {
            "name": "to",
            "type": "u8"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pong",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "poweredOn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "launchPool",
            "type": "pubkey"
          },
          {
            "name": "feeIn",
            "type": "pubkey"
          },
          {
            "name": "launchWallet",
            "type": "pubkey"
          },
          {
            "name": "devBuy",
            "type": "u64"
          },
          {
            "name": "vaultAmount",
            "type": "u64"
          },
          {
            "name": "accounted",
            "type": "u64"
          },
          {
            "name": "feeInTopup",
            "type": "u64"
          },
          {
            "name": "powerOnTs",
            "type": "i64"
          },
          {
            "name": "onAirTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pull",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "revealedTs",
            "type": "i64"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "buyerNonce",
            "type": "u32"
          },
          {
            "name": "settledMask",
            "type": "u16"
          },
          {
            "name": "edition",
            "type": "u8"
          },
          {
            "name": "qty",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "holder",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "liveFlags",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pullClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "toStock",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pullOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "edition",
            "type": "u8"
          },
          {
            "name": "qty",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "bool"
          },
          {
            "name": "queue",
            "type": "pubkey"
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "backing",
            "type": {
              "array": [
                "u8",
                10
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pullRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pullRevealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pull",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "randomness",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "qty",
            "type": "u8"
          },
          {
            "name": "hitValueTotal",
            "type": "u64"
          },
          {
            "name": "toStock",
            "type": "u64"
          },
          {
            "name": "toJackpot",
            "type": "u64"
          },
          {
            "name": "toBurn",
            "type": "u64"
          },
          {
            "name": "toTeam",
            "type": "u64"
          },
          {
            "name": "shortfall",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "referralRedirected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "revealTimestamped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "royaltyRedirected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "pack",
            "type": "u8"
          },
          {
            "name": "slot",
            "type": "u8"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellBackCard",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellHistoryUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "hourIndex",
            "type": "u64"
          },
          {
            "name": "sbPaidHour",
            "type": "u64"
          },
          {
            "name": "sbPaidPrevHour",
            "type": "u64"
          },
          {
            "name": "sbInflowHour",
            "type": "u64"
          },
          {
            "name": "sbInflowPrevHour",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "soldBack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "n",
            "type": "u8"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "stockedValue",
            "type": "u64"
          },
          {
            "name": "quoteLamports",
            "type": "u64"
          },
          {
            "name": "value",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "toTeam",
            "type": "u64"
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "sbPaidHour",
            "type": "u64"
          },
          {
            "name": "slotRefund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "spotlightSlot",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "sponsor",
            "type": "pubkey"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "state",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                15
              ]
            }
          }
        ]
      }
    },
    {
      "name": "teamWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "burned",
            "type": "u64"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultShortfall",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vaultAmount",
            "type": "u64"
          },
          {
            "name": "accounted",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "accountSizesBinderHeader",
      "type": "u32",
      "value": "112"
    },
    {
      "name": "accountSizesCardSlot",
      "type": "u32",
      "value": "56"
    },
    {
      "name": "accountSizesDeckEntry",
      "type": "u32",
      "value": "80"
    },
    {
      "name": "accountSizesDeckHeader",
      "type": "u32",
      "value": "64"
    },
    {
      "name": "accountSizesMintLedger",
      "type": "u32",
      "value": "80"
    },
    {
      "name": "accountSizesPullHeader",
      "type": "u32",
      "value": "176"
    },
    {
      "name": "accountSizesPullPerPack",
      "type": "u32",
      "value": "200"
    },
    {
      "name": "attestationsFeedDomain",
      "type": "bytes",
      "value": "[49, 80, 67, 84, 45, 70, 69, 69, 68, 45, 118, 49]"
    },
    {
      "name": "attestationsFeedTtlSeconds",
      "type": "i64",
      "value": "120"
    },
    {
      "name": "attestationsHoldDomain",
      "type": "bytes",
      "value": "[49, 80, 67, 84, 45, 72, 79, 76, 68, 45, 118, 49]"
    },
    {
      "name": "attestationsHoldTtlSeconds",
      "type": "i64",
      "value": "600"
    },
    {
      "name": "attestationsSellBackDomain",
      "type": "bytes",
      "value": "[49, 80, 67, 84, 45, 83, 66, 45, 118, 49]"
    },
    {
      "name": "bpsDenominator",
      "type": "u32",
      "value": "10000"
    },
    {
      "name": "burnHourlyMaxLamports",
      "type": "u64",
      "value": "10000000000"
    },
    {
      "name": "burnMinOutSlipBps",
      "type": "u32",
      "value": "150"
    },
    {
      "name": "burnMinSpacingSeconds",
      "type": "i64",
      "value": "20"
    },
    {
      "name": "burnTrancheMaxBpsOfQuoteReserves",
      "type": "u32",
      "value": "25"
    },
    {
      "name": "burnTrancheMaxLamports",
      "type": "u64",
      "value": "1000000000"
    },
    {
      "name": "cardsPerPackDust",
      "type": "u32",
      "value": "4"
    },
    {
      "name": "cardsPerPackHit",
      "type": "u32",
      "value": "1"
    },
    {
      "name": "coverageDeckMax",
      "type": "u32",
      "value": "120000"
    },
    {
      "name": "coverageDustBuffer",
      "type": "u32",
      "value": "50"
    },
    {
      "name": "coveragePerPackValueBps",
      "type": "u32",
      "value": "150000"
    },
    {
      "name": "creatorFeeSplitBpsAfterEndBurn",
      "type": "u32",
      "value": "0"
    },
    {
      "name": "creatorFeeSplitBpsAfterEndStock",
      "type": "u32",
      "value": "0"
    },
    {
      "name": "creatorFeeSplitBpsAfterEndTeam",
      "type": "u32",
      "value": "10000"
    },
    {
      "name": "creatorFeeSplitBpsBelowFloorBurn",
      "type": "u32",
      "value": "0"
    },
    {
      "name": "creatorFeeSplitBpsBelowFloorStock",
      "type": "u32",
      "value": "10000"
    },
    {
      "name": "creatorFeeSplitBpsBelowFloorTeam",
      "type": "u32",
      "value": "0"
    },
    {
      "name": "creatorFeeSplitBpsSeasonBurn",
      "type": "u32",
      "value": "0"
    },
    {
      "name": "creatorFeeSplitBpsSeasonStock",
      "type": "u32",
      "value": "5000"
    },
    {
      "name": "creatorFeeSplitBpsSeasonTeam",
      "type": "u32",
      "value": "5000"
    },
    {
      "name": "drawTagsBucket",
      "type": "bytes",
      "value": "[49, 112, 99, 116, 58, 98, 117, 99, 107, 101, 116, 58, 118, 49]"
    },
    {
      "name": "drawTagsDust",
      "type": "bytes",
      "value": "[49, 112, 99, 116, 58, 100, 117, 115, 116, 58, 118, 49]"
    },
    {
      "name": "drawTagsRoyaltyMemoPrefix",
      "type": "bytes",
      "value": "[49, 112, 99, 116, 58, 114, 111, 121, 58]"
    },
    {
      "name": "drawTagsTier",
      "type": "bytes",
      "value": "[49, 112, 99, 116, 58, 116, 105, 101, 114, 58, 118, 49]"
    },
    {
      "name": "drawTagsVrfSeed",
      "type": "bytes",
      "value": "[49, 112, 99, 116, 58, 118, 114, 102, 58, 118, 49]"
    },
    {
      "name": "feedRulesFreshCapPerWallet",
      "type": "u32",
      "value": "25"
    },
    {
      "name": "feedRulesMaxMintDecimals",
      "type": "u32",
      "value": "9"
    },
    {
      "name": "governanceGuardianCount",
      "type": "u32",
      "value": "2"
    },
    {
      "name": "governanceMaxTeamWallets",
      "type": "u32",
      "value": "8"
    },
    {
      "name": "hitListSolUsdPythFeedId",
      "type": {
        "array": [
          "u8",
          32
        ]
      },
      "value": "[239, 13, 139, 111, 218, 44, 235, 164, 29, 161, 93, 64, 149, 209, 218, 57, 42, 13, 47, 142, 208, 198, 199, 188, 15, 76, 250, 200, 194, 128, 181, 109]"
    },
    {
      "name": "hitListTrendingNoticeSeconds",
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "hitOddsBlackPpb",
      "type": "u32",
      "value": "2500000"
    },
    {
      "name": "hitOddsBluePpb",
      "type": {
        "array": [
          "u32",
          4
        ]
      },
      "value": "[113925000, 114187500, 114625000, 115500000]"
    },
    {
      "name": "hitOddsCalibratedStockEvBps",
      "type": "u32",
      "value": "7200"
    },
    {
      "name": "hitOddsHoloPpb",
      "type": "u32",
      "value": "20000000"
    },
    {
      "name": "hitOddsJackpotPriceDivisor",
      "type": "u32",
      "value": "400"
    },
    {
      "name": "hitOddsOnePctPriceDivisor",
      "type": "u32",
      "value": "1000"
    },
    {
      "name": "hitOddsSpotlightPriceDivisor",
      "type": "u32",
      "value": "500"
    },
    {
      "name": "hitTiersMajorOnly",
      "type": {
        "array": [
          "bool",
          4
        ]
      },
      "value": "[false, false, true, true]"
    },
    {
      "name": "hitTiersSellBack",
      "type": {
        "array": [
          "bool",
          4
        ]
      },
      "value": "[true, true, true, true]"
    },
    {
      "name": "hitTiersValueBps",
      "type": {
        "array": [
          "u32",
          4
        ]
      },
      "value": "[5000, 15000, 40000, 150000]"
    },
    {
      "name": "jackpotMinOutSlipBps",
      "type": "u32",
      "value": "100"
    },
    {
      "name": "jackpotMinPotPriceMultiple",
      "type": "u32",
      "value": "15"
    },
    {
      "name": "jackpotTrancheMaxBpsOfQuoteReserves",
      "type": "u32",
      "value": "100"
    },
    {
      "name": "jackpotTrancheMaxLamports",
      "type": "u64",
      "value": "2000000000"
    },
    {
      "name": "jackpotTrancheMinSpacingSeconds",
      "type": "i64",
      "value": "20"
    },
    {
      "name": "keeperPolicySolReserveExtraMinutes",
      "type": "i64",
      "value": "15"
    },
    {
      "name": "lamportsPerSol",
      "type": "u64",
      "value": "1000000000"
    },
    {
      "name": "maxFeedBackCards",
      "type": "u8",
      "value": "8"
    },
    {
      "name": "maxListPerRipLamports",
      "type": "u64",
      "value": "5000000000"
    },
    {
      "name": "maxSellBackCards",
      "type": "u8",
      "value": "8"
    },
    {
      "name": "meteoraDammV2Config",
      "type": "pubkey",
      "value": "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck"
    },
    {
      "name": "meteoraDbcConfig",
      "type": "pubkey",
      "value": "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k"
    },
    {
      "name": "meteoraFeeAllowBps",
      "type": "u32",
      "value": "300"
    },
    {
      "name": "packEditionsMaxPerRip",
      "type": {
        "array": [
          "u32",
          4
        ]
      },
      "value": "[10, 10, 10, 5]"
    },
    {
      "name": "packEditionsPriceLamports",
      "type": {
        "array": [
          "u64",
          4
        ]
      },
      "value": "[100000000, 250000000, 500000000, 1000000000]"
    },
    {
      "name": "packSplitBpsBurn1pct",
      "type": "u32",
      "value": "500"
    },
    {
      "name": "packSplitBpsJackpot",
      "type": "u32",
      "value": "500"
    },
    {
      "name": "packSplitBpsReferral",
      "type": "u32",
      "value": "200"
    },
    {
      "name": "packSplitBpsRoyaltyPerDustCard",
      "type": "u32",
      "value": "200"
    },
    {
      "name": "packSplitBpsStock",
      "type": "u32",
      "value": "7200"
    },
    {
      "name": "packSplitBpsTeam",
      "type": "u32",
      "value": "800"
    },
    {
      "name": "pauseBitsBurn",
      "type": "u8",
      "value": "16"
    },
    {
      "name": "pauseBitsFeed",
      "type": "u8",
      "value": "2"
    },
    {
      "name": "pauseBitsRip",
      "type": "u8",
      "value": "1"
    },
    {
      "name": "pauseBitsSellBack",
      "type": "u8",
      "value": "4"
    },
    {
      "name": "pauseBitsStockBuy",
      "type": "u8",
      "value": "8"
    },
    {
      "name": "postRevealBuyDelay",
      "type": "i64",
      "value": "30"
    },
    {
      "name": "ppbDenominator",
      "type": "u32",
      "value": "1000000000"
    },
    {
      "name": "programIdsAssociatedToken",
      "type": "pubkey",
      "value": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    },
    {
      "name": "programIdsComputeBudget",
      "type": "pubkey",
      "value": "ComputeBudget111111111111111111111111111111"
    },
    {
      "name": "programIdsEd25519",
      "type": "pubkey",
      "value": "Ed25519SigVerify111111111111111111111111111"
    },
    {
      "name": "programIdsMagicblockVrf",
      "type": "pubkey",
      "value": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
    },
    {
      "name": "programIdsMemo",
      "type": "pubkey",
      "value": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
    },
    {
      "name": "programIdsMeteoraDammV2",
      "type": "pubkey",
      "value": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
    },
    {
      "name": "programIdsMeteoraDbc",
      "type": "pubkey",
      "value": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
    },
    {
      "name": "programIdsPumpFun",
      "type": "pubkey",
      "value": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
    },
    {
      "name": "programIdsPumpSwap",
      "type": "pubkey",
      "value": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
    },
    {
      "name": "programIdsPythReceiver",
      "type": "pubkey",
      "value": "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"
    },
    {
      "name": "programIdsSplToken",
      "type": "pubkey",
      "value": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
      "name": "programIdsSquadsV4",
      "type": "pubkey",
      "value": "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
    },
    {
      "name": "programIdsToken2022",
      "type": "pubkey",
      "value": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    },
    {
      "name": "pumpLayoutsBondingCurveDiscriminator",
      "type": {
        "array": [
          "u8",
          8
        ]
      },
      "value": "[23, 183, 248, 55, 96, 216, 172, 96]"
    },
    {
      "name": "pumpLayoutsBondingCurveSeed",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101]"
    },
    {
      "name": "pumpLayoutsPoolDiscriminator",
      "type": {
        "array": [
          "u8",
          8
        ]
      },
      "value": "[241, 154, 109, 4, 17, 177, 109, 188]"
    },
    {
      "name": "pumpLayoutsPoolSeed",
      "type": "bytes",
      "value": "[112, 111, 111, 108]"
    },
    {
      "name": "seasonDurationSeconds",
      "type": "i64",
      "value": "604800"
    },
    {
      "name": "seasonFinalPullDelaySeconds",
      "type": "i64",
      "value": "600"
    },
    {
      "name": "seasonOnAirDelaySeconds",
      "type": "i64",
      "value": "900"
    },
    {
      "name": "seasonSealDelaySeconds",
      "type": "i64",
      "value": "259200"
    },
    {
      "name": "sellBackHourlyBudgetBpsOfStockSol",
      "type": "u32",
      "value": "2500"
    },
    {
      "name": "sellBackHourlyBudgetMinLamports",
      "type": "u64",
      "value": "5000000000"
    },
    {
      "name": "sellBackPayoutBps",
      "type": "u32",
      "value": "8700"
    },
    {
      "name": "sellBackQuoteTtlSecondsMajor",
      "type": "i64",
      "value": "60"
    },
    {
      "name": "sellBackQuoteTtlSecondsTrending",
      "type": "i64",
      "value": "20"
    },
    {
      "name": "sellBackSolFloorLamports",
      "type": "u64",
      "value": "1000000000"
    },
    {
      "name": "spotlightMinDepositBpsOfSupply",
      "type": "u32",
      "value": "100"
    },
    {
      "name": "spotlightWindowSeconds",
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "stockCreatorFeeFloorLamports",
      "type": "u64",
      "value": "2000000000"
    },
    {
      "name": "stockHourlyFloorLamports",
      "type": "u64",
      "value": "30000000000"
    },
    {
      "name": "stockHourlyHitOutMultiple",
      "type": "u32",
      "value": "2"
    },
    {
      "name": "stockMajorMinOutSlipBps",
      "type": "u32",
      "value": "150"
    },
    {
      "name": "stockMajorTrancheMaxLamports",
      "type": "u64",
      "value": "5000000000"
    },
    {
      "name": "stockMaxBuckets",
      "type": "u32",
      "value": "16"
    },
    {
      "name": "stockPythMaxAgeSeconds",
      "type": "i64",
      "value": "60"
    },
    {
      "name": "stockPythMaxConfBps",
      "type": "u32",
      "value": "100"
    },
    {
      "name": "stockTargetBaseLamports",
      "type": "u64",
      "value": "30000000000"
    },
    {
      "name": "stockTradeMinSpacingSeconds",
      "type": "i64",
      "value": "20"
    },
    {
      "name": "stockTrendingHourlyMaxLamports",
      "type": "u64",
      "value": "10000000000"
    },
    {
      "name": "stockTrendingMaxCount",
      "type": "u32",
      "value": "4"
    },
    {
      "name": "stockTrendingMinOutSlipBps",
      "type": "u32",
      "value": "100"
    },
    {
      "name": "stockTrendingPoolFeeAllowanceBps",
      "type": "u32",
      "value": "125"
    },
    {
      "name": "stockTrendingShareMaxBps",
      "type": "u32",
      "value": "1500"
    },
    {
      "name": "stockTrendingTrancheMaxLamports",
      "type": "u64",
      "value": "1500000000"
    },
    {
      "name": "token1pctDecimals",
      "type": "u32",
      "value": "6"
    },
    {
      "name": "token1pctDevBuyAmount",
      "type": "u64",
      "value": "40000000000000"
    },
    {
      "name": "token1pctHolderTierOnePctOddsMultiplierBps",
      "type": "u32",
      "value": "15000"
    },
    {
      "name": "token1pctOnePctCardAmount",
      "type": "u64",
      "value": "10000000000000"
    },
    {
      "name": "token1pctOnePctCardCount",
      "type": "u32",
      "value": "4"
    },
    {
      "name": "token1pctOnePctReleaseOffsetsSeconds",
      "type": {
        "array": [
          "i64",
          4
        ]
      },
      "value": "[0, 151200, 302400, 453600]"
    },
    {
      "name": "vrfMaxQueues",
      "type": "u32",
      "value": "4"
    },
    {
      "name": "vrfTimeoutSeconds",
      "type": "i64",
      "value": "300"
    },
    {
      "name": "wsolMint",
      "type": "pubkey",
      "value": "So11111111111111111111111111111111111111112"
    }
  ]
};
