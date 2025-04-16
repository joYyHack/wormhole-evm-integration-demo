import { Contract, ethers, Wallet } from "ethers";
import sepoliaAbi from "./sepoliaAbi.json";
import {
  chain,
  chainToChainId,
  encoding,
  signSendWait,
  wormhole,
  Relayer,
  WormholeRegistry,
  Chain,
  Network,
  TokenId,
  TokenTransfer,
  Wormhole,
  amount,
  isTokenId,
  ChainContext,
  NativeAddress,
  QuoteWarning,
  TokenTransferDetails,
  TransferQuote,
  UniversalAddress,
  finality,
  guardians,
  isNative,
  isSameToken,
  serialize,
} from "@wormhole-foundation/sdk";
import { getSigner, SignerStuff, waitLog } from "./helpers/index";
import solana from "@wormhole-foundation/sdk/solana";
import evm from "@wormhole-foundation/sdk/evm";
import {
  AnchorProvider,
  getProvider,
  Program,
  setProvider,
  workspace,
} from "@coral-xyz/anchor";

import {
  clusterApiUrl,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { coreBridge, relayer } from "@wormhole-foundation/sdk-base/contracts";
import { utils } from "@wormhole-foundation/sdk-solana-core";
import { HelloWorld } from "../target/types/hello_world";
import {
  mocks,
  utils as testUtils,
} from "@wormhole-foundation/sdk-definitions/testing";
import instruction from "@coral-xyz/anchor/dist/cjs/program/namespace/instruction";

describe("send message", () => {
  it.skip("initialize", async () => {
    setProvider(AnchorProvider.env());
    const program = workspace.HelloWorld as Program<HelloWorld>;
    const wormholeCore = coreBridge("Testnet", "Solana");

    const guardiands = Buffer.from(
      mocks.devnetGuardianSet().getPublicKeys()[0]
    );
    const buffer = Buffer.from([
      0xbe, 0xfa, 0x42, 0x9d, 0x57, 0xcd, 0x18, 0xb7, 0xf8, 0xa4, 0xd9, 0x1a,
      0x2d, 0xa9, 0xab, 0x4a, 0xf0, 0x5d, 0x0f, 0xbe,
    ]);
    const ix = utils.createInitializeInstruction(
      getProvider().connection,
      new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"),
      getProvider().publicKey,
      86400,
      BigInt(100),
      [buffer]
    );
    const transaction = new Transaction().add(ix);
    // await sendAndConfirmTransaction(getProvider().connection, transaction, [
    //   getProvider().wallet.payer,
    // ]);

    let configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    let wormholeMessagePda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("sent"),
        (() => {
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64LE(BigInt(1));
          return buf;
        })(),
      ], // Initial sequence
      program.programId
    );

    const wormholeAccounts = utils.getPostMessageAccounts(
      wormholeCore,
      getProvider().publicKey,
      wormholeMessagePda,
      program.programId
    );

    console.log(program.programId);
    await program.methods
      .initialize()
      .accounts({
        owner: getProvider().publicKey,
        config: configPDA,
        wormholeProgram: wormholeCore,
        wormholeBridge: wormholeAccounts.bridge,
        wormholeFeeCollector: wormholeAccounts.feeCollector,
        wormholeEmitter: wormholeAccounts.emitter,
        wormholeSequence: wormholeAccounts.sequence,
        wormholeMessage: new PublicKey(
          "3R7ccY97BuHXy3piYZiRKc32cEk5XwHubYKatismas61"
        ),
        clock: wormholeAccounts.clock,
        rent: wormholeAccounts.rent,
        systemProgram: wormholeAccounts.systemProgram,
      })
      .rpc()
      .catch((e) => {
        console.log("error", e);
        console.log("failed");
        return;
      });

    console.log("finish");
  });

  it("send message", async () => {
    setProvider(AnchorProvider.env());
    const provider = getProvider();
    const program = workspace.HelloWorld as Program<HelloWorld>;
    const wormholeCore = coreBridge("Testnet", "Solana");

    const helloMessage = Buffer.from("Jesjo raz proverjajem");

    // save message count to grab posted message later
    let { sequence } = await utils.getProgramSequenceTracker(
      provider.connection,
      program.programId,
      wormholeCore
    );

    sequence += BigInt(1);

    let configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    let wormholeMessagePda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("sent"),
        (() => {
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64LE(sequence + BigInt(1));
          return buf;
        })(),
      ], // Initial sequence
      program.programId
    );

    const wormholeAccounts = utils.getPostMessageAccounts(
      wormholeCore,
      getProvider().publicKey,
      wormholeMessagePda,
      program.programId
    );

    const tx = await program.methods
      .sendMessage(helloMessage)
      .accounts({
        config: configPDA,
        wormholeProgram: wormholeCore,
        wormholeBridge: wormholeAccounts.bridge,
        wormholeFeeCollector: wormholeAccounts.feeCollector,
        wormholeEmitter: wormholeAccounts.emitter,
        wormholeSequence: wormholeAccounts.sequence,
        wormholeMessage: new PublicKey(
          "DnfFSwRjKeDfYK1QEkdXFZ7oiLXnFaKbWF7MjJ7DsQ4G"
        ),
        clock: wormholeAccounts.clock,
        rent: wormholeAccounts.rent,
        systemProgram: wormholeAccounts.systemProgram,
      })
      .transaction();

    const txSig = await sendAndConfirmTransaction(
      getProvider().connection,
      tx,
      [getProvider().wallet.payer]
    );

    const wh = await wormhole("Testnet", [solana, evm]);
    const solanaChain = wh.getChain("Solana");

    const [whm] = await solanaChain.parseTransaction(txSig);
    const vaa = await wh.getVaa(whm!, "Uint8Array", 60_000);

    const sepoliaProvider = new ethers.JsonRpcProvider(
      "https://eth-sepolia.g.alchemy.com/v2/viP0wxx3syICCZxrwVzfljeMGlV-ObPV"
    );

    const owner = new Wallet(
      "5d8b20a58920c413041e786ff29a2ddeb16040380eb567f4c637195e689d8377",
      sepoliaProvider
    );

    // Create a contract
    const receiver = new Contract(
      "0x879b6588a168b15bb32f166337b2d7f71d238475",
      sepoliaAbi.abi,
      owner
    );

    // const tx1Sep = await receiver.registerEmitter(
    //   chainToChainId("Solana"),
    //   new UniversalAddress(wormholeCore, "base58").toString()
    // );

    // const tx1Receipt = await tx1Sep.wait();

    const tx2Sep = await receiver.receiveMessage(serialize(vaa));
    await tx2Sep.wait();
  });
});

