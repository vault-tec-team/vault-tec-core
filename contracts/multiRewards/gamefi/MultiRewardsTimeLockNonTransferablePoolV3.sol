// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "contracts/multiRewards/gamefi/MultiRewardsTimeLockPoolV3.sol";

contract MultiRewardsTimeLockNonTransferablePoolV3 is MultiRewardsTimeLockPoolV3 {
    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken,
        address[] memory _rewardTokens,
        address[] memory _escrowPools,
        uint256[] memory _escrowPortions,
        uint256[] memory _escrowDurations,
        uint256 _maxBonus,
        uint256 _minLockDuration,
        uint256 _maxLockDuration,
        address _badgeManager
    ) MultiRewardsTimeLockPoolV3(
        _name, _symbol, _depositToken, _rewardTokens, _escrowPools, _escrowPortions, _escrowDurations,
        _maxBonus, _minLockDuration, _maxLockDuration, _badgeManager
    ) {}

    // disable transfers
    function _transfer(address _from, address _to, uint256 _amount) internal override {
        revert("NON_TRANSFERABLE");
    }
}