use anchor_lang::prelude::error_code;

#[error_code]
/// Errors relevant to this program's malfunction.
pub enum WhMessengerError {
    #[msg("InvalidWormholeConfig")]
    InvalidWormholeConfig,

    #[msg("InvalidWormholeFeeCollector")]
    InvalidWormholeFeeCollector,

    #[msg("InvalidWormholeEmitter")]
    InvalidWormholeEmitter,

    #[msg("InvalidWormholeSequence")]
    InvalidWormholeSequence,

    #[msg("InvalidSysvar")]
    InvalidSysvar,

    #[msg("OwnerOnly")]
    OwnerOnly,

    #[msg("InvalidForeignEmitter")]
    InvalidForeignEmitter,

    #[msg("BumpNotFound")]
    BumpNotFound,

    #[msg("InvalidMessage")]
    InvalidMessage,
}
