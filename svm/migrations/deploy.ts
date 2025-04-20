// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Program, workspace } from "@coral-xyz/anchor";
import {
  chainToChainId,
  serialize,
  UniversalAddress,
  wormhole,
} from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { Contract, ethers, randomBytes, Wallet } from "ethers";
import whEVMMessengerAbi from "@evm/out/WhMessenger.s.sol/WhMessengerScript.json";

import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import { WhMessenger } from "../target/types/wh_messenger";

import * as dotenv from "dotenv";
dotenv.config();

module.exports = async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);
  // Add your deploy script here.

  const whSolanaMessenger = workspace.HelloWorld as Program<WhMessenger>;

  // const solanaProvider = getProvider();
  const solanaPayer = provider.wallet.payer;

  const wh = await wormhole("Testnet", [solana, evm]);
  const solanaChain = wh.getChain("Solana");
  const wormholeCoreAddress = solanaChain.config.contracts.coreBridge;

  const message = Buffer.from("Hello world: " + randomBytes(6).toString());

  // save message count to grab posted message later
  let { sequence } = await utils.getProgramSequenceTracker(
    provider.connection,
    whSolanaMessenger.programId,
    wormholeCoreAddress
  );

  sequence += BigInt(1);

  let configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    whSolanaMessenger.programId
  );

  let wormholeMessagePda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("sent"),
      (() => {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(sequence);
        return buf;
      })(),
    ],
    whSolanaMessenger.programId
  );

  const wormholeAccounts = utils.getPostMessageAccounts(
    wormholeCoreAddress,
    provider.publicKey,
    wormholeMessagePda[0],
    whSolanaMessenger.programId
  );

  const tx = await whSolanaMessenger.methods
    .sendMessage(message)
    .accounts({
      //@ts-ignore
      config: configPda,
      wormholeProgram: wormholeCoreAddress,
      wormholeBridge: wormholeAccounts.bridge,
      wormholeFeeCollector: wormholeAccounts.feeCollector,
      wormholeEmitter: wormholeAccounts.emitter,
      wormholeSequence: wormholeAccounts.sequence,
      wormholeMessage: wormholeAccounts.message,
      clock: wormholeAccounts.clock,
      rent: wormholeAccounts.rent,
      systemProgram: wormholeAccounts.systemProgram,
    })
    .transaction();

  const txSig = await sendAndConfirmTransaction(
    provider.connection,
    tx,
    [solanaPayer],
    { commitment: "processed" }
  );

  const [whm] = await solanaChain.parseTransaction(txSig);
  const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);

  const owner = new Wallet(
    process.env.EVM_PRIVATE_KEY,
    new ethers.JsonRpcProvider(process.env.EVM_RPC_URL)
  );

  // Create a contract
  const whSepoliaMessenger = new Contract(
    "0x800864d06d3f3ab2fbbff9eb17b60eeac22d7e37",
    whEVMMessengerAbi.abi,
    owner
  );

  // Check if the emitter is already registered
  const emitterAddress = await whSepoliaMessenger.getRegisteredEmitter(
    chainToChainId("Solana")
  );

  const universalEmitterAddress = new UniversalAddress(
    wormholeAccounts.emitter.toBase58(),
    "base58"
  ).toString();

  if (emitterAddress !== universalEmitterAddress) {
    console.log("Registering emitter");

    const tx = await whSepoliaMessenger.registerEmitter(
      chainToChainId("Solana"),
      universalEmitterAddress
    );

    await tx.wait();
  }

  console.log("Receiving message");

  const txSep = await whSepoliaMessenger.receiveMessage(serialize(vaa));
  await txSep.wait();
};
