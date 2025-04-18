// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract WhStructs {
    struct Message {
        // unique identifier for this message type
        uint8 payloadID;
        // arbitrary message string
        string message;
    }
}
