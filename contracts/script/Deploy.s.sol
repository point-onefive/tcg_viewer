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
///   OWNER         operator / upgrade authority (EOA in v1, Safe later)
///   PLATFORM      rake recipient
///   USDC          settlement token address for the target chain
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

        vm.startBroadcast(pk);

        TournamentEscrow impl = new TournamentEscrow();
        bytes memory initData = abi.encodeCall(TournamentEscrow.initialize, (owner, usdc, platform));
        ERC1967Proxy proxyContract = new ERC1967Proxy(address(impl), initData);

        vm.stopBroadcast();

        proxy = address(proxyContract);
        implementation = address(impl);

        console2.log("TournamentEscrow implementation:", implementation);
        console2.log("TournamentEscrow proxy:", proxy);
        console2.log("owner:", owner);
        console2.log("platform:", platform);
        console2.log("usdc:", usdc);
    }
}
