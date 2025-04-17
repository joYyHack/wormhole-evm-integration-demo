import {
  AnchorProvider,
  getProvider,
  Program,
  setProvider,
  workspace,
} from "@coral-xyz/anchor";
import {
  chainToChainId,
  serialize,
  UniversalAddress,
  wormhole,
} from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { Contract, ethers, randomBytes, Wallet } from "ethers";
import sepoliaAbi from "./sepoliaAbi.json";

import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { coreBridge } from "@wormhole-foundation/sdk-base/contracts";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import { WhMessenger } from "../target/types/wh_messenger";

import * as dotenv from "dotenv";
dotenv.config();

describe("send message", () => {
  it.skip("initialize", async () => {
    setProvider(AnchorProvider.env());
    const whSolanaMessenger = workspace.WhMessenger as Program<WhMessenger>;
    const wormholeCore = coreBridge("Testnet", "Solana");

    // const guardiands = Buffer.from(
    //   mocks.devnetGuardianSet().getPublicKeys()[0]
    // );
    // const buffer = Buffer.from([
    //   0xbe, 0xfa, 0x42, 0x9d, 0x57, 0xcd, 0x18, 0xb7, 0xf8, 0xa4, 0xd9, 0x1a,
    //   0x2d, 0xa9, 0xab, 0x4a, 0xf0, 0x5d, 0x0f, 0xbe,
    // ]);
    // const ix = utils.createInitializeInstruction(
    //   getProvider().connection,
    //   new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"),
    //   getProvider().publicKey,
    //   86400,
    //   BigInt(100),
    //   [buffer]
    // );
    //const transaction = new Transaction().add(ix);
    // await sendAndConfirmTransaction(getProvider().connection, transaction, [
    //   getProvider().wallet.payer,
    // ]);

    let configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      whSolanaMessenger.programId
    );

    let wormholeMessagePda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("sent"),
        (() => {
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64LE(BigInt(1));
          return buf;
        })(),
      ],
      whSolanaMessenger.programId
    );

    const wormholeAccounts = utils.getPostMessageAccounts(
      wormholeCore,
      getProvider().publicKey,
      wormholeMessagePda[0],
      whSolanaMessenger.programId
    );

    await whSolanaMessenger.methods
      .initialize()
      .accounts({
        owner: getProvider().publicKey,
        // @ts-ignore
        config: configPDA,
        wormholeProgram: wormholeCore,
        wormholeBridge: wormholeAccounts.bridge,
        wormholeFeeCollector: wormholeAccounts.feeCollector,
        wormholeEmitter: wormholeAccounts.emitter,
        wormholeSequence: wormholeAccounts.sequence,
        wormholeMessage: wormholeAccounts.message,
        clock: wormholeAccounts.clock,
        rent: wormholeAccounts.rent,
        systemProgram: wormholeAccounts.systemProgram,
      })
      .rpc();

    console.log("finish");
  });

  it("send message", async () => {
    setProvider(AnchorProvider.env());

    const whSolanaMessenger = workspace.WhMessenger as Program<WhMessenger>;

    const solanaProvider = getProvider();
    const solanaPayer = solanaProvider.wallet.payer;

    const wh = await wormhole("Testnet", [solana, evm]);
    const solanaChain = wh.getChain("Solana");
    const wormholeCoreAddress = solanaChain.config.contracts.coreBridge;

    const message = Buffer.from("Hello world: " + randomBytes(6).toString());

    // save message count to grab posted message later
    let { sequence } = await utils.getProgramSequenceTracker(
      solanaProvider.connection,
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
      solanaProvider.publicKey,
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
      solanaProvider.connection,
      tx,
      [solanaPayer]
    );

    const [whm] = await solanaChain.parseTransaction(txSig);
    const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);

    const owner = new Wallet(
      process.env.PRIVATE_KEY,
      new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
    );

    // Create a contract
    const whSepoliaMessenger = new Contract(
      "0x800864d06d3f3ab2fbbff9eb17b60eeac22d7e37",
      sepoliaAbi.abi,
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
  });
});
