//! Frozen-pool pro rata shares, rounded toward the Machine.
#![deny(clippy::arithmetic_side_effects)]

pub fn final_share(pool: u64, spend: u64, total: u64) -> u64 {
    let share = u128::from(pool)
        .saturating_mul(u128::from(spend))
        .checked_div(u128::from(total))
        .unwrap_or(0);
    u64::try_from(share).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::final_share;

    #[test]
    fn boundary_and_reference_shares() {
        for (pool, spend, total, expected) in [
            (
                1_000_000_000_000,
                4_200_000_000,
                4_980_000_000_000,
                843_373_493,
            ),
            (
                43_000_000_000_000,
                4_200_000_000,
                4_980_000_000_000,
                36_265_060_240,
            ),
            (1_000, 0, 100, 0),
            (1_000, 100, 100, 1_000),
            (1_000, 0, 0, 0),
            (1_000, 100, 0, 0),
            (0, 100, 100, 0),
            (1, 1, 2, 0),
            (2, 1, 2, 1),
            (10, 1, 3, 3),
            (u64::MAX, u64::MAX, u64::MAX, u64::MAX),
            (u64::MAX, 1, u64::MAX, 1),
            (u64::MAX, u64::MAX, 1, u64::MAX),
        ] {
            assert_eq!(final_share(pool, spend, total), expected);
        }
    }

    #[test]
    fn floors_conserve_pools_and_leave_remainders() {
        for pool in [0, 1, 2, 3, 10, 1_000_000_007, u64::MAX] {
            let total: u64 = 15;
            let paid = [1, 2, 3, 4, 5]
                .into_iter()
                .map(|spend| u128::from(final_share(pool, spend, total)))
                .sum::<u128>();
            assert!(paid <= u128::from(pool));
            assert!(u128::from(pool).saturating_sub(paid) < 5);
        }
    }
}
