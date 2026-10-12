// Host-side probe of the actual compiled constants, never a network operation.
fn main() {
    println!(
        "{} {}",
        onepercent::ID,
        onepercent::params::METEORA_DBC_CONFIG
    );
}
