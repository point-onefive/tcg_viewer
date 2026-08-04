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
///
/// Optional env vars:
///   APPROVER      dedicated winner-approval key address. When set, the owner
///                 also calls setApprover(APPROVER) in the same broadcast so
///                 the pre-mainnet mitigation (winner allowlist gated to a key
///                 SEPARATE from the operator) takes effect immediately. Leave
///                 unset to keep `approver == address(0)` (falls back to owner
///                 as the effective approver). NOTE: for the mitigation to hold,
///                 APPROVER MUST be a different key than the backend operator.
contract Upgrade is Script {
    function run() external returns (address newImplementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");
        // address(0) sentinel = not provided; skip setApprover.
        address approver = vm.envOr("APPROVER", address(0));

        vm.startBroadcast(pk);

        TournamentEscrow newImpl = new TournamentEscrow();
        // No reinitializer call for a plain logic upgrade; pass data only when a
        // new version adds a `reinitializer`-guarded migration function. The
        // appended storage (approver + approvedWinner) needs no migration: the
        // new slots default to zero, and a zero `approver` falls back to owner.
        TournamentEscrow(proxy).upgradeToAndCall(address(newImpl), "");

        if (approver != address(0)) {
            TournamentEscrow(proxy).setApprover(approver);
            console2.log("approver set to:", approver);
        } else {
            console2.log("APPROVER unset; effective approver falls back to owner()");
        }

        vm.stopBroadcast();

        newImplementation = address(newImpl);
        console2.log("proxy:", proxy);
        console2.log("new implementation:", newImplementation);
    }
}
