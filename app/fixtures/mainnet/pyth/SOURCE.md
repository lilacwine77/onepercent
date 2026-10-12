# Pyth sponsored price account captures

These are read-only mainnet-beta `getAccountInfo` responses with finalized
commitment and base64 encoding. They contain SOL/USD and every launch MAJOR feed
from PARAMS §21. No transaction was constructed, signed or sent.

The addresses derive from `[0u16.to_le_bytes(), feed_id]` under the upgraded push
oracle `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou`. Every captured account is owned
by the upgraded receiver `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`.

| Feed         | Feed id                                                            | Account                                        | Capture slot | Capture time UTC    |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------- | ------------ | ------------------- |
| SOL/USD      | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` | 454845182    | 2026-10-09 10:53:53 |
| WIF/USD      | `4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc` | `9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG` | 454845183    | 2026-10-09 10:53:53 |
| BONK/USD     | `72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419` | `3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w` | 454845183    | 2026-10-09 10:53:53 |
| POPCAT/USD   | `b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce` | `AyAMTHfsQVnXvNnHMqpaQo5sEpWSszoeqjEmdoEv1U9a` | 454845183    | 2026-10-09 10:53:54 |
| FARTCOIN/USD | `58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608` | `65g8gPGkHH5Ss5YPJNCxRAa9dnvp37khzeY7tbbe3ntw` | 454847144    | 2026-10-09 11:02:35 |
| PNUT/USD     | `116da895807f81f6b5c5f01b109376e7f6834dc8b51365ab7cdfa66634340e54` | `4Ah59WNbes7N6U8g9auxBCuRWVvwtybnxaTj3yMPwxEQ` | 454847145    | 2026-10-09 11:02:35 |

## Layout confirmation

All six records match every M2 §6.4 offset, with little-endian integers:

| Field                | Offset | Size | Captured result                  |
| -------------------- | ------ | ---- | -------------------------------- |
| discriminator        | 0      | 8    | `22f123639d7ef4cd`               |
| `verification_level` | 40     | 1    | `1`, Full                        |
| `feed_id`            | 41     | 32   | Exact id in the table above      |
| `price`              | 73     | 8    | Positive `i64`                   |
| `conf`               | 81     | 8    | `u64`                            |
| `exponent`           | 89     | 4    | `i32`, -8 except BONK at -10     |
| `publish_time`       | 93     | 8    | Unix seconds, `i64`              |
| Account length       |        |      | 134 bytes; parser minimum is 133 |

The parser tests derive every shard-0 PDA and independently assert the bytes and
decoded values below. Each positive parser test uses that fixture's publish time,
so a historical capture does not become a failing test as time passes.

| Feed         | Price       | Confidence | Exponent | Publish time |
| ------------ | ----------- | ---------- | -------- | ------------ |
| SOL/USD      | 10947583462 | 3153335    | -8       | 1791543222   |
| WIF/USD      | 21025749    | 5828       | -8       | 1791543195   |
| BONK/USD     | 33190       | 33         | -10      | 1791543195   |
| POPCAT/USD   | 4681263     | 3237       | -8       | 1791543153   |
| FARTCOIN/USD | 16299830    | 6328       | -8       | 1791543736   |
| PNUT/USD     | 4943355     | 3996       | -8       | 1791414145   |

POPCAT was already older than 60 seconds and PNUT was much older at capture. These
records prove the account layout, not current eligibility for a trade. The parser
still rejects stale updates; PARAMS §21.1 requires the keeper to post a fresh Full
update when a sponsored account cannot meet the age bound.

## Re-capture

Run from the repository root. This repeats only the recorded read-only RPC
requests and writes new captures to `/tmp/onepercent-pyth-recapture/`. Review new
captures and update the table and expected fixture values together if replacing
the checked-in evidence.

```sh
python3 <<'PY'
import datetime
import json
import pathlib
import urllib.request

destination = pathlib.Path('/tmp/onepercent-pyth-recapture')
destination.mkdir(exist_ok=True)
for path in sorted(pathlib.Path('app/fixtures/mainnet/pyth').glob('*.json')):
    record = json.loads(path.read_text())
    request = urllib.request.Request(
        record['endpoint'],
        data=json.dumps(record['request']).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request) as response:
        record['response'] = json.load(response)
    assert record['response'].get('result', {}).get('value') is not None
    record['capturedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (destination / path.name).write_text(json.dumps(record, indent=2) + '\n')
    print(path.name, record['response']['result']['context']['slot'])
PY
```
