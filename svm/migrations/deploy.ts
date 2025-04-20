// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import {
  AnchorProvider,
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
import whEVMMessengerAbi from "../../evm/out/Wh.sol/WhMessenger.json";

import { Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import { WhMessenger } from "../target/types/wh_messenger";

import * as dotenv from "dotenv";
import { coreBridge } from "@wormhole-foundation/sdk-base/contracts";
dotenv.config();

const ENV = "Testnet";
const SOLANA = "Solana";

let whSolanaMessenger: Program<WhMessenger>;
let wormholeCoreAddress: string;
let solanaProvider: AnchorProvider;
let solanaPayer: Keypair;

function setup(provider: anchor.AnchorProvider) {
  setProvider(provider);
  solanaProvider = provider;
  solanaPayer = solanaProvider.wallet.payer;

  whSolanaMessenger = workspace.WhMessenger as Program<WhMessenger>;
  wormholeCoreAddress = coreBridge(ENV, SOLANA);
}

async function initialize() {
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

  await whSolanaMessenger.methods
    .initialize()
    .accounts({
      owner: solanaProvider.publicKey,
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
    .rpc({ commitment: "confirmed" });

  console.log("Initalized");
}

async function sendMessage() {
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
    [solanaPayer],
    { commitment: "processed" }
  );

  console.log("Message sent");

  const [whm] = await solanaChain.parseTransaction(txSig);
  const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);

  const evmProvider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);

  const owner = new Wallet(process.env.EVM_PRIVATE_KEY, evmProvider);

  const pathToDeployment = `../../evm/broadcast/WhMessenger.s.sol/${
    (await evmProvider.getNetwork()).chainId
  }/run-latest.json`;

  const deploymentTx = (await import(pathToDeployment)).transactions[0];

  const whEVMMessenger = new Contract(
    deploymentTx.contractAddress,
    whEVMMessengerAbi.abi,
    owner
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

    const tx = await whEVMMessenger.registerEmitter(
      chainToChainId(SOLANA),
      universalEmitterAddress
    );

    await tx.wait();

    console.log("Emitter registered");
  }

  console.log("Receiving message...");

  const txSep = await whEVMMessenger.receiveMessage(serialize(vaa));
  await txSep.wait();

  console.log("Message received");
}

module.exports = async function (provider: anchor.AnchorProvider) {
  setup(provider);
  await initialize();

  console.log("Waiting for 3 seconds...");
  await sleep(3000);

  await sendMessage();
};

function sleep(ms: number) {
  return new Promise((_) => setTimeout(_, ms));
}
