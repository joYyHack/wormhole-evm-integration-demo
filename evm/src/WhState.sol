// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "wormhole/interfaces/IWormhole.sol";

contract WhStorage {
    struct State {
        address owner;
        address wormhole;
        uint16 chainId;
        uint8 wormholeFinality;
        mapping(uint16 => bytes32) registeredEmitters;
        mapping(bytes32 => string) receivedMessages;
        mapping(bytes32 => bool) consumedMessages;
    }
}

contract WhState {
    WhStorage.State _state;
}
