import bs58 from "bs58";
import {
  AnchorProvider,
  getProvider,
  Program,
  setProvider,
  workspace,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  ChainContext,
  chains,
  chainToChainId,
  deserialize,
  NativeAddress,
  serialize,
  signSendWait,
  TokenTransfer,
  UniversalAddress,
  VAA,
  Wormhole,
  wormhole,
} from "@wormhole-foundation/sdk";
import {
  coreBridge,
  tokenBridge,
} from "@wormhole-foundation/sdk-base/contracts";
import { getTokenByAddress } from "@wormhole-foundation/sdk-base/tokens";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  deriveAuthoritySignerKey,
  deriveCustodySignerKey,
  deriveEndpointKey,
  deriveMintAuthorityKey,
  deriveTokenBridgeConfigKey,
  deriveWrappedMintKey,
  getCompleteTransferWrappedWithPayloadCpiAccounts,
  getTransferWrappedWithPayloadAccounts,
} from "@wormhole-foundation/sdk-solana-tokenbridge";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { Contract, ethers, Network, randomBytes, Wallet } from "ethers";
import whEVMMessengerAbi from "../../evm/out/Wh.sol/WhMessenger.json";
import { WhMessenger } from "../target/types/wh_messenger";

import etherscanLink from "@metamask/etherscan-link";
import * as dotenv from "dotenv";
import {
  getGuardianSet,
  getWormholeDerivedAccounts,
} from "@wormhole-foundation/sdk-solana-core/dist/cjs/utils";
import { utils as testingUtils } from "@wormhole-foundation/sdk-definitions/testing";
import { getSigner } from "./helpers/helpers";
dotenv.config();

import { toNative } from "@wormhole-foundation/sdk";
import { inspect } from "util";
import { WhConnector } from "../target/types/wh_connector";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";

// temp fix
// console.warn = () => {};
// console.error = () => {};

