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
    MultiRewardsTimeLockNonTransferablePoolV3,
    MultiRewardsTimeLockNonTransferablePoolV3__factory,
    TestERC1155,
    TestERC1155__factory,
    BadgeManager,
    BadgeManager__factory
} from "../../typechain";
import TimeTraveler from "../../utils/TimeTraveler";

const ESCROW_DURATION = 60 * 60 * 24 * 365;
const ESCROW_PORTION = parseEther("0.77");
const MAX_BONUS = parseEther("1");
const MAX_LOCK_DURATION = 60 * 60 * 24 * 365;
const INITIAL_MINT = parseEther("1000000");

describe("BadgeManger", function () {

    let deployer: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let timeLockPool: MultiRewardsTimeLockNonTransferablePoolV3;
    let escrowPool1: TimeLockNonTransferablePool;
    let escrowPool2: TimeLockNonTransferablePool;
    let depositToken: TestERC20;
    let rewardToken1: TestERC20;
    let rewardToken2: TestERC20;

    let badgeToken1: TestERC1155;
    let badgeToken2: TestERC1155;
    let badgeToken3: TestERC1155;
    let badgeTokenNotInList: TestERC1155;

    let badgeManager: BadgeManager;

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
        const badgeTokenFactory = await new TestERC1155__factory(deployer);

        depositToken = await testTokenFactory.deploy("Deposit Token", "DPST");
        rewardToken1 = await testTokenFactory.deploy("Reward Token 1", "RWRD1");
        rewardToken2 = await testTokenFactory.deploy("Reward Token 2", "RWRD2");

        badgeToken1 = await badgeTokenFactory.deploy();
        badgeToken2 = await badgeTokenFactory.deploy();
        badgeToken3 = await badgeTokenFactory.deploy();
        badgeTokenNotInList = await badgeTokenFactory.deploy();


        await depositToken.mint(account1.address, INITIAL_MINT);
        await rewardToken1.mint(account1.address, INITIAL_MINT);
        await rewardToken2.mint(account1.address, INITIAL_MINT);

        await depositToken.mint(deployer.address, INITIAL_MINT);
        await rewardToken1.mint(deployer.address, INITIAL_MINT);
        await rewardToken2.mint(deployer.address, INITIAL_MINT);

        await depositToken.mint(account2.address, INITIAL_MINT);

        const timeLockPoolFactory = new MultiRewardsTimeLockNonTransferablePoolV3__factory(deployer);
        const escrowPoolFactory = new TimeLockNonTransferablePool__factory(deployer);
        const badgeManagerFactory = new BadgeManager__factory(deployer);

        badgeManager = await badgeManagerFactory.deploy();


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
            MAX_LOCK_DURATION,
            badgeManager.address
        );


        // connect account1 to all contracts
        timeLockPool = timeLockPool.connect(account1);
        escrowPool1 = escrowPool1.connect(account1);
        escrowPool2 = escrowPool2.connect(account1);
        depositToken = depositToken.connect(account1);
        rewardToken1 = rewardToken1.connect(account1);
        rewardToken2 = rewardToken2.connect(account1);

        await depositToken.approve(timeLockPool.address, constants.MaxUint256);
        await depositToken.connect(account2).approve(timeLockPool.address, constants.MaxUint256);
        await depositToken.connect(deployer).approve(timeLockPool.address, constants.MaxUint256);

        await timeTraveler.snapshot();
    })

    beforeEach(async () => {
        await timeTraveler.revertSnapshot();
    })
    describe("addBadge", function () {

        it("cannot add badge if is not admin", async () => {
            await expect(badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"))).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("cannot add badge if it is already in the list", async () => {
                await badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"));
                await expect(badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"))).to.be.revertedWith("BadgeManager._addBadge: already in badgelist, please try to update");
                await badgeManager.connect(account1).addBadge(badgeToken1.address, 2, parseEther("0.1"));
            })

            it("can successfully add badge", async () => {
                await badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"));

                const badgeBoostedWeight = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight).to.eq(parseEther("0.1"));
            })

            it("can emit correct event for newly added badge", async function () {
                await expect(badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1")))
                    .to.emit(badgeManager, 'BadgeAdded')
                    .withArgs(badgeToken1.address, 1, parseEther("0.1"));
            })
        })
    });
    describe("batchAddBadges", function () {

        it("cannot add badge if is not admin", async () => {
            await expect(badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")])).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("cannot add badge if it is already in the list", async () => {
                await badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")]);
                await expect(badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")])).to.be.revertedWith("BadgeManager._addBadge: already in badgelist, please try to update");
                await badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [2, 2], [parseEther("0.1"), parseEther("0.1")]);
            })

            it("can successfully add badge", async () => {
                await badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")]);

                const badgeBoostedWeight1 = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight1).to.eq(parseEther("0.1"));
                const badgeBoostedWeight2 = await badgeManager.badgesBoostedMapping(badgeToken2.address, 1);
                expect(badgeBoostedWeight2).to.eq(parseEther("0.1"));
            })

        })
    });
    describe("updateBadge", function () {

        it("cannot update badge if is not admin", async () => {
            await expect(badgeManager.connect(account2).updateBadge(badgeToken1.address, 1, parseEther("0.5"))).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("cannot update badge if it is not in the list", async () => {
                await expect(badgeManager.connect(account1).updateBadge(badgeToken1.address, 1, parseEther("0.5"))).to.be.revertedWith("BadgeManager._updateBadge: badgeAddress not in badgeList, please try to add first");
            })

            it("can successfully update badge", async () => {
                await badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"));

                const badgeBoostedWeight = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight).to.eq(parseEther("0.1"));

                await badgeManager.connect(account1).updateBadge(badgeToken1.address, 1, parseEther("0.5"));
                const badgeBoostedWeight2 = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight2).to.eq(parseEther("0.5"));
            })

            it("can emit correct event for newly updated badge", async function () {
                await badgeManager.connect(account1).addBadge(badgeToken1.address, 1, parseEther("0.1"));

                await expect(badgeManager.connect(account1).updateBadge(badgeToken1.address, 1, parseEther("0.5")))
                    .to.emit(badgeManager, 'BadgeUpdated')
                    .withArgs(badgeToken1.address, 1, parseEther("0.5"));
            })
        })
    });
    describe("batchUpdateBadges", function () {

        it("cannot update badges if is not admin", async () => {
            await expect(badgeManager.connect(account1).batchUpdateBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")])).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("cannot update badge if it is not already in the list", async () => {
                await expect(badgeManager.connect(account1).batchUpdateBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")])).to.be.revertedWith("BadgeManager._updateBadge: badgeAddress not in badgeList, please try to add first");
            })

            it("can successfully update badge", async () => {
                await badgeManager.connect(account1).batchAddBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.1"), parseEther("0.1")]);

                let badgeBoostedWeight1 = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight1).to.eq(parseEther("0.1"));
                let badgeBoostedWeight2 = await badgeManager.badgesBoostedMapping(badgeToken2.address, 1);
                expect(badgeBoostedWeight2).to.eq(parseEther("0.1"));

                await badgeManager.connect(account1).batchUpdateBadges([badgeToken1.address, badgeToken2.address], [1, 1], [parseEther("0.4"), parseEther("0.5")]);

                badgeBoostedWeight1 = await badgeManager.badgesBoostedMapping(badgeToken1.address, 1);
                expect(badgeBoostedWeight1).to.eq(parseEther("0.4"));
                badgeBoostedWeight2 = await badgeManager.badgesBoostedMapping(badgeToken2.address, 1);
                expect(badgeBoostedWeight2).to.eq(parseEther("0.5"));
            })

        })
    });
    describe("addIneligibleList", function () {

        it("cannot add ineligible list if is not admin", async () => {
            await expect(badgeManager.connect(account1).addIneligibleList(account4.address)).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("can successfully add ineligible list", async () => {
                await badgeManager.connect(account1).addIneligibleList(account4.address);
                expect(await badgeManager.connect(account1).ineligibleList(account4.address)).to.be.true;
            })

            it("cannot add ineligible list if it is already in the list", async () => {
                await badgeManager.connect(account1).addIneligibleList(account4.address);
                expect(await badgeManager.connect(account1).ineligibleList(account4.address)).to.be.true;
                await expect(badgeManager.connect(account1).addIneligibleList(account4.address)).to.be.revertedWith("BadgeManager.addIneligibleList: address already in ineligiblelist, please try to update");
            })

            it("can emit correct event for newly added ineligible list", async function () {
                await expect(badgeManager.connect(account1).addIneligibleList(account4.address))
                    .to.emit(badgeManager, 'IneligibleListAdded')
                    .withArgs(account4.address);
            })
        })
    });
    describe("removeIneligibleList", function () {

        it("cannot remove ineligible list if is not admin", async () => {
            await expect(badgeManager.connect(account1).removeIneligibleList(account4.address)).to.be.revertedWith("BadgeManager: only admin");
        })

        context("With admin role", function () {
            beforeEach(async () => {
                let adminRole = await badgeManager.ADMIN_ROLE();
                await badgeManager.connect(deployer).grantRole(adminRole, account1.address);
            })

            it("can successfully remove ineligible list", async () => {
                await badgeManager.connect(account1).addIneligibleList(account4.address);
                expect(await badgeManager.connect(account1).ineligibleList(account4.address)).to.be.true;

                await badgeManager.connect(account1).removeIneligibleList(account4.address);
                expect(await badgeManager.connect(account1).ineligibleList(account4.address)).to.be.false;
            })

            it("cannot remove ineligible list if it is not already in the list", async () => {
                await expect(badgeManager.connect(account1).removeIneligibleList(account4.address)).to.be.revertedWith("BadgeManager.removeIneligibleList: address not in ineligiblelist, please try to add first");
            })

            it("can emit correct event for newly removed ineligible list", async function () {
                await badgeManager.connect(account1).addIneligibleList(account4.address);
                await expect(badgeManager.connect(account1).removeIneligibleList(account4.address))
                    .to.emit(badgeManager, 'IneligibleListRemoved')
                    .withArgs(account4.address);
            })
        })
    });
    describe("delegateBadgeTo", function () {
        const BOOSTED_NUMBER_BADGE_1 = parseEther("0.1");
        const BOOSTED_NUMBER_BADGE_2 = parseEther("0.5");
        const BOOSTED_NUMBER_BADGE_3 = parseEther("0.25");

        beforeEach(async () => {
            await badgeToken1.mint(account1.address, "1", "1");
            await badgeToken1.mint(account1.address, "2", "1");
            await badgeToken2.mint(account1.address, "1", "1");
            await badgeToken2.mint(account1.address, "2", "1");

            await badgeToken1.mint(account2.address, "1", "1");

            await badgeManager.connect(deployer).addBadge(badgeToken3.address, 1, BOOSTED_NUMBER_BADGE_3);
            await badgeManager.connect(deployer).addBadge(badgeToken1.address, 1, BOOSTED_NUMBER_BADGE_1);
            await badgeManager.connect(deployer).addBadge(badgeToken2.address, 1, BOOSTED_NUMBER_BADGE_2);
        });

        it("cannot delegate badge if not in badge list", async () => {
            await expect(badgeManager.connect(account1).delegateBadgeTo(badgeTokenNotInList.address, 1, account2.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: invalid badge");
        })

        it("cannot delegate badge if do not own badge", async () => {
            await expect(badgeManager.connect(account3).delegateBadgeTo(badgeToken1.address, 1, account1.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: You do not own the badge");
        })

        it("cannot delegate badge if already delegated", async () => {
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await expect(badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account2.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: already delegated");
        })

        it("single badge boosting (self)", async () => {

            let DEPOSIT_AMOUNT = parseEther("2");

            const sTokenBalanceBefore = await timeLockPool.balanceOf(account1.address);

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            expect(await badgeManager.connect(account1).getDelegateByBadge(account1.address, badgeToken1.address, 1)).to.eq(account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount1 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(BOOSTED_NUMBER_BADGE_1).add(parseEther("1"))).div(constants.WeiPerEther);
            expect(sTokenBalance).to.eq(sTokenBalanceBefore.add(expectedSharesAmount1));

            const NEW_BOOSTED_NUMBER_BADGE_1 = parseEther("0.5");
            await badgeManager.connect(deployer).updateBadge(badgeToken1.address, 1, NEW_BOOSTED_NUMBER_BADGE_1);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance2 = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount2 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(NEW_BOOSTED_NUMBER_BADGE_1).add(parseEther("1"))).div(constants.WeiPerEther);
            expect(sTokenBalance2).to.eq(sTokenBalanceBefore.add(expectedSharesAmount1).add(expectedSharesAmount2));

            const dpBalanceBefore = await depositToken.balanceOf(account1.address);

            await timeTraveler.increaseTime(MAX_LOCK_DURATION);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);

            const dpBalanceAfter = await depositToken.balanceOf(account1.address);
            const sTokenBalance3 = await timeLockPool.balanceOf(account1.address);

            expect(sTokenBalance3).to.eq(0);
            expect(dpBalanceAfter).to.eq(dpBalanceBefore.add(DEPOSIT_AMOUNT.mul(2)));
        })

        it("single badge boosting (other)", async () => {

            let DEPOSIT_AMOUNT = parseEther("1");

            const sTokenBalanceBefore_account1 = await timeLockPool.balanceOf(account1.address);
            const sTokenBalanceBefore_account2 = await timeLockPool.balanceOf(account2.address);

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account2.address);
            expect(await badgeManager.connect(account1).getDelegateByBadge(account1.address, badgeToken1.address, 1)).to.eq(account2.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);
            await timeLockPool.connect(account2).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account2.address);

            const sTokenBalanceAfter_account1 = await timeLockPool.balanceOf(account1.address);
            const sTokenBalanceAfter_account2 = await timeLockPool.balanceOf(account2.address);

            const expectedSharesAmount_account1 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(parseEther("1"))).div(constants.WeiPerEther);
            const expectedSharesAmount_account2 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(BOOSTED_NUMBER_BADGE_1).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalanceAfter_account1).to.eq(sTokenBalanceBefore_account1.add(expectedSharesAmount_account1));
            expect(sTokenBalanceAfter_account2).to.eq(sTokenBalanceBefore_account2.add(expectedSharesAmount_account2));
        })

        it("multiple badges boosting", async () => {

            let DEPOSIT_AMOUNT = parseEther("1");

            const sTokenBalanceBefore = await timeLockPool.balanceOf(account1.address);

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            expect(await badgeManager.connect(account1).getDelegateByBadge(account1.address, badgeToken1.address, 1)).to.eq(account1.address);

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken2.address, 1, account1.address);
            expect(await badgeManager.connect(account1).getDelegateByBadge(account1.address, badgeToken2.address, 1)).to.eq(account1.address);

            const delegatedLists = await badgeManager.connect(account1).getDelegateByBadges([account1.address, account1.address], [badgeToken1.address, badgeToken2.address], [1, 1]);
            expect(delegatedLists[0]).to.eq(account1.address);
            expect(delegatedLists[1]).to.eq(account1.address);


            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance).to.eq(sTokenBalanceBefore.add(expectedSharesAmount));

            const NEW_BOOSTED_NUMBER_BADGE_1 = parseEther("0.5");
            await badgeManager.connect(deployer).updateBadge(badgeToken1.address, 1, NEW_BOOSTED_NUMBER_BADGE_1);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance2 = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount2 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(NEW_BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance2).to.eq(sTokenBalanceBefore.add(expectedSharesAmount).add(expectedSharesAmount2));

            const dpBalanceBefore = await depositToken.balanceOf(account1.address);

            await timeTraveler.increaseTime(MAX_LOCK_DURATION);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);

            const dpBalanceAfter = await depositToken.balanceOf(account1.address);
            const sTokenBalance3 = await timeLockPool.balanceOf(account1.address);

            expect(sTokenBalance3).to.eq(0);

            expect(dpBalanceAfter).to.eq(dpBalanceBefore.add(DEPOSIT_AMOUNT.mul(2)));
        })

        it("deposit first delegate badges later", async () => {

            let DEPOSIT_AMOUNT = parseEther("1");

            const sTokenBalanceBefore = await timeLockPool.balanceOf(account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance = await timeLockPool.balanceOf(account1.address);
            const expectedSharesAmount = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance).to.eq(sTokenBalanceBefore.add(expectedSharesAmount));

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken2.address, 1, account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance2 = await timeLockPool.balanceOf(account1.address);
            const expectedSharesAmount2 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance2).to.eq(sTokenBalanceBefore.add(expectedSharesAmount).add(expectedSharesAmount2));

            const dpBalanceBefore = await depositToken.balanceOf(account1.address);

            await timeTraveler.increaseTime(MAX_LOCK_DURATION);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);

            const dpBalanceAfter = await depositToken.balanceOf(account1.address);
            const sTokenBalance3 = await timeLockPool.balanceOf(account1.address);

            expect(sTokenBalance3).to.eq(0);
            expect(dpBalanceAfter).to.eq(dpBalanceBefore.add(DEPOSIT_AMOUNT.mul(2)));
        })

        it("multiple badges boosting (ineligible list)", async () => {

            let DEPOSIT_AMOUNT = parseEther("1");

            const sTokenBalanceBefore = await timeLockPool.balanceOf(account1.address);

            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken2.address, 1, account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance).to.eq(sTokenBalanceBefore.add(expectedSharesAmount));

            const NEW_BOOSTED_NUMBER_BADGE_1 = parseEther("0.5");
            await badgeManager.connect(deployer).updateBadge(badgeToken1.address, 1, NEW_BOOSTED_NUMBER_BADGE_1);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance2 = await timeLockPool.balanceOf(account1.address);

            const expectedSharesAmount2 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(NEW_BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance2).to.eq(sTokenBalanceBefore.add(expectedSharesAmount).add(expectedSharesAmount2));

            await badgeManager.connect(deployer).addIneligibleList(account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance3 = await timeLockPool.balanceOf(account1.address);
            const expectedSharesAmount3 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance3).to.eq(sTokenBalanceBefore.add(expectedSharesAmount).add(expectedSharesAmount2).add(expectedSharesAmount3));

            await badgeManager.connect(deployer).removeIneligibleList(account1.address);

            await timeLockPool.connect(account1).deposit(DEPOSIT_AMOUNT, MAX_LOCK_DURATION, account1.address);

            const sTokenBalance4 = await timeLockPool.balanceOf(account1.address);
            const expectedSharesAmount4 = DEPOSIT_AMOUNT.mul(MAX_BONUS.add(NEW_BOOSTED_NUMBER_BADGE_1).add(BOOSTED_NUMBER_BADGE_2).add(parseEther("1"))).div(constants.WeiPerEther);

            expect(sTokenBalance4).to.eq(sTokenBalanceBefore.add(expectedSharesAmount).add(expectedSharesAmount2).add(expectedSharesAmount3).add(expectedSharesAmount4));

            const dpBalanceBefore = await depositToken.balanceOf(account1.address);

            await timeTraveler.increaseTime(MAX_LOCK_DURATION);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);
            await timeLockPool.connect(account1).withdraw(0, account1.address);

            const dpBalanceAfter = await depositToken.balanceOf(account1.address);
            const sTokenBalance5 = await timeLockPool.balanceOf(account1.address);

            expect(sTokenBalance5).to.eq(0);
            expect(dpBalanceAfter).to.eq(dpBalanceBefore.add(DEPOSIT_AMOUNT.mul(4)));
        })

        it("can delegate for different address for the same token id", async () => {
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await badgeManager.connect(account2).delegateBadgeTo(badgeToken1.address, 1, account2.address);
            const delegatedLists = await badgeManager.connect(account1).getDelegateByBadges([account1.address, account2.address], [badgeToken1.address, badgeToken1.address], [1, 1]);
            expect(delegatedLists[0]).to.eq(account1.address);
            expect(delegatedLists[1]).to.eq(account2.address);
        })

        it("cannot delegate if target address already delegated for the same token ID", async () => {
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await expect(badgeManager.connect(account2).delegateBadgeTo(badgeToken1.address, 1, account1.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: delegate has already been delegated for the same badge");
        })

        it("can delegate for different address for the same token id, others first, self revert", async () => {
            await badgeManager.connect(account2).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await expect(badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: delegate has already been delegated for the same badge");
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account2.address);

            const delegatedLists = await badgeManager.connect(account1).getDelegateByBadges([account1.address, account2.address], [badgeToken1.address, badgeToken1.address], [1, 1]);
            expect(delegatedLists[0]).to.eq(account2.address);
            expect(delegatedLists[1]).to.eq(account1.address);
        })

        it("can delegate for different address for the same token id, self first, others reject", async () => {
            await badgeManager.connect(account1).delegateBadgeTo(badgeToken1.address, 1, account1.address);
            await expect(badgeManager.connect(account2).delegateBadgeTo(badgeToken1.address, 1, account1.address)).to.be.revertedWith("BadgeManager.delegateBadgeTo: delegate has already been delegated for the same badge");
            await badgeManager.connect(account2).delegateBadgeTo(badgeToken1.address, 1, account2.address);

            const delegatedLists = await badgeManager.connect(account1).getDelegateByBadges([account1.address, account2.address], [badgeToken1.address, badgeToken1.address], [1, 1]);
            expect(delegatedLists[0]).to.eq(account1.address);
            expect(delegatedLists[1]).to.eq(account2.address);
        })


    });
});