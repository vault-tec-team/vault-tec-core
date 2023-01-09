
pragma solidity 0.8.7;

import "./interfaces/ITimeLockPool.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/base/TokenSaver.sol";

contract BatchDeposit is TokenSaver {

    using SafeERC20 for IERC20;

    address public targetPool;
    address public targetToken;
    constructor(address _targetPool, address _targetToken){
        targetPool = _targetPool;
        targetToken = _targetToken;


        IERC20(targetToken).approve(_targetPool, type(uint256).max);
    }

    function batchDeposit(
        uint256[] memory _amounts,
        uint256[] memory _durations,
        address[] memory _receivers
    ) external {
        require(
            _amounts.length == _durations.length,
            "MultiRewardsTimeLockPoolV3.batchDeposit: amounts and durations length mismatch"
        );
        require(
            _amounts.length == _receivers.length,
            "MultiRewardsTimeLockPoolV3.batchDeposit: amounts and receivers length mismatch"
        );

        uint256 sum = 0;

        for (uint256 i = 0; i < _amounts.length; i++) {
            sum += _amounts[i];
        }

        IERC20(targetToken).transferFrom(msg.sender, address(this), sum);

        for (uint256 i = 0; i < _receivers.length; i++) {
            ITimeLockPool(targetPool).deposit(_amounts[i], _durations[i], _receivers[i]);
        }
    }
}
