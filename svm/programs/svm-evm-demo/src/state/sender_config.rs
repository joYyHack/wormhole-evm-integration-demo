use anchor_lang::prelude::*;
use wormhole_anchor_sdk::token_bridge;

#[derive(Default, AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct TokenBridgeAddresses {
    // program pdas
    pub config: Pubkey,
    pub authority_signer: Pubkey,
    pub custody_signer: Pubkey,
    pub emitter: Pubkey,
    pub sequence: Pubkey,
    /// [BridgeData](wormhole_anchor_sdk::wormhole::BridgeData) address.
    pub wormhole_bridge: Pubkey,
    /// [FeeCollector](wormhole_anchor_sdk::wormhole::FeeCollector) address.
    pub wormhole_fee_collector: Pubkey,
}

impl TokenBridgeAddresses {
    pub const LEN: usize =
          32 // config
        + 32 // authority_signer
        + 32 // custody_signer
        + 32 // token_bridge_emitter
        + 32 // token_bridge_sequence
        + 32 // wormhole_bridge
        + 32 // wormhole_fee_collector
    ;
}

#[account]
#[derive(Default)]
/// Config account data.
pub struct SenderConfig {
    pub owner: Pubkey,

    pub token_bridge: TokenBridgeAddresses,
    /// AKA nonce. Just zero, but saving this information in this account anyway.
    pub batch_id: u32,
    /// AKA consistency level. u8 representation of Solana's
    /// [Finality](wormhole_anchor_sdk::wormhole::Finality).
    pub finality: u8,
}

impl SenderConfig {
    pub const MAXIMUM_SIZE: usize = 8 // discriminator
        + 32 // owner
        + TokenBridgeAddresses::LEN
        + 4 // batch_id
        + 1 // finality
        
    ;

    /// AKA `b"sender"`.
    pub const SEED_PREFIX: &'static [u8; 6] = token_bridge::SEED_PREFIX_SENDER;
}