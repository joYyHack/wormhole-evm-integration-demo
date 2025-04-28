use anchor_lang::prelude::*;

pub use context::*;
pub use error::*;
pub use message::*;
pub use state::*;

pub mod context;
pub mod error;
pub mod message;
pub mod state;

declare_id!("8ytSoUuPamxUoYs8YTkV1tdnhQAHHbyjB3DWJHTVzRBd");

#[program]
/// A Cross-Chain application. This contract uses Wormhole's
/// generic messaging to send/receive an arbitrary message to/from registered emitters on
/// foreign networks.
pub mod wh_messenger {
    use super::*;
    use anchor_lang::solana_program;
    use wormhole_anchor_sdk::wormhole;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Initializing program...");

        let config = &mut ctx.accounts.config;

        config.owner = ctx.accounts.owner.key();

        {
            let wormhole = &mut config.wormhole;

            wormhole.bridge = ctx.accounts.wormhole_bridge.key();

            wormhole.fee_collector = ctx.accounts.wormhole_fee_collector.key();

            wormhole.sequence = ctx.accounts.wormhole_sequence.key();
        }

        config.batch_id = 0;

        config.finality = wormhole::Finality::Confirmed as u8;

        ctx.accounts.wormhole_emitter.bump = ctx.bumps.wormhole_emitter;

        {
            let fee = ctx.accounts.wormhole_bridge.fee();
            if fee > 0 {
                solana_program::program::invoke(
                    &solana_program::system_instruction::transfer(
                        &ctx.accounts.owner.key(),
                        &ctx.accounts.wormhole_fee_collector.key(),
                        fee,
                    ),
                    &ctx.accounts.to_account_infos(),
                )?;
            }

            let wormhole_emitter = &ctx.accounts.wormhole_emitter;
            let config = &ctx.accounts.config;

            let mut payload: Vec<u8> = Vec::new();
            WhMessage::serialize(
                &WhMessage::Alive {
                    program_id: *ctx.program_id,
                },
                &mut payload,
            )?;

            wormhole::post_message(
                CpiContext::new_with_signer(
                    ctx.accounts.wormhole_program.to_account_info(),
                    wormhole::PostMessage {
                        config: ctx.accounts.wormhole_bridge.to_account_info(),
                        message: ctx.accounts.wormhole_message.to_account_info(),
                        emitter: wormhole_emitter.to_account_info(),
                        sequence: ctx.accounts.wormhole_sequence.to_account_info(),
                        payer: ctx.accounts.owner.to_account_info(),
                        fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                        clock: ctx.accounts.clock.to_account_info(),
                        rent: ctx.accounts.rent.to_account_info(),
                        system_program: ctx.accounts.system_program.to_account_info(),
                    },
                    &[
                        &[
                            SEED_PREFIX_SENT,
                            &wormhole::INITIAL_SEQUENCE.to_le_bytes()[..],
                            &[ctx.bumps.wormhole_message],
                        ],
                        &[wormhole::SEED_PREFIX_EMITTER, &[wormhole_emitter.bump]],
                    ],
                ),
                config.batch_id,
                payload,
                config.finality.try_into().unwrap(),
            )?;
        }

        Ok(())
    }

    /// This instruction registers a new foreign emitter (from another network)
    /// and saves the emitter information in a ForeignEmitter account. This
    /// instruction is owner-only, meaning that only the owner of the program
    /// (defined in the [Config] account) can add and update emitters.
    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        chain: u16,
        address: [u8; 32],
    ) -> Result<()> {
        require!(
            chain > 0 && chain != wormhole::CHAIN_ID_SOLANA && !address.iter().all(|&x| x == 0),
            WhMessengerError::InvalidForeignEmitter,
        );

        let emitter = &mut ctx.accounts.foreign_emitter;
        emitter.chain = chain;
        emitter.address = address;

        Ok(())
    }

    /// This instruction posts a Wormhole message of some arbitrary size
    /// in the form of bytes ([Vec<u8>]). The message is encoded as
    /// [WhMessage::Hello], which serializes a payload ID (1) before the message
    /// specified in the instruction. Instead of using the native borsh
    /// serialization of [Vec] length (little endian u32), length of the
    /// message is encoded as big endian u16 (in EVM, bytes for numerics are
    /// natively serialized as big endian).
    pub fn send_message(ctx: Context<SendMessage>, message: Vec<u8>) -> Result<()> {
        let fee = ctx.accounts.wormhole_bridge.fee();
        if fee > 0 {
            solana_program::program::invoke(
                &solana_program::system_instruction::transfer(
                    &ctx.accounts.payer.key(),
                    &ctx.accounts.wormhole_fee_collector.key(),
                    fee,
                ),
                &ctx.accounts.to_account_infos(),
            )?;
        }

        let wormhole_emitter = &ctx.accounts.wormhole_emitter;
        let config = &ctx.accounts.config;

        let payload: Vec<u8> = WhMessage::Hello { message }.try_to_vec()?;

        wormhole::post_message(
            CpiContext::new_with_signer(
                ctx.accounts.wormhole_program.to_account_info(),
                wormhole::PostMessage {
                    config: ctx.accounts.wormhole_bridge.to_account_info(),
                    message: ctx.accounts.wormhole_message.to_account_info(),
                    emitter: wormhole_emitter.to_account_info(),
                    sequence: ctx.accounts.wormhole_sequence.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[
                    &[
                        SEED_PREFIX_SENT,
                        &ctx.accounts.wormhole_sequence.next_value().to_le_bytes()[..],
                        &[ctx.bumps.wormhole_message],
                    ],
                    &[wormhole::SEED_PREFIX_EMITTER, &[wormhole_emitter.bump]],
                ],
            ),
            config.batch_id,
            payload,
            config.finality.try_into().unwrap(),
        )?;

        Ok(())
    }

    /// This instruction reads a posted verified Wormhole message and verifies
    /// that the payload is of type [WhMessage::Hello] (payload ID == 1). WhMessage
    /// data is stored in a [Received] account.
    ///
    /// # Arguments
    ///
    /// * `vaa_hash` - Keccak256 hash of verified Wormhole message
    pub fn receive_message(ctx: Context<ReceiveMessage>, vaa_hash: [u8; 32]) -> Result<()> {
        let posted_message = &ctx.accounts.posted;

        if let WhMessage::Hello { message } = posted_message.data() {
            require!(
                message.len() <= MESSAGE_MAX_LENGTH,
                WhMessengerError::InvalidMessage,
            );

            let received = &mut ctx.accounts.received;
            received.batch_id = posted_message.batch_id();
            received.wormhole_message_hash = vaa_hash;
            received.message = message.clone();

            Ok(())
        } else {
            Err(WhMessengerError::InvalidMessage.into())
        }
    }
}
