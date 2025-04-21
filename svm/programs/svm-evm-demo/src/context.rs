use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole::{self, program::Wormhole};

use crate::{
    error::WhMessengerError,
    message::WhMessage,
    state::{Config, ForeignEmitter, Received, WormholeEmitter},
};

pub const SEED_PREFIX_SENT: &[u8; 4] = b"sent";

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [Config::SEED_PREFIX],
        bump,
        space = Config::MAXIMUM_SIZE,

    )]
    pub config: Account<'info, Config>,

    pub wormhole_program: Program<'info, Wormhole>,

    #[account(
        mut,
        seeds = [wormhole::BridgeData::SEED_PREFIX],
        bump,
        seeds::program = wormhole_program.key,
    )]
    pub wormhole_bridge: Account<'info, wormhole::BridgeData>,

    #[account(
        mut,
        seeds = [wormhole::FeeCollector::SEED_PREFIX],
        bump,
        seeds::program = wormhole_program.key
    )]
    pub wormhole_fee_collector: Account<'info, wormhole::FeeCollector>,

    #[account(
        init,
        payer = owner,
        seeds = [WormholeEmitter::SEED_PREFIX],
        bump,
        space = WormholeEmitter::MAXIMUM_SIZE
    )]
    pub wormhole_emitter: Account<'info, WormholeEmitter>,

    #[account(
        mut,
        seeds = [
            wormhole::SequenceTracker::SEED_PREFIX,
            wormhole_emitter.key().as_ref()
        ],
        bump,
        seeds::program = wormhole_program.key
    )]
    /// CHECK: Emitter's sequence account. This is not created until the first
    /// message is posted, so it needs to be an [UncheckedAccount] for the
    /// [`initialize`](crate::initialize) instruction.
    /// [`wormhole::post_message`] requires this account be mutable.
    pub wormhole_sequence: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SENT,
            &wormhole::INITIAL_SEQUENCE.to_le_bytes()[..]
        ],
        bump,
    )]
    /// CHECK: Wormhole message account. The Wormhole program writes to this
    /// account, which requires this program's signature.
    /// [`wormhole::post_message`] requires this account be mutable.
    pub wormhole_message: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(chain: u16)]
pub struct RegisterEmitter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ WhMessengerError::OwnerOnly,
        seeds = [Config::SEED_PREFIX],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init, // init_if_needed - was here before
        payer = owner,
        seeds = [
            ForeignEmitter::SEED_PREFIX,
            &chain.to_le_bytes()[..]
        ],
        bump,
        space = ForeignEmitter::MAXIMUM_SIZE
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendMessage<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Config::SEED_PREFIX],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub wormhole_program: Program<'info, Wormhole>,

    #[account(
        mut,
        address = config.wormhole.bridge @ WhMessengerError::InvalidWormholeConfig
    )]
    pub wormhole_bridge: Account<'info, wormhole::BridgeData>,

    #[account(
        mut,
        address = config.wormhole.fee_collector @ WhMessengerError::InvalidWormholeFeeCollector
    )]
    pub wormhole_fee_collector: Account<'info, wormhole::FeeCollector>,

    #[account(
        seeds = [WormholeEmitter::SEED_PREFIX],
        bump,
    )]
    pub wormhole_emitter: Account<'info, WormholeEmitter>,

    #[account(
        mut,
        address = config.wormhole.sequence @ WhMessengerError::InvalidWormholeSequence
    )]
    pub wormhole_sequence: Account<'info, wormhole::SequenceTracker>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SENT,
            &wormhole_sequence.next_value().to_le_bytes()[..]
        ],
        bump,
    )]
    /// CHECK: Wormhole Message. [`wormhole::post_message`] requires this
    /// account be mutable.
    pub wormhole_message: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,
}

type MessageVaa = wormhole::PostedVaa<WhMessage>;

#[derive(Accounts)]
#[instruction(vaa_hash: [u8; 32])]
pub struct ReceiveMessage<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Config::SEED_PREFIX],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub wormhole_program: Program<'info, Wormhole>,

    #[account(
        seeds = [
            wormhole::SEED_PREFIX_POSTED_VAA,
            &vaa_hash
        ],
        bump,
        seeds::program = wormhole_program.key
    )]
    pub posted: Account<'info, MessageVaa>,

    #[account(
        seeds = [
            ForeignEmitter::SEED_PREFIX,
            &posted.emitter_chain().to_le_bytes()[..]
        ],
        bump,
        constraint = foreign_emitter.verify(posted.emitter_address()) @ WhMessengerError::InvalidForeignEmitter
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    #[account(
        init,
        payer = payer,
        seeds = [
            Received::SEED_PREFIX,
            &posted.emitter_chain().to_le_bytes()[..],
            &posted.sequence().to_le_bytes()[..]
        ],
        bump,
        space = Received::MAXIMUM_SIZE
    )]
    pub received: Account<'info, Received>,

    pub system_program: Program<'info, System>,
}
