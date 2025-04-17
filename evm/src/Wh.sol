// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "wormhole/interfaces/IWormhole.sol";
import "wormhole/libraries/BytesParsing.sol";

import "./WhGetters.sol";
import "./WhMessages.sol";

/**
 * @title A Cross-Chain Wormhole Application
 * @notice This contract uses Wormhole's generic-messaging to send/receive an arbitrary
 * message to/from registered emitters on foreign blockchains
 */
contract WhMessenger is WhGetters, WhMessages {
    using BytesParsing for bytes;

    event MessageReceived(
        bytes32 indexed hash,
        bytes32 indexed sender,
        string message
    );

    modifier onlyOwner() {
        require(owner() == msg.sender, "caller not the owner");
        _;
    }

    /**
     * @notice Deploys the smart contract and sanity checks initial deployment values
     * @dev Sets the owner, wormhole, chainId and wormholeFinality state variables.
     * See WhState.sol for descriptions of each state variable.
     */
    constructor(address wormhole_, uint16 chainId_, uint8 wormholeFinality_) {
        // sanity check input values
        require(wormhole_ != address(0), "invalid Wormhole address");
        require(chainId_ > 0, "invalid chainId");
        require(wormholeFinality_ > 0, "invalid wormholeFinality");

        // set constructor state values
        setOwner(msg.sender);
        setWormhole(wormhole_);
        setChainId(chainId_);
        setWormholeFinality(wormholeFinality_);
    }

    /**
     * @notice Creates an arbitrary message to be attested by the
     * Wormhole guardians.
     * @dev batchID is set to 0 to opt out of batching in future Wormhole versions.
     * Reverts if:
     * - caller doesn't pass enough value to pay the Wormhole network fee
     * - `message` length is >= max(uint16)
     * @param message Arbitrary string
     * @return messageSequence Wormhole message sequence for this contract
     */
    function sendMessage(
        string memory message
    ) public payable returns (uint64 messageSequence) {
        // enforce a max size for the arbitrary message
        require(
            abi.encodePacked(message).length < type(uint16).max,
            "message too large"
        );

        // cache Wormhole instance and fees to save on gas
        IWormhole wormhole = wormhole();
        uint256 wormholeFee = wormhole.messageFee();

        // Confirm that the caller has sent enough value to pay for the Wormhole
        // message fee.
        require(msg.value == wormholeFee, "insufficient value");

        // create the message struct
        Message memory parsedMessage = Message({
            payloadID: uint8(1),
            message: message
        });

        // encode the message struct into bytes
        bytes memory encodedMessage = encodeMessage(parsedMessage);

        // Send the message by calling publishMessage on the
        // Wormhole core contract and paying the Wormhole protocol fee.
        messageSequence = wormhole.publishMessage{value: wormholeFee}(
            0, // batchID
            encodedMessage,
            wormholeFinality()
        );
    }

    /**
     * @notice Consumes arbitrary messages sent by registered emitters
     * @dev The arbitrary message is verified by the Wormhole core endpoint
     * `verifyVM`.
     * Reverts if:
     * - `encodedMessage` is not attested by the Wormhole network
     * - `encodedMessage` was sent by an unregistered emitter
     * - `encodedMessage` was consumed already
     * @param encodedMessage verified Wormhole message containing arbitrary
     * message.
     */
    function receiveMessage(bytes memory encodedMessage) public {
        // call the Wormhole core contract to parse and verify the encodedMessage
        (
            IWormhole.VM memory wormholeMessage,
            bool valid,
            string memory reason
        ) = wormhole().parseAndVerifyVM(encodedMessage);

        // confirm that the Wormhole core contract verified the message
        require(valid, reason);

        // verify that this message was emitted by a registered emitter
        require(verifyEmitter(wormholeMessage), "unknown emitter");

        // decode the message payload into the WhMessage struct
        Message memory parsedMessage = decodeMessage(wormholeMessage.payload);

        /**
         * Check to see if this message has been consumed already. If not,
         * save the parsed message in the receivedMessages mapping.
         *
         * This check can protect against replay attacks in xDapps where messages are
         * only meant to be consumed once.
         */
        require(
            !isMessageConsumed(wormholeMessage.hash),
            "message already consumed"
        );

        consumeMessage(wormholeMessage.hash, parsedMessage.message);

        emit MessageReceived(
            wormholeMessage.hash,
            wormholeMessage.emitterAddress,
            parsedMessage.message
        );
    }

    /**
     * @notice Registers foreign emitters (HelloWorld contracts) with this contract
     * @dev Only the deployer (owner) can invoke this method
     * @param emitterChainId Wormhole chainId of the contract being registered
     * See https://book.wormhole.com/reference/contracts.html for more information.
     * @param emitterAddress 32-byte address of the contract being registered. For EVM
     * contracts the first 12 bytes should be zeros.
     */
    function registerEmitter(
        uint16 emitterChainId,
        bytes32 emitterAddress
    ) public onlyOwner {
        // sanity check the emitterChainId and emitterAddress input values
        require(
            emitterChainId != 0 && emitterChainId != chainId(),
            "emitterChainId cannot equal 0 or this chainId"
        );
        require(
            emitterAddress != bytes32(0),
            "emitterAddress cannot equal bytes32(0)"
        );

        // update the registeredEmitters state variable
        setEmitter(emitterChainId, emitterAddress);
    }

    function verifyEmitter(
        IWormhole.VM memory vm
    ) internal view returns (bool) {
        // Verify that the sender of the Wormhole message is a trusted contract.
        return getRegisteredEmitter(vm.emitterChainId) == vm.emitterAddress;
    }
}
