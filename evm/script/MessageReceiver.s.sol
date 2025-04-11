// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Script, console} from "forge-std/Script.sol";
import {MessageReceiver} from "../src/MessageReceiver.sol";

contract MessageReceiverScript is Script {
    MessageReceiver public messageReceiver;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        messageReceiver = new MessageReceiver();
        console.log(
            "MessageReceiver deployed to: %s",
            address(messageReceiver)
        );

        vm.stopBroadcast();
    }
}
