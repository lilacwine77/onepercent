use crate::{errors::MachineError, state::*};
use anchor_lang::{__private::bytemuck, prelude::*, ZeroCopy};

pub fn header<T: ZeroCopy>(data: &[u8]) -> Result<&T> {
    require!(
        data.get(..8) == Some(T::DISCRIMINATOR),
        MachineError::AccountMismatch
    );
    let bytes = data
        .get(8..8usize.saturating_add(core::mem::size_of::<T>()))
        .ok_or(MachineError::AccountMismatch)?;
    bytemuck::try_from_bytes(bytes).map_err(|_| error!(MachineError::AccountMismatch))
}
pub fn header_mut<T: ZeroCopy>(data: &mut [u8]) -> Result<&mut T> {
    require!(
        data.get(..8) == Some(T::DISCRIMINATOR),
        MachineError::AccountMismatch
    );
    let bytes = data
        .get_mut(8..8usize.saturating_add(core::mem::size_of::<T>()))
        .ok_or(MachineError::AccountMismatch)?;
    bytemuck::try_from_bytes_mut(bytes).map_err(|_| error!(MachineError::AccountMismatch))
}
pub fn init_header<T: ZeroCopy>(data: &mut [u8], value: T) -> Result<()> {
    let disc = data.get_mut(..8).ok_or(MachineError::AccountMismatch)?;
    disc.copy_from_slice(T::DISCRIMINATOR);
    *header_mut::<T>(data)? = value;
    Ok(())
}
pub fn tail<T: bytemuck::Pod>(data: &[u8], offset: usize) -> Result<&[T]> {
    bytemuck::try_cast_slice(data.get(offset..).ok_or(MachineError::AccountMismatch)?)
        .map_err(|_| error!(MachineError::AccountMismatch))
}
pub fn tail_mut<T: bytemuck::Pod>(data: &mut [u8], offset: usize) -> Result<&mut [T]> {
    bytemuck::try_cast_slice_mut(
        data.get_mut(offset..)
            .ok_or(MachineError::AccountMismatch)?,
    )
    .map_err(|_| error!(MachineError::AccountMismatch))
}
pub fn deck_size(cap: u32) -> usize {
    (crate::params::ACCOUNT_SIZES_DECK_HEADER as usize)
        .saturating_add(core::mem::size_of::<DeckEntry>().saturating_mul(cap as usize))
}
pub fn binder_size(cap: u16) -> usize {
    (crate::params::ACCOUNT_SIZES_BINDER_HEADER as usize)
        .saturating_add(core::mem::size_of::<Card>().saturating_mul(usize::from(cap)))
}
pub fn pull_size(qty: u8) -> usize {
    (crate::params::ACCOUNT_SIZES_PULL_HEADER as usize)
        .saturating_add(core::mem::size_of::<PackRecord>().saturating_mul(usize::from(qty)))
}
pub fn validate<'a, T: ZeroCopy>(account: &AccountInfo<'a>) -> Result<()> {
    require_keys_eq!(*account.owner, crate::ID, MachineError::AccountMismatch);
    let data = account.try_borrow_data()?;
    header::<T>(&data)?;
    Ok(())
}
pub fn deck_remove(data: &mut [u8], index: u32) -> Result<(DeckEntry, u32)> {
    let mut h = *header::<Deck>(data)?;
    require!(index < h.len, MachineError::CardMoved);
    let last = h.len.saturating_sub(1);
    let entries = tail_mut::<DeckEntry>(data, crate::params::ACCOUNT_SIZES_DECK_HEADER as usize)?;
    let entry = *entries.get(index as usize).ok_or(MachineError::CardMoved)?;
    let moved = *entries.get(last as usize).ok_or(MachineError::CardMoved)?;
    *entries
        .get_mut(index as usize)
        .ok_or(MachineError::CardMoved)? = moved;
    *entries
        .get_mut(last as usize)
        .ok_or(MachineError::CardMoved)? = bytemuck::Zeroable::zeroed();
    h.len = last;
    *header_mut::<Deck>(data)? = h;
    Ok((entry, if index == last { u32::MAX } else { last }))
}
pub fn binder_remove(data: &mut [u8], index: u16) -> Result<(Card, u16)> {
    let mut h = *header::<Binder>(data)?;
    require!(index < h.len, MachineError::CardMoved);
    let last = h.len.saturating_sub(1);
    let cards = tail_mut::<Card>(data, crate::params::ACCOUNT_SIZES_BINDER_HEADER as usize)?;
    let card = *cards
        .get(usize::from(index))
        .ok_or(MachineError::CardMoved)?;
    let moved = *cards
        .get(usize::from(last))
        .ok_or(MachineError::CardMoved)?;
    *cards
        .get_mut(usize::from(index))
        .ok_or(MachineError::CardMoved)? = moved;
    *cards
        .get_mut(usize::from(last))
        .ok_or(MachineError::CardMoved)? = bytemuck::Zeroable::zeroed();
    h.len = last;
    *header_mut::<Binder>(data)? = h;
    Ok((card, if index == last { u16::MAX } else { last }))
}
