import { BigNumber, constants } from "@ethereum-waffle/provider/node_modules/ethers";
import { formatEther, parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import hre from "hardhat";
import {
    TestMultiRewardsBasePoolV2,
    TestMultiRewardsBasePoolV2__factory,
    TestERC20,
    TestERC20__factory,
    TimeLockNonTransferablePool,
    TimeLockNonTransferablePool__factory
} from "../../typechain";
import TimeTraveler from "../../utils/TimeTraveler";


const TOKEN_NAME = "Staked Token";
const TOKEN_SYMBOL = "STKN";
const ESCROW_PORTION = parseEther("0.6");
const ESCROW_DURATION = 60 * 60 * 24 * 365; // 1 year

const NEW_ESCROW_PORTION = parseEther("1.0");
const NEW_ESCROW_DURATION = 60 * 10;

const INITIAL_MINT = parseEther("1000000000");


describe("BasePool - MultiRewardsV2", function () {
    this.timeout(300000000);

    let deployer: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let basePool: TestMultiRewardsBasePoolV2;
    let escrowPool1: TimeLockNonTransferablePool;
    let escrowPool2: TimeLockNonTransferablePool;
    let escrowPool3: TimeLockNonTransferablePool;
    let depositToken: TestERC20;
    let rewardToken1: TestERC20;
    let rewardToken2: TestERC20;
    let rewardToken3: TestERC20;

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

        const testTokenFactory = new TestERC20__factory(deployer);

        depositToken = (await testTokenFactory.deploy("Deposit Token", "DPST")).connect(account1);
        rewardToken1 = (await testTokenFactory.deploy("Reward Token 1", "RWRD1")).connect(account1);
        rewardToken2 = (await testTokenFactory.deploy("Reward Token 2", "RWRD3")).connect(account1);
        rewardToken3 = (await testTokenFactory.deploy("Reward Token 3", "RWRD3")).connect(account1);

        // mint tokens for testing
        await depositToken.mint(account1.address, INITIAL_MINT);
        await depositToken.mint(account2.address, INITIAL_MINT);

        await rewardToken1.mint(account1.address, INITIAL_MINT);
        await rewardToken1.mint(account2.address, INITIAL_MINT);

        await rewardToken2.mint(account1.address, INITIAL_MINT);
        await rewardToken2.mint(account2.address, INITIAL_MINT);

        const timeLockPoolFactory = new TimeLockNonTransferablePool__factory(deployer);
        escrowPool1 = await timeLockPoolFactory.deploy(
            "Escrow Pool 1",
            "ESCRW1",
            rewardToken1.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION
        );

        escrowPool2 = await timeLockPoolFactory.deploy(
            "Escrow Pool 2",
            "ESCRW2",
            rewardToken2.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION
        );

        escrowPool3 = await timeLockPoolFactory.deploy(
            "Escrow Pool 3",
            "ESCRW3",
            rewardToken3.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION
        );

        const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);
        basePool = await testBasePoolFactory.deploy(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            depositToken.address,
            [rewardToken1.address, rewardToken2.address],
            [escrowPool1.address, escrowPool2.address],
            [ESCROW_PORTION, ESCROW_PORTION],
            [ESCROW_DURATION, ESCROW_DURATION]
        );

        // connect account1 to all contracts
        depositToken = depositToken.connect(account1);
        rewardToken1 = rewardToken1.connect(account1);
        rewardToken2 = rewardToken2.connect(account1);
        escrowPool1 = escrowPool1.connect(account1);
        escrowPool2 = escrowPool2.connect(account1);
        basePool = basePool.connect(account1);

        await timeTraveler.snapshot();
    });

    beforeEach(async () => {
        await timeTraveler.revertSnapshot();
    });

    describe("addRewardToken", async () => {
        it("Should fail when not admin (deployer)", async () => {
            await expect(basePool.addRewardToken(rewardToken3.address, escrowPool3.address, ESCROW_PORTION, ESCROW_DURATION)).to.be.revertedWith("MultiRewardsBasePoolV2: only admin");
        });

        it("Should not add rewards when token are already in the reward list", async () => {
            expect(await basePool.rewardTokensLength()).to.eq(2);
            await basePool.connect(deployer).addRewardToken(rewardToken1.address, escrowPool3.address, ESCROW_PORTION, ESCROW_DURATION);
            expect(await basePool.rewardTokensLength()).to.eq(2);
            expect(await basePool.escrowPools(rewardToken1.address)).to.eq(escrowPool1.address);
        });

        it("Should work", async () => {
            expect(await basePool.rewardTokensLength()).to.eq(2);
            await basePool.connect(deployer).addRewardToken(rewardToken3.address, escrowPool3.address, ESCROW_PORTION, ESCROW_DURATION);
            expect(await basePool.rewardTokensLength()).to.eq(3);
            expect(await basePool.escrowPools(rewardToken3.address)).to.eq(escrowPool3.address);
            expect(await basePool.escrowPortions(rewardToken3.address)).to.eq(ESCROW_PORTION);
            expect(await basePool.escrowDurations(rewardToken3.address)).to.eq(ESCROW_DURATION);
        });
    });

    describe("updateRewardToken", async () => {
        it("Should fail when not admin (deployer)", async () => {
            await expect(basePool.updateRewardToken(rewardToken3.address, escrowPool3.address, ESCROW_PORTION, ESCROW_DURATION)).to.be.revertedWith("MultiRewardsBasePoolV2: only admin");
        });

        it("Should not update rewards when token are not already in the reward list", async () => {
            await expect(basePool.connect(deployer).updateRewardToken(rewardToken3.address, escrowPool3.address, ESCROW_PORTION, ESCROW_DURATION))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateRewardToken: reward token not in the list");
        });

        it("Should work", async () => {
            expect(await basePool.rewardTokensLength()).to.eq(2);
            await basePool.connect(deployer).updateRewardToken(rewardToken1.address, escrowPool3.address, NEW_ESCROW_PORTION, NEW_ESCROW_DURATION);
            expect(await basePool.rewardTokensLength()).to.eq(2);
            expect(await basePool.escrowPools(rewardToken1.address)).to.eq(escrowPool3.address);
            expect(await basePool.escrowPortions(rewardToken1.address)).to.eq(NEW_ESCROW_PORTION);
            expect(await basePool.escrowDurations(rewardToken1.address)).to.eq(NEW_ESCROW_DURATION);
        });
    });

    describe("updateEscrowPool", async () => {
        it("Should fail when not admin (deployer)", async () => {
            await expect(basePool.updateEscrowPool(rewardToken3.address, escrowPool3.address)).to.be.revertedWith("MultiRewardsBasePoolV2: only admin");
        });

        it("Should not update escrowPool when token are not already in the reward list", async () => {
            await expect(basePool.connect(deployer).updateEscrowPool(rewardToken3.address, escrowPool3.address))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateEscrowPool: reward token not in the list");
        });

        it("Should not update escrowPool when escrowPool are not set", async () => {
            await expect(basePool.connect(deployer).updateEscrowPool(rewardToken2.address, constants.AddressZero))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateEscrowPool: escrowPool must be set");
        });

        it("Should work", async () => {
            expect(await basePool.escrowPools(rewardToken1.address)).to.eq(escrowPool1.address);
            await basePool.connect(deployer).updateEscrowPool(rewardToken1.address, escrowPool3.address);
            expect(await basePool.escrowPools(rewardToken1.address)).to.eq(escrowPool3.address);
            expect(await rewardToken1.allowance(basePool.address, escrowPool1.address)).to.eq(0);
            expect(await rewardToken1.allowance(basePool.address, escrowPool3.address)).to.eq(constants.MaxUint256);
        });
    });

    describe("updateEscrowPortion", async () => {
        it("Should fail when not admin (deployer)", async () => {
            await expect(basePool.updateEscrowPortion(rewardToken1.address, "100000000000000000")).to.be.revertedWith("MultiRewardsBasePoolV2: only admin");
        });

        it("Should not update escrowPortion when token are not already in the reward list", async () => {
            await expect(basePool.connect(deployer).updateEscrowPortion(rewardToken3.address, "100000000000000000"))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateEscrowPortion: reward token not in the list");
        });

        it("Should not update escrowPortion when escrowPortion is greater than 1e18", async () => {
            await expect(basePool.connect(deployer).updateEscrowPortion(rewardToken1.address, "10000000000000000000"))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateEscrowPortion: cannot escrow more than 100%");
        });

        it("Should work", async () => {
            expect(await basePool.escrowPortions(rewardToken1.address)).to.eq(ESCROW_PORTION);
            await basePool.connect(deployer).updateEscrowPortion(rewardToken1.address, NEW_ESCROW_PORTION);
            expect(await basePool.escrowPortions(rewardToken1.address)).to.eq(NEW_ESCROW_PORTION);
        });
    });

    describe("updateEscrowDuration", async () => {
        it("Should fail when not admin (deployer)", async () => {
            await expect(basePool.updateEscrowDuration(rewardToken1.address, NEW_ESCROW_DURATION)).to.be.revertedWith("MultiRewardsBasePoolV2: only admin");
        });

        it("Should not update escrowDuration when token are not already in the reward list", async () => {
            await expect(basePool.connect(deployer).updateEscrowDuration(rewardToken3.address, NEW_ESCROW_DURATION))
                .to.be.revertedWith("MultiRewardsBasePoolV2.updateEscrowDuration: reward token not in the list");
        });

        it("Should work", async () => {
            expect(await basePool.escrowDurations(rewardToken1.address)).to.eq(ESCROW_DURATION);
            await basePool.connect(deployer).updateEscrowDuration(rewardToken1.address, NEW_ESCROW_DURATION);
            expect(await basePool.escrowDurations(rewardToken1.address)).to.eq(NEW_ESCROW_DURATION);
        });
    });

    describe("distributeRewards", async () => {
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("100");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_2 = parseEther("200");

        const BASE_POOL_MINT_AMOUNT = parseEther("1337");
        let pointsMultiplier: BigNumber;

        before(async () => {
            pointsMultiplier = await basePool.POINTS_MULTIPLIER();
        });

        beforeEach(async () => {
            await rewardToken1.approve(basePool.address, constants.MaxUint256);
            await rewardToken2.approve(basePool.address, constants.MaxUint256);
        });

        it("Should fail when there are no shares", async () => {
            await expect(basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1)).to.be.revertedWith("AbstractRewards._distributeRewards: total share supply is zero");
        });

        it("Should fail when tokens are not approved", async () => {
            await rewardToken1.approve(basePool.address, 0);
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await expect(basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1)).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("Should fail when tokens are not in the reward token list", async () => {
            await depositToken.approve(basePool.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await expect(basePool.distributeRewards(depositToken.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1)).to.be.revertedWith("MultiRewardsBasePoolV2.distributeRewards: reward token not in the list");
        });

        it("Should work", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);

            const pointsPerShareBefore1 = await basePool.pointsPerShare(rewardToken1.address);
            const rewardToken1BalanceBefore = await rewardToken1.balanceOf(basePool.address);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            const rewardToken1BalanceAfter = await rewardToken1.balanceOf(basePool.address);
            const pointsPerShareAfter1 = await basePool.pointsPerShare(rewardToken1.address);

            expect(rewardToken1BalanceAfter).to.eq(rewardToken1BalanceBefore.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1));
            expect(pointsPerShareAfter1).to.eq(pointsPerShareBefore1.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.mul(pointsMultiplier).div(BASE_POOL_MINT_AMOUNT)));

            const pointsPerShareBefore2 = await basePool.pointsPerShare(rewardToken2.address);
            const rewardToken2BalanceBefore = await rewardToken2.balanceOf(basePool.address);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);
            const rewardToken2BalanceAfter = await rewardToken2.balanceOf(basePool.address);
            const pointsPerShareAfter2 = await basePool.pointsPerShare(rewardToken2.address);

            expect(rewardToken2BalanceAfter).to.eq(rewardToken2BalanceBefore.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2));
            expect(pointsPerShareAfter2).to.eq(pointsPerShareBefore2.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.mul(pointsMultiplier).div(BASE_POOL_MINT_AMOUNT)));
        });
    });

    describe("claimRewards", async () => {
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_11 = parseEther("100");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_12 = parseEther("1834.9");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_13 = parseEther("838383.848448");

        const BASE_POOL_MINT_AMOUNT = parseEther("1337");

        let pointsMultiplier: BigNumber;

        before(async () => {
            pointsMultiplier = await basePool.POINTS_MULTIPLIER();
        });

        beforeEach(async () => {
            await rewardToken1.approve(basePool.address, constants.MaxUint256);
            await rewardToken2.approve(basePool.address, constants.MaxUint256);
        });

        it("Should fail when tries to claim tokens not in the reward token list", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await expect(basePool.claimRewards(depositToken.address, account2.address)).to.be.revertedWith("MultiRewardsBasePoolV2.claimRewards: reward token not in the list");
        });

        it("First claim single holder", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);

            const account1RewardToken1BalanceBefore = await rewardToken1.balanceOf(account1.address);
            const account2RewardToken1BalanceBefore = await rewardToken1.balanceOf(account2.address);
            await basePool.claimAll(account2.address);
            const account1RewardToken1BalanceAfter = await rewardToken1.balanceOf(account1.address);
            const account2RewardToken1BalanceAfter = await rewardToken1.balanceOf(account2.address);
            const account2EscrowedRewards1 = await escrowPool1.getTotalDeposit(account2.address);
            const account1WithdrawableRewards1After = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account1WithdrawnRewards1After = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);

            const expectedEscrowed = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.mul(ESCROW_PORTION).div(constants.WeiPerEther);

            expect(account2RewardToken1BalanceAfter).to.eq(account2RewardToken1BalanceBefore.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.sub(expectedEscrowed)));
            expect(account2EscrowedRewards1).to.eq(expectedEscrowed.sub(1));
            expect(account1WithdrawableRewards1After).to.eq(0);
            expect(account1WithdrawnRewards1After).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.sub(1)); // minor integer math rounding error
            expect(account1RewardToken1BalanceAfter).to.eq(account1RewardToken1BalanceBefore);
        });

        it("Claim multiple holders", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.mint(account2.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);

            await basePool.claimAll(account3.address);
            await basePool.connect(account2).claimAll(account4.address);
            const account3RewardTokenBalanceAfter = await rewardToken1.balanceOf(account3.address);
            const account4RewardTokenBalanceAfter = await rewardToken1.balanceOf(account4.address);
            const account3EscrowedRewards = await escrowPool1.getTotalDeposit(account3.address);
            const account4EscrowedRewards = await escrowPool1.getTotalDeposit(account4.address);
            const account1WithdrawableRewards1After = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account1WithdrawnRewards1After = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawableRewardsAfter = await basePool.withdrawableRewardsOf(rewardToken1.address, account2.address);
            const account2WithdrawnRewardsAfter = await basePool.withdrawnRewardsOf(rewardToken1.address, account2.address);

            const rewardPerAccount = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.div("2");
            const expectedEscrowed = rewardPerAccount.mul(ESCROW_PORTION).div(constants.WeiPerEther); // subtract 1

            expect(account3RewardTokenBalanceAfter).to.eq(rewardPerAccount.sub(expectedEscrowed));
            expect(account4RewardTokenBalanceAfter).to.eq(rewardPerAccount.sub(expectedEscrowed));
            expect(account3EscrowedRewards).to.eq(expectedEscrowed.sub(1));
            expect(account4EscrowedRewards).to.eq(expectedEscrowed.sub(1));
            expect(account1WithdrawableRewards1After).to.eq(0);
            expect(account1WithdrawnRewards1After).to.eq(rewardPerAccount.sub(1));
            expect(account2WithdrawableRewardsAfter).to.eq(0);
            expect(account2WithdrawnRewardsAfter).to.eq(rewardPerAccount.sub(1));
        });

        it("Multiple claims, distribution and holders", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);
            await basePool.mint(account2.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_12);

            // claim and exit account 1
            await basePool.claimAll(account3.address);
            await basePool.burn(account1.address, BASE_POOL_MINT_AMOUNT);

            // Distribute some more to account 2
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_13);
            await basePool.connect(account2).claimAll(account4.address);
            await basePool.burn(account2.address, BASE_POOL_MINT_AMOUNT);

            const account1WithdrawnRewards = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawnRewards = await basePool.withdrawnRewardsOf(rewardToken1.address, account2.address);
            const account1WithdrawableRewards = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawableRewards = await basePool.withdrawableRewardsOf(rewardToken1.address, account2.address);

            const account3EscrowedRewards = await escrowPool1.getTotalDeposit(account3.address);
            const account4EscrowedRewards = await escrowPool1.getTotalDeposit(account4.address);
            const account3RewardBalance = await rewardToken1.balanceOf(account3.address);
            const account4RewardBalance = await rewardToken1.balanceOf(account4.address);

            // Full amount of first distribution, half of second
            const expectedAccount1Rewards = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_12.div(2));
            // Half of second amount, full amount of third
            const expectedAccount2Rewards = DISTRIBUTION_AMOUNT_REWARD_TOKEN_12.div(2).add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_13);
            // account 3 takes rewards of account1
            const expectedAccount3Escrow = expectedAccount1Rewards.mul(ESCROW_PORTION).div(constants.WeiPerEther);
            const expectedAccount4Escrow = expectedAccount2Rewards.mul(ESCROW_PORTION).div(constants.WeiPerEther);

            expect(account1WithdrawnRewards).to.eq(expectedAccount1Rewards.sub(1)); // subtract one to handle integer math rounding
            expect(account2WithdrawnRewards).to.eq(expectedAccount2Rewards.sub(1)); // subtract one to handle integer math rounding
            expect(account1WithdrawableRewards).to.eq(0);
            expect(account2WithdrawableRewards).to.eq(0);
            expect(account3EscrowedRewards).to.eq(expectedAccount3Escrow.sub(1));
            expect(account4EscrowedRewards).to.eq(expectedAccount4Escrow.sub(1));
            expect(account3RewardBalance).to.eq(expectedAccount1Rewards.sub(account3EscrowedRewards).sub(1));
            expect(account4RewardBalance).to.eq(expectedAccount2Rewards.sub(account4EscrowedRewards).sub(1));
        });

        it("Zero escrow", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [0, 0],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.claimAll(account3.address);

            const account3RewardTokenBalance = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewards = await escrowPool1.getTotalDeposit(account3.address);

            expect(account3RewardTokenBalance).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
            expect(account3EscrowedRewards).to.eq(0);
        });

        it("Full escrow", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [constants.WeiPerEther, constants.WeiPerEther],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.claimAll(account3.address);

            const account3RewardTokenBalance = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewards = await escrowPool1.getTotalDeposit(account3.address);

            expect(account3RewardTokenBalance).to.eq(0);
            expect(account3EscrowedRewards).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
        });
    });

    describe("claimRewards - multiple", async () => {
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_11 = parseEther("300");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_12 = parseEther("1834.9");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_13 = parseEther("838383.848448");

        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_21 = parseEther("600");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_22 = parseEther("700");
        const DISTRIBUTION_AMOUNT_REWARD_TOKEN_23 = parseEther("800");

        const BASE_POOL_MINT_AMOUNT = parseEther("1337");

        let pointsMultiplier: BigNumber;

        before(async () => {
            pointsMultiplier = await basePool.POINTS_MULTIPLIER();
        });

        beforeEach(async () => {
            await rewardToken1.approve(basePool.address, constants.MaxUint256);
            await rewardToken2.approve(basePool.address, constants.MaxUint256);
        });

        it("First claim single holder", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_21);

            const account1RewardToken1BalanceBefore = await rewardToken1.balanceOf(account1.address);
            const account2RewardToken1BalanceBefore = await rewardToken1.balanceOf(account2.address);
            const account1RewardToken2BalanceBefore = await rewardToken2.balanceOf(account1.address);
            const account2RewardToken2BalanceBefore = await rewardToken2.balanceOf(account2.address);
            await basePool.claimAll(account2.address);
            const account1RewardToken1BalanceAfter = await rewardToken1.balanceOf(account1.address);
            const account2RewardToken1BalanceAfter = await rewardToken1.balanceOf(account2.address);
            const account1RewardToken2BalanceAfter = await rewardToken2.balanceOf(account1.address);
            const account2RewardToken2BalanceAfter = await rewardToken2.balanceOf(account2.address);

            const account2EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account2.address);
            const account2EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account2.address);
            const account1WithdrawableRewardToken1After = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account1WithdrawableRewardToken2After = await basePool.withdrawableRewardsOf(rewardToken2.address, account1.address);

            const account1WithdrawnRewardsToken1After = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);
            const account1WithdrawnRewardsToken2After = await basePool.withdrawnRewardsOf(rewardToken2.address, account1.address);

            const expectedEscrowedRewardToken1 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.mul(ESCROW_PORTION).div(constants.WeiPerEther);
            const expectedEscrowedRewardToken2 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_21.mul(ESCROW_PORTION).div(constants.WeiPerEther);

            expect(account2RewardToken1BalanceAfter).to.eq(account2RewardToken1BalanceBefore.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.sub(expectedEscrowedRewardToken1)));
            expect(account2RewardToken2BalanceAfter).to.eq(account2RewardToken2BalanceBefore.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_21.sub(expectedEscrowedRewardToken2)));

            expect(account2EscrowedRewardToken1).to.eq(expectedEscrowedRewardToken1.sub(1));
            expect(account2EscrowedRewardToken2).to.eq(expectedEscrowedRewardToken2.sub(1));

            expect(account1WithdrawableRewardToken1After).to.eq(0);
            expect(account1WithdrawableRewardToken2After).to.eq(0);

            expect(account1WithdrawnRewardsToken1After).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.sub(1)); // minor integer math rounding error
            expect(account1WithdrawnRewardsToken2After).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_21.sub(1)); // minor integer math rounding error
            expect(account1RewardToken1BalanceAfter).to.eq(account1RewardToken1BalanceBefore);
            expect(account1RewardToken2BalanceAfter).to.eq(account1RewardToken2BalanceBefore);

        });

        it("Claim multiple holders", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.mint(account2.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_21);

            await basePool.claimAll(account3.address);
            await basePool.connect(account2).claimAll(account4.address);
            const account3RewardToken1BalanceAfter = await rewardToken1.balanceOf(account3.address);
            const account4RewardTokenBalanceAfter = await rewardToken1.balanceOf(account4.address);
            const account3EscrowedRewards = await escrowPool1.getTotalDeposit(account3.address);
            const account4EscrowedRewards = await escrowPool1.getTotalDeposit(account4.address);
            const account1WithdrawableRewards1After = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account1WithdrawnRewards1After = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawableRewardsAfter = await basePool.withdrawableRewardsOf(rewardToken1.address, account2.address);
            const account2WithdrawnRewardsAfter = await basePool.withdrawnRewardsOf(rewardToken1.address, account2.address);

            const rewardPerAccount = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.div("2");
            const expectedEscrowed = rewardPerAccount.mul(ESCROW_PORTION).div(constants.WeiPerEther); // subtract 1

            expect(account3RewardToken1BalanceAfter).to.eq(rewardPerAccount.sub(expectedEscrowed));
            expect(account4RewardTokenBalanceAfter).to.eq(rewardPerAccount.sub(expectedEscrowed));
            expect(account3EscrowedRewards).to.eq(expectedEscrowed.sub(1));
            expect(account4EscrowedRewards).to.eq(expectedEscrowed.sub(1));
            expect(account1WithdrawableRewards1After).to.eq(0);
            expect(account1WithdrawnRewards1After).to.eq(rewardPerAccount.sub(1));
            expect(account2WithdrawableRewardsAfter).to.eq(0);
            expect(account2WithdrawnRewardsAfter).to.eq(rewardPerAccount.sub(1));
        });

        it("Multiple claims, distribution and holders", async () => {
            await basePool.mint(account1.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_11);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_21);
            await basePool.mint(account2.address, BASE_POOL_MINT_AMOUNT);
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_12);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_22);

            // claim and exit account 1
            await basePool.claimAll(account3.address);
            await basePool.burn(account1.address, BASE_POOL_MINT_AMOUNT);

            // Distribute some more to account 2
            await basePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_13);
            await basePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_23);
            await basePool.connect(account2).claimAll(account4.address);
            await basePool.burn(account2.address, BASE_POOL_MINT_AMOUNT);

            const account1WithdrawnRewardToken1 = await basePool.withdrawnRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawnRewardToken1 = await basePool.withdrawnRewardsOf(rewardToken1.address, account2.address);
            const account1WithdrawableRewardToken1 = await basePool.withdrawableRewardsOf(rewardToken1.address, account1.address);
            const account2WithdrawableRewardToken1 = await basePool.withdrawableRewardsOf(rewardToken1.address, account2.address);

            const account1WithdrawnRewardToken2 = await basePool.withdrawnRewardsOf(rewardToken2.address, account1.address);
            const account2WithdrawnRewardToken2 = await basePool.withdrawnRewardsOf(rewardToken2.address, account2.address);
            const account1WithdrawableRewardToken2 = await basePool.withdrawableRewardsOf(rewardToken2.address, account1.address);
            const account2WithdrawableRewardToken2 = await basePool.withdrawableRewardsOf(rewardToken2.address, account2.address);

            const account3EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account3.address);
            const account4EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account4.address);
            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const account4RewardToken1Balance = await rewardToken1.balanceOf(account4.address);

            const account3EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account3.address);
            const account4EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account4.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const account4RewardToken2Balance = await rewardToken2.balanceOf(account4.address);

            // Full amount of first distribution, half of second
            const expectedAccount1RewardToken1 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_11.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_12.div(2));
            const expectedAccount1RewardToken2 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_21.add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_22.div(2));

            // Half of second amount, full amount of third
            const expectedAccount2RewardToken1 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_12.div(2).add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_13);
            const expectedAccount2RewardToken2 = DISTRIBUTION_AMOUNT_REWARD_TOKEN_22.div(2).add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_23);

            // account 3 takes rewards of account1
            const expectedAccount3EscrowRewardToken1 = expectedAccount1RewardToken1.mul(ESCROW_PORTION).div(constants.WeiPerEther);
            const expectedAccount4EscrowRewardToken1 = expectedAccount2RewardToken1.mul(ESCROW_PORTION).div(constants.WeiPerEther);

            const expectedAccount3EscrowRewardToken2 = expectedAccount1RewardToken2.mul(ESCROW_PORTION).div(constants.WeiPerEther);
            const expectedAccount4EscrowRewardToken2 = expectedAccount2RewardToken2.mul(ESCROW_PORTION).div(constants.WeiPerEther);

            expect(account1WithdrawnRewardToken1).to.eq(expectedAccount1RewardToken1.sub(1)); // subtract one to handle integer math rounding
            expect(account2WithdrawnRewardToken1).to.eq(expectedAccount2RewardToken1.sub(1)); // subtract one to handle integer math rounding
            expect(account1WithdrawableRewardToken1).to.eq(0);
            expect(account2WithdrawableRewardToken1).to.eq(0);
            expect(account3EscrowedRewardToken1).to.eq(expectedAccount3EscrowRewardToken1.sub(1));
            expect(account4EscrowedRewardToken1).to.eq(expectedAccount4EscrowRewardToken1.sub(1));
            expect(account3RewardToken1Balance).to.eq(expectedAccount1RewardToken1.sub(account3EscrowedRewardToken1).sub(1));
            expect(account4RewardToken1Balance).to.eq(expectedAccount2RewardToken1.sub(account4EscrowedRewardToken1).sub(1));

            expect(account1WithdrawnRewardToken2).to.eq(expectedAccount1RewardToken2.sub(1)); // subtract one to handle integer math rounding
            expect(account2WithdrawnRewardToken2).to.eq(expectedAccount2RewardToken2.sub(1)); // subtract one to handle integer math rounding
            expect(account1WithdrawableRewardToken2).to.eq(0);
            expect(account2WithdrawableRewardToken2).to.eq(0);
            expect(account3EscrowedRewardToken2).to.eq(expectedAccount3EscrowRewardToken2.sub(1));
            expect(account4EscrowedRewardToken2).to.eq(expectedAccount4EscrowRewardToken2.sub(1));
            expect(account3RewardToken2Balance).to.eq(expectedAccount1RewardToken2.sub(account3EscrowedRewardToken2).sub(1));
            expect(account4RewardToken2Balance).to.eq(expectedAccount2RewardToken2.sub(account4EscrowedRewardToken2).sub(1));
        });

        it("Zero escrow", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_2 = parseEther("3");

            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [0, 0],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);

            await tempBasePool.claimAll(account3.address);

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);

            const account3EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account3.address);
            const account3EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account3.address);

            expect(account3RewardToken1Balance).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
            expect(account3EscrowedRewardToken1).to.eq(0);

            expect(account3RewardToken2Balance).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.sub(1));
            expect(account3EscrowedRewardToken2).to.eq(0);
        });

        it("Full escrow", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_2 = parseEther("3");

            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [constants.WeiPerEther, constants.WeiPerEther],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);

            await tempBasePool.claimAll(account3.address);

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account3.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const account3EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account3.address);

            expect(account3RewardToken1Balance).to.eq(0);
            expect(account3EscrowedRewardToken1).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
            expect(account3RewardToken2Balance).to.eq(0);
            expect(account3EscrowedRewardToken2).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.sub(1));
        });

        it("Update escrow portion", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_2 = parseEther("3");

            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [constants.WeiPerEther, constants.WeiPerEther],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);

            await tempBasePool.claimAll(account3.address);

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account3.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const account3EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account3.address);

            expect(account3RewardToken1Balance).to.eq(0);
            expect(account3EscrowedRewardToken1).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
            expect(account3RewardToken2Balance).to.eq(0);
            expect(account3EscrowedRewardToken2).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.sub(1));



            await tempBasePool.connect(deployer).updateEscrowPortion(rewardToken1.address, "500000000000000000");
            await tempBasePool.connect(deployer).updateEscrowPortion(rewardToken2.address, "500000000000000000");

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);

            await tempBasePool.claimAll(account3.address);

            const account3RewardToken1Balance2 = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewardToken12 = await escrowPool1.getTotalDeposit(account3.address);
            const account3RewardToken2Balance2 = await rewardToken2.balanceOf(account3.address);
            const account3EscrowedRewardToken22 = await escrowPool2.getTotalDeposit(account3.address);

            expect(account3RewardToken1Balance2).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.div(2));
            expect(account3EscrowedRewardToken12).to.eq((DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1)).add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.div(2)));
            expect(account3RewardToken2Balance2).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.div(2));
            expect(account3EscrowedRewardToken22).to.eq((DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.sub(1)).add(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.div(2)));

        });

        it("Update escrow duration", async () => {
            const testBasePoolFactory = new TestMultiRewardsBasePoolV2__factory(deployer);

            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_1 = parseEther("1");
            const DISTRIBUTION_AMOUNT_REWARD_TOKEN_2 = parseEther("3");

            const MINT_AMOUNT = parseEther("10");

            const tempBasePool = (await testBasePoolFactory.deploy(
                TOKEN_NAME,
                TOKEN_SYMBOL,
                depositToken.address,
                [rewardToken1.address, rewardToken2.address],
                [escrowPool1.address, escrowPool2.address],
                [constants.WeiPerEther, constants.WeiPerEther],
                [ESCROW_DURATION, ESCROW_DURATION]
            )).connect(account1);

            await rewardToken1.approve(tempBasePool.address, constants.MaxUint256);
            await rewardToken2.approve(tempBasePool.address, constants.MaxUint256);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);


            await tempBasePool.claimAll(account3.address);
            const blockTimestamp1 = (await hre.ethers.provider.getBlock("latest")).timestamp;

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const account3EscrowedRewardToken1 = await escrowPool1.getTotalDeposit(account3.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const account3EscrowedRewardToken2 = await escrowPool2.getTotalDeposit(account3.address);

            expect(account3RewardToken1Balance).to.eq(0);
            expect(account3EscrowedRewardToken1).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1));
            expect(account3RewardToken2Balance).to.eq(0);
            expect(account3EscrowedRewardToken2).to.eq(DISTRIBUTION_AMOUNT_REWARD_TOKEN_2.sub(1));



            await tempBasePool.connect(deployer).updateEscrowDuration(rewardToken1.address, 0);
            await tempBasePool.connect(deployer).updateEscrowDuration(rewardToken2.address, 0);

            await tempBasePool.mint(account1.address, MINT_AMOUNT);
            await tempBasePool.distributeRewards(rewardToken1.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_1);
            await tempBasePool.distributeRewards(rewardToken2.address, DISTRIBUTION_AMOUNT_REWARD_TOKEN_2);


            await tempBasePool.claimAll(account3.address);
            const blockTimestamp2 = (await hre.ethers.provider.getBlock("latest")).timestamp;

            const deposits = await escrowPool1.getDepositsOf(account3.address);

            expect(deposits[0].amount).to.gte(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1)).and.lte(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.add(1));
            expect(deposits[0].start).to.eq(blockTimestamp1);
            expect(deposits[0].end).to.eq(BigNumber.from(blockTimestamp1).add(ESCROW_DURATION));

            expect(deposits[1].amount).to.gte(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.sub(1)).and.lte(DISTRIBUTION_AMOUNT_REWARD_TOKEN_1.add(1));
            expect(deposits[1].start).to.eq(blockTimestamp2);
            expect(deposits[1].end).to.eq(BigNumber.from(blockTimestamp2).add(10 * 60));

        });
    });
});