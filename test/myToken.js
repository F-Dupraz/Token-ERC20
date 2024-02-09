const { expect } = require("chai");
const { ethers } = require("hardhat");

const initialSupply = 1000000;
const tokenName = "MyToken";
const tokenSymbol = "MYT";

describe("Plazi token tests", function() {
  before(async function() {
    const availableSigners = await ethers.getSigners();
    this.deployer = availableSigners[0];

    const MyToken = await ethers.getContractFactory("MyToken");
    this.myToken = await MyToken.deploy(initialSupply);
    await this.myToken.deployed();
  });

  it('Should be named MyToken', async function() {
    const fetchedTokenName = await this.myToken.name();
    expect(fetchedTokenName).to.be.equal(tokenName);
  });

  it('Should have symbol "MYT"', async function() {
    const fetchedTokenSymbol = await this.myToken.symbol();
    expect(fetchedTokenSymbol).to.be.equal(tokenSymbol);
  });

  it('Should have totalSupply passed in during deploying', async function() {
    const [ fetchedTotalSupply, decimals ] = await Promise.all([
      this.myToken.totalSupply(),
      this.myToken.decimals(),
    ]);
    const expectedTotalSupply = ethers.BigNumber.from(initialSupply).mul(ethers.BigNumber.from(10).pow(decimals));
    expect(fetchedTotalSupply.eq(expectedTotalSupply)).to.be.true;
  });


});