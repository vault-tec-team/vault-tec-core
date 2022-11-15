import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants } from "ethers";
import hre from "hardhat";
import { TestERC20__factory, TimeLockNonTransferablePool__factory } from "../typechain";
import { TestERC20 } from "../typechain";
import { TimeLockNonTransferablePool } from "../typechain/TimeLockNonTransferablePool";
import TimeTraveler from "../utils/TimeTraveler";

const MIN_ESCROW_DURATION = 60 * 10;
const ESCROW_DURATION = 60 * 60 * 24 * 365;
const ESCROW_PORTION = parseEther("0.77");
const MAX_BONUS = parseEther("1");
const MIN_LOCK_DURATION = 60 * 10;
const MAX_LOCK_DURATION = 60 * 60 * 24 * 365;
const INITIAL_MINT = parseEther("1000000");
const DEPOSIT_AMOUNT = parseEther("1000");

describe("TimeLockNonTransferablePool", function () {

    let deployer: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let timeLockPool: TimeLockNonTransferablePool;
    let escrowPool: TimeLockNonTransferablePool;
    let depositToken: TestERC20;
    let rewardToken: TestERC20;
    
    const timeTraveler = new TimeTraveler(hre.network.provider);

    before(async() => {
        [
            deployer,
            account1,
            account2,
            account3,
            account4,
            ...signers
        ] = await hre.ethers.getSigners();

        const testTokenFactory = await new TestERC20__factory(deployer);

        depositToken = await testTokenFactory.deploy("DPST", "Deposit Token");
        rewardToken = await testTokenFactory.deploy("RWRD", "Reward Token");

        await depositToken.mint(account1.address, INITIAL_MINT);
        await rewardToken.mint(account1.address, INITIAL_MINT);

        const timeLockPoolFactory = new TimeLockNonTransferablePool__factory(deployer);
        
        escrowPool = await timeLockPoolFactory.deploy(
            "ESCROW",
            "ESCRW",
            rewardToken.address,
            constants.AddressZero,
            constants.AddressZero,
            0,
            0,
            0,
            MIN_ESCROW_DURATION,
            ESCROW_DURATION
        );

        timeLockPool = await timeLockPoolFactory.deploy(
            "Staking Pool",
            "STK",
            depositToken.address,
            rewardToken.address,
            escrowPool.address,
            ESCROW_PORTION,
            ESCROW_DURATION,
            MAX_BONUS,
            MIN_LOCK_DURATION,
            MAX_LOCK_DURATION
        );

        
        // connect account1 to all contracts
        timeLockPool = timeLockPool.connect(account1);
        escrowPool = escrowPool.connect(account1);
        depositToken = depositToken.connect(account1);
        rewardToken = rewardToken.connect(account1);
        
        await depositToken.approve(timeLockPool.address, constants.MaxUint256);
        await timeLockPool.deposit(DEPOSIT_AMOUNT, constants.MaxUint256, account1.address);

        await timeTraveler.snapshot();
    })

    beforeEach(async() => {
        await timeTraveler.revertSnapshot();
    })

    it("transfer", async() => {
        await expect(timeLockPool.transfer(account3.address, DEPOSIT_AMOUNT)).to.be.revertedWith("NON_TRANSFERABLE");
    });

    it("transferFrom", async() => {
        await expect(timeLockPool.transferFrom(account1.address, account3.address, DEPOSIT_AMOUNT)).to.be.revertedWith("NON_TRANSFERABLE");
    });
});