import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WormholeEvmIntegrationDemo } from "../target/types/wormhole_evm_integration_demo";

describe("wormhole-evm-integration-demo", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.wormholeEvmIntegrationDemo as Program<WormholeEvmIntegrationDemo>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
