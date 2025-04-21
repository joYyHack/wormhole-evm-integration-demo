import {
  AnchorProvider,
  getProvider,
  Program,
  setProvider,
  workspace,
} from "@coral-xyz/anchor";
import { Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ChainContext,
  chainToChainId,
  serialize,
  UniversalAddress,
  Wormhole,
  wormhole,
} from "@wormhole-foundation/sdk";
import { coreBridge } from "@wormhole-foundation/sdk-base/contracts";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { Contract, ethers, Network, randomBytes, Wallet } from "ethers";
import whEVMMessengerAbi from "../../evm/out/Wh.sol/WhMessenger.json";
import { WhMessenger } from "../target/types/wh_messenger";

import etherscanLink from "@metamask/etherscan-link";
import * as dotenv from "dotenv";
dotenv.config();

// temp fix
console.warn = () => {};
console.error = () => {};

describe("send message SVM -> EVM", () => {
  const ENV = "Testnet";
  const SOLANA = "Solana";

  let wh: Wormhole<"Testnet">;
  let solanaChain: ChainContext<"Testnet", "Solana", "Solana">;

  let whSolanaMessenger: Program<WhMessenger>;
  let wormholeCoreAddress: string;

  let solanaProvider: AnchorProvider;
  let solanaPayer: Keypair;

  let evmProvider: ethers.JsonRpcProvider;
  let evmPayer: Wallet;
  let evmNetwork: Network;

  const solanatTxLink = (txSig: string) =>
    solanaChain.config.explorer.baseUrl +
    solanaChain.config.explorer.endpoints.tx +
    txSig +
    solanaChain.config.explorer.networkQuery.Devnet;

  const evmTxLink = (txSig: string) =>
    etherscanLink.createExplorerLink(txSig, evmNetwork.chainId.toString());

  before(async () => {
    setProvider(AnchorProvider.env());
    solanaProvider = getProvider() as AnchorProvider;
    solanaPayer = solanaProvider.wallet.payer;

    wh = await wormhole(ENV, [solana, evm]);
    solanaChain = wh.getChain(SOLANA);

    whSolanaMessenger = workspace.WhMessenger as Program<WhMessenger>;
    wormholeCoreAddress = coreBridge(ENV, SOLANA);

    evmProvider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
    evmPayer = new Wallet(process.env.EVM_PRIVATE_KEY, evmProvider);
    evmNetwork = await evmProvider.getNetwork();
  });

  it("initialize", async () => {
    console.log("Initializing...");

    let configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      whSolanaMessenger.programId
    );

    if (
      (await whSolanaMessenger.account.config.getAccountInfo(configPDA[0])) !==
        null &&
      (
        await whSolanaMessenger.account.config.fetch(configPDA[0])
      ).owner.toBase58() === solanaProvider.publicKey.toBase58()
    ) {
      console.log("Already initialized");
      return;
    }

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
      wormholeCoreAddress,
      solanaProvider.publicKey,
      wormholeMessagePda[0],
      whSolanaMessenger.programId
    );

    const tx_sol = await whSolanaMessenger.methods
      .initialize()
      .accounts({
        owner: getProvider().publicKey,
        // @ts-ignore
        config: configPDA,
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
      tx_sol,
      [solanaPayer]
    );

    console.log(`Transaction link: ${solanatTxLink(txSig)}`);
    console.log("Initalized");
  });

  it("send message SVM -> EVM", async () => {
    const wh = await wormhole(ENV, [solana, evm]);
    const solanaChain = wh.getChain(SOLANA);

    const message = Buffer.from("Hello world: " + randomBytes(6).toString());

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

    console.log("Sending message...");

    const tx_sol = await whSolanaMessenger.methods
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
      tx_sol,
      [solanaPayer]
    );

    console.log(`Transaction link: ${solanatTxLink(txSig)}`);
    console.log("Message sent");

    const [whm] = await solanaChain.parseTransaction(txSig);
    const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);

    const pathToDeployment = `../../evm/broadcast/WhMessenger.s.sol/${evmNetwork.chainId}/run-latest.json`;

    const deploymentTx = (await import(pathToDeployment)).transactions[0];

    const whEVMMessenger = new Contract(
      deploymentTx.contractAddress,
      whEVMMessengerAbi.abi,
      evmPayer
    );

    // Check if the emitter is already registered
    const emitterAddress = await whEVMMessenger.getRegisteredEmitter(
      chainToChainId(SOLANA)
    );

    const universalEmitterAddress = new UniversalAddress(
      wormholeAccounts.emitter.toBase58(),
      "base58"
    ).toString();

    if (emitterAddress !== universalEmitterAddress) {
      console.log("Registering emitter...");

      const tx_evm = await whEVMMessenger.registerEmitter(
        chainToChainId(SOLANA),
        universalEmitterAddress
      );

      await tx_evm.wait();

      console.log(`Transaction link: ${evmTxLink(tx_evm.hash)}`);
      console.log("Emitter registered");
    }

    console.log("Receiving message...");

    const tx_evm = await whEVMMessenger.receiveMessage(serialize(vaa));

    await tx_evm.wait();

    console.log(`Transaction link: ${evmTxLink(tx_evm.hash)}`);
    console.log("Message received");
  });
});
