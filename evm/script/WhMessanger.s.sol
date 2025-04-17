// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {IWormhole} from "wormhole/interfaces/IWormhole.sol";
import {WhMessanger} from "src/Wh.sol";

contract WhMessangerScript is Script {
    IWormhole wormhole;
    WhMessanger whMessanger;

    function setUp() public {
        wormhole = IWormhole(0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78);
    }

    function deployWhMessanger() public {
        // deploy the WhMessanger contract
        whMessanger = new WhMessanger(
            address(wormhole),
            wormhole.chainId(),
            1 // wormholeFinality
        );
    }

    function run() public {
        // begin sending transactions
        vm.startBroadcast();

        // Wh.sol
        deployWhMessanger();

        // finished
        vm.stopBroadcast();
    }
}
