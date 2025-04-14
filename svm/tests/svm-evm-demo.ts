import {
  chain,
  chainToChainId,
  encoding,
  signSendWait,
  wormhole,
  Relayer,
  WormholeRegistry
} from "@wormhole-foundation/sdk";
import { getSigner } from "./helpers/index";
import solana from "@wormhole-foundation/sdk/solana";
import evm from "@wormhole-foundation/sdk/evm";
import { AnchorProvider } from "@coral-xyz/anchor";

import {
  clusterApiUrl,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { relayer } from "@wormhole-foundation/sdk-base/contracts";

describe("svm-evm-demo", () => {
  // Configure the client to use the local cluster.
  it("Is initialized!", async () => {
    const wh = await wormhole("Testnet", [solana, evm]);

    const sepoliaChain = wh.getChain("Sepolia");
    const solanaChain = wh.getChain("Solana");

    const { signer: solanaSigner, address: solanaAddress } = await getSigner(
      solanaChain
    );
    const { signer: sepoliaSigner, address: sepoliaAddress } = await getSigner(
      sepoliaChain
    );

    // Get a reference to the core messaging bridge
    const coreBridgeSolana = await solanaChain.getWormholeCore();
    const coreBridgeSepolia = await sepoliaChain.getWormholeCore();

    // Generate transactions, sign and send them
    const publishTxs = coreBridgeSolana.publishMessage(
      // Address of sender (emitter in VAA)
      solanaAddress.address,
      // Message to send (payload in VAA)
      encoding.bytes.encode("lol"),
      // Nonce (user defined, no requirement for a specific value, useful to provide a unique identifier for the message)
      0,
      // ConsistencyLevel (ie finality of the message, see wormhole docs for more)
      0
    );
    // Send the transaction(s) to publish the message
    const txids = await signSendWait(solanaChain, publishTxs, solanaSigner);

    // Take the last txid in case multiple were sent
    // the last one should be the one containing the relevant
    // event or log info
    const txid = txids[txids.length - 1];

    // Grab the wormhole message id from the transaction logs or storage
    const [whm] = await solanaChain.parseTransaction(txid!.txid);

    // Or pull the full message content as an Unsigned VAA
    // console.log(await coreBridge.parseMessages(txid!.txid));

    // Wait for the vaa to be signed and available with a timeout
    const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);
    console.log(vaa);

    console.log(sepoliaAddress.address);

    // Step 3: Submit the VAA to Sepolia
    const verifyTxs = coreBridgeSepolia.verifyMessage(
      sepoliaAddress.address,
      vaa!
    );
    const sepoliaTxids = await signSendWait(
      sepoliaChain,
      verifyTxs,
      sepoliaSigner
    );
    console.log("Message processed on Sepolia:", sepoliaTxids);

    
    // Also possible to search by txid but it takes longer to show up
    // console.log(await wh.getVaaByTxHash(txid!.txid, "Uint8Array"));

    // Note: calling verifyMessage manually is typically not a useful thing to do
    // as the VAA is typically submitted to the counterpart contract for
    // a given protocol and the counterpart contract will verify the VAA
    // this is simply for demo purposes
    //const verifyTxs = coreBridgeSolana.verifyMessage(
    //  solanaAddress.address,
    //  vaa!
    //);
    //console.log(await signSendWait(solanaChain, verifyTxs, solanaSigner));
    // EXAMPLE_CORE_BRIDGE
  });
});
