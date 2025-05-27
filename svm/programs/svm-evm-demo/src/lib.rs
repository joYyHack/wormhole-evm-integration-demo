use anchor_lang::prelude::*;

pub use context::*;
pub use error::*;
pub use message::*;
pub use state::*;

pub mod context;
pub mod error;
pub mod message;
pub mod state;

declare_id!("BSGdiV5Da29dicSZajTMyS87Ae9ph7sJjoQpYqUagbfG");

#[program]
/// A Cross-Chain application. This contract uses Wormhole's
/// generic messaging to send/receive an arbitrary message to/from registered emitters on
/// foreign networks.
pub mod wh_connector {
    use super::*;
    use anchor_lang::solana_program;
    use wormhole_anchor_sdk::{token_bridge, wormhole};

    /// This instruction can be used to generate your program's config.
    /// And for convenience, we will store Wormhole-related PDAs in the
    /// config so we can verify these accounts with a simple == constraint.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Initialize program's sender config
        let sender_config = &mut ctx.accounts.sender_config;

        // Set the owner of the sender config (effectively the owner of the
        // program).
        sender_config.owner = ctx.accounts.owner.key();

        // Set Token Bridge related addresses.
        {
            let token_bridge = &mut sender_config.token_bridge;
            token_bridge.config = ctx.accounts.token_bridge_config.key();
            token_bridge.authority_signer = ctx.accounts.token_bridge_authority_signer.key();
            token_bridge.custody_signer = ctx.accounts.token_bridge_custody_signer.key();
            token_bridge.emitter = ctx.accounts.token_bridge_emitter.key();
            token_bridge.sequence = ctx.accounts.token_bridge_sequence.key();
            token_bridge.wormhole_bridge = ctx.accounts.wormhole_bridge.key();
            token_bridge.wormhole_fee_collector = ctx.accounts.wormhole_fee_collector.key();
        }

        // Initialize program's redeemer config
        let redeemer_config = &mut ctx.accounts.redeemer_config;

        // Set the owner of the redeemer config (effectively the owner of the
        // program).
        redeemer_config.owner = ctx.accounts.owner.key();
        redeemer_config.bump = ctx.bumps.redeemer_config;

        // Set Token Bridge related addresses.
        {
            let token_bridge = &mut redeemer_config.token_bridge;
            token_bridge.config = ctx.accounts.token_bridge_config.key();
            token_bridge.custody_signer = ctx.accounts.token_bridge_custody_signer.key();
            token_bridge.mint_authority = ctx.accounts.token_bridge_mint_authority.key();
        }

        // Done.
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
            WhConnectorError::InvalidForeignEmitter,
        );

        let emitter = &mut ctx.accounts.foreign_emitter;
        emitter.chain = chain;
        emitter.address = address;
        emitter.token_bridge_foreign_endpoint = ctx.accounts.token_bridge_foreign_endpoint.key();

        Ok(())
    }

    /// This instruction posts a Wormhole message of some arbitrary size
    /// in the form of bytes ([Vec<u8>]). The message is encoded as
    /// [WhMessage::Hello], which serializes a payload ID (1) before the message
    /// specified in the instruction. Instead of using the native borsh
    /// serialization of [Vec] length (little endian u32), length of the
    /// message is encoded as big endian u16 (in EVM, bytes for numerics are
    /// natively serialized as big endian).
    pub fn send_message(ctx: Context<SendMessage>, recipient_address: [u8; 32]) -> Result<()> {
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

        let payload: Vec<u8> = WhMessage::Data {
            recipient: recipient_address,
            slc_data: [].to_vec(),
        }
        .try_to_vec()?;

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

    pub fn redeem_transfer_with_payload(
        ctx: Context<RedeemTransferWithPayload>,
        _vaa_hash: [u8; 32],
    ) -> Result<()> {
        msg!("start");
        // The Token Bridge program's claim account is only initialized when
        // a transfer is redeemed (and the boolean value `true` is written as
        // its data).
        //
        // The Token Bridge program will automatically fail if this transfer
        // is redeemed again. But we choose to short-circuit the failure as the
        // first evaluation of this instruction.
        require!(
            ctx.accounts.token_bridge_claim.data_is_empty(),
            WhConnectorError::AlreadyRedeemed
        );

        // The intended recipient must agree with the recipient.
        // let WhMessage::Hello { recipient } = ctx.accounts.vaa.message().data();

        // require!(
        //     ctx.accounts.recipient.key().to_bytes() == *recipient,
        //     WhConnectorError::InvalidRecipient
        // );

        // These seeds are used to:
        // 1.  Redeem Token Bridge program's
        //     complete_transfer_wrapped_with_payload.
        // 2.  Transfer tokens to relayer if he exists.
        // 3.  Transfer remaining tokens to recipient.
        // 4.  Close tmp_token_account.
        let config_seeds = &[
            RedeemerConfig::SEED_PREFIX.as_ref(),
            &[ctx.accounts.config.bump],
        ];

        msg!("here1");

        // Redeem the token transfer.
        token_bridge::complete_transfer_wrapped_with_payload(CpiContext::new_with_signer(
            ctx.accounts.token_bridge_program.to_account_info(),
            token_bridge::CompleteTransferWrappedWithPayload {
                payer: ctx.accounts.payer.to_account_info(),
                config: ctx.accounts.token_bridge_config.to_account_info(),
                vaa: ctx.accounts.vaa.to_account_info(),
                claim: ctx.accounts.token_bridge_claim.to_account_info(),
                foreign_endpoint: ctx.accounts.token_bridge_foreign_endpoint.to_account_info(),
                to: ctx.accounts.tmp_token_account.to_account_info(),
                redeemer: ctx.accounts.config.to_account_info(),
                wrapped_mint: ctx.accounts.token_bridge_wrapped_mint.to_account_info(),
                wrapped_metadata: ctx.accounts.token_bridge_wrapped_meta.to_account_info(),
                mint_authority: ctx.accounts.token_bridge_mint_authority.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                wormhole_program: ctx.accounts.wormhole_program.to_account_info(),
            },
            &[&config_seeds[..]],
        ))?;

        msg!("here2");

        let amount = 100_00000000;
        //ctx.accounts.vaa.data().amount();

        // If this instruction were executed by a relayer, send some of the
        // token amount (determined by the relayer fee) to the payer's token
        // account.
        if ctx.accounts.payer.key() != ctx.accounts.recipient.key() {
            // Does the relayer have an aassociated token account already? If
            // not, he needs to create one.
            require!(
                !ctx.accounts.payer_token_account.data_is_empty(),
                WhConnectorError::NonExistentRelayerAta
            );

            msg!(
                "RedeemWrappedTransferWithPayload :: relayed by {:?}",
                ctx.accounts.payer.key()
            );

            // Transfer tokens from tmp_token_account to recipient.
            anchor_spl::token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.tmp_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    &[&config_seeds[..]],
                ),
                amount,
            )?;
        } else {
            // Transfer tokens from tmp_token_account to recipient.
            anchor_spl::token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.tmp_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    &[&config_seeds[..]],
                ),
                amount,
            )?;
        }

        msg!("here3");
        // Finish instruction by closing tmp_token_account.
        anchor_spl::token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::CloseAccount {
                account: ctx.accounts.tmp_token_account.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[&config_seeds[..]],
        ))
    }
}
