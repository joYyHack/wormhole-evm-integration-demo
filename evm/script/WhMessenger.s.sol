// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {IWormhole} from "wormhole/interfaces/IWormhole.sol";
import {WhMessenger} from "src/Wh.sol";

contract WhMessengerScript is Script {
    IWormhole wormhole;
    WhMessenger whMessenger;

    function setUp() public {
        wormhole = IWormhole(vm.envAddress("WORMHOLE_ADDRESS"));
        vm.createSelectFork(
            StdChains.getChain(vm.envString("CHAIN_NAME")).rpcUrl
        );
    }

    function deployWhMessenger() public {
        // deploy the WhMessenger contract
        whMessenger = new WhMessenger(
            address(wormhole),
            wormhole.chainId(),
            1 // wormholeFinality
        );
    }

    function run() public {
        // begin sending transactions
        vm.startBroadcast(vm.envUint("EVM_PRIVATE_KEY"));

        // Wh.sol
        deployWhMessenger();

        // finished
        vm.stopBroadcast();
    }
}
