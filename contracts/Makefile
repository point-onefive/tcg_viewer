.PHONY: setup build test coverage fmt snapshot deploy-sepolia deploy-base upgrade-sepolia upgrade-base

# One-time (or CI) dependency install. lib/ is gitignored, so reinstall here.
setup:
	forge install --no-git --shallow \
		foundry-rs/forge-std \
		OpenZeppelin/openzeppelin-contracts@v5.1.0 \
		OpenZeppelin/openzeppelin-contracts-upgradeable@v5.1.0

build:
	forge build

test:
	forge test -vv

coverage:
	forge coverage --no-match-coverage "test|script"

fmt:
	forge fmt

snapshot:
	forge snapshot

# Requires .env with PRIVATE_KEY, OWNER, PLATFORM, USDC and the RPC/etherscan
# vars referenced in foundry.toml. See .env.example.
deploy-sepolia:
	forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv

deploy-base:
	forge script script/Deploy.s.sol --rpc-url base --broadcast --verify -vvvv

# Ship a bug fix / enhancement to the existing proxy. Requires PROXY=0x... and
# a PRIVATE_KEY that is the proxy owner. State + proxy address are preserved.
upgrade-sepolia:
	forge script script/Upgrade.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv

upgrade-base:
	forge script script/Upgrade.s.sol --rpc-url base --broadcast --verify -vvvv
