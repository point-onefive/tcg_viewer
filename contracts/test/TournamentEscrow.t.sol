// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TournamentEscrow} from "../src/TournamentEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Trivial V2 used to prove UUPS upgrade authorization.
contract EscrowV2 is TournamentEscrow {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract TournamentEscrowTest is Test {
    TournamentEscrow escrow;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address platform = makeAddr("platform");
    address stranger = makeAddr("stranger");

    // Players are derived from private keys so we can sign EIP-2612 permits.
    uint256 constant NUM_PLAYERS = 20;
    address[NUM_PLAYERS] players;
    uint256[NUM_PLAYERS] playerKeys;

    uint256 constant FEE = 10_000_000; // $10, 6 decimals
    bytes32 constant GAME = keccak256("game-1");

    bytes32 constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        usdc = new MockUSDC();

        TournamentEscrow impl = new TournamentEscrow();
        bytes memory initData =
            abi.encodeCall(TournamentEscrow.initialize, (owner, address(usdc), platform));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = TournamentEscrow(address(proxy));

        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            (address addr, uint256 key) = makeAddrAndKey(string.concat("player", vm.toString(i)));
            players[i] = addr;
            playerKeys[i] = key;
            usdc.mint(addr, 1_000_000_000); // $1,000 each
            vm.prank(addr);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _top8() internal pure returns (uint16[] memory a) {
        a = new uint16[](8);
        a[0] = 3300;
        a[1] = 2000;
        a[2] = 1400;
        a[3] = 1000;
        a[4] = 800;
        a[5] = 600;
        a[6] = 500;
        a[7] = 400;
    }

    function _top3() internal pure returns (uint16[] memory a) {
        a = new uint16[](3);
        a[0] = 5000;
        a[1] = 3000;
        a[2] = 2000;
    }

    function _wta() internal pure returns (uint16[] memory a) {
        a = new uint16[](1);
        a[0] = 10000;
    }

    function _createTop8(bytes32 id, uint32 cap) internal {
        vm.prank(owner);
        escrow.createGame(id, FEE, cap, 1500, _top8());
    }

    function _deposit(bytes32 id, uint256 playerIdx) internal {
        vm.prank(players[playerIdx]);
        escrow.deposit(id);
    }

    function _depositN(bytes32 id, uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            _deposit(id, i);
        }
    }

    // ── createGame ─────────────────────────────────────────────────────────

    function test_createGame_ok() public {
        _createTop8(GAME, 16);
        (
            TournamentEscrow.GameState state,
            uint256 fee,
            uint32 cap,
            uint32 fundedCount,
            uint16 rakeBps,
            uint256 pot,
            uint64 lockedAt,
            uint16[] memory payout
        ) = escrow.getGame(GAME);
        assertEq(uint256(state), uint256(TournamentEscrow.GameState.Funding));
        assertEq(fee, FEE);
        assertEq(cap, 16);
        assertEq(fundedCount, 0);
        assertEq(rakeBps, 1500);
        assertEq(pot, 0);
        assertEq(lockedAt, 0);
        assertEq(payout.length, 8);
    }

    function test_createGame_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.createGame(GAME, FEE, 16, 1500, _top8());
    }

    function test_createGame_revertsOnDuplicate() public {
        _createTop8(GAME, 16);
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.GameAlreadyExists.selector);
        escrow.createGame(GAME, FEE, 16, 1500, _top8());
    }

    function test_createGame_revertsOnRakeTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.RakeTooHigh.selector);
        escrow.createGame(GAME, FEE, 16, 2001, _top8());
    }

    function test_createGame_revertsOnZeroFee() public {
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.InvalidEntryFee.selector);
        escrow.createGame(GAME, 0, 16, 1500, _top8());
    }

    function test_createGame_revertsOnZeroCap() public {
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.InvalidCap.selector);
        escrow.createGame(GAME, FEE, 0, 1500, _top8());
    }

    function test_createGame_revertsOnBadPayoutSum() public {
        uint16[] memory bad = _top8();
        bad[0] = 3200; // sum becomes 9900
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.BadPayoutSplit.selector);
        escrow.createGame(GAME, FEE, 16, 1500, bad);
    }

    function test_createGame_revertsOnZeroPayoutEntry() public {
        uint16[] memory bad = new uint16[](2);
        bad[0] = 10000;
        bad[1] = 0;
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.BadPayoutSplit.selector);
        escrow.createGame(GAME, FEE, 16, 1500, bad);
    }

    function test_createGame_revertsWhenPayoutDepthExceedsCap() public {
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.BadPayoutSplit.selector);
        escrow.createGame(GAME, FEE, 4, 1500, _top8()); // depth 8 > cap 4
    }

    // ── deposit ──────────────────────────────────────────────────────────────

    function test_deposit_ok() public {
        _createTop8(GAME, 16);
        _deposit(GAME, 0);
        assertTrue(escrow.funded(GAME, players[0]));
        assertEq(usdc.balanceOf(address(escrow)), FEE);
        (,,, uint32 fundedCount,, uint256 pot,,) = escrow.getGame(GAME);
        assertEq(fundedCount, 1);
        assertEq(pot, FEE);
        assertEq(escrow.usdcObligations(), FEE);
    }

    function test_deposit_revertsWhenAlreadyFunded() public {
        _createTop8(GAME, 16);
        _deposit(GAME, 0);
        vm.prank(players[0]);
        vm.expectRevert(TournamentEscrow.AlreadyFunded.selector);
        escrow.deposit(GAME);
    }

    function test_deposit_revertsWhenFull() public {
        _createTop8(GAME, 8);
        _depositN(GAME, 8);
        vm.prank(players[8]);
        vm.expectRevert(TournamentEscrow.GameFull.selector);
        escrow.deposit(GAME);
    }

    function test_deposit_revertsWhenNotFunding() public {
        vm.prank(players[0]);
        vm.expectRevert(TournamentEscrow.WrongState.selector);
        escrow.deposit(GAME); // never created
    }

    function test_deposit_revertsWhenPaused() public {
        _createTop8(GAME, 16);
        vm.prank(owner);
        escrow.pause();
        vm.prank(players[0]);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.deposit(GAME);
    }

    // ── depositWithPermit ─────────────────────────────────────────────────────

    function _signPermit(uint256 pk, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address ownerAddr = vm.addr(pk);
        uint256 nonce = usdc.nonces(ownerAddr);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, ownerAddr, spender, value, nonce, deadline));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_depositWithPermit_ok() public {
        _createTop8(GAME, 16);
        // A fresh player with no prior approval.
        (address p, uint256 pk) = makeAddrAndKey("permit-player");
        usdc.mint(p, FEE);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, address(escrow), FEE, deadline);

        vm.prank(p);
        escrow.depositWithPermit(GAME, FEE, deadline, v, r, s);

        assertTrue(escrow.funded(GAME, p));
        assertEq(usdc.balanceOf(address(escrow)), FEE);
    }

    function test_depositWithPermit_revertsWhenValueBelowFee() public {
        _createTop8(GAME, 16);
        (address p, uint256 pk) = makeAddrAndKey("permit-player-2");
        usdc.mint(p, FEE);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, address(escrow), FEE - 1, deadline);
        vm.prank(p);
        vm.expectRevert(TournamentEscrow.InsufficientPermitValue.selector);
        escrow.depositWithPermit(GAME, FEE - 1, deadline, v, r, s);
    }

    function test_depositWithPermit_toleratesFrontRunPermit() public {
        _createTop8(GAME, 16);
        (address p, uint256 pk) = makeAddrAndKey("permit-player-3");
        usdc.mint(p, FEE);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, address(escrow), FEE, deadline);
        // Attacker front-runs by submitting the permit directly.
        usdc.permit(p, address(escrow), FEE, deadline, v, r, s);
        // The deposit must still succeed (allowance already set; permit try/catch).
        vm.prank(p);
        escrow.depositWithPermit(GAME, FEE, deadline, v, r, s);
        assertTrue(escrow.funded(GAME, p));
    }

    // ── lock ─────────────────────────────────────────────────────────────────

    function test_lock_ok() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 8);
        vm.prank(owner);
        escrow.lock(GAME);
        (TournamentEscrow.GameState state,,,,,, uint64 lockedAt,) = escrow.getGame(GAME);
        assertEq(uint256(state), uint256(TournamentEscrow.GameState.Locked));
        assertEq(lockedAt, uint64(block.timestamp));
    }

    function test_lock_revertsWhenFieldSmallerThanPayoutDepth() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 6); // 6 < depth 8
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.PayoutDepthExceedsField.selector);
        escrow.lock(GAME);
    }

    function test_lock_onlyOwner() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 8);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.lock(GAME);
    }

    function test_lock_revertsWhenNotFunding() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 8);
        vm.startPrank(owner);
        escrow.lock(GAME);
        vm.expectRevert(TournamentEscrow.WrongState.selector);
        escrow.lock(GAME);
        vm.stopPrank();
    }

    // ── settle ───────────────────────────────────────────────────────────────

    function _lockedWith(uint256 n) internal returns (address[] memory winners) {
        _createTop8(GAME, 16);
        _depositN(GAME, n);
        vm.prank(owner);
        escrow.lock(GAME);
        winners = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            winners[i] = players[i];
        }
    }

    function test_settle_workedExample_16players() public {
        // 16 x $10 = $160 pot, 15% rake => $24 platform, $136 prize pool.
        _createTop8(GAME, 16);
        _depositN(GAME, 16);
        vm.prank(owner);
        escrow.lock(GAME);

        address[] memory winners = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            winners[i] = players[i];
        }
        vm.prank(owner);
        escrow.settle(GAME, winners);

        assertEq(escrow.claimable(GAME, players[0]), 44_880000);
        assertEq(escrow.claimable(GAME, players[1]), 27_200000);
        assertEq(escrow.claimable(GAME, players[2]), 19_040000);
        assertEq(escrow.claimable(GAME, players[3]), 13_600000);
        assertEq(escrow.claimable(GAME, players[4]), 10_880000);
        assertEq(escrow.claimable(GAME, players[5]), 8_160000);
        assertEq(escrow.claimable(GAME, players[6]), 6_800000);
        assertEq(escrow.claimable(GAME, players[7]), 5_440000);
        assertEq(escrow.claimable(GAME, platform), 24_000000);

        (TournamentEscrow.GameState state,,,,, uint256 pot,,) = escrow.getGame(GAME);
        assertEq(uint256(state), uint256(TournamentEscrow.GameState.Paid));
        assertEq(pot, 0);
    }

    function test_settle_conservesPotWithDust() public {
        // Odd pot to force integer-division dust folded into 1st place.
        uint16[] memory split = _top3();
        vm.prank(owner);
        escrow.createGame(GAME, 333_333, 16, 1500, split); // weird fee -> dust
        _depositN(GAME, 7);
        uint256 pot = 333_333 * 7;
        vm.prank(owner);
        escrow.lock(GAME);

        address[] memory winners = new address[](3);
        winners[0] = players[0];
        winners[1] = players[1];
        winners[2] = players[2];
        vm.prank(owner);
        escrow.settle(GAME, winners);

        uint256 sum = escrow.claimable(GAME, players[0]) + escrow.claimable(GAME, players[1])
            + escrow.claimable(GAME, players[2]) + escrow.claimable(GAME, platform);
        assertEq(sum, pot, "winners + rake must equal pot to the last unit");
        // 1st place carries the dust, so it is >= the exact split share.
        uint256 rake = (pot * 1500) / 10000;
        uint256 prize = pot - rake;
        assertGe(escrow.claimable(GAME, players[0]), (prize * 5000) / 10000);
    }

    function test_settle_revertsOnDuplicateWinner() public {
        address[] memory winners = _lockedWith(16);
        winners[7] = winners[0];
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.DuplicateWinner.selector);
        escrow.settle(GAME, winners);
    }

    function test_settle_revertsWhenWinnerNotFunded() public {
        address[] memory winners = _lockedWith(16);
        winners[7] = stranger; // never deposited
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.WinnerNotFunded.selector);
        escrow.settle(GAME, winners);
    }

    function test_settle_revertsOnWinnerCountMismatch() public {
        _lockedWith(16);
        address[] memory winners = new address[](7);
        for (uint256 i = 0; i < 7; i++) {
            winners[i] = players[i];
        }
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.WinnerCountMismatch.selector);
        escrow.settle(GAME, winners);
    }

    function test_settle_revertsWhenNotLocked() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 16);
        address[] memory winners = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            winners[i] = players[i];
        }
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.WrongState.selector);
        escrow.settle(GAME, winners); // still Funding
    }

    function test_settle_revertsWhenPaused() public {
        address[] memory winners = _lockedWith(16);
        vm.prank(owner);
        escrow.pause();
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.settle(GAME, winners);
    }

    function test_settle_onlyOwner() public {
        address[] memory winners = _lockedWith(16);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.settle(GAME, winners);
    }

    function test_settle_revertsOnSecondSettle() public {
        address[] memory winners = _lockedWith(16);
        vm.startPrank(owner);
        escrow.settle(GAME, winners);
        vm.expectRevert(TournamentEscrow.WrongState.selector);
        escrow.settle(GAME, winners);
        vm.stopPrank();
    }

    // ── claim ────────────────────────────────────────────────────────────────

    function test_claim_winnerAndPlatform() public {
        address[] memory winners = _lockedWith(16); // 16 funded, pot = 160e6
        vm.prank(owner);
        escrow.settle(GAME, winners);

        uint256 before = usdc.balanceOf(players[0]);
        vm.prank(players[0]);
        escrow.claim(GAME);
        assertGt(usdc.balanceOf(players[0]), before);
        assertEq(escrow.claimable(GAME, players[0]), 0);

        uint256 platformBefore = usdc.balanceOf(platform);
        vm.prank(platform);
        escrow.claim(GAME);
        assertEq(usdc.balanceOf(platform) - platformBefore, (160e6 * 1500) / 10000);
    }

    function test_claim_revertsWhenNothing() public {
        address[] memory winners = _lockedWith(16);
        vm.prank(owner);
        escrow.settle(GAME, winners);
        vm.prank(stranger);
        vm.expectRevert(TournamentEscrow.NothingToClaim.selector);
        escrow.claim(GAME);
    }

    function test_claim_revertsOnDoubleClaim() public {
        address[] memory winners = _lockedWith(16);
        vm.prank(owner);
        escrow.settle(GAME, winners);
        vm.startPrank(players[0]);
        escrow.claim(GAME);
        vm.expectRevert(TournamentEscrow.NothingToClaim.selector);
        escrow.claim(GAME);
        vm.stopPrank();
    }

    // ── refunds: cancel / pause / dead-man ────────────────────────────────────

    function test_withdraw_afterCancel() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 5);
        vm.prank(owner);
        escrow.cancelGame(GAME);

        uint256 before = usdc.balanceOf(players[0]);
        vm.prank(players[0]);
        escrow.withdraw(GAME);
        assertEq(usdc.balanceOf(players[0]) - before, FEE);
        assertTrue(escrow.refunded(GAME, players[0]));
        assertEq(escrow.usdcObligations(), FEE * 4);
    }

    function test_withdraw_whenPaused() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 5);
        vm.prank(owner);
        escrow.pause();
        vm.prank(players[0]);
        escrow.withdraw(GAME);
        assertTrue(escrow.refunded(GAME, players[0]));
    }

    function test_withdraw_deadmanAfterLock() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 8);
        vm.prank(owner);
        escrow.lock(GAME);

        // Before dead-man window: not refundable.
        vm.prank(players[0]);
        vm.expectRevert(TournamentEscrow.NotRefundable.selector);
        escrow.withdraw(GAME);

        vm.warp(block.timestamp + 14 days);
        assertTrue(escrow.deadmanElapsed(GAME));
        vm.prank(players[0]);
        escrow.withdraw(GAME);
        assertTrue(escrow.refunded(GAME, players[0]));
    }

    function test_withdraw_revertsWhenFunding() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 3);
        vm.prank(players[0]);
        vm.expectRevert(TournamentEscrow.NotRefundable.selector);
        escrow.withdraw(GAME);
    }

    function test_withdraw_revertsOnDouble() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 3);
        vm.prank(owner);
        escrow.cancelGame(GAME);
        vm.startPrank(players[0]);
        escrow.withdraw(GAME);
        vm.expectRevert(TournamentEscrow.AlreadyRefunded.selector);
        escrow.withdraw(GAME);
        vm.stopPrank();
    }

    function test_withdraw_revertsWhenNotFunded() public {
        _createTop8(GAME, 16);
        vm.prank(owner);
        escrow.cancelGame(GAME);
        vm.prank(stranger);
        vm.expectRevert(TournamentEscrow.NotFunded.selector);
        escrow.withdraw(GAME);
    }

    // ── refundPlayer (pre-lock kick) ──────────────────────────────────────────

    function test_refundPlayer_ok() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 3);
        uint256 before = usdc.balanceOf(players[1]);
        vm.prank(owner);
        escrow.refundPlayer(GAME, players[1]);
        assertEq(usdc.balanceOf(players[1]) - before, FEE);
        assertFalse(escrow.funded(GAME, players[1]));
        assertTrue(escrow.refunded(GAME, players[1]));
        (,,, uint32 fundedCount,, uint256 pot,,) = escrow.getGame(GAME);
        assertEq(fundedCount, 2);
        assertEq(pot, FEE * 2);
    }

    function test_refundPlayer_revertsAfterLock() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 8);
        vm.prank(owner);
        escrow.lock(GAME);
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.WrongState.selector);
        escrow.refundPlayer(GAME, players[0]);
    }

    function test_refundPlayer_onlyOwner() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 3);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.refundPlayer(GAME, players[0]);
    }

    // ── per-game isolation (highest priority) ────────────────────────────────

    function test_perGameIsolation_settleDoesNotDrainOtherGame() public {
        bytes32 A = keccak256("A");
        bytes32 B = keccak256("B");
        _createTop8(A, 16);
        _createTop8(B, 16);
        // Fund A with 16, B with 8.
        for (uint256 i = 0; i < 16; i++) {
            vm.prank(players[i]);
            escrow.deposit(A);
        }
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(players[i]);
            escrow.deposit(B);
        }
        uint256 totalHeld = usdc.balanceOf(address(escrow));
        assertEq(totalHeld, FEE * 24);

        vm.startPrank(owner);
        escrow.lock(A);
        address[] memory winners = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            winners[i] = players[i];
        }
        escrow.settle(A, winners);
        vm.stopPrank();

        // B's pot is untouched.
        (,,,,, uint256 potB,,) = escrow.getGame(B);
        assertEq(potB, FEE * 8);

        // A winner cannot claim anything from B.
        assertEq(escrow.claimable(B, players[0]), 0);

        // Total credited for A == A's pot, never spilling into B's funds.
        uint256 creditedA = escrow.claimable(A, platform);
        for (uint256 i = 0; i < 8; i++) {
            creditedA += escrow.claimable(A, players[i]);
        }
        assertEq(creditedA, FEE * 16);
    }

    // ── conservation invariant: every deposit has exactly one exit ────────────

    function test_conservation_settleThenClaimAll() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 16);
        vm.prank(owner);
        escrow.lock(GAME);
        address[] memory winners = new address[](8);
        for (uint256 i = 0; i < 8; i++) {
            winners[i] = players[i];
        }
        vm.prank(owner);
        escrow.settle(GAME, winners);

        for (uint256 i = 0; i < 8; i++) {
            vm.prank(players[i]);
            escrow.claim(GAME);
        }
        vm.prank(platform);
        escrow.claim(GAME);

        assertEq(usdc.balanceOf(address(escrow)), 0, "all funds distributed");
        assertEq(escrow.usdcObligations(), 0);
    }

    function test_conservation_cancelThenWithdrawAll() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 10);
        vm.prank(owner);
        escrow.cancelGame(GAME);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(players[i]);
            escrow.withdraw(GAME);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.usdcObligations(), 0);
    }

    // ── rescueStrayTokens ─────────────────────────────────────────────────────

    function test_rescue_onlyStrayUsdc() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 4); // obligations = 4 * FEE
        // Someone sends USDC directly (not via deposit).
        usdc.mint(address(escrow), 5_000_000);
        assertEq(escrow.usdcObligations(), FEE * 4);

        // Cannot rescue more than the stray amount.
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.ProtectedFunds.selector);
        escrow.rescueStrayTokens(address(usdc), owner, 5_000_001);

        // Can rescue exactly the stray amount; tracked pot stays intact.
        vm.prank(owner);
        escrow.rescueStrayTokens(address(usdc), owner, 5_000_000);
        assertEq(usdc.balanceOf(address(escrow)), FEE * 4);
        assertEq(usdc.balanceOf(owner), 5_000_000);
    }

    function test_rescue_otherToken_full() public {
        MockUSDC other = new MockUSDC();
        other.mint(address(escrow), 123);
        vm.prank(owner);
        escrow.rescueStrayTokens(address(other), owner, 123);
        assertEq(other.balanceOf(owner), 123);
    }

    function test_rescue_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.rescueStrayTokens(address(usdc), stranger, 1);
    }

    // ── pause / admin gating ──────────────────────────────────────────────────

    function test_pause_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.pause();
    }

    function test_setPlatform() public {
        address next = makeAddr("newPlatform");
        vm.prank(owner);
        escrow.setPlatform(next);
        assertEq(escrow.platform(), next);
    }

    function test_setPlatform_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(TournamentEscrow.ZeroAddress.selector);
        escrow.setPlatform(address(0));
    }

    // ── UUPS upgrade authorization ───────────────────────────────────────────

    function test_upgrade_onlyOwner() public {
        EscrowV2 v2 = new EscrowV2();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.upgradeToAndCall(address(v2), "");
    }

    function test_upgrade_byOwnerPreservesState() public {
        _createTop8(GAME, 16);
        _depositN(GAME, 3);

        EscrowV2 v2 = new EscrowV2();
        vm.prank(owner);
        escrow.upgradeToAndCall(address(v2), "");

        assertEq(EscrowV2(address(escrow)).version(), "v2");
        // State survives the upgrade.
        (,,, uint32 fundedCount,, uint256 pot,,) = escrow.getGame(GAME);
        assertEq(fundedCount, 3);
        assertEq(pot, FEE * 3);
    }

    // ── init guards ───────────────────────────────────────────────────────────

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert();
        escrow.initialize(owner, address(usdc), platform);
    }
}
