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

const POOL_COUNT = 2;
const ESCROW_DURATION_1 = 60 * 10;
const ESCROW_DURATION_2 = 60 * 60 * 24 * 365;

const ESCROW_PORTION_1 = parseEther("0");
const ESCROW_PORTION_2 = parseEther("1");

const INITIAL_REWARD_MINT = parseEther("1000000");
const INITIAL_MINT = parseEther("1000000");

const WEIGHT_0 = parseEther("1");
const WEIGHT_1 = parseEther("4");

const REWARDS_PER_SECOND_1 = parseEther("1");
const REWARDS_PER_SECOND_2 = parseEther("5");

const DISTRIBUTOR_INCENTIVE = 100; //1%
const PLATFORM_FEE = 500; //5%

describe("MultiRewards", function () {

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

        await depositToken.mint(account1.address, INITIAL_MINT);
        await depositToken.mint(account2.address, INITIAL_MINT);

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
            await depositToken.connect(account1).approve(pools[i].address, INITIAL_MINT);
            await depositToken.connect(account2).approve(pools[i].address, INITIAL_MINT);
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

    describe("General Cases", async() => {
        beforeEach(async() => {

            await liquidityMiningManager1.addPool(pools[0].address, WEIGHT_0);
            await liquidityMiningManager1.addPool(pools[1].address, WEIGHT_1);

            const contractPools1 = await liquidityMiningManager1.getPools();
            const totalWeight1 = await liquidityMiningManager1.totalWeight()
            expect(contractPools1.length).to.eq(2);
            expect(totalWeight1).to.eq(WEIGHT_0.add(WEIGHT_1));

            await liquidityMiningManager2.addPool(pools[0].address, WEIGHT_0);
            await liquidityMiningManager2.addPool(pools[1].address, WEIGHT_1);

            const contractPools2 = await liquidityMiningManager2.getPools();
            const totalWeight2 = await liquidityMiningManager2.totalWeight()
            expect(contractPools2.length).to.eq(2);
            expect(totalWeight2).to.eq(WEIGHT_0.add(WEIGHT_1));

            // Enable rewards
            await liquidityMiningManager1.setRewardPerSecond(REWARDS_PER_SECOND_1);
            await liquidityMiningManager2.setRewardPerSecond(REWARDS_PER_SECOND_2);
        });

        it("One person takes all rewards - one pool", async() => {
            await pools[0].connect(account1).deposit(parseEther("1"), 600, await account1.getAddress());

            const lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            const lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);

            const pool0Token1Balance = await rewardToken1.balanceOf(pools[0].address);
            const expectedPoolToken1Balance = expectedRewardsDistributed1.mul(WEIGHT_0).div(totalWeight1);

            expect(expectedPoolToken1Balance).to.eq(pool0Token1Balance);

            const pool1Token1Balance = await rewardToken1.balanceOf(pools[1].address);
            expect(pool1Token1Balance).to.eq(0);


            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);

            const pool0Token2Balance = await rewardToken2.balanceOf(pools[0].address);
            const expectedPoolToken2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);

            expect(expectedPoolToken2Balance).to.eq(pool0Token2Balance);

            const pool1Token2Balance = await rewardToken2.balanceOf(pools[1].address);
            expect(pool1Token2Balance).to.eq(0);
        });

        it("Multiple people - one pool", async() => {
            const ACCOUNT1_DEPOSIT_AMT = parseEther("1");
            await pools[0].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress());
            await pools[0].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.mul(2), 600, await account2.getAddress());

            const lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            const lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPoolToken1Balance = expectedRewardsDistributed1.mul(WEIGHT_0).div(totalWeight1);

            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);
            const expectedPoolToken2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);

            await pools[0].connect(account1).claimAll(account3.address);

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account3RewardToken1Balance).to.eq(expectedPoolToken1Balance.div(3));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account3RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq(expectedPoolToken2Balance.div(3));
        });

        it("Multiple deposits - one pool", async() => {
            const ACCOUNT1_DEPOSIT_AMT = parseEther("1");
            await pools[0].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress());
            await pools[0].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.mul(2), 600, await account2.getAddress());

            let lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            let lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1_1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPoolToken1Balance_1 = expectedRewardsDistributed1_1.mul(WEIGHT_0).div(totalWeight1);

            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);
            const expectedPoolToken2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);

            await timeTraveler.increaseTime(600);
            await pools[0].connect(account2).withdraw(0, account2.address);

            lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const expectedRewardsDistributed1_2 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPoolToken1Balance_2 = expectedRewardsDistributed1_2.mul(WEIGHT_0).div(totalWeight1);

            await pools[0].connect(account1).claimAll(account3.address);

            const account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            const escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            const account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            const escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account3RewardToken1Balance).to.eq((expectedPoolToken1Balance_1.div(3)).add(expectedPoolToken1Balance_2));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account3RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq(expectedPoolToken2Balance.div(3));
        });

        it("One person takes all rewards - multiple pool", async() => {
            await pools[0].connect(account1).deposit(parseEther("1"), 600, await account1.getAddress());
            await pools[1].connect(account1).deposit(parseEther("1"), 600, await account1.getAddress());

            const lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            const lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);

            const pool0Token1Balance = await rewardToken1.balanceOf(pools[0].address);
            const expectedPool0Token1Balance = expectedRewardsDistributed1.mul(WEIGHT_0).div(totalWeight1);

            expect(expectedPool0Token1Balance).to.eq(pool0Token1Balance);

            const pool1Token1Balance = await rewardToken1.balanceOf(pools[1].address);
            const expectedPool1Token1Balance = expectedRewardsDistributed1.mul(WEIGHT_1).div(totalWeight1);
            expect(pool1Token1Balance).to.eq(expectedPool1Token1Balance);

            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);

            const pool0Token2Balance = await rewardToken2.balanceOf(pools[0].address);
            const expectedPool0Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);

            expect(expectedPool0Token2Balance).to.eq(pool0Token2Balance);

            const pool1Token2Balance = await rewardToken2.balanceOf(pools[1].address);
            const expectedPool1Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_1).div(totalWeight2);

            expect(pool1Token2Balance).to.eq(expectedPool1Token2Balance);
        });

        it("Multiple people - multiple pool", async() => {
            const ACCOUNT1_DEPOSIT_AMT = parseEther("1");
            await pools[0].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress()); //1/3
            await pools[0].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.mul(2), 600, await account2.getAddress()); //2/3

            await pools[1].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress()); //2/3
            await pools[1].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.div(2), 600, await account2.getAddress());//1/3

            const lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            const lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPool0Token1Balance = expectedRewardsDistributed1.mul(WEIGHT_0).div(totalWeight1);
            const expectedPool1Token1Balance = expectedRewardsDistributed1.mul(WEIGHT_1).div(totalWeight1);

            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);
            const expectedPool0Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);
            const expectedPool1Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_1).div(totalWeight2);

            await pools[0].connect(account1).claimAll(account3.address);

            let account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            let escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            let account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            let escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account3RewardToken1Balance).to.eq(expectedPool0Token1Balance.div(3));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account3RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq(expectedPool0Token2Balance.div(3));

            await pools[1].connect(account1).claimAll(account3.address);

            account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account3RewardToken1Balance).to.eq((expectedPool0Token1Balance.div(3)).add(expectedPool1Token1Balance.mul(2).div(3)));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account3RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq((expectedPool0Token2Balance.div(3)).add(expectedPool1Token2Balance.mul(2).div(3)));
        });

        it("Multiple deposits - multiple pool", async() => {
            const ACCOUNT1_DEPOSIT_AMT = parseEther("1");
            await pools[0].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress()); //1/3
            await pools[0].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.mul(2), 600, await account2.getAddress()); //2/3

            await pools[1].connect(account1).deposit(ACCOUNT1_DEPOSIT_AMT, 600, await account1.getAddress()); //2/3
            await pools[1].connect(account2).deposit(ACCOUNT1_DEPOSIT_AMT.div(2), 600, await account2.getAddress());//1/3

            let lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            let lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const totalWeight1 = await liquidityMiningManager1.totalWeight();
            const expectedRewardsDistributed1_1 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPool0Token1Balance_1 = expectedRewardsDistributed1_1.mul(WEIGHT_0).div(totalWeight1);
            const expectedPool1Token1Balance_1 = expectedRewardsDistributed1_1.mul(WEIGHT_1).div(totalWeight1);

            const lastDistributionBefore2 = await liquidityMiningManager2.lastDistribution();
            await liquidityMiningManager2.distributeRewards();
            const lastDistributionAfter2 = await liquidityMiningManager2.lastDistribution();

            const totalWeight2 = await liquidityMiningManager2.totalWeight();
            const expectedRewardsDistributed2 = (lastDistributionAfter2.sub(lastDistributionBefore2)).mul(REWARDS_PER_SECOND_2);
            const expectedPool0Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_0).div(totalWeight2);
            const expectedPool1Token2Balance = expectedRewardsDistributed2.mul(WEIGHT_1).div(totalWeight2);

            await timeTraveler.increaseTime(600);
            await pools[0].connect(account2).withdraw(0, account2.address);
            await pools[1].connect(account2).withdraw(0, account2.address);

            lastDistributionBefore1 = await liquidityMiningManager1.lastDistribution();
            await liquidityMiningManager1.distributeRewards();
            lastDistributionAfter1 = await liquidityMiningManager1.lastDistribution();

            const expectedRewardsDistributed1_2 = (lastDistributionAfter1.sub(lastDistributionBefore1)).mul(REWARDS_PER_SECOND_1);
            const expectedPool0Token1Balance_2 = expectedRewardsDistributed1_2.mul(WEIGHT_0).div(totalWeight1);
            const expectedPool1Token1Balance_2 = expectedRewardsDistributed1_2.mul(WEIGHT_1).div(totalWeight1);

            await pools[0].connect(account1).claimAll(account3.address);

            let account3RewardToken1Balance = await rewardToken1.balanceOf(account3.address);
            let escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            let account3RewardToken2Balance = await rewardToken2.balanceOf(account3.address);
            let escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account3RewardToken1Balance).to.eq((expectedPool0Token1Balance_1.div(3)).add(expectedPool0Token1Balance_2));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account3RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq(expectedPool0Token2Balance.div(3));

            await pools[1].connect(account1).claimAll(account4.address);

            let account4RewardToken1Balance = await rewardToken1.balanceOf(account4.address);
            escrowPool1RewardToken1Balance = await rewardToken1.balanceOf(escrowPool1.address);
            let account4RewardToken2Balance = await rewardToken2.balanceOf(account4.address);
            escrowPool2RewardToken2Balance = await rewardToken2.balanceOf(escrowPool2.address);

            expect(account4RewardToken1Balance).to.eq((expectedPool1Token1Balance_1.mul(2).div(3)).add(expectedPool1Token1Balance_2));
            expect(escrowPool1RewardToken1Balance).to.eq(0);
            expect(account4RewardToken2Balance).to.eq(0);
            expect(escrowPool2RewardToken2Balance).to.eq((expectedPool0Token2Balance.div(3)).add(expectedPool1Token2Balance.mul(2).div(3)));
        });
    });
});