describe("messaging SVM -> EVM", () => {
  const ENV = "Testnet";
  const SOLANA = "Solana";
  const SEPOLIA = "Sepolia";

  let wh: Wormhole<"Testnet">;
  let solanaChain: ChainContext<"Testnet", "Solana", "Solana">;

  let whSolanaMessenger: Program<WhMessenger>;
  let whSolanaConnector: Program<WhConnector>;

  let wormholeCoreAddress: string;
  let tokenBridgeAddress: string;
  let tokenBridgeAddressSepolia: string;

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

    //whSolanaMessenger = workspace.WhMessenger as Program<WhMessenger>;
    whSolanaConnector = workspace.WhConnector as Program<WhConnector>;
    wormholeCoreAddress = coreBridge(ENV, SOLANA);
    tokenBridgeAddress = tokenBridge(ENV, SOLANA);
    tokenBridgeAddressSepolia = tokenBridge(ENV, SEPOLIA);

    evmProvider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
    evmPayer = new Wallet(process.env.EVM_PRIVATE_KEY, evmProvider);
    evmNetwork = await evmProvider.getNetwork();
  });

  it.only("initialize", async () => {
    console.log("Initializing...");

    let configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("sender")],
      whSolanaConnector.programId
    );

    if (
      (await whSolanaConnector.account.senderConfig.getAccountInfo(
        configPDA[0]
      )) != null &&
      (
        await whSolanaConnector.account.senderConfig.fetch(configPDA[0])
      ).owner.toBase58() === solanaProvider.publicKey.toBase58()
    ) {
      console.log("Already initialized");
      return;
    }

    const {
      wormholeEmitter: tokenBridgeEmitter,
      wormholeBridge,
      wormholeFeeCollector,
      wormholeSequence: tokenBridgeSequence,
    } = utils.getWormholeDerivedAccounts(
      tokenBridgeAddress,
      wormholeCoreAddress
    );

    const tx = await whSolanaConnector.methods
      .initialize()
      .accounts({
        owner: solanaPayer.publicKey,
        wormholeBridge: wormholeBridge,
        tokenBridgeConfig: deriveTokenBridgeConfigKey(tokenBridgeAddress),
        tokenBridgeAuthoritySigner:
          deriveAuthoritySignerKey(tokenBridgeAddress),
        tokenBridgeCustodySigner: deriveCustodySignerKey(tokenBridgeAddress),
        tokenBridgeMintAuthority: deriveMintAuthorityKey(tokenBridgeAddress),
        tokenBridgeEmitter,
        wormholeFeeCollector,
        tokenBridgeSequence,
      })
      .transaction();

    const txSig = await sendAndConfirmTransaction(
      solanaProvider.connection,
      tx,
      [solanaPayer]
    );

    console.log(`Transaction link: ${solanatTxLink(txSig)}`);
    console.log("Initalized");
  });

  it.only("redeem transfer with payload", async () => {
    const wh = await wormhole(ENV, [solana, evm]);
    const sepoliaChain = wh.getChain(SEPOLIA);
    const solanaChain = wh.getChain(SOLANA);

    const [whm] = await sepoliaChain.parseTransaction(
      "0xf8a2cb8aae4c8427151a1777de5c22fd4658d66a02017a69a1eb2e6ff33655e4"
    );

    const vaa = await wh.getVaa(
      whm!,
      "TokenBridge:TransferWithPayload",
      100_000
    );

    if (!vaa) {
      console.info(
        "\nVaa is not yet available. Please wait around 15-20 minutes for message to be processed."
      );

      return;
    }

    const foreignEmitter = PublicKey.findProgramAddressSync(
      [
        Buffer.from("foreign_emitter"),
        (() => {
          const buf = Buffer.alloc(2);
          buf.writeUInt16LE(chainToChainId(vaa.emitterChain));
          return buf;
        })(),
      ],
      whSolanaConnector.programId
    );

    const wrappedMint = deriveWrappedMintKey(
      tokenBridgeAddress,
      chainToChainId(vaa.payload.token.chain),
      vaa.payload.token.address.address
    );

    const tmpTokenAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("tmp"), new PublicKey(wrappedMint).toBuffer()],
      whSolanaConnector.programId
    );

    const tokenBridgeAccounts =
      getCompleteTransferWrappedWithPayloadCpiAccounts(
        tokenBridgeAddress,
        wormholeCoreAddress,
        solanaPayer.publicKey,
        vaa,
        tmpTokenAccount
      );

    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      solanaProvider.connection,
      solanaPayer,
      wrappedMint,
      solanaPayer.publicKey
    );

    let foreignEmitterAddress: string = null;
    try {
      let _address: number[];
      ({ address: _address } =
        await whSolanaConnector.account.foreignEmitter.fetch(
          foreignEmitter[0]
        ));

      foreignEmitterAddress =
        "0x" +
        Array.from(_address)
          .map((byte) => byte.toString(16).padStart(2, "0")) // Convert each byte to a 2-character hex string
          .join("");
    } catch {}

    if (
      foreignEmitterAddress === null ||
      foreignEmitterAddress !== vaa.emitterAddress.toString()
    ) {
      const registerEmitterTx = await whSolanaConnector.methods
        .registerEmitter(chainToChainId(vaa.emitterChain), [
          ...vaa.emitterAddress.toUint8Array(),
        ])
        .accounts({
          foreignEmitter: foreignEmitter[0],
          tokenBridgeForeignEndpoint: deriveEndpointKey(
            tokenBridgeAddress,
            chainToChainId(sepoliaChain.chain),
            tokenBridgeAddressSepolia
          ),
        })
        .transaction();

      const registerEmitterSig = await sendAndConfirmTransaction(
        solanaProvider.connection,
        registerEmitterTx,
        [solanaPayer]
      );

      console.log(`Transaction link: ${solanatTxLink(registerEmitterSig)}`);
      console.log("Emitter registered");
    } else {
      console.log("Emitter already registered");
    }

    const { signer, address } = await getSigner(wh.getChain(SOLANA));

    const verifyTxs = (await solanaChain.getWormholeCore()).verifyMessage(
      address.address,
      vaa
    );

    await signSendWait(wh.getChain(SOLANA), verifyTxs, signer);

    const tx = await whSolanaConnector.methods
      .redeemTransferWithPayload([...vaa.hash])
      .accounts({
        payer: solanaPayer.publicKey,
        foreignEmitter: foreignEmitter[0],
        recipient: solanaPayer.publicKey,
        payerTokenAccount: getAssociatedTokenAddressSync(
          wrappedMint,
          solanaPayer.publicKey
        ),
        tokenBridgeClaim: tokenBridgeAccounts.tokenBridgeClaim,
        tokenBridgeConfig: tokenBridgeAccounts.tokenBridgeConfig,
        tokenBridgeForeignEndpoint:
          tokenBridgeAccounts.tokenBridgeForeignEndpoint,
        tokenBridgeMintAuthority: tokenBridgeAccounts.tokenBridgeMintAuthority,
        tokenBridgeWrappedMint: tokenBridgeAccounts.tokenBridgeWrappedMint,
        tokenBridgeWrappedMeta: tokenBridgeAccounts.tokenBridgeWrappedMeta,
        vaa: tokenBridgeAccounts.vaa,
      })
      .transaction();

    const txSig = await sendAndConfirmTransaction(
      solanaProvider.connection,
      tx,
      [solanaPayer]
    );

    console.log(`Transaction link: ${solanatTxLink(txSig)}`);
    console.log("Redeemed transfer with payload");
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

  it("receive message SVM -> EVM", async () => {
    const wh = await wormhole(ENV, [solana, evm]);
    const sepoliaChain = wh.getChain(SEPOLIA);
    const solanaChain = wh.getChain(SOLANA);

    const pathToDeployment = `../../evm/broadcast/WhMessenger.s.sol/${evmNetwork.chainId}/run-latest.json`;
    const deploymentTx = (await import(pathToDeployment)).transactions[0];

    console.log("Sending message...");

    let tx_evm: ethers.ContractTransactionResponse;
    if (
      !process.env.USE_EXISTING_TX ||
      process.env.USE_EXISTING_TX === "false"
    ) {
      const whEVMMessenger = new Contract(
        deploymentTx.contractAddress,
        whEVMMessengerAbi.abi,
        evmPayer
      );

      const message = "Hello world: " + randomBytes(6).toString();

      tx_evm = (await whEVMMessenger.sendMessage(
        message
      )) as ethers.ContractTransactionResponse;

      await tx_evm.wait();

      console.log(`Transaction link: ${evmTxLink(tx_evm.hash)}`);
      console.log("Message sent");
    } else if (process.env.TX_HASH) {
      console.log("Skipping message sending");
      console.log("Using existing tx: ", process.env.TX_HASH);
    } else {
      console.error(
        "Please set SEND_MESSAGE=true or provide a TX_HASH in your .env file"
      );
    }

    const [whm] = await sepoliaChain.parseTransaction(
      tx_evm && tx_evm.hash ? tx_evm.hash : process.env.TX_HASH
    );

    const vaa = await wh.getVaa(whm!, "Uint8Array", 100_000);

    if (!vaa) {
      console.info(
        "\nVaa is not yet available. Please wait around 15-20 minutes for message to be processed."
      );
      console.info(
        "\nUse the provided tx in your .env file to process the existing tx: ",
        tx_evm.hash
      );

      return;
    }

    let configPda = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      whSolanaMessenger.programId
    );

    let foreignEmitterPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("foreign_emitter"),
        (() => {
          const buf = Buffer.alloc(2);
          buf.writeUInt16LE(chainToChainId(vaa.emitterChain));
          return buf;
        })(),
      ],
      whSolanaMessenger.programId
    );

    console.log("Registering emitter...");

    let foreignEmitterAddress: string | null;

    try {
      let _address: number[];
      ({ address: _address } =
        await whSolanaMessenger.account.foreignEmitter.fetch(
          foreignEmitterPda[0]
        ));

      foreignEmitterAddress =
        "0x" +
        Array.from(_address)
          .map((byte) => byte.toString(16).padStart(2, "0")) // Convert each byte to a 2-character hex string
          .join("");
    } catch {}

    if (
      foreignEmitterAddress === null ||
      foreignEmitterAddress !== vaa.emitterAddress.toString()
    ) {
      const registerEmitterTx = await whSolanaMessenger.methods
        .registerEmitter(chainToChainId(vaa.emitterChain), [
          ...vaa.emitterAddress.toUint8Array(),
        ])
        .accounts({
          foreignEmitter: foreignEmitterPda[0],
        })
        .transaction();

      const registerEmitterSig = await sendAndConfirmTransaction(
        solanaProvider.connection,
        registerEmitterTx,
        [solanaPayer]
      );

      console.log(`Transaction link: ${solanatTxLink(registerEmitterSig)}`);
      console.log("Emitter registered");
    } else {
      console.log("Emitter already registered");
    }

    console.log("Receiving message...");

    let receivedPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("received"),
        (() => {
          const buf = Buffer.alloc(10);
          buf.writeUInt16LE(chainToChainId(vaa.emitterChain), 0);
          buf.writeBigInt64LE(vaa.sequence, 2);
          return buf;
        })(),
      ],
      whSolanaMessenger.programId
    );

    const { signer, address } = await getSigner(wh.getChain(SOLANA));

    const verifyTxs = (await solanaChain.getWormholeCore()).verifyMessage(
      address.address,
      vaa
    );

    await signSendWait(wh.getChain(SOLANA), verifyTxs, signer);

    let message: string;
    try {
      let _message: Buffer<ArrayBufferLike>;

      ({ message: _message } = await whSolanaMessenger.account.received.fetch(
        receivedPda[0]
      ));

      message = _message.toString();
    } catch {}

    if (!message) {
      const tx_sol = await whSolanaMessenger.methods
        .receiveMessage([...vaa.hash])
        .accounts({
          payer: solanaPayer.publicKey,
          // @ts-ignore
          config: configPda,
          wormholeProgram: wormholeCoreAddress,
          posted: utils.derivePostedVaaKey(
            wormholeCoreAddress,
            Buffer.from(vaa.hash)
          ),
          foreignEmitter: foreignEmitterPda[0],
          received: receivedPda[0],
        })
        .transaction();

      const txSig = await sendAndConfirmTransaction(
        solanaProvider.connection,
        tx_sol,
        [solanaPayer]
      );

      console.log(`Transaction link: ${solanatTxLink(txSig)}`);
      console.log("Message received");
    } else {
      console.log("Message was already received");
      console.log("Message: ", message.toString());
    }
  });

  it("attest token SVM -> EVM", async () => {
    let txid = undefined;
    txid = "0x7687627185ed40ee691bccff9c683561e00017103a253f8d922d7249a08fbad1";

    const sepoliaChain = wh.getChain(SEPOLIA);
    const { signer: origSigner } = await getSigner(sepoliaChain);

    const tokenAddress: NativeAddress<"Sepolia"> = toNative(
      "Sepolia",
      "0x063F2c247B881AD9822bDa80Dc15A48035be09cd"
    );

    if (!txid) {
      const tb = await sepoliaChain.getTokenBridge();
      const attestTxns = tb.createAttestation(
        tokenAddress,
        Wormhole.parseAddress(origSigner.chain(), origSigner.address())
      );

      const txids = await signSendWait(sepoliaChain, attestTxns, origSigner);

      console.log("txids: ", inspect(txids, { depth: null }));

      txid = txids[0]!.txid;

      console.log("Created attestation (save this): ", txid);
    }

    const msgs = await sepoliaChain.parseTransaction(txid);
    //console.log(msgs);

    const timeout = 60_000; // 60 seconds
    const vaa = await wh.getVaa(msgs[0]!, "TokenBridge:AttestMeta", timeout);
    if (!vaa)
      throw new Error(
        "VAA not found after retries exhausted, try extending the timeout"
      );

    //console.log(vaa.payload.token.address);

    // Check if its attested and if not
    // submit the attestation to the token bridge on the
    // destination chain
    const chain = "Solana";
    const destChain = wh.getChain(chain);
    const { signer } = await getSigner(destChain);

    // grab a ref to the token bridge
    const tb = await destChain.getTokenBridge();
    try {
      // try to get the wrapped version, an error here likely means
      // its not been attested
      const wrapped = await tb.getWrappedAsset({
        chain: "Sepolia",
        address: tokenAddress,
      });
      console.log("Already wrapped");
      console.log({ chain, address: wrapped });
      return;
    } catch (e) {}

    console.log("Attesting asset");
    try {
      await signSendWait(
        destChain,
        tb.submitAttestation(
          vaa,
          Wormhole.parseAddress(signer.chain(), signer.address())
        ),
        signer
      );
    } catch (e) {
      console.error("Error submitting attestation: ", e);
      throw e;
    }
  });
});
