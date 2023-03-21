import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants } from "ethers";
import hre from "hardhat";
import {
    TestERC20,
    TestERC20__factory,
    TimeLockNonTransferablePool,
    TimeLockNonTransferablePool__factory,
    MultiRewardsTimeLockNonTransferablePoolV2,
    MultiRewardsTimeLockNonTransferablePoolV2__factory
} from "../../typechain";
import TimeTraveler from "../../utils/TimeTraveler";

const ZERO_ADDRESS = '0x' + '0'.repeat(40)

const ESCROW_DURATION = 60 * 60 * 24 * 365;
const ESCROW_PORTION = parseEther("0.77");
const MAX_BONUS = parseEther("1");
const MAX_LOCK_DURATION = 60 * 60 * 24 * 365;
const INITIAL_MINT = parseEther("1000000");
const GRACE_PERIOD = 86400 * 7;
const KICK_REWARD_INCENTIVE = 100;

describe("TimeLockNonTransferablePool - MultiRewards V2", function () {

    let deployer: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let timeLockPool: MultiRewardsTimeLockNonTransferablePoolV2;
    let escrowPool1: TimeLockNonTransferablePool;
    let escrowPool2: TimeLockNonTransferablePool;
    let depositToken: TestERC20;
    let rewardToken1: TestERC20;
    let rewardToken2: TestERC20;

    const timeTraveler = new TimeTraveler(hre.network.provider);

    before(async () => {
        [
            deployer,
            account1,
            account2,
            account3,
            account4,
            ...signers
        ] = await hre.ethers.getSigners();

        const testTokenFactory = await new TestERC20__factory(deployer);

        depositToken = await testTokenFactory.deploy("Deposit Token", "DPST");
        rewardToken1 = await testTokenFactory.deploy("Reward Token 1", "RWRD1");
        rewardToken2 = await testTokenFactory.deploy("Reward Token 2", "RWRD2");

        await depositToken.mint(account1.address, INITIAL_MINT);
        await rewardToken1.mint(account1.address, INITIAL_MINT);
        await rewardToken2.mint(account1.address, INITIAL_MINT);

        const timeLockPoolFactory = new MultiRewardsTimeLockNonTransferablePoolV2__factory(deployer);
        const escrowPoolFactory = new TimeLockNonTransferablePool__factory(deployer);

        escrowPool1 = await escrowPoolFactory.deploy(
            "ESCROW",
            "ESCRW",
            rewardToken1.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION
        );

        escrowPool2 = await escrowPoolFactory.deploy(
            "ESCROW",
            "ESCRW",
            rewardToken2.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION
        );

        timeLockPool = await timeLockPoolFactory.deploy(
            "Staking Pool",
            "STK",
            depositToken.address,
            [rewardToken1.address, rewardToken2.address],
            [escrowPool1.address, escrowPool2.address],
            [ESCROW_PORTION, ESCROW_PORTION],
            [ESCROW_DURATION, ESCROW_DURATION],
            MAX_BONUS,
            600,
            MAX_LOCK_DURATION
        );


        // connect account1 to all contracts
        timeLockPool = timeLockPool.connect(account1);
        escrowPool1 = escrowPool1.connect(account1);
        escrowPool2 = escrowPool2.connect(account1);
        depositToken = depositToken.connect(account1);
        rewardToken1 = rewardToken1.connect(account1);
        rewardToken2 = rewardToken2.connect(account1);

        await depositToken.approve(timeLockPool.address, constants.MaxUint256);

        await timeTraveler.snapshot();
    })

    beforeEach(async () => {
        await timeTraveler.revertSnapshot();
    })

    describe("transfer", async () => {
        const DEPOSIT_AMOUNT = parseEther("10");

        it("transfer", async () => {
            await expect(timeLockPool.transfer(account3.address, DEPOSIT_AMOUNT)).to.be.revertedWith("NON_TRANSFERABLE");
        });

        it("transferFrom", async () => {
            await expect(timeLockPool.transferFrom(account1.address, account3.address, DEPOSIT_AMOUNT)).to.be.revertedWith("NON_TRANSFERABLE");
        });
    });

    describe("deposit", async () => {

        const DEPOSIT_AMOUNT = parseEther("10");

        it("Depositing with no lock should lock it for 10 minutes to prevent flashloans", async () => {
            await timeLockPool.deposit(DEPOSIT_AMOUNT, 0, account3.address);
            const minLockDuration = await timeLockPool.minLockDuration();
            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const duration = await deposit.end.sub(deposit.start);
            expect(duration).to.eq(minLockDuration);
        });

        it("Deposit with no lock", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.deposit(DEPOSIT_AMOUNT, 0, account3.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const depositCount = await timeLockPool.getDepositsOfLength(account3.address);
            const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address)
            const minLockDuration = await timeLockPool.minLockDuration();

            const multiplier = await timeLockPool.getMultiplier(minLockDuration);

            expect(deposit.amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposit.start).to.eq(blockTimestamp);
            expect(deposit.end).to.eq(BigNumber.from(blockTimestamp).add(minLockDuration));
            expect(depositCount).to.eq(1);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT);
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(multiplier).div(constants.WeiPerEther));
            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT));
        });
        it("Trying to lock for longer than max duration should lock for max duration", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account3.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const depositCount = await timeLockPool.getDepositsOfLength(account3.address);
            const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address);

            expect(deposit.amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposit.start).to.eq(blockTimestamp);
            expect(deposit.end).to.eq(BigNumber.from(blockTimestamp).add(MAX_LOCK_DURATION));
            expect(depositCount).to.eq(1);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT);
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));

            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT));
        })
        it("Multiple deposits", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account3.address);
            const blockTimestamp1 = (await hre.ethers.provider.getBlock("latest")).timestamp;
            await timeLockPool.deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account3.address);
            const blockTimestamp2 = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposits = await timeLockPool.getDepositsOf(account3.address);
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address);

            expect(deposits[0].amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposits[0].start).to.eq(blockTimestamp1);
            expect(deposits[0].end).to.eq(BigNumber.from(blockTimestamp1).add(MAX_LOCK_DURATION));

            expect(deposits[1].amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposits[1].start).to.eq(blockTimestamp2);
            expect(deposits[1].end).to.eq(BigNumber.from(blockTimestamp2).add(MAX_LOCK_DURATION));

            expect(deposits.length).to.eq(2);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT.mul(2));
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(2).mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));

            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT.mul(2)));
        });
        it("Should fail when transfer fails", async () => {
            await depositToken.approve(timeLockPool.address, 0);
            await expect(timeLockPool.deposit(DEPOSIT_AMOUNT, 0, account3.address)).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });
    });

    describe("batchDeposit", async () => {

        const DEPOSIT_AMOUNT = parseEther("10");

        it("Deposit with mismatch amounts and durations should fail", async () => {
            await expect(timeLockPool.batchDeposit([DEPOSIT_AMOUNT, DEPOSIT_AMOUNT], [0], [account1.address, account3.address]))
                .to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2.batchDeposit: amounts and durations length mismatch");
        })

        it("Deposit with mismatch amounts and receivers should fail", async () => {
            await expect(timeLockPool.batchDeposit([DEPOSIT_AMOUNT, DEPOSIT_AMOUNT], [0, 0], [account3.address]))
                .to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2.batchDeposit: amounts and receivers length mismatch");
        })

        it("Deposit with 0 amounts should fail", async () => {
            await expect(timeLockPool.batchDeposit([0], [0], [account3.address]))
                .to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2._deposit: cannot deposit 0");
        })

        it("Deposit with 0 address receiver should fail", async () => {
            await expect(timeLockPool.batchDeposit([DEPOSIT_AMOUNT], [0], [ZERO_ADDRESS]))
                .to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2._deposit: receiver cannot be zero address");
        })

        it("Deposit with no lock should lock it for 10 minutes to prevent flashloans", async () => {
            await timeLockPool.batchDeposit([DEPOSIT_AMOUNT], [0], [account3.address]);
            const minLockDuration = await timeLockPool.minLockDuration();
            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const duration = await deposit.end.sub(deposit.start);
            expect(duration).to.eq(minLockDuration);
        });

        it("Deposit with no lock", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.batchDeposit([DEPOSIT_AMOUNT], [0], [account3.address]);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const depositCount = await timeLockPool.getDepositsOfLength(account3.address);
            const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address)
            const minLockDuration = await timeLockPool.minLockDuration();

            const multiplier = await timeLockPool.getMultiplier(minLockDuration);

            expect(deposit.amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposit.start).to.eq(blockTimestamp);
            expect(deposit.end).to.eq(BigNumber.from(blockTimestamp).add(minLockDuration));
            expect(depositCount).to.eq(1);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT);
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(multiplier).div(constants.WeiPerEther));
            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT));
        });
        it("Trying to lock for longer than max duration should lock for max duration", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.batchDeposit([DEPOSIT_AMOUNT], [constants.MaxUint256], [account3.address]);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposit = await timeLockPool.depositsOf(account3.address, 0);
            const depositCount = await timeLockPool.getDepositsOfLength(account3.address);
            const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address);

            expect(deposit.amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposit.start).to.eq(blockTimestamp);
            expect(deposit.end).to.eq(BigNumber.from(blockTimestamp).add(MAX_LOCK_DURATION));
            expect(depositCount).to.eq(1);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT);
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));

            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT));
        })
        it("Multiple deposits", async () => {
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            await timeLockPool.batchDeposit([DEPOSIT_AMOUNT, DEPOSIT_AMOUNT], [constants.MaxUint256, constants.MaxUint256], [account3.address, account3.address]);
            const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);

            const deposits = await timeLockPool.getDepositsOf(account3.address);
            const totalDeposit = await timeLockPool.getTotalDeposit(account3.address);
            const timeLockPoolBalance = await timeLockPool.balanceOf(account3.address);

            expect(deposits[0].amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposits[0].start).to.eq(blockTimestamp);
            expect(deposits[0].end).to.eq(BigNumber.from(blockTimestamp).add(MAX_LOCK_DURATION));

            expect(deposits[1].amount).to.eq(DEPOSIT_AMOUNT);
            expect(deposits[1].start).to.eq(blockTimestamp);
            expect(deposits[1].end).to.eq(BigNumber.from(blockTimestamp).add(MAX_LOCK_DURATION));

            expect(deposits.length).to.eq(2);
            expect(totalDeposit).to.eq(DEPOSIT_AMOUNT.mul(2));
            expect(timeLockPoolBalance).to.eq(DEPOSIT_AMOUNT.mul(2).mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));

            expect(depositTokenBalanceAfter).to.eq(depositTokenBalanceBefore.sub(DEPOSIT_AMOUNT.mul(2)));
        });
        it("Should fail when transfer fails", async () => {
            await depositToken.approve(timeLockPool.address, 0);
            await expect(timeLockPool.batchDeposit([DEPOSIT_AMOUNT], [0], [account3.address])).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });
    });

    describe("withdraw", async () => {
        const DEPOSIT_AMOUNT = parseEther("176.378");

        beforeEach(async () => {
            await timeLockPool.deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account1.address);
        });

        it("Withdraw before expiry should fail", async () => {
            await expect(timeLockPool.withdraw(0, account1.address)).to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2.withdraw: too soon");
        });

        it("Should work", async () => {
            await timeTraveler.increaseTime(MAX_LOCK_DURATION);
            await timeLockPool.withdraw(0, account3.address);

            const timeLockPoolBalance = await timeLockPool.balanceOf(account1.address);
            const totalDeposit = await timeLockPool.getTotalDeposit(account1.address);
            const depositTokenBalance = await depositToken.balanceOf(account3.address);

            expect(timeLockPoolBalance).to.eq(0);
            expect(totalDeposit).to.eq(0);
            expect(depositTokenBalance).to.eq(DEPOSIT_AMOUNT);
        });
    });
    describe("Update grace period", function () {
        const NEW_GRACE_PERIOD = 86400 * 14;
        it("cannot updateGracePeriod if not admin", async function () {
            await expect(timeLockPool.connect(account1).updateGracePeriod(NEW_GRACE_PERIOD)).to.be.revertedWith(
                "MultiRewardsBasePoolV2: only admin"
            );
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await timeLockPool.ADMIN_ROLE();
                await timeLockPool.connect(deployer).grantRole(adminRole, account1.address);
            })
            it("can successfully update grace period", async function () {
                expect(await timeLockPool.gracePeriod()).to.eq(GRACE_PERIOD);
                await timeLockPool.connect(account1).updateGracePeriod(NEW_GRACE_PERIOD);
                expect(await timeLockPool.gracePeriod()).to.eq(NEW_GRACE_PERIOD);
            })
            it("can emit correct event for new fees", async function () {
                await expect(timeLockPool.connect(account1).updateGracePeriod(NEW_GRACE_PERIOD))
                    .to.emit(timeLockPool, 'GracePeriodUpdated')
                    .withArgs(NEW_GRACE_PERIOD);
            })
        })
    });
    describe("Update kick reward incentive", function () {
        const NEW_KICK_REWARD_INCENTIVE = 200;
        it("cannot updateKickRewardIncentive if not admin", async function () {
            await expect(timeLockPool.connect(account1).updateKickRewardIncentive(NEW_KICK_REWARD_INCENTIVE)).to.be.revertedWith(
                "MultiRewardsBasePoolV2: only admin"
            );
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await timeLockPool.ADMIN_ROLE();
                await timeLockPool.connect(deployer).grantRole(adminRole, account1.address);
            })
            it("cannot update kick reward incentive to more than 100%", async function () {
                await expect(timeLockPool.connect(account1).updateKickRewardIncentive(10001)).to.be.revertedWith(
                    "MultiRewardsTimeLockNonTransferablePoolV2.updateKickRewardIncentive: kick reward incentive cannot be greater than 100%"
                );
            })
            it("can successfully update kick reward incentive", async function () {
                expect(await timeLockPool.kickRewardIncentive()).to.eq(KICK_REWARD_INCENTIVE);
                await timeLockPool.connect(account1).updateKickRewardIncentive(NEW_KICK_REWARD_INCENTIVE);
                expect(await timeLockPool.kickRewardIncentive()).to.eq(NEW_KICK_REWARD_INCENTIVE);
            })
            it("can emit correct event for new fees", async function () {
                await expect(timeLockPool.connect(account1).updateKickRewardIncentive(NEW_KICK_REWARD_INCENTIVE))
                    .to.emit(timeLockPool, 'KickRewardIncentiveUpdated')
                    .withArgs(NEW_KICK_REWARD_INCENTIVE);
            })
        })
    });
    describe("Kick expired deposit", function () {
        const DEPOSIT_AMOUNT = parseEther("2");
        beforeEach(async () => {
            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account1.address);
        });

        it("cannot kick for zero address", async () => {
            await expect(timeLockPool.connect(account2).kickExpiredDeposit(ZERO_ADDRESS, 0)).to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2._processExpiredDeposit: account cannot be zero address");
        });
        it("cannot kick for non-exist deposit", async () => {
            await expect(timeLockPool.connect(account2).kickExpiredDeposit(account1.address, 1)).to.be.revertedWith("reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)");
        })
        it("cannot kick for non-expired deposit", async () => {
            await expect(timeLockPool.connect(account2).kickExpiredDeposit(account1.address, 0)).to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2._processExpiredDeposit: too soon");
        })
        it("will not receive any rewards when in grace period", async () => {
            await timeTraveler.increaseTime(MAX_LOCK_DURATION);

            const timeLockPoolBalanceBefore = await timeLockPool.balanceOf(account1.address);
            const depositCountBefore = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceBefore = await depositToken.balanceOf(account2.address);

            expect(depositCountBefore).to.eq(1);

            await timeLockPool.connect(account2).kickExpiredDeposit(account1.address, 0);

            expect(await timeLockPool.getDepositsOfLength(account1.address)).to.eq(0);

            const timeLockPoolBalanceAfter = await timeLockPool.balanceOf(account1.address);
            const depositCountAfter = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceAfter = await depositToken.balanceOf(account2.address);

            expect(depositCountAfter).to.eq(0);
            expect(timeLockPoolBalanceBefore.sub(timeLockPoolBalanceAfter)).to.eq(DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).to.eq(DEPOSIT_AMOUNT);
            expect(kickerDepositTokenBalanceAfter.sub(kickerDepositTokenBalanceBefore)).to.eq(0);
        })
        it("will receive rewards based on the incentive percentage after grace period", async () => {
            await timeTraveler.increaseTime(MAX_LOCK_DURATION + GRACE_PERIOD + 1);

            const timeLockPoolBalanceBefore = await timeLockPool.balanceOf(account1.address);
            const depositCountBefore = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceBefore = await depositToken.balanceOf(account2.address);

            expect(depositCountBefore).to.eq(1);

            await timeLockPool.connect(account2).kickExpiredDeposit(account1.address, 0);

            expect(await timeLockPool.getDepositsOfLength(account1.address)).to.eq(0);

            const timeLockPoolBalanceAfter = await timeLockPool.balanceOf(account1.address);
            const depositCountAfter = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceAfter = await depositToken.balanceOf(account2.address);
            const expectedKickerReward = DEPOSIT_AMOUNT.mul(KICK_REWARD_INCENTIVE).div(10000);

            expect(depositCountAfter).to.eq(0);
            expect(timeLockPoolBalanceBefore.sub(timeLockPoolBalanceAfter)).to.eq(DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther));
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).to.eq(DEPOSIT_AMOUNT.sub(expectedKickerReward));
            expect(kickerDepositTokenBalanceAfter.sub(kickerDepositTokenBalanceBefore)).to.eq(expectedKickerReward);
        })
    });
    describe("Process expired deposit", function () {
        const DEPOSIT_AMOUNT = parseEther("2");
        const NEW_DURATION = 86400 * 30;

        beforeEach(async () => {
            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account1.address);
        });
        it("cannot process non-exist deposit", async () => {
            await expect(timeLockPool.connect(account1).processExpiredLock(1, constants.MaxUint256)).to.be.revertedWith("reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)");
        })
        it("cannot process non-expired deposit", async () => {
            await expect(timeLockPool.connect(account1).processExpiredLock(0, NEW_DURATION)).to.be.revertedWith("MultiRewardsTimeLockNonTransferablePoolV2._processExpiredDeposit: too soon");
        })
        it("will relock all amount when in grace period", async () => {
            await timeTraveler.increaseTime(MAX_LOCK_DURATION);

            const timeLockPoolBalanceBefore = await timeLockPool.balanceOf(account1.address);
            const depositCountBefore = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceBefore = await depositToken.balanceOf(account2.address);

            const depositsBefore = await timeLockPool.getDepositsOf(account1.address);
            const totalDepositBefore = await timeLockPool.getTotalDeposit(account1.address);

            expect(depositCountBefore).to.eq(1);
            expect(totalDepositBefore).to.eq(DEPOSIT_AMOUNT);
            expect(depositsBefore[0].amount).to.eq(DEPOSIT_AMOUNT);
            expect(depositsBefore[0].end.sub(depositsBefore[0].start)).to.eq(MAX_LOCK_DURATION);

            await timeLockPool.connect(account1).processExpiredLock(0, NEW_DURATION);

            const timeLockPoolBalanceAfter = await timeLockPool.balanceOf(account1.address);
            const depositCountAfter = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);
            const kickerDepositTokenBalanceAfter = await depositToken.balanceOf(account2.address);

            const depositsAfter = await timeLockPool.getDepositsOf(account1.address);
            const totalDepositAfter = await timeLockPool.getTotalDeposit(account1.address);

            expect(depositCountAfter).to.eq(1);
            const expectedBurnedShare = DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther);
            const expectedMintedShare = DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS.mul(NEW_DURATION).div(MAX_LOCK_DURATION))).div(constants.WeiPerEther);
            expect(timeLockPoolBalanceBefore.sub(timeLockPoolBalanceAfter)).to.eq(expectedBurnedShare.sub(expectedMintedShare));
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).to.eq(0);
            expect(kickerDepositTokenBalanceAfter.sub(kickerDepositTokenBalanceBefore)).to.eq(0);
            expect(totalDepositAfter).to.eq(DEPOSIT_AMOUNT);
            expect(depositsAfter[0].amount).to.eq(DEPOSIT_AMOUNT);
            expect(depositsAfter[0].end.sub(depositsAfter[0].start)).to.eq(NEW_DURATION);
        })
        it("will receive rewards based on the incentive percentage and relock the rest after grace period", async () => {
            await timeTraveler.increaseTime(MAX_LOCK_DURATION + GRACE_PERIOD + 1);

            const timeLockPoolBalanceBefore = await timeLockPool.balanceOf(account1.address);
            const depositCountBefore = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceBefore = await depositToken.balanceOf(account1.address);

            const depositsBefore = await timeLockPool.getDepositsOf(account1.address);
            const totalDepositBefore = await timeLockPool.getTotalDeposit(account1.address);

            expect(depositCountBefore).to.eq(1);
            expect(totalDepositBefore).to.eq(DEPOSIT_AMOUNT);
            expect(depositsBefore[0].amount).to.eq(DEPOSIT_AMOUNT);
            expect(depositsBefore[0].end.sub(depositsBefore[0].start)).to.eq(MAX_LOCK_DURATION);

            await timeLockPool.connect(account1).processExpiredLock(0, NEW_DURATION);

            const timeLockPoolBalanceAfter = await timeLockPool.balanceOf(account1.address);
            const depositCountAfter = await timeLockPool.getDepositsOfLength(account1.address);
            const depositTokenBalanceAfter = await depositToken.balanceOf(account1.address);
            const expectedKickerReward = DEPOSIT_AMOUNT.mul(KICK_REWARD_INCENTIVE).div(10000);

            const depositsAfter = await timeLockPool.getDepositsOf(account1.address);
            const totalDepositAfter = await timeLockPool.getTotalDeposit(account1.address);
            const expectedRelockAmount = DEPOSIT_AMOUNT.sub(expectedKickerReward);

            expect(depositCountAfter).to.eq(1);
            const expectedBurnedShare = DEPOSIT_AMOUNT.mul(constants.WeiPerEther.add(MAX_BONUS)).div(constants.WeiPerEther);
            const expectedMintedShare = expectedRelockAmount.mul(constants.WeiPerEther.add(MAX_BONUS.mul(NEW_DURATION).div(MAX_LOCK_DURATION))).div(constants.WeiPerEther);
            expect(timeLockPoolBalanceBefore.sub(timeLockPoolBalanceAfter)).to.eq(expectedBurnedShare.sub(expectedMintedShare));
            expect(totalDepositAfter).to.eq(expectedRelockAmount);
            expect(depositsAfter[0].amount).to.eq(expectedRelockAmount);
            expect(depositsAfter[0].end.sub(depositsAfter[0].start)).to.eq(NEW_DURATION);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).to.eq(expectedKickerReward);
        })
    });
});