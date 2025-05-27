use anchor_lang::prelude::error_code;

#[error_code]
/// Errors relevant to this program's malfunction.
pub enum WhConnectorError {
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

    #[msg("NonExistentRelayerAta")]
    NonExistentRelayerAta,

    #[msg("InvalidMessage")]
    InvalidMessage,

    #[msg("InvalidPayerAta")]
    InvalidPayerAta,

    #[msg("InvalidRecipient")]
    InvalidRecipient,

    #[msg("InvalidTokenBridgeConfig")]
    InvalidTokenBridgeConfig,

    #[msg("InvalidTokenBridgeForeignEndpoint")]
    InvalidTokenBridgeForeignEndpoint,

    #[msg("InvalidTokenBridgeMintAuthority")]
    InvalidTokenBridgeMintAuthority,

    #[msg("InvalidTransferToAddress")]
    InvalidTransferToAddress,

    #[msg("InvalidTransferToChain")]
    InvalidTransferToChain,

    #[msg("InvalidTransferTokenChain")]
    InvalidTransferTokenChain,

    #[msg("AlreadyRedeemed")]
    AlreadyRedeemed,
}
