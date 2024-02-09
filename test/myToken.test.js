const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const initialSupply = 1000000;
const tokenName = "MyToken";
const tokenSymbol = "MYT";

const eip712DomainTypeDefinition = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const metaTxTypeDefinition = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" },
];

function getTypedData(typedDataInput) {
  return {
    types: {
      EIP712Domain: eip712DomainTypeDefinition,
      [typedDataInput.primaryType]: metaTxTypeDefinition,
    },
    primaryType: typedDataInput.primaryType,
    domain: typedDataInput.domainValues,
    message: typedDataInput.messageValues,
  };
}

describe("My token tests", function() {
  let myTokenV1;
  let myTokenV2;
  let myTokenV3;
  let myTokenForwarder;
  let deployer;
  let userAccount;
  let receiverAccount;
  let relayerAccount;

  describe("V1 tests", function () {
    before(async function() {
      const availableSigners = await ethers.getSigners();
      deployer = availableSigners[0];

      const MyToken = await ethers.getContractFactory("MyTokenV1");

      // this.myTokenV1 = await MyToken.deploy(initialSupply);
      myTokenV1 = await upgrades.deployProxy(MyToken, [initialSupply], { kind: "uups" });
      await myTokenV1.deployed();
    });

    it('Should be named MyToken', async function() {
      const fetchedTokenName = await myTokenV1.name();
      expect(fetchedTokenName).to.be.equal(tokenName);
    });

    it('Should have symbol "MYT"', async function() {
      const fetchedTokenSymbol = await myTokenV1.symbol();
      expect(fetchedTokenSymbol).to.be.equal(tokenSymbol);
    });

    it('Should have totalSupply passed in during deployment', async function() {
      const [ fetchedTotalSupply, decimals ] = await Promise.all([
        myTokenV1.totalSupply(),
        myTokenV1.decimals(),
      ]);
      const expectedTotalSupply = ethers.BigNumber.from(initialSupply).mul(ethers.BigNumber.from(10).pow(decimals));
      expect(fetchedTotalSupply.eq(expectedTotalSupply)).to.be.true;
    });
  });

  describe("V2 tests", function () {
    before(async function () {

      userAccount = (await ethers.getSigners())[1];

      const MyTokenV2 = await ethers.getContractFactory("MyTokenV2");

      myTokenV2 = await upgrades.upgradeProxy(myTokenV1.address, MyTokenV2);

      await myTokenV2.deployed();
    });

    it("Should revert when an account other than the owner is trying to mint tokens", async function() {
      const tmpContractRef = await myTokenV2.connect(userAccount);
      try {
        await tmpContractRef.mint(userAccount.address, ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18)));
      } catch (ex) {
        expect(ex.message).to.contain("reverted");
        expect(ex.message).to.contain("Ownable: caller is not the owner");
      }
    });

    it("Should mint tokens when the owner is executing the mint function", async function () {
      const amountToMint = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18)).mul(ethers.BigNumber.from(10));
      const accountAmountBeforeMint = await myTokenV2.balanceOf(deployer.address);
      const totalSupplyBeforeMint = await myTokenV2.totalSupply();
      await myTokenV2.mint(deployer.address, amountToMint);

      const newAccountAmount = await myTokenV2.balanceOf(deployer.address);
      const newTotalSupply = await myTokenV2.totalSupply();
      
      expect(newAccountAmount.eq(accountAmountBeforeMint.add(amountToMint))).to.be.true;
      expect(newTotalSupply.eq(totalSupplyBeforeMint.add(amountToMint))).to.be.true;
    });
  });

  describe("V3 tests", function () {
    
    before(async function () {

      const availableSigners = await ethers.getSigners();
      deployer = availableSigners[0];
      // user account
      userAccount = availableSigners[1];
      // account that will receive the tokens
      receiverAccount = availableSigners[2];
      // account that will act as gas relayer
      relayerAccount = availableSigners[3];

      const MyTokenV3 = await ethers.getContractFactory("MyTokenV3");
      const MyTokenForwarder = await ethers.getContractFactory("MyTokenForwarder");

      // deploying forwarder
      myTokenForwarder = await MyTokenForwarder.deploy();
      await myTokenForwarder.deployed();

      // Deploying token
      myTokenV3 = await upgrades.deployProxy(MyTokenV3, [initialSupply, myTokenForwarder.address], { kind: "uups" });
      await myTokenV3.deployed();
    });

    it("Transfer tokens from account A to B without account A paying for gas fees", async function () {
      // using relayer as the transaction sender when executing contract functions
      const forwarderContractTmpInstance = await myTokenForwarder.connect(relayerAccount);

      const { chainId } = await relayerAccount.provider.getNetwork();
      const userAccountA = deployer;
      const userAccountB = receiverAccount;

      // Getting "user" and relayer ETH balance before transaction
      const userAccountAEthersBeforeTx = await userAccountA.getBalance();
      const relayerAccountEthersBeforeTx = await relayerAccount.getBalance();

      // Getting relayer token balance
      const relayerTokensBeforeTx = await myTokenV3.balanceOf(relayerAccount.address);

      // Getting actual user nonce
      const userACurrentNonce = await myTokenForwarder.getNonce(userAccountA.address);

      const totalAmountToTransfer = ethers.BigNumber.from(1).mul(ethers.BigNumber.from(10).pow(10));

      // Meta transaction values
      const messageValues = {
        from: userAccountA.address, //Using user address
        to: myTokenV3.address, // to token contract address
        nonce: userACurrentNonce.toString(), // actual nonce for user
        data: myTokenV3.interface.encodeFunctionData("transfer", [
          userAccountB.address,
          totalAmountToTransfer,
        ]) // encoding function call for "transfer(address _to, uint256 amount)"
      };


      // Gettting typed Data so our Meta-Tx structura can be signed
      const typedData = getTypedData({
        domainValues: {
          name: "MyTokenForwarder",
          version: "0.0.1",
          chainId: chainId,
          verifyingContract: myTokenForwarder.address,
        },
        primaryType: "MetaTx",
        messageValues,
      });

      // Getting signature for Meta-Tx struct using user keys
      const signedMessage = await ethers.provider.send("eth_signTypedData_v4", [userAccountA.address, typedData]);

      // executing transaction
      await forwarderContractTmpInstance.executeFunction(messageValues, signedMessage);

      // Getting user and relayer ETH balance before transaction
      const userAccountAEthersAfterTx = await userAccountA.getBalance();
      const relayerAccountEthersAfterTx = await relayerAccount.getBalance();

      // Getting user token balance after transaction
      const relayerTokensAfterTx = await myTokenV3.balanceOf(relayerAccount.address);

      // Getting receiver token balance
      const userAccountBtokens = await myTokenV3.balanceOf(userAccountB.address);
      
      // Making sure the receiver got the transferred balance
      expect(userAccountBtokens.eq(totalAmountToTransfer)).to.be.true;

      // Making sure the "user" ETH balance is the same as it was before sending the transaction (it did not have to pay for the transaction fee)
      expect(userAccountAEthersBeforeTx.eq(userAccountAEthersAfterTx)).to.be.true;
      // Making sure the relayer ETH balance decreased because it paid for the transaction fee
      expect(relayerAccountEthersAfterTx.lt(relayerAccountEthersBeforeTx)).to.be.true;
      // Making sure the relayer token balance did not change
      expect(relayerTokensAfterTx.eq(relayerTokensBeforeTx));
      expect(relayerTokensAfterTx.eq(0)).to.be.equal(true);
      expect(relayerTokensBeforeTx.eq(0)).to.be.equal(true);

    });
  });
});