describe.skip("svm-evm-demo", () => {
  // Configure the client to use the local cluster.
  it("Is initialized!", async () => {
    const wh = await wormhole("Mainnet", [solana, evm]);
    const sepoliaChain = wh.getChain("Ethereum");
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

describe.skip("token-bridge", () => {
  it("test", async () => {
    const wh = await wormhole("Mainnet", [evm, solana]);

    // Grab chain Contexts -- these hold a reference to a cached rpc client
    const sendChain = wh.getChain("Solana");
    const rcvChain = wh.getChain("Ethereum");

    // Shortcut to allow transferring native gas token
    const token = Wormhole.tokenId(sendChain.chain, "native");

    // A TokenId is just a `{chain, address}` pair and an alias for ChainAddress
    // The `address` field must be a parsed address.
    // You can get a TokenId (or ChainAddress) prepared for you
    // by calling the static `chainAddress` method on the Wormhole class.
    // e.g.
    // wAvax on Solana
    // const token = Wormhole.tokenId("Solana", "3Ftc5hTz9sG4huk79onufGiebJNDMZNL8HYgdMJ9E7JR");
    // wSol on Avax
    // const token = Wormhole.tokenId("Avalanche", "0xb10563644a6AB8948ee6d7f5b0a1fb15AaEa1E03");

    // Normalized given token decimals later but can just pass bigints as base units
    // Note: The Token bridge will dedust past 8 decimals
    // this means any amount specified past that point will be returned
    // to the caller
    const amt = "0.123";

    // With automatic set to true, perform an automatic transfer. This will invoke a relayer
    // contract intermediary that knows to pick up the transfers
    // With automatic set to false, perform a manual transfer from source to destination
    // of the token
    // On the destination side, a wrapped version of the token will be minted
    // to the address specified in the transfer VAA
    const automatic = false;

    // The automatic relayer has the ability to deliver some native gas funds to the destination account
    // The amount specified for native gas will be swapped for the native gas token according
    // to the swap rate provided by the contract, denominated in native gas tokens
    const nativeGas = automatic ? "0.01" : undefined;

    // Get signer from local key but anything that implements
    // Signer interface (e.g. wrapper around web wallet) should work
    const source = await getSigner(sendChain);
    const destination = await getSigner(rcvChain);

    // Used to normalize the amount to account for the tokens decimals
    const decimals = isTokenId(token)
      ? Number(await wh.getDecimals(token.chain, token.address))
      : sendChain.config.nativeTokenDecimals;

    // Set this to true if you want to perform a round trip transfer
    const roundTrip: boolean = false;

    // Set this to the transfer txid of the initiating transaction to recover a token transfer
    // and attempt to fetch details about its progress.
    let recoverTxid = undefined;
    // recoverTxid = "0xa4e0a2c1c994fe3298b5646dfd5ce92596dc1a589f42e241b7f07501a5a5a39f";

    // Finally create and perform the transfer given the parameters set above
    // const xfer = !recoverTxid
    //   ? // Perform the token transfer
    //     await tokenTransfer(
    //       wh,
    //       {
    //         token,
    //         amount: amount.units(amount.parse(amt, decimals)),
    //         source,
    //         destination,
    //         delivery: {
    //           automatic,
    //           nativeGas: nativeGas
    //             ? amount.units(amount.parse(nativeGas, decimals))
    //             : undefined,
    //         },
    //       },
    //       roundTrip
    //     )
    //   : // Recover the transfer from the originating txid
    //     await TokenTransfer.from(wh, {
    //       chain: source.chain.chain,
    //       txid: recoverTxid,
    //     });

    const xfer = await tokenTransfer(
      wh,
      {
        token,
        amount: amount.units(amount.parse(amt, decimals)),
        source,
        destination,
        delivery: {
          automatic,
          nativeGas: nativeGas
            ? amount.units(amount.parse(nativeGas, decimals))
            : undefined,
        },
      },
      roundTrip
    );

    const receipt = await waitLog(wh, xfer);

    // Log out the results
    console.log(receipt);
  });
});

async function tokenTransfer<N extends Network>(
  wh: Wormhole<N>,
  route: {
    token: TokenId;
    amount: bigint;
    source: SignerStuff<N, Chain>;
    destination: SignerStuff<N, Chain>;
    delivery?: {
      automatic: boolean;
      nativeGas?: bigint;
    };
    payload?: Uint8Array;
  },
  roundTrip?: boolean
): Promise<TokenTransfer<N>> {
  // EXAMPLE_TOKEN_TRANSFER
  // Create a TokenTransfer object to track the state of the transfer over time
  const xfer = await wh.tokenTransfer(
    route.token,
    route.amount,
    route.source.address,
    route.destination.address,
    route.delivery?.automatic ?? false,
    route.payload,
    route.delivery?.nativeGas
  );

  const quote = await TokenTransfer.quoteTransfer(
    wh,
    route.source.chain,
    route.destination.chain,
    xfer.transfer
  );

  //const x = await route.source.chain.getAutomaticTokenBridge();
  try {
    const y = await route.destination.chain.getAutomaticTokenBridge();
    const x = await route.source.chain.getAutomaticTokenBridge();
    console.log();
  } catch (e) {
    console.log("Error getting automatic token bridge", e.message);
  }

  //console.log(quote);

  if (xfer.transfer.automatic && quote.destinationToken.amount < 0)
    throw "The amount requested is too low to cover the fee and any native gas requested.";

  // 1) Submit the transactions to the source chain, passing a signer to sign any txns
  console.log("Starting transfer");
  const srcTxids = await xfer.initiateTransfer(route.source.signer);
  console.log(`Started transfer: `, srcTxids);

  // If automatic, we're done
  if (route.delivery?.automatic) return xfer;

  // 2) Wait for the VAA to be signed and ready (not required for auto transfer)
  console.log("Getting Attestation");
  const attestIds = await xfer.fetchAttestation(60_000);
  console.log(`Got Attestation: `, attestIds);

  // 3) Redeem the VAA on the dest chain
  console.log("Completing Transfer");
  const destTxids = await xfer.completeTransfer(route.destination.signer);
  console.log(`Completed Transfer: `, destTxids);
  // EXAMPLE_TOKEN_TRANSFER

  // If no need to send back, dip
  if (!roundTrip) return xfer;

  const { destinationToken: token } = quote;
  return await tokenTransfer(wh, {
    ...route,
    token: token.token,
    amount: token.amount,
    source: route.destination,
    destination: route.source,
  });
}

// export async function quoteTransfer<N extends Network>(
//   wh: Wormhole<N>,
//   srcChain: ChainContext<N, Chain>,
//   dstChain: ChainContext<N, Chain>,
//   transfer: Omit<TokenTransferDetails, "from" | "to">
// ): Promise<TransferQuote> {
//   const srcTb = await srcChain.getTokenBridge();
//   let srcToken: NativeAddress<Chain>;
//   if (isNative(transfer.token.address)) {
//     srcToken = await srcTb.getWrappedNative();
//   } else if (UniversalAddress.instanceof(transfer.token.address)) {
//     try {
//       srcToken = (await srcTb.getWrappedAsset(
//         transfer.token
//       )) as NativeAddress<Chain>;
//     } catch (e: any) {
//       if (!e.message.includes("not a wrapped asset")) throw e;
//       srcToken = await srcTb.getTokenNativeAddress(
//         srcChain.chain,
//         transfer.token.address
//       );
//     }
//   } else {
//     srcToken = transfer.token.address;
//   }
//   // @ts-ignore: TS2339
//   const srcTokenId = Wormhole.tokenId(srcChain.chain, srcToken.toString());

//   const srcDecimals = await srcChain.getDecimals(srcToken);
//   const srcAmount = amount.fromBaseUnits(transfer.amount, srcDecimals);
//   const srcAmountTruncated = amount.truncate(
//     srcAmount,
//     TokenTransfer.MAX_DECIMALS
//   );

//   // Ensure the transfer would not violate governor transfer limits
//   const [tokens, limits] = await Promise.all([
//     getGovernedTokens(wh.config.api),
//     getGovernorLimits(wh.config.api),
//   ]);

//   const warnings: QuoteWarning[] = [];
//   if (limits !== null && srcChain.chain in limits && tokens !== null) {
//     let origAsset: TokenId;
//     if (isNative(transfer.token.address)) {
//       origAsset = {
//         chain: srcChain.chain,
//         address: await srcTb.getTokenUniversalAddress(srcToken),
//       };
//     } else {
//       try {
//         origAsset = await srcTb.getOriginalAsset(transfer.token.address);
//       } catch (e: any) {
//         if (!e.message.includes("not a wrapped asset")) throw e;
//         origAsset = {
//           chain: srcChain.chain,
//           address: await srcTb.getTokenUniversalAddress(srcToken),
//         };
//       }
//     }

//     if (
//       origAsset.chain in tokens &&
//       origAsset.address.toString() in tokens[origAsset.chain]!
//     ) {
//       const limit = limits[srcChain.chain]!;
//       const tokenPrice =
//         tokens[origAsset.chain]![origAsset.address.toString()]!;
//       const notionalTransferAmt = tokenPrice * amount.whole(srcAmountTruncated);

//       if (limit.maxSize && notionalTransferAmt > limit.maxSize) {
//         warnings.push({
//           type: "GovernorLimitWarning",
//           reason: "ExceedsLargeTransferLimit",
//         });
//       }

//       if (notionalTransferAmt > limit.available) {
//         warnings.push({
//           type: "GovernorLimitWarning",
//           reason: "ExceedsRemainingNotional",
//         });
//       }
//     }
//   }

//   const dstToken = await TokenTransfer.lookupDestinationToken(
//     srcChain,
//     dstChain,
//     transfer.token
//   );
//   const dstDecimals = await dstChain.getDecimals(dstToken.address);
//   const dstAmountReceivable = amount.scale(srcAmountTruncated, dstDecimals);

//   const eta =
//     finality.estimateFinalityTime(srcChain.chain) +
//     guardians.guardianAttestationEta;
//   if (!transfer.automatic) {
//     return {
//       sourceToken: {
//         token: transfer.token,
//         amount: amount.units(srcAmountTruncated),
//       },
//       destinationToken: {
//         token: dstToken,
//         amount: amount.units(dstAmountReceivable),
//       },
//       warnings: warnings.length > 0 ? warnings : undefined,
//       eta,
//       expires: time.expiration(24, 0, 0), // manual transfer quote is good for 24 hours
//     };
//   }

//   // Otherwise automatic

//   // The fee is removed from the amount transferred
//   // quoted on the source chain
//   const stb = await srcChain.getAutomaticTokenBridge();
//   const fee = await stb.getRelayerFee(dstChain.chain, srcToken);
//   const feeAmountDest = amount.scale(
//     amount.truncate(
//       amount.fromBaseUnits(fee, srcDecimals),
//       TokenTransfer.MAX_DECIMALS
//     ),
//     dstDecimals
//   );

//   // nativeGas is in source chain decimals
//   const srcNativeGasAmountRequested = transfer.nativeGas ?? 0n;
//   // convert to destination chain decimals
//   const dstNativeGasAmountRequested = amount.units(
//     amount.scale(
//       amount.truncate(
//         amount.fromBaseUnits(srcNativeGasAmountRequested, srcDecimals),
//         TokenTransfer.MAX_DECIMALS
//       ),
//       dstDecimals
//     )
//   );

//   // TODO: consider moving these solana specific checks to its protocol implementation
//   const solanaMinBalanceForRentExemptAccount = 890880n;

//   let destinationNativeGas = 0n;
//   if (transfer.nativeGas) {
//     const dtb = await dstChain.getAutomaticTokenBridge();

//     // There is a limit applied to the amount of the source
//     // token that may be swapped for native gas on the destination
//     const [maxNativeAmountIn, _destinationNativeGas] = await Promise.all([
//       dtb.maxSwapAmount(dstToken.address),
//       // Get the actual amount we should receive
//       dtb.nativeTokenAmount(dstToken.address, dstNativeGasAmountRequested),
//     ]);

//     if (dstNativeGasAmountRequested > maxNativeAmountIn)
//       throw new Error(
//         `Native gas amount exceeds maximum swap amount: ${amount.fmt(
//           dstNativeGasAmountRequested,
//           dstDecimals
//         )}>${amount.fmt(maxNativeAmountIn, dstDecimals)}`
//       );

//     // when native gas is requested on solana, the amount must be at least the rent-exempt amount
//     // or the transaction could fail if the account does not have enough lamports
//     if (
//       dstChain.chain === "Solana" &&
//       _destinationNativeGas < solanaMinBalanceForRentExemptAccount
//     ) {
//       throw new Error(
//         `Native gas amount must be at least ${solanaMinBalanceForRentExemptAccount} lamports`
//       );
//     }

//     destinationNativeGas = _destinationNativeGas;
//   }

//   const destAmountLessFee =
//     amount.units(dstAmountReceivable) -
//     dstNativeGasAmountRequested -
//     amount.units(feeAmountDest);

//   // when sending wsol to solana, the amount must be at least the rent-exempt amount
//   // or the transaction could fail if the account does not have enough lamports
//   if (dstToken.chain === "Solana") {
//     const nativeWrappedTokenId = await dstChain.getNativeWrappedTokenId();
//     const isNativeSol =
//       isNative(dstToken.address) || isSameToken(dstToken, nativeWrappedTokenId);
//     if (
//       isNativeSol &&
//       destAmountLessFee < solanaMinBalanceForRentExemptAccount
//     ) {
//       throw new Error(
//         `Destination amount must be at least ${solanaMinBalanceForRentExemptAccount} lamports`
//       );
//     }
//   }

//   return {
//     sourceToken: {
//       token: transfer.token,
//       amount: amount.units(srcAmountTruncated),
//     },
//     destinationToken: { token: dstToken, amount: destAmountLessFee },
//     relayFee: { token: dstToken, amount: amount.units(feeAmountDest) },
//     destinationNativeGas,
//     warnings: warnings.length > 0 ? warnings : undefined,
//     eta,
//     expires: time.expiration(0, 5, 0), // automatic transfer quote is good for 5 minutes
//   };
// }
