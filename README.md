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

## V2
Updates
* Add multi-rewards support for time lock pools.
* Different rewards will be distributed using different MultiRewardsLiquidityMiningManager and parameters can be set separately.
