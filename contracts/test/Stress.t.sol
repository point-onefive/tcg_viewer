// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Stress / conservation-of-funds tests: many games running at once,
///         with the SAME players entered in several of them, driven by the
///         least-privilege operator key exactly like the backend autopilot.
///
/// The master invariant that must ALWAYS hold: the contract's real USDC balance
/// equals what it believes it owes (`usdcObligations`). If that ever drifts,
/// money was created or destroyed. We assert it after every phase, and prove the
/// system fully drains to zero once everyone has claimed / withdrawn - i.e. total
/// USDC out == total USDC in, no dust stuck, nothing lost.
contract StressTest is Test {
    TournamentEscrow escrow;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address platform = makeAddr("platform");
    address operator = makeAddr("operator");

    uint256 constant NUM_PLAYERS = 40;
    address[NUM_PLAYERS] players;

    uint256 constant FEE = 10_000_000; // $10

    function setUp() public {
        usdc = new MockUSDC();
        TournamentEscrow impl = new TournamentEscrow();
        bytes memory initData =
            abi.encodeCall(TournamentEscrow.initialize, (owner, address(usdc), platform));
        escrow = TournamentEscrow(address(new ERC1967Proxy(address(impl), initData)));

        // Hand autopilot to the hot operator key (backend), like production.
        vm.prank(owner);
        escrow.setOperator(operator);

        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            address a = makeAddr(string.concat("p", vm.toString(i)));
            players[i] = a;
            usdc.mint(a, 100_000_000_000); // $100k, plenty for many games
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    /// Approve players[0..n) as eligible winners. Signed by the owner (the
    /// effective approver while `approver` is unset); the operator cannot.
    function _approveFunded(bytes32 id, uint256 n) internal {
        address[] memory ws = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            ws[i] = players[i];
        }
        vm.prank(owner);
        escrow.setApprovedMany(id, ws, true);
    }

    function _invariant() internal view {
        assertEq(
            usdc.balanceOf(address(escrow)),
            escrow.usdcObligations(),
            "balance drifted from obligations"
        );
    }

    function _payout(uint256 depth) internal pure returns (uint16[] memory a) {
        // Even-ish split that always sums to exactly 10000.
        a = new uint16[](depth);
        uint16 each = uint16(10000 / depth);
        uint16 sum = 0;
        for (uint256 i = 1; i < depth; i++) {
            a[i] = each;
            sum += each;
        }
        a[0] = uint16(10000 - sum); // first place absorbs the remainder
    }

    /// A deterministic, hand-built scenario: 6 games with heavy player overlap,
    /// a mix of settle and cancel outcomes, then everyone exits. Proves per-game
    /// isolation + full drain.
    function test_stress_concurrentGamesDrainToZero() public {
        uint256 nGames = 6;
        bytes32[] memory ids = new bytes32[](nGames);
        uint256[] memory caps = new uint256[](nGames);
        uint256[] memory funds = new uint256[](nGames);
        uint16[] memory rakes = new uint16[](nGames);
        uint256[] memory depths = new uint256[](nGames);
        bool[] memory cancelled = new bool[](nGames);

        uint256 totalIn;

        // ── create + fund every game (overlapping rosters) ──
        for (uint256 g = 0; g < nGames; g++) {
            ids[g] = keccak256(abi.encode("stress-game", g));
            caps[g] = 8 + g * 4; // 8,12,16,20,24,28
            depths[g] = g % 3 == 0 ? 8 : (g % 3 == 1 ? 3 : 1);
            rakes[g] = uint16(500 * g); // 0,500,...,2500 -> clamp below cap
            if (rakes[g] > 2000) rakes[g] = 1500;

            vm.prank(operator);
            escrow.createGame(ids[g], FEE, uint32(caps[g]), rakes[g], _payout(depths[g]));

            // Fund between depth and cap players (indices 0..funds-1 => overlap).
            funds[g] = depths[g] + (g % 5); // still <= cap
            if (funds[g] > caps[g]) funds[g] = caps[g];
            for (uint256 i = 0; i < funds[g]; i++) {
                vm.prank(players[i]);
                escrow.deposit(ids[g]);
                totalIn += FEE;
            }
            // Approve every funded player as an eligible winner (owner is the
            // effective approver; approver is unset). The operator can settle
            // but cannot approve, so this must happen here.
            _approveFunded(ids[g], funds[g]);
            _invariant();
        }

        // ── lifecycle: settle most, cancel a couple ──
        for (uint256 g = 0; g < nGames; g++) {
            cancelled[g] = (g == 2 || g == 5);
            if (cancelled[g]) {
                vm.prank(operator);
                escrow.cancelGame(ids[g]);
            } else {
                vm.prank(operator);
                escrow.lock(ids[g]);
                address[] memory winners = new address[](depths[g]);
                for (uint256 i = 0; i < depths[g]; i++) {
                    winners[i] = players[i];
                }
                vm.prank(operator);
                escrow.settle(ids[g], winners);
            }
            _invariant();
        }

        // ── exits: winners + platform claim, cancelled players withdraw ──
        uint256 totalOut;
        for (uint256 g = 0; g < nGames; g++) {
            if (cancelled[g]) {
                for (uint256 i = 0; i < funds[g]; i++) {
                    uint256 before = usdc.balanceOf(players[i]);
                    vm.prank(players[i]);
                    escrow.withdraw(ids[g]);
                    totalOut += usdc.balanceOf(players[i]) - before;
                }
            } else {
                for (uint256 i = 0; i < depths[g]; i++) {
                    uint256 c = escrow.claimable(ids[g], players[i]);
                    if (c == 0) continue;
                    uint256 before = usdc.balanceOf(players[i]);
                    vm.prank(players[i]);
                    escrow.claim(ids[g]);
                    totalOut += usdc.balanceOf(players[i]) - before;
                }
                uint256 rakeC = escrow.claimable(ids[g], platform);
                if (rakeC > 0) {
                    uint256 before = usdc.balanceOf(platform);
                    vm.prank(platform);
                    escrow.claim(ids[g]);
                    totalOut += usdc.balanceOf(platform) - before;
                }
            }
            _invariant();
        }

        // Everything that came in went back out; the contract is empty.
        assertEq(totalOut, totalIn, "funds not conserved");
        assertEq(escrow.usdcObligations(), 0, "residual obligations");
        assertEq(usdc.balanceOf(address(escrow)), 0, "residual balance");
    }

    /// Fuzzed version: random caps / rakes / rosters / outcomes across 8 games.
    /// The invariant must survive whatever the fuzzer throws at it, and the
    /// contract must still fully drain.
    function testFuzz_manyGamesConserveFunds(uint256 seed) public {
        uint256 nGames = 8;
        bytes32[] memory ids = new bytes32[](nGames);
        uint256[] memory funds = new uint256[](nGames);
        uint256[] memory depths = new uint256[](nGames);
        bool[] memory cancelled = new bool[](nGames);
        uint256 totalIn;

        for (uint256 g = 0; g < nGames; g++) {
            seed = uint256(keccak256(abi.encode(seed, g)));
            ids[g] = keccak256(abi.encode("fuzz", seed));
            uint256 cap = 3 + (seed % 30); // 3..32
            if (cap > NUM_PLAYERS) cap = NUM_PLAYERS;
            uint256 depth = 1 + (seed % 3); // 1..3
            if (depth > cap) depth = cap;
            uint16 rake = uint16(seed % 2001); // 0..2000
            depths[g] = depth;

            vm.prank(operator);
            escrow.createGame(ids[g], FEE, uint32(cap), rake, _payout(depth));

            uint256 f = depth + (seed % (cap - depth + 1)); // depth..cap
            funds[g] = f;
            for (uint256 i = 0; i < f; i++) {
                vm.prank(players[i]);
                escrow.deposit(ids[g]);
                totalIn += FEE;
            }
            _approveFunded(ids[g], f);
            _invariant();
        }

        for (uint256 g = 0; g < nGames; g++) {
            cancelled[g] = (uint256(keccak256(abi.encode(seed, "x", g))) % 4 == 0);
            if (cancelled[g]) {
                vm.prank(operator);
                escrow.cancelGame(ids[g]);
            } else {
                vm.prank(operator);
                escrow.lock(ids[g]);
                address[] memory winners = new address[](depths[g]);
                for (uint256 i = 0; i < depths[g]; i++) {
                    winners[i] = players[i];
                }
                vm.prank(operator);
                escrow.settle(ids[g], winners);
            }
            _invariant();
        }

        uint256 totalOut;
        for (uint256 g = 0; g < nGames; g++) {
            if (cancelled[g]) {
                for (uint256 i = 0; i < funds[g]; i++) {
                    uint256 before = usdc.balanceOf(players[i]);
                    vm.prank(players[i]);
                    escrow.withdraw(ids[g]);
                    totalOut += usdc.balanceOf(players[i]) - before;
                }
            } else {
                for (uint256 i = 0; i < depths[g]; i++) {
                    uint256 c = escrow.claimable(ids[g], players[i]);
                    if (c == 0) continue;
                    uint256 before = usdc.balanceOf(players[i]);
                    vm.prank(players[i]);
                    escrow.claim(ids[g]);
                    totalOut += usdc.balanceOf(players[i]) - before;
                }
                uint256 rakeC = escrow.claimable(ids[g], platform);
                if (rakeC > 0) {
                    uint256 before = usdc.balanceOf(platform);
                    vm.prank(platform);
                    escrow.claim(ids[g]);
                    totalOut += usdc.balanceOf(platform) - before;
                }
            }
            _invariant();
        }

        assertEq(totalOut, totalIn, "funds not conserved");
        assertEq(escrow.usdcObligations(), 0, "residual obligations");
        assertEq(usdc.balanceOf(address(escrow)), 0, "residual balance");
    }
}
