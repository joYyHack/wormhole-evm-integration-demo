// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "wormhole/libraries/BytesParsing.sol";

import "./WhStructs.sol";

contract WhMessages is WhStructs {
    using BytesParsing for bytes;

    /**
     * @notice Encodes the Message struct into bytes
     * @param parsedMessage Message struct with arbitrary message
     * @return encodedMessage Message encoded into bytes
     */
    function encodeMessage(
        Message memory parsedMessage
    ) public pure returns (bytes memory encodedMessage) {
        bytes memory encodedMessagePayload = abi.encodePacked(
            parsedMessage.message
        );

        encodedMessage = abi.encodePacked(
            parsedMessage.payloadID,
            uint16(encodedMessagePayload.length),
            encodedMessagePayload
        );
    }

    /**
     * @notice Decodes bytes into Message struct
     * @dev Verifies the payloadID
     * @param encodedMessage encoded arbitrary message
     * @return parsedMessage Message struct with arbitrary message
     */
    function decodeMessage(
        bytes memory encodedMessage
    ) public pure returns (Message memory parsedMessage) {
        uint256 index = 0;

        (parsedMessage.payloadID, ) = encodedMessage.asUint8(index);
        require(parsedMessage.payloadID == 1, "invalid payloadID");
        index += 1;

        (uint256 messageLength, ) = encodedMessage.asUint16(index);
        index += 2;

        (bytes memory messageBytes, ) = encodedMessage.slice(
            index,
            messageLength
        );

        parsedMessage.message = string(messageBytes);
        index += messageLength;

        require(index == encodedMessage.length, "invalid message length");
    }
}
