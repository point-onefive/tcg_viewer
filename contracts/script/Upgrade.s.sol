// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";

/// @notice Ships an enhancement / bug fix to an already-deployed proxy.
///
/// Workflow for any future change:
///   1. Edit src/TournamentEscrow.sol (only append storage vars; shrink __gap
///      to keep the layout compatible - never reorder or remove existing vars).
///   2. `make test` (all green).
///   3. `PROXY=0x... make upgrade-sepolia` (or upgrade-base).
///
/// The broadcaster (PRIVATE_KEY) MUST be the proxy owner (operator / upgrade
/// authority). This deploys the new implementation bytecode and points the
/// existing proxy at it via UUPS `upgradeToAndCall`, preserving all state and
/// the proxy address the app talks to.
///
/// Required env vars:
///   PRIVATE_KEY   owner key (upgrade authority)
///   PROXY         the deployed TournamentEscrow proxy address
contract Upgrade is Script {
    function run() external returns (address newImplementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");

        vm.startBroadcast(pk);

        TournamentEscrow newImpl = new TournamentEscrow();
        // No reinitializer call for a plain logic upgrade; pass data only when a
        // new version adds a `reinitializer`-guarded migration function.
        TournamentEscrow(proxy).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        newImplementation = address(newImpl);
        console2.log("proxy:", proxy);
        console2.log("new implementation:", newImplementation);
    }
}
