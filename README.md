# [Vault.Inc](https://vault.inc/#/)

Vault.Inc is a decentralized protocol that empowers projects with staking & locking mechanism.

## V1
Inspired by the Merit Circle, Vault.Inc uses a similiar structure to reward long-term stakers by adding a time-weighted element for calculating rewards.
Rewards are subject to a lock duration as specified by each project. And the amount of accrued rewards per pool share is not calculated on every deposit, withdrawal and claim. Instead rewards are periodically being calculated and distributed. 

**For projects:**
* Project team can decide how many pools they'd like to reward staked users.
* Project team can assign weights for each pool.
* Project team can specify the reward rates across all pools.
* Project team can decide the minimum and maximum lockup period for each pool.
* Project team can decide the vesting duration for rewards.

**For users:**
* User can stake their tokens and choose for a certain lockup. The longer your tokens are locked up, the higher the respective share of the poo and the higher your rewards.

### Audits
* Quantstamps: https://certificate.quantstamp.com/full/vault-inc
* Certik: https://gateway.pinata.cloud/ipfs/QmZLyPfGXNk4nsBKuSYeMndisV6mm3L91bX8TngLQzttGz

## V1 - MultiRewards
Updates
* Add multi-rewards support for time lock pools.
* Different rewards will be distributed using different MultiRewardsLiquidityMiningManager and parameters can be set separately.

## NFT Staking
Vault.Inc adds support for ERC721 staking.

**For projects:**
* Project team can decide which NFT can be staked
* Project team can decide which stakedNFT to issue as a certificate for the original staked NFT.
* Project team can decide the maximum lockup period.

**For users:**
* User can stake their NFT and choose for a certain lockup. And will be issued a stakedNFT (as a certificate) with the same token id and with locking information on it.
* User can only unstake their NFT after the lockup duration. The stakedNFT will be burned and the original NFT will be returned to user's wallet.
* The stakedNFT will be non-transferrable by default. Admin user with PAUSER_ROLE can turn on the trasfer ability in the future if needed.

## V2 - For DeFi
Updates
* Add distributor incentive and platform fee
* Add minimum lock duration to constructor for flexibility
* Add functions to update escrow related params
* Add kickout mechanism
* Add batch deposit and migration related deposit functions

**For projects:**
* Project team can decide the distributor incentive and platform fee.
* Project team can update the escrow related params.

**For users:**
* User can kickout other's expired deposits when after their locked period.
* User can relock their own expired deposits back to vault with new duration.

## V3 - For GameFi
Updates
* Add badge boosting and delegation system
* Add blacklist and ineligible list

**For projects:**
* Project team can add badge and boosted number for each id.
* Project team can add address to blacklist and ineligible list.

**For users:**
* User can earn extra boosting based on the badge and id they own at the time of deposit.
* User won't be able to earn extra boosting by badge when in ineligible list.
* User won't be allocated with any rewards when in blacklist. User can still deposit or withdraw when in blacklist.