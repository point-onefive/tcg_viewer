// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";

/// @notice Deploys the TournamentEscrow implementation behind a UUPS
///         (ERC1967) proxy and initializes it.
///
/// Required env vars:
///   PRIVATE_KEY   deployer key (broadcasts the txs)
///   OWNER         upgrade / pause authority (a Safe multisig in production)
///   PLATFORM      rake recipient (where the 15% goes)
///   USDC          settlement token address for the target chain
///
/// Optional env vars:
///   OPERATOR      hot automation key the backend uses for create/lock/settle.
///                 Defaults to OWNER when unset (autopilot then needs the owner
///                 key; set this to the backend signer to keep the owner cold).
///
/// Canonical native USDC addresses:
///   Base mainnet  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///   Base Sepolia  0x036CbD53842c5426634e7929541eC2318f3dCF7e
///
/// Example (Base Sepolia):
///   forge script script/Deploy.s.sol \
///     --rpc-url base_sepolia --broadcast --verify -vvvv
contract Deploy is Script {
    function run() external returns (address proxy, address implementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("OWNER");
        address platform = vm.envAddress("PLATFORM");
        address usdc = vm.envAddress("USDC");

        // Optional dedicated automation key; falls back to owner.
        address operator = vm.envOr("OPERATOR", owner);
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        TournamentEscrow impl = new TournamentEscrow();
        bytes memory initData = abi.encodeCall(TournamentEscrow.initialize, (owner, usdc, platform));
        ERC1967Proxy proxyContract = new ERC1967Proxy(address(impl), initData);
        TournamentEscrow escrow = TournamentEscrow(address(proxyContract));

        // Point autopilot at the backend key when it differs from the owner. Only
        // possible here if the deployer IS the owner (setOperator is owner-gated);
        // when the owner is a separate Safe, it must call setOperator afterwards.
        bool operatorSet = false;
        if (operator != owner && deployer == owner) {
            escrow.setOperator(operator);
            operatorSet = true;
        }

        vm.stopBroadcast();

        if (operator != owner && !operatorSet) {
            console2.log("NOTE: owner must call setOperator(operator) manually:", operator);
        }

        proxy = address(proxyContract);
        implementation = address(impl);

        console2.log("TournamentEscrow implementation:", implementation);
        console2.log("TournamentEscrow proxy:", proxy);
        console2.log("owner:", owner);
        console2.log("operator:", operator);
        console2.log("platform:", platform);
        console2.log("usdc:", usdc);
    }
}
