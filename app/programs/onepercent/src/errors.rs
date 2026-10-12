use anchor_lang::prelude::*;
#[error_code]
pub enum MachineError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("RoleDisabled")]
    RoleDisabled,
    #[msg("Paused")]
    Paused,
    #[msg("WrongPhase")]
    WrongPhase,
    #[msg("SeasonOver")]
    SeasonOver,
    #[msg("InvalidArgument")]
    InvalidArgument,
    #[msg("InvalidEdition")]
    InvalidEdition,
    #[msg("InvalidQuantity")]
    InvalidQuantity,
    #[msg("TeamWallet")]
    TeamWallet,
    #[msg("NotWallet")]
    NotWallet,
    #[msg("MintNotSafe")]
    MintNotSafe,
    #[msg("MintForbidden")]
    MintForbidden,
    #[msg("NotPumpFun")]
    NotPumpFun,
    #[msg("DuplicateMint")]
    DuplicateMint,
    #[msg("TokensNotReceived")]
    TokensNotReceived,
    #[msg("AttestationInvalid")]
    AttestationInvalid,
    #[msg("AttestationExpired")]
    AttestationExpired,
    #[msg("AttestationReplay")]
    AttestationReplay,
    #[msg("FreshCapReached")]
    FreshCapReached,
    #[msg("DeckFull")]
    DeckFull,
    #[msg("DeckUnderfunded")]
    DeckUnderfunded,
    #[msg("VaultMismatch")]
    VaultMismatch,
    #[msg("LedgerMismatch")]
    LedgerMismatch,
    #[msg("AccountMismatch")]
    AccountMismatch,
    #[msg("CardMoved")]
    CardMoved,
    #[msg("CardNotRedeemable")]
    CardNotRedeemable,
    #[msg("Refilling")]
    Refilling,
    #[msg("MachineHungry")]
    MachineHungry,
    #[msg("LiveFlagsChanged")]
    LiveFlagsChanged,
    #[msg("QueueNotAllowed")]
    QueueNotAllowed,
    #[msg("BinderFull")]
    BinderFull,
    #[msg("PullNotRevealed")]
    PullNotRevealed,
    #[msg("PullMismatch")]
    PullMismatch,
    #[msg("TooEarlyToRefund")]
    TooEarlyToRefund,
    #[msg("BucketsFull")]
    BucketsFull,
    #[msg("BucketExists")]
    BucketExists,
    #[msg("BucketInvalid")]
    BucketInvalid,
    #[msg("TrendingLimit")]
    TrendingLimit,
    #[msg("VaultNotEmpty")]
    VaultNotEmpty,
    #[msg("MintListed")]
    MintListed,
    #[msg("SeasonAlreadySet")]
    SeasonAlreadySet,
    #[msg("InvalidRole")]
    InvalidRole,
    #[msg("MathOverflow")]
    MathOverflow,
    #[msg("VaultInvariant")]
    VaultInvariant,
    #[msg("MultipleFeeds")]
    MultipleFeeds,
    #[msg("NotImplemented")]
    NotImplemented,
    #[msg("NotTopLevel")]
    NotTopLevel,
    #[msg("PayeeBelowRent")]
    PayeeBelowRent,
    #[msg("ExecPairing")]
    ExecPairing,
    #[msg("ExecInFlight")]
    ExecInFlight,
    #[msg("TooSoon")]
    TooSoon,
    #[msg("TrancheTooLarge")]
    TrancheTooLarge,
    #[msg("HourlyCapReached")]
    HourlyCapReached,
    #[msg("TrendingShareExceeded")]
    TrendingShareExceeded,
    #[msg("BucketCapExceeded")]
    BucketCapExceeded,
    #[msg("ReservedCapacity")]
    ReservedCapacity,
    #[msg("BucketDisabled")]
    BucketDisabled,
    #[msg("OracleInvalid")]
    OracleInvalid,
    #[msg("OracleStale")]
    OracleStale,
    #[msg("OracleWide")]
    OracleWide,
    #[msg("SlippageExceeded")]
    SlippageExceeded,
    #[msg("SlackShort")]
    SlackShort,
    #[msg("NotSellBackable")]
    NotSellBackable,
    #[msg("SellBackFloor")]
    SellBackFloor,
    #[msg("SellBackBudget")]
    SellBackBudget,
    #[msg("NotFeedable")]
    NotFeedable,
    #[msg("BinderNotEmpty")]
    BinderNotEmpty,
    #[msg("PullPending")]
    PullPending,
    #[msg("FinalNotClaimed")]
    FinalNotClaimed,
    #[msg("NotLaunchCurve")]
    NotLaunchCurve,
    #[msg("FinalPullNotDue")]
    FinalPullNotDue,
    #[msg("StockBuyPullInFlight")]
    StockBuyPullInFlight,
    #[msg("StockBuyRevealDelay")]
    StockBuyRevealDelay,
    #[msg("StockBuyListingNotice")]
    StockBuyListingNotice,
    #[msg("StockBuyReserve")]
    StockBuyReserve,
}

#[cfg(test)]
mod m2_error_tests {
    use super::MachineError;

    #[test]
    fn m2_errors_append_after_m1_rent_error_without_renumbering() {
        assert_eq!(u32::from(MachineError::NotImplemented), 6045);
        assert_eq!(u32::from(MachineError::NotTopLevel), 6046);
        assert_eq!(u32::from(MachineError::PayeeBelowRent), 6047);
        assert_eq!(u32::from(MachineError::ExecPairing), 6048);
        assert_eq!(u32::from(MachineError::ExecInFlight), 6049);
        assert_eq!(u32::from(MachineError::TooSoon), 6050);
        assert_eq!(u32::from(MachineError::TrancheTooLarge), 6051);
        assert_eq!(u32::from(MachineError::HourlyCapReached), 6052);
        assert_eq!(u32::from(MachineError::TrendingShareExceeded), 6053);
        assert_eq!(u32::from(MachineError::BucketCapExceeded), 6054);
        assert_eq!(u32::from(MachineError::ReservedCapacity), 6055);
        assert_eq!(u32::from(MachineError::BucketDisabled), 6056);
        assert_eq!(u32::from(MachineError::OracleInvalid), 6057);
        assert_eq!(u32::from(MachineError::OracleStale), 6058);
        assert_eq!(u32::from(MachineError::OracleWide), 6059);
        assert_eq!(u32::from(MachineError::SlippageExceeded), 6060);
        assert_eq!(u32::from(MachineError::SlackShort), 6061);
        assert_eq!(u32::from(MachineError::NotSellBackable), 6062);
        assert_eq!(u32::from(MachineError::SellBackFloor), 6063);
        assert_eq!(u32::from(MachineError::SellBackBudget), 6064);
        assert_eq!(u32::from(MachineError::NotFeedable), 6065);
        assert_eq!(u32::from(MachineError::BinderNotEmpty), 6066);
        assert_eq!(u32::from(MachineError::PullPending), 6067);
        assert_eq!(u32::from(MachineError::FinalNotClaimed), 6068);
    }
}
