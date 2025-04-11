EVM

deploy to sepolia

# To load the variables in the .env file

source .env

# To deploy and verify our contract

forge script --chain sepolia script/MessageReceiver.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv --private-key $PRIVATE_KEY
