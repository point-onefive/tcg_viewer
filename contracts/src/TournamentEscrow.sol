// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TournamentEscrow
/// @notice Trustless custodian for paid TCG tournaments on Base (USDC).
///         Holds many independent games at once, keyed by a bytes32 id that
///         mirrors the off-chain Supabase tournament id. The operator (owner)
///         creates, locks, and settles games; the contract constrains what the
///         operator can do with the money and guarantees every deposit has
///         exactly one exit (payout via claim, or refund via withdraw).
/// @dev    See docs/paid-tournaments-escrow.md for the full design. v1 trusts
///         the operator to report winners honestly (off-chain results oracle)
///         but caps the rake, isolates per-game funds, computes payout amounts
///         on-chain, and provides refund escape hatches (cancel, global pause,
///         and a per-game dead-man switch).
contract TournamentEscrow is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    /// @notice Hard ceiling on the platform rake, in basis points (20%).
    ///         v1 uses 1500 (15%); the cap can never be exceeded, even by the
    ///         operator, and cannot be raised without a contract upgrade.
    uint16 public constant MAX_RAKE_BPS = 2000;

    /// @notice Basis-points denominator (100%).
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Time after `lock` before players may self-refund an unsettled
    ///         game (dead-man switch). Protects against a lost key or an
    ///         abandoned game.
    uint256 public constant DEADMAN_DURATION = 14 days;

    // ── Types ──────────────────────────────────────────────────────────────

    enum GameState {
        None, // never created
        Funding, // accepting deposits
        Locked, // roster + payout frozen, tournament running
        Paid, // settled, winners + platform can claim
        Cancelled // refundable, players can withdraw
    }

    struct Game {
        GameState state;
        uint16 rakeBps;
        uint32 cap;
        uint32 fundedCount;
        uint64 lockedAt;
        uint256 entryFee; // USDC, 6 decimals
        uint256 pot; // collected entries still held for this game
        uint16[] payoutBps; // post-rake split, sums to BPS_DENOMINATOR
    }

    // ── Storage ────────────────────────────────────────────────────────────

    /// @notice Settlement asset. Native Circle USDC on Base for production.
    IERC20 public usdc;

    /// @notice Address that receives the platform rake (claims it like a winner).
    address public platform;

    /// @notice Least-privilege automation key that runs the game lifecycle
    ///         (createGame / lock / settle / cancelGame / refundPlayer) so the
    ///         backend can drive autopilot WITHOUT the owner key. It can never
    ///         upgrade, pause, change the platform, or rescue funds. `settle`
    ///         only pays addresses that actually funded the game, and never more
    ///         than a game's pot, so a compromised operator cannot drain to an
    ///         arbitrary external address or exceed a single pot. It is NOT fully
    ///         non-custodial, but the pre-mainnet mitigation is now IN PLACE:
    ///         `settle` requires every winner to be on the per-game approved
    ///         allowlist (`approvedWinner`), and only the SEPARATE `approver`
    ///         role can add to that allowlist. So even though deposits are
    ///         permissionless, a compromised operator that deposits into a game
    ///         still cannot settle its own wallet: it cannot approve itself,
    ///         because approving is not an operator power. `owner` always
    ///         retains every operator power too.
    address public operator;

    /// @notice Total USDC this contract owes to games (pots) and recipients
    ///         (credits). Anything above this is a stray token and is the only
    ///         thing `rescueStrayTokens` may remove for USDC.
    uint256 public usdcObligations;

    mapping(bytes32 => Game) private _games;

    /// @dev game id => player => paid a confirmed entry.
    mapping(bytes32 => mapping(address => bool)) public funded;

    /// @dev game id => player => already refunded (prevents double withdraw).
    mapping(bytes32 => mapping(address => bool)) public refunded;

    /// @dev game id => recipient => pending pull balance (winners + platform).
    mapping(bytes32 => mapping(address => uint256)) public credit;

    // ── Storage appended in the pre-mainnet hardening upgrade ────────────────
    // APPEND-ONLY: these two vars were added AFTER `credit` and the `__gap`
    // below was shrunk from 43 to 41 (2 new slots), so the layout stays
    // compatible with the already-deployed testnet proxy. Never reorder or
    // insert storage above this line.

    /// @notice The APPROVE authority: the only key allowed to add a wallet to a
    ///         game's winner allowlist (`setApproved`). It is deliberately
    ///         SEPARATE from `operator`. A compromised operator key (which can
    ///         create / lock / settle) still cannot pay itself, because it
    ///         cannot approve itself as a winner - that requires this distinct
    ///         approver key. When `approver == address(0)` the role falls back
    ///         to `owner()` (see `_effectiveApprover`), so an upgraded proxy is
    ///         safe by default until the owner points it at a dedicated key via
    ///         `setApprover`. Slot appended in the hardening upgrade.
    address public approver;

    /// @dev game id => wallet => eligible to be named a winner in `settle`.
    ///      Only the effective approver can set this. `settle` reverts unless
    ///      every ordered winner is approved here. Slot appended in the
    ///      hardening upgrade.
    mapping(bytes32 => mapping(address => bool)) public approvedWinner;

    /// @dev Storage gap for future upgrades (UUPS). Do not remove; shrink when
    ///      adding new storage vars so the layout stays compatible. Shrunk from
    ///      43 to 41 when `approver` + `approvedWinner` were appended above.
    uint256[41] private __gap;

    // ── Events ─────────────────────────────────────────────────────────────

    event GameCreated(
        bytes32 indexed id, uint256 entryFee, uint32 cap, uint16 rakeBps, uint16[] payoutBps
    );
    event Deposited(bytes32 indexed id, address indexed player, uint256 amount);
    event GameLocked(bytes32 indexed id, uint32 fundedCount, uint64 lockedAt);
    event Settled(
        bytes32 indexed id, address[] winners, uint256[] amounts, uint256 rake, address platform
    );
    event GameCancelled(bytes32 indexed id);
    event PlayerRefunded(bytes32 indexed id, address indexed player, uint256 amount);
    event Withdrawn(bytes32 indexed id, address indexed player, uint256 amount);
    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount);
    event PlatformUpdated(address indexed previous, address indexed next);
    event OperatorUpdated(address indexed previous, address indexed next);
    event ApproverChanged(address indexed previous, address indexed next);
    /// @notice A wallet's winner-eligibility for a game was set (or cleared).
    event WinnerApprovalSet(bytes32 indexed id, address indexed wallet, bool approved);
    event StrayTokensRescued(address indexed token, address indexed to, uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────────

    error ZeroAddress();
    error GameAlreadyExists();
    error GameNotFound();
    error WrongState();
    error InvalidEntryFee();
    error InvalidCap();
    error RakeTooHigh();
    error BadPayoutSplit();
    error PayoutDepthExceedsField();
    error GameFull();
    error AlreadyFunded();
    error NotFunded();
    error AlreadyRefunded();
    error NotRefundable();
    error WinnerCountMismatch();
    error DuplicateWinner();
    error WinnerNotFunded();
    /// @notice A named winner is not on the game's approved-winner allowlist.
    error WinnerNotApproved(address winner);
    error NothingToClaim();
    error InsufficientPermitValue();
    error ProtectedFunds();
    error NotOperator();
    /// @notice Caller is not the effective approver (the separate approve role).
    error NotApprover();

    // ── Modifiers ────────────────────────────────────────────────────────────

    /// @dev Owner OR the automation operator. Owner keeps every operator power.
    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    /// @dev The separate APPROVE authority (see `approver`). Gated on the
    ///      EFFECTIVE approver so that once the owner assigns a dedicated
    ///      approver key, neither the operator nor the owner can add winners to
    ///      the allowlist - only that approver key can. This separation is the
    ///      whole point: it removes a compromised operator's ability to pay
    ///      itself. When `approver` is unset it falls back to `owner()`.
    modifier onlyApprover() {
        if (msg.sender != _effectiveApprover()) revert NotApprover();
        _;
    }

    /// @notice The address currently allowed to approve winners: the dedicated
    ///         `approver` when set, otherwise the `owner`. Falling back to the
    ///         owner keeps an upgraded proxy safe (no null-approver window)
    ///         until the owner calls `setApprover`.
    function _effectiveApprover() internal view returns (address) {
        return approver == address(0) ? owner() : approver;
    }

    // ── Init ───────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param owner_ operator / upgrade authority (an EOA in v1, a Safe later).
    /// @param usdc_ the settlement token (native USDC on Base).
    /// @param platform_ the rake recipient.
    function initialize(address owner_, address usdc_, address platform_) external initializer {
        if (owner_ == address(0) || usdc_ == address(0) || platform_ == address(0)) {
            revert ZeroAddress();
        }
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        usdc = IERC20(usdc_);
        platform = platform_;
        // Operator defaults to the owner; the owner points it at the hot backend
        // key post-deploy via setOperator. This keeps deploy + tests simple and
        // means the contract is never left with a null operator.
        operator = owner_;
        emit OperatorUpdated(address(0), owner_);
    }

    /// @notice Point the autopilot operator at a new key (e.g. the backend hot
    ///         wallet, or back to the owner to disable automation). Owner only.
    function setOperator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, next);
        operator = next;
    }

    /// @notice Assign the dedicated APPROVE authority. Owner only. Pass
    ///         `address(0)` to fall back to the owner as the approver. Keep
    ///         this key DISTINCT from the operator key: the mitigation only
    ///         holds if the key that can settle games cannot also approve
    ///         winners. There is no re-init on upgrade, so an upgraded proxy
    ///         starts with `approver == address(0)` (owner is the effective
    ///         approver) and stays safe until the owner calls this.
    function setApprover(address next) external onlyOwner {
        emit ApproverChanged(approver, next);
        approver = next;
    }

    // ── Approver: winner allowlist ───────────────────────────────────────────

    /// @notice Add or remove a wallet from a game's approved-winner allowlist.
    ///         Only the effective approver may call this (NOT the operator).
    ///         `settle` reverts unless every named winner is approved here, so
    ///         a compromised operator that deposited into a game cannot settle
    ///         its own wallet: it cannot approve itself.
    function setApproved(bytes32 gameId, address wallet, bool ok) external onlyApprover {
        _setApproved(gameId, wallet, ok);
    }

    /// @notice Batch form of `setApproved` for a whole approved roster at once.
    function setApprovedMany(bytes32 gameId, address[] calldata wallets, bool ok)
        external
        onlyApprover
    {
        uint256 n = wallets.length;
        for (uint256 i = 0; i < n; i++) {
            _setApproved(gameId, wallets[i], ok);
        }
    }

    function _setApproved(bytes32 gameId, address wallet, bool ok) private {
        approvedWinner[gameId][wallet] = ok;
        // Explicit re-approval also lifts a prior refund block, so a wallet that
        // was refunded (e.g. kicked in error, or re-admitted) can deposit again.
        // This is the ONLY documented bypass of the `!refunded` re-deposit
        // guard: a refunded wallet cannot silently re-fund itself, but the
        // approver can deliberately re-admit it.
        if (ok && refunded[gameId][wallet]) {
            refunded[gameId][wallet] = false;
        }
        emit WinnerApprovalSet(gameId, wallet, ok);
    }

    // ── Operator: game lifecycle ─────────────────────────────────────────────

    /// @notice Open a new game for funding.
    /// @param id mirrors the off-chain tournament id.
    /// @param entryFee exact per-player entry, in USDC (6 decimals).
    /// @param cap maximum funded players.
    /// @param rakeBps platform fee in basis points, <= MAX_RAKE_BPS.
    /// @param payoutBps_ post-rake split; must sum to BPS_DENOMINATOR.
    function createGame(
        bytes32 id,
        uint256 entryFee,
        uint32 cap,
        uint16 rakeBps,
        uint16[] calldata payoutBps_
    ) external onlyOperator {
        Game storage g = _games[id];
        if (g.state != GameState.None) revert GameAlreadyExists();
        if (entryFee == 0) revert InvalidEntryFee();
        if (cap == 0) revert InvalidCap();
        if (rakeBps > MAX_RAKE_BPS) revert RakeTooHigh();
        _validatePayout(payoutBps_, cap);

        g.state = GameState.Funding;
        g.entryFee = entryFee;
        g.cap = cap;
        g.rakeBps = rakeBps;
        g.payoutBps = payoutBps_;

        emit GameCreated(id, entryFee, cap, rakeBps, payoutBps_);
    }

    /// @notice Freeze the roster and payout structure and start play. Rejects
    ///         if the funded field is smaller than the payout depth (cannot run
    ///         a top-8 payout on 6 players). Starts the dead-man clock.
    function lock(bytes32 id) external onlyOperator {
        Game storage g = _games[id];
        if (g.state != GameState.Funding) revert WrongState();
        if (g.fundedCount < g.payoutBps.length) revert PayoutDepthExceedsField();

        g.state = GameState.Locked;
        g.lockedAt = uint64(block.timestamp);

        emit GameLocked(id, g.fundedCount, g.lockedAt);
    }

    /// @notice Submit the final placement (ordered 1st, 2nd, 3rd, ...). The
    ///         contract computes each amount from the locked split and pot,
    ///         credits winners and the platform, then moves the game to Paid.
    /// @dev    Cannot run while globally paused. Every winner must be a distinct
    ///         funded (non-refunded) depositor. Rounding dust folds into 1st.
    function settle(bytes32 id, address[] calldata orderedWinners)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        Game storage g = _games[id];
        if (g.state != GameState.Locked) revert WrongState();

        uint256 depth = g.payoutBps.length;
        if (orderedWinners.length != depth) revert WinnerCountMismatch();

        uint256 pot = g.pot;
        uint256 rake = (pot * g.rakeBps) / BPS_DENOMINATOR;
        uint256 prizePool = pot - rake;

        uint256[] memory amounts = new uint256[](depth);
        uint256 assigned;
        for (uint256 i = 0; i < depth; i++) {
            address w = orderedWinners[i];
            if (!funded[id][w] || refunded[id][w]) revert WinnerNotFunded();
            // Winners-must-be-approved: a funded wallet can only be paid if the
            // separate approver added it to this game's allowlist. This is the
            // mitigation that stops a compromised operator (which can settle)
            // from paying its own deposited wallet - it cannot approve itself.
            if (!approvedWinner[id][w]) revert WinnerNotApproved(w);
            for (uint256 j = 0; j < i; j++) {
                if (orderedWinners[j] == w) revert DuplicateWinner();
            }
            uint256 amt = (prizePool * g.payoutBps[i]) / BPS_DENOMINATOR;
            amounts[i] = amt;
            assigned += amt;
        }
        // Fold integer-division dust into 1st place so the pot distributes to
        // the last unit. (assigned <= prizePool always, so this never underflows.)
        amounts[0] += (prizePool - assigned);

        for (uint256 i = 0; i < depth; i++) {
            credit[id][orderedWinners[i]] += amounts[i];
        }
        if (rake > 0) {
            credit[id][platform] += rake;
        }

        g.state = GameState.Paid;
        // pot is now fully reassigned into credits; obligations unchanged.
        g.pot = 0;

        emit Settled(id, orderedWinners, amounts, rake, platform);
    }

    /// @notice Make a game refundable before settlement (never filled, aborted).
    function cancelGame(bytes32 id) external onlyOperator {
        Game storage g = _games[id];
        if (g.state != GameState.Funding && g.state != GameState.Locked) revert WrongState();
        g.state = GameState.Cancelled;
        emit GameCancelled(id);
    }

    /// @notice Pre-lock kick + full refund of a single player (caught a cheater
    ///         or a bad entry after they paid but before start). Pushes the
    ///         refund; if the target is USDC-blacklisted, cancel the game instead.
    function refundPlayer(bytes32 id, address player) external onlyOperator nonReentrant {
        Game storage g = _games[id];
        if (g.state != GameState.Funding) revert WrongState();
        if (refunded[id][player]) revert AlreadyRefunded();
        if (!funded[id][player]) revert NotFunded();

        uint256 fee = g.entryFee;
        funded[id][player] = false;
        refunded[id][player] = true;
        // A refunded player is no longer an eligible winner.
        approvedWinner[id][player] = false;
        g.fundedCount -= 1;
        g.pot -= fee;
        usdcObligations -= fee;

        usdc.safeTransfer(player, fee);
        emit PlayerRefunded(id, player, fee);
    }

    /// @notice Global emergency stop: halts settlement and makes every active
    ///         game refundable via `withdraw`.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the rake recipient. Does not affect already-credited rake.
    function setPlatform(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit PlatformUpdated(platform, next);
        platform = next;
    }

    /// @notice Recover tokens sent directly to the contract (not via deposit).
    ///         For USDC this can never touch tracked pots or credits: only the
    ///         balance above `usdcObligations` is removable.
    function rescueStrayTokens(address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(usdc)) {
            uint256 free = usdc.balanceOf(address(this)) - usdcObligations;
            if (amount > free) revert ProtectedFunds();
        }
        IERC20(token).safeTransfer(to, amount);
        emit StrayTokensRescued(token, to, amount);
    }

    // ── Player: money in / out ───────────────────────────────────────────────

    /// @notice Deposit the exact entry fee in one transaction using an EIP-2612
    ///         permit signature (no separate approve). Works for EOA wallets;
    ///         smart-contract wallets without 2612 support use `deposit` after
    ///         a normal approve.
    /// @param value permit allowance (>= entryFee).
    function depositWithPermit(
        bytes32 id,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        Game storage g = _games[id];
        if (value < g.entryFee) revert InsufficientPermitValue();
        // Tolerate a griefer front-running the permit: if the allowance is
        // already set, the permit call reverting must not brick the deposit.
        try IERC20Permit(address(usdc))
            .permit(msg.sender, address(this), value, deadline, v, r, s) {}
            catch {}
        _deposit(id, g);
    }

    /// @notice Deposit the exact entry fee after a prior ERC-20 approve. Fallback
    ///         path for wallets without EIP-2612 permit support.
    function deposit(bytes32 id) external nonReentrant whenNotPaused {
        _deposit(id, _games[id]);
    }

    function _deposit(bytes32 id, Game storage g) private {
        if (g.state != GameState.Funding) revert WrongState();
        if (funded[id][msg.sender]) revert AlreadyFunded();
        // A refunded seat cannot silently re-fund. This closes an edge flow
        // where a wallet that was refunded (kicked pre-lock, or self-withdrew)
        // could deposit again. The approver can deliberately re-admit it by
        // calling setApproved(id, wallet, true), which clears this flag.
        if (refunded[id][msg.sender]) revert AlreadyRefunded();
        if (g.fundedCount >= g.cap) revert GameFull();

        uint256 fee = g.entryFee;
        funded[id][msg.sender] = true;
        g.fundedCount += 1;
        g.pot += fee;
        usdcObligations += fee;

        usdc.safeTransferFrom(msg.sender, address(this), fee);
        emit Deposited(id, msg.sender, fee);
    }

    /// @notice Pull a full refund. Allowed only when the game is cancelled,
    ///         globally paused, or the dead-man window has elapsed on a locked
    ///         but unsettled game.
    function withdraw(bytes32 id) external nonReentrant {
        Game storage g = _games[id];
        if (refunded[id][msg.sender]) revert AlreadyRefunded();
        if (!funded[id][msg.sender]) revert NotFunded();
        if (!_refundable(g)) revert NotRefundable();

        uint256 fee = g.entryFee;
        funded[id][msg.sender] = false;
        refunded[id][msg.sender] = true;
        // A refunded player is no longer an eligible winner.
        approvedWinner[id][msg.sender] = false;
        // Reduce the pot when it is still meaningful (funding/locked). Post-Paid
        // withdraw is impossible (settle zeroes funded->credit path), so pot is
        // only ever decremented here for pre-settlement refund states.
        if (g.pot >= fee) {
            g.pot -= fee;
        }
        usdcObligations -= fee;

        usdc.safeTransfer(msg.sender, fee);
        emit Withdrawn(id, msg.sender, fee);
    }

    /// @notice Winners and the platform pull their credited balance after
    ///         settlement.
    function claim(bytes32 id) external nonReentrant {
        uint256 amount = credit[id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        credit[id][msg.sender] = 0;
        usdcObligations -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getGame(bytes32 id)
        external
        view
        returns (
            GameState state,
            uint256 entryFee,
            uint32 cap,
            uint32 fundedCount,
            uint16 rakeBps,
            uint256 pot,
            uint64 lockedAt,
            uint16[] memory payoutBps
        )
    {
        Game storage g = _games[id];
        return
            (g.state, g.entryFee, g.cap, g.fundedCount, g.rakeBps, g.pot, g.lockedAt, g.payoutBps);
    }

    function payoutBpsOf(bytes32 id) external view returns (uint16[] memory) {
        return _games[id].payoutBps;
    }

    function claimable(bytes32 id, address account) external view returns (uint256) {
        return credit[id][account];
    }

    /// @notice Whether the dead-man window has elapsed on a locked game.
    function deadmanElapsed(bytes32 id) external view returns (bool) {
        Game storage g = _games[id];
        return g.state == GameState.Locked && block.timestamp >= g.lockedAt + DEADMAN_DURATION;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _refundable(Game storage g) private view returns (bool) {
        if (g.state == GameState.Cancelled) return true;
        if (paused() && (g.state == GameState.Funding || g.state == GameState.Locked)) return true;
        if (g.state == GameState.Locked && block.timestamp >= g.lockedAt + DEADMAN_DURATION) {
            return true;
        }
        return false;
    }

    function _validatePayout(uint16[] calldata payoutBps_, uint32 cap) private pure {
        uint256 len = payoutBps_.length;
        if (len == 0 || len > cap) revert BadPayoutSplit();
        uint256 sum;
        for (uint256 i = 0; i < len; i++) {
            if (payoutBps_[i] == 0) revert BadPayoutSplit();
            sum += payoutBps_[i];
        }
        if (sum != BPS_DENOMINATOR) revert BadPayoutSplit();
    }

    // ── UUPS ───────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
