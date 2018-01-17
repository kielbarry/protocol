/*global artifacts, contract, describe, it, beforeEach*/

const expect = require('chai').expect;
const BigNumber = require('bignumber.js');

const Proxy = artifacts.require("Proxy");
const TestToken = artifacts.require("TestToken");
const { expectThrow } = require('../helpers/ExpectHelper');

contract('Proxy', function(accounts) {
  const [delay, gracePeriod] = [new BigNumber('123456'), new BigNumber('1234567')];
  const num1 = new BigNumber(12);
  let contract, tokenA;

  beforeEach(async () => {
    [contract, tokenA] = await Promise.all([
      Proxy.new(delay, gracePeriod),
      TestToken.new(),
      TestToken.new()
    ]);
  });

  describe('Constructor', () => {
    it('sets constants correctly', async () => {
      const [contractDelay, contractGracePeriodExpiration, owner] = await Promise.all([
        contract.accessDelay.call(),
        contract.gracePeriodExpiration.call(),
        contract.owner.call()
      ]);

      expect(contractDelay.equals(delay)).to.be.true;
      // ?? How to check this? Don't know block timestamp of contract creation
      expect(contractGracePeriodExpiration.gt(new BigNumber(0))).to.be.true;
      expect(owner.toLowerCase()).to.eq(accounts[0].toLowerCase());
    });
  });

  describe('#grantTransferAuthorization', () => {
    it('requires access to grant transfer authorization', async () => {
      expectThrow(() => contract.grantTransferAuthorization(accounts[2], { from: accounts[1] }));

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;
    });

    it('immediately grants transfer authorization', async () => {
      let hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;

      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });

      hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.true;
    });

    it('does nothing if address is already authorized', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.true;
    });
  });

  describe('#revokeTransferAuthorization', () => {
    it('requires access to revoke transfer authorization', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });

      // A random address should not work
      expectThrow(() => contract.revokeTransferAuthorization(accounts[2], { from: accounts[3] }));
      // Nor should the contract owner work
      expectThrow(() => contract.revokeTransferAuthorization(accounts[2]));
      // Nor should an address with transfer authorization work
      expectThrow(() => contract.revokeTransferAuthorization(accounts[4], { from: accounts[2] }));

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.true;
    });

    it('immediately revokes transfer authorization', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await contract.revokeTransferAuthorization(accounts[2], { from: accounts[1] });

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;
    });

    it('does nothing if address is not authorized', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.revokeTransferAuthorization(accounts[2], { from: accounts[1] });

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;
    });
  });

  describe('#ownerRevokeTransferAuthorization', () => {
    it('only allows owner to call', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      // An address with access should not be able to call
      expectThrow(
        () => contract.ownerRevokeTransferAuthorization(accounts[2], { from: accounts[1] })
      );
      // Nor should a random address
      expectThrow(
        () => contract.ownerRevokeTransferAuthorization(accounts[2], { from: accounts[3] })
      );

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.true;
    });

    it('immediately revokes transfer authorization', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await contract.ownerRevokeTransferAuthorization(accounts[2]);

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;
    });

    it('does nothing if address is not authorized', async () => {
      await contract.ownerRevokeTransferAuthorization(accounts[2]);

      const hasTransferAuth = await contract.transferAuthorized(accounts[2]);
      expect(hasTransferAuth).to.be.false;
    });
  });

  describe('#transfer', () => {
    const holder1 = accounts[4];
    it('only allows transfer authorized address to call', async () => {
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.grantAccess(accounts[1]);
      // An address with access should not be able to call
      expectThrow(
        () => contract.transfer(tokenA.address, holder1, num1, { from: accounts[1] })
      );
      // Nor should a random address
      expectThrow(
        () => contract.transfer(tokenA.address, holder1, num1, { from: accounts[3] })
      );
      // Nor should the owner
      expectThrow(
        () => contract.transfer(tokenA.address, holder1, num1,)
      );

      const balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(num1)).to.be.true;
    });

    it('fails on insufficient holder balance or allowance', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      expectThrow(() => contract.transfer(tokenA.address, holder1, num1, { from: accounts[2] }));

      let balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(new BigNumber(0))).to.be.true;

      await tokenA.issue(num1, { from: holder1 });
      expectThrow(() => contract.transfer(tokenA.address, holder1, num1, { from: accounts[2] }));

      balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(num1)).to.be.true;

      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.transfer(tokenA.address, holder1, num1, { from: accounts[2] });

      let balance2;
      [balance, balance2] = await Promise.all([
        tokenA.balanceOf(holder1),
        tokenA.balanceOf(accounts[2])
      ]);
      expect(balance.equals(new BigNumber(0))).to.be.true;
      expect(balance2.equals(num1)).to.be.true;
    });

    it('sends tokens on sufficient balance/allowance when authorized', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.transfer(tokenA.address, holder1, num1, { from: accounts[2] });

      let balance2, balance;
      [balance, balance2] = await Promise.all([
        tokenA.balanceOf(holder1),
        tokenA.balanceOf(accounts[2])
      ]);
      expect(balance.equals(new BigNumber(0))).to.be.true;
      expect(balance2.equals(num1)).to.be.true;
    });

    it('does not transfer if paused', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.pause();
      expectThrow(() => contract.transfer(tokenA.address, holder1, num1, { from: accounts[2] }));

      const balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(num1)).to.be.true;
    });
  });

  describe('#transferTo', () => {
    const holder1 = accounts[4];
    const recipient = accounts[5];
    it('only allows transfer authorized address to call', async () => {
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.grantAccess(accounts[1]);
      // An address with access should not be able to call
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[1] })
      );
      // Nor should a random address
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[3] })
      );
      // Nor should the owner
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1,)
      );

      const [balance, balance2] = await Promise.all([
        tokenA.balanceOf(holder1),
        tokenA.balanceOf(recipient)
      ]);
      expect(balance.equals(num1)).to.be.true;
      expect(balance2.equals(new BigNumber(0))).to.be.true;
    });

    it('fails on insufficient holder balance or allowance', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[2] })
      );

      let balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(new BigNumber(0))).to.be.true;

      await tokenA.issue(num1, { from: holder1 });
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[2] })
      );

      balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(num1)).to.be.true;

      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[2] });

      let balance2;
      [balance, balance2] = await Promise.all([
        tokenA.balanceOf(holder1),
        tokenA.balanceOf(recipient)
      ]);
      expect(balance.equals(new BigNumber(0))).to.be.true;
      expect(balance2.equals(num1)).to.be.true;
    });

    it('sends tokens on sufficient balance/allowance when authorized', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[2] });

      let balance2, balance;
      [balance, balance2] = await Promise.all([
        tokenA.balanceOf(holder1),
        tokenA.balanceOf(recipient)
      ]);
      expect(balance.equals(new BigNumber(0))).to.be.true;
      expect(balance2.equals(num1)).to.be.true;
    });

    it('does not transfer if paused', async () => {
      await contract.grantAccess(accounts[1]);
      await contract.grantTransferAuthorization(accounts[2], { from: accounts[1] });
      await tokenA.issue(num1, { from: holder1 });
      await tokenA.approve(contract.address, num1, { from: holder1 });
      await contract.pause();
      expectThrow(
        () => contract.transferTo(tokenA.address, holder1, recipient, num1, { from: accounts[2] })
      );

      const balance = await tokenA.balanceOf(holder1);
      expect(balance.equals(num1)).to.be.true;
    });
  });
});