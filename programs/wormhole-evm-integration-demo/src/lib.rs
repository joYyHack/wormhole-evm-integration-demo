use anchor_lang::prelude::*;

declare_id!("HWC8rX3JtVTGyXvtAbyh3TjEi4A7JEUoZtq2tSbVNmho");

#[program]
pub mod wormhole_evm_integration_demo {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
