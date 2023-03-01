import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import hre from "hardhat";
import { TestERC721__factory, StakedERC721__factory, ERC721Staking__factory } from "../typechain";
import { ERC721Staking, TestERC721, StakedERC721 } from "../typechain";
import TimeTraveler from "../utils/TimeTraveler";

const MIN_LOCK_DURATION = 60 * 60 * 24 * 30;
const MAX_LOCK_DURATION = 60 * 60 * 24 * 360;

describe("ERC721Staking", function () {

    let deployer: SignerWithAddress;
    let account1: SignerWithAddress;
    let account2: SignerWithAddress;
    let account3: SignerWithAddress;
    let account4: SignerWithAddress;
    let signers: SignerWithAddress[];

    let erc721Staking: ERC721Staking;
    let originalNFT: TestERC721;
    let stakedNFT: StakedERC721;

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

        const testERC721Factory = await new TestERC721__factory(deployer);
        const stakedERC721Factory = await new StakedERC721__factory(deployer);

        originalNFT = await testERC721Factory.deploy("TestNFT", "TNFT");
        stakedNFT = await stakedERC721Factory.deploy("TestStakedNFT", "TSNFT");

        const erc721StakingFactory = new ERC721Staking__factory(deployer);

        erc721Staking = await erc721StakingFactory.deploy(
            originalNFT.address,
            stakedNFT.address,
            MIN_LOCK_DURATION,
            MAX_LOCK_DURATION
        );

        const minterRole = await stakedNFT.MINTER_ROLE();
        await stakedNFT.grantRole(minterRole, erc721Staking.address);
        const burnerRole = await stakedNFT.BURNER_ROLE();
        await stakedNFT.grantRole(burnerRole, erc721Staking.address);

        await timeTraveler.snapshot();
    })

    beforeEach(async () => {
        await timeTraveler.revertSnapshot();
    })

    describe("Stake", async () => {

        const STAKE_TOKEN_ID = parseEther("10");

        beforeEach(async () => {
            await originalNFT.connect(deployer).mint(account1.address, STAKE_TOKEN_ID);
        })

        it("Staking should fail if I do not own the NFT", async () => {
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await expect(erc721Staking.connect(account2).stake(STAKE_TOKEN_ID, 0)).to.be.revertedWith("ERC721Staking.stake: You don't own this token!");
        });

        it("Staking should fail if not approved", async () => {
            await expect(erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0)).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
        })

        it("Staking with less than min lockup time should lock it for 30 days", async () => {
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0);
            const MIN_LOCK_DURATION = await erc721Staking.minLockDuration();
            const stakedInfo = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID);
            expect(stakedInfo.end.sub(stakedInfo.start)).to.eq(MIN_LOCK_DURATION);
            expect(stakedInfo.duration).to.eq(MIN_LOCK_DURATION);
        });

        it("Staking with lock longer than MAX_LOCK_DURATION should lock it for MAX_LOCK_DURATION", async () => {
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            const maxLockDuration = await erc721Staking.maxLockDuration();
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, maxLockDuration.add(1));

            const stakedInfo = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID);
            expect(stakedInfo.end.sub(stakedInfo.start)).to.eq(maxLockDuration);
            expect(stakedInfo.duration).to.eq(maxLockDuration);
        });

        it("Deposit successfully should get StakedNFT with the same ID", async () => {
            expect(account1.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            await expect(stakedNFT.ownerOf(STAKE_TOKEN_ID)).to.be.revertedWith("ERC721: owner query for nonexistent token");

            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            const duration = 86400 * 30;
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, duration);

            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            expect(account1.address).to.eq(await stakedNFT.ownerOf(STAKE_TOKEN_ID));

            const stakedInfo = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID);
            expect(stakedInfo.end.sub(stakedInfo.start)).to.eq(duration);
            expect(stakedInfo.duration).to.eq(duration);
        });

        it("Multiple stakes", async () => {
            const STAKE_TOKEN_ID_2 = 87;
            await originalNFT.connect(deployer).mint(account1.address, STAKE_TOKEN_ID_2);

            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID_2);

            const duration1 = 86400 * 30;
            const duration2 = 86400 * 90;
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, duration1);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID_2, duration2);

            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID_2));

            expect(account1.address).to.eq(await stakedNFT.ownerOf(STAKE_TOKEN_ID));
            expect(account1.address).to.eq(await stakedNFT.ownerOf(STAKE_TOKEN_ID_2));

            const stakedInfo1 = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID);
            expect(stakedInfo1.end.sub(stakedInfo1.start)).to.eq(duration1);
            expect(stakedInfo1.duration).to.eq(duration1);

            const stakedInfo2 = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID_2);
            expect(stakedInfo2.end.sub(stakedInfo2.start)).to.eq(duration2);
            expect(stakedInfo2.duration).to.eq(duration2);
        });

        it("StakedNFT should fail when transfer", async () => {
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0);
            await expect(stakedNFT.connect(account1).transferFrom(account1.address, account2.address, STAKE_TOKEN_ID)).to.be.revertedWith("StakedERC721._transfer: not transferrable");
        });
    });

    describe("Unstake", async () => {
        const STAKE_TOKEN_ID = parseEther("10");

        beforeEach(async () => {
            await originalNFT.connect(deployer).mint(account1.address, STAKE_TOKEN_ID);
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
        })

        it("Unstake before expiry should fail", async () => {
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0);
            await expect(erc721Staking.unstake(STAKE_TOKEN_ID)).to.be.revertedWith("ERC721Staking.unstake: You don't own this token!");
        });

        it("Unstake should work after lockup time", async () => {
            const lockupTime = 86400 * 900;
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, lockupTime);

            expect(account1.address).to.eq(await stakedNFT.ownerOf(STAKE_TOKEN_ID));
            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));

            await timeTraveler.increaseTime(Number(lockupTime));
            await erc721Staking.connect(account1).unstake(STAKE_TOKEN_ID);

            expect(account1.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            await expect(stakedNFT.ownerOf(STAKE_TOKEN_ID)).to.be.revertedWith("ERC721: owner query for nonexistent token");
        });

        it("Can successfuly stake after unstake", async () => {
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0);

            const MIN_LOCK_DURATION = await erc721Staking.minLockDuration();
            await timeTraveler.increaseTime(Number(MIN_LOCK_DURATION));
            await erc721Staking.connect(account1).unstake(STAKE_TOKEN_ID);

            const duration = 86400 * 30;
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, duration);

            expect(account1.address).to.eq(await stakedNFT.ownerOf(STAKE_TOKEN_ID));
            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));

            const stakedInfo = await stakedNFT.stakedInfoOf(STAKE_TOKEN_ID);
            expect(stakedInfo.end.sub(stakedInfo.start)).to.eq(duration);
            expect(stakedInfo.duration).to.eq(duration);
        });
    });

    describe("ERC721 saver", async () => {
        const STAKE_TOKEN_ID = parseEther("10");
        const STAKE_TOKEN_ID_2 = parseEther("100");
        const STAKE_TOKEN_ID_3 = parseEther("59");

        beforeEach(async () => {
            await originalNFT.connect(deployer).mint(account1.address, STAKE_TOKEN_ID);
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID, 0);

            await originalNFT.connect(deployer).mint(account1.address, STAKE_TOKEN_ID_2);
            await originalNFT.connect(account1).approve(erc721Staking.address, STAKE_TOKEN_ID_2);
            await erc721Staking.connect(account1).stake(STAKE_TOKEN_ID_2, 0);

            await originalNFT.connect(deployer).mint(account2.address, STAKE_TOKEN_ID_3);
            await originalNFT.connect(account2).approve(erc721Staking.address, STAKE_TOKEN_ID_3);
            await erc721Staking.connect(account2).stake(STAKE_TOKEN_ID_3, 0);
        })

        it("Cannot save ERC721 if not token saver", async () => {
            await expect(erc721Staking.connect(account1).saveToken(originalNFT.address, deployer.address, STAKE_TOKEN_ID)).to.be.revertedWith("ERC721Saver.onlyTokenSaver: permission denied");
        });

        it("Can save ERC721 if emergency", async () => {
            const tokenSaverRole = await erc721Staking.TOKEN_SAVER_ROLE();
            await erc721Staking.grantRole(tokenSaverRole, account4.address);

            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID_2));
            expect(erc721Staking.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID_3));

            await erc721Staking.connect(account4).saveToken(originalNFT.address, account4.address, STAKE_TOKEN_ID);
            await erc721Staking.connect(account4).saveToken(originalNFT.address, account4.address, STAKE_TOKEN_ID_2);
            await erc721Staking.connect(account4).saveToken(originalNFT.address, account4.address, STAKE_TOKEN_ID_3);

            expect(account4.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID));
            expect(account4.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID_2));
            expect(account4.address).to.eq(await originalNFT.ownerOf(STAKE_TOKEN_ID_3));
        });
    });
});