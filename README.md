# Wormhole EVM-Solana Messaging Demo

This repository provides a basic codebase that demonstrates messaging between Solana and EVM-compatible chains (e.g., Ethereum Sepolia) using the Wormhole protocol. It includes smart contracts for Ethereum, Solana programs, and scripts to send and receive messages between the two chains.

---

## Prerequisites

Before using this repository, ensure you have the following installed:

- **Node.js** (v16 or higher)
- **Rust** (with `cargo` and `anchor-cli`)
- **Foundry** (for EVM development)
- **Solana CLI** (for Solana development)
- **Docker** (optional, for local Solana test validator)

---

## How to Use This Repository

### 1. Build and Deploy Ethereum Contracts

1. Navigate to the `evm` directory:

   ```bash
    cd evm
   ```

2. Install dependencies:

   ```bash
    npm install
   ```

3. Configure the .env file:

   - Update the values in .env with your Ethereum RPC URL, private key, and Wormhole contract address.

4. Compile and deploy the contracts:

   ```bash
    forge script script/WhMessenger.s.sol:WhMessengerScript --broadcast --verify -vvvv
   ```

### 2. Build and Deploy Solana Program

1. Navigate to the `svm` directory:

   ```bash
    cd svm
   ```

2. Build the Solana program:

   ```bash
    anchor keys sync
    anchor build
   ```

3. Deploy the program to the Solana Devnet:

   ```bash
    anchor deploy
   ```

### 3. Run Tests to Send and Receive Messages

1. Navigate to the `svm` directory:

   ```bash
    cd svm
   ```

2. Build the Solana program:

   ```bash
    anchor test
   ```

   or

   ```bash
    anchor test --skip-deploy
   ```

## Notes

- Environment Variables:

  Both the evm and svm directories rely on .env files for configuration. Ensure these files are properly set up before running any commands.

## References

- [Wormhole Scaffolding Repository](https://github.com/wormhole-foundation/wormhole-scaffolding)
- [Wormhole Documentation](https://wormhole.com)
- [Anchor Framework Documentation](https://book.anchor-lang.com/)
- [Foundry Documentation](https://book.getfoundry.sh/)
