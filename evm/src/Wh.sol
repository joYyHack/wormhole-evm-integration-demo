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

    constructor(address wormhole_, uint16 chainId_, uint8 wormholeFinality_) {
        require(wormhole_ != address(0), "invalid Wormhole address");
        require(chainId_ > 0, "invalid chainId");
        require(wormholeFinality_ > 0, "invalid wormholeFinality");

        setOwner(msg.sender);
        setWormhole(wormhole_);
        setChainId(chainId_);
        setWormholeFinality(wormholeFinality_);
    }

    /**
     * @notice Creates an arbitrary message to be attested by the Wormhole guardians.
     * @dev batchID is set to 0 to opt out of batching in future Wormhole versions.
     * @param message Arbitrary string
     * @return messageSequence Wormhole message sequence for this contract
     */
    function sendMessage(
        string memory message
    ) public payable returns (uint64 messageSequence) {
        require(
            abi.encodePacked(message).length < type(uint16).max,
            "message too large"
        );

        IWormhole wormhole = wormhole();
        uint256 wormholeFee = wormhole.messageFee();

        require(msg.value == wormholeFee, "insufficient value");

        Message memory parsedMessage = Message({
            payloadID: uint8(1),
            message: message
        });

        bytes memory encodedMessage = encodeMessage(parsedMessage);

        messageSequence = wormhole.publishMessage{value: wormholeFee}(
            0,
            encodedMessage,
            wormholeFinality()
        );
    }

    /**
     * @notice Consumes arbitrary messages sent by registered emitters
     * @dev The arbitrary message is verified by the Wormhole core endpoint `verifyVM`.
     * @param encodedMessage verified Wormhole message containing arbitrary message.
     */
    function receiveMessage(bytes memory encodedMessage) public {
        (
            IWormhole.VM memory wormholeMessage,
            bool valid,
            string memory reason
        ) = wormhole().parseAndVerifyVM(encodedMessage);

        require(valid, reason);
        require(verifyEmitter(wormholeMessage), "unknown emitter");

        Message memory parsedMessage = decodeMessage(wormholeMessage.payload);

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
     * @notice Registers foreign emitters with this contracts
     * @param emitterChainId Wormhole chainId of the contract being registered
     * See https://book.wormhole.com/reference/contracts.html for more information.
     * @param emitterAddress 32-byte address of the contract being registered. For EVM
     * contracts the first 12 bytes should be zeros.
     */
    function registerEmitter(
        uint16 emitterChainId,
        bytes32 emitterAddress
    ) public onlyOwner {
        require(
            emitterChainId != 0 && emitterChainId != chainId(),
            "emitterChainId cannot equal 0 or this chainId"
        );
        require(
            emitterAddress != bytes32(0),
            "emitterAddress cannot equal bytes32(0)"
        );

        setEmitter(emitterChainId, emitterAddress);
    }

    function verifyEmitter(
        IWormhole.VM memory vm
    ) internal view returns (bool) {
        return getRegisteredEmitter(vm.emitterChainId) == vm.emitterAddress;
    }
}
