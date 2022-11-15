// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "contracts/multiRewards/gamefi/base/MultiRewardsBasePoolV3.sol";

contract TestMultiRewardsBasePoolV3 is MultiRewardsBasePoolV3 {

    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken,
        address[] memory _rewardTokens,
        address[] memory _escrowPools,
        uint256[] memory _escrowPortions,
        uint256[] memory _escrowDurations
    ) MultiRewardsBasePoolV3(_name, _symbol, _depositToken, _rewardTokens, _escrowPools, _escrowPortions, _escrowDurations) {
        // silence
    }
    function mint(address _receiver, uint256 _amount) external {
        _mint(_receiver, _amount);
    }

    function burn(address _from, uint256 _amount) external {
        _burn(_from, _amount);
    }
}