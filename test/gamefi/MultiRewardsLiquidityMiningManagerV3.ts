import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants } from "ethers";
import hre from "hardhat";
import { 
    MultiRewardsLiquidityMiningManagerV3, 
    MultiRewardsLiquidityMiningManagerV3__factory, 
    TestERC20,
    TestERC20__factory, 
    MultiRewardsTimeLockNonTransferablePoolV3,
    MultiRewardsTimeLockNonTransferablePoolV3__factory, 
    TimeLockNonTransferablePool,
    TimeLockNonTransferablePool__factory } from "../../typechain";
import TimeTraveler from "../../utils/TimeTraveler";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const POOL_COUNT = 4;
const ESCROW_DURATION_1 = 60 * 10;
const ESCROW_DURATION_2 = 60 * 60 * 24 * 365;

const ESCROW_PORTION_1 = parseEther("0.6");
const ESCROW_PORTION_2 = parseEther("1");

const INITIAL_REWARD_MINT = parseEther("1000000");
const DISTRIBUTOR_INCENTIVE = 100; //1%
const PLATFORM_FEE = 500; //5%

describe("LiquidityMiningManager - MultiRewards", function () {

    let deployer: SignerWithAddress;
    let rewardSource: SignerWithAddress;
    let treasury: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let depositToken: TestERC20;
    let rewardToken1: TestERC20;
    let rewardToken2: TestERC20;

    const pools: MultiRewardsTimeLockNonTransferablePoolV3[] = [];
    let escrowPool1: TimeLockNonTransferablePool;
    let escrowPool2: TimeLockNonTransferablePool;

    let liquidityMiningManager1: MultiRewardsLiquidityMiningManagerV3;
    let liquidityMiningManager2: MultiRewardsLiquidityMiningManagerV3;

    let timeTraveler = new TimeTraveler(hre.network.provider);

    before(async() => {
        [
            deployer,
            rewardSource,
            treasury,
            account1,
            account2,
            account3,
            account4,
            ...signers
        ] = await hre.ethers.getSigners();
        
        const testTokenFactory = new TestERC20__factory(deployer);

        depositToken = await testTokenFactory.deploy("Deposit Token", "DPST");
        rewardToken1 = await testTokenFactory.deploy("Reward Token 1", "RWRD1");
        rewardToken2 = await testTokenFactory.deploy("Reward Token 2", "RWRD2");

        const escrowPoolFactory = new TimeLockNonTransferablePool__factory(deployer);

        escrowPool1 = await escrowPoolFactory.deploy(
            "EscrowPool1",
            "ESCRW1",
            rewardToken1.address,
            rewardToken1.address,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION_2
        );

        escrowPool2 = await escrowPoolFactory.deploy(
            "EscrowPool2",
            "ESCRW2",
            rewardToken2.address,
            rewardToken2.address,
            constants.AddressZero,
            0,
            0,
            0,
            600,
            ESCROW_DURATION_2
        );

        liquidityMiningManager1 = await (new MultiRewardsLiquidityMiningManagerV3__factory(deployer)).deploy(rewardToken1.address, rewardSource.address, DISTRIBUTOR_INCENTIVE, PLATFORM_FEE, treasury.address);
        liquidityMiningManager2 = await (new MultiRewardsLiquidityMiningManagerV3__factory(deployer)).deploy(rewardToken2.address, rewardSource.address, DISTRIBUTOR_INCENTIVE, PLATFORM_FEE, treasury.address);

        // setup rewardSource
        await rewardToken1.mint(rewardSource.address, INITIAL_REWARD_MINT);
        await rewardToken1.connect(rewardSource).approve(liquidityMiningManager1.address, constants.MaxUint256);
        await rewardToken2.mint(rewardSource.address, INITIAL_REWARD_MINT);
        await rewardToken2.connect(rewardSource).approve(liquidityMiningManager2.address, constants.MaxUint256);

        const poolFactory = new MultiRewardsTimeLockNonTransferablePoolV3__factory(deployer);

        for(let i = 0; i < POOL_COUNT; i ++) {
            pools.push(
                await poolFactory.deploy(
                    `Pool ${i}`,
                    `P${i}`,
                    depositToken.address,
                    [rewardToken1.address, rewardToken2.address],
                    [escrowPool1.address, escrowPool2.address],
                    [ESCROW_PORTION_1, ESCROW_PORTION_2],
                    [ESCROW_DURATION_1, ESCROW_DURATION_2],
                    0,
                    600,
                    ESCROW_DURATION_2
                )
            );         
        }

        // assign gov role to account1
        const GOV_ROLE = await liquidityMiningManager1.GOV_ROLE();
        await liquidityMiningManager1.grantRole(GOV_ROLE, account1.address);
        await liquidityMiningManager2.grantRole(GOV_ROLE, account1.address);
        // assign REWARD_DISTRIBUTOR_ROLE
        const REWARD_DISTRIBUTOR_ROLE = await liquidityMiningManager1.REWARD_DISTRIBUTOR_ROLE();
        await liquidityMiningManager1.grantRole(REWARD_DISTRIBUTOR_ROLE, account1.address);
        await liquidityMiningManager2.grantRole(REWARD_DISTRIBUTOR_ROLE, account1.address);

        // connect account1 to relevant contracts
        liquidityMiningManager1 = liquidityMiningManager1.connect(account1);
        liquidityMiningManager2 = liquidityMiningManager2.connect(account1);

        await timeTraveler.snapshot();
    });

    beforeEach(async() => {
        await timeTraveler.revertSnapshot();
    });

    describe("Constructor", function() {
        it("Cannot deploy with zero reward token address", async function () {
            await expect((new MultiRewardsLiquidityMiningManagerV3__factory(deployer))
                .deploy(ZERO_ADDRESS, rewardSource.address, DISTRIBUTOR_INCENTIVE, PLATFORM_FEE, treasury.address))
                .to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.constructor: reward token must be set"
            );
        });
        it("Cannot deploy with zero reward source address", async function () {
            await expect((new MultiRewardsLiquidityMiningManagerV3__factory(deployer))
                .deploy(rewardToken1.address, ZERO_ADDRESS, DISTRIBUTOR_INCENTIVE, PLATFORM_FEE, treasury.address))
                .to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.constructor: rewardSource must be set"
            );
        });
        it("Cannot deploy with over 100% distributor incentive", async function () {
            await expect((new MultiRewardsLiquidityMiningManagerV3__factory(deployer))
                .deploy(rewardToken1.address, rewardSource.address, 10001, PLATFORM_FEE, treasury.address))
                .to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.constructor: distributorIncentive cannot be greater than 100%"
            );
        });
        it("Cannot deploy with over 100% platform fee", async function () {
            await expect((new MultiRewardsLiquidityMiningManagerV3__factory(deployer))
                .deploy(rewardToken1.address, rewardSource.address, DISTRIBUTOR_INCENTIVE, 10001, treasury.address))
                .to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.constructor: platformFee cannot be greater than 100%"
            );
        });
        it("Cannot deploy with zero treasury address if has platform fee", async function () {
            await expect((new MultiRewardsLiquidityMiningManagerV3__factory(deployer))
                .deploy(rewardToken1.address, rewardSource.address, DISTRIBUTOR_INCENTIVE, PLATFORM_FEE, ZERO_ADDRESS))
                .to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.constructor: treasury must be set"
            );
        });
    });

    describe("Set Fees", function() {
        const NEW_DISTRIBUTOR_INCENTIVE = 200;
        const NEW_PLATFORM_FEE = 800;

        it("cannot setFees if not feeManager", async function() {
            await expect(liquidityMiningManager1.connect(account1).setFees(NEW_DISTRIBUTOR_INCENTIVE, NEW_PLATFORM_FEE)).to.be.revertedWith(
              "MultiRewardsLiquidityMiningManagerV3.onlyFeeManager: permission denied"
            );
        })
        
        context("With feeManager role", function() {
            beforeEach(async () => {
                let feeManagerRole = await liquidityMiningManager1.FEE_MANAGER_ROLE();
                await liquidityMiningManager1.connect(deployer).grantRole(feeManagerRole, account1.address);
            })
            it("cannot setFees with over 100% distributor incentive", async function() {
                await expect(liquidityMiningManager1.connect(account1).setFees(10001, NEW_PLATFORM_FEE)).to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.setFees: distributorIncentive cannot be greater than 100%"
                );
            })
            it("cannot setFees with over 100% platform fee", async function() {
                await expect(liquidityMiningManager1.connect(account1).setFees(NEW_DISTRIBUTOR_INCENTIVE, 10001)).to.be.revertedWith(
                    "MultiRewardsLiquidityMiningManagerV3.setFees: platformFee cannot be greater than 100%"
                );
            })
            it("can emit correct event for new fees", async function() {
                await expect(await liquidityMiningManager1.connect(account1).setFees(NEW_DISTRIBUTOR_INCENTIVE, NEW_PLATFORM_FEE))
                  .to.emit(liquidityMiningManager1, 'DistributorIncentiveSet')
                    .withArgs(NEW_DISTRIBUTOR_INCENTIVE)
                  .to.emit(liquidityMiningManager1, 'PlatformFeeSet')
                    .withArgs(NEW_PLATFORM_FEE);
            })
        })
    });

    describe("Set Treasury", function() {
        it("cannot setTreasury if not feeManager", async function() {
            await expect(liquidityMiningManager1.connect(account1).setTreasury(account2.address)).to.be.revertedWith(
              "MultiRewardsLiquidityMiningManagerV3.onlyFeeManager: permission denied"
            );
        })
        
        context("With feeManager role", function() {
            beforeEach(async () => {
                let feeManagerRole = await liquidityMiningManager1.FEE_MANAGER_ROLE();
                await liquidityMiningManager1.connect(deployer).grantRole(feeManagerRole, account1.address);
            })
            it("can emit correct event for new feeManager", async function() {
                await expect(await liquidityMiningManager1.connect(account1).setTreasury(account2.address))
                  .to.emit(liquidityMiningManager1, 'TreasurySet')
                    .withArgs(account2.address);
            })
        })
    });

    describe("Adding pools", async() => {
        it("Adding a single pool", async() => {
            const WEIGHT = parseEther("1");
            await liquidityMiningManager1.addPool(pools[0].address, WEIGHT);
            await liquidityMiningManager2.addPool(pools[0].address, WEIGHT);

            const contractPools = await liquidityMiningManager1.getPools();
            const poolAdded = await liquidityMiningManager1.poolAdded(pools[0].address);
            const totalWeight = await liquidityMiningManager1.totalWeight()

            expect(contractPools.length).to.eq(1);
            expect(contractPools[0].weight).to.eq(WEIGHT);
            expect(contractPools[0].poolContract).to.eq(pools[0].address);
            expect(poolAdded).to.eq(true);
            expect(totalWeight).to.eq(WEIGHT);
        });

        it("Adding multiple pools", async() => {
            const WEIGHT_0 = parseEther("1");
            const WEIGHT_1 = parseEther("3");

            await liquidityMiningManager1.addPool(pools[0].address, WEIGHT_0);
            await liquidityMiningManager1.addPool(pools[1].address, WEIGHT_1);

            const contractPools = await liquidityMiningManager1.getPools();
            const poolAdded0 = await liquidityMiningManager1.poolAdded(pools[0].address);
            const poolAdded1 = await liquidityMiningManager1.poolAdded(pools[1].address);
            const totalWeight = await liquidityMiningManager1.totalWeight();

            expect(contractPools.length).to.eq(2);
            expect(contractPools[0].weight).to.eq(WEIGHT_0);
            expect(contractPools[0].poolContract).to.eq(pools[0].address);
            expect(contractPools[1].weight).to.eq(WEIGHT_1);
            expect(contractPools[1].poolContract).to.eq(pools[1].address);
            expect(poolAdded0).to.eq(true);
            expect(poolAdded1).to.eq(true);
            expect(totalWeight).to.eq(WEIGHT_0.add(WEIGHT_1));
        })

        it("Adding a pool twice should fail", async() => {
            await liquidityMiningManager1.addPool(pools[0].address, 0);
            await expect(liquidityMiningManager1.addPool(pools[0].address, 0)).to.be.revertedWith("MultiRewardsLiquidityMiningManagerV3.addPool: Pool already added");
        });

        it("Adding a pool from a non gov address should fail", async() => {
            await expect(liquidityMiningManager1.connect(account2).addPool(pools[0].address, 0)).to.be.revertedWith("MultiRewardsLiquidityMiningManagerV3.onlyGov: permission denied");
        });
    });

    describe("Removing pools", async() => {
        let weights: BigNumber[] = [];
        let poolAddresses: string[] = [];
        let startingTotalWeight: BigNumber;

        beforeEach(async() => {
            weights = [];
            poolAddresses = [];
            startingTotalWeight = BigNumber.from(0);
            let weight = parseEther("1");
            for (const pool of pools) {
                await liquidityMiningManager1.addPool(pool.address, weight);

                poolAddresses.push(pool.address);
                weights.push(weight);
                weight = weight.add(parseEther("1"));
            }

            startingTotalWeight = await liquidityMiningManager1.totalWeight();
        });

        it("Removing last pool in list", async() => {
            await liquidityMiningManager1.removePool(pools.length - 1);

            const contractPools = await liquidityMiningManager1.getPools();
            for(let i = 0; i < contractPools.length; i ++) {
                expect(contractPools[i].poolContract).to.eq(poolAddresses[i]);
                expect(contractPools[i].weight).to.eq(weights[i]);

                const poolAdded = await liquidityMiningManager1.poolAdded(poolAddresses[i]);
                expect(poolAdded).to.eq(true);
            }

            const poolAdded = await liquidityMiningManager1.poolAdded(poolAddresses[poolAddresses.length - 1]);
            const totalWeight = await liquidityMiningManager1.totalWeight();
            expect(poolAdded).to.eq(false);
            expect(totalWeight).to.eq(startingTotalWeight.sub(weights[weights.length - 1]));
            expect(contractPools.length).to.eq(pools.length - 1);
        });

        it("Removing a pool in the beginning of the list", async() => {
            await liquidityMiningManager1.removePool(0);

            const contractPools = await liquidityMiningManager1.getPools();

            const weightsCopy = Array.from(weights);
            weightsCopy[0] = weights[weights.length - 1];
            weightsCopy.pop();
            poolAddresses[0] = poolAddresses[poolAddresses.length - 1];
            poolAddresses.pop();

            for(let i = 0; i < contractPools.length; i ++) {
                expect(contractPools[i].poolContract).to.eq(poolAddresses[i]);
                expect(contractPools[i].weight).to.eq(weightsCopy[i]);
            }

            const totalWeight = await liquidityMiningManager1.totalWeight();
            expect(totalWeight).to.eq(startingTotalWeight.sub(weights[0]));
            expect(contractPools.length).to.eq(pools.length - 1);
        });

        it("Removing all pools", async() => {
            // remove all pools
            for (let i = 0; i < pools.length; i ++) {
                // remove pool 0 each time as the array gets reordered
                await liquidityMiningManager1.removePool(0);
            }

            for(const pool of pools) {
                const poolAdded = await liquidityMiningManager1.poolAdded(pool.address);
                expect(poolAdded).to.eq(false);
            }

            const totalWeight = await liquidityMiningManager1.totalWeight();
            const contractPools = await liquidityMiningManager1.getPools();
            expect(totalWeight).to.eq(0);
            expect(contractPools.length).to.eq(0);
        })

        it("Removing a pool from a non gov address should fail", async() => {
            await expect(liquidityMiningManager1.connect(account2).removePool(0)).to.be.revertedWith("MultiRewardsLiquidityMiningManagerV3.onlyGov: permission denied");
        });
    });

    describe("Distributing rewards", async() => {
        beforeEach(async() => {
            let i = 0;
            for (const pool of pools) {
                await liquidityMiningManager1.addPool(pool.address, parseEther((i + 1).toString()));
                await depositToken.mint(account1.address, parseEther("1"));
                await depositToken.connect(account1).approve(pools[i].address, parseEther("1"));
                await pool.connect(account1).deposit(parseEther("1"), 600, await account1.getAddress());
                i ++;
            } 
        });

        it("Distributing rewards from an address which does not have the REWARD_DISTRIBUTOR_ROLE", async() => {
            await expect(liquidityMiningManager1.connect(account2.address).distributeRewards()).to.revertedWith("MultiRewardsLiquidityMiningManagerV3.onlyRewardDistributor: permission denied");
        });

        context("With rewardDistributor role", function() {
            beforeEach(async () => {
                let rewardDistributorRole = await liquidityMiningManager1.REWARD_DISTRIBUTOR_ROLE();
                await liquidityMiningManager1.connect(deployer).grantRole(rewardDistributorRole, account1.address);
            })

            it("Distributing zero rewards", async() => {
                await liquidityMiningManager1.connect(account1).distributeRewards();
                // @ts-ignore
                const lastBlockTimestamp = (await account1.provider?.getBlock("latest")).timestamp;
                const lastRewardDistribution = await liquidityMiningManager1.lastDistribution();
                expect(lastBlockTimestamp).to.eq(lastRewardDistribution);
            });
    
            it("Should return any excess rewards", async() => {
                const POOL_WEIGHT = parseEther("1");
                const REWARDS_PER_SECOND = parseEther("1");
    
                // add non contract pool
                await liquidityMiningManager1.addPool("0x0000000000000000000000000000000000000001", POOL_WEIGHT);
                const totalWeight = await liquidityMiningManager1.totalWeight();
                await liquidityMiningManager1.setRewardPerSecond(REWARDS_PER_SECOND);
                
                const rewardSourceBalanceBefore = await rewardToken1.balanceOf(rewardSource.address);
                const lastDistributionBefore = await liquidityMiningManager1.lastDistribution();
                await liquidityMiningManager1.connect(account1).distributeRewards();
                const rewardSourceBalanceAfter = await rewardToken1.balanceOf(rewardSource.address);
                const lastDistributionAfter = await liquidityMiningManager1.lastDistribution();
    
                const expectedRewardsDistributed = (lastDistributionAfter.sub(lastDistributionBefore)).mul(REWARDS_PER_SECOND);
                const expectedDistributorIncentive = expectedRewardsDistributed.mul(DISTRIBUTOR_INCENTIVE).div(10000);
                const expectedPlatformFee = expectedRewardsDistributed.mul(PLATFORM_FEE).div(10000);
                const expectedRewardsReturned = expectedRewardsDistributed.mul(POOL_WEIGHT).div(totalWeight);
    
                expect(rewardSourceBalanceAfter).to.eq(rewardSourceBalanceBefore.sub(expectedRewardsDistributed).sub(expectedDistributorIncentive).sub(expectedPlatformFee).add(expectedRewardsReturned).add(1));
            });
    
            it("Should work", async() => {
                const REWARDS_PER_SECOND = parseEther("1");
                // Enable rewards
                await liquidityMiningManager1.setRewardPerSecond(REWARDS_PER_SECOND);
                const distributorBalanceBefore = await rewardToken1.balanceOf(account1.address);
                const treasuryBalanceBefore = await rewardToken1.balanceOf(treasury.address);
    
                const lastDistributionBefore = await liquidityMiningManager1.lastDistribution();
                await liquidityMiningManager1.connect(account1).distributeRewards();
                const lastDistributionAfter = await liquidityMiningManager1.lastDistribution();
    
                const totalWeight = await liquidityMiningManager1.totalWeight();
                const expectedRewardsDistributed = (lastDistributionAfter.sub(lastDistributionBefore)).mul(REWARDS_PER_SECOND);
                const expectedDistributorIncentive = expectedRewardsDistributed.mul(DISTRIBUTOR_INCENTIVE).div(10000);
                const expectedPlatformFee = expectedRewardsDistributed.mul(PLATFORM_FEE).div(10000);
    
                for(let i = 0; i < pools.length; i ++) {
                    const poolTokenBalance = await rewardToken1.balanceOf(pools[i].address);
                    const poolWeight = (await liquidityMiningManager1.pools(i)).weight;
                    const expectedPoolTokenBalance = expectedRewardsDistributed.mul(poolWeight).div(totalWeight);
                    expect(expectedPoolTokenBalance).to.eq(poolTokenBalance);
                }
    
                const distributorBalanceAfter = await rewardToken1.balanceOf(account1.address);
                const treasuryBalanceAfter = await rewardToken1.balanceOf(treasury.address);

                expect(distributorBalanceAfter.sub(distributorBalanceBefore)).to.eq(expectedDistributorIncentive);
                expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.eq(expectedPlatformFee);
            });

            it("Should not issue platform fee if treasury is zero address", async() => {
                let feeManagerRole = await liquidityMiningManager1.FEE_MANAGER_ROLE();
                await liquidityMiningManager1.connect(deployer).grantRole(feeManagerRole, account1.address);
                await liquidityMiningManager1.connect(account1).setTreasury(ZERO_ADDRESS);

                const REWARDS_PER_SECOND = parseEther("1");
                // Enable rewards
                await liquidityMiningManager1.setRewardPerSecond(REWARDS_PER_SECOND);
                const distributorBalanceBefore = await rewardToken1.balanceOf(account1.address);
                const treasuryBalanceBefore = await rewardToken1.balanceOf(treasury.address);
    
                const rewardSourceBalanceBefore = await rewardToken1.balanceOf(rewardSource.address);
                const lastDistributionBefore = await liquidityMiningManager1.lastDistribution();
                await liquidityMiningManager1.connect(account1).distributeRewards();
                const rewardSourceBalanceAfter = await rewardToken1.balanceOf(rewardSource.address);
                const lastDistributionAfter = await liquidityMiningManager1.lastDistribution();
    
                const totalWeight = await liquidityMiningManager1.totalWeight();
                const expectedRewardsDistributed = (lastDistributionAfter.sub(lastDistributionBefore)).mul(REWARDS_PER_SECOND);
                const expectedDistributorIncentive = expectedRewardsDistributed.mul(DISTRIBUTOR_INCENTIVE).div(10000);
                const expectedPlatformFee = expectedRewardsDistributed.mul(PLATFORM_FEE).div(10000);
    
                for(let i = 0; i < pools.length; i ++) {
                    const poolTokenBalance = await rewardToken1.balanceOf(pools[i].address);
                    const poolWeight = (await liquidityMiningManager1.pools(i)).weight;
                    const expectedPoolTokenBalance = expectedRewardsDistributed.mul(poolWeight).div(totalWeight);
                    expect(expectedPoolTokenBalance).to.eq(poolTokenBalance);
                }
    
                const distributorBalanceAfter = await rewardToken1.balanceOf(account1.address);
                const treasuryBalanceAfter = await rewardToken1.balanceOf(treasury.address);

                expect(distributorBalanceAfter.sub(distributorBalanceBefore)).to.eq(expectedDistributorIncentive);
                expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.eq(0);
                expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.not.eq(expectedPlatformFee);
                expect(rewardSourceBalanceAfter).to.eq(rewardSourceBalanceBefore.sub(expectedRewardsDistributed).sub(expectedDistributorIncentive).sub(expectedPlatformFee).add(expectedPlatformFee));
            })
        })
    });

    describe("Adjusting weight", async() => {
        let weights;
        beforeEach(async() => {
            weights = [];
            let i = 0;
            for (const pool of pools) {
                const weight = parseEther((i + 1).toString());
                weights.push(weight);
                await liquidityMiningManager1.addPool(pool.address, weight);
                i ++;
            } 
        })

        it("Adjust weight up", async() => {
            const WEIGHT_INCREMENT = parseEther("1");
            const POOL_ID = 0;
            
            const totalWeightBefore = await liquidityMiningManager1.totalWeight();
            const poolBefore = await liquidityMiningManager1.pools(POOL_ID);
            await liquidityMiningManager1.adjustWeight(POOL_ID, poolBefore.weight.add(WEIGHT_INCREMENT));
            const lastDistribution = await liquidityMiningManager1.lastDistribution();
            // @ts-ignore
            const blockTimestamp = (await account1.provider?.getBlock("latest")).timestamp;
            const poolAfter = await liquidityMiningManager1.pools(POOL_ID);
            const totalWeightAfter = await liquidityMiningManager1.totalWeight();

            expect(lastDistribution).to.eq(blockTimestamp);
            expect(poolAfter.weight).to.eq(poolBefore.weight.add(WEIGHT_INCREMENT));
            expect(totalWeightAfter).to.eq(totalWeightBefore.add(WEIGHT_INCREMENT));
        });

        it("Adjust weight down", async() => {
            const WEIGHT_DECREMENT = parseEther("1");
            const POOL_ID = 0;
            
            const totalWeightBefore = await liquidityMiningManager1.totalWeight();
            const poolBefore = await liquidityMiningManager1.pools(POOL_ID);
            await liquidityMiningManager1.adjustWeight(POOL_ID, poolBefore.weight.sub(WEIGHT_DECREMENT));
            const lastDistribution = await liquidityMiningManager1.lastDistribution();
            // @ts-ignore
            const blockTimestamp = (await account1.provider?.getBlock("latest")).timestamp;
            const poolAfter = await liquidityMiningManager1.pools(POOL_ID);
            const totalWeightAfter = await liquidityMiningManager1.totalWeight();

            expect(lastDistribution).to.eq(blockTimestamp);
            expect(poolAfter.weight).to.eq(poolBefore.weight.sub(WEIGHT_DECREMENT));
            expect(totalWeightAfter).to.eq(totalWeightBefore.sub(WEIGHT_DECREMENT));
        });

        it("Should fail from non gov address", async() => {
            await expect(liquidityMiningManager1.connect(account2).adjustWeight(0, 0)).to.be.revertedWith("MultiRewardsLiquidityMiningManagerV3.onlyGov: permission denied");
        });

    });

    describe("Setting reward per second", async() => {
        it("Should work", async() => {
            const NEW_REWARD_RATE = parseEther("2");

            await liquidityMiningManager1.setRewardPerSecond(NEW_REWARD_RATE);
            const lastDistribution = await liquidityMiningManager1.lastDistribution();
            // @ts-ignore
            const blockTimestamp = (await account1.provider?.getBlock("latest")).timestamp;
            const rewardPerSecond = await liquidityMiningManager1.rewardPerSecond();

            expect(lastDistribution).to.eq(blockTimestamp);
            expect(rewardPerSecond).to.eq(NEW_REWARD_RATE);
        });

        it("Should fail from non gov address", async() => {
            await expect(liquidityMiningManager1.connect(account2).setRewardPerSecond(0)).to.be.revertedWith("MultiRewardsLiquidityMiningManagerV3.onlyGov: permission denied");
        });
    });
})