use anchor_lang::prelude::*;

use crate::{PostedTokenMessage, WhMessage};

#[account]
#[derive(Default)]
/// Foreign emitter account data.
pub struct ForeignEmitter {
    pub chain: u16,

    pub address: [u8; 32],

    pub token_bridge_foreign_endpoint: Pubkey,
}

impl ForeignEmitter {
    pub const MAXIMUM_SIZE: usize = 8 // discriminator
        + 2 // chain
        + 32 // address
        + 32 // token_bridge_foreign_endpoint
    ;

    pub const SEED_PREFIX: &'static [u8; 15] = b"foreign_emitter";

    pub fn verify(&self, vaa: &PostedTokenMessage) -> bool {
        vaa.emitter_chain() == self.chain && *vaa.emitter_address() == self.address
    }
}
