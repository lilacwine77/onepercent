use crate::errors::MachineError;
use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct Deferred<'info> {
    pub signer: Signer<'info>,
}
pub fn handler(_ctx: Context<Deferred>) -> Result<()> {
    err!(MachineError::NotImplemented)
}
#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
pub fn ping_handler(_ctx: Context<Ping>) -> Result<()> {
    crate::checks::top_level()?;
    emit!(crate::events::Pong { version: 1 });
    Ok(())
}
