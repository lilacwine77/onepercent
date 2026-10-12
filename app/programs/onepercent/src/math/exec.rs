//! Integer executor quotes and bounds. Every economic value comes from PARAMS.
use crate::{errors::MachineError, math, params, state::Bucket};
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Price {
    pub price: u64,
    pub exponent: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PoolReserves {
    pub base: u64,
    pub quote: u64,
    pub quote_eff: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub expected: u64,
    pub min_out: u64,
}

fn quote(expected: u128, slip_bps: u32) -> Result<Quote> {
    let factor = params::BPS_DENOMINATOR
        .checked_sub(slip_bps)
        .ok_or(MachineError::MathOverflow)?;
    let min_out = expected
        .checked_mul(u128::from(factor))
        .ok_or(MachineError::MathOverflow)?
        / u128::from(params::BPS_DENOMINATOR);
    Ok(Quote {
        expected: u64::try_from(expected).map_err(|_| error!(MachineError::MathOverflow))?,
        min_out: u64::try_from(min_out).map_err(|_| error!(MachineError::MathOverflow))?,
    })
}

fn validate_prices(numerator: Price, denominator: Price) -> Result<()> {
    i64::try_from(numerator.price).map_err(|_| error!(MachineError::MathOverflow))?;
    i64::try_from(denominator.price).map_err(|_| error!(MachineError::MathOverflow))?;
    require!(
        numerator.price > 0
            && denominator.price > 0
            && (-18..=0).contains(&numerator.exponent)
            && (-18..=0).contains(&denominator.exponent),
        MachineError::OracleInvalid
    );
    Ok(())
}

fn major(amount: u64, numerator: Price, denominator: Price, exponent: i32) -> Result<Quote> {
    let mut num = u128::from(amount)
        .checked_mul(u128::from(numerator.price))
        .ok_or(MachineError::MathOverflow)?;
    let mut den = u128::from(denominator.price);
    let scale = 10u128
        .checked_pow(exponent.unsigned_abs())
        .ok_or(MachineError::MathOverflow)?;
    if exponent >= 0 {
        num = num.checked_mul(scale).ok_or(MachineError::MathOverflow)?;
    } else {
        den = den.checked_mul(scale).ok_or(MachineError::MathOverflow)?;
    }
    quote(num / den, params::STOCK_MAJOR_MIN_OUT_SLIP_BPS)
}

pub fn major_buy(amount: u64, token: Price, sol: Price, decimals: u8) -> Result<Quote> {
    validate_prices(sol, token)?;
    let exponent = sol
        .exponent
        .checked_sub(token.exponent)
        .and_then(|v| v.checked_add(i32::from(decimals)))
        .and_then(|v| v.checked_sub(9))
        .ok_or(MachineError::MathOverflow)?;
    major(amount, sol, token, exponent)
}

pub fn major_sell(amount: u64, token: Price, sol: Price, decimals: u8) -> Result<Quote> {
    validate_prices(sol, token)?;
    let exponent = token
        .exponent
        .checked_sub(sol.exponent)
        .and_then(|v| v.checked_add(9))
        .and_then(|v| v.checked_sub(i32::from(decimals)))
        .ok_or(MachineError::MathOverflow)?;
    major(amount, token, sol, exponent)
}

fn fee_adjusted(amount: u128) -> Result<u128> {
    let factor = params::BPS_DENOMINATOR
        .checked_sub(params::STOCK_TRENDING_POOL_FEE_ALLOWANCE_BPS)
        .ok_or(MachineError::MathOverflow)?;
    Ok(amount
        .checked_mul(u128::from(factor))
        .ok_or(MachineError::MathOverflow)?
        / u128::from(params::BPS_DENOMINATOR))
}

pub fn pool_buy(amount: u64, pool: PoolReserves, slip_bps: u32) -> Result<Quote> {
    require!(pool.quote_eff > 0, MachineError::OracleInvalid);
    let effective = fee_adjusted(u128::from(amount))?;
    let denominator = pool
        .quote_eff
        .checked_add(effective)
        .ok_or(MachineError::MathOverflow)?;
    let expected = u128::from(pool.base)
        .checked_mul(effective)
        .ok_or(MachineError::MathOverflow)?
        / denominator;
    quote(expected, slip_bps)
}

pub fn pool_sell(amount: u64, pool: PoolReserves, slip_bps: u32) -> Result<Quote> {
    require!(pool.quote_eff > 0, MachineError::OracleInvalid);
    let denominator = u128::from(pool.base)
        .checked_add(u128::from(amount))
        .ok_or(MachineError::MathOverflow)?;
    require!(denominator > 0, MachineError::OracleInvalid);
    let gross = pool
        .quote_eff
        .checked_mul(u128::from(amount))
        .ok_or(MachineError::MathOverflow)?
        / denominator;
    quote(fee_adjusted(gross)?.min(u128::from(pool.quote)), slip_bps)
}

/// The narrow U256 operations needed for a Q64.64 spot buy. Limbs are little
/// endian. Multiplication retains all 256 bits, and division rejects a quotient
/// that cannot fit in a token amount before performing at most 64 iterations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Wide256([u64; 4]);

impl Wide256 {
    fn square(value: u128) -> Self {
        let low = u128::from(value as u64);
        let high = value >> 64;
        let low_square = low * low;
        let cross = low * high;
        let middle = (low_square >> 64) + u128::from(cross as u64) * 2;
        // These are the upper 128 bits of value^2, which fits in 256 bits.
        // Each nonnegative partial sum is therefore bounded by u128::MAX.
        let upper = high * high + (cross >> 64) * 2 + (middle >> 64);
        Self([
            low_square as u64,
            middle as u64,
            upper as u64,
            (upper >> 64) as u64,
        ])
    }

    fn bits(self) -> u32 {
        for (index, limb) in self.0.iter().enumerate().rev() {
            if *limb != 0 {
                return (index as u32 + 1) * 64 - limb.leading_zeros();
            }
        }
        0
    }

    fn cmp(self, other: Self) -> core::cmp::Ordering {
        for (left, right) in self.0.iter().zip(other.0.iter()).rev() {
            match left.cmp(right) {
                core::cmp::Ordering::Equal => (),
                ordering => return ordering,
            }
        }
        core::cmp::Ordering::Equal
    }

    /// The quotient check only needs shifts from zero through 64 inclusive.
    fn shl(self, shift: u32) -> Result<Self> {
        let [a, b, c, d] = self.0;
        Ok(match shift {
            0 => self,
            64 => Self([0, a, b, c]),
            1..=63 => Self([
                a << shift,
                (b << shift) | (a >> (64 - shift)),
                (c << shift) | (b >> (64 - shift)),
                (d << shift) | (c >> (64 - shift)),
            ]),
            _ => return err!(MachineError::MathOverflow),
        })
    }

    /// Caller establishes self >= other, so the final borrow is always false.
    fn sub(self, other: Self) -> Self {
        let mut output = [0u64; 4];
        let mut borrow = false;
        for ((left, right), destination) in self.0.iter().zip(other.0.iter()).zip(output.iter_mut())
        {
            let (difference, first) = left.overflowing_sub(*right);
            let (difference, second) = difference.overflowing_sub(u64::from(borrow));
            *destination = difference;
            borrow = first || second;
        }
        Self(output)
    }

    fn div_u64(self, denominator: Self) -> Result<u64> {
        let denominator_bits = denominator.bits();
        require!(denominator_bits > 0, MachineError::OracleInvalid);
        let numerator_bits = self.bits();
        if numerator_bits < denominator_bits {
            return Ok(0);
        }
        let mut shift = numerator_bits - denominator_bits;
        if shift >= 64 {
            require!(
                shift == 64 && self.cmp(denominator.shl(64)?).is_lt(),
                MachineError::MathOverflow
            );
            shift = 63;
        }
        let mut remainder = self;
        let mut output = 0u64;
        for bit in (0..=shift).rev() {
            let divisor = denominator.shl(bit)?;
            if !remainder.cmp(divisor).is_lt() {
                remainder = remainder.sub(divisor);
                output |= 1u64 << bit;
            }
        }
        Ok(output)
    }
}

/// D29: quote lamports per base unit is sqrt_price^2 / 2^128. Every division
/// floors independently, including the fee adjustment before the spot quote.
pub fn meteora_buy(amount: u64, sqrt_price: u128, slip_bps: u32) -> Result<Quote> {
    require!(sqrt_price > 0, MachineError::OracleInvalid);
    let factor = params::BPS_DENOMINATOR
        .checked_sub(params::METEORA_FEE_ALLOW_BPS)
        .ok_or(MachineError::MathOverflow)?;
    let effective = u128::from(amount) * u128::from(factor) / u128::from(params::BPS_DENOMINATOR);
    // The fee factor is <= BPS_DENOMINATOR, hence effective <= amount <= u64::MAX.
    let numerator = Wide256([0, 0, effective as u64, 0]);
    let expected = numerator.div_u64(Wide256::square(sqrt_price))?;
    quote(u128::from(expected), slip_bps)
}

pub fn removed_book(amount: u64, units: u64, cost: u64) -> Result<u64> {
    require!(amount > 0 && amount <= units, MachineError::InvalidArgument);
    if amount == units {
        return Ok(cost);
    }
    u64::try_from(
        u128::from(amount)
            .checked_mul(u128::from(cost))
            .ok_or(MachineError::MathOverflow)?
            / u128::from(units),
    )
    .map_err(|_| error!(MachineError::MathOverflow))
}

pub fn stock_hourly_cap(last: u64, this: u64) -> u64 {
    params::STOCK_HOURLY_FLOOR_LAMPORTS.max(
        last.max(this)
            .saturating_mul(u64::from(params::STOCK_HOURLY_HIT_OUT_MULTIPLE)),
    )
}

pub fn reserve_tranche(quote_eff: u128, bps: u32) -> Result<u128> {
    Ok(quote_eff
        .checked_mul(u128::from(bps))
        .ok_or(MachineError::MathOverflow)?
        / u128::from(params::BPS_DENOMINATOR))
}

/// D12: preserve every previously eligible edition while this bucket backs Pulls.
/// The fixed layout does not record reservation counts by edition, so this
/// preserves the eligibility set instead of assuming which editions are pending.
pub fn preserve_granularity(before: &Bucket, amount: u64, cost: u64) -> Result<()> {
    if before.reserved == 0 {
        return Ok(());
    }
    let old = math::BucketInput {
        class: before.class,
        enabled: before.enabled != 0,
        amount: before.amount,
        cost: before.cost,
        reserved: before.reserved,
    };
    let next = math::BucketInput {
        amount,
        cost,
        ..old
    };
    for price in params::PACK_EDITIONS_PRICE_LAMPORTS {
        require!(
            !math::coverage_granularity(price, &old) || math::coverage_granularity(price, &next),
            MachineError::ReservedCapacity
        );
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn brief_quotes_match_floor_rounding() {
        let token = Price {
            price: 85_000_000,
            exponent: -8,
        };
        let sol = Price {
            price: 10_901_000_000,
            exponent: -8,
        };
        assert_eq!(
            major_buy(5_000_000_000, token, sol, 6).unwrap(),
            Quote {
                expected: 641_235_294,
                min_out: 631_616_764
            }
        );
        assert_eq!(
            major_sell(641_235_294, token, sol, 6).unwrap(),
            Quote {
                expected: 4_999_999_999,
                min_out: 4_924_999_999
            }
        );
        let pool = PoolReserves {
            base: 500_000_000_000_000,
            quote: 400_000_000_000,
            quote_eff: 398_000_000_000,
        };
        assert_eq!(
            pool_buy(1_500_000_000, pool, params::STOCK_TRENDING_MIN_OUT_SLIP_BPS).unwrap(),
            Quote {
                expected: 1_853_966_863_275,
                min_out: 1_835_427_194_642
            }
        );
        assert_eq!(
            pool_sell(
                1_000_000_000_000,
                pool,
                params::STOCK_TRENDING_MIN_OUT_SLIP_BPS
            )
            .unwrap(),
            Quote {
                expected: 784_481_037,
                min_out: 776_636_226
            }
        );
        assert_eq!(
            meteora_buy(
                50_000_000,
                128_794_468_968_736_475,
                params::BURN_MIN_OUT_SLIP_BPS
            )
            .unwrap(),
            Quote {
                expected: 994_916_785_397,
                min_out: 979_993_033_616
            }
        );
        assert_eq!(
            meteora_buy(
                50_000_000,
                125_545_362_027_818_175,
                params::JACKPOT_MIN_OUT_SLIP_BPS
            )
            .unwrap(),
            Quote {
                expected: 1_047_079_933_723,
                min_out: 1_036_609_134_385
            }
        );
    }

    #[test]
    fn meteora_floors_each_division_and_rejects_unrepresentable_quotes() {
        assert_eq!(
            meteora_buy(34, 1u128 << 63, 150).unwrap(),
            Quote {
                expected: 128,
                min_out: 126
            }
        );
        assert_eq!(
            meteora_buy(1, 1, 0).unwrap(),
            Quote {
                expected: 0,
                min_out: 0
            }
        );
        assert_eq!(
            meteora_buy(u64::MAX, u128::MAX, 0).unwrap(),
            Quote {
                expected: 0,
                min_out: 0
            }
        );
        assert_eq!(
            meteora_buy(u64::MAX, 1u128 << 64, 0).unwrap().expected,
            17_893_341_751_498_265_066
        );
        assert!(meteora_buy(0, 0, 0)
            .unwrap_err()
            .to_string()
            .contains("OracleInvalid"));
        for (amount, sqrt, slip) in [(2, 1, 0), (u64::MAX, 1u128 << 63, 0), (0, 1, 10_001)] {
            assert!(meteora_buy(amount, sqrt, slip)
                .unwrap_err()
                .to_string()
                .contains("MathOverflow"));
        }
    }

    #[test]
    fn wide_square_and_division_preserve_carries_and_quotient_boundary() {
        assert_eq!(
            Wide256::square(u128::MAX),
            Wide256([1, 0, u64::MAX - 1, u64::MAX])
        );
        for value in [0, 1, u32::MAX as u128, u64::MAX as u128] {
            let square = value * value;
            assert_eq!(
                Wide256::square(value),
                Wide256([square as u64, (square >> 64) as u64, 0, 0])
            );
        }
        let one = Wide256([1, 0, 0, 0]);
        assert_eq!(Wide256([u64::MAX, 0, 0, 0]).div_u64(one).unwrap(), u64::MAX);
        assert!(Wide256([0, 1, 0, 0]).div_u64(one).is_err());
        assert_eq!(
            Wide256([0, 2, 0, 0])
                .div_u64(Wide256([3, 0, 0, 0]))
                .unwrap(),
            12_297_829_382_473_034_410
        );
        assert!(Wide256([1, 0, 0, 0]).div_u64(Wide256([0; 4])).is_err());
    }

    #[test]
    fn integer_extremes_fail_without_wrapping() {
        let price = Price {
            price: u64::MAX,
            exponent: 0,
        };
        assert!(major_buy(u64::MAX, price, price, u8::MAX).is_err());
        assert!(pool_sell(
            u64::MAX,
            PoolReserves {
                base: 1,
                quote: 1,
                quote_eff: u128::MAX
            },
            0
        )
        .is_err());
        assert!(
            reserve_tranche(u128::MAX, params::JACKPOT_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES).is_err()
        );
        assert_eq!(
            removed_book(u64::MAX, u64::MAX, u64::MAX).unwrap(),
            u64::MAX
        );
        assert_eq!(stock_hourly_cap(u64::MAX, 0), u64::MAX);
    }

    #[test]
    fn pending_coverage_preserves_each_eligible_edition() {
        let price = params::PACK_EDITIONS_PRICE_LAMPORTS
            .iter()
            .copied()
            .min()
            .unwrap();
        let smallest = math::tier_value(price, crate::constants::KIND_SILVER).unwrap();
        let mut bucket: Bucket = bytemuck::Zeroable::zeroed();
        bucket.class = crate::constants::BUCKET_MAJOR;
        bucket.enabled = 1;
        bucket.amount = 2;
        bucket.cost = smallest * 2;
        bucket.reserved = 1;
        assert!(preserve_granularity(&bucket, 3, smallest * 3).is_ok());
        assert!(preserve_granularity(&bucket, 3, smallest * 3 + 1).is_err());
        assert!(preserve_granularity(&bucket, 1, smallest).is_ok());
        assert!(preserve_granularity(&bucket, 1, smallest + 1).is_err());
        bucket.enabled = 0;
        assert!(preserve_granularity(&bucket, 3, smallest * 3 + 1).is_err());
        assert!(preserve_granularity(&bucket, 1, smallest + 1).is_err());
        bucket.reserved = 0;
        assert!(preserve_granularity(&bucket, 1, smallest + 1).is_ok());
    }

    fn vector_u64(value: &serde_json::Value, field: &str) -> u64 {
        value[field].as_str().unwrap().parse().unwrap()
    }

    fn vector_quote(formula: &str, input: &serde_json::Value) -> Result<Quote> {
        let amount = vector_u64(input, "amount");
        match formula {
            "majorBuy" | "majorSell" => {
                let token = Price {
                    price: vector_u64(input, "tokenPrice"),
                    exponent: i32::try_from(input["tokenExponent"].as_i64().unwrap()).unwrap(),
                };
                let sol = Price {
                    price: vector_u64(input, "solPrice"),
                    exponent: i32::try_from(input["solExponent"].as_i64().unwrap()).unwrap(),
                };
                let decimals = u8::try_from(input["decimals"].as_u64().unwrap()).unwrap();
                if formula == "majorBuy" {
                    major_buy(amount, token, sol, decimals)
                } else {
                    major_sell(amount, token, sol, decimals)
                }
            }
            "poolBuy" | "poolSell" => {
                let base = vector_u64(input, "baseReserve");
                let quote = vector_u64(input, "quoteReserve");
                let virtual_quote: i128 = input["virtualQuoteReserve"]
                    .as_str()
                    .unwrap()
                    .parse()
                    .unwrap();
                let effective = i128::from(quote)
                    .checked_add(virtual_quote)
                    .ok_or(MachineError::MathOverflow)?;
                require!(effective > 0, MachineError::OracleInvalid);
                let pool = PoolReserves {
                    base,
                    quote,
                    quote_eff: u128::try_from(effective).unwrap(),
                };
                let slip = u32::try_from(
                    input["slipBps"]
                        .as_u64()
                        .unwrap_or(u64::from(params::STOCK_TRENDING_MIN_OUT_SLIP_BPS)),
                )
                .unwrap();
                if formula == "poolBuy" {
                    pool_buy(amount, pool, slip)
                } else {
                    pool_sell(amount, pool, slip)
                }
            }
            "meteoraBuy" => meteora_buy(
                amount,
                input["sqrtPrice"].as_str().unwrap().parse().unwrap(),
                u32::try_from(input["slipBps"].as_u64().unwrap()).unwrap(),
            ),
            _ => err!(MachineError::InvalidArgument),
        }
    }

    #[test]
    fn golden_exec_vectors_match_sdk() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/vectors/exec.json")).unwrap();
        for formula in ["majorBuy", "majorSell", "poolBuy", "poolSell", "meteoraBuy"] {
            let rows = vectors.get(formula).unwrap().as_array().unwrap();
            assert!(rows.len() >= 50);
            for row in rows {
                let expected = Quote {
                    expected: vector_u64(&row["output"], "expected"),
                    min_out: vector_u64(&row["output"], "minOut"),
                };
                assert_eq!(
                    vector_quote(formula, &row["input"]).unwrap(),
                    expected,
                    "{formula}: {row}"
                );
            }
        }
        for row in vectors.get("book").unwrap().as_array().unwrap() {
            let input = &row["input"];
            assert_eq!(
                removed_book(
                    vector_u64(input, "amount"),
                    vector_u64(input, "bucketAmount"),
                    vector_u64(input, "cost")
                )
                .unwrap(),
                row["output"].as_str().unwrap().parse::<u64>().unwrap()
            );
        }
        for row in vectors.get("stockCap").unwrap().as_array().unwrap() {
            let input = &row["input"];
            assert_eq!(
                stock_hourly_cap(
                    vector_u64(input, "hitOutLastHour"),
                    vector_u64(input, "hitOutThisHour")
                ),
                row["output"].as_str().unwrap().parse::<u64>().unwrap()
            );
        }
        for row in vectors.get("errors").unwrap().as_array().unwrap() {
            let formula = row["formula"].as_str().unwrap();
            let input = &row["input"];
            let failure = if formula == "book" {
                removed_book(
                    vector_u64(input, "amount"),
                    vector_u64(input, "bucketAmount"),
                    vector_u64(input, "cost"),
                )
                .unwrap_err()
            } else {
                vector_quote(formula, input).unwrap_err()
            };
            assert!(
                failure.to_string().contains(row["error"].as_str().unwrap()),
                "{row}: {failure}"
            );
        }
    }

    /// Inputs are the immutable independent reference dataset; Rust owns every
    /// serialized output and verifies the same bytes consumed by the SDK.
    #[test]
    fn golden_exec_writer() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/vectors/exec.json");
        let original = std::fs::read_to_string(&path).unwrap();
        let mut vectors: serde_json::Value = serde_json::from_str(&original).unwrap();
        for formula in ["majorBuy", "majorSell", "poolBuy", "poolSell", "meteoraBuy"] {
            for row in vectors.get_mut(formula).unwrap().as_array_mut().unwrap() {
                let quote = vector_quote(formula, &row["input"]).unwrap();
                row["output"] = serde_json::json!({"expected":quote.expected.to_string(), "minOut":quote.min_out.to_string()});
            }
        }
        for row in vectors.get_mut("book").unwrap().as_array_mut().unwrap() {
            let input = &row["input"];
            row["output"] = serde_json::json!(removed_book(
                vector_u64(input, "amount"),
                vector_u64(input, "bucketAmount"),
                vector_u64(input, "cost")
            )
            .unwrap()
            .to_string());
        }
        for row in vectors.get_mut("stockCap").unwrap().as_array_mut().unwrap() {
            let input = &row["input"];
            row["output"] = serde_json::json!(stock_hourly_cap(
                vector_u64(input, "hitOutLastHour"),
                vector_u64(input, "hitOutThisHour")
            )
            .to_string());
        }
        let content = format!("{}\n", serde_json::to_string_pretty(&vectors).unwrap());
        if std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1") {
            std::fs::write(&path, &content).unwrap();
        } else {
            assert_eq!(
                original, content,
                "exec.json drifted; run UPDATE_GOLDEN=1 cargo test --lib golden_exec_writer"
            );
        }
    }
}
