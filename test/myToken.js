const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const initialSupply = 1000000;
const tokenName = "MyToken";
const tokenSymbol = "MYT";

describe("My token tests", function() {
  let myTokenV1;
  let myTokenV2;
  let deployer;
  let userAccount;

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

    it('Should run into an error when executing a function that does not exist', async function () {
      expect(() => myTokenV1.mint(deployer.address, ethers.BigNumber.from(10).pow(18))).to.throw();
    });
  });

  
  describe("V2 tests", function () {
    before(async function () {

      userAccount = (await ethers.getSigners())[1];

      const MyTokenV2 = await ethers.getContractFactory("MyTokenV2");

      myTokenV2 = await upgrades.upgradeProxy(myTokenV1.address, MyTokenV2);


      await myTokenV2.deployed();

    });

    it("Should has the same address, and keep the state as the previous version", async function () {
      const [totalSupplyForNewCongtractVersion, totalSupplyForPreviousVersion] = await Promise.all([
        myTokenV2.totalSupply(),
        myTokenV1.totalSupply(),
      ]);
      expect(myTokenV1.address).to.be.equal(myTokenV2.address);
      expect(totalSupplyForNewCongtractVersion.eq(totalSupplyForPreviousVersion)).to.be.equal(true);
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


});